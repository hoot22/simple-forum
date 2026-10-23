import { toPostFontId } from '../fonts/post-fonts'
import type {
  NewNotificationInput,
  NewReplyInput,
  NewTopicInput,
  Notification,
  NotificationKind,
  Page,
  Reply,
  ReplyWithTopic,
  Result,
  Topic,
  TopicDetail,
  TopicSort,
  UnreadCounts,
  User,
  UserWithPassword,
} from '../types'
import type {
  ForumStore,
  GetTopicDetailQuery,
  ListByAuthorQuery,
  ListNotificationsQuery,
  ListTopicsQuery,
  UserStats,
} from './store'
import { decodeCursor, encodeCursor, normalizeLimit, type DecodedCursor } from './cursor'

const ANONYMOUS = '匿名'

// ---------- 通知 / 公告 ----------

interface NotificationRow {
  id: number
  kind: NotificationKind
  user_id: number | null
  title: string
  body: string
  link: string | null
  created_at: string
  topic_id: number | null
  is_read: number
}

/**
 * 通知查询的公共列与连接。
 *
 * 第一个 `?` 是「查询者 id」，用于算出相对该用户的已读状态。外层 WHERE 只能引用这里
 * 显式重命名过的列（SQLite 不允许外层引用子查询内部的表别名）。
 */
const NOTIFICATION_SELECT = `
  SELECT
    n.id AS id,
    n.kind AS kind,
    n.user_id AS user_id,
    n.title AS title,
    n.body AS body,
    n.link AS link,
    n.topic_id AS topic_id,
    n.created_at AS created_at,
    CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS is_read
  FROM notifications n
  LEFT JOIN notification_reads r
    ON r.notification_id = n.id AND r.user_id = ?
`

// ---------- 行类型 ----------

interface TopicRow {
  id: number
  title: string
  content: string
  font: string
  author_id: number | null
  author_name: string
  created_at: string
  reply_count: number
  last_activity: string
  pinned: number
  is_announcement: number
  image_count: number
  first_image_id: number | null
}

interface ReplyRow {
  id: number
  topic_id: number
  content: string
  author_id: number | null
  author_name: string
  created_at: string
  parent_reply_id: number | null
  parent_author_name: string | null
}

interface ReplyWithTopicRow extends ReplyRow {
  topic_title: string | null
}

interface UserRow {
  id: number
  username: string
  password_hash: string
  is_admin: number
  created_at: string
}

interface TopicInsertRow {
  id: number
  title: string
  content: string
  author_id: number | null
  created_at: string
}

interface ReplyInsertRow {
  id: number
  topic_id: number
  content: string
  author_id: number | null
  created_at: string
}

// ---------- SQL 片段 ----------

/**
 * 主题聚合查询：一次读出作者名、回复数与最后活动时间，
 * 不再对每个主题追加 COUNT 查询（消除 N+1）。
 * 使用方在外面再包一层 `SELECT * FROM (...)`，以便 WHERE 中引用聚合别名。
 */
const TOPIC_SELECT = `
  SELECT t.id, t.title, t.content, t.font, t.author_id,
         COALESCE(u.username, '${ANONYMOUS}') AS author_name,
         t.created_at,
         (SELECT COUNT(*) FROM replies r WHERE r.topic_id = t.id) AS reply_count,
         COALESCE((SELECT MAX(r.created_at) FROM replies r WHERE r.topic_id = t.id), t.created_at) AS last_activity,
         t.pinned, t.is_announcement,
         (SELECT COUNT(*) FROM post_images pi WHERE pi.topic_id = t.id) AS image_count,
         (SELECT pi.id FROM post_images pi WHERE pi.topic_id = t.id
           ORDER BY pi.position, pi.id LIMIT 1) AS first_image_id
  FROM topics t
  LEFT JOIN users u ON u.id = t.author_id
`

const REPLY_SELECT = `
  SELECT r.id, r.topic_id, r.content, r.author_id,
         COALESCE(u.username, '${ANONYMOUS}') AS author_name,
         r.parent_reply_id,
         pu.username AS parent_author_name,
         r.created_at
  FROM replies r
  LEFT JOIN users u ON u.id = r.author_id
  LEFT JOIN replies pr ON pr.id = r.parent_reply_id
  LEFT JOIN users pu ON pu.id = pr.author_id
`

