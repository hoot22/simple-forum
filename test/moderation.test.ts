import { beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'
import { MemoryForumStore } from '../src/db/memory'
import { hashPassword, SESSION_COOKIE } from '../src/utils/auth'
import { CSRF_COOKIE, CSRF_FIELD, CSRF_HEADER } from '../src/middleware/csrf'

/**
 * 删除主题与管理员指定的端到端测试（内存存储，从空库开始）。
 *
 * 权限模型：
 * - 论坛主 = 最早注册的账户（本文件通过先创建 alice 保证顺序确定）；
 * - 管理员由论坛主指定（is_admin 字段）；
 * - 主题删除：作者本人 / 管理员 / 论坛主。
 */

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

interface Session {
  csrf: string
  session: string
}

/** 测试用会话密钥，长度足够用于签名；不是任何环境的真实凭证。 */
const TEST_SESSION_SECRET = 'test-session-secret-for-unit-tests-0123456789'

/** 无 DB 时走内存存储，等价于本地开发模式。 */
const TEST_ENV = { SESSION_SECRET: TEST_SESSION_SECRET } as Env

/**
 * 测试内使用的应用句柄。
 *
 * Hono 的 c.env 只来自 fetch(request, env) 的第二个参数，而不是 createApp 的入参，
 * 因此这里把 TEST_ENV 预绑定到每个请求上，模拟 Pages 入口 functions/[[path]].ts。
 * 若省略这一步，请求期 c.env 为 undefined，会话签发读取 SESSION_SECRET 时会抛错，
 * 表现为登录返回 500、后续用例全部失败。
 */
interface App {
  request(input: string, init?: RequestInit): Promise<Response>
}

function cookieHeader(s: Session): string {
  return `${CSRF_COOKIE}=${s.csrf}; ${SESSION_COOKIE}=${s.session}`
}

async function login(app: App, username: string, password: string): Promise<Session> {
  const page = await app.request('/login')
  const csrf = cookiesOf(page)[CSRF_COOKIE] ?? ''
  const res = await app.request('/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `${CSRF_COOKIE}=${csrf}`,
    },
    body: new URLSearchParams({ [CSRF_FIELD]: csrf, username, password }).toString(),
  })
  if (res.status !== 302) throw new Error(`登录失败：${username}（${res.status}）`)
  return { csrf, session: cookiesOf(res)[SESSION_COOKIE] ?? '' }
}

async function postForm(
  app: App,
  path: string,
  s: Session,
  data: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader(s) },
    body: new URLSearchParams({ [CSRF_FIELD]: s.csrf, ...data }).toString(),
  })
}

async function createTopic(app: App, s: Session, title: string): Promise<number> {
  const res = await postForm(app, '/topics/new', s, { title, content: `${title}：内容` })
  if (res.status !== 302) throw new Error(`发帖失败：${res.status}`)
  const location = res.headers.get('location') ?? ''
  const match = location.match(/^\/topics\/(\d+)$/)
  if (!match) throw new Error(`未能从跳转地址解析主题 id：${location}`)
  return Number(match[1])
}

