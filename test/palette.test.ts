import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'

/** 测试用会话密钥；不是任何环境的真实凭证。 */
const TEST_ENV: Env = { SESSION_SECRET: 'palette-test-session-secret-0123456789' }

async function fetchCss(): Promise<string> {
  const app = createApp(TEST_ENV)
  const res = await app.fetch(new Request('http://localhost/assets/forum.css'), TEST_ENV)
  expect(res.status).toBe(200)
  return await res.text()
}

describe('主题调色板（取自 theme-color-scheme.md）', () => {
  it('日间模式使用 Studio 的亮色 token', async () => {
    const css = await fetchCss()
    expect(css).toContain('--fg: #141414;')
    expect(css).toContain('--muted: #737373;')
    expect(css).toContain('--line: #d6d6d6;')
    expect(css).toContain('--bg: #f5f5f5;')
    expect(css).toContain('--card: #ffffff;')
    expect(css).toContain('--control-hover: #f0f0f0;')
  })

  it('夜间模式使用 Studio 的暗色 token', async () => {
    const css = await fetchCss()
    expect(css).toContain('--fg: #e8e8e8;')
    expect(css).toContain('--muted: #8c8c8c;')
    expect(css).toContain('--line: #3b3b3b;')
    expect(css).toContain('--bg: #141414;')
    expect(css).toContain('--card: #1b1b1b;')
    expect(css).toContain('--control-hover: #242424;')
  })

  it('强调色来自 Studio 主题色 #478cbf，且实心填充有独立变量', async () => {
    const css = await fetchCss()
    expect(css).toContain('--accent: #478cbf;')
    expect(css).toContain('--accent-solid: #417fae;')
    // 白字实心按钮必须用 accent-solid，不能直接用 accent，否则对比度不足
    expect(css).toContain('.btn-primary { background: var(--accent-solid); color: #fff; }')
    expect(css).not.toContain('.btn-primary { background: var(--accent);')
  })

  it('不再残留旧 GitHub 配色', async () => {
    const css = await fetchCss()
    for (const legacy of ['#0969da', '#0d1117', '#1f6feb', '#161b22', '#4493f8', '#f6f8fa', '#0550ae']) {
      expect(css).not.toContain(legacy)
    }
  })

  it('提示条与徽章不再写死浅色值', async () => {
    const css = await fetchCss()
    for (const legacy of ['#ffcecb', '#ddf4ff', '#b6e3ff', '#fff8c5', '#d4a72c']) {
      expect(css).not.toContain(legacy)
    }
    expect(css).toContain('.alert-info { background: var(--accent-subtle);')
    expect(css).toContain('.badge-owner { font-size: 12px; font-weight: 500; color: var(--warning-text);')
  })

  it('夜间模式不再逐条覆盖固定色值', async () => {
    const css = await fetchCss()
    expect(css).not.toContain(":root[data-theme='dark'] .btn-primary")
    expect(css).not.toContain(":root[data-theme='dark'] .alert-info")
    expect(css).not.toContain(":root[data-theme='dark'] .badge-owner")
  })

  it('跟随系统偏好时与手动切换使用同一套暗色值', async () => {
    const css = await fetchCss()
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))
    expect(media).toContain('--bg: #141414;')
    expect(media).toContain('--card: #1b1b1b;')
    expect(media).toContain('--accent: #478cbf;')
  })
})
