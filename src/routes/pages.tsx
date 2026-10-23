import { Hono } from 'hono'
import type { ForumStore } from '../db/store'
import type { Env } from '../env'
import { defaultWordFilter, type BannedWordMatch, type WordFilter } from '../moderation/word-filter'
import {
  MAX_POST_IMAGES,
  MAX_UPLOAD_BODY_BYTES,
  PREVIEW_LIMIT,
  collectImageFiles,
  validateImages,
} from '../uploads/image-validation'
import {
  createPostImageRepository,
  deleteTopicImages,
  storeTopicImages,
} from '../uploads/post-images'
import { deletePreviewsByTopic, getPreview, savePreviews } from '../uploads/post-previews'
import type { NotificationKind, ReplyTarget, Topic, TopicDetail, TopicSort, User } from '../types'
import { HomePage } from '../views/home'
import { NewTopicPage } from '../views/new-topic'
import { TopicPage } from '../views/topic'
import { LoginPage, RegisterPage } from '../views/auth'
import { ProfilePage } from '../views/profile'
import { ConfirmDeletePage } from '../views/delete-topic'
import { NotificationsPage } from '../views/notifications'
import { css as FORUM_CSS } from '../views/layout'
import { cursorHref, type PaginationLinks } from '../views/pagination'
import { createAuthService } from '../services/auth'
import { createForumService } from '../services/forum'
import { createProfileService } from '../services/profile'
import { createAdminService } from '../services/admin'
import { endSession, getCurrentUser, safeNext, startSession, type AppContext } from '../utils/session'
import { csrfToken } from '../middleware/csrf'
import { rateLimit } from '../middleware/rate-limit'
import { toPostFontId } from '../fonts/post-fonts'
import { parseReplyId, parseTopicId, parseUserId } from '../utils/validate'
import { formatTime } from '../utils/time'

/**
 * 页面路由（P1：薄编排层）。
 * 每个处理函数只做四件事：
 * 1. 解析路径 / 查询参数 / 表单；
 * 2. 调用 src/services/* 的统一用例；
 * 3. 把领域错误映射为页面错误或状态码；
 * 4. 设置 Cookie、重定向或渲染页面。
 * 业务规则（校验、权限、分页）全部在服务层与存储层，页面和 API 不再各写一遍。
 */

/** 需要登录的页面统一入口（会话读写属于 HTTP 层，留在路由） */
type RequireUserResult = { ok: true; user: User } | { ok: false; response: Response }

async function requireUser(c: AppContext, store: ForumStore): Promise<RequireUserResult> {
  const user = await getCurrentUser(c, store)
  if (!user) {
    const next = new URL(c.req.url).pathname
    return { ok: false, response: c.redirect(`/login?next=${encodeURIComponent(next)}`) }
  }
  return { ok: true, user }
}

/** 分层限流配置：不同写操作各自独立计数，避免互相挤占配额 */
const LOGIN_LIMIT = { scope: 'login', windowSeconds: 15 * 60, max: 10 }
const REGISTER_LIMIT = { scope: 'register', windowSeconds: 60 * 60, max: 5 }
const TOPIC_CREATE_LIMIT = { scope: 'topic-create', windowSeconds: 60 * 60, max: 20 }
const REPLY_CREATE_LIMIT = { scope: 'reply-create', windowSeconds: 60 * 60, max: 60 }
const TOPIC_DELETE_LIMIT = { scope: 'topic-delete', windowSeconds: 60 * 60, max: 30 }
const ADMIN_TOGGLE_LIMIT = { scope: 'admin-toggle', windowSeconds: 60 * 60, max: 30 }
const TOPIC_MANAGE_LIMIT = { scope: 'topic-manage', windowSeconds: 60 * 60, max: 60 }
const ANNOUNCE_LIMIT = { scope: 'announce', windowSeconds: 60 * 60, max: 30 }

/** 分页大小：首页主题与主题内回复各 20 条一页 */
const TOPIC_PAGE_SIZE = 20

/** 通知 / 公告每页条数 */
const NOTIFICATION_PAGE_SIZE = 20
const REPLY_PAGE_SIZE = 20

/** 首页置顶区块最多展示条数（置顶项不参与游标分页） */
const PINNED_TOPIC_LIMIT = 5

