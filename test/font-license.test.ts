import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

describe('字体授权与分发', () => {
  it('随附 GPL-2.0 全文', () => {
    const license = read('LICENSES/GPL-2.0.txt')

    expect(license).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(license).toContain('Version 2, June 1991')
  })

  it('Zpix 已从仓库、站点与清单中彻底移除', () => {
    expect(existsSync(join(process.cwd(), 'public/fonts/zpix.ttf'))).toBe(false)
    expect(read('.gitignore')).not.toContain('zpix')

    expect(read('src/fonts/post-fonts.ts')).not.toContain('zpix')
    expect(read('src/views/layout.tsx')).not.toContain('zpix')
    expect(read('public/js/font-availability.js')).not.toContain('zpix')
  })

  it('字体说明写清了移除原因与剩余字体的授权', () => {
    const doc = read('public/fonts/README.md')

    expect(doc).toContain('GPL-2.0')
    expect(doc).toContain('文泉驿点阵宋')
    expect(doc).toContain('已移除的字体')
    expect(doc).toContain('再分发')
  })

  it('README 不再声称未附带许可文本', () => {
    const readme = read('README.md')

    expect(readme).toContain('LICENSES/GPL-2.0.txt')
    expect(readme).not.toContain('本项目未附带其许可文本')
  })
})

describe('字体缺失时的降级', () => {
  it('发帖页挂载可用性检查脚本', () => {
    expect(read('src/views/new-topic.tsx')).toContain('/js/font-availability.js')
  })

  it('脚本在字体缺失时禁用选项并退回默认字体', () => {
    const script = read('public/js/font-availability.js')

    expect(script).toContain('document.fonts.load')
    expect(script).toContain('document.fonts.check')
    expect(script).toContain('input.disabled = true')
    expect(script).toContain("findInput('default')")
    expect(script).toContain('缺字体文件')
    // 只用 textContent，不拼 HTML
    expect(script).not.toContain('innerHTML')
  })

  it('提示样式存在', () => {
    expect(read('src/views/layout.tsx')).toContain('.font-missing')
  })
})
