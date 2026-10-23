import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { CONTACT_LINKS, FRIEND_LINKS, normalizeFooterLinks } from '../src/site/footer'
import type { User } from '../src/types'
import { Layout, css } from '../src/views/layout'
import { NewTopicPage } from '../src/views/new-topic'

/** 测试专用会话密钥，不用于任何真实环境 */
const TEST_ENV = { SESSION_SECRET: 'footer-home-only-session-secret-0123456789' }

function makeApp() {
  const app = createApp(TEST_ENV)
  return {
    request: (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV),
  }
}

/** 只截取 <footer> 元素，避免匹配正文或注释里的同名文字 */
function footerOf(html: string): string {
  const match = html.match(/<footer[\s\S]*?<\/footer>/)
  return match ? match[0] : ''
}

const TEST_USER: User = {
  id: 1,
  username: 'alice',
  createdAt: '2026-01-01 00:00:00',
  isAdmin: false,
}

const AUTOGROW_SCRIPT = readFileSync(
  fileURLToPath(new URL('../public/js/textarea-autogrow.js', import.meta.url)),
  'utf8',
)

describe('页脚：联系方式与友情链接只在首页展示', () => {
  it('首页页脚带联系方式与友情链接', async () => {
    const app = makeApp()
    const res = await app.request('/')
    expect(res.status).toBe(200)

    const footer = footerOf(await res.text())
    expect(footer).toContain('联系方式')
    expect(footer).toContain('友情链接')

    // 断言按数据文件推导，改了 src/site/footer.ts 也不必同步改测试
    for (const link of normalizeFooterLinks(CONTACT_LINKS)) {
      expect(footer).toContain(link.label)
      if (link.value !== undefined) expect(footer).toContain(link.value)
    }
    for (const link of normalizeFooterLinks(FRIEND_LINKS)) {
      expect(footer).toContain(link.label)
    }
  })

  it('非首页的页脚只保留站点名', async () => {
    const app = makeApp()

    for (const path of ['/login', '/register']) {
      const res = await app.request(path)
      expect(res.status).toBe(200)

      const footer = footerOf(await res.text())
      expect(footer).toContain('Simple Forum')
      expect(footer).not.toContain('联系方式')
      expect(footer).not.toContain('友情链接')
    }
  })

  it('Layout 只在 showFooterLinks 为真时渲染链接区块', () => {
    const withoutFlag = footerOf(String(Layout({ user: null, children: '', csrf: '' })))
    expect(withoutFlag).toContain('Simple Forum')
    expect(withoutFlag).not.toContain('联系方式')
    expect(withoutFlag).not.toContain('友情链接')

    const withFlag = footerOf(
      String(Layout({ user: null, children: '', csrf: '', showFooterLinks: true })),
    )
    expect(withFlag).toContain('联系方式')
    expect(withFlag).toContain('友情链接')
  })

  it('两种情况下站点名都位于三栏网格的中间，不会偏到左侧', () => {
    expect(css).toContain('grid-template-columns: 1fr auto 1fr')

    for (const html of [
      String(Layout({ user: null, children: '', csrf: '' })),
      String(Layout({ user: null, children: '', csrf: '', showFooterLinks: true })),
    ]) {
      const footer = footerOf(html)
      // 左右两栏即使为空也要保留容器，站点名才会居中
      expect(footer).toContain('class="footer-brand"')
      expect(footer.indexOf('footer-brand')).toBeLessThan(footer.lastIndexOf('footer-group'))
    }
  })
})

describe('发帖正文输入框随内容增高', () => {
  it('发帖页的正文输入框带 data-autogrow 并引入脚本', () => {
    const html = String(
      NewTopicPage({ user: TEST_USER, errors: [], values: {}, csrf: 'csrf-token' }),
    )

    expect(html).toMatch(/<textarea[^>]*name="content"[^>]*data-autogrow/)
    expect(html).toContain('/js/textarea-autogrow.js')
  })

  it('脚本按内容高度调整，并且设有上限', () => {
    expect(AUTOGROW_SCRIPT).toContain('textarea[data-autogrow]')
    expect(AUTOGROW_SCRIPT).toContain('scrollHeight')
    expect(AUTOGROW_SCRIPT).toContain("addEventListener('input'")
    // 每次输入都先复位高度，否则删掉文字后输入框缩不回去
    expect(AUTOGROW_SCRIPT).toContain("el.style.height = 'auto'")
    expect(AUTOGROW_SCRIPT).not.toContain('innerHTML')
  })

  it('上限数值被限制在「不会把发布按钮顶出屏幕」的范围内', () => {
    const matched = AUTOGROW_SCRIPT.match(/DEFAULT_MAX_HEIGHT = (\d+)/)
    expect(matched).not.toBeNull()

    const max = Number(matched![1])
    expect(max).toBeGreaterThan(0)
    expect(max).toBeLessThanOrEqual(320)
    // 支持逐元素用 data-autogrow-max 覆盖
    expect(AUTOGROW_SCRIPT).toContain('data-autogrow-max')
  })

  it('到达上限后改为框内滚动', () => {
    expect(AUTOGROW_SCRIPT).toContain("el.style.overflowY = 'auto'")
    expect(AUTOGROW_SCRIPT).toContain("el.style.overflowY = 'hidden'")
  })

  it('自增高输入框禁用手拖高度，避免两种方式互相覆盖', () => {
    expect(css).toContain('.form-row textarea[data-autogrow] { resize: none; overflow-y: hidden; }')
  })
})