/** 首页排序：默认最新发布；sort=active 为最近回复（排序 UI 属 P2，先把参数打通） */
function parseSort(raw: string | undefined): TopicSort {
  return raw === 'active' ? 'active' : 'newest'
}

export interface PageRouteOptions {
  /** 违禁词过滤器；默认使用 src/moderation/banned-words.ts 中的词库。 */
  wordFilter?: WordFilter
}

export function pageRoutes(
  store: ForumStore,
  options: PageRouteOptions = {},
): Hono<{ Bindings: Env }> {
  const pages = new Hono<{ Bindings: Env }>()
  const auth = createAuthService(store)
  const forum = createForumService(store)
  const wordFilter = options.wordFilter ?? defaultWordFilter
  const profiles = createProfileService(store)
  const admin = createAdminService(store)

  /** 主题详情页元素：回复分页链接在此统一生成 */
  const topicPageElement = (
    c: AppContext,
    topic: TopicDetail,
    user: User | null,
    replyErrors: string[],
    replyContent: string,
    bannedWords: BannedWordMatch[],
    repliesCursor: string | null,
    canDelete: boolean,
    replyTarget: ReplyTarget | null = null,
    canManage: boolean = false,
  ) => {
    const base = `/topics/${topic.id}`
    const replies = topic.replies
    const links: PaginationLinks = {
      newerHref: cursorHref(base, 'rc', replies.prevCursor),
      olderHref: cursorHref(base, 'rc', replies.nextCursor),
      latestHref: repliesCursor ? base : null,
    }
    return (
      <TopicPage
        topic={topic}
        user={user}
        replyErrors={replyErrors}
        replyContent={replyContent}
        bannedWords={bannedWords}
        csrf={csrfToken(c)}
        canDelete={canDelete}
        canManage={canManage}
        repliesPagination={links}
        replyTarget={replyTarget}
      />
    )
  }

  const renderProfile = async (c: AppContext, userId: number, current: User | null) => {
    const result = await profiles.getProfilePageData({ userId })
    if (!result.ok) return c.notFound()
    const data = result.value
    const [ownerId, canManageAdmins] = await Promise.all([
      admin.getOwnerId(),
      admin.canManageAdmins(current),
    ])
    return c.html(
      <ProfilePage
        profile={data.profile}
        isSelf={current !== null && current.id === userId}
        currentUser={current}
        ownerId={ownerId}
        canManageAdmins={canManageAdmins}
        stats={data.stats}
        topics={data.topics}
        replies={data.replies}
        csrf={csrfToken(c)}
      />,
    )
  }

  // ---------- 静态样式 ----------
  // 样式表以同源静态资源提供，配合 CSP 的 style-src 'self'，无需再放开 'unsafe-inline'
  pages.get('/assets/forum.css', (c) =>
    c.body(FORUM_CSS, 200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    }),
  )

  // ---------- 首页（游标分页：tc=向更旧/更新方向的游标） ----------
  pages.get('/', async (c) => {
    const cursor = c.req.query('tc') ?? null
    const sort = parseSort(c.req.query('sort'))
    // 置顶主题只在第一页展示：翻页时不再重复出现，避免与主列表错位
    const [page, user, pinnedTopics] = await Promise.all([
      forum.listTopics({ cursor, limit: TOPIC_PAGE_SIZE, sort }),
      getCurrentUser(c, store),
      cursor === null ? forum.listPinnedTopics(PINNED_TOPIC_LIMIT) : Promise.resolve([] as Topic[]),
    ])
    const extra = { sort: sort === 'active' ? 'active' : undefined }
    // 置顶项已在顶部区块单独展示，第一页主列表里去掉它们，避免同一条主题出现两次。
    // 只在第一页做过滤：游标仍由存储层基于完整结果集生成，翻页不会错位。
    const pinnedIds = new Set(pinnedTopics.map((t) => t.id))
    const topics = cursor === null ? page.items.filter((t) => !pinnedIds.has(t.id)) : page.items
    return c.html(
      <HomePage
        topics={topics}
        pinnedTopics={pinnedTopics}
        user={user}
        csrf={csrfToken(c)}
        pagination={{
          newerHref: cursorHref('/', 'tc', page.prevCursor, extra),
          olderHref: cursorHref('/', 'tc', page.nextCursor, extra),
          latestHref: cursor ? '/' : null,
        }}
      />,
    )
  })

  // ---------- 注册 ----------
  pages.get('/register', async (c) => {
    const user = await getCurrentUser(c, store)
    if (user) return c.redirect('/')
    return c.html(
      <RegisterPage
        user={null}
        errors={[]}
        next={c.req.query('next') ?? undefined}
        csrf={csrfToken(c)}
      />,
    )
  })

  pages.post('/register', rateLimit(REGISTER_LIMIT), async (c) => {
    const body = await c.req.parseBody()
    const username = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : ''
    const next = typeof body.next === 'string' ? body.next : undefined

    const result = await auth.register({ username, password, confirmPassword })
    if (result.ok) {
      await startSession(c, result.value)
      return c.redirect(safeNext(next))
    }

    if (result.error.code === 'USERNAME_TAKEN') {
      return c.html(
        <RegisterPage
          user={null}
          errors={['该用户名已被注册，换一个试试']}
          username={username}
          next={next}
          csrf={csrfToken(c)}
        />,
        409,
      )
    }
    return c.html(
      <RegisterPage
        user={null}
        errors={result.error.errors}
        username={username}
        next={next}
        csrf={csrfToken(c)}
      />,
      400,
    )
  })

  // ---------- 登录 / 登出 ----------
  pages.get('/login', async (c) => {
    const user = await getCurrentUser(c, store)
    if (user) return c.redirect('/')
    return c.html(
      <LoginPage
        user={null}
        errors={[]}
        next={c.req.query('next') ?? undefined}
        csrf={csrfToken(c)}
      />,
    )
  })

  pages.post('/login', rateLimit(LOGIN_LIMIT), async (c) => {
    const body = await c.req.parseBody()
    const username = typeof body.username === 'string' ? body.username : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const next = typeof body.next === 'string' ? body.next : undefined

    const result = await auth.login({ username, password })
    if (result.ok) {
      await startSession(c, result.value)
      return c.redirect(safeNext(next))
    }

    if (result.error.code === 'INVALID_CREDENTIALS') {
      return c.html(
        <LoginPage
          user={null}
          errors={['用户名或密码错误']}
          username={username}
          next={next}
          csrf={csrfToken(c)}
        />,
        401,
      )
    }
    return c.html(
      <LoginPage user={null} errors={result.error.errors} username={username} next={next} csrf={csrfToken(c)} />,
      400,
    )
  })

  pages.post('/logout', async (c) => {
    endSession(c)
    return c.redirect('/')
  })

  // ---------- 个人页 ----------
  pages.get('/me', async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.redirect('/login?next=/me')
    return renderProfile(c, user.id, user)
  })

  pages.get('/users/:id', async (c) => {
    const id = parseUserId(c.req.param('id'))
    if (id === null) return c.notFound()
    const current = await getCurrentUser(c, store)
    return renderProfile(c, id, current)
  })

  // ---------- 发新帖 ----------
  pages.get('/topics/new', async (c) => {
    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response
    return c.html(<NewTopicPage user={authResult.user} errors={[]} values={{}} csrf={csrfToken(c)} />)
  })

  pages.post('/topics/new', rateLimit(TOPIC_CREATE_LIMIT), async (c) => {
    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response

    const env = c.env as Env

    // 生产环境强制 HTTPS：图片不能在明文连接上提交。
    if (env.ENVIRONMENT === 'production') {
      const forwardedProto = c.req.header('x-forwarded-proto')
      const protocol = forwardedProto
        ? forwardedProto.split(',')[0].trim().toLowerCase()
        : new URL(c.req.url).protocol.replace(':', '')
      if (protocol !== 'https') {
        return c.html(
          <NewTopicPage
            user={authResult.user}
            errors={['图片上传仅支持通过 HTTPS 访问，请改用安全连接后重试']}
            values={{ title: '', content: '' }}
            csrf={csrfToken(c)}
          />,
          403,
        )
      }
    }

    // 整体请求体上限：先按 Content-Length 拦截，避免把超大 body 读入内存。
    const declaredLength = Number(c.req.header('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BODY_BYTES) {
      return c.html(
        <NewTopicPage
          user={authResult.user}
          errors={['上传内容过大，请减少图片数量或压缩后重试']}
          values={{ title: '', content: '' }}
          csrf={csrfToken(c)}
        />,
        413,
      )
    }

    const body = await c.req.parseBody()
    const title = typeof body.title === 'string' ? body.title : ''
    const content = typeof body.content === 'string' ? body.content : ''
    const font = toPostFontId(body.font)

    // 违禁词检查：命中即阻止发布，不创建帖子、不处理图片。
    // 保留已填写的标题与正文，用户只需修改被标记的内容再提交。
    const bannedWords = wordFilter.check({ title, content })
    if (bannedWords.length > 0) {
      return c.html(
        <NewTopicPage
          user={authResult.user}
          errors={[]}
          bannedWords={bannedWords}
          values={{ title, content, font }}
          csrf={csrfToken(c)}
        />,
        400,
      )
    }

    const form = await c.req.formData()
    const imageFiles = collectImageFiles(form)
    // 缩略图由 public/js/image-preview.js 在提交前生成，与图片按下标一一对应。
    const previewFiles = collectImageFiles(form, ['previews', 'preview'])

    // 实际字节数兜底：Content-Length 可能缺失或与实际不符。
    const totalImageBytes = imageFiles.reduce((sum, file) => sum + file.size, 0)
    if (totalImageBytes > MAX_UPLOAD_BODY_BYTES) {
      return c.html(
        <NewTopicPage
          user={authResult.user}
          errors={['上传内容过大，请减少图片数量或压缩后重试']}
          values={{ title, content }}
          csrf={csrfToken(c)}
        />,
        413,
      )
    }

    if (imageFiles.length > 0 && !env.DB) {
      return c.html(
        <NewTopicPage
          user={authResult.user}
          errors={['当前环境未启用数据库，无法上传图片']}
          values={{ title, content }}
          csrf={csrfToken(c)}
        />,
        400,
      )
    }

    const validated = await validateImages(imageFiles.slice(0, MAX_POST_IMAGES + 1))
    if (!validated.ok) {
      return c.html(
        <NewTopicPage
          user={authResult.user}
          errors={validated.errors}
          values={{ title, content }}
          csrf={csrfToken(c)}
        />,
        400,
      )
    }

    // 缩略图必须与图片数量一致；数量不符时整批放弃，避免缩略图错配到别的图片上。
    // 校验失败不回退发帖：图片本身仍然有效，只是没有缩略图。
    const validatedPreviews =
      previewFiles.length > 0 && previewFiles.length === validated.value.length
        ? await validateImages(previewFiles.slice(0, MAX_POST_IMAGES), PREVIEW_LIMIT, '缩略图')
        : null

    const result = await forum.createTopic(authResult.user, { title, content, font })
    if (result.ok) {
      if (validated.value.length > 0) {
        try {
          const storedImages = await storeTopicImages(store, env, result.value.id, validated.value)
          if (validatedPreviews?.ok) {
            try {
              // storeTopicImages 按输入顺序返回，缩略图因此可以用同一个下标配对。
              await savePreviews(
                store,
                env,
                storedImages.map((image, index) => ({
                  topicId: result.value.id,
                  imageId: image.id,
                  image: validatedPreviews.value[index] ?? null,
                })),
              )
            } catch {
              // 缩略图只是优化项：写失败不应连累已经成功的图片与帖子。
            }
          }
        } catch {
          // 图片写入失败时回滚刚创建的主题，避免留下没有配图的半成品
          await forum.deleteTopic(authResult.user, result.value.id)
          return c.html(
            <NewTopicPage
              user={authResult.user}
              errors={['图片上传失败，请重新选择后再试']}
              values={{ title, content }}
              csrf={csrfToken(c)}
            />,
            500,
          )
        }
      }
      return c.redirect(`/topics/${result.value.id}`)
    }

    if (result.error.code === 'VALIDATION_FAILED') {
      // 回填用户已输入的内容，避免报错后要重打一遍
      return c.html(
        <NewTopicPage
          user={authResult.user}
          errors={result.error.errors}
          values={{ title, content }}
          csrf={csrfToken(c)}
        />,
        400,
      )
    }
    // AUTHOR_NOT_FOUND：会话对应的用户已被删除，重新登录
    return c.text('会话已失效，请重新登录', 401)
  })

  // ---------- 通知与公告（需登录） ----------
  pages.get('/notifications', async (c) => {
    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response
    const user = authResult.user

    const tab: NotificationKind =
      c.req.query('tab') === 'announcements' ? 'announcement' : 'notification'
    const cursor = c.req.query('cursor') ?? null
    const tabQuery = tab === 'announcement' ? { tab: 'announcements' } : undefined
    const firstPageHref =
      tab === 'announcement' ? '/notifications?tab=announcements' : '/notifications'

    // 顺序很重要：先取未读数量与列表（页面需要标出哪些是新的），再标记已读。
    const counts = await store.countUnreadNotifications(user.id)
    const page = await store.listNotifications({
      userId: user.id,
      kind: tab,
      cursor,
      limit: NOTIFICATION_PAGE_SIZE,
    })
    await store.markNotificationsRead(user.id, tab)

    // 本次访问的标签已视为读过，导航红点只反映另一个标签剩下的未读
    const unreadTotal = tab === 'notification' ? counts.announcements : counts.notifications
    // 只有论坛主与管理员能看到发布公告表单；无权限时该区域不渲染
    const canPostAnnouncement = await forum.canManageTopics(user)

    return c.html(
      <NotificationsPage
        currentUser={user}
        csrf={csrfToken(c)}
        tab={tab}
        page={page}
        counts={counts}
        unreadTotal={unreadTotal}
        canPostAnnouncement={canPostAnnouncement}
        links={{
          newerHref: cursorHref('/notifications', 'cursor', page.prevCursor, tabQuery),
          olderHref: cursorHref('/notifications', 'cursor', page.nextCursor, tabQuery),
          latestHref: cursor ? firstPageHref : null,
        }}
      />,
    )
  })

  /**
   * 发布公告（仅论坛主与管理员）。
   *
   * 成功即回到公告标签页；校验失败则在原页回填已填内容并提示，
   * 与发帖 / 回帖的错误处理保持一致。权限不足直接 403，不渲染表单。
   */
  pages.post('/notifications/announce', rateLimit(ANNOUNCE_LIMIT), async (c) => {
    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response
    const user = authResult.user

    const body = await c.req.parseBody()
    const title = typeof body.title === 'string' ? body.title : ''
    const content = typeof body.body === 'string' ? body.body : ''

    const result = await forum.publishAnnouncement(user, { title, body: content })
    if (result.ok) return c.redirect('/notifications?tab=announcements')
    if (result.error.code === 'FORBIDDEN') return c.text('只有论坛主或管理员可以发布公告', 403)

    const counts = await store.countUnreadNotifications(user.id)
    const page = await store.listNotifications({
      userId: user.id,
      kind: 'announcement',
      limit: NOTIFICATION_PAGE_SIZE,
    })
    return c.html(
      <NotificationsPage
        currentUser={user}
        csrf={csrfToken(c)}
        tab="announcement"
        page={page}
        counts={counts}
        unreadTotal={counts.notifications}
        canPostAnnouncement
        announceErrors={result.error.errors}
        announceValues={{ title, body: content }}
        links={{
          newerHref: null,
          olderHref: null,
          latestHref: '/notifications?tab=announcements',
        }}
      />,
      400,
    )
  })

  // 导航红点用的轻量接口：只返回未读数量，不返回任何通知内容。
  // 未登录一律返回 0，避免把未登录状态与「无未读」区分开而泄露信息。
  pages.get('/api/notifications/unread', async (c) => {
    const user = await getCurrentUser(c, store)
    if (user === null) {
      return c.json({ notifications: 0, announcements: 0, total: 0 }, 200, {
        'cache-control': 'no-store',
      })
    }
    const counts = await store.countUnreadNotifications(user.id)
    return c.json(counts, 200, { 'cache-control': 'no-store' })
  })

  // 公告弹窗：返回该用户尚未读过的公告（最新的在前）。只读接口，不产生副作用。
  // 未登录或没有新公告时返回空数组，前端据此决定不弹窗。
  pages.get('/api/announcements/unread', async (c) => {
    const user = await getCurrentUser(c, store)
    if (user === null) {
      return c.json({ announcements: [] }, 200, { 'cache-control': 'no-store' })
    }
    const unread = await store.listUnreadAnnouncements(user.id)
    return c.json(
      {
        announcements: unread.map((item) => ({
          id: item.id,
          title: item.title,
          body: item.body,
          link: item.link,
          createdAt: item.createdAt,
          createdAtText: formatTime(item.createdAt),
        })),
      },
      200,
      { 'cache-control': 'no-store' },
    )
  })

  // 公告弹窗展示后标记已读：同一条公告不会再弹第二次。
  // 未登录返回 401；CSRF 由全局中间件校验（脚本从 forum_csrf cookie 读取令牌）。
  pages.post('/api/announcements/read', async (c) => {
    const user = await getCurrentUser(c, store)
    if (user === null) {
      return c.json({ ok: false, error: 'UNAUTHORIZED' }, 401, {
        'cache-control': 'no-store',
      })
    }
    await store.markNotificationsRead(user.id, 'announcement')
    return c.json({ ok: true }, 200, { 'cache-control': 'no-store' })
  })

  // ---------- 主题详情 / 回复 ----------
  pages.get('/topics/:id', async (c) => {
    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.notFound()
    const repliesCursor = c.req.query('rc') ?? null
    const [detail, user] = await Promise.all([
      forum.getTopicDetail({ topicId: id, repliesCursor, repliesLimit: REPLY_PAGE_SIZE }),
      getCurrentUser(c, store),
    ])
    if (!detail.ok) return c.notFound()
    const topicImages = await createPostImageRepository(store, c.env as Env).listByTopic(id)
    const topicWithImages = { ...detail.value, images: topicImages }
    const [canDelete, canManage] = await Promise.all([
      forum.canDeleteTopic(user, topicWithImages),
      forum.canManageTopics(user),
    ])
    const replyTarget = await resolveReplyTarget(store, id, c.req.query('replyTo'))
    return c.html(
      topicPageElement(
        c,
        topicWithImages,
        user,
        [],
        '',
        [],
        repliesCursor,
        canDelete,
        replyTarget,
        canManage,
      ),
    )
  })

  // ---------- 置顶 / 设为公告（仅论坛主与管理员） ----------

  /**
   * 置顶与公告开关的共同实现。
   *
   * 表单用隐藏字段 value 提交目标状态（'1' 打开、其他关闭），因此同一个入口
   * 既能开启也能关闭；CSRF 由全局中间件校验，这里不再重复。
   */
  const handleTopicFlag = async (
    c: AppContext,
    flag: 'pinned' | 'announcement',
  ): Promise<Response> => {
    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.notFound()

    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response

    const body = await c.req.parseBody()
    const next = body.value === '1'
    const result =
      flag === 'pinned'
        ? await forum.setTopicPinned(authResult.user, id, next)
        : await forum.setTopicAnnouncement(authResult.user, id, next)

    if (!result.ok) {
      if (result.error.code === 'FORBIDDEN') return c.text('只有论坛主或管理员可以操作', 403)
      return c.notFound()
    }
    return c.redirect(`/topics/${id}`)
  }

  pages.post('/topics/:id/pin', rateLimit(TOPIC_MANAGE_LIMIT), (c) => handleTopicFlag(c, 'pinned'))

  pages.post('/topics/:id/announce', rateLimit(TOPIC_MANAGE_LIMIT), (c) =>
    handleTopicFlag(c, 'announcement'),
  )

  pages.post('/topics/:id/reply', rateLimit(REPLY_CREATE_LIMIT), async (c) => {
    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.notFound()

    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response

    const body = await c.req.parseBody()
    const content = typeof body.content === 'string' ? body.content : ''
    // 嵌套回复：表单用 parentReplyId 指向被回复的楼层；非法值由服务层拒绝。
    const parentRaw = typeof body.parentReplyId === 'string' ? body.parentReplyId : ''
    const replyTarget = await resolveReplyTarget(store, id, parentRaw)

    // 回帖与发帖共用同一份词库：命中即拒绝写入，并在原页面弹窗说明。
    const bannedWords = wordFilter.check({ content })
    if (bannedWords.length > 0) {
      const detail = await forum.getTopicDetail({ topicId: id, repliesLimit: REPLY_PAGE_SIZE })
      if (!detail.ok) return c.notFound()
      const [canDelete, canManage] = await Promise.all([
        forum.canDeleteTopic(authResult.user, detail.value),
        forum.canManageTopics(authResult.user),
      ])
      return c.html(
        topicPageElement(
          c,
          detail.value,
          authResult.user,
          [],
          content,
          bannedWords,
          null,
          canDelete,
          replyTarget,
          canManage,
        ),
        400,
      )
    }

    const result = await forum.createReply(authResult.user, id, {
      content,
      parentReplyId: parentRaw,
    })
    if (result.ok) {
      const parentReplyId = result.value.parentReplyId ?? null
      if (parentReplyId === null) {
        await notifyTopicAuthor(store, id, authResult.user, content, result.value.id)
      } else {
        await notifyReplyAuthor(store, id, parentReplyId, authResult.user, content)
      }
      return c.redirect(`/topics/${id}`)
    }

    if (result.error.code === 'VALIDATION_FAILED') {
      // 错误回显需要重新取主题（首屏回复分页）
      const detail = await forum.getTopicDetail({ topicId: id, repliesLimit: REPLY_PAGE_SIZE })
      if (!detail.ok) return c.notFound()
      const canDelete = await forum.canDeleteTopic(authResult.user, detail.value)
      return c.html(
        topicPageElement(
          c,
          detail.value,
          authResult.user,
          result.error.errors,
          content,
          [],
          null,
          canDelete,
          replyTarget,
        ),
        400,
      )
    }
    if (result.error.code === 'TOPIC_NOT_FOUND') return c.notFound()
    // AUTHOR_NOT_FOUND
    return c.text('会话已失效，请重新登录', 401)
  })

  // ---------- 删除主题（确认页 GET + 执行 POST；作者 / 管理员 / 论坛主） ----------
  pages.get('/topics/:id/delete', async (c) => {
    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.notFound()

    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response

    const topic = await forum.getTopicById(id)
    if (!topic) return c.notFound()
    if (!(await forum.canDeleteTopic(authResult.user, topic))) {
      return c.text('没有权限删除该帖子', 403)
    }
    return c.html(<ConfirmDeletePage topic={topic} user={authResult.user} csrf={csrfToken(c)} />)
  })

  pages.post('/topics/:id/delete', rateLimit(TOPIC_DELETE_LIMIT), async (c) => {
    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.notFound()

    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response

    const deleteEnv = c.env as Env
    const topicImages = await createPostImageRepository(store, deleteEnv).listByTopic(id)
    const result = await forum.deleteTopic(authResult.user, id)
    if (result.ok) {
      // 缩略图必须在 post_images 记录之前清理。
      await deletePreviewsByTopic(store, deleteEnv, id)
      await deleteTopicImages(store, deleteEnv, id, topicImages)
      return c.redirect('/')
    }
    if (result.error.code === 'NOT_FOUND') return c.notFound()
    return c.text('没有权限删除该帖子', 403)
  })

  // ---------- 帖子图片（同源只读访问） ----------
  pages.get('/media/posts/:id', async (c) => {
    const imageId = parseImageId(c.req.param('id'))
    if (imageId === null) return c.notFound()

    const env = c.env as Env

    const image = await createPostImageRepository(store, env).getById(imageId)
    if (!image) return c.notFound()

    if (!image.data) return c.notFound()

    const headers = new Headers()
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Content-Disposition', 'inline')

    // 缩略图由客户端在上传时生成。缺失时回退原图，保证该 URL 始终可渲染，
    // 旧数据也因此不需要回填。ETag 带 preview 前缀，避免两种表示互相污染缓存。
    if (c.req.query('size') === 'preview') {
      const preview = await getPreview(store, env, imageId)
      if (preview) {
        headers.set('Content-Type', preview.contentType)
        headers.set('ETag', `"post-image-preview-${imageId}-${preview.byteSize}"`)
        return new Response(preview.data, { headers })
      }
    }

    headers.set('Content-Type', image.contentType)
    headers.set('ETag', `"post-image-${image.id}-${image.byteSize}"`)

    return new Response(image.data, { headers })
  })

  // ---------- 指定 / 取消管理员（仅论坛主） ----------
  pages.post('/users/:id/admin', rateLimit(ADMIN_TOGGLE_LIMIT), async (c) => {
    const id = parseUserId(c.req.param('id'))
    if (id === null) return c.notFound()

    const authResult = await requireUser(c, store)
    if (!authResult.ok) return authResult.response

    const body = await c.req.parseBody()
    const raw = body.isAdmin
    if (raw !== '1' && raw !== '0') return c.text('参数无效', 400)

    const result = await admin.setAdmin(authResult.user, id, raw === '1')
    if (result.ok) return c.redirect(`/users/${id}`)
    if (result.error.code === 'NOT_FOUND') return c.notFound()
    if (result.error.code === 'CANNOT_MODIFY_OWNER') {
      return c.text('不能修改论坛主的管理员状态', 403)
    }
    return c.text('只有论坛主可以指定管理员', 403)
  })

  return pages
}

