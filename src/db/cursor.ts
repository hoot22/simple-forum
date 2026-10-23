/**
 * 游标工具：把「(排序键, id)」编码为不透明字符串，用于 keyset 分页。
 *
 * - 排序键是存储内可比较的字符串时间戳（内存实现为 ISO，D1 为 "YYYY-MM-DD HH:MM:SS"）；
 * - dir=older 表示从游标位置向更旧方向取一页；dir=newer 反向取一页（用于「较新」链接）；
 * - 游标是不透明的：客户端只应原样回传，不应解析其内容；
 * - 格式非法的游标由调用方按「没有游标（回到第一页）」处理，避免把解析细节泄漏给用户。
 */

export type CursorDirection = 'older' | 'newer'

export interface DecodedCursor {
  dir: CursorDirection
  key: string
  id: number
}

const CURSOR_VERSION = 1

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 50

/** 规范化分页大小：缺省 20，界内 [1, 50] */
export function normalizeLimit(limit: number | null | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE
  const rounded = Math.floor(limit)
  if (rounded < 1) return DEFAULT_PAGE_SIZE
  return Math.min(rounded, MAX_PAGE_SIZE)
}

function base64UrlEncode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): string {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  return atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

/** 编码游标：{ v: 版本, d: 方向, k: 排序键, i: id } */
export function encodeCursor(dir: CursorDirection, key: string, id: number): string {
  return base64UrlEncode(JSON.stringify({ v: CURSOR_VERSION, d: dir, k: key, i: id }))
}

/** 解析游标；格式非法时返回 null（调用方按「第一页」处理） */
export function decodeCursor(raw: string | null | undefined): DecodedCursor | null {
  if (!raw) return null
  try {
    const data = JSON.parse(base64UrlDecode(raw)) as { v?: unknown; d?: unknown; k?: unknown; i?: unknown }
    if (data.v !== CURSOR_VERSION) return null
    if (data.d !== 'older' && data.d !== 'newer') return null
    if (typeof data.k !== 'string' || data.k.length === 0) return null
    if (typeof data.i !== 'number' || !Number.isSafeInteger(data.i) || data.i <= 0) return null
    return { dir: data.d, key: data.k, id: data.i }
  } catch {
    return null
  }
}
