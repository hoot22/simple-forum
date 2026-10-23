/**
 * 兼容两种存储的时间格式：
 * - 内存实现：ISO 8601，例如 "2026-09-06T08:30:00.000Z"
 * - D1 / SQLite：datetime('now') 返回 UTC "2026-09-06 08:30:00"
 */
export function formatTime(raw: string): string {
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw
  // 存储统一为 UTC；这里固定 +8 小时换算北京时间。
  // 不依赖运行时默认时区与 ICU 时区数据：workerd 默认是 UTC，
  // 且中国自 1991 年起无夏令时，UTC+8 恒定，所以固定偏移是精确的。
  const beijingOffsetMinutes = 8 * 60
  const beijing = new Date(date.getTime() + beijingOffsetMinutes * 60_000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())}` +
    ` ${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}`
  )
}

/** 首页列表用的简短摘要 */
export function excerpt(content: string, max = 80): string {
  if (content.length <= max) return content
  return `${content.slice(0, max)}…`
}
