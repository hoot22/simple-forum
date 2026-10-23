import { afterAll, describe, expect, it } from 'vitest'
import type { ForumStore } from '../../src/db/store'
import { createPostImageRepository } from '../../src/uploads/post-images'
import type { ValidatedImage } from '../../src/uploads/image-validation'
import { MAX_POST_IMAGES } from '../../src/uploads/image-validation'

type PostImageRepository = ReturnType<typeof createPostImageRepository>

export interface TopicImageHarness {
  /** 返回一个干净的存储实例，每次调用互相独立 */
  create: () => Promise<ForumStore>
  /** 与同一次 create 对应的图片仓储（内存实现只需要 store，D1 还需要绑定） */
  images: (store: ForumStore) => PostImageRepository
  /** 可选：用例全部结束后释放资源（例如 Miniflare） */
  dispose?: () => Promise<void>
}

/**
 * 只用于摘要与排序断言的最小图片记录。
 * 这里刻意不经过 validateImages：本契约验证的是「统计口径」，
 * 不是图片内容校验，所以字节可以是假的。
 */
function image(width: number, height: number): ValidatedImage {
  return {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    contentType: 'image/png',
    extension: 'png',
    width,
    height,
  }
}

async function createTopic(store: ForumStore, username: string) {
  const user = await store.createUser(username, 'password-hash')
  if (!user.ok) throw new Error(`创建用户失败：${user.error}`)

  const topic = await store.createTopic(user.value, { title: username, content: '正文' })
  if (!topic.ok) throw new Error(`发帖失败：${topic.error}`)

  return topic.value
}

async function listItem(store: ForumStore, topicId: number) {
  const page = await store.listTopics({ limit: 50 })
  return page.items.find((topic) => topic.id === topicId)
}

/**
 * 列表页图片字段契约。
 *
 * Topic 上的 imageCount / firstImageId 有两种来源：D1 在 TOPIC_SELECT 里用相关
 * 子查询算，内存实现用 topicImageSummary 算。两条路径必须给出完全相同的结果，
 * 否则同一份客户端代码会在两种部署下表现不一致。
 */
export function runTopicImageSummaryContract(label: string, harness: TopicImageHarness): void {
  describe(`${label} · 主题列表的图片字段`, () => {
    if (harness.dispose) {
      afterAll(async () => {
        await harness.dispose?.()
      })
    }

    it('没有图片时 imageCount 为 0、firstImageId 为 null', async () => {
      const store = await harness.create()
      const topic = await createTopic(store, 'no-image')

      const item = await listItem(store, topic.id)

      expect(item).toBeDefined()
      expect(item?.imageCount).toBe(0)
      expect(item?.firstImageId).toBeNull()
    })

    it('imageCount 计数、firstImageId 取 position 最小的一张', async () => {
      const store = await harness.create()
      const repository = harness.images(store)
      const topic = await createTopic(store, 'with-images')

      // 刻意乱序写入，确认排序依据是 position 而不是插入顺序或 id
      const second = await repository.create(topic.id, image(8, 6), 1)
      const first = await repository.create(topic.id, image(4, 3), 0)

      const item = await listItem(store, topic.id)

      expect(item?.imageCount).toBe(2)
      expect(item?.firstImageId).toBe(first.id)
      expect(item?.firstImageId).not.toBe(second.id)
    })

    it('首图被删除后 firstImageId 推进到下一张，不会留下悬空 id', async () => {
      const store = await harness.create()
      const repository = harness.images(store)
      const topic = await createTopic(store, 'delete-first')

      const first = await repository.create(topic.id, image(4, 3), 0)
      const second = await repository.create(topic.id, image(8, 6), 1)

      await repository.deleteById(first.id)

      const item = await listItem(store, topic.id)

      expect(item?.imageCount).toBe(1)
      expect(item?.firstImageId).toBe(second.id)
    })

    it('详情与列表描述同一批图片', async () => {
      const store = await harness.create()
      const repository = harness.images(store)
      const topic = await createTopic(store, 'detail-consistency')

      for (let position = 0; position < MAX_POST_IMAGES; position += 1) {
        await repository.create(topic.id, image(position + 2, position + 2), position)
      }

      const images = await repository.listByTopic(topic.id)
      const detail = await store.getTopicDetail({ topicId: topic.id })

      expect(images).toHaveLength(MAX_POST_IMAGES)
      expect(detail?.imageCount).toBe(images.length)
      expect(detail?.firstImageId).toBe(images[0]?.id ?? null)
    })
  })
}
