import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'
import { hashPassword, SESSION_COOKIE } from '../src/utils/auth'

/** 测试用会话密钥，长度足够用于签名；不是任何环境的真实凭证。 */
const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-unit-tests-0123456789' } as Env

type TestRequest = (input: string, init?: RequestInit) => Promise<Response>

/**
 * env 必须同时交给 createApp 和每个 request：Hono 的 c.env 只来自
 * fetch(request, env) 的第二个参数，这与生产入口 functions/[[path]].ts 一致。
 */
function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const honoApp = createApp(TEST_ENV, { store })
  const request: TestRequest = (input, init) =>
    Promise.resolve(honoApp.request(input, init, TEST_ENV))
  return { store, request }
}

/** 从响应的 Set-Cookie 中取出键值对 */
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

/**
 * 建立登录会话。
 *
 * 不走 /register：注册接口限流为进程内共享的 5 次/小时，多个用例叠加会拿到 429。
 * 这里直接写入存储，再通过 /login 拿到签名会话——登录限流是 10 次/15 分钟，
 * 因此本文件把登录次数控制在限额以内。
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
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `${CSRF_COOKIE}=${csrf}`,
    },
    body: new URLSearchParams({ [CSRF_FIELD]: csrf, username, password }).toString(),
  })
  const session = cookiesOf(loginResponse)[SESSION_COOKIE] ?? ''
  expect(session, `${username} 登录失败，状态 ${loginResponse.status}`).not.toBe('')
  return {
    cookies: `${CSRF_COOKIE}=${csrf}; ${SESSION_COOKIE}=${session}`,
    csrf,
    userId: created.value.id,
  }
}

async function createTopic(
  request: TestRequest,
  session: Session,
  title: string,
  content: string,
): Promise<number> {
  const response = await request('/topics/new', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: session.cookies },
    body: new URLSearchParams({ [CSRF_FIELD]: session.csrf, title, content }).toString(),
  })
  const location = response.headers.get('location') ?? ''
  return Number(location.split('/').pop())
}

async function createReply(
  request: TestRequest,
  session: Session,
  topicId: number,
  content: string,
): Promise<Response> {
  return request(`/topics/${topicId}/reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: session.cookies },
    body: new URLSearchParams({ [CSRF_FIELD]: session.csrf, content }).toString(),
  })
}

/** alice 发一个主题，bob 回复一次，返回双方会话与主题 id */
async function setupRepliedTopic() {
  const { store, request } = buildApp()
  const alice = await signIn(store, request, 'alice')
  const bob = await signIn(store, request, 'bob')
  const topicId = await createTopic(request, alice, '爱丽丝的主题', '主题正文')
  await createReply(request, bob, topicId, '鲍勃的回复')
  return { store, request, alice, bob, topicId }
}

const unreadOf = (request: TestRequest, session: Session) =>
  request('/api/notifications/unread', { headers: { cookie: session.cookies } })

