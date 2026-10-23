import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { ForumStore } from '../../src/db/store'
import type { User } from '../../src/types'
import { hashPassword, verifyPassword } from '../../src/utils/auth'

/**
 * ForumStore 契约测试（P1）。
 *
 * 同一套用例对两种实现逐条验证，保证「换存储不改行为」：
 * - MemoryForumStore：本地开发/测试适配器；
 * - D1ForumStore：Cloudflare D1（测试中用 Miniflare 的本地 SQLite 驱动）。
 *
 * 约定：每个用例都通过 create() 拿一个空库，断言只依赖相对顺序与显式返回值，
 * 不依赖具体 id 数值，也不依赖时间戳精度（D1 为秒级、内存为毫秒级）。
 */

export interface ContractHarness {
  /** 返回一个干净（空）的存储实例；每次调用互相独立 */
  create: () => Promise<ForumStore>
  /** 测试结束后的清理（例如释放 Miniflare 实例） */
  dispose?: () => Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function mustUser(store: ForumStore, username: string): Promise<User> {
  const created = await store.createUser(username, await hashPassword(`pw-${username}`))
  if (!created.ok) throw new Error(`创建用户 ${username} 失败`)
  return created.value
}

async function mustTopic(store: ForumStore, user: User, title: string) {
  const created = await store.createTopic(user, { title, content: `${title} 的内容` })
  if (!created.ok) throw new Error(`创建主题失败：${title}`)
  return created.value
}

export function runRepositoryContract(name: string, harness: ContractHarness): void {
  describe(`ForumStore 契约（${name}）`, () => {
    let store: ForumStore

    beforeEach(async () => {
      store = await harness.create()
    })

    if (harness.dispose) {
      afterAll(async () => {
        await harness.dispose?.()
      })
    }

    // ---------- 用户 ----------

    it('创建用户：成功后可按用户名（不区分大小写）查回，哈希可校验', async () => {
      const created = await store.createUser('  Alice ', await hashPassword('secret-1'))
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const found = await store.getUserByUsername('alice')
      expect(found).not.toBeNull()
      expect(found?.id).toBe(created.value.id)
      expect(found?.username).toBe('Alice')
      expect(await verifyPassword('secret-1', found!.passwordHash)).toBe(true)
    })

    it('创建用户：用户名重复（不区分大小写）返回 USERNAME_TAKEN', async () => {
      await store.createUser('bob', await hashPassword('secret-1'))
      const again = await store.createUser('BOB', await hashPassword('secret-2'))
      expect(again).toEqual({ ok: false, error: 'USERNAME_TAKEN' })
    })

    it('getUserById 未知用户返回 null；新用户统计为 0', async () => {
      expect(await store.getUserById(999_999)).toBeNull()
      const user = await mustUser(store, 'carol')
      expect(await store.getUserStats(user.id)).toEqual({ topicCount: 0, replyCount: 0 })
    })

    // ---------- 主题 ----------

    it('发帖：作者解析、回复数为 0、lastActivityAt 等于创建时间', async () => {
      const alice = await mustUser(store, 'alice')
      const created = await store.createTopic(alice, { title: '你好', content: '第一帖' })
      expect(created.ok).toBe(true)
      if (!created.ok) return

      const t = created.value
      expect(t.author).toBe('alice')
      expect(t.replyCount).toBe(0)
      expect(t.lastActivityAt).toBe(t.createdAt)

      const page = await store.listTopics()
      expect(page.items.map((x) => x.id)).toEqual([t.id])
      expect(page.items[0]?.author).toBe('alice')
      expect(page.nextCursor).toBeNull()
      expect(page.prevCursor).toBeNull()
    })

    it('发帖：作者不存在返回 AUTHOR_NOT_FOUND', async () => {
      const ghost: User = { id: 999_999, username: 'ghost', createdAt: new Date().toISOString(), isAdmin: false }
      const created = await store.createTopic(ghost, { title: 'x', content: '' })
      expect(created).toEqual({ ok: false, error: 'AUTHOR_NOT_FOUND' })
    })

    it('主题分页：limit=2 翻完 5 帖，无重复无遗漏，prevCursor 能回到上一页', async () => {
      const alice = await mustUser(store, 'alice')
      const ids: number[] = []
      for (let i = 1; i <= 5; i += 1) {
        const t = await mustTopic(store, alice, `主题 ${i}`)
        ids.push(t.id)
      }
      const expected = [...ids].reverse() // 从新到旧

      const page1 = await store.listTopics({ limit: 2 })
      expect(page1.items.map((t) => t.id)).toEqual(expected.slice(0, 2))
      expect(page1.prevCursor).toBeNull()

      const page2 = await store.listTopics({ cursor: page1.nextCursor, limit: 2 })
      expect(page2.items.map((t) => t.id)).toEqual(expected.slice(2, 4))

      const page3 = await store.listTopics({ cursor: page2.nextCursor, limit: 2 })
      expect(page3.items.map((t) => t.id)).toEqual(expected.slice(4))
      expect(page3.nextCursor).toBeNull()

      // 从第 2 页回到第 1 页（dir=newer 反向取一页）
      const back = await store.listTopics({ cursor: page2.prevCursor, limit: 2 })
      expect(back.items.map((t) => t.id)).toEqual(expected.slice(0, 2))
    })

    it('非法游标按第一页处理，不抛错', async () => {
      const alice = await mustUser(store, 'alice')
      await mustTopic(store, alice, 'A')
      await mustTopic(store, alice, 'B')

      const bad = await store.listTopics({ cursor: '这不是一个合法游标', limit: 10 })
      const plain = await store.listTopics({ limit: 10 })
      expect(bad.items.map((t) => t.id)).toEqual(plain.items.map((t) => t.id))
    })

    it('排序：active 按最后回复时间，新回复把主题顶到前面', async () => {
      const alice = await mustUser(store, 'alice')
      const first = await mustTopic(store, alice, '先发的')
      const second = await mustTopic(store, alice, '后发的')

      // D1 时间戳为秒级：等待 1.1s，保证回复时间严格晚于第二条主题的创建时间
      await sleep(1100)
      const reply = await store.createReply(alice, first.id, { content: '顶一下' })
      expect(reply.ok).toBe(true)

      const newest = await store.listTopics({ sort: 'newest', limit: 10 })
      expect(newest.items.map((t) => t.id)).toEqual([second.id, first.id])

      const active = await store.listTopics({ sort: 'active', limit: 10 })
      expect(active.items.map((t) => t.id)).toEqual([first.id, second.id])
    })

    // ---------- 回复 ----------

    it('回复：主题不存在返回 TOPIC_NOT_FOUND', async () => {
      const alice = await mustUser(store, 'alice')
      const created = await store.createReply(alice, 999_999, { content: '在吗' })
      expect(created).toEqual({ ok: false, error: 'TOPIC_NOT_FOUND' })
    })

    it('回复：成功入列，主题回复数与最后活动时间随之更新', async () => {
      const alice = await mustUser(store, 'alice')
      const topic = await mustTopic(store, alice, '活动测试')
      const reply = await store.createReply(alice, topic.id, { content: '你好' })
      expect(reply.ok).toBe(true)
      if (!reply.ok) return

      const detail = await store.getTopicDetail({ topicId: topic.id })
      expect(detail).not.toBeNull()
      expect(detail?.replyCount).toBe(1)
      expect(detail?.lastActivityAt).toBe(reply.value.createdAt)
      expect(detail?.replies.items.map((r) => r.id)).toEqual([reply.value.id])
    })

    it('嵌套回复：父回复 ID 与父作者可读回，顶层回复为 null', async () => {
      const alice = await mustUser(store, 'alice')
      const topic = await mustTopic(store, alice, '嵌套回复')
      const root = await store.createReply(alice, topic.id, { content: '一楼' })
      if (!root.ok) throw new Error('建楼层失败')

      const bob = await mustUser(store, 'bob')
      const child = await store.createReply(bob, topic.id, {
        content: '回复一楼',
        parentReplyId: root.value.id,
      })
      expect(child.ok).toBe(true)
      if (!child.ok) return

      // 主题详情同样要带回父回复信息，页面才能把子回复缩进到父回复下
      const detail = await store.getTopicDetail({ topicId: topic.id })
      const childInDetail = detail?.replies.items.find((r) => r.id === child.value.id)
      expect(childInDetail?.parentReplyId).toBe(root.value.id)
      expect(childInDetail?.parentAuthor).toBe('alice')

      const fetched = await store.getReplyById(child.value.id)
      expect(fetched?.parentReplyId).toBe(root.value.id)
      expect(fetched?.parentAuthor).toBe('alice')

      const rootFetched = await store.getReplyById(root.value.id)
      expect(rootFetched?.parentReplyId ?? null).toBeNull()
      expect(await store.getReplyById(999_999)).toBeNull()
    })


    it('主题详情：未知主题返回 null；回复分页从新到旧且前后翻一致', async () => {
      expect(await store.getTopicDetail({ topicId: 999_999 })).toBeNull()

      const alice = await mustUser(store, 'alice')
      const topic = await mustTopic(store, alice, '回复分页')
      const ids: number[] = []
      for (let i = 1; i <= 3; i += 1) {
        const r = await store.createReply(alice, topic.id, { content: `回复 ${i}` })
        if (!r.ok) throw new Error('回复失败')
        ids.push(r.value.id)
      }
      const expected = [...ids].reverse()

      const page1 = await store.getTopicDetail({ topicId: topic.id, repliesLimit: 2 })
      expect(page1?.replies.items.map((r) => r.id)).toEqual(expected.slice(0, 2))
      expect(page1?.replies.nextCursor).not.toBeNull()

      const page2 = await store.getTopicDetail({
        topicId: topic.id,
        repliesCursor: page1?.replies.nextCursor,
        repliesLimit: 2,
      })
      expect(page2?.replies.items.map((r) => r.id)).toEqual(expected.slice(2))
      expect(page2?.replies.nextCursor).toBeNull()

      const back = await store.getTopicDetail({
        topicId: topic.id,
        repliesCursor: page2?.replies.prevCursor,
        repliesLimit: 2,
      })
      expect(back?.replies.items.map((r) => r.id)).toEqual(expected.slice(0, 2))
    })

    // ---------- 个人页 ----------

    it('个人页：作者主题只含本人；回复携带主题标题；统计正确', async () => {
      const alice = await mustUser(store, 'alice')
      const bob = await mustUser(store, 'bob')
      const t1 = await mustTopic(store, alice, 'Alice 的帖子')
      const t2 = await mustTopic(store, bob, 'Bob 的帖子')
      await store.createReply(bob, t1.id, { content: '来自 bob' })
      await store.createReply(alice, t2.id, { content: '来自 alice' })

      const aliceTopics = await store.listTopicsByAuthor({ authorId: alice.id, limit: 10 })
      expect(aliceTopics.items.map((t) => t.id)).toEqual([t1.id])

      const aliceReplies = await store.listRepliesByAuthor({ authorId: alice.id, limit: 10 })
      expect(aliceReplies.items).toHaveLength(1)
      expect(aliceReplies.items[0]?.topicTitle).toBe('Bob 的帖子')

      expect(await store.getUserStats(alice.id)).toEqual({ topicCount: 1, replyCount: 1 })
    })

    // ---------- 通知与公告 ----------

    it('通知：只对接收者可见，未读计数与已读状态按用户隔离', async () => {
      const alice = await mustUser(store, 'alice')
      const bob = await mustUser(store, 'bob')

      const created = await store.createNotification({
        kind: 'notification',
        userId: alice.id,
        title: '有人回复了你',
        body: 'bob：你好',
        link: '/topics/1',
      })
      expect(created.ok).toBe(true)

      const aliceList = await store.listNotifications({ userId: alice.id, kind: 'notification' })
      expect(aliceList.items).toHaveLength(1)
      expect(aliceList.items[0]?.read).toBe(false)
      expect(aliceList.items[0]?.link).toBe('/topics/1')
      expect(await store.countUnreadNotifications(alice.id)).toEqual({
        notifications: 1,
        announcements: 0,
        total: 1,
      })

      // 别人的通知列表与未读数不受影响
      expect(
        (await store.listNotifications({ userId: bob.id, kind: 'notification' })).items,
      ).toHaveLength(0)
      expect((await store.countUnreadNotifications(bob.id)).total).toBe(0)

      expect(await store.markNotificationsRead(alice.id, 'notification')).toBe(1)
      // 重复标记不重复计数
      expect(await store.markNotificationsRead(alice.id, 'notification')).toBe(0)
      expect((await store.countUnreadNotifications(alice.id)).total).toBe(0)

      const after = await store.listNotifications({ userId: alice.id, kind: 'notification' })
      expect(after.items[0]?.read).toBe(true)
    })

    it('公告：对所有用户可见，已读状态互不影响', async () => {
      const alice = await mustUser(store, 'alice')
      const bob = await mustUser(store, 'bob')

      const created = await store.createNotification({
        kind: 'announcement',
        // 公告即使传了 userId 也应写成全体可见
        userId: alice.id,
        title: '维护通知',
        body: '今晚维护',
      })
      expect(created.ok).toBe(true)

      for (const user of [alice, bob]) {
        const list = await store.listNotifications({ userId: user.id, kind: 'announcement' })
        expect(list.items).toHaveLength(1)
        expect(list.items[0]?.userId).toBeNull()
        expect(list.items[0]?.kind).toBe('announcement')
      }

      expect(await store.markNotificationsRead(alice.id, 'announcement')).toBe(1)
      expect((await store.countUnreadNotifications(alice.id)).announcements).toBe(0)
      // alice 读过不影响 bob
      expect((await store.countUnreadNotifications(bob.id)).announcements).toBe(1)
    })

    it('未读公告：最新在前，标记已读后不再出现，且不跨用户共享', async () => {
      const alice = await mustUser(store, 'alice')
      const bob = await mustUser(store, 'bob')

      const older = await store.createNotification({
        kind: 'announcement',
        title: '公告 A',
        body: '正文 A',
      })
      const newer = await store.createNotification({
        kind: 'announcement',
        title: '公告 B',
        body: '正文 B',
      })
      expect(older.ok).toBe(true)
      expect(newer.ok).toBe(true)

      const unread = await store.listUnreadAnnouncements(alice.id)
      expect(unread.map((item) => item.title)).toEqual(['公告 B', '公告 A'])
      expect(unread.every((item) => item.read === false)).toBe(true)
      expect(unread.every((item) => item.kind === 'announcement')).toBe(true)

      await store.markNotificationsRead(alice.id, 'announcement')
      expect(await store.listUnreadAnnouncements(alice.id)).toEqual([])
      // alice 读过不影响 bob
      expect(await store.listUnreadAnnouncements(bob.id)).toHaveLength(2)
    })

    it('通知列表：从新到旧分页，游标可前后翻页', async () => {
      const alice = await mustUser(store, 'alice')
      const ids: number[] = []
      for (let i = 0; i < 5; i++) {
        const created = await store.createNotification({
          kind: 'notification',
          userId: alice.id,
          title: `通知 ${i}`,
          body: '内容',
        })
        if (created.ok) ids.push(created.value.id)
      }
      const expected = [...ids].reverse()

      const page1 = await store.listNotifications({
        userId: alice.id,
        kind: 'notification',
        limit: 2,
      })
      expect(page1.items.map((n) => n.id)).toEqual(expected.slice(0, 2))
      expect(page1.nextCursor).not.toBeNull()

      const page2 = await store.listNotifications({
        userId: alice.id,
        kind: 'notification',
        limit: 2,
        cursor: page1.nextCursor,
      })
      expect(page2.items.map((n) => n.id)).toEqual(expected.slice(2, 4))

      const back = await store.listNotifications({
        userId: alice.id,
        kind: 'notification',
        limit: 2,
        cursor: page2.prevCursor,
      })
      expect(back.items.map((n) => n.id)).toEqual(expected.slice(0, 2))
    })

    it('创建通知：定向通知必须指定接收者，且接收者必须存在', async () => {
      expect(
        await store.createNotification({ kind: 'notification', title: 'x', body: 'y' }),
      ).toEqual({ ok: false, error: 'NOTIFICATION_TARGET_REQUIRED' })

      expect(
        await store.createNotification({
          kind: 'notification',
          userId: 999_999,
          title: 'x',
          body: 'y',
        }),
      ).toEqual({ ok: false, error: 'USER_NOT_FOUND' })
    })

    // ---------- 置顶 / 设为公告 ----------

    it('置顶：默认未置顶，设置后可读回，取消后恢复', async () => {
      const alice = await mustUser(store, 'alice')
      const topic = await mustTopic(store, alice, '置顶测试')
      expect(topic.pinned).toBe(false)
      expect(topic.isAnnouncement).toBe(false)

      const pinned = await store.setTopicPinned(topic.id, true)
      expect(pinned.ok).toBe(true)
      if (!pinned.ok) return
      expect(pinned.value.pinned).toBe(true)
      expect(await store.listPinnedTopics()).toHaveLength(1)

      // 重复置顶是幂等的
      await store.setTopicPinned(topic.id, true)
      expect(await store.listPinnedTopics()).toHaveLength(1)

      const cleared = await store.setTopicPinned(topic.id, false)
      expect(cleared.ok).toBe(true)
      expect(await store.listPinnedTopics()).toHaveLength(0)

      const detail = await store.getTopicDetail({ topicId: topic.id })
      expect(detail?.pinned).toBe(false)
    })

    it('置顶与公告：主题不存在返回 TOPIC_NOT_FOUND', async () => {
      expect(await store.setTopicPinned(999_999, true)).toEqual({ ok: false, error: 'TOPIC_NOT_FOUND' })
      expect(await store.setTopicAnnouncement(999_999, true)).toEqual({
        ok: false,
        error: 'TOPIC_NOT_FOUND',
      })
    })

    it('置顶列表：只有置顶主题且最新在前，limit 生效', async () => {
      const alice = await mustUser(store, 'alice')
      const first = await mustTopic(store, alice, 'A')
      const second = await mustTopic(store, alice, 'B')
      await mustTopic(store, alice, 'C')
      await store.setTopicPinned(first.id, true)
      await store.setTopicPinned(second.id, true)

      const pinned = await store.listPinnedTopics()
      expect(pinned.map((t) => t.id)).toEqual([second.id, first.id])
      expect(await store.listPinnedTopics(1)).toHaveLength(1)
    })

    it('设为公告：生成指向该主题的公告，重复调用不重复写入，取消后删除', async () => {
      const alice = await mustUser(store, 'alice')
      const bob = await mustUser(store, 'bob')
      const topic = await mustTopic(store, alice, '设为公告')

      const set = await store.setTopicAnnouncement(topic.id, true)
      expect(set.ok).toBe(true)

      const list = await store.listNotifications({ userId: bob.id, kind: 'announcement' })
      expect(list.items).toHaveLength(1)
      expect(list.items[0]?.link).toBe(`/topics/${topic.id}`)
      expect(list.items[0]?.topicId).toBe(topic.id)

      // 幂等：重复设为公告不产生第二条
      await store.setTopicAnnouncement(topic.id, true)
      expect(
        (await store.listNotifications({ userId: bob.id, kind: 'announcement' })).items,
      ).toHaveLength(1)

      const detail = await store.getTopicDetail({ topicId: topic.id })
      expect(detail?.isAnnouncement).toBe(true)

      await store.setTopicAnnouncement(topic.id, false)
      expect(
        (await store.listNotifications({ userId: bob.id, kind: 'announcement' })).items,
      ).toHaveLength(0)
    })

    it('删除主题时，由它转化的公告一并消失，手工公告不受影响', async () => {
      const alice = await mustUser(store, 'alice')
      const topic = await mustTopic(store, alice, '待删公告')
      await store.createNotification({
        kind: 'announcement',
        title: '手工公告',
        body: '与主题无关',
      })
      await store.setTopicAnnouncement(topic.id, true)

      expect(
        (await store.listNotifications({ userId: alice.id, kind: 'announcement' })).items,
      ).toHaveLength(2)

      await store.deleteTopic(topic.id)

      const after = await store.listNotifications({ userId: alice.id, kind: 'announcement' })
      expect(after.items).toHaveLength(1)
      expect(after.items[0]?.title).toBe('手工公告')
    })
  })
}
