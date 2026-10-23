import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'
import type { Env } from '../src/env'
import { SESSION_COOKIE } from '../src/utils/auth'

/** 测试用会话密钥；不是任何环境的真实凭证。 */
const TEST_ENV: Env = { SESSION_SECRET: 'bottom-nav-test-session-secret-0123456789' }

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

/** 注册一个账号并返回会话 Cookie；用于验证登录态下的底部导航。 */
async function registerAndGetSession(app: ReturnType<typeof makeApp>): Promise<string> {
  const page = await app.request('/register')
  const csrf = cookiesOf(page)[CSRF_COOKIE] ?? ''
  const res = await app.request('/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `${CSRF_COOKIE}=${csrf}`,
    },
    body: new URLSearchParams({
      [CSRF_FIELD]: csrf,
      // 用户名有 2-20 位限制，这里用 36 进制时间戳压缩长度
      username: `nav_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      password: 'demo123456',
      confirmPassword: 'demo123456',
    }).toString(),
  })
  expect(res.status).toBe(302)
  return cookiesOf(res)[SESSION_COOKIE] ?? ''
}

/**
 * 截取某个导航项所在的 `<a>` 片段。
 *
 * 锚点取 `data-nav`，但 class 在它之前，所以窗口要往前多留一段；
 * 同时窗口不能太长，否则会跨到相邻导航项、把对方的 is-active 也算进来。
 */
function navTag(html: string, nav: 'home' | 'profile' | 'notifications'): string {
  const at = html.indexOf(`data-nav="${nav}"`)
  expect(at).toBeGreaterThan(-1)
  // class 在 data-nav 之前，所以要往前留一段；但不能留太长，否则会跨到上一个导航项
  return html.slice(Math.max(0, at - 60), at + 100)
}

describe('移动端底部导航', () => {
  it('首页渲染底部导航，且只有「首页」被高亮', async () => {
    const html = await (await makeApp().request('/')).text()

    expect(html).toContain('class="bottom-nav"')
    expect(html.match(/is-active/g) ?? []).toHaveLength(1)
    expect(navTag(html, 'home')).toContain('is-active')
    expect(navTag(html, 'profile')).not.toContain('is-active')
    expect(html).toContain('aria-current="page"')
  })

  it('未登录时「个人」指向登录页', async () => {
    const html = await (await makeApp().request('/')).text()
    expect(navTag(html, 'profile')).toContain('href="/login"')
  })

  it('登录后个人页只高亮「个人」，并指向 /me', async () => {
    const app = makeApp()
    const session = await registerAndGetSession(app)

    const html = await (
      await app.request('/me', { headers: { cookie: `${SESSION_COOKIE}=${session}` } })
    ).text()

    expect(html.match(/is-active/g) ?? []).toHaveLength(1)
    expect(navTag(html, 'profile')).toContain('is-active')
    expect(navTag(html, 'home')).not.toContain('is-active')
    expect(navTag(html, 'profile')).toContain('href="/me"')
  })

  it('其他页面不高亮任何一项', async () => {
    const app = makeApp()

    const login = await (await app.request('/login')).text()
    expect(login.match(/is-active/g) ?? []).toHaveLength(0)

    const home = await (await app.request('/')).text()
    const topicLink = /href="(\/topics\/\d+)"/.exec(home)?.[1]
    if (topicLink) {
      const detail = await (await app.request(topicLink)).text()
      expect(detail.match(/is-active/g) ?? []).toHaveLength(0)
    }
  })

  it('样式随 /assets/forum.css 下发，桌面端默认隐藏', async () => {
    const res = await makeApp().request('/assets/forum.css')
    expect(res.status).toBe(200)
    const css = await res.text()

    expect(css).toContain('.bottom-nav {')
    expect(css).toContain('display: none;')
    expect(css).toContain('@media (max-width: 640px)')
    expect(css).toContain('.bottom-nav-item.is-active')
    expect(css).toContain("url('/icons/home.svg')")
    expect(css).toContain("url('/icons/user.svg')")
  })

  it('样式表链接带内容指纹，且带查询串仍能取到样式', async () => {
    const app = makeApp()
    const home = await (await app.request('/')).text()
    const href = /href="(\/assets\/forum\.css\?v=[0-9a-f]+)"/.exec(home)?.[1]
    expect(href).toBeTruthy()

    const res = await app.request(href as string)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('.bottom-nav')
  })

  it('底部导航图标文件存在，且为可用于 CSS mask 的实心描边图形', async () => {
    const { readFile } = await import('node:fs/promises')
    for (const name of ['home.svg', 'user.svg', 'notification.svg']) {
      const file = new URL(`../public/icons/${name}`, import.meta.url)
      const svg = await readFile(file, 'utf8')
      expect(svg).toContain('viewBox="0 0 24 24"')
      // mask 依赖形状的 alpha 通道：没有描边或填充时遮罩为空，图标将不可见
      expect(svg).toMatch(/stroke="#000000"|fill="#000000"/)
    }
  })

  it('底栏渲染通知入口并挂载红点位，样式表按主题色上色', async () => {
    const app = makeApp()
    const html = await (await app.request('/')).text()

    expect(html).toContain('data-nav="notifications"')
    expect(navTag(html, 'notifications')).toContain('href="/notifications"')

    const css = await (await app.request('/assets/forum.css')).text()
    expect(css).toContain('.bottom-nav-item[data-nav=\'notifications\']')
    expect(css).toContain("url('/icons/notification.svg')")
    // 红点必须挂在图标容器之外：mask 会把子元素一起裁剪
    expect(css).toContain('.bottom-nav-figure')
  })

  it('通知页高亮「通知」，其余项不高亮', async () => {
    const app = makeApp()
    const session = await registerAndGetSession(app)

    const html = await (
      await app.request('/notifications', { headers: { cookie: `${SESSION_COOKIE}=${session}` } })
    ).text()

    expect(navTag(html, 'notifications')).toContain('is-active')
    expect(navTag(html, 'home')).not.toContain('is-active')
    expect(navTag(html, 'profile')).not.toContain('is-active')
  })
})
