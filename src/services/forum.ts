import type { ForumStore, GetTopicDetailQuery, ListTopicsQuery } from '../db/store'
import type { Notification, Page, Reply, Topic, TopicDetail, User } from '../types'
import { validateAnnouncement, validateNewReply, validateNewTopic } from '../utils/validate'
import { fail, ok, type Result } from './result'
import { isOwner } from './roles'

/**
 * 论坛服务：主题列表 / 详情 / 发帖 / 回复的用例编排。
 * - 路由只负责：解析请求 → 调用本服务 → 把领域错误映射为页面错误或 API 状态码；
 * - 校验规则来自 utils/validate，页面与 API 走的都是同一条路径；
 * - 列表统一返回游标分页 Page<T>，展示层无需关心游标细节。
 */

export type NotFoundError = { code: 'NOT_FOUND' }

export type CreateTopicError =
  | { code: 'VALIDATION_FAILED'; errors: string[] }
  | { code: 'AUTHOR_NOT_FOUND' }

export type CreateReplyError =
  | { code: 'VALIDATION_FAILED'; errors: string[] }
  | { code: 'TOPIC_NOT_FOUND' | 'AUTHOR_NOT_FOUND' }

/**
 * 删除主题的错误码：
 * - NOT_FOUND：主题不存在（或并发中已被删除）；
 * - FORBIDDEN：当前用户既不是作者，也不是管理员 / 论坛主。
 */
export type DeleteTopicError = { code: 'NOT_FOUND' | 'FORBIDDEN' }

/**
 * 置顶 / 公告 / 发布公告的错误码：
 * - NOT_FOUND：主题不存在（或并发中已被删除）；
 * - FORBIDDEN：当前用户既不是管理员也不是论坛主；
 * - VALIDATION_FAILED：公告标题或正文不合法。
 */
export type ManageTopicError = { code: 'NOT_FOUND' | 'FORBIDDEN' }
export type PublishAnnouncementError = { code: 'FORBIDDEN' | 'VALIDATION_FAILED'; errors: string[] }