describe('删除主题与管理员权限（内存存储）', () => {
  const store = new MemoryForumStore({ seed: false })
  const honoApp = createApp(TEST_ENV, { store })
  const app: App = {
    request: (input, init) => Promise.resolve(honoApp.request(input, init, TEST_ENV)),
  }
  let alice: Session
  let bob: Session
  let carol: Session
  let aliceId = 0
  let bobId = 0
  let carolId = 0

  beforeAll(async () => {
    const aliceRow = await store.createUser('alice', await hashPassword('pw-alice-0001'))
    const bobRow = await store.createUser('bob', await hashPassword('pw-bob-0001'))
    const carolRow = await store.createUser('carol', await hashPassword('pw-carol-0001'))
    if (!aliceRow.ok || !bobRow.ok || !carolRow.ok) throw new Error('创建测试用户失败')
    aliceId = aliceRow.value.id
    bobId = bobRow.value.id
    carolId = carolRow.value.id
    alice = await login(app, 'alice', 'pw-alice-0001')
    bob = await login(app, 'bob', 'pw-bob-0001')
    carol = await login(app, 'carol', 'pw-carol-0001')
  })

  it('未登录访问删除确认页会跳转登录；未登录 POST 被 CSRF 拒绝', async () => {
    const page = await app.request('/topics/1/delete')
    expect(page.status).toBe(302)
    expect(page.headers.get('location')).toContain('/login')

    const res = await app.request('/topics/1/delete', { method: 'POST' })
    expect(res.status).toBe(403)
  })

  it('作者可删除自己的主题（连同回复），非授权用户被拒绝', async () => {
    const topicId = await createTopic(app, bob, 'Bob 的待删除主题')
    const reply = await postForm(app, `/topics/${topicId}/reply`, carol, { content: '来自 carol 的回复' })
    expect(reply.status).toBe(302)

    const confirm = await app.request(`/topics/${topicId}/delete`, {
      headers: { cookie: cookieHeader(carol) },
    })
    expect(confirm.status).toBe(403)
    expect((await postForm(app, `/topics/${topicId}/delete`, carol)).status).toBe(403)

    const deleted = await postForm(app, `/topics/${topicId}/delete`, bob)
    expect(deleted.status).toBe(302)
    expect(deleted.headers.get('location')).toBe('/')
    expect((await app.request(`/topics/${topicId}`)).status).toBe(404)
    expect((await store.getUserStats(bobId)).topicCount).toBe(0)
  })

  it('论坛主可删除任何主题；不能被修改管理员状态', async () => {
    const topicId = await createTopic(app, carol, 'Carol 的主题')
    const deleted = await postForm(app, `/topics/${topicId}/delete`, alice)
    expect(deleted.status).toBe(302)
    expect((await app.request(`/topics/${topicId}`)).status).toBe(404)

    const ownerAttempt = await postForm(app, `/users/${aliceId}/admin`, alice, { isAdmin: '1' })
    expect(ownerAttempt.status).toBe(403)
  })

  it('仅论坛主能指定管理员；管理员可删除他人主题，取消后失效', async () => {
    // carol 指定 bob 为管理员 → 403
    expect((await postForm(app, `/users/${bobId}/admin`, carol, { isAdmin: '1' })).status).toBe(403)

    // 论坛主指定 bob 为管理员 → 个人页出现徽标
    const appointed = await postForm(app, `/users/${bobId}/admin`, alice, { isAdmin: '1' })
    expect(appointed.status).toBe(302)
    expect(await (await app.request(`/users/${bobId}`)).text()).toContain('badge-admin')

    // 管理员删除 carol 的主题
    const topicId = await createTopic(app, carol, 'Carol 的第二个主题')
    expect((await postForm(app, `/topics/${topicId}/delete`, bob)).status).toBe(302)
    expect((await app.request(`/topics/${topicId}`)).status).toBe(404)

    // 取消管理员后徽标消失
    const revoked = await postForm(app, `/users/${bobId}/admin`, alice, { isAdmin: '0' })
    expect(revoked.status).toBe(302)
    expect(await (await app.request(`/users/${bobId}`)).text()).not.toContain('badge-admin')
  })

  it('JSON API：删除需要 CSRF 请求头；论坛主可通过 API 指定管理员', async () => {
    const topicId = await createTopic(app, carol, 'API 删除目标')

    const noToken = await app.request(`/api/topics/${topicId}`, {
      method: 'DELETE',
      headers: { cookie: cookieHeader(carol) },
    })
    expect(noToken.status).toBe(403)

    const deleted = await app.request(`/api/topics/${topicId}`, {
      method: 'DELETE',
      headers: { cookie: cookieHeader(carol), [CSRF_HEADER]: carol.csrf },
    })
    expect(deleted.status).toBe(200)

    const appointed = await app.request(`/api/users/${carolId}/admin`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieHeader(alice),
        [CSRF_HEADER]: alice.csrf,
      },
      body: JSON.stringify({ isAdmin: true }),
    })
    expect(appointed.status).toBe(200)
    const json = (await appointed.json()) as { user: { isAdmin: boolean } }
    expect(json.user.isAdmin).toBe(true)
  })
})
