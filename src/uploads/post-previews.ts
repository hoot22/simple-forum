import type { ForumStore } from '../db/store'
import type { Env } from '../env'
import { MAX_PREVIEW_BYTES } from './image-validation'
import type { ValidatedImage } from './image-validation'

/**
 * 列表缩略图（preview）存储。
 *
 * 缩略图由客户端在上传时生成并提交，服务端不做任何图片处理——Workers 运行时没有
 * 可用的编解码器，Image Resizing 需要付费且依赖已启用的 Zone，纯 JS/WASM 解码会
 * 超出免费层的 CPU 预算。服务端只负责校验、存储与分发。
 *
 * 每个主题最多 MAX_POST_IMAGES 张图片，列表页每项最多取一张缩略图。
 */

export { MAX_PREVIEW_BYTES }

export interface PostPreviewMeta {
  imageId: number
  contentType: string
  byteSize: number
}

export interface StoredPreview extends PostPreviewMeta {
  topicId: number
  data: Uint8Array
}

interface PostPreviewRow {
  image_id: number
  topic_id: number
  content_type: string
  byte_size: number
  data?: ArrayBuffer | Uint8Array | number[]
}

interface PostPreviewMetaRow {
  image_id: number
  content_type: string
  byte_size: number
}

export interface PostPreviewRepository {
  put(topicId: number, imageId: number, image: ValidatedImage): Promise<void>
  get(imageId: number): Promise<StoredPreview | null>
  listMeta(imageIds: number[]): Promise<PostPreviewMeta[]>
  deleteByImage(imageId: number): Promise<void>
  deleteByTopic(topicId: number): Promise<void>
}

const memoryPreviews = new WeakMap<ForumStore, Map<number, StoredPreview>>()

function memory(store: ForumStore): Map<number, StoredPreview> {
  let map = memoryPreviews.get(store)
  if (!map) {
    map = new Map()
    memoryPreviews.set(store, map)
  }
  return map
}

/** D1 的 BLOB 列在不同运行时可能返回 ArrayBuffer 或 TypedArray，这里都接受。 */
function toBytes(value: PostPreviewRow['data']): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) return Uint8Array.from(value)
  return null
}

function toMeta(row: PostPreviewMetaRow): PostPreviewMeta {
  return {
    imageId: row.image_id,
    contentType: row.content_type,
    byteSize: row.byte_size,
  }
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function d1Repository(db: D1Database): PostPreviewRepository {
  return {
    async put(topicId, imageId, image) {
      await db
        .prepare(
          `INSERT INTO post_image_previews (image_id, topic_id, content_type, byte_size, data)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(image_id) DO UPDATE SET
             topic_id = excluded.topic_id,
             content_type = excluded.content_type,
             byte_size = excluded.byte_size,
             data = excluded.data`,
        )
        .bind(imageId, topicId, image.contentType, image.bytes.byteLength, image.bytes)
        .run()
    },

    async get(imageId) {
      const row = await db
        .prepare(
          `SELECT image_id, topic_id, content_type, byte_size, data
             FROM post_image_previews
            WHERE image_id = ?`,
        )
        .bind(imageId)
        .first<PostPreviewRow>()
      if (!row) return null
      const data = toBytes(row.data)
      if (!data) return null
      return { ...toMeta(row), topicId: row.topic_id, data }
    },

    async listMeta(imageIds) {
      if (imageIds.length === 0) return []
      const rows = await db
        .prepare(
          `SELECT image_id, content_type, byte_size
             FROM post_image_previews
            WHERE image_id IN (${placeholders(imageIds.length)})`,
        )
        .bind(...imageIds)
        .all<PostPreviewMetaRow>()
      return (rows.results ?? []).map(toMeta)
    },

    async deleteByImage(imageId) {
      await db.prepare('DELETE FROM post_image_previews WHERE image_id = ?').bind(imageId).run()
    },

    async deleteByTopic(topicId) {
      await db.prepare('DELETE FROM post_image_previews WHERE topic_id = ?').bind(topicId).run()
    },
  }
}

function memoryRepository(store: ForumStore): PostPreviewRepository {
  return {
    async put(topicId, imageId, image) {
      memory(store).set(imageId, {
        imageId,
        topicId,
        contentType: image.contentType,
        byteSize: image.bytes.byteLength,
        data: image.bytes,
      })
    },

    async get(imageId) {
      return memory(store).get(imageId) ?? null
    },

    async listMeta(imageIds) {
      const map = memory(store)
      const metas: PostPreviewMeta[] = []
      for (const imageId of imageIds) {
        const found = map.get(imageId)
        if (found) {
          metas.push({
            imageId: found.imageId,
            contentType: found.contentType,
            byteSize: found.byteSize,
          })
        }
      }
      return metas
    },

    async deleteByImage(imageId) {
      memory(store).delete(imageId)
    },

    async deleteByTopic(topicId) {
      const map = memory(store)
      for (const [imageId, preview] of map) {
        if (preview.topicId === topicId) map.delete(imageId)
      }
    },
  }
}

export function createPostPreviewRepository(
  store: ForumStore,
  env: Env,
): PostPreviewRepository {
  return env.DB ? d1Repository(env.DB) : memoryRepository(store)
}

/**
 * 按已落库的图片 ID 保存缩略图。entries 中未提供 image 的条目直接跳过，
 * 因此「只有部分图片带缩略图」不会导致整个上传失败。
 */
export async function savePreviews(
  store: ForumStore,
  env: Env,
  entries: Array<{ topicId: number; imageId: number; image: ValidatedImage | null }>,
): Promise<void> {
  const repository = createPostPreviewRepository(store, env)
  for (const entry of entries) {
    if (!entry.image) continue
    await repository.put(entry.topicId, entry.imageId, entry.image)
  }
}

/** 批量查询缩略图元数据，避免列表 / 详情出现 N+1。 */
export async function previewMetaFor(
  store: ForumStore,
  env: Env,
  imageIds: number[],
): Promise<Map<number, PostPreviewMeta>> {
  const metas = await createPostPreviewRepository(store, env).listMeta(imageIds)
  return new Map(metas.map((meta) => [meta.imageId, meta]))
}

export async function getPreview(
  store: ForumStore,
  env: Env,
  imageId: number,
): Promise<StoredPreview | null> {
  return createPostPreviewRepository(store, env).get(imageId)
}

export async function deletePreview(
  store: ForumStore,
  env: Env,
  imageId: number,
): Promise<void> {
  await createPostPreviewRepository(store, env).deleteByImage(imageId)
}

/** 必须在删除 post_images 记录之前调用。 */
export async function deletePreviewsByTopic(
  store: ForumStore,
  env: Env,
  topicId: number,
): Promise<void> {
  await createPostPreviewRepository(store, env).deleteByTopic(topicId)
}
