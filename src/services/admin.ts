import type { ForumStore } from '../db/store'
import type { User } from '../types'
import { fail, ok, type Result } from './result'
import { canManageAdmins as canManage, isOwner } from './roles'

/**
 * 角色管理服务：论坛主指定 / 取消管理员。
 * - 论坛主身份由存储层按「最早注册账户」判定；
 * - 非论坛主操作返回 FORBIDDEN；目标用户不存在返回 NOT_FOUND；
 * - 试图修改论坛主本人返回 CANNOT_MODIFY_OWNER。
 */

export type SetAdminError =
  | { code: 'NOT_FOUND' }
  | { code: 'FORBIDDEN' }
  | { code: 'CANNOT_MODIFY_OWNER' }

export function createAdminService(store: ForumStore) {
  return {
    /** 当前查看者是否为论坛主（决定是否展示「指定管理员」入口） */
    async canManageAdmins(viewer: User | null): Promise<boolean> {
      if (!viewer) return false
      return canManage(viewer, await store.getOwnerId())
    },

    /** 论坛主 id（个人页徽标展示用；空库为 null）。 */
    getOwnerId(): Promise<number | null> {
      return store.getOwnerId()
    },

    async setAdmin(
      actor: User,
      targetUserId: number,
      isAdmin: boolean,
    ): Promise<Result<User, SetAdminError>> {
      const ownerId = await store.getOwnerId()
      if (!isOwner(actor, ownerId)) return fail({ code: 'FORBIDDEN' })
      if (targetUserId === ownerId) return fail({ code: 'CANNOT_MODIFY_OWNER' })

      const updated = await store.setUserAdmin(targetUserId, isAdmin)
      if (!updated.ok) return fail({ code: 'NOT_FOUND' })
      return ok(updated.value)
    },
  }
}

export type AdminService = ReturnType<typeof createAdminService>
