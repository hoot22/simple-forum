import { describe, expect, it } from 'vitest'
import { collectImageFiles } from '../src/uploads/image-validation'

function file(name: string, bytes = 4): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' })
}

describe('collectImageFiles', () => {
  it('取出同名多文件字段的全部文件并保持顺序', () => {
    const form = new FormData()
    form.append('images', file('a.png'))
    form.append('images', file('b.png'))
    form.append('images', file('c.png'))

    const names = collectImageFiles(form).map((item) => item.name)

    // parseBody() 只保留最后一个同名 File，这里必须拿到全部三个。
    expect(names).toEqual(['a.png', 'b.png', 'c.png'])
  })

  it('previews 与 images 各自按序收集，下标可以一一配对', () => {
    const form = new FormData()
    form.append('images', file('a.png'))
    form.append('images', file('b.png'))
    form.append('previews', file('a.thumb.png'))
    form.append('previews', file('b.thumb.png'))

    const images = collectImageFiles(form)
    const previews = collectImageFiles(form, ['previews', 'preview'])

    expect(images.map((item) => item.name)).toEqual(['a.png', 'b.png'])
    expect(previews.map((item) => item.name)).toEqual(['a.thumb.png', 'b.thumb.png'])
    expect(previews).toHaveLength(images.length)
  })

  it('忽略空文件字段，避免未选择的占位 input 被当成图片', () => {
    const form = new FormData()
    form.append('images', file('a.png'))
    form.append('images', new File([], '', { type: 'application/octet-stream' }))

    expect(collectImageFiles(form).map((item) => item.name)).toEqual(['a.png'])
  })

  it('表单里没有 previews 字段时返回空数组', () => {
    const form = new FormData()
    form.append('images', file('a.png'))

    expect(collectImageFiles(form, ['previews', 'preview'])).toEqual([])
  })
})
