import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Env } from '../env'
import { SESSION_COOKIE } from '../utils/auth'

/**
 * 统一安全响应头（P0）。
 *
 * 设计取舍：
 * - CSP 采用最保守组合：默认禁止一切（default-src 'none'），只逐项放开需要的同源资源。
 *   注意 font-src 与 connect-src 必须显式声明：CSP 中缺失的指令会回落到 default-src，
 *   而它是 'none'，会让自定义字体（@font-face）和同源 fetch 被浏览器静默拦截，
 *   页面外观与功能看起来「没有生效」，且控制台之外没有明显报错。
 * - HSTS 只在请求已经是 HTTPS 时下发：本地 wrangler dev 走 http://localhost，
 *   过早下发 HSTS 会把开发者自己的浏览器锁进强制 HTTPS。
 * - 携带会话 Cookie 的请求加 Cache-Control: no-store，避免个人页/登录态页面
 *   被浏览器或中间缓存留存。
 * - 在 next() 之前写入头部：这样 404、500 等由框架生成的响应也会带上安全头。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "script-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ')

export function securityHeaders(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')

    if (new URL(c.req.url).protocol === 'https:') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }

    if (getCookie(c, SESSION_COOKIE)) {
      c.header('Cache-Control', 'no-store')
    }

    await next()
  }
}
