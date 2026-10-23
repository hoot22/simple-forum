import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'
import { hashPassword, SESSION_COOKIE } from '../src/utils/auth'

/**
 * 嵌套回复（评论某条评论）的行为验证。
 *
 * 会话与限流说明：/login 限流按进程共享，所以整个文件只登录两个固定用户（alice / bob），
 * 各用例共用同一个应用实例，用「每次新建主题」来隔离数据，避免互相污染。
 */

const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-unit-tests-0123456789' } as Env
type TestRequest = (input: string, init?: RequestInit) => Promise<Response>

function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const honoApp = createApp(TEST_ENV, { store })
  // Hono 的 c.env 只来自 fetch 的第二个参数，必须同时交给 createApp 和每个 request
  const request: TestRequest = (input, init) => Promise.resolve(honoApp.request(input, init, TEST_ENV))
  return { store, request }
}

type App = ReturnType<typeof buildApp>

function cookiesOf(response: Response): Record<string, string> {
  const jar: Record<string, string> = {}
  const raw = response.headers.get('set-cookie') ?? ''
  for (const part of raw.split(',')) {
    const [pair] = part.split(';')
    if (!pair) continue
    const index = pair.indexOf('=')
    if (index > 0) {
      jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
    }
  }
  return jar
}

function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

/** 建用户并登录，返回带会话与 CSRF 的 cookie jar。 */
async function login(app: App, username: string): Promise<{ id: number; jar: Record<string, string> }> {
  const password = `pw-${username}-0001`
  const created = await app.store.createUser(username, await hashPassword(password))
  if (!created.ok) throw new Error(`创建用户 ${username} 失败`)

  const loginPage = await app.request('/login')
  const jar = cookiesOf(loginPage)
  const csrf = jar[CSRF_COOKIE]
  if (!csrf) throw new Error('登录页未下发 CSRF Cookie')

  const response = await app.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: new URLSearchParams({ [CSRF_FIELD]: csrf, username, password }).toString(),
  })
  const sessionJar = { ...jar, ...cookiesOf(response) }
  if (!sessionJar[SESSION_COOKIE]) throw new Error(`登录 ${username} 未拿到会话 Cookie`)
  return { id: created.value.id, jar: sessionJar }
}

/** 只登录一次，供全部用例复用。 */
let shared: Promise<{
  app: App
  alice: { id: number; jar: Record<string, string> }
  bob: { id: number; jar: Record<string, string> }
}> | null = null

function setup() {
  shared ??= (async () => {
    const app = buildApp()
    const alice = await login(app, 'alice')
    const bob = await login(app, 'bob')
    return { app, alice, bob }
  })()
  return shared
}

/** 直接用存储层建主题，绕开发帖限流。 */
async function makeTopic(app: App, authorId: number, title: string): Promise<number> {
  const user = await app.store.getUserById(authorId)
  if (user === null) throw new Error('作者不存在')
  const topic = await app.store.createTopic(user, { title, content: `${title} 的正文` })
  if (!topic.ok) throw new Error('建主题失败')
  return topic.value.id
}

