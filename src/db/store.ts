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

/**
 * ForumStore —— 论坛数据访问接口（Repository，数据库预留点）。
 *
 * 页面与 API 通过服务层调用这里的接口，不感知底层存储：
 * - MemoryForumStore：本地开发与测试适配器（不作为生产降级方案）；
 * - D1ForumStore：Cloudflare D1（SQLite），随 migrations/ 建表。
 *
 * 约定（P1 重构）：
 * - 所有列表返回 Page<T>：游标分页，items 从新到旧；游标不透明，
 *   非法游标一律按「第一页」处理，不向调用方抛解析错误；
 * - 创建操作返回显式 Result，冲突/缺失用稳定错误码表达，而不是 null 或抛异常；
 * - 除 getUserByUsername（仅登录校验）外，任何返回结构都不得携带 passwordHash。
 */

export interface ListTopicsQuery {
  cursor?: string | null
  limit?: number
  sort?: TopicSort
}

export interface GetTopicDetailQuery {
  topicId: number
  repliesCursor?: string | null
  repliesLimit?: number
}

export interface ListByAuthorQuery {
  authorId: number
  cursor?: string | null
  limit?: number
}

export interface UserStats {
  topicCount: number
  replyCount: number
}

export interface ForumStore {
  // ---------- 用户 ----------

  /** 创建用户。用户名重复（不区分大小写）时返回 USERNAME_TAKEN。 */
  createUser(username: string, passwordHash: string): Promise<Result<User, 'USERNAME_TAKEN'>>

  /** 按用户名查找（不区分大小写）。仅供登录校验，返回含哈希的内部记录。 */
  getUserByUsername(username: string): Promise<UserWithPassword | null>

  /** 按 id 查找公开用户信息。 */
  getUserById(id: number): Promise<User | null>

  /** 用户的主题数 / 回复数（个人页统计一次查询完成，不需要拉全量列表）。 */
  getUserStats(userId: number): Promise<UserStats>

  /**
   * 论坛主（最早注册的账户）的 id：取最小用户 id。
   * 论坛主身份不落库、不受 is_admin 影响；空库返回 null。
   */
  getOwnerId(): Promise<number | null>

  /** 由论坛主指定 / 取消管理员。目标用户不存在时返回 USER_NOT_FOUND。 */
  setUserAdmin(userId: number, isAdmin: boolean): Promise<Result<User, 'USER_NOT_FOUND'>>

  // ---------- 主题 / 回复 ----------

  /** 主题列表（游标分页；sort=newest 按发布时间，active 按最后回复时间）。 */
  listTopics(query?: ListTopicsQuery): Promise<Page<Topic>>

  /** 主题详情（含一页回复，回复从新到旧分页）。主题不存在时返回 null。 */
  getTopicDetail(query: GetTopicDetailQuery): Promise<TopicDetail | null>

  /** 主题概览（不含回复）：删除前的权限判定与确认页展示用；不存在时返回 null。 */
  getTopicById(topicId: number): Promise<Topic | null>

  /** 发帖。作者来自传入的登录用户；作者已不存在时返回 AUTHOR_NOT_FOUND。 */
  createTopic(user: User, input: NewTopicInput): Promise<Result<Topic, 'AUTHOR_NOT_FOUND'>>

  /** 单条回复（含父回复信息）；不存在时返回 null。用于校验嵌套回复目标。 */
  getReplyById(replyId: number): Promise<Reply | null>

  /** 回复。主题不存在时返回 TOPIC_NOT_FOUND；作者已不存在时返回 AUTHOR_NOT_FOUND。 */
  createReply(
    user: User,
    topicId: number,
    input: NewReplyInput,
  ): Promise<Result<Reply, 'TOPIC_NOT_FOUND' | 'AUTHOR_NOT_FOUND'>>

  /**
   * 删除主题，连同其全部回复。此方法不做权限判定（由服务层负责）；
   * 主题不存在时返回 TOPIC_NOT_FOUND。
   */
  deleteTopic(topicId: number): Promise<Result<{ id: number }, 'TOPIC_NOT_FOUND'>>

  /**
   * 置顶 / 取消置顶。不做权限判定（由路由层校验管理员身份）；
   * 主题不存在时返回 TOPIC_NOT_FOUND。
   */
  setTopicPinned(topicId: number, pinned: boolean): Promise<Result<Topic, 'TOPIC_NOT_FOUND'>>

  /**
   * 设为 / 取消公告。
   *
   * 设为公告时同时写入一条指向该主题的公告记录（link 指向主题详情），
   * 取消时删除该公告记录；因此重复调用是幂等的。
   * 主题不存在时返回 TOPIC_NOT_FOUND。
   */
  setTopicAnnouncement(topicId: number, value: boolean): Promise<Result<Topic, 'TOPIC_NOT_FOUND'>>

  /** 首页置顶区块：只返回置顶主题，最新在前。 */
  listPinnedTopics(limit?: number): Promise<Topic[]>

  // ---------- 个人页 ----------

  /** 某用户发布的主题（游标分页）。 */
  listTopicsByAuthor(query: ListByAuthorQuery): Promise<Page<Topic>>

  /** 某用户的回复（游标分页，附带所在主题标题，避免逐条查询主题）。 */
  listRepliesByAuthor(query: ListByAuthorQuery): Promise<Page<ReplyWithTopic>>

  // ---------- 通知与公告 ----------

  /**
   * 通知或公告列表（游标分页，从新到旧）。
   *
   * - kind = 'notification' 时只返回 user_id 指向该用户的通知；
   * - kind = 'announcement' 时返回所有公告（user_id IS NULL）；
   * - 每条记录都带相对该用户的 read 状态。
   */
  listNotifications(query: ListNotificationsQuery): Promise<Page<Notification>>

  /** 该用户的未读数量（定向通知与公告分开统计）。 */
  countUnreadNotifications(userId: number): Promise<UnreadCounts>

  /**
   * 该用户尚未读过的公告，最新的在前。
   *
   * 供「访问页面时弹出新公告」使用：弹窗展示后立刻把公告标记为已读，
   * 所以同一条公告只会出现在这里一次。
   *
   * 刻意不设条数上限：弹窗展示的条数必须与随后标记已读的条数完全一致，
   * 否则会出现「没展示过却被标记已读」。公告只能由管理员发布，总量可控。
   */
  listUnreadAnnouncements(userId: number): Promise<Notification[]>

  /**
   * 把该用户当前可见的某类通知全部标记为已读。
   * 返回本次新增的已读记录数；重复调用不会重复计数。
   */
  markNotificationsRead(userId: number, kind: NotificationKind): Promise<number>

  /**
   * 新建一条通知或公告。
   *
   * - kind = 'notification' 时必须提供 userId，否则返回 NOTIFICATION_TARGET_REQUIRED；
   * - kind = 'announcement' 时忽略 userId，一律写成全体可见。
   */
  createNotification(
    input: NewNotificationInput,
  ): Promise<Result<Notification, 'NOTIFICATION_TARGET_REQUIRED' | 'USER_NOT_FOUND'>>
}

export interface ListNotificationsQuery {
  userId: number
  kind: NotificationKind
  cursor?: string | null
  limit?: number
}
