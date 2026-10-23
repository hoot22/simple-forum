import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_FIELD, CSRF_HEADER } from '../src/middleware/csrf'
import { MAX_POST_IMAGES, MAX_UPLOAD_BODY_BYTES } from '../src/uploads/image-validation'
import { createSessionToken, SESSION_COOKIE, hashPassword } from '../src/utils/auth'

/**
 * /api 图片端点的契约测试。
 *
 * 关注三类容易回归的点：
 * 1. multipart 请求在 CSRF 中间件已经读过一次 body 之后，handler 仍能拿到同一份解析结果；
 * 2. 上传复用 validateImages 与 MAX_POST_IMAGES，错误码区分 401 / 403 / 404 / 409 / 413 / 422；
 * 3. 详情接口的 images 是纯增量字段，且任何接口都不返回图片字节。
 *
 * 数据直接写存储、会话直接签发，绕开 /login 与页面路由的进程内共享限流。
 */

const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-api-images-0123456' } as Env
const CSRF_TOKEN = 'csrf-token-for-api-image-contract-tests-0001'

function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const app = createApp(TEST_ENV, { store })
  const request = (input: string, init?: RequestInit) =>
    Promise.resolve(app.request(input, init, TEST_ENV))
  return { store, request }
}

type Request = ReturnType<typeof buildApp>['request']

async function createUser(store: MemoryForumStore, username: string) {
  const created = await store.createUser(username, await hashPassword(`pw-${username}-0001`))
  if (!created.ok) throw new Error(`createUser 失败: ${created.error}`)
  return created.value
}

type TestUser = Awaited<ReturnType<typeof createUser>>

async function createTopic(store: MemoryForumStore, user: TestUser, title: string): Promise<number> {
  const created = await store.createTopic(user, { title, content: `${title} 的正文` })
  if (!created.ok) throw new Error(`createTopic 失败: ${created.error}`)
  return created.value.id
}

/** 签发会话并带上 CSRF Cookie；写请求还需单独提交 CSRF 令牌。 */
async function cookieFor(user: TestUser): Promise<string> {
  const token = await createSessionToken(TEST_ENV, user.id)
  return `${SESSION_COOKIE}=${token}; ${CSRF_COOKIE}=${CSRF_TOKEN}`
}

/** 最小合法 PNG：magic 之后把宽高写入偏移 16 / 20，padding 用于撑大体积。 */
function png(width = 4, height = 4, padding = 0): Uint8Array {
  const bytes = new Uint8Array(24 + padding)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

type UploadFile = { name: string; bytes: Uint8Array; type?: string }

function formWith(files: UploadFile[], fields: Record<string, string> = {}): FormData {
  const form = new FormData()
  for (const file of files) {
    form.append('images', new File([file.bytes], file.name, { type: file.type ?? 'image/png' }))
  }
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  return form
}

/** 默认用 CSRF 头（客户端常规路径）；headerToken: false 时改走表单字段。 */
async function upload(
  request: Request,
  topicId: number,
  files: UploadFile[],
  options: { cookie?: string; headerToken?: boolean } = {},
) {
  const headers: Record<string, string> = {}
  if (options.cookie) headers.cookie = options.cookie
  if (options.headerToken !== false) headers[CSRF_HEADER] = CSRF_TOKEN
  const fields: Record<string, string> = {}
  if (options.headerToken === false) fields[CSRF_FIELD] = CSRF_TOKEN
  return request(`/api/topics/${topicId}/images`, {
    method: 'POST',
    headers,
    body: formWith(files, fields),
  })
}

describe('POST /api/topics/:id/images', () => {
  it('未登录时返回 401，不写入任何图片', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '未登录上传')

    // 只带 CSRF Cookie：先通过 CSRF 中间件，才能真正验证业务层的登录校验。
    const res = await upload(request, topicId, [{ name: 'a.png', bytes: png() }], {
      cookie: `${CSRF_COOKIE}=${CSRF_TOKEN}`,
    })

    expect(res.status).toBe(401)
    const detail = await request(`/api/topics/${topicId}`)
    const topic = ((await detail.json()) as { topic: { images?: unknown[] } }).topic
    expect(topic.images).toEqual([])
  })

  it('非作者上传时返回 403', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const other = await createUser(store, 'bob')
    const topicId = await createTopic(store, author, '越权上传')

    const res = await upload(request, topicId, [{ name: 'a.png', bytes: png() }], {
      cookie: await cookieFor(other),
    })

    expect(res.status).toBe(403)
  })

  it('主题不存在时返回 404', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')

    const res = await upload(request, 999_999, [{ name: 'a.png', bytes: png() }], {
      cookie: await cookieFor(author),
    })

    expect(res.status).toBe(404)
  })

  it('没有选择文件时返回 422', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '空上传')

    const res = await request(`/api/topics/${topicId}/images`, {
      method: 'POST',
      headers: { cookie: await cookieFor(author), [CSRF_HEADER]: CSRF_TOKEN },
      body: new FormData(),
    })

    expect(res.status).toBe(422)
  })

  it('上传成功返回 201，详情接口附带不含字节的 images', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '带图帖子')

    const res = await upload(request, topicId, [{ name: 'a.png', bytes: png(8, 6) }], {
      cookie: await cookieFor(author),
    })

    expect(res.status).toBe(201)
    const payload = (await res.json()) as { images: Array<Record<string, unknown>> }
    expect(payload.images).toHaveLength(1)
    expect(payload.images[0]).toMatchObject({
      topicId,
      contentType: 'image/png',
      width: 8,
      height: 6,
      position: 0,
    })
    // 元数据接口绝不外带 BLOB 字节。
    expect(payload.images[0]).not.toHaveProperty('data')

    const detail = await request(`/api/topics/${topicId}`)
    const topic = ((await detail.json()) as {
      topic: { images?: Array<Record<string, unknown>> }
    }).topic
    expect(topic.images).toHaveLength(1)
    expect(topic.images?.[0]).toMatchObject({ topicId, position: 0 })
    expect(topic.images?.[0]).not.toHaveProperty('data')
  })

  it('追加图片时 position 从现有最大值继续递增', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '追加图片')
    const cookie = await cookieFor(author)

    const first = await upload(
      request,
      topicId,
      [
        { name: 'a.png', bytes: png() },
        { name: 'b.png', bytes: png(5, 5) },
      ],
      { cookie },
    )
    expect(first.status).toBe(201)

    const second = await upload(request, topicId, [{ name: 'c.png', bytes: png(6, 6) }], { cookie })
    expect(second.status).toBe(201)

    const detail = await request(`/api/topics/${topicId}`)
    const topic = ((await detail.json()) as { topic: { images?: Array<{ position: number }> } }).topic
    expect(topic.images?.map((image) => image.position)).toEqual([0, 1, 2])
  })

  it('超过单帖图片上限时返回 409', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '图片上限')
    const cookie = await cookieFor(author)

    const full = await upload(
      request,
      topicId,
      Array.from({ length: MAX_POST_IMAGES }, (_, index) => ({
        name: `img-${index}.png`,
        bytes: png(),
      })),
      { cookie },
    )
    expect(full.status).toBe(201)

    const overflow = await upload(request, topicId, [{ name: 'extra.png', bytes: png() }], { cookie })
    expect(overflow.status).toBe(409)
    expect(((await overflow.json()) as { error: string }).error).toContain('上限')
  })

  it('请求体超过上限时返回 413', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '超大上传')

    const res = await upload(
      request,
      topicId,
      [{ name: 'big.png', bytes: png(4, 4, MAX_UPLOAD_BODY_BYTES) }],
      { cookie: await cookieFor(author) },
    )

    expect(res.status).toBe(413)
  })

  it('内容不是合法图片时返回 422', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '非法图片')

    const res = await upload(
      request,
      topicId,
      [{ name: 'fake.png', bytes: new TextEncoder().encode('这其实是一段文本'), type: 'image/png' }],
      { cookie: await cookieFor(author) },
    )

    expect(res.status).toBe(422)
  })

  it('CSRF 令牌放在表单字段而不是请求头时同样可用', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '表单令牌上传')

    const res = await upload(request, topicId, [{ name: 'a.png', bytes: png() }], {
      cookie: await cookieFor(author),
      headerToken: false,
    })

    expect(res.status).toBe(201)
    const payload = (await res.json()) as { images: unknown[] }
    expect(payload.images).toHaveLength(1)
  })

  it('缺少 CSRF 令牌时被中间件拦截为 403', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '缺少令牌')

    const res = await request(`/api/topics/${topicId}/images`, {
      method: 'POST',
      headers: { cookie: await cookieFor(author) },
      body: formWith([{ name: 'a.png', bytes: png() }]),
    })

    expect(res.status).toBe(403)
  })
})

