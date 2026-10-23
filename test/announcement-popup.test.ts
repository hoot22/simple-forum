import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'
import { hashPassword, SESSION_COOKIE } from '../src/utils/auth'

/** 测试用会话密钥，长度足够用于签名；不是任何环境的真实凭证。 */
const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-unit-tests-0123456789' } as Env

type TestRequest = (input: string, init?: RequestInit) => Promise<Response>

interface Session {
  cookies: string
  csrf: string
  userId: number
}

function cookiesOf(res: Response): Record<string, string> {
  const jar: Record<string, string> = {}
  // 运行时 Headers 有 getSetCookie，但当前 @types/node 的声明里没有，这里显式断言
  const headers = res.headers as Headers & { getSetCookie: () => string[] }
  for (const raw of headers.getSetCookie()) {
    const [pair = ''] = raw.split(';')
    const index = pair.indexOf('=')
    if (index <= 0) continue
    jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
  }
  return jar
}

/**
 * 建立登录会话。
 *
 * 与 test/notifications.test.ts 同策略：不走 /register（注册限流 5 次/小时为进程内共享），
 * 直接写入存储再走 /login 取签名会话，并把本文件的登录次数控制在限额内。
 */
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
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `forum_csrf=${csrf}` },
    body: new URLSearchParams({ [CSRF_FIELD]: csrf, username, password }).toString(),
  })
  const session = cookiesOf(loginResponse)[SESSION_COOKIE] ?? ''
  expect(session, `登录 ${username} 未拿到会话 cookie`).not.toBe('')
  return { cookies: `forum_csrf=${csrf}; ${SESSION_COOKIE}=${session}`, csrf, userId: created.value.id }
}

/** 每个用例都新建应用实例，但整个文件只登录一次，避免叠加登录限流额度。 */
function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const honoApp = createApp(TEST_ENV, { store })
  const request: TestRequest = (input, init) =>
    Promise.resolve(honoApp.request(input, init, TEST_ENV))
  return { store, request }
}

let shared: Promise<{ store: MemoryForumStore; request: TestRequest; session: Session }> | null =
  null

function setup() {
  if (shared === null) {
    shared = (async () => {
      const { store, request } = buildApp()
      const session = await signIn(store, request, 'notice-admin')
      return { store, request, session }
    })()
  }
  return shared
}

async function publish(store: MemoryForumStore, title: string, body: string, link: string | null) {
  const created = await store.createNotification({ kind: 'announcement', title, body, link })
  expect(created.ok, `发布公告 ${title} 失败`).toBe(true)
  return created
}

interface AnnouncementPayload {
  id: number
  title: string
  body: string
  link: string | null
  createdAt: string
  createdAtText: string
}

async function fetchUnread(
  request: TestRequest,
  session: Session | null,
): Promise<AnnouncementPayload[]> {
  const response = await request('/api/announcements/unread', {
    headers: session ? { cookie: session.cookies } : {},
  })
  expect(response.status).toBe(200)
  const data = (await response.json()) as { announcements: AnnouncementPayload[] }
  return data.announcements
}

