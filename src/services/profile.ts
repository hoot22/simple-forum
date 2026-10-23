import type { ForumStore, UserStats } from '../db/store'
import type { Page, ReplyWithTopic, Topic, User } from '../types'
import { fail, ok, type Result } from './result'

/**
 * 个人页服务：把「用户资料 + 统计 + 主题一页 + 回复一页」聚合为一次调用。
 * 回复列表自带主题标题（存储层 JOIN 完成），不再逐条回查主题。
 */

export interface ProfilePageData {
  profile: User
  stats: UserStats
  topics: Page<Topic>
  replies: Page<ReplyWithTopic>
}

export type ProfileError = { code: 'NOT_FOUND' }

/** 个人页每个列表显示的条数（后续要加分页链接时改这里即可） */
export const PROFILE_PAGE_SIZE = 10

export function createProfileService(store: ForumStore) {
  return {
    async getProfilePageData(params: {
      userId: number
      pageSize?: number
    }): Promise<Result<ProfilePageData, ProfileError>> {
      const profile = await store.getUserById(params.userId)
      if (!profile) return fail({ code: 'NOT_FOUND' })

      const pageSize = params.pageSize ?? PROFILE_PAGE_SIZE
      const [stats, topics, replies] = await Promise.all([
        store.getUserStats(params.userId),
        store.listTopicsByAuthor({ authorId: params.userId, limit: pageSize }),
        store.listRepliesByAuthor({ authorId: params.userId, limit: pageSize }),
      ])
      return ok({ profile, stats, topics, replies })
    },
  }
}

export type ProfileService = ReturnType<typeof createProfileService>
