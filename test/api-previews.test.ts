import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_HEADER } from '../src/middleware/csrf'
import { MAX_PREVIEW_BYTES } from '../src/uploads/image-validation'
import { createSessionToken, SESSION_COOKIE, hashPassword } from '../src/utils/auth'

/**
 * 缩略图（preview）契约测试。
 *
 * 缩略图由客户端生成、服务端只做校验与分发，所以这里要锁住四件事：
 * 1. previews 与 images 的配对规则（含数量不一致时的拒绝）；
 * 2. 缩略图复用原图的魔数 / 尺寸校验，但使用独立的字节上限；
 * 3. ?size=preview 在缺失时回退原图，且 ETag 与两种表示都不同；
 * 4. 图片或主题被删除后不残留孤儿缩略图。
 */

const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-previews-0123456' } as Env
const CSRF_TOKEN = 'csrf-token-for-preview-contract-tests-000001'

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

type UploadOptions = {
  cookie: string
  /** 与 images 并行的缩略图；顺序即配对关系。 */
  previews?: UploadFile[]
  /** 直接覆盖 previews 字段，用于构造数量不一致的请求。 */
  rawPreviews?: UploadFile[]
}

async function uploadWithPreviews(
  request: Request,
  topicId: number,
  files: UploadFile[],
  options: UploadOptions,
) {
  const form = new FormData()
  for (const file of files) {
    form.append('images', new File([file.bytes], file.name, { type: file.type ?? 'image/png' }))
  }
  for (const file of options.previews ?? options.rawPreviews ?? []) {
    form.append('previews', new File([file.bytes], file.name, { type: file.type ?? 'image/png' }))
  }
  return request(`/api/topics/${topicId}/images`, {
    method: 'POST',
    headers: { cookie: options.cookie, [CSRF_HEADER]: CSRF_TOKEN },
    body: form,
  })
}

type UploadedImage = { id: number; byteSize: number; hasPreview: boolean }

async function uploadOne(
  request: Request,
  topicId: number,
  options: UploadOptions,
): Promise<UploadedImage> {
  const res = await uploadWithPreviews(request, topicId, [{ name: 'a.png', bytes: png(8, 8) }], options)
  expect(res.status).toBe(201)
  const body = (await res.json()) as { images: UploadedImage[] }
  const [image] = body.images
  if (!image) throw new Error('上传未返回图片')
  return image
}

async function detailImages(request: Request, topicId: number): Promise<UnknownImage[]> {
  const res = await request(`/api/topics/${topicId}`)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { topic: { images: UnknownImage[] } }
  return body.topic.images
}

type UnknownImage = Record<string, unknown>

describe('缩略图上传与配对', () => {
  it('带上缩略图上传后，详情接口的图片带 hasPreview: true', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '带缩略图')
    const cookie = await cookieFor(author)

    const image = await uploadOne(request, topicId, {
      cookie,
      previews: [{ name: 'a.thumb.png', bytes: png(2, 2) }],
    })

    expect(image.hasPreview).toBe(true)
    const images = await detailImages(request, topicId)
    expect(images).toHaveLength(1)
    expect(images[0]?.hasPreview).toBe(true)
  })

  it('不带缩略图时 hasPreview 为 false，且不报错', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '无缩略图')
    const cookie = await cookieFor(author)

    const image = await uploadOne(request, topicId, { cookie })

    expect(image.hasPreview).toBe(false)
    const images = await detailImages(request, topicId)
    expect(images[0]?.hasPreview).toBe(false)
  })

  it('缩略图数量与图片数量不一致时返回 422，且不写入任何图片', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '数量不一致')

    const res = await uploadWithPreviews(
      request,
      topicId,
      [
        { name: 'a.png', bytes: png() },
        { name: 'b.png', bytes: png() },
      ],
      { cookie: await cookieFor(author), previews: [{ name: 'a.thumb.png', bytes: png(2, 2) }] },
    )

    expect(res.status).toBe(422)
    expect(await detailImages(request, topicId)).toEqual([])
  })

  it('缩略图超过 256 KiB 时返回 422，并使用缩略图专属文案', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '缩略图过大')

    const res = await uploadWithPreviews(request, topicId, [{ name: 'a.png', bytes: png(8, 8) }], {
      cookie: await cookieFor(author),
      previews: [{ name: 'a.thumb.png', bytes: png(2, 2, MAX_PREVIEW_BYTES) }],
    })

    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('缩略图')
  })

  it('缩略图不通过魔数校验时返回 422', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '缩略图非图片')

    const res = await uploadWithPreviews(request, topicId, [{ name: 'a.png', bytes: png(8, 8) }], {
      cookie: await cookieFor(author),
      previews: [{ name: 'a.thumb.png', bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }],
    })

    expect(res.status).toBe(422)
  })
})

