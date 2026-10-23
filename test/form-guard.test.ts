import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'

/** 测试用会话密钥；不是任何环境的真实凭证。 */
const TEST_ENV: Env = { SESSION_SECRET: 'form-guard-test-session-secret-0123456789' }

const guardSource = readFileSync(
  fileURLToPath(new URL('../public/js/form-guard.js', import.meta.url)),
  'utf8',
)

function makeApp() {
  const app = createApp(TEST_ENV)
  return {
    request: (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV),
  }
}

describe('表单重复提交守卫', () => {
  it('守卫脚本随布局下发到页面', async () => {
    const res = await makeApp().request('/login')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(html).toContain('/js/form-guard.js')
  })

  it('在 capture 阶段监听 submit，先于图片压缩脚本执行', () => {
    expect(guardSource).toContain("document.addEventListener('submit', onSubmit, true)")
  })

  it('一次提交在途时直接丢弃后续提交', () => {
    expect(guardSource).toContain('if (inFlight)')
    expect(guardSource).toContain('event.preventDefault()')
  })

  it('不锁定 method="dialog" 的表单，否则关闭按钮会失效', () => {
    expect(guardSource).toContain("=== 'dialog'")
  })

  it('带 name 的提交按钮不被禁用，避免提交时丢字段', () => {
    expect(guardSource).toContain("button.hasAttribute('name')")
    expect(guardSource).toContain('button.disabled = true')
  })

  it('保留提交失败后的兜底解锁路径', () => {
    expect(guardSource).toContain('UNLOCK_DELAY_MS')
    expect(guardSource).toContain("addEventListener('pageshow'")
  })
})
