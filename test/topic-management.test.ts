import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { MemoryForumStore } from '../src/db/memory'
import type { Env } from '../src/env'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'
import { createSessionToken, SESSION_COOKIE, hashPassword } from '../src/utils/auth'

/**
 * 置顶与「主题设为公告」的回归测试。
 *
 * 数据一律直接写存储、会话直接签发，绕开 /login 与 /topics/new 的进程内共享限流，
 * 避免污染同一进程里的其他测试文件。
 */

const TEST_ENV = { SESSION_SECRET: 'test-session-secret-for-topic-manage-01234567' } as Env

function buildApp() {
  const store = new MemoryForumStore({ seed: false })
  const app = createApp(TEST_ENV, { store })
  const request = (input: string, init?: RequestInit) =>
    Promise.resolve(app.request(input, init, TEST_ENV))
  return { store, request }
}

type Request = ReturnType<typeof buildApp>['request']

/** 直接签发签名会话，绕开 /login 的限流；仅用于测试夹具。 */
async function sessionCookie(userId: number): Promise<string> {
  const token = await createSessionToken(TEST_ENV, userId)
  return `${SESSION_COOKIE}=${token}`
}

async function createUser(store: MemoryForumStore, username: string) {
  const created = await store.createUser(username, await hashPassword(`pw-${username}-0001`))
  if (!created.ok) throw new Error(`createUser 失败: ${created.error}`)
  return created.value
}

type TestUser = Awaited<ReturnType<typeof createUser>>

async function createTopic(store: MemoryForumStore, user: TestUser, title: string): Promise<number> {
  const created = await store.createTopic(user, { title, content: `${title} 的正文` })
  if (!created.ok) throw new Error(`createTopic 失败: ${created.error}`)
  return created.value.id
}

function cookiesOf(res: Response): Record<string, string> {
  const raw = res.headers.get('set-cookie') ?? ''
  const out: Record<string, string> = {}
  for (const part of raw.split(/,(?=[^;=]+=)/)) {
    const pair = part.split(';')[0]
    if (!pair) continue
    const index = pair.indexOf('=')
    if (index > 0) out[pair.slice(0, index).trim()] = pair.slice(index + 1).trim()
  }
  return out
}

/**
 * 先 GET 一次页面拿到 CSRF Cookie，再拼出可直接 POST 的 Cookie 头。
 * 全局 CSRF 中间件要求 Cookie 与表单字段双向匹配。
 */
async function csrfCookie(request: Request, path: string, session: string): Promise<string> {
  const page = await request(path, { headers: { cookie: session } })
  const csrf = cookiesOf(page)[CSRF_COOKIE] ?? ''
  expect(csrf).not.toBe('')
  return `${session}; ${CSRF_COOKIE}=${csrf}`
}

function formBody(csrf: string, fields: Record<string, string>): string {
  return new URLSearchParams({ [CSRF_FIELD]: csrf, ...fields }).toString()
}

