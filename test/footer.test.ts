import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { Layout, css } from '../src/views/layout'
import { isExternalLink, normalizeFooterLinks } from '../src/site/footer'
import type { FooterLink } from '../src/site/footer'
import type { Env } from '../src/env'

/** 测试用会话密钥；不是任何环境的真实凭证。 */
const TEST_ENV: Env = { SESSION_SECRET: 'footer-test-session-secret-0123456789' }

function makeApp() {
  const app = createApp(TEST_ENV)
  return {
    fetch: (request: Request) => app.fetch(request, TEST_ENV),
    request: (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV),
  }
}

/** 只取 <footer> 元素，避免误匹配正文里的同类文字。 */
function footerOf(html: string): string {
  const match = html.match(/<footer[\s\S]*?<\/footer>/)
  return match ? match[0] : ''
}

/** 直接渲染 Layout，用于验证注入的联系方式 / 友情链接。 */
function renderFooter(contactLinks?: FooterLink[], friendLinks?: FooterLink[]): string {
  const html = String(Layout({ user: null, children: '', csrf: '', showFooterLinks: true, contactLinks, friendLinks }))
  return footerOf(html)
}

describe('页脚', () => {
  it('页脚不再出现 Hono + Cloudflare Workers 字样', async () => {
    const app = makeApp()
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const footer = footerOf(await res.text())

    expect(footer).not.toBe('')
    expect(footer).toContain('Simple Forum')
    expect(footer).not.toContain('Hono')
    expect(footer).not.toContain('Cloudflare')
    expect(footer).not.toContain('·')
  })

  it('页脚是三栏结构，站点名位于两栏之间', async () => {
    const app = makeApp()
    const footer = footerOf(await (await app.request('/')).text())

    expect(footer).toContain('class="footer-brand"')
    expect(footer).toContain('footer-group-end')
    expect(footer.indexOf('footer-group')).toBeLessThan(footer.indexOf('footer-brand'))
    expect(footer.indexOf('footer-brand')).toBeLessThan(footer.lastIndexOf('footer-group'))
  })

  it('没有条目时只显示站点名，不留空标题和空链接', () => {
    const footer = renderFooter([], [])

    expect(footer).toContain('Simple Forum')
    expect(footer).not.toContain('联系方式')
    expect(footer).not.toContain('友情链接')
    expect(footer).not.toContain('footer-link')
  })

  it('条目按左联系方式、右友情链接渲染', () => {
    const footer = renderFooter(
      [{ label: 'QQ', href: 'https://wpa.qq.example/x' }],
      [{ label: '友链站', href: 'https://friend.example' }],
    )

    expect(footer.indexOf('联系方式')).toBeLessThan(footer.indexOf('Simple Forum'))
    expect(footer.indexOf('Simple Forum')).toBeLessThan(footer.indexOf('友情链接'))
    expect(footer).toContain('href="https://wpa.qq.example/x"')
    expect(footer).toContain('href="https://friend.example"')
    expect(footer).toContain('>QQ<')
    expect(footer).toContain('>友链站<')
  })

  it('http(s) 链接新标签页打开并带 rel，mailto 在当前页跳转', () => {
    const footer = renderFooter(
      [
        { label: 'GitHub', href: 'https://github.com/me' },
        { label: '邮箱', href: 'mailto:me@example.com' },
      ],
      [],
    )

    const github = footer.match(/<a[^>]*github\.com\/me[^>]*>/)?.[0] ?? ''
    expect(github).toContain('target="_blank"')
    expect(github).toContain('rel="noopener noreferrer"')

    const mail = footer.match(/<a[^>]*mailto:[^>]*>/)?.[0] ?? ''
    expect(mail).toContain('mailto:me@example.com')
    expect(mail).not.toContain('target=')
  })

  it('空白或只填一半的条目被丢弃，文字两端空白被去掉', () => {
    const footer = renderFooter(
      [
        { label: '   ', href: 'https://blank-label.example' },
        { label: 'Half', href: '   ' },
        { label: '  QQ  ', href: '  https://qq.example  ' },
      ],
      [],
    )

    expect(footer).not.toContain('blank-label.example')
    expect(footer).not.toContain('Half')
    expect(footer).toContain('href="https://qq.example"')
    expect(footer).toContain('>QQ<')
  })

  it('条目文字中的 HTML 被转义', () => {
    const footer = renderFooter([{ label: '<b>x</b>', href: 'https://escape.example' }], [])

    expect(footer).toContain('&lt;b&gt;')
    expect(footer).not.toContain('<b>x</b>')
  })

  it('样式包含三栏布局与窄屏单列规则', () => {
    expect(css).toContain('grid-template-columns: 1fr auto 1fr')
    expect(css).toContain('.footer-group-end { align-items: flex-end; }')
    expect(css).toContain('.footer-link:hover')
  })
})