function postReply(
  app: App,
  jar: Record<string, string>,
  topicId: number,
  fields: Record<string, string>,
): Promise<Response> {
  return app.request(`/topics/${topicId}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(jar) },
    body: new URLSearchParams({ [CSRF_FIELD]: jar[CSRF_COOKIE] ?? '', ...fields }).toString(),
  })
}

async function notificationCount(app: App, userId: number): Promise<number> {
  const page = await app.store.listNotifications({ userId, kind: 'notification', limit: 50 })
  return page.items.length
}

describe('嵌套回复', () => {
  it('存储层记录父回复，并能反查父回复作者', async () => {
    const { app, alice, bob } = await setup()
    const topicId = await makeTopic(app, alice.id, '存储层嵌套')

    const aliceUser = await app.store.getUserById(alice.id)
    const bobUser = await app.store.getUserById(bob.id)
    expect(aliceUser).not.toBeNull()
    expect(bobUser).not.toBeNull()
    if (aliceUser === null || bobUser === null) return

    const root = await app.store.createReply(aliceUser, topicId, { content: '一楼' })
    expect(root.ok).toBe(true)
    if (!root.ok) return

    const child = await app.store.createReply(bobUser, topicId, {
      content: '回复一楼',
      parentReplyId: root.value.id,
    })
    expect(child.ok).toBe(true)
    if (!child.ok) return

    const fetched = await app.store.getReplyById(child.value.id)
    expect(fetched?.parentReplyId).toBe(root.value.id)
    expect(fetched?.parentAuthor).toBe('alice')

    // 顶层回复没有父回复，未知 ID 一律返回 null
    const rootFetched = await app.store.getReplyById(root.value.id)
    expect(rootFetched?.parentReplyId).toBeNull()
    expect(await app.store.getReplyById(999_999)).toBeNull()
  })

  it('通过表单回复某条评论后，子回复缩进渲染在父回复下方', async () => {
    const { app, alice, bob } = await setup()
    const topicId = await makeTopic(app, alice.id, '页面嵌套')

    const bobUser = await app.store.getUserById(bob.id)
    if (bobUser === null) throw new Error('bob 不存在')
    const root = await app.store.createReply(bobUser, topicId, { content: '二楼的问题' })
    if (!root.ok) throw new Error('建回复失败')

    const response = await postReply(app, alice.jar, topicId, {
      content: '回复二楼',
      parentReplyId: String(root.value.id),
    })
    expect(response.status).toBe(302)

    const detail = await app.store.getTopicDetail({ topicId })
    const child = detail?.replies.items.find((r) => r.content === '回复二楼')
    expect(child?.parentReplyId).toBe(root.value.id)

    const html = await (await app.request(`/topics/${topicId}`)).text()
    expect(html).toContain('reply-children')
    expect(html).toContain(`id="reply-${root.value.id}"`)
    expect(html).toContain(`id="reply-${child?.id}"`)
  })

  it('?replyTo= 让回复表单带上级回复 ID 与回复对象', async () => {
    const { app, alice, bob } = await setup()
    const topicId = await makeTopic(app, alice.id, '预选回复目标')

    const bobUser = await app.store.getUserById(bob.id)
    if (bobUser === null) throw new Error('bob 不存在')
    const root = await app.store.createReply(bobUser, topicId, { content: '要被回复的楼层' })
    if (!root.ok) throw new Error('建回复失败')

    const html = await (await app.request(`/topics/${topicId}?replyTo=${root.value.id}`, {
      headers: { cookie: cookieHeader(alice.jar) },
    })).text()
    expect(html).toContain(`name="parentReplyId" value="${root.value.id}"`)
    expect(html).toContain('正在回复')
    expect(html).toContain('@bob')
  })

  it('不存在的 replyTo 不预选目标，按普通回帖渲染', async () => {
    const { app, alice } = await setup()
    const topicId = await makeTopic(app, alice.id, '无效回复目标')

    const html = await (await app.request(`/topics/${topicId}?replyTo=999999`, {
      headers: { cookie: cookieHeader(alice.jar) },
    })).text()
    expect(html).not.toContain('name="parentReplyId"')
    expect(html).not.toContain('正在回复')
  })

  it('非法或跨主题的父回复会被拒绝，且不写入回复', async () => {
    const { app, alice, bob } = await setup()
    const topicA = await makeTopic(app, alice.id, '主题 A')
    const topicB = await makeTopic(app, bob.id, '主题 B')

    const bobUser = await app.store.getUserById(bob.id)
    if (bobUser === null) throw new Error('bob 不存在')
    const rootInB = await app.store.createReply(bobUser, topicB, { content: 'B 主题的楼层' })
    if (!rootInB.ok) throw new Error('建回复失败')

    const beforeA = (await app.store.getTopicById(topicA))?.replyCount ?? 0

    // 非数字
    const invalid = await postReply(app, alice.jar, topicA, { content: '非法 ID', parentReplyId: 'abc' })
    expect(invalid.status).toBe(400)

    // 跨主题
    const crossTopic = await postReply(app, alice.jar, topicA, {
      content: '跨主题偷渡',
      parentReplyId: String(rootInB.value.id),
    })
    expect(crossTopic.status).toBe(400)

    const afterA = (await app.store.getTopicById(topicA))?.replyCount ?? 0
    expect(afterA).toBe(beforeA)
  })

  it('回复某条评论只通知被回复作者，不通知楼主；自己回复自己不通知', async () => {
    const { app, alice, bob } = await setup()
    const topicId = await makeTopic(app, alice.id, '嵌套通知')

    const bobUser = await app.store.getUserById(bob.id)
    if (bobUser === null) throw new Error('bob 不存在')
    const root = await app.store.createReply(bobUser, topicId, { content: 'bob 的评论' })
    if (!root.ok) throw new Error('建回复失败')

    const aliceBefore = await notificationCount(app, alice.id)
    const bobBefore = await notificationCount(app, bob.id)

    // alice 回复 bob 的评论：应只通知 bob
    const first = await postReply(app, alice.jar, topicId, {
      content: '回复 bob',
      parentReplyId: String(root.value.id),
    })
    expect(first.status).toBe(302)

    expect(await notificationCount(app, bob.id)).toBe(bobBefore + 1)
    expect(await notificationCount(app, alice.id)).toBe(aliceBefore)

    // bob 回复自己的评论：不产生新通知
    const bobBefore2 = await notificationCount(app, bob.id)
    const second = await postReply(app, bob.jar, topicId, {
      content: '回复自己',
      parentReplyId: String(root.value.id),
    })
    expect(second.status).toBe(302)
    expect(await notificationCount(app, bob.id)).toBe(bobBefore2)
  })

  it('父回复不在当前页时，子回复仍展示并标注被回复的人', async () => {
    const { app, alice, bob } = await setup()
    const topicId = await makeTopic(app, alice.id, '翻页后的嵌套')

    const bobUser = await app.store.getUserById(bob.id)
    const aliceUser = await app.store.getUserById(alice.id)
    if (bobUser === null || aliceUser === null) throw new Error('用户不存在')

    const oldRoot = await app.store.createReply(bobUser, topicId, { content: '很早的一楼' })
    if (!oldRoot.ok) throw new Error('建回复失败')

    // 回复分页为 20 条一页，填够 21 条把老楼层挤出第一页
    for (let i = 0; i < 21; i += 1) {
      await app.store.createReply(aliceUser, topicId, { content: `填充回复 ${i}` })
    }

    const child = await app.store.createReply(aliceUser, topicId, {
      content: '回复很早的一楼',
      parentReplyId: oldRoot.value.id,
    })
    if (!child.ok) throw new Error('建回复失败')

    const html = await (await app.request(`/topics/${topicId}`)).text()
    // 父回复被翻页隔开，子回复作为根楼层展示，但对象标注不能丢
    expect(html).toContain(`id="reply-${child.value.id}"`)
    expect(html).toContain('@bob')
    expect(html).toContain('reply-target')
  })

  it('未登录访客看不到「回复」入口', async () => {
    const { app, alice } = await setup()
    const topicId = await makeTopic(app, alice.id, '访客视角')

    const response = await app.request(`/topics/${topicId}`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).not.toContain('reply-actions')
    expect(html).not.toContain('reply-form')
  })
})