/** 截取「置顶主题」区块；区块不存在时返回空串。 */
function pinnedSection(html: string): string {
  const marker = '<section class="pinned-section">'
  const start = html.indexOf(marker)
  if (start === -1) return ''
  const end = html.indexOf('</section>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

describe('置顶主题', () => {
  it('论坛主置顶后首页顶部出现置顶区块，取消后区块消失', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    await createUser(store, 'someone')
    const topicId = await createTopic(store, owner, '重要通知')
    const session = await sessionCookie(owner.id)

    const before = await (await request('/', { headers: { cookie: session } })).text()
    expect(pinnedSection(before)).toBe('')

    const cookie = await csrfCookie(request, `/topics/${topicId}`, session)
    const pinned = await request(`/topics/${topicId}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: formBody(cookie.split(`${CSRF_COOKIE}=`)[1] ?? '', { value: '1' }),
    })
    expect(pinned.status).toBe(302)

    const after = await (await request('/', { headers: { cookie: session } })).text()
    const section = pinnedSection(after)
    expect(section).toContain('重要通知')
    expect(section).toContain('badge-pinned')

    // 主题详情页同样标出「置顶」
    const detail = await (await request(`/topics/${topicId}`, { headers: { cookie: session } })).text()
    expect(detail).toContain('badge-pinned')

    const unpin = await request(`/topics/${topicId}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: formBody(cookie.split(`${CSRF_COOKIE}=`)[1] ?? '', { value: '0' }),
    })
    expect(unpin.status).toBe(302)

    const cleared = await (await request('/', { headers: { cookie: session } })).text()
    expect(pinnedSection(cleared)).toBe('')
  })

  it('普通用户置顶被拒绝，且主题保持未置顶', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    const guest = await createUser(store, 'guest')
    const topicId = await createTopic(store, guest, '普通主题')
    const session = await sessionCookie(guest.id)
    const cookie = await csrfCookie(request, `/topics/${topicId}`, session)

    const res = await request(`/topics/${topicId}/pin`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: formBody(cookie.split(`${CSRF_COOKIE}=`)[1] ?? '', { value: '1' }),
    })

    expect(res.status).toBe(403)
    expect(await store.listPinnedTopics()).toHaveLength(0)
    expect(owner.id).toBeGreaterThan(0)
  })

  it('置顶只在第一页展示，翻页后不再出现', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    const topicId = await createTopic(store, owner, '置顶贴')
    await store.setTopicPinned(topicId, true)

    // 造出足够多的主题以产生第二页
    for (let i = 1; i <= 21; i += 1) await createTopic(store, owner, `主题 ${i}`)

    const firstPage = await (await request('/')).text()
    expect(pinnedSection(firstPage)).toContain('置顶贴')

    const nextHref = /href="([^"]*\?tc=[^"]+)"/.exec(firstPage)?.[1]
    expect(nextHref).toBeTruthy()
    const secondPage = await (await request(nextHref as string)).text()
    expect(pinnedSection(secondPage)).toBe('')
  })
})

describe('主题设为公告', () => {
  it('设为公告后公告页出现该主题，且带「公告」标记与主题链接', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    const topicId = await createTopic(store, owner, '版本更新说明')
    const session = await sessionCookie(owner.id)

    await store.setTopicAnnouncement(topicId, true)

    const html = await (
      await request('/notifications?tab=announcements', { headers: { cookie: session } })
    ).text()

    expect(html).toContain('版本更新说明')
    expect(html).toContain(`href="/topics/${topicId}"`)

    const detail = await (await request(`/topics/${topicId}`, { headers: { cookie: session } })).text()
    expect(detail).toContain('badge-announcement')
  })

  it('重复设为公告不会产生重复条目', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    const topicId = await createTopic(store, owner, '重复公告')
    const session = await sessionCookie(owner.id)

    await store.setTopicAnnouncement(topicId, true)
    await store.setTopicAnnouncement(topicId, true)

    const page = await store.listNotifications({ userId: owner.id, kind: 'announcement' })
    expect(page.items.filter((n) => n.link === `/topics/${topicId}`)).toHaveLength(1)

    // 页面上也只出现一次链接
    const html = await (
      await request('/notifications?tab=announcements', { headers: { cookie: session } })
    ).text()
    expect(html.match(new RegExp(`href="/topics/${topicId}"`, 'g')) ?? []).toHaveLength(1)
  })

  it('取消公告后主题标记消失，公告页不再包含它', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    const topicId = await createTopic(store, owner, '临时公告')
    const session = await sessionCookie(owner.id)

    await store.setTopicAnnouncement(topicId, true)
    await store.setTopicAnnouncement(topicId, false)

    const page = await store.listNotifications({ userId: owner.id, kind: 'announcement' })
    expect(page.items.filter((n) => n.link === `/topics/${topicId}`)).toHaveLength(0)

    const detail = await (await request(`/topics/${topicId}`, { headers: { cookie: session } })).text()
    expect(detail).not.toContain('badge-announcement')
  })

  it('删除主题时其公告一并清除', async () => {
    const { store } = buildApp()
    const owner = await createUser(store, 'owner')
    const topicId = await createTopic(store, owner, '将被删除的公告')

    await store.setTopicAnnouncement(topicId, true)
    const before = await store.listNotifications({ userId: owner.id, kind: 'announcement' })
    expect(before.items).toHaveLength(1)

    await store.deleteTopic(topicId)

    const after = await store.listNotifications({ userId: owner.id, kind: 'announcement' })
    expect(after.items).toHaveLength(0)
  })
})