/** 个人页「最近回复」：附带所在主题标题，避免逐条回查主题 */
const REPLY_WITH_TOPIC_SELECT = `
  SELECT r.id, r.topic_id, r.content, r.author_id,
         COALESCE(u.username, '${ANONYMOUS}') AS author_name,
         r.created_at,
         t.title AS topic_title
  FROM replies r
  LEFT JOIN users u ON u.id = r.author_id
  LEFT JOIN topics t ON t.id = r.topic_id
`

// ---------- 错误识别 ----------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** users 表对 lower(username) 有唯一索引；用户名冲突时 D1 抛出 UNIQUE 约束错误 */
function isUniqueViolation(err: unknown): boolean {
  return /unique constraint failed/i.test(errorMessage(err))
}

/** 作者/主题已不存在时触发的外键错误（典型场景：会话用户已被删除） */
function isForeignKeyViolation(err: unknown): boolean {
  return /foreign key constraint failed/i.test(errorMessage(err))
}

/**
 * D1ForumStore —— Cloudflare D1 (SQLite) 实现。
 * 需要先执行 migrations/ 下的建表与索引脚本（0001–0003）。
 * 时间戳由 SQLite datetime('now') 生成，形如 "2026-09-06 08:30:00"（UTC，秒精度）。
 *
 * 分页与内存实现保持同一份契约（见 src/db/store.ts 与 test/contract/repository-contract.ts）：
 * 游标编码为 (排序键, id)，翻页方向由游标中的 dir 决定，非法游标按第一页处理。
 */
export class D1ForumStore implements ForumStore {
  constructor(private readonly db: D1Database) {}

  // ---------- 行映射 ----------