describe('公告弹窗接口', () => {
  it('未登录访问时返回空数组，不暴露公告内容', async () => {
    const { store, request } = await setup()
    await publish(store, '匿名可见性检查', '未登录不该看到这条公告', null)

    const announcements = await fetchUnread(request, null)
    expect(announcements).toEqual([])
  })

  it('登录后返回未读公告的标题、正文、链接与北京时间文本', async () => {
    const { store, request, session } = await setup()
    await publish(store, '维护通知', '今晚 23:00 例行维护\n预计 30 分钟', '/topics/1')

    const announcements = await fetchUnread(request, session)
    const target = announcements.find((item) => item.title === '维护通知')
    expect(target).toBeDefined()
    expect(target?.body).toBe('今晚 23:00 例行维护\n预计 30 分钟')
    expect(target?.link).toBe('/topics/1')
    // 服务端已换算为北京时间文本，客户端不再自己处理时区。
    expect(target?.createdAtText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('标记已读后不再返回，体现「展示过一次就不再展示」', async () => {
    const { store, request, session } = await setup()
    await publish(store, '已读检查', '看完就不该再弹', null)

    const marked = await request('/api/announcements/read', {
      method: 'POST',
      headers: { cookie: session.cookies, 'x-csrf-token': session.csrf },
    })
    expect(marked.status).toBe(200)
    expect(await marked.json()).toEqual({ ok: true })

    expect(await fetchUnread(request, session)).toEqual([])
  })

  it('标记已读之后新发布的公告仍会返回', async () => {
    const { store, request, session } = await setup()
    await publish(store, '旧公告', '不该再出现', null)
    await request('/api/announcements/read', {
      method: 'POST',
      headers: { cookie: session.cookies, 'x-csrf-token': session.csrf },
    })

    await publish(store, '新公告', '这条要弹出来', null)
    const announcements = await fetchUnread(request, session)
    expect(announcements.map((item) => item.title)).toEqual(['新公告'])
  })

  it('返回全部未读公告，且最新的在前', async () => {
    const { store, request, session } = await setup()
    // 先清掉前面用例遗留的未读状态，断言不依赖用例执行顺序。
    await request('/api/announcements/read', {
      method: 'POST',
      headers: { cookie: session.cookies, 'x-csrf-token': session.csrf },
    })

    for (const index of [1, 2, 3, 4]) {
      await publish(store, `批量公告 ${index}`, `正文 ${index}`, null)
    }

    const announcements = await fetchUnread(request, session)
    // 弹窗展示的条数必须与随后标记已读的条数一致，因此不设上限。
    expect(announcements.map((item) => item.title)).toEqual([
      '批量公告 4',
      '批量公告 3',
      '批量公告 2',
      '批量公告 1',
    ])
  })

  it('标记公告已读不会影响定向通知的未读数', async () => {
    const { store, request, session } = await setup()
    await publish(store, '互不影响检查', '公告已读与定向通知无关', null)
    const notification = await store.createNotification({
      kind: 'notification',
      userId: session.userId,
      title: '有人回复了你',
      body: '正文',
      link: '/topics/1',
    })
    expect(notification.ok).toBe(true)

    await request('/api/announcements/read', {
      method: 'POST',
      headers: { cookie: session.cookies, 'x-csrf-token': session.csrf },
    })

    const counts = await request('/api/notifications/unread', {
      headers: { cookie: session.cookies },
    })
    const data = (await counts.json()) as { notifications: number; announcements: number }
    expect(data.notifications).toBe(1)
    expect(data.announcements).toBe(0)
  })

  it('未登录标记已读返回 401', async () => {
    const { request } = await setup()
    const page = await request('/login')
    const csrf = cookiesOf(page)[CSRF_COOKIE] ?? ''

    const response = await request('/api/announcements/read', {
      method: 'POST',
      headers: { cookie: `forum_csrf=${csrf}`, 'x-csrf-token': csrf },
    })
    expect(response.status).toBe(401)
  })

  it('缺少 CSRF 令牌时标记已读被拒绝', async () => {
    const { request, session } = await setup()
    const response = await request('/api/announcements/read', {
      method: 'POST',
      headers: { cookie: session.cookies },
    })
    expect(response.status).toBe(403)
  })
})

describe('公告弹窗脚本', () => {
  it('页面挂载公告弹窗脚本', async () => {
    const { request, session } = await setup()
    const page = await request('/', { headers: { cookie: session.cookies } })
    const html = await page.text()
    expect(html).toContain('/js/announcement-popup.js')
  })

  it('脚本读取未读接口、提交已读接口，并跳过公告页', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../public/js/announcement-popup.js', import.meta.url)),
      'utf8',
    )
    expect(source).toContain('/api/announcements/unread')
    expect(source).toContain('/api/announcements/read')
    expect(source).toContain("=== '/notifications'")
    // 公告内容一律走 textContent，避免拼 HTML 带来的注入风险。
    expect(source).not.toContain('innerHTML')
  })
})