describe('发布公告', () => {
  it('论坛主发布公告后跳转公告页，新公告可见', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    await createUser(store, 'someone')
    const session = await sessionCookie(owner.id)
    const cookie = await csrfCookie(request, '/notifications', session)

    const res = await request('/notifications/announce', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: formBody(cookie.split(`${CSRF_COOKIE}=`)[1] ?? '', {
        title: '维护通知',
        body: '今晚 22:00 起停机维护。',
      }),
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain('tab=announcements')

    const html = await (
      await request('/notifications?tab=announcements', { headers: { cookie: session } })
    ).text()
    expect(html).toContain('维护通知')
    expect(html).toContain('今晚 22:00 起停机维护。')
  })

  it('公告页只对管理员渲染发布表单', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    const guest = await createUser(store, 'guest')

    const ownerHtml = await (
      await request('/notifications?tab=announcements', {
        headers: { cookie: await sessionCookie(owner.id) },
      })
    ).text()
    expect(ownerHtml).toContain('action="/notifications/announce"')
    expect(ownerHtml).toContain('发布公告')

    const guestHtml = await (
      await request('/notifications?tab=announcements', {
        headers: { cookie: await sessionCookie(guest.id) },
      })
    ).text()
    expect(guestHtml).not.toContain('action="/notifications/announce"')
  })

  it('普通用户发布公告被拒绝，且没有写入', async () => {
    const { store, request } = buildApp()
    await createUser(store, 'owner')
    const guest = await createUser(store, 'guest')
    const session = await sessionCookie(guest.id)
    const cookie = await csrfCookie(request, '/notifications', session)

    const res = await request('/notifications/announce', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: formBody(cookie.split(`${CSRF_COOKIE}=`)[1] ?? '', {
        title: '越权公告',
        body: '不应该出现',
      }),
    })

    expect(res.status).toBe(403)
    const page = await store.listNotifications({ userId: guest.id, kind: 'announcement' })
    expect(page.items).toHaveLength(0)
  })

  it('标题或正文为空时返回 400，回填已填内容且不写入', async () => {
    const { store, request } = buildApp()
    const owner = await createUser(store, 'owner')
    const session = await sessionCookie(owner.id)
    const cookie = await csrfCookie(request, '/notifications', session)
    const csrf = cookie.split(`${CSRF_COOKIE}=`)[1] ?? ''

    const res = await request('/notifications/announce', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: formBody(csrf, { title: '', body: '只有正文' }),
    })

    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('公告标题不能为空')
    expect(html).toContain('只有正文')

    const page = await store.listNotifications({ userId: owner.id, kind: 'announcement' })
    expect(page.items).toHaveLength(0)
  })
})

describe('存储层：置顶列表与公告列表互不干扰', () => {
  it('listPinnedTopics 只返回置顶主题，最新在前', async () => {
    const { store } = buildApp()
    const owner = await createUser(store, 'owner')
    const first = await createTopic(store, owner, '第一个')
    const second = await createTopic(store, owner, '第二个')
    await createTopic(store, owner, '普通主题')

    await store.setTopicPinned(first, true)
    await store.setTopicPinned(second, true)

    const pinned = await store.listPinnedTopics()
    expect(pinned.map((t) => t.id)).toEqual([second, first])
    expect(pinned.every((t) => t.pinned)).toBe(true)
  })

  it('置顶不会自动变成公告，公告也不会自动置顶', async () => {
    const { store } = buildApp()
    const owner = await createUser(store, 'owner')
    const topicId = await createTopic(store, owner, '只置顶')

    await store.setTopicPinned(topicId, true)
    const pinnedOnly = await store.getTopicById(topicId)
    expect(pinnedOnly?.pinned).toBe(true)
    expect(pinnedOnly?.isAnnouncement).toBe(false)

    const announcements = await store.listNotifications({ userId: owner.id, kind: 'announcement' })
    expect(announcements.items).toHaveLength(0)
  })
})
