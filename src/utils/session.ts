import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Env } from '../env'
import type { ForumStore } from '../db/store'
import type { User } from '../types'
import { createSessionToken, readSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from './auth'

export type AppContext = Context<{ Bindings: Env }>

/** 从 Cookie 解析会话并返回用户；未登录 / 会话过期 / 用户已删除时返回 null */
export async function getCurrentUser(c: AppContext, store: ForumStore): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE)
  const userId = await readSessionToken(c.env, token)
  if (userId === null) return null
  return store.getUserById(userId)
}

/** 登录成功后写入会话 Cookie（7 天、HttpOnly、SameSite=Lax；HTTPS 下自动加 Secure） */
export async function startSession(c: AppContext, user: User): Promise<void> {
  const token = await createSessionToken(c.env, user.id)
  const secure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

/** 登出：删除会话 Cookie */
export function endSession(c: AppContext): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

/** 校验并规范化登录后的 next 回跳地址，只允许站内相对路径，防止开放重定向 */
export function safeNext(raw: string | null | undefined): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/'
}