describe('页脚数据工具', () => {
  it('isExternalLink 只认 http / https', () => {
    expect(isExternalLink('https://a.example')).toBe(true)
    expect(isExternalLink('HTTP://a.example')).toBe(true)
    expect(isExternalLink('mailto:a@b.example')).toBe(false)
    expect(isExternalLink('/topics/1')).toBe(false)
  })

  it('normalizeFooterLinks 去空白并列除无效条目', () => {
    expect(normalizeFooterLinks([{ label: ' a ', href: ' https://a.example ' }])).toEqual([
      { label: 'a', href: 'https://a.example' },
    ])
    expect(normalizeFooterLinks([{ label: '', href: 'https://a.example' }])).toEqual([])
    expect(normalizeFooterLinks([{ label: 'a', href: '   ' }])).toEqual([])
    expect(normalizeFooterLinks([])).toEqual([])
  })

  it('normalizeFooterLinks 保留纯文本条目并去掉两端空白', () => {
    expect(normalizeFooterLinks([{ label: ' 邮箱 ', value: ' a@b.example ' }])).toEqual([
      { label: '邮箱', value: 'a@b.example' },
    ])
    // 名称与内容至少有一个，两者都空则丢弃
    expect(normalizeFooterLinks([{ label: 'QQ' }])).toEqual([])
    expect(normalizeFooterLinks([{ label: 'QQ', value: '   ' }])).toEqual([])
    // value 与 href 同时存在时都保留
    expect(normalizeFooterLinks([{ label: 'QQ', value: ' 123 ', href: ' https://q.example ' }])).toEqual([
      { label: 'QQ', value: '123', href: 'https://q.example' },
    ])
  })
})

describe('页脚纯文本条目', () => {
  it('只填 value 的条目以文本渲染，不生成链接', () => {
    const footer = renderFooter([{ label: '邮箱', value: 'a@b.example' }], [])

    expect(footer).toContain('footer-item')
    expect(footer).not.toContain('footer-link')
    expect(footer).not.toContain('<a ')
    expect(footer).toContain('邮箱')
    expect(footer).toContain('a@b.example')
  })

  it('名称与内容分别由 footer-key / footer-value 承载', () => {
    const footer = renderFooter([{ label: '邮箱', value: 'a@b.example' }], [])

    expect(footer).toMatch(/<span class="footer-key">邮箱<\/span>/)
    expect(footer).toMatch(/<span class="footer-value">a@b\.example<\/span>/)
  })

  it('同时填 value 与 href 时整条可点击', () => {
    const footer = renderFooter([{ label: 'QQ', value: '123456', href: 'https://q.example' }], [])

    expect(footer).toMatch(/<a class="footer-link" href="https:\/\/q\.example"[^>]*>/)
    expect(footer).toContain('123456')
  })

  it('纯文本内容里的 HTML 被转义', () => {
    const footer = renderFooter([{ label: 'x', value: '<b>y</b>' }], [])

    expect(footer).not.toContain('<b>y</b>')
  })

  it('随附数据里 QQ 与邮箱以文本展示，GitHub 仍是链接', () => {
    const footer = renderFooter()

    expect(footer).toContain('3810378058')
    expect(footer).toContain('a13825021878@163.com')
    expect(footer).toMatch(/<a[^>]*>GitHub<\/a>/)
    // QQ 与邮箱不渲染成链接
    expect(footer).not.toMatch(/<a[^>]*>(?:<span[^>]*>)?QQ/)
    expect(footer).not.toMatch(/<a[^>]*>(?:<span[^>]*>)?邮箱/)
  })

  it('左右两栏改为竖排', () => {
    expect(css).toContain('.footer-group { display: flex; flex-direction: column')
    expect(css).toContain('.footer-group-end { align-items: flex-end; }')
    // 窄屏单列时，水平居中由 align-items 承担
    expect(css).toContain('.footer-group-end { align-items: center; }')
  })
})
