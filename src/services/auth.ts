import type { ForumStore } from '../db/store'
import type { User } from '../types'
import { hashPassword, verifyPassword } from '../utils/auth'
import { validateLogin, validateRegister } from '../utils/validate'
import { fail, ok, type Result } from './result'

/**
 * 认证服务：注册与登录的用例编排。
 * - 页面与 API 共用这一层，保证校验、哈希、错误映射一致；
 * - 会话 Cookie 的读写属于 HTTP 层，仍由路由负责（startSession / endSession）；
 * - 错误使用稳定代码，展示文案由路由/视图层决定。
 */

export type RegisterError =
  | { code: 'VALIDATION_FAILED'; errors: string[] }
  | { code: 'USERNAME_TAKEN' }

export type LoginError =
  | { code: 'VALIDATION_FAILED'; errors: string[] }
  | { code: 'INVALID_CREDENTIALS' }

export interface RegisterInput {
  username: unknown
  password: unknown
  confirmPassword: unknown
}

export interface LoginInput {
  username: unknown
  password: unknown
}

export function createAuthService(store: ForumStore) {
  return {
    /** 注册：校验 → 哈希密码 → 创建用户（用户名冲突返回 USERNAME_TAKEN） */
    async register(input: RegisterInput): Promise<Result<User, RegisterError>> {
      const validation = validateRegister(input.username, input.password, input.confirmPassword)
      if (!validation.ok) return fail({ code: 'VALIDATION_FAILED', errors: validation.errors })

      const passwordHash = await hashPassword(validation.value.password)
      const created = await store.createUser(validation.value.username, passwordHash)
      if (!created.ok) return fail({ code: 'USERNAME_TAKEN' })
      return ok(created.value)
    },

    /** 登录：校验 → 查找用户 → 常量时间校验密码；失败统一为 INVALID_CREDENTIALS */
    async login(input: LoginInput): Promise<Result<User, LoginError>> {
      const validation = validateLogin(input.username, input.password)
      if (!validation.ok) return fail({ code: 'VALIDATION_FAILED', errors: validation.errors })

      const record = await store.getUserByUsername(validation.value.username)
      const verified =
        record !== null && (await verifyPassword(validation.value.password, record.passwordHash))
      if (!record || !verified) return fail({ code: 'INVALID_CREDENTIALS' })
      return ok({
        id: record.id,
        username: record.username,
        isAdmin: record.isAdmin,
        createdAt: record.createdAt,
      })
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>