/** 解析 /media/posts/:id 的正整数图片 ID，非法输入返回 null。 */
function parseImageId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

/**
 * 解析「回复 @某人」的目标：ID 必须合法、存在且属于当前主题。
 * 任一步不满足都返回 null（按普通回帖处理），避免用伪造的 replyTo 探测其他主题的回复。
 */
async function resolveReplyTarget(
  store: ForumStore,
  topicId: number,
  raw: string | undefined,
): Promise<ReplyTarget | null> {
  const replyId = parseReplyId(raw)
  if (replyId === null) return null
  const reply = await store.getReplyById(replyId)
  if (reply === null || reply.topicId !== topicId) return null
  return { id: reply.id, author: reply.author }
}

/**
 * 回复某条评论时，通知被回复的那位作者（而不是楼主）。
 * 与 notifyTopicAuthor 一致：通知是附加动作，失败不影响回帖结果。
 */
async function notifyReplyAuthor(
  store: ForumStore,
  topicId: number,
  parentReplyId: number,
  replier: User,
  content: string,
): Promise<void> {
  try {
    const parent = await store.getReplyById(parentReplyId)
    // 被回复的楼层已被删除、作者已注销，或自己回复自己时不通知
    if (parent === null || parent.authorId === null || parent.authorId === replier.id) return
    await store.createNotification({
      kind: 'notification',
      userId: parent.authorId,
      title: `${replier.username} 回复了你的评论`,
      body: summarizeForNotification(content),
      link: `/topics/${topicId}#reply-${parentReplyId}`,
    })
  } catch {
    // 通知失败不影响回帖结果
  }
}

