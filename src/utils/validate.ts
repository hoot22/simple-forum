import { POST_FONT_DEFAULT, toPostFontId } from '../fonts/post-fonts'
import type { NewReplyInput, NewTopicInput } from '../types'

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

/** 用户名：字母（含中文等 Unicode 字母）/数字/下划线，2-20 位 */
export const USERNAME_PATTERN = /^[\p{L}\p{N}_]{2,20}$/u

export const PASSWORD_MIN = 6
export const PASSWORD_MAX = 72

export function validateNewTopic(
  title: unknown,
  content: unknown,
  font: unknown = POST_FONT_DEFAULT,
): Validation<NewTopicInput> {
  const errors: string[] = []
  const t = typeof title === 'string' ? title.trim() : ''
  const c = typeof content === 'string' ? content.trim() : ''
  if (t.length === 0) errors.push('标题不能为空')
  else if (t.length > 120) errors.push('标题不能超过 120 字')
  if (c.length > 5000) errors.push('内容不能超过 5000 字')
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { title: t, content: c, font: toPostFontId(font) } }
}

export interface AnnouncementValues {
  title: string
  body: string
}

/** 公告：标题与正文都必填，长度上限与发帖保持一致（标题 120 字、正文 5000 字）。 */
export function validateAnnouncement(title: unknown, body: unknown): Validation<AnnouncementValues> {
  const errors: string[] = []
  const t = typeof title === 'string' ? title.trim() : ''
  const b = typeof body === 'string' ? body.trim() : ''
  if (t.length === 0) errors.push('公告标题不能为空')
  else if (t.length > 120) errors.push('公告标题不能超过 120 字')
  if (b.length === 0) errors.push('公告内容不能为空')
  else if (b.length > 5000) errors.push('公告内容不能超过 5000 字')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { title: t, body: b } }
}

export function validateNewReply(content: unknown): Validation<NewReplyInput> {
  const errors: string[] = []
  const c = typeof content === 'string' ? content.trim() : ''
  if (c.length === 0) errors.push('回复内容不能为空')
  else if (c.length > 5000) errors.push('回复不能超过 5000 字')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { content: c } }
}

export interface RegisterValues {
  username: string
  password: string
}

export function validateRegister(
  username: unknown,
  password: unknown,
  confirmPassword: unknown,
): Validation<RegisterValues> {
  const errors: string[] = []
  const u = typeof username === 'string' ? username.trim() : ''
  const p = typeof password === 'string' ? password : ''
  const cp = typeof confirmPassword === 'string' ? confirmPassword : ''
  if (u.length === 0) errors.push('用户名不能为空')
  else if (!USERNAME_PATTERN.test(u)) errors.push('用户名需为 2-20 位字母（含中文）/数字/下划线')
  if (p.length < PASSWORD_MIN) errors.push(`密码至少 ${PASSWORD_MIN} 位`)
  else if (p.length > PASSWORD_MAX) errors.push(`密码不能超过 ${PASSWORD_MAX} 位`)
  if (p !== cp) errors.push('两次输入的密码不一致')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { username: u, password: p } }
}

export interface LoginValues {
  username: string
  password: string
}

export function validateLogin(username: unknown, password: unknown): Validation<LoginValues> {
  const errors: string[] = []
  const u = typeof username === 'string' ? username.trim() : ''
  const p = typeof password === 'string' ? password : ''
  if (u.length === 0) errors.push('请输入用户名')
  if (p.length === 0) errors.push('请输入密码')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { username: u, password: p } }
}

/** 解析路径中的主题 id，非法时返回 null（调用方转 404） */
export function parseTopicId(raw: string | undefined): number | null {
  if (!raw) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 解析回复 id（路径参数或表单字段），非法时返回 null */
export function parseReplyId(raw: string | undefined): number | null {
  if (!raw) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** 解析路径中的用户 id，非法时返回 null（调用方转 404） */
export function parseUserId(raw: string | undefined): number | null {
  if (!raw) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
