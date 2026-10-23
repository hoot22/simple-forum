import { Hono } from 'hono'
import type { ForumStore } from '../db/store'
import type { Env } from '../env'
import type { NotificationKind, PostImage, TopicSort } from '../types'
import { endSession, getCurrentUser, startSession } from '../utils/session'
import { rateLimit } from '../middleware/rate-limit'
import { parseTopicId, parseUserId } from '../utils/validate'
import { createAuthService } from '../services/auth'
import { createForumService } from '../services/forum'
import { createProfileService } from '../services/profile'
import { createAdminService } from '../services/admin'
import { MAX_POST_IMAGES, MAX_UPLOAD_BODY_BYTES, PREVIEW_LIMIT, collectImageFiles, validateImages } from '../uploads/image-validation'
import { createPostImageRepository, storeTopicImages } from '../uploads/post-images'
import { deletePreview, deletePreviewsByTopic, previewMetaFor, savePreviews } from '../uploads/post-previews'

/**
 * JSON API（P1：薄编排层）。
 * 与页面路由调用同一套 src/services/*，保证两条入口的业务规则一致；
 * 列表接口在原有字段之外附带 nextCursor / prevCursor（对旧客户端是向后兼容的增量）。
 */

/** 与页面路由一致的限流配额，scope 加 api- 前缀以便和页面端点分开计数 */
const LOGIN_LIMIT = { scope: 'api-login', windowSeconds: 15 * 60, max: 10 }
const REGISTER_LIMIT = { scope: 'api-register', windowSeconds: 60 * 60, max: 5 }
const TOPIC_CREATE_LIMIT = { scope: 'api-topic-create', windowSeconds: 60 * 60, max: 20 }
const REPLY_CREATE_LIMIT = { scope: 'api-reply-create', windowSeconds: 60 * 60, max: 60 }
const TOPIC_DELETE_LIMIT = { scope: 'api-topic-delete', windowSeconds: 60 * 60, max: 30 }
const ADMIN_TOGGLE_LIMIT = { scope: 'api-admin-toggle', windowSeconds: 60 * 60, max: 30 }
const IMAGE_UPLOAD_LIMIT = { scope: 'api-image-upload', windowSeconds: 60 * 60, max: 40 }
const IMAGE_DELETE_LIMIT = { scope: 'api-image-delete', windowSeconds: 60 * 60, max: 60 }

async function readJson(c: Parameters<typeof getCurrentUser>[0]): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 对外只暴露图片元数据。
 *
 * 内存仓储的 listByTopic 会返回 data（D1 实现不会），所以在 API 边界统一剥离，
 * 保证任何接口都不会把图片字节带出去。
 *
 * hasPreview 由 post_image_previews 的一次批量查询得出，客户端据此决定列表缩略图
 * 走 ?size=preview 还是直接用原图，不需要为了探测而多发请求。
 */
function publicImages(
  images: PostImage[],
  previewIds: ReadonlySet<number> = new Set(),
): Array<Omit<PostImage, 'data'> & { hasPreview: boolean }> {
  return images.map(({ data: _data, ...meta }) => ({
    ...meta,
    hasPreview: previewIds.has(meta.id),
  }))
}

/** 解析 limit 查询参数；非法时交给存储层用默认值 */
function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined
}

function parseSort(raw: string | undefined): TopicSort {
  return raw === 'active' ? 'active' : 'newest'
}

