import { describe, expect, it } from 'vitest'
import type { ForumStore } from '../../src/db/store'
import type { Env } from '../../src/env'
import { validateImage } from '../../src/uploads/image-validation'
import {
  deletePreview,
  deletePreviewsByTopic,
  getPreview,
  previewMetaFor,
  savePreviews,
} from '../../src/uploads/post-previews'

/**
 * 缩略图存储契约：同一组断言分别驱动内存实现与真实 D1。
 *
 * 这里刻意不经过 HTTP 层——它锁的是「字节能否正确往返存储」这件事本身。
 * D1 测试桥接走 HTTP + JSON，二进制参数必须编码成 { __blob: base64 }，
 * 否则 D1 会以 D1_TYPE_ERROR 拒绝；这条契约正是用来发现那类问题的。
 */

export interface PostPreviewContractContext {
  store: ForumStore
  env: Env
}

/** 最小合法 PNG，padding 用于构造不同长度的字节以便区分两张缩略图。 */
function pngBytes(padding: number): Uint8Array {
  const bytes = new Uint8Array(24 + padding)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 2)
  view.setUint32(20, 2)
  return bytes
}

/** 走真实校验路径构造 ValidatedImage，避免测试里手写一个可能与实现漂移的结构。 */
async function preview(padding: number) {
  const result = await validateImage(
    new File([pngBytes(padding)], `p-${padding}.png`, { type: 'image/png' }),
  )
  if (!result.ok) throw new Error(`测试用缩略图未通过校验：${result.error}`)
  return result.value
}

export function runPostPreviewContract(
  name: string,
  create: () => Promise<PostPreviewContractContext>,
): void {
  describe(`缩略图存储契约：${name}`, () => {
    it('写入后可按 imageId 读回完整字节与元数据', async () => {
      const { store, env } = await create()
      const image = await preview(8)

      await savePreviews(store, env, [{ topicId: 1, imageId: 11, image }])

      const found = await getPreview(store, env, 11)
      expect(found).not.toBeNull()
      expect(found?.contentType).toBe('image/png')
      expect(found?.byteSize).toBe(image.bytes.byteLength)
      // 逐字节比较：二进制在 D1 桥接上被编码过，只比长度会漏掉损坏。
      expect(Array.from(found?.data ?? [])).toEqual(Array.from(image.bytes))
    })

    it('同一 imageId 重复写入覆盖旧值而不是报错', async () => {
      const { store, env } = await create()
      const first = await preview(4)
      const second = await preview(32)

      await savePreviews(store, env, [{ topicId: 1, imageId: 21, image: first }])
      await savePreviews(store, env, [{ topicId: 1, imageId: 21, image: second }])

      const found = await getPreview(store, env, 21)
      expect(found?.byteSize).toBe(second.bytes.byteLength)
      expect(Array.from(found?.data ?? [])).toEqual(Array.from(second.bytes))
    })

    it('image 为 null 的条目被跳过，不影响其他条目', async () => {
      const { store, env } = await create()
      const image = await preview(8)

      await savePreviews(store, env, [
        { topicId: 1, imageId: 31, image: null },
        { topicId: 1, imageId: 32, image },
      ])

      expect(await getPreview(store, env, 31)).toBeNull()
      expect(await getPreview(store, env, 32)).not.toBeNull()
    })

    it('批量查询只返回存在的条目，缺失的 imageId 被静默跳过', async () => {
      const { store, env } = await create()
      await savePreviews(store, env, [
        { topicId: 1, imageId: 41, image: await preview(4) },
        { topicId: 1, imageId: 43, image: await preview(8) },
      ])

      const metas = await previewMetaFor(store, env, [41, 42, 43, 99])
      expect([...metas.keys()].sort((a, b) => a - b)).toEqual([41, 43])
      expect(metas.get(41)?.contentType).toBe('image/png')
    })

    it('imageIds 为空数组时不发起查询也不报错', async () => {
      const { store, env } = await create()
      expect((await previewMetaFor(store, env, [])).size).toBe(0)
    })

    it('按 imageId 删除只影响目标项', async () => {
      const { store, env } = await create()
      await savePreviews(store, env, [
        { topicId: 1, imageId: 51, image: await preview(4) },
        { topicId: 1, imageId: 52, image: await preview(8) },
      ])

      await deletePreview(store, env, 51)

      expect(await getPreview(store, env, 51)).toBeNull()
      expect(await getPreview(store, env, 52)).not.toBeNull()
    })

    it('按 topicId 删除只清理该主题的缩略图', async () => {
      const { store, env } = await create()
      await savePreviews(store, env, [
        { topicId: 1, imageId: 61, image: await preview(4) },
        { topicId: 1, imageId: 62, image: await preview(8) },
        { topicId: 2, imageId: 63, image: await preview(16) },
      ])

      await deletePreviewsByTopic(store, env, 1)

      expect(await getPreview(store, env, 61)).toBeNull()
      expect(await getPreview(store, env, 62)).toBeNull()
      expect(await getPreview(store, env, 63)).not.toBeNull()
    })

    it('读取不存在的 imageId 返回 null 而不是抛错', async () => {
      const { store, env } = await create()
      expect(await getPreview(store, env, 999_999)).toBeNull()
    })
  })
}