describe('GET /media/posts/:id?size=preview', () => {
  it('有缩略图时返回缩略图字节，ETag 带 preview 前缀', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '缩略图分发')
    const cookie = await cookieFor(author)
    const previewBytes = png(2, 2, 64)

    const image = await uploadOne(request, topicId, {
      cookie,
      previews: [{ name: 'a.thumb.png', bytes: previewBytes }],
    })

    const res = await request(`/media/posts/${image.id}?size=preview`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('etag')).toContain('post-image-preview-')
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body.byteLength).toBe(previewBytes.byteLength)
  })

  it('没有缩略图时回退原图，且 ETag 仍是原图表示', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '回退原图')
    const cookie = await cookieFor(author)

    const image = await uploadOne(request, topicId, { cookie })

    const original = await request(`/media/posts/${image.id}`)
    const originalBytes = new Uint8Array(await original.arrayBuffer())

    const res = await request(`/media/posts/${image.id}?size=preview`)
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe(original.headers.get('etag'))
    const body = new Uint8Array(await res.arrayBuffer())
    expect(body.byteLength).toBe(originalBytes.byteLength)
  })

  it('缩略图与原图使用不同 ETag，避免缓存互相污染', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, 'ETag 区分')
    const cookie = await cookieFor(author)

    const image = await uploadOne(request, topicId, {
      cookie,
      previews: [{ name: 'a.thumb.png', bytes: png(2, 2, 32) }],
    })

    const original = await request(`/media/posts/${image.id}`)
    const preview = await request(`/media/posts/${image.id}?size=preview`)
    expect(preview.headers.get('etag')).not.toBe(original.headers.get('etag'))
  })
})

describe('缩略图生命周期', () => {
  it('删除图片后缩略图一并清理，?size=preview 回退原图', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '删除图片')
    const cookie = await cookieFor(author)

    const first = await uploadOne(request, topicId, {
      cookie,
      previews: [{ name: 'a.thumb.png', bytes: png(2, 2, 16) }],
    })
    const second = await uploadOne(request, topicId, {
      cookie,
      previews: [{ name: 'b.thumb.png', bytes: png(2, 2, 48) }],
    })

    const removed = await request(`/api/images/${first.id}`, {
      method: 'DELETE',
      headers: { cookie, [CSRF_HEADER]: CSRF_TOKEN },
    })
    expect(removed.status).toBe(204)

    const gone = await request(`/media/posts/${first.id}?size=preview`)
    expect(gone.status).toBe(404)

    // 另一张的缩略图不受影响，说明清理是按图片 ID 精确进行的。
    const kept = await request(`/media/posts/${second.id}?size=preview`)
    expect(kept.headers.get('etag')).toContain('post-image-preview-')
  })

  it('详情接口不返回图片或缩略图字节', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '不泄漏字节')

    const image = await uploadOne(request, topicId, {
      cookie: await cookieFor(author),
      previews: [{ name: 'a.thumb.png', bytes: png(2, 2, 32) }],
    })
    expect(image.hasPreview).toBe(true)

    const res = await request(`/api/topics/${topicId}`)
    const raw = await res.text()
    expect(raw).not.toContain('data')
    const images = await detailImages(request, topicId)
    expect(Object.keys(images[0] ?? {})).not.toContain('data')
  })
})

