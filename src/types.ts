/**
 * 论坛领域模型。
 * 页面、API、服务层与两种存储实现（内存 / D1）共用这些类型，避免各层私自漂移。
 *
 * 用户体系约定：
 * - 帖子/回复通过 authorId 关联用户，展示层用解析后的 author 名字；
 * - authorId 允许为 null（历史数据或用户被删除后显示「匿名」）；
 * - isAdmin 为「论坛主指定的管理员」标记；论坛主本身 = 最早注册的账户
 *   （运行时由存储层判定，不落库），可删除任意主题并指定管理员；
 * - passwordHash 只存在于数据库内部记录 UserWithPassword 中，
 *   任何返回给客户端的结果都不得携带该字段。
 *
 * 分页约定（P1 重构）：
 * - 所有列表以「游标分页」返回 Page<T>：items 为当前页，向更旧方向翻页用 nextCursor，
 *   向更新方向翻页用 prevCursor；游标是不透明字符串，由存储实现自行编码/解析；
 * - 列表内部的排序统一为「从新到旧」，展示层需要时间正序时自行反转当前页。
 */

/** 对外可公开的用户信息 */
export interface User {
  id: number
  username: string
  createdAt: string
  /**
   * 是否为由论坛主指定的管理员。
   * 论坛主（最早注册的账户）不依赖该字段，由存储层 getOwnerId() 运行时判定。
   */
  isAdmin: boolean
}

/** 存储层内部使用的用户记录（含密码哈希） */
export interface UserWithPassword extends User {
  passwordHash: string
}

/** 发帖可选字体标识；可用项与 CSS 类见 src/fonts/post-fonts.ts */
export type PostFontId = 'default' | 'wqy-bitmap-song'

export interface Topic {
  id: number
  title: string
  content: string
  /** 帖子使用的字体；历史数据为 'default' */
  font: PostFontId
  authorId: number | null
  /** 解析后的作者名，无作者时显示「匿名」 */
  author: string
  createdAt: string
  replyCount: number
  /** 最后活动时间：无回复时等于 createdAt；用于「最近回复」排序 */
  lastActivityAt: string
  /** 置顶：首页顶部单独展示，不参与游标分页排序 */
  pinned: boolean
  /** 已设为站内公告：同时出现在公告页 */
  isAnnouncement: boolean
  /** 该主题的图片数量；列表页据此决定是否显示图片角标 */
  imageCount: number
  /** position 最小的一张图片 id，供列表页取缩略图；无图时为 null */
  firstImageId: number | null
}

export interface Reply {
  id: number
  topicId: number
  authorId: number | null
  author: string
  content: string
  createdAt: string
  /** 被回复的回复 ID；顶层回复为 null 或缺省 */
  parentReplyId?: number | null
  /** 被回复作者的显示名；父回复不存在时为 null（如被回复的楼层不在当前页） */
  parentAuthor?: string | null
}

/** 回复表单当前指向的目标评论（「回复 @某人」）。 */
export interface ReplyTarget {
  /** 被回复的回复 ID */
  id: number
  /** 被回复作者的显示名 */
  author: string
}

/** 个人页「最近回复」使用：附带所在主题标题（主题缺失时为 null） */
export interface ReplyWithTopic extends Reply {
  topicTitle: string | null
}

export interface PostImage {
  id: number
  topicId: number
  /** 图片字节，仅 getById 读取详情时加载 */
  data?: Uint8Array
  contentType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
  byteSize: number
  width: number
  height: number
  position: number
  createdAt: string
}

export interface TopicDetail extends Topic {
  /** 帖子图片按 position 升序；旧存储实现未附加时由路由补齐。 */
  images?: PostImage[]
  /** 回复分页：items 为「从新到旧」的一页 */
  replies: Page<Reply>
}

/** 新建帖子输入。作者不再由表单提供，一律取自当前登录会话。 */
export interface NewTopicInput {
  title: string
  content: string
  /** 省略或无法识别时按默认字体处理 */
  font?: PostFontId
}

/** 新建回复输入。作者一律取自当前登录会话。 */
export interface NewReplyInput {
  content: string
  /** 评论某条评论时传入目标回复 ID；普通回帖省略或传 null */
  parentReplyId?: number | null
}

/** 主题列表排序：newest=最新发布；active=最近回复 */
export type TopicSort = 'newest' | 'active'

/** 游标分页的通用结果 */
export interface Page<T> {
  items: T[]
  /** 向更旧方向继续翻页的游标；已到末尾为 null */
  nextCursor: string | null
  /** 向更新方向翻页的游标；已到最新端为 null */
  prevCursor: string | null
}

/** 显式结果类型：存储层与服务层用它代替「null 同时表示多种失败」的写法 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

/** 通知类别：notification 为定向通知（有接收者），announcement 为全体可见公告 */
export type NotificationKind = 'notification' | 'announcement'

/**
 * 通知与公告。
 *
 * - 定向通知的 userId 指向接收者；公告的 userId 为 null，所有登录用户可见；
 * - read 是「相对查询用户」的已读状态，不属于数据行本身，由存储层结合已读表得出；
 * - link 为站内相对地址，可为空。
 */
export interface Notification {
  id: number
  kind: NotificationKind
  userId: number | null
  title: string
  body: string
  link: string | null
  /** 由主题转化而来的公告指向该主题；手工发布的公告为 null */
  topicId: number | null
  createdAt: string
  read: boolean
}

/** 新建通知 / 公告的输入 */
export interface NewNotificationInput {
  kind: NotificationKind
  /** 定向通知必填；公告应省略或传 null */
  userId?: number | null
  title: string
  body: string
  link?: string | null
  /** 仅「主题设为公告」使用；手工发布的公告省略 */
  topicId?: number | null
}

/** 未读数量，供导航红点使用 */
export interface UnreadCounts {
  notifications: number
  announcements: number
  total: number
}
