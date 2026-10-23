import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'
import { SESSION_COOKIE } from '../src/utils/auth'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'

/** 测试用会话密钥，长度足够用于签名；不是任何环境的真实凭证。 */
const TEST_SESSION_SECRET = 'test-session-secret-for-unit-tests-0123456789'

/** 无 DB、无 ENVIRONMENT 时走内存存储，等价于本地开发模式 */
const TEST_ENV = { SESSION_SECRET: TEST_SESSION_SECRET } as Env

/**
 * Hono 的 c.env 只来自 fetch(request, env) 的第二个参数，而不是 createApp 的入参。
 * 因此这里把同一个 env 一并绑定给 app.request，模拟 Pages 入口
 * functions/[[path]].ts 的调用方式；否则请求期 c.env 为 undefined，
 * 会话签发读取 SESSION_SECRET 时会直接抛错（表现为登录/注册返回 500）。
 */
function makeApp() {
  const app = createApp(TEST_ENV)
  return {
    fetch: (request: Request) => app.fetch(request, TEST_ENV),
    request: (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV),
  }
}

function cookiesOf(res: Response): Record<string, string> {
  const raw = res.headers.get('set-cookie') ?? ''
  const out: Record<string, string> = {}
  for (const part of raw.split(/,(?=[^;=]+=)/)) {
    const pair = part.split(';')[0]
    if (!pair) continue
    const index = pair.indexOf('=')
    if (index > 0) out[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
  }
  return out
}

describe('应用集成（内存存储）', () => {
  it('首页可访问，且带安全响应头', async () => {
    const res = await makeApp().request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(await res.text()).toContain('Simple Forum')
  })

  it('未登录页面不含登出表单；表单页渲染 CSRF 隐藏字段', async () => {
    const home = await (await makeApp().request('/')).text()
    expect(home).not.toContain('action="/logout"')

    const register = await (await makeApp().request('/register')).text()
    expect(register).toContain('name="_csrf"')
  })

  it('样式表以同源静态资源提供（CSP 不再需要 unsafe-inline）', async () => {
    const res = await makeApp().request('/assets/forum.css')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/css')
    const csp = (await makeApp().request('/')).headers.get('content-security-policy') ?? ''
    expect(csp).toContain("style-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
  })

  it('未登录访问发帖页会跳到登录页并带上回跳地址', async () => {
    const res = await makeApp().request('/topics/new')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('/login')
  })

  it('没有 CSRF 令牌的登录 POST 被拒绝（401 与 403 之外再多一道防线）', async () => {
    const res = await makeApp().request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'alice', password: 'demo123456' }).toString(),
    })
    expect(res.status).toBe(403)
  })

  it('错误密码即使带合法 CSRF 令牌也返回 401', async () => {
    const app = makeApp()
    const csrf = cookiesOf(await app.request('/login'))[CSRF_COOKIE] ?? ''
    const res = await app.request('/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `${CSRF_COOKIE}=${csrf}`,
      },
      body: new URLSearchParams({
        [CSRF_FIELD]: csrf,
        username: 'definitely-not-a-user',
        password: 'wrong-password',
      }).toString(),
    })
    expect(res.status).toBe(401)
  })

  it('注册 → 写入会话 Cookie → 个人页可访问', async () => {
    const app = makeApp()
    const username = `user_${Date.now()}`

    const registerPage = await app.request('/register')
    const csrf = cookiesOf(registerPage)[CSRF_COOKIE] ?? ''
    expect(csrf).toBeTruthy()

    const register = await app.request('/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `${CSRF_COOKIE}=${csrf}`,
      },
      body: new URLSearchParams({
        [CSRF_FIELD]: csrf,
        username,
        password: 'demo123456',
        confirmPassword: 'demo123456',
      }).toString(),
    })
    expect(register.status).toBe(302)

    const session = cookiesOf(register)[SESSION_COOKIE]
    expect(session).toBeTruthy()

    const me = await app.request('/me', { headers: { cookie: `${SESSION_COOKIE}=${session}` } })
    expect(me.status).toBe(200)
    expect(await me.text()).toContain(username)

    // 登录态下的响应不应被缓存
    expect(me.headers.get('cache-control')).toBe('no-store')
  })

  it('JSON API：列表可读，写操作需要 CSRF 请求头', async () => {
    const app = makeApp()

    const list = await app.request('/api/topics')
    expect(list.status).toBe(200)

    const rejected = await app.request('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '标题', content: '内容' }),
    })
    expect(rejected.status).toBe(403)
  })
})
