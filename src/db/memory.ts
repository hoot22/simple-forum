import { toPostFontId } from '../fonts/post-fonts'
import { topicImageSummary } from '../uploads/post-images'
import type {
  NewNotificationInput,
  NewReplyInput,
  NewTopicInput,
  Notification,
  NotificationKind,
  PostFontId,
  Page,
  Reply,
  ReplyWithTopic,
  Result,
  Topic,
  TopicDetail,
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
import { hashPassword } from '../utils/auth'

const ANONYMOUS = '匿名'

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString()
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 内存内部行：authorId 关联用户，展示时再解析用户名 */
interface TopicRow {
  id: number
  title: string
  content: string
  font?: PostFontId
  authorId: number | null
  createdAt: string
  /** 置顶：首页顶部单独展示 */
  pinned?: boolean
  /** 已设为站内公告 */
  isAnnouncement?: boolean
}

interface ReplyRow {
  id: number
  topicId: number
  content: string
  authorId: number | null
  createdAt: string
  /** 被回复的回复 ID；顶层回复省略或为 null */
  parentReplyId?: number | null
}

interface NotificationRow {
  id: number
  kind: NotificationKind
  /** 定向通知的接收者；公告为 null */
  userId: number | null
  title: string
  body: string
  link: string | null
  /** 由主题转化而来的公告指向该主题；手工发布的公告为 null */
  topicId?: number | null
  createdAt: string
}

export interface MemoryForumStoreOptions {
  /**
   * 是否写入演示数据（默认 true）。
   * 契约测试请显式传 false，从空库开始，保证断言与演示数据无关。
   */
  seed?: boolean
}

/** 生成「从新到旧」比较器：先比时间键，再比 id（id 大者在前） */
function compareDesc<T>(keyOf: (item: T) => string, idOf: (item: T) => number) {
  return (a: T, b: T): number => {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (ka !== kb) return ka < kb ? 1 : -1
    return idOf(b) - idOf(a)
  }
}

/**
 * 内存分页辅助：在「从新到旧」排好序的数组上做 keyset 分页。
 * 语义与 D1 实现保持一致：
 * - dir=older：从游标位置向更旧方向取一页；
 * - dir=newer：向更新方向取「紧邻游标之前」的一页（用于「较新」链接）；
 * - 非法游标按「第一页」处理。
 */
function paginateDesc<T>(
  sorted: T[],
  rawCursor: string | null | undefined,
  limit: number,
  keyOf: (item: T) => string,
  idOf: (item: T) => number,
): Page<T> {
  const cursor = decodeCursor(rawCursor)
  const total = sorted.length

  const isOlderThan = (item: T, c: DecodedCursor): boolean => {
    const key = keyOf(item)
    return key < c.key || (key === c.key && idOf(item) < c.id)
  }
  const isNewerThan = (item: T, c: DecodedCursor): boolean => {
    const key = keyOf(item)
    return key > c.key || (key === c.key && idOf(item) > c.id)
  }

  if (!cursor) {
    const items = sorted.slice(0, limit)
    const last = items[items.length - 1]
    const nextCursor =
      total > limit && last !== undefined ? encodeCursor('older', keyOf(last), idOf(last)) : null
    return { items, nextCursor, prevCursor: null }
  }

  if (cursor.dir === 'older') {
    let start = sorted.findIndex((item) => isOlderThan(item, cursor))
    if (start === -1) start = total
    const items = sorted.slice(start, start + limit)
    const first = items[0]
    const last = items[items.length - 1]
    const nextCursor =
      start + limit < total && last !== undefined ? encodeCursor('older', keyOf(last), idOf(last)) : null
    const prevCursor =
      start > 0 && first !== undefined ? encodeCursor('newer', keyOf(first), idOf(first)) : null
    return { items, nextCursor, prevCursor }
  }

  // dir === 'newer'：取紧邻游标之前（更新方向）的一页，仍按从新到旧返回
  let boundary = sorted.findIndex((item) => !isNewerThan(item, cursor))
  if (boundary === -1) boundary = total
  const start = Math.max(0, boundary - limit)
  const items = sorted.slice(start, boundary)
  const first = items[0]
  const last = items[items.length - 1]
  const prevCursor =
    start > 0 && first !== undefined ? encodeCursor('newer', keyOf(first), idOf(first)) : null
  const nextCursor =
    boundary < total && last !== undefined ? encodeCursor('older', keyOf(last), idOf(last)) : null
  return { items, nextCursor, prevCursor }
}

/**
 * MemoryForumStore —— 本地开发与测试用内存实现（不作为生产降级方案）。
 * 默认带演示数据（两个演示账号 + 两个主题），进程重启后重置。
 * 所有公开方法先 ensureSeeded()，保证与 D1 实现的异步形态一致。
 */
export class MemoryForumStore implements ForumStore {
  private users: UserWithPassword[] = []
  private topics: TopicRow[] = []
  private replies: ReplyRow[] = []
  private notifications: NotificationRow[] = []
  /** 已读状态：`${userId}:${notificationId}`，与 D1 的 notification_reads 表一一对应 */
  private notificationReads = new Set<string>()
  private nextUserId = 1
  private nextTopicId = 1
  private nextReplyId = 1
  private nextNotificationId = 1
  private seedPromise: Promise<void> | null = null
  private readonly shouldSeed: boolean

  constructor(options: MemoryForumStoreOptions = {}) {
    this.shouldSeed = options.seed !== false
  }

  // ---------- 种子数据 ----------

  private ensureSeeded(): Promise<void> {
    if (!this.seedPromise) {
      this.seedPromise = this.shouldSeed ? this.seed() : Promise.resolve()
    }
    return this.seedPromise
  }

  private async seed(): Promise<void> {
    const alice = this.createUserInternal('alice', await hashPassword('demo123456'))
    const bob = this.createUserInternal('bob', await hashPassword('demo654321'))

    const first = this.pushTopic({
      title: '欢迎来到 Simple Forum',
      content:
        '这是一个演示帖子，由内存存储提供。\n\n你可以用 alice / demo123456 或 bob / demo654321 登录，试试发帖、回复和个人页。\n\n本地数据重启即重置；将来绑定 Cloudflare D1 后数据会持久化。',
      authorId: alice.id,
      createdAt: iso(2 * DAY),
    })
    const second = this.pushTopic({
      title: 'Hono + Cloudflare Workers 搭建笔记',
      content:
        '参考 hono-bbs 的结构：路由与数据层分离，页面服务端渲染（hono/jsx），数据库通过 ForumStore 接口预留。\n\n现在补上了用户注册 / 登录（PBKDF2 哈希 + 签名 Cookie 会话）和个人页。',
      authorId: bob.id,
      createdAt: iso(26 * HOUR),
    })
    this.pushReply({
      topicId: first.id,
      content: '前排支持，欢迎提出建议！',
      authorId: bob.id,
      createdAt: iso(2 * DAY - 90 * MINUTE),
    })
    this.pushReply({
      topicId: second.id,
      content: '部署到 Cloudflare 时记得先建 D1 数据库并执行迁移。',
      authorId: alice.id,
      createdAt: iso(5 * HOUR),
    })
  }

  // ---------- 内部辅助 ----------

  private createUserInternal(username: string, passwordHash: string): UserWithPassword {
    const user: UserWithPassword = {
      id: this.nextUserId++,
      username,
      passwordHash,
      isAdmin: false,
      createdAt: new Date().toISOString(),
    }
    this.users.push(user)
    return user
  }

  private toPublic(user: UserWithPassword): User {
    return { id: user.id, username: user.username, isAdmin: user.isAdmin, createdAt: user.createdAt }
  }

  private pushTopic(row: Omit<TopicRow, 'id'>): TopicRow {
    const topic: TopicRow = { id: this.nextTopicId++, ...row }
    this.topics.push(topic)
    return topic
  }

  private pushReply(row: Omit<ReplyRow, 'id'>): ReplyRow {
    const reply: ReplyRow = { id: this.nextReplyId++, ...row }
    this.replies.push(reply)
    return reply
  }

  private usernameOf(authorId: number | null): string {
    if (authorId === null) return ANONYMOUS
    const user = this.users.find((u) => u.id === authorId)
    return user ? user.username : ANONYMOUS
  }

  private repliesOfTopic(topicId: number): ReplyRow[] {
    return this.replies.filter((r) => r.topicId === topicId)
  }

  private lastActivityOf(row: TopicRow): string {
    let last = row.createdAt
    for (const reply of this.replies) {
      if (reply.topicId === row.id && reply.createdAt > last) last = reply.createdAt
    }
    return last
  }

  private toTopic(row: TopicRow): Topic {
    const replyCount = this.repliesOfTopic(row.id).length
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      font: toPostFontId(row.font),
      authorId: row.authorId,
      author: this.usernameOf(row.authorId),
      createdAt: row.createdAt,
      replyCount,
      lastActivityAt: this.lastActivityOf(row),
      pinned: row.pinned === true,
      isAnnouncement: row.isAnnouncement === true,
      ...topicImageSummary(this, row.id),
    }
  }

  private toReply(row: ReplyRow): Reply {
    return {
      id: row.id,
      topicId: row.topicId,
      authorId: row.authorId,
      author: this.usernameOf(row.authorId),
      content: row.content,
      createdAt: row.createdAt,
      parentReplyId: row.parentReplyId ?? null,
      parentAuthor: this.parentAuthorOf(row.parentReplyId ?? null),
    }
  }

  /** 父回复作者名；父回复不存在或已被删除时返回 null。 */
  private parentAuthorOf(parentReplyId: number | null): string | null {
    if (parentReplyId === null) return null
    const parent = this.replies.find((r) => r.id === parentReplyId)
    return parent ? this.usernameOf(parent.authorId) : null
  }

  private toReplyWithTopic(row: ReplyRow): ReplyWithTopic {
    const topic = this.topics.find((t) => t.id === row.topicId)
    return { ...this.toReply(row), topicTitle: topic ? topic.title : null }
  }

  /** 主题行按「创建时间从新到旧」排序 */
  private topicsSorted(): TopicRow[] {
    return this.topics.slice().sort(compareDesc((t) => t.createdAt, (t) => t.id))
  }

  // ---------- 用户 ----------

  async createUser(username: string, passwordHash: string): Promise<Result<User, 'USERNAME_TAKEN'>> {
    await this.ensureSeeded()
    const name = username.trim()
    if (this.users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: 'USERNAME_TAKEN' }
    }
    const user = this.createUserInternal(name, passwordHash)
    return { ok: true, value: this.toPublic(user) }
  }

  async getUserByUsername(username: string): Promise<UserWithPassword | null> {
    await this.ensureSeeded()
    const name = username.trim().toLowerCase()
    const user = this.users.find((u) => u.username.toLowerCase() === name)
    return user ? { ...user } : null
  }

  async getUserById(id: number): Promise<User | null> {
    await this.ensureSeeded()
    const user = this.users.find((u) => u.id === id)
    return user ? this.toPublic(user) : null
  }

  async getUserStats(userId: number): Promise<UserStats> {
    await this.ensureSeeded()
    return {
      topicCount: this.topics.filter((t) => t.authorId === userId).length,
      replyCount: this.replies.filter((r) => r.authorId === userId).length,
    }
  }

  async getOwnerId(): Promise<number | null> {
    await this.ensureSeeded()
    let min: number | null = null
    for (const user of this.users) {
      if (min === null || user.id < min) min = user.id
    }
    return min
  }

  async setUserAdmin(userId: number, isAdmin: boolean): Promise<Result<User, 'USER_NOT_FOUND'>> {
    await this.ensureSeeded()
    const user = this.users.find((u) => u.id === userId)
    if (!user) return { ok: false, error: 'USER_NOT_FOUND' }
    user.isAdmin = isAdmin
    return { ok: true, value: this.toPublic(user) }
  }

  // ---------- 主题 / 回复 ----------

  async listTopics(query: ListTopicsQuery = {}): Promise<Page<Topic>> {
    await this.ensureSeeded()
    const limit = normalizeLimit(query.limit)
    const sort = query.sort ?? 'newest'
    const keyOf =
      sort === 'active'
        ? (row: TopicRow) => this.lastActivityOf(row)
        : (row: TopicRow) => row.createdAt
    const sorted = this.topicsSorted().sort(compareDesc(keyOf, (t) => t.id))
    const page = paginateDesc(sorted, query.cursor, limit, keyOf, (t) => t.id)
    return {
      items: page.items.map((row) => this.toTopic(row)),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
    }
  }

  async getTopicDetail(query: GetTopicDetailQuery): Promise<TopicDetail | null> {
    await this.ensureSeeded()
    const row = this.topics.find((t) => t.id === query.topicId)
    if (!row) return null
    const replies = this.repliesOfTopic(row.id).sort(compareDesc((r) => r.createdAt, (r) => r.id))
    const page = paginateDesc(
      replies,
      query.repliesCursor,
      normalizeLimit(query.repliesLimit),
      (r) => r.createdAt,
      (r) => r.id,
    )
    return {
      ...this.toTopic(row),
      replies: {
        items: page.items.map((r) => this.toReply(r)),
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
      },
    }
  }

  async createTopic(user: User, input: NewTopicInput): Promise<Result<Topic, 'AUTHOR_NOT_FOUND'>> {
    await this.ensureSeeded()
    if (!this.users.some((u) => u.id === user.id)) {
      return { ok: false, error: 'AUTHOR_NOT_FOUND' }
    }
    const row = this.pushTopic({
      title: input.title,
      content: input.content,
      font: toPostFontId(input.font),
      authorId: user.id,
      createdAt: new Date().toISOString(),
    })
    return { ok: true, value: this.toTopic(row) }
  }

  async createReply(
    user: User,
    topicId: number,
    input: NewReplyInput,
  ): Promise<Result<Reply, 'TOPIC_NOT_FOUND' | 'AUTHOR_NOT_FOUND'>> {
    await this.ensureSeeded()
    const topic = this.topics.find((t) => t.id === topicId)
    if (!topic) return { ok: false, error: 'TOPIC_NOT_FOUND' }
    if (!this.users.some((u) => u.id === user.id)) {
      return { ok: false, error: 'AUTHOR_NOT_FOUND' }
    }
    const row = this.pushReply({
      topicId,
      content: input.content,
      authorId: user.id,
      createdAt: new Date().toISOString(),
      parentReplyId: input.parentReplyId ?? null,
    })
    return { ok: true, value: this.toReply(row) }
  }

  async getReplyById(replyId: number): Promise<Reply | null> {
    await this.ensureSeeded()
    const row = this.replies.find((r) => r.id === replyId)
    return row ? this.toReply(row) : null
  }

  async getTopicById(topicId: number): Promise<Topic | null> {
    await this.ensureSeeded()
    const row = this.topics.find((t) => t.id === topicId)
    return row ? this.toTopic(row) : null
  }

  async deleteTopic(topicId: number): Promise<Result<{ id: number }, 'TOPIC_NOT_FOUND'>> {
    await this.ensureSeeded()
    const index = this.topics.findIndex((t) => t.id === topicId)
    if (index === -1) return { ok: false, error: 'TOPIC_NOT_FOUND' }
    this.topics.splice(index, 1)
    this.replies = this.replies.filter((r) => r.topicId !== topicId)

    // D1 侧由 notifications.topic_id 的 ON DELETE CASCADE 完成同样的清理
    const linked = this.notifications.filter((n) => n.topicId === topicId)
    if (linked.length > 0) {
      const removed = new Set(linked.map((n) => n.id))
      for (const key of [...this.notificationReads]) {
        if (removed.has(notificationIdOfKey(key))) this.notificationReads.delete(key)
      }
      this.notifications = this.notifications.filter((n) => !removed.has(n.id))
    }

    return { ok: true, value: { id: topicId } }
  }

  // ---------- 置顶 / 公告 ----------

  async setTopicPinned(topicId: number, pinned: boolean): Promise<Result<Topic, 'TOPIC_NOT_FOUND'>> {
    await this.ensureSeeded()
    const row = this.topics.find((t) => t.id === topicId)
    if (row === undefined) return { ok: false, error: 'TOPIC_NOT_FOUND' }
    row.pinned = pinned
    return { ok: true, value: this.toTopic(row) }
  }

  async setTopicAnnouncement(
    topicId: number,
    value: boolean,
  ): Promise<Result<Topic, 'TOPIC_NOT_FOUND'>> {
    await this.ensureSeeded()
    const row = this.topics.find((t) => t.id === topicId)
    if (row === undefined) return { ok: false, error: 'TOPIC_NOT_FOUND' }
    row.isAnnouncement = value

    const linked = this.notifications.filter((n) => n.kind === 'announcement' && n.topicId === topicId)
    if (value) {
      // 幂等：同一主题只保留一条公告，重复「设为公告」不会产生重复条目
      if (linked.length === 0) {
        this.notifications.push({
          id: this.nextNotificationId++,
          kind: 'announcement',
          userId: null,
          title: row.title,
          body: announcementExcerpt(row.content),
          link: `/topics/${topicId}`,
          topicId,
          createdAt: iso(0),
        })
      }
    } else if (linked.length > 0) {
      const removed = new Set(linked.map((n) => n.id))
      for (const key of [...this.notificationReads]) {
        if (removed.has(notificationIdOfKey(key))) this.notificationReads.delete(key)
      }
      this.notifications = this.notifications.filter((n) => !removed.has(n.id))
    }

    return { ok: true, value: this.toTopic(row) }
  }

  async listPinnedTopics(limit = 5): Promise<Topic[]> {
    await this.ensureSeeded()
    return this.topics
      .filter((t) => t.pinned === true)
      .sort(compareDesc((t) => t.createdAt, (t) => t.id))
      .slice(0, normalizeLimit(limit))
      .map((row) => this.toTopic(row))
  }

  // ---------- 个人页 ----------

  async listTopicsByAuthor(query: ListByAuthorQuery): Promise<Page<Topic>> {
    await this.ensureSeeded()
    const rows = this.topicsSorted().filter((t) => t.authorId === query.authorId)
    const page = paginateDesc(rows, query.cursor, normalizeLimit(query.limit), (t) => t.createdAt, (t) => t.id)
    return {
      items: page.items.map((row) => this.toTopic(row)),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
    }
  }

  async listRepliesByAuthor(query: ListByAuthorQuery): Promise<Page<ReplyWithTopic>> {
    await this.ensureSeeded()
    const rows = this.replies
      .filter((r) => r.authorId === query.authorId)
      .sort(compareDesc((r) => r.createdAt, (r) => r.id))
    const page = paginateDesc(rows, query.cursor, normalizeLimit(query.limit), (r) => r.createdAt, (r) => r.id)
    return {
      items: page.items.map((row) => this.toReplyWithTopic(row)),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
    }
  }

  // ---------- 通知与公告 ----------

  async listNotifications(query: ListNotificationsQuery): Promise<Page<Notification>> {
    await this.ensureSeeded()
    const rows = this.notifications
      .filter((n) => isVisibleTo(n, query.userId, query.kind))
      .sort(compareDesc((n) => n.createdAt, (n) => n.id))
    const page = paginateDesc(
      rows,
      query.cursor,
      normalizeLimit(query.limit),
      (n) => n.createdAt,
      (n) => n.id,
    )
    return {
      items: page.items.map((row) => this.toNotification(row, query.userId)),
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
    }
  }

  async countUnreadNotifications(userId: number): Promise<UnreadCounts> {
    await this.ensureSeeded()
    let notifications = 0
    let announcements = 0
    for (const row of this.notifications) {
      if (!isVisibleTo(row, userId, row.kind)) continue
      if (this.notificationReads.has(readKey(userId, row.id))) continue
      if (row.kind === 'announcement') announcements += 1
      else notifications += 1
    }
    return { notifications, announcements, total: notifications + announcements }
  }

  async listUnreadAnnouncements(userId: number): Promise<Notification[]> {
    await this.ensureSeeded()
    return this.notifications
      .filter((row) => isVisibleTo(row, userId, 'announcement'))
      .sort(compareDesc((row) => row.createdAt, (row) => row.id))
      .filter((row) => !this.notificationReads.has(readKey(userId, row.id)))
      .map((row) => this.toNotification(row, userId))
  }

  async markNotificationsRead(userId: number, kind: NotificationKind): Promise<number> {
    await this.ensureSeeded()
    let marked = 0
    for (const row of this.notifications) {
      if (!isVisibleTo(row, userId, kind)) continue
      const key = readKey(userId, row.id)
      if (this.notificationReads.has(key)) continue
      this.notificationReads.add(key)
      marked += 1
    }
    return marked
  }

  async createNotification(
    input: NewNotificationInput,
  ): Promise<Result<Notification, 'NOTIFICATION_TARGET_REQUIRED' | 'USER_NOT_FOUND'>> {
    await this.ensureSeeded()
    let userId: number | null = null
    if (input.kind === 'notification') {
      const target = input.userId
      if (target === undefined || target === null) {
        return { ok: false, error: 'NOTIFICATION_TARGET_REQUIRED' }
      }
      if (!this.users.some((u) => u.id === target)) {
        return { ok: false, error: 'USER_NOT_FOUND' }
      }
      userId = target
    }
    const row: NotificationRow = {
      id: this.nextNotificationId++,
      kind: input.kind,
      userId,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      topicId: input.topicId ?? null,
      createdAt: iso(0),
    }
    this.notifications.push(row)
    return {
      ok: true,
      value: {
        id: row.id,
        kind: row.kind,
        userId: row.userId,
        title: row.title,
        body: row.body,
        link: row.link,
        topicId: row.topicId ?? null,
        createdAt: row.createdAt,
        read: false,
      },
    }
  }

  private toNotification(row: NotificationRow, viewerId: number): Notification {
    return {
      id: row.id,
      kind: row.kind,
      userId: row.userId,
      title: row.title,
      body: row.body,
      link: row.link,
      topicId: row.topicId ?? null,
      createdAt: row.createdAt,
      read: this.notificationReads.has(readKey(viewerId, row.id)),
    }
  }
}

/** 已读集合的键：与 D1 中 notification_reads 的 (user_id, notification_id) 主键一致 */
function readKey(userId: number, notificationId: number): string {
  return `${userId}:${notificationId}`
}

/** 从已读键中取回通知 id，用于通知被删除时清理对应的已读记录 */
function notificationIdOfKey(key: string): number {
  return Number(key.slice(key.indexOf(':') + 1))
}

/** 公告摘要：正文压成单行并截断，避免公告页被长文撑开（与 D1 实现保持一致） */
function announcementExcerpt(content: string, max = 120): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 某条通知对某个用户是否可见：公告人人可见，定向通知只对接收者可见 */
function isVisibleTo(row: NotificationRow, userId: number, kind: NotificationKind): boolean {
  if (row.kind !== kind) return false
  return row.kind === 'announcement' ? row.userId === null : row.userId === userId
}