export function createForumService(store: ForumStore) {
  /**
   * 删除权限：作者本人、管理员、论坛主（最早注册账户）。
   * 作者 / 管理员可直接短路，只有其余情况才查询 ownerId。
   */
  const canDeleteTopic = async (
    viewer: User | null,
    topic: Pick<Topic, 'authorId'>,
  ): Promise<boolean> => {
    if (!viewer) return false
    if (viewer.id === topic.authorId || viewer.isAdmin) return true
    return isOwner(viewer, await store.getOwnerId())
  }

  /**
   * 置顶 / 公告权限：仅管理员与论坛主。
   * 与删除不同，这里不含作者本人 —— 置顶与公告是面向全站的展示位。
   */
  const canManageTopics = async (viewer: User | null): Promise<boolean> => {
    if (!viewer) return false
    if (viewer.isAdmin) return true
    return isOwner(viewer, await store.getOwnerId())
  }

  return {
    canDeleteTopic,
    canManageTopics,

    listTopics(query: ListTopicsQuery = {}): Promise<Page<Topic>> {
      return store.listTopics(query)
    },

    /** 首页置顶区块（不受游标分页影响，单独查询） */
    listPinnedTopics(limit?: number): Promise<Topic[]> {
      return store.listPinnedTopics(limit)
    },

    getTopicById(topicId: number): Promise<Topic | null> {
      return store.getTopicById(topicId)
    },

    /** 置顶 / 取消置顶。权限不足返回 FORBIDDEN，主题不存在返回 NOT_FOUND。 */
    async setTopicPinned(
      actor: User,
      topicId: number,
      pinned: boolean,
    ): Promise<Result<Topic, ManageTopicError>> {
      if (!(await canManageTopics(actor))) return fail({ code: 'FORBIDDEN' })
      const updated = await store.setTopicPinned(topicId, pinned)
      if (!updated.ok) return fail({ code: 'NOT_FOUND' })
      return ok(updated.value)
    },

    /** 设为 / 取消公告。设为公告时同时生成一条指向该主题的公告记录。 */
    async setTopicAnnouncement(
      actor: User,
      topicId: number,
      value: boolean,
    ): Promise<Result<Topic, ManageTopicError>> {
      if (!(await canManageTopics(actor))) return fail({ code: 'FORBIDDEN' })
      const updated = await store.setTopicAnnouncement(topicId, value)
      if (!updated.ok) return fail({ code: 'NOT_FOUND' })
      return ok(updated.value)
    },

    /** 在公告页手工发布一条公告（不关联主题）。 */
    async publishAnnouncement(
      actor: User,
      input: { title: unknown; body: unknown },
    ): Promise<Result<Notification, PublishAnnouncementError>> {
      if (!(await canManageTopics(actor))) {
        return fail({ code: 'FORBIDDEN', errors: ['只有论坛主或管理员可以发布公告。'] })
      }
      const validation = validateAnnouncement(input.title, input.body)
      if (!validation.ok) return fail({ code: 'VALIDATION_FAILED', errors: validation.errors })

      const created = await store.createNotification({
        kind: 'announcement',
        title: validation.value.title,
        body: validation.value.body,
      })
      if (!created.ok) return fail({ code: 'VALIDATION_FAILED', errors: ['公告发布失败，请重试。'] })
      return ok(created.value)
    },

    async deleteTopic(
      actor: User,
      topicId: number,
    ): Promise<Result<{ id: number }, DeleteTopicError>> {
      const topic = await store.getTopicById(topicId)
      if (!topic) return fail({ code: 'NOT_FOUND' })
      if (!(await canDeleteTopic(actor, topic))) return fail({ code: 'FORBIDDEN' })
      const deleted = await store.deleteTopic(topicId)
      if (!deleted.ok) return fail({ code: 'NOT_FOUND' })
      return ok(deleted.value)
    },

    async getTopicDetail(query: GetTopicDetailQuery): Promise<Result<TopicDetail, NotFoundError>> {
      const detail = await store.getTopicDetail(query)
      return detail ? ok(detail) : fail({ code: 'NOT_FOUND' })
    },

    async createTopic(
      user: User,
      input: { title: unknown; content: unknown; font?: unknown },
    ): Promise<Result<Topic, CreateTopicError>> {
      const validation = validateNewTopic(input.title, input.content, input.font)
      if (!validation.ok) return fail({ code: 'VALIDATION_FAILED', errors: validation.errors })

      const created = await store.createTopic(user, validation.value)
      if (!created.ok) return fail({ code: 'AUTHOR_NOT_FOUND' })
      return ok(created.value)
    },

    async createReply(
      user: User,
      topicId: number,
      input: { content: unknown; parentReplyId?: unknown },
    ): Promise<Result<Reply, CreateReplyError>> {
      const validation = validateNewReply(input.content)
      if (!validation.ok) return fail({ code: 'VALIDATION_FAILED', errors: validation.errors })

      const parentReplyId = normaliseParentReplyId(input.parentReplyId)
      if (parentReplyId === 'invalid') {
        return fail({ code: 'VALIDATION_FAILED', errors: ['要回复的评论不存在。'] })
      }
      if (parentReplyId !== null) {
        const parent = await store.getReplyById(parentReplyId)
        // 目标必须真实存在且属于同一主题，避免跨主题挂载或指向已删除的楼层
        if (!parent || parent.topicId !== topicId) {
          return fail({ code: 'VALIDATION_FAILED', errors: ['要回复的评论不存在。'] })
        }
      }

      const created = await store.createReply(user, topicId, {
        ...validation.value,
        parentReplyId,
      })
      if (!created.ok) return fail({ code: created.error })
      return ok(created.value)
    },
  }
}

/**
 * 解析父回复 ID。
 * 表单未提交、空串或 null 视为「顶层回复」；非正整数一律视为非法，由调用方拒绝。
 */
function normaliseParentReplyId(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : Number.NaN
  return Number.isSafeInteger(value) && value > 0 ? value : 'invalid'
}

export type ForumService = ReturnType<typeof createForumService>
