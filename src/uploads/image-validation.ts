import type { PostImage } from '../types'

export const MAX_POST_IMAGES = 3
export const MAX_IMAGE_BYTES = 1024 * 1024
export const MAX_IMAGE_DIMENSION = 12_000
export const MAX_UPLOAD_BODY_BYTES = 4 * 1024 * 1024

/**
 * 缩略图字节上限。
 *
 * 缩略图由客户端生成（Workers 运行时没有图片编解码器），服务端只做大小与格式校验。
 * 256 KiB 对 400–800px 的有损 JPEG/WebP 非常宽松，同时把列表页最坏出网量压到可接受范围。
 */
export const MAX_PREVIEW_BYTES = 256 * 1024

/** 把「多大算超限」和对应文案打包，让原图与缩略图复用同一套校验逻辑。 */
export interface ImageSizeLimit {
  maxBytes: number
  emptyError: string
  oversizeError: string
}

export const DEFAULT_IMAGE_LIMIT: ImageSizeLimit = {
  maxBytes: MAX_IMAGE_BYTES,
  emptyError: '图片不能为空',
  oversizeError: '每张图片不能超过 1 MiB，请压缩后再试',
}

export const PREVIEW_LIMIT: ImageSizeLimit = {
  maxBytes: MAX_PREVIEW_BYTES,
  emptyError: '缩略图不能为空',
  oversizeError: '缩略图不能超过 256 KiB',
}

export interface ValidatedImage {
  bytes: Uint8Array
  contentType: PostImage['contentType']
  extension: 'jpg' | 'png' | 'webp' | 'gif'
  width: number
  height: number
}

export type ImageValidationResult =
  | { ok: true; value: ValidatedImage }
  | { ok: false; error: string }

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]!
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (length < 2 || offset + length + 2 > bytes.length) return null
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      }
    }
    offset += length + 2
  }
  return null
}

function detect(bytes: Uint8Array): Omit<ValidatedImage, 'bytes'> | null {
  if (bytes.length >= 24 && bytes.slice(0, 8).every((value, i) => value === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i])) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { contentType: 'image/png', extension: 'png', width: view.getUint32(16), height: view.getUint32(20) }
  }
  const ascii = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end))
  if (bytes.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    return { contentType: 'image/gif', extension: 'gif', width: bytes[6]! | (bytes[7]! << 8), height: bytes[8]! | (bytes[9]! << 8) }
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dimensions = jpegDimensions(bytes)
    return dimensions ? { contentType: 'image/jpeg', extension: 'jpg', ...dimensions } : null
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const kind = ascii(12, 16)
    if (kind === 'VP8X') return { contentType: 'image/webp', extension: 'webp', width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 }
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
      return { contentType: 'image/webp', extension: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { contentType: 'image/webp', extension: 'webp', width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff }
    }
  }
  return null
}

export async function validateImage(
  file: File,
  limit: ImageSizeLimit = DEFAULT_IMAGE_LIMIT,
): Promise<ImageValidationResult> {
  if (file.size <= 0) return { ok: false, error: limit.emptyError }
  if (file.size > limit.maxBytes) return { ok: false, error: limit.oversizeError }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength !== file.size || bytes.byteLength > limit.maxBytes) return { ok: false, error: '图片大小无效' }
  const detected = detect(bytes)
  if (!detected) return { ok: false, error: '只允许完整的 JPEG、PNG、WebP 或 GIF 图片' }
  if (file.type && file.type !== detected.contentType) return { ok: false, error: '图片声明类型与实际格式不一致' }
  if (detected.width <= 0 || detected.height <= 0 || detected.width > MAX_IMAGE_DIMENSION || detected.height > MAX_IMAGE_DIMENSION) {
    return { ok: false, error: '图片尺寸无效或超过 12000 × 12000 像素' }
  }
  return { ok: true, value: { bytes, ...detected } }
}

export async function validateImages(
  files: File[],
  limit: ImageSizeLimit = DEFAULT_IMAGE_LIMIT,
  label = '图片',
): Promise<{ ok: true; value: ValidatedImage[] } | { ok: false; errors: string[] }> {
  if (files.length > MAX_POST_IMAGES) return { ok: false, errors: [`每个帖子最多上传 ${MAX_POST_IMAGES} 张图片`] }
  const images: ValidatedImage[] = []
  const errors: string[] = []
  for (const [index, file] of files.entries()) {
    const result = await validateImage(file, limit)
    if (result.ok) images.push(result.value)
    else errors.push(`第 ${index + 1} 张${label}：${result.error}`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: images }
}

/**
 * 从 multipart 表单中收集用户实际选择的图片文件，忽略空字段。
 *
 * 必须传入 FormData 而不是 parseBody() 的结果：Hono 的 parseBody 对同名多文件字段
 * 只保留最后一个 File，只有 FormData.getAll 才能拿到全部选择。页面路由与 /api 共用。
 */
export function collectImageFiles(
  form: FormData,
  fieldNames: string[] = ['images', 'image'],
): File[] {
  const entries: unknown[] = fieldNames.flatMap((name) => form.getAll(name))
  return entries.filter((item): item is File => item instanceof File && item.size > 0)
}
