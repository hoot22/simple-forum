import type { ForumStore } from '../db/store'
import type { Env } from '../env'
import type { PostImage } from '../types'
import type { ValidatedImage } from './image-validation'

/**
 * 帖子图片仓储。
 *
 * 图片字节以 BLOB 直接写进 D1 的 post_images 表，元数据和字节在同一行里，
 * 因此本项目不再需要 R2 或任何对象存储绑定。未配置 D1 时（本地测试与
 * 无绑定的开发环境）回落到进程内的内存实现，行为和 D1 实现保持一致。
 */

const memoryImages = new WeakMap<ForumStore, PostImage[]>()

function memory(store: ForumStore): PostImage[] {
  const existing = memoryImages.get(store)
  if (existing) return existing

  const created: PostImage[] = []
  memoryImages.set(store, created)
  return created
}

/**
 * 主题图片摘要：列表页只需要「有几张图」和「用哪张当缩略图」。
 * D1 在 TOPIC_SELECT 里用相关子查询直接算出，内存实现没有 SQL，
 * 因此在这里按 topicId 汇总，保证两种存储（以及 test:contract）结果一致。
 */
export function topicImageSummary(
  store: ForumStore,
  topicId: number,
): { imageCount: number; firstImageId: number | null } {
  const images = memory(store).filter((image) => image.topicId === topicId)
  if (images.length === 0) return { imageCount: 0, firstImageId: null }

  const first = images.reduce((best, image) =>
    image.position < best.position ||
    (image.position === best.position && image.id < best.id)
      ? image
      : best,
  )
  return { imageCount: images.length, firstImageId: first.id }
}

interface PostImageRow {
  id: number
  topic_id: number
  content_type: string
  byte_size: number
  width: number | null
  height: number | null
  position: number
  created_at: string
  data?: ArrayBuffer | Uint8Array | number[]
}

const SELECT_COLUMNS =
  'id, topic_id, content_type, byte_size, width, height, position, created_at'

/** D1 的 BLOB 列在不同运行时可能返回 ArrayBuffer 或 TypedArray，这里都接受。 */
function toBytes(value: PostImageRow['data']): Uint8Array | null {
  if (!value) return null
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return new Uint8Array(value)
  return null
}

function toPostImage(row: PostImageRow): PostImage {
  return {
    id: row.id,
    topicId: row.topic_id,
    contentType: row.content_type as PostImage['contentType'],
    byteSize: row.byte_size,
    width: row.width ?? 0,
    height: row.height ?? 0,
    position: row.position,
    createdAt: row.created_at,
  }
}

export interface PostImageRepository {
  create(topicId: number, image: ValidatedImage, position: number): Promise<PostImage>
  listByTopic(topicId: number): Promise<PostImage[]>
  getById(id: number): Promise<PostImage | null>
  deleteByTopic(topicId: number): Promise<void>
  /** 删除单张图片；目标不存在时静默返回，保证重试幂等。 */
  deleteById(id: number): Promise<void>
  /** 调整单张图片的排序位置，用于删除后压缩 position 空洞。 */
  updatePosition(id: number, position: number): Promise<void>
}

function d1Repository(db: D1Database): PostImageRepository {
  return {
    async create(topicId, image, position) {
      const inserted = await db
        .prepare(
          `INSERT INTO post_images
             (topic_id, content_type, byte_size, width, height, position, data)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          topicId,
          image.contentType,
          image.bytes.byteLength,
          image.width ?? 0,
          image.height ?? 0,
          position,
          image.bytes,
        )
        .run()

      const id = inserted.meta.last_row_id
      if (typeof id !== 'number' || id <= 0) throw new Error('写入图片记录失败')

      const row = await db
        .prepare(`SELECT ${SELECT_COLUMNS} FROM post_images WHERE id = ?`)
        .bind(id)
        .first<PostImageRow>()
      if (!row) throw new Error('读取图片记录失败')

      return toPostImage(row)
    },

    async listByTopic(topicId) {
      const rows = await db
        .prepare(
          `SELECT ${SELECT_COLUMNS} FROM post_images WHERE topic_id = ? ORDER BY position ASC`,
        )
        .bind(topicId)
        .all<PostImageRow>()

      return (rows.results ?? []).map(toPostImage)
    },

    async getById(id) {
      const row = await db
        .prepare(`SELECT ${SELECT_COLUMNS}, data FROM post_images WHERE id = ?`)
        .bind(id)
        .first<PostImageRow>()
      if (!row) return null

      const bytes = toBytes(row.data)
      if (!bytes) return null

      return { ...toPostImage(row), data: bytes }
    },

    async deleteByTopic(topicId) {
      await db.prepare('DELETE FROM post_images WHERE topic_id = ?').bind(topicId).run()
    },

    async deleteById(id) {
      await db.prepare('DELETE FROM post_images WHERE id = ?').bind(id).run()
    },

    async updatePosition(id, position) {
      await db.prepare('UPDATE post_images SET position = ? WHERE id = ?').bind(position, id).run()
    },
  }
}

function memoryRepository(store: ForumStore): PostImageRepository {
  return {
    async create(topicId, image, position) {
      const images = memory(store)
      const nextId = images.reduce((max, item) => Math.max(max, item.id), 0) + 1

      const created: PostImage = {
        id: nextId,
        topicId,
        contentType: image.contentType,
        byteSize: image.bytes.byteLength,
        width: image.width ?? 0,
        height: image.height ?? 0,
        position,
        createdAt: new Date().toISOString(),
        data: image.bytes,
      }

      images.push(created)
      return created
    },

    async listByTopic(topicId) {
      return memory(store)
        .filter((image) => image.topicId === topicId)
        .sort((a, b) => a.position - b.position)
    },

    async getById(id) {
      return memory(store).find((image) => image.id === id) ?? null
    },

    async deleteByTopic(topicId) {
      memoryImages.set(
        store,
        memory(store).filter((image) => image.topicId !== topicId),
      )
    },

    async deleteById(id) {
      memoryImages.set(
        store,
        memory(store).filter((image) => image.id !== id),
      )
    },

    async updatePosition(id, position) {
      const image = memory(store).find((item) => item.id === id)
      if (image) image.position = position
    },
  }
}

export function createPostImageRepository(store: ForumStore, env?: Env): PostImageRepository {
  return env?.DB ? d1Repository(env.DB) : memoryRepository(store)
}

/** 校验后的图片按顺序落库；任一张失败就回滚本次写入，不留半套图片。 */
export async function storeTopicImages(
  store: ForumStore,
  env: Env,
  topicId: number,
  images: ValidatedImage[],
  options: { startPosition?: number } = {},
): Promise<PostImage[]> {
  if (images.length === 0) return []

  const repository = createPostImageRepository(store, env)
  const startPosition = options.startPosition ?? 0
  const stored: PostImage[] = []

  try {
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]
      if (!image) continue
      stored.push(await repository.create(topicId, image, startPosition + index))
    }

    return stored
  } catch (error) {
    // 只回滚本次创建的图片；追加到已有图片的帖子时不能碰原有记录。
    for (const image of stored) {
      await repository.deleteById(image.id)
    }
    throw error
  }
}

/**
 * 删除某帖的全部图片。字节和元数据都在 D1 的同一行里，
 * 删除后不会残留任何对象存储孤儿文件。
 */
export async function deleteTopicImages(
  store: ForumStore,
  env: Env,
  topicId: number,
  _images?: PostImage[],
): Promise<void> {
  await createPostImageRepository(store, env).deleteByTopic(topicId)
}
