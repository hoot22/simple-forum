import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'
import { MemoryForumStore } from '../src/db/memory'
import { hashPassword } from '../src/utils/auth'

/**
 * 页面分页集成测试（P1）：注入带 25 条主题 / 25 条回复的内存存储，
 * 验证首页与主题详情确实分页，「较早 / 较新」链接可以来回翻。
 * 断言只关注行为（条数、链接、跳转结果），不耦合样式细节。
 */

async function makeSeededStore() {
  const store = new MemoryForumStore({ seed: false })
  const created = await store.createUser('alice', await hashPassword('demo123456'))
  if (!created.ok) throw new Error('创建用户失败')
  const user = created.value

  const topicIds: number[] = []
  for (let i = 1; i <= 25; i += 1) {
    const topic = await store.createTopic(user, { title: `主题 ${i}`, content: `内容 ${i}` })
    if (!topic.ok) throw new Error('创建主题失败')
    topicIds.push(topic.value.id)
  }
  const firstTopicId = topicIds[0] as number
  for (let i = 1; i <= 25; i += 1) {
    const reply = await store.createReply(user, firstTopicId, { content: `回复 ${i}` })
    if (!reply.ok) throw new Error('创建回复失败')
  }
  return { store, firstTopicId }
}

function matchHref(html: string, pattern: RegExp): string {
  const match = html.match(pattern)
  if (!match || !match[1]) throw new Error(`未在页面中找到期望的链接：${pattern}`)
  return match[1]
}

describe('页面分页（内存存储，注入 createApp）', () => {
  it('首页：第一页 20 条主题，翻到下一页看到剩余 5 条，并能返回', async () => {
    const { store } = await makeSeededStore()
    const app = createApp({} as Env, { store })

    const page1 = await app.request('/')
    const html1 = await page1.text()
    expect(page1.status).toBe(200)
    expect((html1.match(/主题 \d+/g) ?? []).length).toBe(20)
    expect(html1).toContain('>主题 25</a>')
    expect(html1).not.toContain('>主题 5</a>')

    const olderHref = matchHref(html1, /href="(\/\?tc=[^"]+)"/)
    const page2 = await app.request(olderHref)
    const html2 = await page2.text()
    expect((html2.match(/主题 \d+/g) ?? []).length).toBe(5)
    expect(html2).toContain('>主题 5</a>')
    expect(html2).toContain('>主题 1</a>')
    expect(html2).toContain('较新')
    expect(html2).toContain('回到最新')

    // 第 2 页的「较新」链接应能回到第一页（20 条）
    const newerHref = matchHref(html2, /href="(\/\?tc=[^"]+)"/)
    const back = await app.request(newerHref)
    expect((await back.text()).match(/主题 \d+/g)?.length).toBe(20)
  })

  it('主题详情：回复第一页 20 条，翻到更早一页看到剩余 5 条，并能返回', async () => {
    const { store, firstTopicId } = await makeSeededStore()
    const app = createApp({} as Env, { store })

    const page1 = await app.request(`/topics/${firstTopicId}`)
    const html1 = await page1.text()
    expect(page1.status).toBe(200)
    expect(html1).toContain('全部回复（25）')
    expect((html1.match(/回复 \d+/g) ?? []).length).toBe(20)
    expect(html1).not.toContain('>回复 5</p>')

    const olderHref = matchHref(html1, /href="(\/topics\/\d+\?rc=[^"]+)"/)
    const page2 = await app.request(olderHref)
    const html2 = await page2.text()
    expect((html2.match(/回复 \d+/g) ?? []).length).toBe(5)
    expect(html2).toContain('>回复 5</p>')
    expect(html2).toContain('>回复 1</p>')

    // 更早一页的「较新回复」链接应能回到第一页（20 条）
    const newerHref = matchHref(html2, /href="(\/topics\/\d+\?rc=[^"]+)"/)
    const back = await app.request(newerHref)
    expect((await back.text()).match(/回复 \d+/g)?.length).toBe(20)
  })
})
