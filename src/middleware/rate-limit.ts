import type { MiddlewareHandler } from 'hono'
import type { Env } from '../env'
import type { AppContext } from '../utils/session'

/**
 * 分层限流（P0 基线）：固定窗口计数，按「端点 scope + 客户端 IP」分桶。
 *
 * 能力边界（重要）：Workers 每个 isolate 有独立内存，且会随手回收，因此这是
 * 「尽力而为」的单实例限流——足以拖慢脚本化的撞库/灌水，但不能当作全局配额。
 * 需要跨实例的强一致限流时，应改为 Durable Object / KV 计数或 Cloudflare
 * WAF Rate Limiting 规则（P1）。
 */
export interface RateLimitOptions {
  /** 窗口长度（秒） */
  windowSeconds: number
  /** 同一窗口内允许的最大请求数 */
  max: number
  /** 命名空间，用于区分不同端点，避免互相计数 */
  scope: string
}

interface Bucket {
  count: number
  resetAt: number
}

/** 内存中最多跟踪的键数量，超过后清理过期项，必要时整体重置，避免无界增长 */
const MAX_TRACKED_KEYS = 10_000
const buckets = new Map<string, Bucket>()

function clientIp(c: AppContext): string {
  const direct = c.req.header('cf-connecting-ip')
  if (direct) return direct
  const forwarded = c.req.header('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown'
  return 'unknown'
}

function prune(now: number): void {
  if (buckets.size < MAX_TRACKED_KEYS) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
  if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear()
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const now = Date.now()
    prune(now)

    const key = `${options.scope}:${clientIp(c)}`
    const existing = buckets.get(key)

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowSeconds * 1000 })
      return next()
    }

    existing.count += 1
    if (existing.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
      return c.text('请求过于频繁，请稍后再试', 429, { 'Retry-After': String(retryAfter) })
    }

    return next()
  }
}