  private toTopic(row: TopicRow): Topic {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      font: toPostFontId(row.font),
      authorId: row.author_id,
      author: row.author_name,
      createdAt: row.created_at,
      replyCount: row.reply_count,
      lastActivityAt: row.last_activity,
      pinned: row.pinned === 1,
      isAnnouncement: row.is_announcement === 1,
      imageCount: row.image_count,
      firstImageId: row.first_image_id,
    }
  }

  private toReply(row: ReplyRow): Reply {
    return {
      id: row.id,
      topicId: row.topic_id,
      authorId: row.author_id,
      author: row.author_name,
      content: row.content,
      createdAt: row.created_at,
      parentReplyId: row.parent_reply_id ?? null,
      parentAuthor: row.parent_author_name ?? null,
    }
  }

  private toReplyWithTopic(row: ReplyWithTopicRow): ReplyWithTopic {
    return { ...this.toReply(row), topicTitle: row.topic_title }
  }

  private toPublic(row: UserRow): User {
    return { id: row.id, username: row.username, isAdmin: row.is_admin === 1, createdAt: row.created_at }
  }

  // ---------- 分页核心 ----------

  /**
   * 通用 keyset 分页：
   * - fetch(dir, count) 负责按方向取 count 行（older 取从新到旧，newer 取自旧向新）；
   * - probeNewer 只在需要时探测「是否还有更新的行」，用于生成 prevCursor；
   * - 返回统一为「从新到旧」的一页。
   */
  private async buildPage<T>(options: {
    limit: number
    cursor: DecodedCursor | null
    keyOf: (row: T) => string
    idOf: (row: T) => number
    fetch: (dir: 'older' | 'newer', count: number) => Promise<T[]>
    probeNewer: (first: T) => Promise<boolean>
  }): Promise<Page<T>> {
    const { limit, cursor } = options
    const dir = cursor?.dir ?? 'older'
    const rows = await options.fetch(dir, limit + 1)
    const hasMore = rows.length > limit
    const kept = hasMore ? rows.slice(0, limit) : rows

    if (dir === 'newer') {
      const items = kept.slice().reverse()
      const ascFirst = kept[0]
      const ascLast = kept[kept.length - 1]
      const prevCursor =
        hasMore && ascLast !== undefined
          ? encodeCursor('newer', options.keyOf(ascLast), options.idOf(ascLast))
          : null
      const nextCursor =
        ascFirst !== undefined
          ? encodeCursor('older', options.keyOf(ascFirst), options.idOf(ascFirst))
          : null
      return { items, nextCursor, prevCursor }
    }

    const first = kept[0]
    const last = kept[kept.length - 1]
    const nextCursor =
      hasMore && last !== undefined ? encodeCursor('older', options.keyOf(last), options.idOf(last)) : null
    let prevCursor: string | null = null
    if (cursor !== null && first !== undefined) {
      const hasNewer = await options.probeNewer(first)
      prevCursor = hasNewer
        ? encodeCursor('newer', options.keyOf(first), options.idOf(first))
        : null
    }
    return { items: kept, nextCursor, prevCursor }
  }

  /** 主题列表分页（可附加固定过滤条件，如 author_id = ?） */
  private async topicPage(options: {
    sort: TopicSort
    where: string
    whereParams: unknown[]
    rawCursor: string | null | undefined
    rawLimit: number | undefined
  }): Promise<Page<Topic>> {
    const cursor = decodeCursor(options.rawCursor)
    const keyCol = options.sort === 'active' ? 'last_activity' : 'created_at'
    const keyOf =
      options.sort === 'active'
        ? (row: TopicRow) => row.last_activity
        : (row: TopicRow) => row.created_at

    const page = await this.buildPage<TopicRow>({
      limit: normalizeLimit(options.rawLimit),
      cursor,
      keyOf,
      idOf: (row) => row.id,
      fetch: async (dir, count) => {
        const cond = cursor
          ? dir === 'older'
            ? `(${keyCol} < ? OR (${keyCol} = ? AND id < ?))`
            : `(${keyCol} > ? OR (${keyCol} = ? AND id > ?))`
          : ''
        const clauses = [options.where, cond].filter((sql) => sql.length > 0)
        const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
        const params: unknown[] = [...options.whereParams]
        if (cursor) params.push(cursor.key, cursor.key, cursor.id)
        params.push(count)
        const order = dir === 'older' ? 'DESC' : 'ASC'
        const res = await this.db
          .prepare(
            `SELECT * FROM (${TOPIC_SELECT}) ${whereSql} ORDER BY ${keyCol} ${order}, id ${order} LIMIT ?`,
          )
          .bind(...params)
          .all<TopicRow>()
        return res.results
      },
      probeNewer: async (first) => {
        const clauses = [options.where, `(${keyCol} > ? OR (${keyCol} = ? AND id > ?))`].filter(
          (sql) => sql.length > 0,
        )
        const params = [...options.whereParams, keyOf(first), keyOf(first), first.id]
        const row = await this.db
          .prepare(`SELECT 1 AS hit FROM (${TOPIC_SELECT}) WHERE ${clauses.join(' AND ')} LIMIT 1`)
          .bind(...params)
          .first<{ hit: number }>()
        return row !== null
      },
    })

    return {
      items: page.items.map((row) => this.toTopic(row)),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
    }
  }

  /** 回复分页（固定过滤条件如 topic_id = ? / author_id = ?；可选带主题标题的查询） */
  private async replyPage<T extends ReplyRow>(
    select: string,
    where: string,
    whereParams: unknown[],
    rawCursor: string | null | undefined,
    rawLimit: number | undefined,
  ): Promise<{ rows: T[]; nextCursor: string | null; prevCursor: string | null }> {
    const cursor = decodeCursor(rawCursor)
    const page = await this.buildPage<T>({
      limit: normalizeLimit(rawLimit),
      cursor,
      keyOf: (row) => row.created_at,
      idOf: (row) => row.id,
      fetch: async (dir, count) => {
        const cond = cursor
          ? dir === 'older'
            ? '(created_at < ? OR (created_at = ? AND id < ?))'
            : '(created_at > ? OR (created_at = ? AND id > ?))'
          : ''
        const clauses = [where, cond].filter((sql) => sql.length > 0)
        const params: unknown[] = [...whereParams]
        if (cursor) params.push(cursor.key, cursor.key, cursor.id)
        params.push(count)
        const order = dir === 'older' ? 'DESC' : 'ASC'
        const res = await this.db
          .prepare(
            `SELECT * FROM (${select}) WHERE ${clauses.join(' AND ')} ORDER BY created_at ${order}, id ${order} LIMIT ?`,
          )
          .bind(...params)
          .all<T>()
        return res.results
      },
      probeNewer: async (first) => {
        const clauses = [where, '(created_at > ? OR (created_at = ? AND id > ?))']
        const params = [...whereParams, first.created_at, first.created_at, first.id]
        const row = await this.db
          .prepare(`SELECT 1 AS hit FROM (${select}) WHERE ${clauses.join(' AND ')} LIMIT 1`)
          .bind(...params)
          .first<{ hit: number }>()
        return row !== null
      },
    })
    return { rows: page.items, nextCursor: page.nextCursor, prevCursor: page.prevCursor }
  }

  // ---------- 用户 ----------

  async createUser(username: string, passwordHash: string): Promise<Result<User, 'USERNAME_TAKEN'>> {
    const name = username.trim()
    try {
      const row = await this.db
        .prepare(
          'INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id, username, password_hash, created_at',
        )
        .bind(name, passwordHash)
        .first<UserRow>()
      if (!row) throw new Error('createUser: INSERT RETURNING 未返回行')
      return { ok: true, value: this.toPublic(row) }
    } catch (err) {
      if (isUniqueViolation(err)) return { ok: false, error: 'USERNAME_TAKEN' }
      throw err
    }
  }

  async getUserByUsername(username: string): Promise<UserWithPassword | null> {
    const row = await this.db
      .prepare(
        'SELECT id, username, password_hash, is_admin, created_at FROM users WHERE lower(username) = lower(?) LIMIT 1',
      )
      .bind(username.trim())
      .first<UserRow>()
    return row
      ? {
          id: row.id,
          username: row.username,
          passwordHash: row.password_hash,
          isAdmin: row.is_admin === 1,
          createdAt: row.created_at,
        }
      : null
  }

  async getUserById(id: number): Promise<User | null> {
    const row = await this.db
      .prepare('SELECT id, username, password_hash, is_admin, created_at FROM users WHERE id = ?')
      .bind(id)
      .first<UserRow>()
    return row ? this.toPublic(row) : null
  }

  async getUserStats(userId: number): Promise<UserStats> {
    const row = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM topics WHERE author_id = ?) AS topic_count,
           (SELECT COUNT(*) FROM replies WHERE author_id = ?) AS reply_count`,
      )
      .bind(userId, userId)
      .first<{ topic_count: number; reply_count: number }>()
    return { topicCount: row?.topic_count ?? 0, replyCount: row?.reply_count ?? 0 }
  }

  async getOwnerId(): Promise<number | null> {
    const row = await this.db
      .prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1')
      .first<{ id: number }>()
    return row ? row.id : null
  }

  async setUserAdmin(userId: number, isAdmin: boolean): Promise<Result<User, 'USER_NOT_FOUND'>> {
    const row = await this.db
      .prepare(
        'UPDATE users SET is_admin = ? WHERE id = ? RETURNING id, username, password_hash, is_admin, created_at',
      )
      .bind(isAdmin ? 1 : 0, userId)
      .first<UserRow>()
    if (!row) return { ok: false, error: 'USER_NOT_FOUND' }
    return { ok: true, value: this.toPublic(row) }
  }

  // ---------- 主题 / 回复 ----------

  // ---------- 置顶 / 公告 ----------

  /** 按 id 读取主题（含置顶与公告标记），用于设置后的回读 */
  private async topicRowById(topicId: number): Promise<TopicRow | null> {
    return this.db.prepare(`${TOPIC_SELECT} WHERE t.id = ?`).bind(topicId).first<TopicRow>()
  }

  async setTopicPinned(topicId: number, pinned: boolean): Promise<Result<Topic, 'TOPIC_NOT_FOUND'>> {
    // changes() 反映 WHERE 命中的行数，因此「主题不存在」与「值没变」可以区分开
    const updated = await this.db
      .prepare('UPDATE topics SET pinned = ? WHERE id = ?')
      .bind(pinned ? 1 : 0, topicId)
      .run()
    if (Number(updated.meta.changes ?? 0) === 0) return { ok: false, error: 'TOPIC_NOT_FOUND' }

    const row = await this.topicRowById(topicId)
    if (row === null) return { ok: false, error: 'TOPIC_NOT_FOUND' }
    return { ok: true, value: this.toTopic(row) }
  }

  async setTopicAnnouncement(
    topicId: number,
    value: boolean,
  ): Promise<Result<Topic, 'TOPIC_NOT_FOUND'>> {
    const updated = await this.db
      .prepare('UPDATE topics SET is_announcement = ? WHERE id = ?')
      .bind(value ? 1 : 0, topicId)
      .run()
    if (Number(updated.meta.changes ?? 0) === 0) return { ok: false, error: 'TOPIC_NOT_FOUND' }

    const row = await this.topicRowById(topicId)
    if (row === null) return { ok: false, error: 'TOPIC_NOT_FOUND' }

    if (value) {
      // 幂等：同一主题只保留一条公告，重复「设为公告」不会产生重复条目
      const existing = await this.db
        .prepare(`SELECT id FROM notifications WHERE kind = 'announcement' AND topic_id = ? LIMIT 1`)
        .bind(topicId)
        .first<{ id: number }>()
      if (existing === null) {
        await this.createNotification({
          kind: 'announcement',
          title: row.title,
          body: announcementExcerpt(row.content),
          link: `/topics/${topicId}`,
          topicId,
        })
      }
    } else {
      await this.db
        .prepare(`DELETE FROM notifications WHERE kind = 'announcement' AND topic_id = ?`)
        .bind(topicId)
        .run()
    }

    return { ok: true, value: this.toTopic(row) }
  }

  async listPinnedTopics(limit = 5): Promise<Topic[]> {
    const res = await this.db
      .prepare(`SELECT * FROM (${TOPIC_SELECT}) WHERE pinned = 1 ORDER BY id DESC LIMIT ?`)
      .bind(normalizeLimit(limit))
      .all<TopicRow>()
    return res.results.map((row) => this.toTopic(row))
  }

  async listTopics(query: ListTopicsQuery = {}): Promise<Page<Topic>> {
    return this.topicPage({
      sort: query.sort ?? 'newest',
      where: '',
      whereParams: [],
      rawCursor: query.cursor,
      rawLimit: query.limit,
    })
  }

  async getTopicDetail(query: GetTopicDetailQuery): Promise<TopicDetail | null> {
    const topic = await this.db.prepare(`${TOPIC_SELECT} WHERE t.id = ?`).bind(query.topicId).first<TopicRow>()
    if (!topic) return null
    const replies = await this.replyPage<ReplyRow>(
      REPLY_SELECT,
      'topic_id = ?',
      [query.topicId],
      query.repliesCursor,
      query.repliesLimit,
    )
    return {
      ...this.toTopic(topic),
      replies: {
        items: replies.rows.map((row) => this.toReply(row)),
        nextCursor: replies.nextCursor,
        prevCursor: replies.prevCursor,
      },
    }
  }

  async createTopic(user: User, input: NewTopicInput): Promise<Result<Topic, 'AUTHOR_NOT_FOUND'>> {
    // 显式校验作者存在（不依赖数据库是否开启外键约束，保证与内存实现行为一致）
    const author = await this.db
      .prepare('SELECT id FROM users WHERE id = ? LIMIT 1')
      .bind(user.id)
      .first<{ id: number }>()
    if (!author) return { ok: false, error: 'AUTHOR_NOT_FOUND' }

    try {
      const row = await this.db
        .prepare(
          `INSERT INTO topics (title, content, author_id, created_at, font)
           VALUES (?, ?, ?, datetime('now'), ?)
           RETURNING id, title, content, author_id, created_at`,
        )
        .bind(input.title, input.content, user.id, toPostFontId(input.font))
        .first<TopicInsertRow>()
      if (!row) throw new Error('createTopic: INSERT RETURNING 未返回行')
      return {
        ok: true,
        value: {
          id: row.id,
          title: row.title,
          content: row.content,
          font: toPostFontId(input.font),
          authorId: row.author_id,
          author: user.username,
          createdAt: row.created_at,
          replyCount: 0,
          lastActivityAt: row.created_at,
          pinned: false,
          isAnnouncement: false,
          imageCount: 0,
          firstImageId: null,
        },
      }
    } catch (err) {
      if (isForeignKeyViolation(err)) return { ok: false, error: 'AUTHOR_NOT_FOUND' }
      throw err
    }
  }

  async createReply(
    user: User,
    topicId: number,
    input: NewReplyInput,
  ): Promise<Result<Reply, 'TOPIC_NOT_FOUND' | 'AUTHOR_NOT_FOUND'>> {
    const exists = await this.db
      .prepare('SELECT id FROM topics WHERE id = ? LIMIT 1')
      .bind(topicId)
      .first<{ id: number }>()
    if (!exists) return { ok: false, error: 'TOPIC_NOT_FOUND' }

    try {
      const row = await this.db
        .prepare(
          `INSERT INTO replies (topic_id, content, author_id, parent_reply_id, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           RETURNING id, topic_id, content, author_id, created_at`,
        )
        .bind(topicId, input.content, user.id, input.parentReplyId ?? null)
        .first<ReplyInsertRow>()
      if (!row) throw new Error('createReply: INSERT RETURNING 未返回行')
      return {
        ok: true,
        value: {
          id: row.id,
          topicId: row.topic_id,
          authorId: row.author_id,
          author: user.username,
          content: row.content,
          createdAt: row.created_at,
          parentReplyId: input.parentReplyId ?? null,
          parentAuthor: null,
        },
      }
    } catch (err) {
      // 主题已在上方校验；此处外键失败基本只剩「会话用户已被删除」一种情况
      if (isForeignKeyViolation(err)) return { ok: false, error: 'AUTHOR_NOT_FOUND' }
      throw err
    }
  }

  async getReplyById(replyId: number): Promise<Reply | null> {
    const row = await this.db
      .prepare(`${REPLY_SELECT} WHERE r.id = ? LIMIT 1`)
      .bind(replyId)
      .first<ReplyRow>()
    return row ? this.toReply(row) : null
  }

  async getTopicById(topicId: number): Promise<Topic | null> {
    const row = await this.db
      .prepare(`${TOPIC_SELECT} WHERE t.id = ?`)
      .bind(topicId)
      .first<TopicRow>()
    return row ? this.toTopic(row) : null
  }

  async deleteTopic(topicId: number): Promise<Result<{ id: number }, 'TOPIC_NOT_FOUND'>> {
    const existing = await this.db
      .prepare('SELECT id FROM topics WHERE id = ? LIMIT 1')
      .bind(topicId)
      .first<{ id: number }>()
    if (!existing) return { ok: false, error: 'TOPIC_NOT_FOUND' }

    // 由该主题转化出的公告及其已读记录：显式删除，不依赖外键级联，
    // 这样在未开启 foreign_keys 的环境（例如本地 workerd）也得到同样结果。
    const linked = await this.db
      .prepare(`SELECT id FROM notifications WHERE kind = 'announcement' AND topic_id = ?`)
      .bind(topicId)
      .all<{ id: number }>()

    // 先删回复、再删主题；所有语句放在同一批次（事务）中执行
    await this.db.batch([
      ...linked.results.map((row) =>
        this.db.prepare('DELETE FROM notification_reads WHERE notification_id = ?').bind(row.id),
      ),
      ...linked.results.map((row) =>
        this.db.prepare('DELETE FROM notifications WHERE id = ?').bind(row.id),
      ),
      this.db.prepare('DELETE FROM replies WHERE topic_id = ?').bind(topicId),
      this.db.prepare('DELETE FROM topics WHERE id = ?').bind(topicId),
    ])
    return { ok: true, value: { id: topicId } }
  }

  // ---------- 个人页 ----------

  async listTopicsByAuthor(query: ListByAuthorQuery): Promise<Page<Topic>> {
    return this.topicPage({
      sort: 'newest',
      where: 'author_id = ?',
      whereParams: [query.authorId],
      rawCursor: query.cursor,
      rawLimit: query.limit,
    })
  }

  async listRepliesByAuthor(query: ListByAuthorQuery): Promise<Page<ReplyWithTopic>> {
    const page = await this.replyPage<ReplyWithTopicRow>(
      REPLY_WITH_TOPIC_SELECT,
      'author_id = ?',
      [query.authorId],
      query.cursor,
      query.limit,
    )
    return {
      items: page.rows.map((row) => this.toReplyWithTopic(row)),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
    }
  }

  // ---------- 通知与公告 ----------

  async listNotifications(query: ListNotificationsQuery): Promise<Page<Notification>> {
    const page = await this.notificationPage({
      kind: query.kind,
      userId: query.userId,
      rawCursor: query.cursor,
      rawLimit: query.limit,
    })
    return {
      items: page.items.map(toNotification),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
    }
  }

  async countUnreadNotifications(userId: number): Promise<UnreadCounts> {
    const row = await this.db
      .prepare(
        `SELECT
           COUNT(CASE WHEN n.kind = 'notification' THEN 1 END) AS notification_count,
           COUNT(CASE WHEN n.kind = 'announcement' THEN 1 END) AS announcement_count
         FROM notifications n
         WHERE (n.user_id = ? OR n.user_id IS NULL)
           AND NOT EXISTS (
             SELECT 1 FROM notification_reads r
             WHERE r.notification_id = n.id AND r.user_id = ?
           )`,
      )
      .bind(userId, userId)
      .first<{ notification_count: number; announcement_count: number }>()
    const notifications = Number(row?.notification_count ?? 0)
    const announcements = Number(row?.announcement_count ?? 0)
    return { notifications, announcements, total: notifications + announcements }
  }

  async listUnreadAnnouncements(userId: number): Promise<Notification[]> {
    const { results } = await this.db
      .prepare(
        `SELECT * FROM (${NOTIFICATION_SELECT})
         WHERE kind = 'announcement' AND is_read = 0
         ORDER BY created_at DESC, id DESC`,
      )
      .bind(userId)
      .all<NotificationRow>()
    return (results ?? []).map(toNotification)
  }

  async markNotificationsRead(userId: number, kind: NotificationKind): Promise<number> {
    const scope = kind === 'announcement' ? 'n.user_id IS NULL' : 'n.user_id = ?'
    const scopeParams: unknown[] = kind === 'announcement' ? [] : [userId]
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO notification_reads (user_id, notification_id)
         SELECT ?, n.id
         FROM notifications n
         WHERE n.kind = ? AND ${scope}
           AND NOT EXISTS (
             SELECT 1 FROM notification_reads r
             WHERE r.notification_id = n.id AND r.user_id = ?
           )`,
      )
      .bind(userId, kind, ...scopeParams, userId)
      .run()
    return Number(result.meta.changes ?? 0)
  }

  async createNotification(
    input: NewNotificationInput,
  ): Promise<Result<Notification, 'NOTIFICATION_TARGET_REQUIRED' | 'USER_NOT_FOUND'>> {
    let userId: number | null = null
    if (input.kind === 'notification') {
      const target = input.userId
      if (target === undefined || target === null) {
        return { ok: false, error: 'NOTIFICATION_TARGET_REQUIRED' }
      }
      const exists = await this.db
        .prepare('SELECT 1 AS present FROM users WHERE id = ?')
        .bind(target)
        .first<{ present: number }>()
      if (exists === null) {
        return { ok: false, error: 'USER_NOT_FOUND' }
      }
      userId = target
    }

    // 显式写入时间戳，而不是依赖 DEFAULT CURRENT_TIMESTAMP：
    // 游标按 created_at 比较，返回值也需要立刻带上确定的时间，避免再查一次。
    const createdAt = d1Timestamp()
    await this.db
      .prepare(
        'INSERT INTO notifications (user_id, kind, title, body, link, topic_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        userId,
        input.kind,
        input.title,
        input.body,
        input.link ?? null,
        input.topicId ?? null,
        createdAt,
      )
      .run()

    const row = await this.db
      .prepare('SELECT id AS id FROM notifications WHERE created_at = ? AND kind = ? ORDER BY id DESC LIMIT 1')
      .bind(createdAt, input.kind)
      .first<{ id: number }>()

    return {
      ok: true,
      value: {
        id: Number(row?.id ?? 0),
        kind: input.kind,
        userId,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        topicId: input.topicId ?? null,
        createdAt,
        read: false,
      },
    }
  }

  /**
   * 通知 / 公告分页。
   *
   * `NOTIFICATION_SELECT` 的首个绑定参数是「查询者 id」，用于算出相对该用户的已读状态；
   * 外层 WHERE 只能引用子查询里显式重命名过的列（SQLite 不允许外层引用内部表别名）。
   */
  private async notificationPage(options: {
    kind: NotificationKind
    userId: number
    rawCursor: string | null | undefined
    rawLimit: number | undefined
  }): Promise<{ items: NotificationRow[]; nextCursor: string | null; prevCursor: string | null }> {
    const cursor = decodeCursor(options.rawCursor)
    const scope = options.kind === 'announcement' ? 'user_id IS NULL' : 'user_id = ?'
    const scopeParams: unknown[] = options.kind === 'announcement' ? [] : [options.userId]

    const windowSql = (dir: 'older' | 'newer'): string => {
      if (cursor === null) return ''
      return dir === 'older'
        ? '(created_at < ? OR (created_at = ? AND id < ?))'
        : '(created_at > ? OR (created_at = ? AND id > ?))'
    }
    const windowParams = (dir: 'older' | 'newer'): unknown[] =>
      cursor === null ? [] : [cursor.key, cursor.key, cursor.id]

    // 绑定顺序必须与占位符在 SQL 文本中的出现顺序一致：kind、作用域、游标窗口。
    const whereSql = (dir: 'older' | 'newer'): string =>
      `WHERE ${['kind = ?', scope, windowSql(dir)].filter((part) => part.length > 0).join(' AND ')}`
    const whereParams = (dir: 'older' | 'newer'): unknown[] => [
      options.kind,
      ...scopeParams,
      ...windowParams(dir),
    ]

    return this.buildPage<NotificationRow>({
      limit: normalizeLimit(options.rawLimit),
      cursor,
      keyOf: (row) => row.created_at,
      idOf: (row) => row.id,
      fetch: async (dir, count) => {
        const order = dir === 'older' ? 'DESC' : 'ASC'
        const res = await this.db
          .prepare(
            `SELECT * FROM (${NOTIFICATION_SELECT}) ${whereSql(dir)}` +
              ` ORDER BY created_at ${order}, id ${order} LIMIT ?`,
          )
          .bind(options.userId, ...whereParams(dir), count)
          .all<NotificationRow>()
        return res.results
      },
      probeNewer: async () => {
        const row = await this.db
          .prepare(`SELECT 1 AS present FROM (${NOTIFICATION_SELECT}) ${whereSql('newer')} LIMIT 1`)
          .bind(options.userId, ...whereParams('newer'))
          .first<{ present: number }>()
        return row !== null
      },
    })
  }
}

/** 把查询结果映射为领域对象（已读状态已在 SQL 中按查询者算好） */
function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    userId: row.user_id,
    title: row.title,
    body: row.body,
    link: row.link,
    topicId: row.topic_id,
    createdAt: row.created_at,
    read: row.is_read === 1,
  }
}

/** D1 的 CURRENT_TIMESTAMP 为 UTC 的 "YYYY-MM-DD HH:MM:SS"；显式写入时保持同一格式以便游标比较 */
function d1Timestamp(date = new Date()): string {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

/** 公告摘要：正文压成单行并截断，避免公告页被长文撑开 */
function announcementExcerpt(content: string, max = 120): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
