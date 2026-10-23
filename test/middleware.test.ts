import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_FIELD, CSRF_HEADER, csrfProtection, csrfToken } from '../src/middleware/csrf'
import { rateLimit } from '../src/middleware/rate-limit'
import { securityHeaders } from '../src/middleware/security-headers'

/** 从响应里解析出所有 Cookie 键值（本项目只用 Max-Age，不含逗号，可安全切分） */
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

function formRequest(path: string, fields: Record<string, string>, token?: string): {
  path: string
  init: RequestInit
} {
  const body = new URLSearchParams(fields).toString()
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
  if (token) headers.cookie = `${CSRF_COOKIE}=${token}`
  return { path, init: { method: 'POST', headers, body } }
}

describe('securityHeaders', () => {
  function buildApp() {
    const app = new Hono<{ Bindings: Env }>()
    app.use(securityHeaders())
    app.get('/', (c) => c.text('ok'))
    return app
  }

  it('正常响应带 CSP 与防嗅探/防嵌套头', async () => {
    const res = await buildApp().request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })

  it('http 下不下发 HSTS，避免把本地开发锁进 HTTPS', async () => {
    const res = await buildApp().request('http://localhost/')
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })

  it('404 响应同样带安全头', async () => {
    const res = await buildApp().request('/missing')
    expect(res.status).toBe(404)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('csrfProtection', () => {
  function buildApp() {
    const app = new Hono<{ Bindings: Env }>()
    app.use(csrfProtection())
    app.get('/', (c) => c.text(csrfToken(c)))
    app.post('/', (c) => c.text('created'))
    return app
  }

  it('GET 下发令牌 Cookie，且页面渲染出的令牌与 Cookie 一致', async () => {
    const res = await buildApp().request('/')
    const token = cookiesOf(res)[CSRF_COOKIE]
    expect(token).toBeTruthy()
    expect(await res.text()).toBe(token)
  })

  it('完全没有令牌的 POST 返回 403', async () => {
    const app = buildApp()
    const res = await app.request('/', { method: 'POST' })
    expect(res.status).toBe(403)
  })

  it('表单隐藏字段与 Cookie 一致时放行', async () => {
    const app = buildApp()
    const token = cookiesOf(await app.request('/'))[CSRF_COOKIE] ?? ''
    const { path, init } = formRequest('/', { [CSRF_FIELD]: token }, token)
    const res = await app.request(path, init)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('created')
  })

  it('字段与 Cookie 不一致时返回 403', async () => {
    const app = buildApp()
    const { path, init } = formRequest('/', { [CSRF_FIELD]: 'a'.repeat(43) }, 'b'.repeat(43))
    expect((await app.request(path, init)).status).toBe(403)
  })

  it('支持通过请求头提交令牌（供 JSON 客户端使用）', async () => {
    const app = buildApp()
    const token = cookiesOf(await app.request('/'))[CSRF_COOKIE] ?? ''
    const res = await app.request('/', {
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE}=${token}`, [CSRF_HEADER]: token },
    })
    expect(res.status).toBe(200)
  })

  it('JSON 请求体里的令牌同样被认可', async () => {
    const app = buildApp()
    const token = cookiesOf(await app.request('/'))[CSRF_COOKIE] ?? ''
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${CSRF_COOKIE}=${token}` },
      body: JSON.stringify({ [CSRF_FIELD]: token }),
    })
    expect(res.status).toBe(200)
  })
})

describe('rateLimit', () => {
  function buildApp(max: number) {
    const app = new Hono<{ Bindings: Env }>()
    app.post('/', rateLimit({ scope: 'unit-test', windowSeconds: 60, max }), (c) => c.text('ok'))
    return app
  }

  it('超过窗口配额返回 429 并带 Retry-After', async () => {
    const app = buildApp(2)
    const headers = { 'cf-connecting-ip': '198.51.100.9' }
    expect((await app.request('/', { method: 'POST', headers })).status).toBe(200)
    expect((await app.request('/', { method: 'POST', headers })).status).toBe(200)
    const third = await app.request('/', { method: 'POST', headers })
    expect(third.status).toBe(429)
    expect(third.headers.get('retry-after')).toBeTruthy()
  })

  it('不同 IP 各自独立计数', async () => {
    const app = buildApp(1)
    const a = await app.request('/', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.10' } })
    const b = await app.request('/', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.11' } })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })
})
