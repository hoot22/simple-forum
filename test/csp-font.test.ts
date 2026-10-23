import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'
import { POST_FONTS } from '../src/fonts/post-fonts'
import { css } from '../src/views/layout'

const TEST_ENV: Env = { SESSION_SECRET: 'csp-font-test-secret-0123456789abcdef' }

/** 转义后用于正则的字面量。 */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('自定义字体能被浏览器真正加载', () => {
  it('CSP 显式声明 font-src，不能依赖会回落到 default-src 的缺省行为', async () => {
    const app = createApp(TEST_ENV)
    const res = await app.request('/', {}, TEST_ENV)
    const csp = res.headers.get('content-security-policy') ?? ''

    // 缺失的 CSP 指令会回落到 default-src；这里它是 'none'，
    // 所以 font-src 一旦缺席，@font-face 会被浏览器静默拦截。
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("font-src 'self'")
    // 同源 fetch（未读红点、公告弹窗）受 connect-src 约束，同理必须显式声明。
    expect(csp).toContain("connect-src 'self'")
  })

  it('每个非默认字体都同时具备样式类、@font-face 与字体文件', () => {
    const custom = POST_FONTS.filter((option) => option.id !== 'default')
    expect(custom.length).toBeGreaterThan(0)

    for (const option of custom) {
      const classPattern = new RegExp(
        `\\.${escapeForRegExp(option.className)}\\s*\\{[^}]*font-family:\\s*'([^']+)'`,
      )
      const matched = css.match(classPattern)
      expect(matched, `${option.className} 缺少 font-family 声明`).toBeTruthy()

      const family = (matched as RegExpMatchArray)[1]
      const fontUrl = `/fonts/${option.file}`

      // @font-face 必须同时声明同一个字族名和同一个文件路径，否则静默回退。
      const facePattern = new RegExp(
        `@font-face\\s*\\{[^}]*font-family:\\s*'${escapeForRegExp(family)}'[^}]*${escapeForRegExp(fontUrl)}`,
      )
      expect(css, `@font-face 未把 ${family} 指向 ${fontUrl}`).toMatch(facePattern)

      expect(
        existsSync(join(process.cwd(), 'public', 'fonts', option.file)),
        `public/fonts/${option.file} 不存在`,
      ).toBe(true)
    }
  })

  it('字体类只改字体，不动版式以外的属性', () => {
    // 点阵字体必须固定字号与行高，否则会被浏览器插值放大导致模糊。
    for (const option of POST_FONTS) {
      if (option.id === 'default') continue
      const rule = css.match(new RegExp(`\\.${escapeForRegExp(option.className)}\\s*\\{[^}]*\\}`))?.[0] ?? ''
      expect(rule).toMatch(/font-size:\s*\d+px/)
      expect(rule).toMatch(/line-height:\s*\d+px/)
    }
  })
})
