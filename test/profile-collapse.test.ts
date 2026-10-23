import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_FIELD } from '../src/middleware/csrf'
import { createSessionToken, SESSION_COOKIE, hashPassword } from '../src/utils/auth'

/**
 * 个人页两条改动的回归测试：
 * 1. 退出登录从页头移到个人页，且仅本人可见；
 * 2. 最近主题与最近回复超过 4 条时折叠，并在下方给出「展开更多」。
 *
 * 数据一律直接写存储，不走 /topics/new；发帖与登录都有进程内共享的限流额度，
 * 批量造数据或反复登录会污染同一进程里的其他测试文件。
 */

const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-unit-tests-0123456789' } as Env
const PREVIEW_LIMIT = 4

function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const app = createApp(TEST_ENV, { store })
  const request = (input: string, init?: RequestInit) =>
    Promise.resolve(app.request(input, init, TEST_ENV))
  return { store, request }
}

/** 直接签发签名会话，绕开 /login 的限流；仅用于测试夹具。 */
async function sessionCookie(userId: number): Promise<string> {
  const token = await createSessionToken(TEST_ENV, userId)
  return `${SESSION_COOKIE}=${token}`
}

async function createUser(store: MemoryForumStore, username: string) {
  const created = await store.createUser(username, await hashPassword(`pw-${username}-0001`))
  if (!created.ok) throw new Error(`createUser 失败: ${created.error}`)
  return created.value
}

type TestUser = Awaited<ReturnType<typeof createUser>>

async function seedTopics(
  store: MemoryForumStore,
  user: TestUser,
  count: number,
): Promise<number[]> {
  const ids: number[] = []
  for (let i = 1; i <= count; i += 1) {
    const created = await store.createTopic(user, { title: `主题 ${i}`, content: `主题正文 ${i}` })
    if (!created.ok) throw new Error(`createTopic 失败: ${created.error}`)
    ids.push(created.value.id)
  }
  return ids
}

async function seedReplies(
  store: MemoryForumStore,
  user: TestUser,
  topicId: number,
  count: number,
): Promise<void> {
  for (let i = 1; i <= count; i += 1) {
    const created = await store.createReply(user, topicId, { content: `回复正文 ${i}` })
    if (!created.ok) throw new Error(`createReply 失败: ${created.error}`)
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/** 页面里第一个折叠控件即「最近主题」的，第二个才是「最近回复」的。 */
function splitAtCollapse(html: string, ordinal: number) {
  let start = -1
  for (let i = 0; i <= ordinal; i += 1) {
    start = html.indexOf('<details class="collapse-more"', start + 1)
    if (start === -1) return { before: html, inside: '' }
  }
  const end = html.indexOf('</details>', start)
  return { before: html.slice(0, start), inside: html.slice(start, end) }
}

describe('个人页：退出登录入口', () => {
  it('页头不再渲染退出表单，用户名入口保留', async () => {
    const { store, request } = buildApp()
    const alice = await createUser(store, 'alice')
    const cookie = await sessionCookie(alice.id)

    const response = await request('/', { headers: { cookie } })
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain('nav-username')
    expect(html).not.toContain('action="/logout"')
    expect(html).not.toContain('退出登录')
  })

  it('本人个人页显示「退出登录」，指向 /logout 并带 CSRF 字段', async () => {
    const { store, request } = buildApp()
    const alice = await createUser(store, 'alice')
    const cookie = await sessionCookie(alice.id)

    const html = await (await request('/me', { headers: { cookie } })).text()

    expect(html).toContain('退出登录')
    expect(html).toContain('action="/logout"')
    expect(html).toContain(`name="${CSRF_FIELD}"`)
  })

  it('他人个人页不显示「退出登录」', async () => {
    const { store, request } = buildApp()
    const alice = await createUser(store, 'alice')
    const bob = await createUser(store, 'bob')
    const cookie = await sessionCookie(alice.id)

    const html = await (await request(`/users/${bob.id}`, { headers: { cookie } })).text()

    expect(html).toContain('bob')
    expect(html).not.toContain('action="/logout"')
  })
})

describe('个人页：最近主题折叠', () => {
  it('恰好 4 条时全部直接显示，不出现折叠控件', async () => {
    const { store, request } = buildApp()
    const alice = await createUser(store, 'alice')
    await seedTopics(store, alice, PREVIEW_LIMIT)

    const html = await (await request(`/users/${alice.id}`)).text()

    expect(html).not.toContain('collapse-more')
    expect(countOccurrences(html, 'class="topic-title"')).toBe(PREVIEW_LIMIT)
  })

  it('超过 4 条时只显示 4 条，其余收进「展开更多」', async () => {
    const { store, request } = buildApp()
    const alice = await createUser(store, 'alice')
    await seedTopics(store, alice, PREVIEW_LIMIT + 2)

    const html = await (await request(`/users/${alice.id}`)).text()
    const { before, inside } = splitAtCollapse(html, 0)

    // 「展开更多」出现在可见的 4 条下方，折叠区内还有 2 条
    expect(countOccurrences(before, 'class="topic-title"')).toBe(PREVIEW_LIMIT)
    expect(countOccurrences(inside, 'class="topic-title"')).toBe(2)
    expect(inside).toContain('展开更多主题（还有 2 条）')
  })
})

describe('个人页：最近回复折叠', () => {
  it('恰好 4 条时全部直接显示，不出现折叠控件', async () => {
    const { store, request } = buildApp()
    const alice = await createUser(store, 'alice')
    const [topicId] = await seedTopics(store, alice, 1)
    await seedReplies(store, alice, topicId, PREVIEW_LIMIT)

    const html = await (await request(`/users/${alice.id}`)).text()

    expect(html).not.toContain('collapse-more')
    expect(countOccurrences(html, 'class="reply-item"')).toBe(PREVIEW_LIMIT)
  })

  it('超过 4 条时只显示 4 条，其余收进「展开更多」', async () => {
    const { store, request } = buildApp()
    const alice = await createUser(store, 'alice')
    const [topicId] = await seedTopics(store, alice, 1)
    await seedReplies(store, alice, topicId, PREVIEW_LIMIT + 3)

    const html = await (await request(`/users/${alice.id}`)).text()
    const { before, inside } = splitAtCollapse(html, 0)

    expect(countOccurrences(before, 'class="reply-item"')).toBe(PREVIEW_LIMIT)
    expect(countOccurrences(inside, 'class="reply-item"')).toBe(3)
    expect(inside).toContain('展开更多回复（还有 3 条）')
  })
})
