import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import { PROFILE_PAGE_SIZE } from '../src/services/profile'
import type { Env } from '../src/env'
import type { Topic, User } from '../src/types'
import { hashPassword } from '../src/utils/auth'

const TEST_ENV = { SESSION_SECRET: 'profile-api-session-secret-0123456789' } as Env

/** 数据一律直接写存储，不走 /api 写接口：登录与发帖都有进程内共享的限流额度，
 * 用 HTTP 建数据会互相挤占配额，让测试变得依赖执行顺序。 */
function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const app = createApp(TEST_ENV, { store })
  return { store, app }
}

async function createUser(store: MemoryForumStore, username: string): Promise<User> {
  const created = await store.createUser(username, await hashPassword('password-0123456789'))
  if (!created.ok) throw new Error(`创建用户失败：${username}`)
  return created.value
}

async function createTopic(store: MemoryForumStore, user: User, title: string): Promise<Topic> {
  const created = await store.createTopic(user, { title, content: `${title} 的正文` })
  if (!created.ok) throw new Error(`创建主题失败：${title}`)
  return created.value
}

interface ProfileResponse {
  profile: User
  stats: { topicCount: number; replyCount: number }
  topics: { items: (Topic & { hasPreview: boolean })[]; nextCursor: string | null; prevCursor: string | null }
  replies: { items: { id: number }[]; nextCursor: string | null; prevCursor: string | null }
}

describe('GET /api/users/:id/profile', () => {
  it('未携带 Cookie 也能读取（公开端点），返回资料聚合', async () => {
    const { store, app } = buildApp()
    const alice = await createUser(store, 'alice')
    const bob = await createUser(store, 'bob')

    const first = await createTopic(store, alice, '第一帖')
    const second = await createTopic(store, alice, '第二帖')
    await store.createReply(alice, first.id, { content: '自回一' })
    await store.createReply(bob, first.id, { content: '别人的回复' })
    await store.createReply(alice, second.id, { content: '自回二' })

    const res = await app.request(`/api/users/${alice.id}/profile`, {}, TEST_ENV)
    expect(res.status).toBe(200)

    const body = (await res.json()) as ProfileResponse

    expect(body.profile.id).toBe(alice.id)
    expect(body.profile.username).toBe('alice')
    // 只统计本人：bob 的回复不计入
    expect(body.stats).toEqual({ topicCount: 2, replyCount: 2 })
    expect(body.topics.items.map((topic) => topic.title).sort()).toEqual(['第一帖', '第二帖'])
    expect(body.replies.items).toHaveLength(2)
  })

  it('不泄露密码哈希等内部字段', async () => {
    const { store, app } = buildApp()
    const alice = await createUser(store, 'alice')

    const res = await app.request(`/api/users/${alice.id}/profile`, {}, TEST_ENV)
    const body = (await res.json()) as ProfileResponse

    expect(Object.keys(body.profile)).not.toContain('passwordHash')
    expect(JSON.stringify(body)).not.toContain('password-0123456789')
  })

  it('主题项与 /api/topics 保持一致，带 hasPreview 增量字段', async () => {
    const { store, app } = buildApp()
    const alice = await createUser(store, 'alice')
    await createTopic(store, alice, '没有配图的帖子')

    const res = await app.request(`/api/users/${alice.id}/profile`, {}, TEST_ENV)
    const body = (await res.json()) as ProfileResponse

    // 未上传任何图片，因此封面一律没有缩略图
    expect(body.topics.items).toHaveLength(1)
    expect(body.topics.items[0].hasPreview).toBe(false)
  })

  it('limit 控制每个列表的条数', async () => {
    const { store, app } = buildApp()
    const alice = await createUser(store, 'alice')
    for (let i = 1; i <= PROFILE_PAGE_SIZE + 3; i += 1) {
      await createTopic(store, alice, `主题 ${i}`)
    }

    const limited = await app.request(`/api/users/${alice.id}/profile?limit=2`, {}, TEST_ENV)
    expect(limited.status).toBe(200)
    const limitedBody = (await limited.json()) as ProfileResponse
    expect(limitedBody.topics.items).toHaveLength(2)

    // 非法值回退到服务端默认条数，而不是报错
    const fallback = await app.request(`/api/users/${alice.id}/profile?limit=abc`, {}, TEST_ENV)
    expect(fallback.status).toBe(200)
    const fallbackBody = (await fallback.json()) as ProfileResponse
    expect(fallbackBody.topics.items).toHaveLength(PROFILE_PAGE_SIZE)
  })

  it('没有内容的用户返回空列表而不是 404', async () => {
    const { store, app } = buildApp()
    const fresh = await createUser(store, 'fresh')

    const res = await app.request(`/api/users/${fresh.id}/profile`, {}, TEST_ENV)
    expect(res.status).toBe(200)

    const body = (await res.json()) as ProfileResponse
    expect(body.stats).toEqual({ topicCount: 0, replyCount: 0 })
    expect(body.topics.items).toHaveLength(0)
    expect(body.replies.items).toHaveLength(0)
  })

  it('未知用户与非法 id 都返回 404', async () => {
    const { app } = buildApp()

    const missing = await app.request('/api/users/999999/profile', {}, TEST_ENV)
    expect(missing.status).toBe(404)

    const malformed = await app.request('/api/users/abc/profile', {}, TEST_ENV)
    expect(malformed.status).toBe(404)
  })
})