export function apiRoutes(store: ForumStore): Hono<{ Bindings: Env }> {
  const api = new Hono<{ Bindings: Env }>()
  const auth = createAuthService(store)
  const forum = createForumService(store)
  const profiles = createProfileService(store)
  const admin = createAdminService(store)

  // ---------- 主题 ----------
  api.get('/topics', async (c) => {
    const page = await forum.listTopics({
      cursor: c.req.query('cursor') ?? null,
      limit: parseLimit(c.req.query('limit')),
      sort: parseSort(c.req.query('sort')),
    })

    // 列表项只需要回答「封面那张图有没有缩略图」，所以按 firstImageId 做一次批量
    // 查询，而不是逐条查预览：这里保持 O(1) 次查询，不引入 N+1。
    // hasPreview 是纯增量字段，旧客户端可忽略。
    const coverImageIds = page.items
      .map((topic) => topic.firstImageId)
      .filter((imageId): imageId is number => imageId !== null)
    const previews = await previewMetaFor(store, c.env as Env, coverImageIds)
    const topics = page.items.map((topic) => ({
      ...topic,
      hasPreview: topic.firstImageId !== null && previews.has(topic.firstImageId),
    }))

    return c.json({ topics, nextCursor: page.nextCursor, prevCursor: page.prevCursor })
  })

  api.get('/topics/:id', async (c) => {
    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.json({ error: '主题不存在' }, 404)
    const result = await forum.getTopicDetail({
      topicId: id,
      repliesCursor: c.req.query('repliesCursor') ?? null,
      repliesLimit: parseLimit(c.req.query('repliesLimit')),
    })
    if (!result.ok) return c.json({ error: '主题不存在' }, 404)
    const { replies, ...topic } = result.value
    // 纯增量字段：只返回图片元数据（不含字节），旧客户端可忽略。
    const images = await createPostImageRepository(store, c.env as Env).listByTopic(id)
    const previews = await previewMetaFor(store, c.env as Env, images.map((image) => image.id))
    return c.json({
      topic: { ...topic, images: publicImages(images, new Set(previews.keys())) },
      replies: replies.items,
      repliesNextCursor: replies.nextCursor,
      repliesPrevCursor: replies.prevCursor,
    })
  })

  api.post('/topics', rateLimit(TOPIC_CREATE_LIMIT), async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.json({ error: '请先登录后再发帖' }, 401)
    const body = await readJson(c)
    const result = await forum.createTopic(user, {
      title: body ? asString(body.title) : '',
      content: body ? asString(body.content) : '',
    })
    if (result.ok) return c.json({ topic: result.value }, 201)
    if (result.error.code === 'VALIDATION_FAILED') return c.json({ error: result.error.errors[0] }, 400)
    return c.json({ error: '会话已失效，请重新登录' }, 401)
  })

  // ---------- 回复 ----------
  api.post('/topics/:id/replies', rateLimit(REPLY_CREATE_LIMIT), async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.json({ error: '请先登录后再回复' }, 401)
    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.json({ error: '主题不存在' }, 404)
    const body = await readJson(c)
    const result = await forum.createReply(user, id, { content: body ? asString(body.content) : '' })
    if (result.ok) return c.json({ reply: result.value }, 201)
    if (result.error.code === 'VALIDATION_FAILED') return c.json({ error: result.error.errors[0] }, 400)
    if (result.error.code === 'TOPIC_NOT_FOUND') return c.json({ error: '主题不存在' }, 404)
    return c.json({ error: '会话已失效，请重新登录' }, 401)
  })

  // ---------- 删除主题（作者 / 管理员 / 论坛主） ----------
  api.delete('/topics/:id', rateLimit(TOPIC_DELETE_LIMIT), async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.json({ error: '请先登录后再删除' }, 401)
    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.json({ error: '主题不存在' }, 404)
    const result = await forum.deleteTopic(user, id)
    if (result.ok) return c.json({ ok: true, id: result.value.id })
    if (result.error.code === 'NOT_FOUND') return c.json({ error: '主题不存在' }, 404)
    return c.json({ error: '没有权限删除该帖子' }, 403)
  })

  // ---------- 帖子图片（作者 / 管理员 / 论坛主） ----------
  api.post('/topics/:id/images', rateLimit(IMAGE_UPLOAD_LIMIT), async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.json({ error: '请先登录后再上传图片' }, 401)

    const id = parseTopicId(c.req.param('id'))
    if (id === null) return c.json({ error: '主题不存在' }, 404)

    const topic = await forum.getTopicById(id)
    if (!topic) return c.json({ error: '主题不存在' }, 404)
    if (!(await forum.canDeleteTopic(user, topic))) {
      return c.json({ error: '没有权限为该帖子添加图片' }, 403)
    }

    // Content-Length 只用于提前拒绝超大包；真正上限以解析后的实际字节数为准。
    const declaredLength = Number(c.req.header('content-length') ?? Number.NaN)
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BODY_BYTES) {
      return c.json({ error: '上传内容过大，请压缩后重试' }, 413)
    }

    const form = await c.req.formData()
    const files = collectImageFiles(form)
    if (files.length === 0) return c.json({ error: '请选择要上传的图片' }, 422)

    // 缩略图可选，按索引与 images 一一对应。长度不一致时直接拒绝，
    // 否则缩略图会被错配到别的图片上。
    const previewFiles = collectImageFiles(form, ['previews', 'preview'])
    if (previewFiles.length > 0 && previewFiles.length !== files.length) {
      return c.json({ error: '缩略图数量必须与图片数量一致' }, 422)
    }

    const totalBytes =
      files.reduce((sum, file) => sum + file.size, 0) +
      previewFiles.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_UPLOAD_BODY_BYTES) {
      return c.json({ error: '上传内容过大，请压缩后重试' }, 413)
    }

    const repository = createPostImageRepository(store, c.env as Env)
    const existing = await repository.listByTopic(id)
    if (existing.length + files.length > MAX_POST_IMAGES) {
      return c.json({ error: `该帖子图片数量已达上限（最多 ${MAX_POST_IMAGES} 张）` }, 409)
    }

    // 多截一张，让 validateImages 用统一文案报告数量超限。
    const validated = await validateImages(files.slice(0, MAX_POST_IMAGES + 1))
    if (!validated.ok) return c.json({ error: validated.errors.join('；') }, 422)

    // 缩略图复用同一套魔数 / 尺寸校验，只有字节上限与文案不同。
    const validatedPreviews = previewFiles.length
      ? await validateImages(previewFiles, PREVIEW_LIMIT, '缩略图')
      : null
    if (validatedPreviews && !validatedPreviews.ok) {
      return c.json({ error: validatedPreviews.errors.join('；') }, 422)
    }

    const startPosition = existing.reduce((max, image) => Math.max(max, image.position + 1), 0)
    try {
      const images = await storeTopicImages(store, c.env as Env, id, validated.value, {
        startPosition,
      })
      await savePreviews(
        store,
        c.env as Env,
        images.map((image, index) => ({
          topicId: id,
          imageId: image.id,
          image: validatedPreviews?.value[index] ?? null,
        })),
      )
      const previewIds = new Set(
        images
          .filter((_image, index) => validatedPreviews?.value[index] !== undefined)
          .map((image) => image.id),
      )
      return c.json({ images: publicImages(images, previewIds) }, 201)
    } catch {
      return c.json({ error: '图片保存失败，请稍后重试' }, 500)
    }
  })

  // ---------- 删除单张图片（作者 / 管理员 / 论坛主） ----------
  api.delete('/images/:id', rateLimit(IMAGE_DELETE_LIMIT), async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.json({ error: '请先登录后再操作' }, 401)

    const imageId = parseTopicId(c.req.param('id'))
    if (imageId === null) return c.json({ error: '图片不存在' }, 404)

    const repository = createPostImageRepository(store, c.env as Env)
    const image = await repository.getById(imageId)
    if (!image) return c.json({ error: '图片不存在' }, 404)

    const topic = await forum.getTopicById(image.topicId)
    if (!topic) return c.json({ error: '图片不存在' }, 404)
    if (!(await forum.canDeleteTopic(user, topic))) {
      return c.json({ error: '没有权限删除该图片' }, 403)
    }

    await repository.deleteById(imageId)
    await deletePreview(store, c.env as Env, imageId)

    // 压缩 position 空洞，保证剩余图片顺序与列表展示一致。
    const remaining = await repository.listByTopic(image.topicId)
    for (let index = 0; index < remaining.length; index += 1) {
      const item = remaining[index]
      if (item && item.position !== index) await repository.updatePosition(item.id, index)
    }

    return c.body(null, 204)
  })

  // ---------- 注册 / 登录 / 登出 ----------
  api.post('/auth/register', rateLimit(REGISTER_LIMIT), async (c) => {
    const body = await readJson(c)
    const username = body ? asString(body.username) : ''
    const password = body ? asString(body.password) : ''
    // JSON API 没有「确认密码」字段，按两次输入一致处理
    const result = await auth.register({ username, password, confirmPassword: password })
    if (result.ok) {
      await startSession(c, result.value)
      return c.json({ user: result.value }, 201)
    }
    if (result.error.code === 'USERNAME_TAKEN') return c.json({ error: '该用户名已被注册' }, 409)
    return c.json({ error: result.error.errors[0] }, 400)
  })

  api.post('/auth/login', rateLimit(LOGIN_LIMIT), async (c) => {
    const body = await readJson(c)
    const username = body ? asString(body.username) : ''
    const password = body ? asString(body.password) : ''
    const result = await auth.login({ username, password })
    if (result.ok) {
      await startSession(c, result.value)
      return c.json({ user: result.value })
    }
    if (result.error.code === 'INVALID_CREDENTIALS') return c.json({ error: '用户名或密码错误' }, 401)
    return c.json({ error: result.error.errors[0] }, 400)
  })

  api.post('/auth/logout', async (c) => {
    endSession(c)
    return c.json({ ok: true })
  })

  // ---------- 当前用户 ----------
  api.get('/me', async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.json({ error: '未登录' }, 401)
    return c.json({ user })
  })

  // ---------- 指定 / 取消管理员（仅论坛主） ----------
  api.post('/users/:id/admin', rateLimit(ADMIN_TOGGLE_LIMIT), async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.json({ error: '请先登录' }, 401)
    const id = parseUserId(c.req.param('id'))
    if (id === null) return c.json({ error: '用户不存在' }, 404)
    const body = await readJson(c)
    const isAdmin = body ? body.isAdmin : undefined
    if (typeof isAdmin !== 'boolean') return c.json({ error: 'isAdmin 必须为布尔值' }, 400)

    const result = await admin.setAdmin(user, id, isAdmin)
    if (result.ok) return c.json({ user: result.value })
    if (result.error.code === 'NOT_FOUND') return c.json({ error: '用户不存在' }, 404)
    if (result.error.code === 'CANNOT_MODIFY_OWNER') {
      return c.json({ error: '不能修改论坛主的管理员状态' }, 403)
    }
    return c.json({ error: '只有论坛主可以指定管理员' }, 403)
  })

  // ---------- 个人资料页（只读） ----------
  // 网页端 /users/:id 是服务端渲染；这里给外部客户端等价的 JSON 视图。
  // 复用同一个 getProfilePageData，避免两处取数逻辑各自漂移。
  // 与网页端一致：资料属于公开内容，不要求登录。
  api.get('/users/:id/profile', async (c) => {
    const id = parseUserId(c.req.param('id'))
    if (id === null) return c.json({ error: '用户不存在' }, 404)

    const result = await profiles.getProfilePageData({
      userId: id,
      pageSize: parseLimit(c.req.query('limit')),
    })
    if (!result.ok) return c.json({ error: '用户不存在' }, 404)

    const { profile, stats, topics, replies } = result.value

    // 与 /topics 一致：主题项附带 hasPreview 增量字段，按 firstImageId 批量查询，不引入 N+1。
    const coverImageIds = topics.items
      .map((topic) => topic.firstImageId)
      .filter((imageId): imageId is number => imageId !== null)
    const previews = await previewMetaFor(store, c.env, coverImageIds)
    const topicItems = topics.items.map((topic) => ({
      ...topic,
      hasPreview: topic.firstImageId !== null && previews.has(topic.firstImageId),
    }))

    return c.json({
      profile,
      stats,
      topics: { ...topics, items: topicItems },
      replies,
    })
  })

  // 通知 / 公告列表（需登录，只读）。
  //
  // 网页端在渲染通知页时会顺手把当期列表标记为已读；这个端点刻意**不产生副作用**，
  // 原因是一旦 GET 会改数据，未读状态就无法重放、也无法安全缓存，
  // 客户端也就无法显示「哪些是新的」。何时标记已读由客户端显式调用写接口决定。
  api.get('/notifications', async (c) => {
    const user = await getCurrentUser(c, store)
    if (!user) return c.json({ error: '请先登录后再查看通知' }, 401)

    const kind: NotificationKind =
      c.req.query('kind') === 'announcement' ? 'announcement' : 'notification'
    const page = await store.listNotifications({
      userId: user.id,
      kind,
      cursor: c.req.query('cursor') ?? null,
      limit: parseLimit(c.req.query('limit')),
    })
    const counts = await store.countUnreadNotifications(user.id)
    return c.json({
      kind,
      items: page.items,
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      counts,
    })
  })

  return api
}