type TopicListImageFields = {
  id: number
  title: string
  imageCount: number
  firstImageId: number | null
  hasPreview: boolean
}

async function listTopics(request: Request): Promise<TopicListImageFields[]> {
  const res = await request('/api/topics')
  expect(res.status).toBe(200)
  const body = (await res.json()) as { topics: TopicListImageFields[] }
  return body.topics
}

describe('GET /api/topics 的 hasPreview', () => {
  it('封面图带缩略图时 hasPreview 为 true', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '有缩略图')

    await uploadOne(request, topicId, {
      cookie: await cookieFor(author),
      previews: [{ name: 'a.thumb.png', bytes: png(2, 2, 32) }],
    })

    const item = (await listTopics(request)).find((topic) => topic.id === topicId)
    expect(item?.imageCount).toBe(1)
    expect(typeof item?.firstImageId).toBe('number')
    expect(item?.hasPreview).toBe(true)
  })

  it('只有原图时 hasPreview 为 false', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '只有原图')

    await uploadOne(request, topicId, { cookie: await cookieFor(author) })

    const item = (await listTopics(request)).find((topic) => topic.id === topicId)
    expect(item?.imageCount).toBe(1)
    expect(typeof item?.firstImageId).toBe('number')
    expect(item?.hasPreview).toBe(false)
  })

  it('没有图片时 firstImageId 为 null 且 hasPreview 为 false', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '没有图片')

    const item = (await listTopics(request)).find((topic) => topic.id === topicId)
    expect(item?.imageCount).toBe(0)
    expect(item?.firstImageId).toBeNull()
    expect(item?.hasPreview).toBe(false)
  })

  it('列表响应不携带图片或缩略图字节', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')
    const topicId = await createTopic(store, author, '列表不带字节')

    await uploadOne(request, topicId, {
      cookie: await cookieFor(author),
      previews: [{ name: 'a.thumb.png', bytes: png(2, 2, 32) }],
    })

    const res = await request('/api/topics')
    const raw = await res.text()
    expect(raw).not.toContain('"data"')
    expect(raw).not.toContain('base64')
  })
})

describe('POST /topics/new 与缩略图', () => {
  function plainForm(title: string): FormData {
    const form = new FormData()
    form.set('title', title)
    form.set('content', '正文')
    form.set('_csrf', CSRF_TOKEN)
    return form
  }

  function imageForm(title: string, previews: number): FormData {
    const form = plainForm(title)
    form.set('images', new File([png(2, 2, 32)], 'a.png', { type: 'image/png' }))
    for (let i = 0; i < previews; i += 1) {
      form.append(
        'previews',
        new File([png(2, 2, 32)], `a-${i}.thumb.png`, { type: 'image/png' }),
      )
    }
    return form
  }

  it('没有图片的表单仍能正常发帖', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')

    const res = await request('/topics/new', {
      method: 'POST',
      headers: { cookie: await cookieFor(author) },
      body: plainForm('纯文字新帖'),
    })
    expect(res.status).toBe(302)

    const topic = (await listTopics(request))[0]
    expect(topic?.title).toBe('纯文字新帖')
    expect(topic?.imageCount).toBe(0)
    expect(topic?.hasPreview).toBe(false)
  })

  it('内存环境带图片发帖被拒绝，而不是静默丢图', async () => {
    const { store, request } = buildApp()
    const author = await createUser(store, 'alice')

    const res = await request('/topics/new', {
      method: 'POST',
      headers: { cookie: await cookieFor(author) },
      body: imageForm('带缩略图的新帖', 1),
    })

    // 图片字节只能落在 D1（内存仓储不接受写入）。路由必须显式拒绝，
    // 而不是丢下图片假装发帖成功。页面级 previews 落库因此需要 D1 环境覆盖。
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('当前环境未启用数据库，无法上传图片')
  })
})
