import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'
import { createWordFilter } from '../src/moderation/word-filter'
import { hashPassword, SESSION_COOKIE } from '../src/utils/auth'

/** 测试用会话密钥，长度足够用于签名；不是任何环境的真实凭证。 */
const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-unit-tests-0123456789' } as Env

/** 仅在本测试注入的词条，随附词库保持为空。 */
const BANNED = '测试违禁词'

type TestRequest = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 用注入的词条构建应用。
 *
 * 注意 env 必须同时交给 createApp 和每个 request：Hono 的 c.env 只来自
 * fetch(request, env) 的第二个参数，这与生产入口 functions/[[path]].ts 一致。
 */
function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const honoApp = createApp(TEST_ENV, { store, wordFilter: createWordFilter([BANNED]) })
  const request: TestRequest = (input, init) =>
    Promise.resolve(honoApp.request(input, init, TEST_ENV))
  return { store, request }
}

function cookiesOf(response: Response): Record<string, string> {
  const jar: Record<string, string> = {}
  const raw = response.headers.get('set-cookie') ?? ''
  for (const part of raw.split(/,(?=[^;=]+=)/)) {
    const pair = part.split(';')[0]
    const index = pair.indexOf('=')
    if (index > 0) {
      jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
    }
  }
  return jar
}

function readCookie(header: string, name: string): string {
  const match = header.match(new RegExp(`${name}=([^;]*)`))
  return match ? match[1] : ''
}

/** 注册一个用户，返回可直接用于后续请求的 Cookie 头 */
async function registerUser(request: TestRequest): Promise<string> {
  const page = await request('/register')
  let csrf = cookiesOf(await page)[CSRF_COOKIE] ?? ''

  const registered = await request('/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `${CSRF_COOKIE}=${csrf}`,
    },
    body: new URLSearchParams({
      [CSRF_FIELD]: csrf,
      username: 'alice',
      password: 'demo123456',
      confirmPassword: 'demo123456',
    }).toString(),
  })

  const jar = cookiesOf(registered)
  // 注册可能轮换 CSRF cookie，优先使用最新值。
  if (jar[CSRF_COOKIE]) csrf = jar[CSRF_COOKIE]
  const session = jar[SESSION_COOKIE] ?? ''
  expect(session, `注册失败，响应状态 ${registered.status}`).not.toBe('')

  return `${CSRF_COOKIE}=${csrf}; ${SESSION_COOKIE}=${session}`
}

/** 以 multipart 之外的表单编码提交帖子，同时带上 CSRF 令牌 */
async function postTopic(
  request: TestRequest,
  cookies: string,
  fields: { title: string; content: string },
): Promise<Response> {
  return request('/topics/new', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookies,
    },
    body: new URLSearchParams({
      [CSRF_FIELD]: readCookie(cookies, CSRF_COOKIE),
      title: fields.title,
      content: fields.content,
    }).toString(),
  })
}

