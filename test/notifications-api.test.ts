import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'
import { hashPassword, SESSION_COOKIE } from '../src/utils/auth'

/**
 * GET /api/notifications —— 供安卓客户端展示完整通知/公告列表的只读接口。
 *
 * 为什么单独成一个文件：登录接口限流是**进程内共享**的 10 次 / 15 分钟，
 * notifications.test.ts 已经用满该额度，用例放进去会拿到 429 而不是端点结果。
 * 独立文件在独立 worker 中运行，才有全新的计数桶。
 *
 * 用例直接构造通知数据（不经过发帖/回复），这样测的是读接口本身的契约。
 */

const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-unit-tests-0123456789' } as Env

type TestRequest = (input: string, init?: RequestInit) => Promise<Response>

function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const honoApp = createApp(TEST_ENV, { store })
  const request: TestRequest = (input, init) =>
    Promise.resolve(honoApp.request(input, init, TEST_ENV))
  return { store, request }
}

function cookiesOf(response: Response): Record<string, string> {
  const jar: Record<string, string> = {}
  // 运行时 Headers 有 getSetCookie，但当前 @types/node 的声明里没有，这里显式断言
  const headers = response.headers as Headers & { getSetCookie: () => string[] }
  for (const raw of headers.getSetCookie()) {
    const pair = raw.split(';')[0] ?? ''
    const index = pair.indexOf('=')
    if (index <= 0) continue
    jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
  }
  return jar
}

interface Session {
  cookies: string
  csrf: string
  userId: number
}

async function signIn(
  store: MemoryForumStore,
  request: TestRequest,
  username: string,
): Promise<Session> {
  const password = `pw-${username}-0001`
  const created = await store.createUser(username, await hashPassword(password))
  expect(created.ok, `创建用户 ${username} 失败`).toBe(true)
  if (!created.ok) throw new Error('unreachable')

  const loginPage = await request('/login')
  const csrf = cookiesOf(loginPage)[CSRF_COOKIE] ?? ''
  const loginResponse = await request('/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `${CSRF_COOKIE}=${csrf}`,
    },
    body: new URLSearchParams({ username, password, [CSRF_FIELD]: csrf }).toString(),
  })
  const session = cookiesOf(loginResponse)[SESSION_COOKIE] ?? ''
  expect(session, `${username} 登录失败，状态 ${loginResponse.status}`).toBeTruthy()
  return {
    cookies: `${CSRF_COOKIE}=${csrf}; ${SESSION_COOKIE}=${session}`,
    csrf,
    userId: created.value.id,
  }
}

type NotificationBody = {
  kind: string
  items: { kind: string; title: string; read: boolean }[]
  nextCursor: string | null
  prevCursor: string | null
  counts: { notifications: number; announcements: number; total: number }
}

describe('GET /api/notifications', () => {
  it('未登录返回 401', async () => {
    const { request } = buildApp()
    const response = await request('/api/notifications')
    expect(response.status).toBe(401)
  })

  it('返回定向通知，read 反映未读状态，并带分页游标字段', async () => {
    const { store, request } = buildApp()
    const alice = await signIn(store, request, 'alice')
    const created = await store.createNotification({
      kind: 'notification',
      userId: alice.userId,
      title: '有人回复了你的主题',
      body: '内容',
    })
    expect(created.ok).toBe(true)

    const response = await request('/api/notifications', {
      headers: { cookie: alice.cookies },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as NotificationBody
    expect(body.kind).toBe('notification')
    expect(body.items.length).toBe(1)
    expect(body.items[0]?.kind).toBe('notification')
    expect(body.items[0]?.title).toBe('有人回复了你的主题')
    expect(body.items[0]?.read).toBe(false)
    expect(body.counts.notifications).toBe(1)
    expect(body).toHaveProperty('nextCursor')
    expect(body).toHaveProperty('prevCursor')
  })

  it('是只读的：连续 GET 不会把未读清零', async () => {
    const { store, request } = buildApp()
    const alice = await signIn(store, request, 'alice')
    await store.createNotification({
      kind: 'notification',
      userId: alice.userId,
      title: '未读通知',
      body: '内容',
    })
    const before = await store.countUnreadNotifications(alice.userId)
    expect(before.notifications).toBe(1)

    await request('/api/notifications', { headers: { cookie: alice.cookies } })
    await request('/api/notifications', { headers: { cookie: alice.cookies } })

    const after = await store.countUnreadNotifications(alice.userId)
    expect(after.notifications).toBe(1)
  })

  it('公告对所有登录用户可见，已读状态互不影响', async () => {
    const { store, request } = buildApp()
    const alice = await signIn(store, request, 'alice')
    const bob = await signIn(store, request, 'bob')
    const created = await store.createNotification({
      kind: 'announcement',
      title: '服务器维护',
      body: '本周日凌晨维护。',
    })
    expect(created.ok).toBe(true)

    const aliceView = await request('/api/notifications?kind=announcement', {
      headers: { cookie: alice.cookies },
    })
    const bobView = await request('/api/notifications?kind=announcement', {
      headers: { cookie: bob.cookies },
    })
    const aliceBody = (await aliceView.json()) as NotificationBody
    const bobBody = (await bobView.json()) as NotificationBody
    expect(aliceBody.kind).toBe('announcement')
    expect(aliceBody.items[0]?.title).toBe('服务器维护')
    expect(bobBody.items[0]?.title).toBe('服务器维护')
    expect(aliceBody.items[0]?.read).toBe(false)

    await store.markNotificationsRead(bob.userId, 'announcement')

    const aliceAgain = await request('/api/notifications?kind=announcement', {
      headers: { cookie: alice.cookies },
    })
    const aliceAgainBody = (await aliceAgain.json()) as NotificationBody
    expect(aliceAgainBody.items[0]?.read).toBe(false)
    expect(aliceAgainBody.counts.announcements).toBe(1)
  })

  it('limit 生效并返回 nextCursor', async () => {
    const { store, request } = buildApp()
    const alice = await signIn(store, request, 'alice')
    await store.createNotification({
      kind: 'notification',
      userId: alice.userId,
      title: '第一条',
      body: '内容',
    })
    await store.createNotification({
      kind: 'notification',
      userId: alice.userId,
      title: '第二条',
      body: '内容',
    })

    const response = await request('/api/notifications?limit=1', {
      headers: { cookie: alice.cookies },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as NotificationBody
    expect(body.items.length).toBe(1)
    expect(body.nextCursor).not.toBeNull()
  })
})
