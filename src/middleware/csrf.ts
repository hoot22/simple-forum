import type { MiddlewareHandler } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { Env } from '../env'
import type { AppContext } from '../utils/session'

/**
 * CSRF 防护（P0）：双提交 Cookie（double-submit cookie）模式。
 *
 * 为什么不是 session 里存令牌：本项目会话是无状态的签名 Cookie，没有服务端
 * session 表。双提交模式把随机令牌同时放在 Cookie 和请求体（表单隐藏字段）或
 * 请求头里，服务端只比对两者是否一致——攻击者站点既读不到 Cookie，也无法在
 * 跨站请求里带上正确令牌。
 *
 * 令牌本身不是凭据：真正的登录凭据仍是 HttpOnly 的会话 Cookie，因此这里的
 * CSRF Cookie 允许同源脚本读取（httpOnly: false），方便将来接前端时放进请求头。
 */

export const CSRF_COOKIE = 'forum_csrf'
/** 表单隐藏字段名 */
export const CSRF_FIELD = '_csrf'
/** 非表单请求（JSON API）使用的请求头 */
export const CSRF_HEADER = 'x-csrf-token'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const TOKEN_TTL_SECONDS = 8 * 60 * 60
const MIN_TOKEN_LENGTH = 32

/** 同一请求内复用同一个令牌：否则中间件与视图会各生成一次，导致校验必然失败 */
const perRequestToken = new WeakMap<object, string>()

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function isUsableToken(token: string | null | undefined): token is string {
  return typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH
}

/** 常量时间比较，避免通过响应时间差逐字节猜令牌 */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 读取（必要时生成）当前请求的 CSRF 令牌；生成的令牌会写入 Cookie */
export function csrfToken(c: AppContext): string {
  const cached = perRequestToken.get(c)
  if (cached) return cached

  const existing = getCookie(c, CSRF_COOKIE)
  const token = isUsableToken(existing) ? existing : randomToken()

  if (token !== existing) {
    setCookie(c, CSRF_COOKIE, token, {
      httpOnly: false,
      secure: new URL(c.req.url).protocol === 'https:',
      sameSite: 'Lax',
      path: '/',
      maxAge: TOKEN_TTL_SECONDS,
    })
  }

  perRequestToken.set(c, token)
  return token
}

/** 从请求头或请求体里取出客户端提交的令牌 */
async function readSubmittedToken(c: AppContext): Promise<string | null> {
  const header = c.req.header(CSRF_HEADER)
  if (header) return header

  const contentType = c.req.header('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      const body = (await c.req.json()) as Record<string, unknown> | null
      const value = body ? body[CSRF_FIELD] : undefined
      return typeof value === 'string' ? value : null
    }
    const body = await c.req.parseBody()
    const value = body[CSRF_FIELD]
    return typeof value === 'string' ? value : null
  } catch {
    // 解析失败按“没有提交令牌”处理，交给下面统一返回 403
    return null
  }
}

/**
 * 全局挂载：安全方法只下发令牌，非安全方法必须先通过令牌校验。
 * 校验失败返回 403，不会进入业务处理。
 */
export function csrfProtection(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      csrfToken(c)
      return next()
    }

    // 浏览器跨站写请求会带 Origin，先做一次来源比对，作为令牌之外的额外防线
    const origin = c.req.header('origin')
    if (origin && origin !== 'null' && origin !== new URL(c.req.url).origin) {
      return c.text('CSRF 校验失败：请求来源与站点不一致', 403)
    }

    const cookieToken = getCookie(c, CSRF_COOKIE)
    const submitted = await readSubmittedToken(c)
    if (!isUsableToken(cookieToken) || !submitted || !tokensMatch(cookieToken, submitted)) {
      return c.text('CSRF 校验失败，请返回上一页刷新后重试', 403)
    }
    return next()
  }
}