describe('发帖违禁词检查', () => {
  it('正文命中时阻止发布，并返回带弹窗的错误页', async () => {
    const app = buildApp()
    const cookies = await registerUser(app.request)

    const response = await postTopic(app.request, cookies, {
      title: '正常标题',
      content: `正文里出现了${BANNED}这个词`,
    })

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('检测到违禁词')
    expect(html).toContain(BANNED)
    expect(html).toContain('dialog')
    expect(html).toContain('/js/banned-word-dialog.js')
  })

  it('命中时不会创建帖子', async () => {
    const app = buildApp()
    const cookies = await registerUser(app.request)

    await postTopic(app.request, cookies, {
      title: '不该出现的标题',
      content: `含${BANNED}的正文`,
    })

    const home = await app.request('/', { headers: { cookie: cookies } })
    expect(await home.text()).not.toContain('不该出现的标题')
  })

  it('标题命中时同样阻止发布，并保留已填写的内容', async () => {
    const app = buildApp()
    const cookies = await registerUser(app.request)

    const response = await postTopic(app.request, cookies, {
      title: `标题里有${BANNED}`,
      content: '这段正文是正常内容',
    })

    expect(response.status).toBe(400)
    const html = await response.text()
    // 表单内容被回填，用户只需修改命中部分
    expect(html).toContain('这段正文是正常内容')
    expect(html).toContain('标题')
  })

  it('未命中违禁词时正常发布', async () => {
    const app = buildApp()
    const cookies = await registerUser(app.request)

    const response = await postTopic(app.request, cookies, {
      title: '正常标题',
      content: '完全正常的正文内容',
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('/topics/')
  })

  it('插入空格与标点的绕过写法同样被拦截', async () => {
    const app = buildApp()
    const cookies = await registerUser(app.request)

    const spaced = BANNED.split('').join(' ')
    const response = await postTopic(app.request, cookies, {
      title: '正常标题',
      content: spaced,
    })

    expect(response.status).toBe(400)
  })
})

/** 提交回复，同时带上 CSRF 令牌 */
async function postReply(
  request: TestRequest,
  cookies: string,
  topicId: number,
  content: string,
): Promise<Response> {
  return request(`/topics/${topicId}/reply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookies,
    },
    body: new URLSearchParams({
      [CSRF_FIELD]: readCookie(cookies, CSRF_COOKIE),
      content,
    }).toString(),
  })
}

describe('回帖违禁词拦截', () => {
  /**
   * 直接建用户并走登录，返回一个可用主题 id。
   *
   * 不用 /register 是因为注册接口限流为 5 次/小时且按进程共享，
   * 本文件其余用例已用满额度，再注册会得到 429。
   */
  async function setupTopic() {
    const store = new MemoryForumStore({ seed: false })
    const honoApp = createApp(TEST_ENV, { store, wordFilter: createWordFilter([BANNED]) })
    const request: TestRequest = (input, init) =>
      Promise.resolve(honoApp.request(input, init, TEST_ENV))

    await store.createUser('bob', await hashPassword('pw-bob-0001'))

    const loginPage = await request('/login')
    const csrf = cookiesOf(loginPage)[CSRF_COOKIE] ?? ''
    const loginRes = await request('/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `${CSRF_COOKIE}=${csrf}`,
      },
      body: new URLSearchParams({
        [CSRF_FIELD]: csrf,
        username: 'bob',
        password: 'pw-bob-0001',
      }).toString(),
    })
    const session = cookiesOf(loginRes)[SESSION_COOKIE] ?? ''
    const cookies = `${CSRF_COOKIE}=${csrf}; ${SESSION_COOKIE}=${session}`

    const created = await postTopic(request, cookies, {
      title: '正常标题',
      content: '正常正文',
    })
    const topicId = Number((created.headers.get('location') ?? '').split('/').pop())

    return { store, request, cookies, topicId }
  }

  it('回帖命中违禁词时返回 400，并在原页面弹出说明', async () => {
    const { request, cookies, topicId } = await setupTopic()

    const response = await postReply(request, cookies, topicId, `回复里出现了${BANNED}`)

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(html).toContain('检测到违禁词')
    expect(html).toContain('回复未发布')
    expect(html).toContain(BANNED)
  })

  it('回帖命中违禁词时不会写入回复', async () => {
    const { store, request, cookies, topicId } = await setupTopic()

    await postReply(request, cookies, topicId, `回复里出现了${BANNED}`)

    const alice = await store.getUserByUsername('bob')
    expect(alice).not.toBeNull()
    const stats = await store.getUserStats(alice!.id)
    expect(stats.replyCount).toBe(0)
  })

  it('回帖未命中违禁词时正常写入', async () => {
    const { store, request, cookies, topicId } = await setupTopic()

    const response = await postReply(request, cookies, topicId, '这是一条正常回复')

    expect(response.status).toBe(302)
    const bobUser = await store.getUserByUsername('bob')
    expect(bobUser).not.toBeNull()
    const stats = await store.getUserStats(bobUser!.id)
    expect(stats.replyCount).toBe(1)
  })
})
