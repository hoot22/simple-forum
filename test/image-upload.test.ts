import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, validateImage, validateImages } from '../src/uploads/image-validation'

function png(width = 1, height = 1, type = 'image/png'): File {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return new File([bytes], 'image.png', { type })
}

describe('图片上传严格校验', () => {
  it('接受签名和尺寸有效的 PNG', async () => {
    const result = await validateImage(png(640, 480))
    expect(result).toMatchObject({ ok: true, value: { contentType: 'image/png', width: 640, height: 480 } })
  })

  it('拒绝 MIME 与签名不一致、SVG 和超大尺寸', async () => {
    expect((await validateImage(png(1, 1, 'image/jpeg'))).ok).toBe(false)
    expect((await validateImage(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).ok).toBe(false)
    expect((await validateImage(png(12001, 1))).ok).toBe(false)
  })

  it('拒绝超过三张和超过 5 MiB 的图片', async () => {
    expect((await validateImages([png(), png(), png(), png()])).ok).toBe(false)
    const oversized = new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], 'large.png', { type: 'image/png' })
    expect((await validateImage(oversized)).ok).toBe(false)
  })
})
