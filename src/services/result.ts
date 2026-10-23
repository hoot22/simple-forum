/**
 * 服务层结果工具：用显式的成功/失败代替 null 多重语义。
 * 错误是「稳定代码 + 可选附加信息」的结构，展示文案由路由 / 视图层决定。
 */
import type { Result } from '../types'

export type { Result }

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

export function fail<E>(error: E): Result<never, E> {
  return { ok: false, error }
}