describe('通知与公告', () => {
  it('未登录访问通知页会跳转到登录页', async () => {
    const { request } = buildApp()
    const response = await request('/notifications')
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/login')
  })

  it('未登录查询未读接口一律返回 0，不泄露是否存在通知', async () => {
    const { store, request } = buildApp()
    await store.createNotification({ kind: 'announcement', title: '公告', body: '内容' })

    const response = await request('/api/notifications/unread')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ notifications: 0, announcements: 0, total: 0 })
  })

  it('被回复后楼主产生一条未读通知，未读接口计数为 1', async () => {
    const { store, request, alice, topicId } = await setupRepliedTopic()

    const list = await store.listNotifications({ userId: alice.userId, kind: 'notification' })
    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.title).toContain('爱丽丝的主题')
    expect(list.items[0]?.body).toContain('鲍勃的回复')
    // 链接锚定到新回复：点开直接落到那条回复，而不是回到主题顶部
    expect(list.items[0]?.link).toMatch(new RegExp(`^/topics/${topicId}#reply-[0-9]+$`))
    expect(list.items[0]?.read).toBe(false)

    expect(await (await unreadOf(request, alice)).json()).toEqual({
      notifications: 1,
      announcements: 0,
      total: 1,
    })
  })

  it('自己回复自己的主题不会给自己发通知', async () => {
    const { store, request } = buildApp()
    const alice = await signIn(store, request, 'alice')
    const topicId = await createTopic(request, alice, '独白', '正文')
    await createReply(request, alice, topicId, '自问自答')

    expect((await store.countUnreadNotifications(alice.userId)).total).toBe(0)
  })

  it('打开标签只标记该标签：看公告不会读掉通知，看通知后红点消失', async () => {
    const { request, alice } = await setupRepliedTopic()

    // 只看公告：通知仍未读，导航上应出现服务端渲染的红点
    const announcementTab = await request('/notifications?tab=announcements', {
      headers: { cookie: alice.cookies },
    })
    const announcementHtml = await announcementTab.text()
    expect(announcementTab.status).toBe(200)
    expect(announcementHtml).toContain('<span class="nav-dot"')
    expect(announcementHtml).toContain('1 条未读')
    expect(await (await unreadOf(request, alice)).json()).toEqual({
      notifications: 1,
      announcements: 0,
      total: 1,
    })

    // 再看通知：内容被列出，并标记已读
    const notificationTab = await request('/notifications', { headers: { cookie: alice.cookies } })
    const notificationHtml = await notificationTab.text()
    expect(notificationHtml).toContain('爱丽丝的主题')
    expect(notificationHtml).toContain('鲍勃的回复')
    expect(notificationHtml).toContain('公告')
    expect(await (await unreadOf(request, alice)).json()).toEqual({
      notifications: 0,
      announcements: 0,
      total: 0,
    })

    // 已无未读，导航不再渲染红点元素
    const revisited = await request('/notifications', { headers: { cookie: alice.cookies } })
    expect(await revisited.text()).not.toContain('<span class="nav-dot"')
  })

  it('公告对所有登录用户可见，已读状态互不影响', async () => {
    const { store, request } = buildApp()
    const alice = await signIn(store, request, 'alice')
    const bob = await signIn(store, request, 'bob')
    await store.createNotification({ kind: 'announcement', title: '站点公告', body: '今晚维护' })

    const alicePage = await request('/notifications?tab=announcements', {
      headers: { cookie: alice.cookies },
    })
    expect(await alicePage.text()).toContain('今晚维护')

    expect(await (await unreadOf(request, bob)).json()).toEqual({
      notifications: 0,
      announcements: 1,
      total: 1,
    })
  })

  it('导航渲染通知入口，并由脚本查询未读数补齐红点', async () => {
    const { request } = buildApp()
    const html = await (await request('/')).text()

    expect(html).toContain('href="/notifications"')
    expect(html).toContain('data-unread-slot')
    expect(html).toContain('data-unread-endpoint="/api/notifications/unread"')
    expect(html).toContain('/js/notifications-badge.js')
    // 首屏未登录、没有未读，不应出现红点元素
    expect(html).not.toContain('<span class="nav-dot"')

    // 铃铛图标靠样式表里的 CSS mask 上色，因此要在样式表中核对引用
    const css = await (await request('/assets/forum.css')).text()
    expect(css).toContain("url('/icons/notification.svg')")
    expect(css).toContain('.nav-bell')
  })

  it('回复通知说明是谁回复、只保留内容摘要，并锚定到该回复', async () => {
    const { store, request, alice, bob, topicId } = await setupRepliedTopic()

    // 超长回复：只保留前 100 个字符，并加省略号
    const long = 'A'.repeat(150)
    expect((await createReply(request, bob, topicId, long)).status).toBe(302)
    let list = await store.listNotifications({ userId: alice.userId, kind: 'notification' })
    expect(list.items[0]?.title).toContain('bob')
    expect(list.items[0]?.title).toContain('爱丽丝的主题')
    expect(list.items[0]?.body).toBe('A'.repeat(100) + '…')
    expect(list.items[0]?.link).toMatch(new RegExp('^/topics/' + topicId + '#reply-[0-9]+$'))

    // 链接里的锚点必须在主题页里真实存在，否则点开落不到那条回复
    const link = list.items[0]?.link ?? ''
    const anchor = link.slice(link.indexOf('#') + 1)
    expect(anchor).toMatch(/^reply-[0-9]+$/)
    expect(await (await request(link.split('#')[0])).text()).toContain(anchor)

    // emoji 按码点截断，不会留下半个字符
    const emoji = String.fromCodePoint(0x1F600)
    expect((await createReply(request, bob, topicId, emoji.repeat(150))).status).toBe(302)
    list = await store.listNotifications({ userId: alice.userId, kind: 'notification' })
    const emojiBody = list.items[0]?.body ?? ''
    expect(Array.from(emojiBody)).toHaveLength(101)
    expect(emojiBody).toBe(emoji.repeat(100) + '…')
    expect(emojiBody).not.toContain(String.fromCharCode(0xFFFD))

    // 短回复不截断、不加省略号
    expect((await createReply(request, bob, topicId, '简短回复')).status).toBe(302)
    list = await store.listNotifications({ userId: alice.userId, kind: 'notification' })
    expect(list.items[0]?.body).toBe('简短回复')

    // 超长主题名在通知标题里同样被截断
    const longTitle = 'T'.repeat(50)
    const otherTopicId = await createTopic(request, alice, longTitle, '正文')
    expect((await createReply(request, bob, otherTopicId, '回复')).status).toBe(302)
    list = await store.listNotifications({ userId: alice.userId, kind: 'notification' })
    expect(list.items[0]?.title).toContain('T'.repeat(40) + '…')
    expect(list.items[0]?.title).not.toContain('T'.repeat(41))
  })
})