/**
 * 回帖后给楼主写一条定向通知。
 *
 * 通知是回帖的附加动作：这里刻意吞掉异常与领域错误，避免通知写入失败反过来让回帖报错。
 * 代价是失败会被静默忽略，所以测试必须覆盖「通知确实被创建」，否则这种静默失败不会被发现。
 */
async function notifyTopicAuthor(
  store: ForumStore,
  topicId: number,
  replier: User,
  content: string,
  replyId: number,
): Promise<void> {
  try {
    const topic = await store.getTopicById(topicId)
    // 楼主已注销（authorId 为 null）或自己回复自己的主题时不通知
    if (topic === null || topic.authorId === null || topic.authorId === replier.id) return
    await store.createNotification({
      kind: 'notification',
      userId: topic.authorId,
      title: `${replier.username} 回复了你的主题《${truncateByCodePoint(topic.title, NOTIFICATION_TITLE_LIMIT)}》`,
      body: summarizeForNotification(content),
      link: `/topics/${topicId}#reply-${replyId}`,
    })
  } catch {
    // 通知失败不影响回帖结果
  }
}

/** 通知摘要上限：回复过长时只显示前一部分，避免把整段回复复制进通知列表 */
const NOTIFICATION_SUMMARY_LIMIT = 100

/** 通知标题里引用的主题名上限，防止超长标题把通知列表撑开 */
const NOTIFICATION_TITLE_LIMIT = 40

/**
 * 按码点截断超长文本。
 *
 * 不用 `slice`：它按 UTF-16 码元切分，截断位置落在一对代理码元中间时会留下半个字符，
 * 显示成乱码。用 `Array.from` 按码点切分，emoji 不会被切坏。
 */
function truncateByCodePoint(value: string, limit: number): string {
  const points = Array.from(value)
  return points.length > limit ? `${points.slice(0, limit).join('')}…` : value
}

/** 通知正文只保留摘要，避免把整段回复复制进通知列表 */
function summarizeForNotification(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  return truncateByCodePoint(flat, NOTIFICATION_SUMMARY_LIMIT)
}
