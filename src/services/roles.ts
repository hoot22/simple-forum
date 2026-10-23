/**
 * 角色与权限规则（纯函数）：论坛主 / 管理员。
 *
 * - 论坛主 = 最早注册的账户，由存储层 getOwnerId() 运行时判定，不落库；
 * - 管理员 = users.is_admin，由论坛主指定；
 * - 本模块只做判定、不访问存储；调用方负责先取到 ownerId。
 */

import type { User } from '../types'

/** 是否为论坛主 */
export function isOwner(viewer: User | null, ownerId: number | null): boolean {
  return viewer !== null && ownerId !== null && viewer.id === ownerId
}

/** 指定 / 取消管理员：仅论坛主 */
export function canManageAdmins(viewer: User | null, ownerId: number | null): boolean {
  return isOwner(viewer, ownerId)
}