describe('DELETE /api/images/:id', () => {
  it('作者删除后返回 204，并压缩剩余 position', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '删除图片')
    const cookie = await cookieFor(author)

    const uploaded = await upload(
      request,
      topicId,
      [
        { name: 'a.png', bytes: png() },
        { name: 'b.png', bytes: png(5, 5) },
        { name: 'c.png', bytes: png(6, 6) },
      ],
      { cookie },
    )
    const created = (await uploaded.json()) as { images: Array<{ id: number }> }
    const removedId = created.images[0]?.id
    expect(removedId).toBeTypeOf('number')

    const res = await request(`/api/images/${removedId}`, {
      method: 'DELETE',
      headers: { cookie, [CSRF_HEADER]: CSRF_TOKEN },
    })
    expect(res.status).toBe(204)

    const detail = await request(`/api/topics/${topicId}`)
    const topic = ((await detail.json()) as {
      topic: { images?: Array<{ id: number; position: number }> }
    }).topic
    expect(topic.images).toHaveLength(2)
    expect(topic.images?.map((image) => image.position)).toEqual([0, 1])
    expect(topic.images?.some((image) => image.id === removedId)).toBe(false)
  })

  it('非作者删除时返回 403，图片仍然存在', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const other = await createUser(store, 'bob')
    const topicId = await createTopic(store, author, '越权删除图片')
    const authorCookie = await cookieFor(author)

    const uploaded = await upload(request, topicId, [{ name: 'a.png', bytes: png() }], {
      cookie: authorCookie,
    })
    const created = (await uploaded.json()) as { images: Array<{ id: number }> }
    const imageId = created.images[0]?.id

    const res = await request(`/api/images/${imageId}`, {
      method: 'DELETE',
      headers: { cookie: await cookieFor(other), [CSRF_HEADER]: CSRF_TOKEN },
    })
    expect(res.status).toBe(403)

    const detail = await request(`/api/topics/${topicId}`)
    const topic = ((await detail.json()) as { topic: { images?: unknown[] } }).topic
    expect(topic.images).toHaveLength(1)
  })

  it('图片不存在时返回 404', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')

    const res = await request('/api/images/999999', {
      method: 'DELETE',
      headers: { cookie: await cookieFor(author), [CSRF_HEADER]: CSRF_TOKEN },
    })

    expect(res.status).toBe(404)
  })
})
