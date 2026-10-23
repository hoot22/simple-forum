import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import type { Env } from '../src/env'
import {
  isPostFontId,
  postFontClass,
  POST_FONT_DEFAULT,
  POST_FONTS,
  toPostFontId,
} from '../src/fonts/post-fonts'
import { CSRF_COOKIE, CSRF_FIELD } from '../src/middleware/csrf'
import { SESSION_COOKIE } from '../src/utils/auth'
import { validateNewTopic } from '../src/utils/validate'

/** 测试用会话密钥；不是任何环境的真实凭证。 */
const TEST_ENV: Env = { SESSION_SECRET: 'post-font-test-session-secret-0123456789' }
const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 整个文件共用一个 app 与一个会话：注册接口有 5 次/小时的进程内限流，
 * 每个用例各注册一次会互相抢占额度。
 */
const app = createApp(TEST_ENV)
const request = (input: string, init?: RequestInit) => app.request(input, init, TEST_ENV)

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

let sessionCache: Promise<string> | null = null

function session(): Promise<string> {
  if (!sessionCache) {
    sessionCache = (async () => {
      const page = await request('/register')
      const csrf = cookiesOf(page)[CSRF_COOKIE] ?? ''
      const res = await request('/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `${CSRF_COOKIE}=${csrf}`,
        },
        body: new URLSearchParams({
          [CSRF_FIELD]: csrf,
          // 用户名有 2-20 位限制，这里用 36 进制时间戳压缩长度
          username: `font_${Date.now().toString(36)}`,
          password: 'demo123456',
          confirmPassword: 'demo123456',
        }).toString(),
      })
      expect(res.status).toBe(302)
      return cookiesOf(res)[SESSION_COOKIE] ?? ''
    })()
  }
  return sessionCache
}

/** 提交一个主题并返回重定向后的详情页 HTML。font 为 undefined 时不带该字段。 */
async function createTopic(font?: string): Promise<string> {
  const token = await session()
  const cookieWithSession = `${SESSION_COOKIE}=${token}`
  const form = await request('/topics/new', { headers: { cookie: cookieWithSession } })
  const csrf = cookiesOf(form)[CSRF_COOKIE] ?? ''

  const body = new URLSearchParams({
    [CSRF_FIELD]: csrf,
    title: '字体测试主题',
    content: '字体测试正文内容',
  })
  if (font !== undefined) body.set('font', font)

  const res = await request('/topics/new', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `${cookieWithSession}; ${CSRF_COOKIE}=${csrf}`,
    },
    body: body.toString(),
  })
  expect(res.status).toBe(302)
  const location = res.headers.get('location') ?? ''
  expect(location).toMatch(/^\/topics\/\d+/)
  return (await request(location, { headers: { cookie: cookieWithSession } })).text()
}

describe('发帖字体：数据清单与归一化', () => {
  it('清单包含默认字体与一个自定义字体，且类名统一前缀', () => {
    expect(POST_FONTS.map((option) => option.id)).toEqual(['default', 'wqy-bitmap-song'])
    expect(POST_FONTS.every((option) => option.className.startsWith('post-font-'))).toBe(true)
    expect(POST_FONTS.filter((option) => option.file !== '')).toHaveLength(1)
  })

  it('无法识别的字体回落为默认字体，而不是抛错', () => {
    expect(isPostFontId('wqy-bitmap-song')).toBe(true)
    expect(isPostFontId('comic-sans')).toBe(false)
    // 已移除的 Zpix 标识属于未知值，归一到默认字体
    expect(isPostFontId('zpix')).toBe(false)
    expect(toPostFontId('zpix')).toBe(POST_FONT_DEFAULT)
    expect(toPostFontId('wqy-bitmap-song')).toBe('wqy-bitmap-song')
    expect(toPostFontId('comic-sans')).toBe(POST_FONT_DEFAULT)
    expect(toPostFontId(undefined)).toBe(POST_FONT_DEFAULT)
    expect(toPostFontId(42)).toBe(POST_FONT_DEFAULT)
  })

  it('postFontClass 对未知值与缺省值都返回已定义的类名', () => {
    expect(postFontClass('wqy-bitmap-song')).toBe('post-font-wqy')
    expect(postFontClass('zpix')).toBe('post-font-default')
    expect(postFontClass(undefined)).toBe('post-font-default')
    expect(postFontClass('不存在的字体')).toBe('post-font-default')
  })

  it('validateNewTopic 接受字体参数并归一化', () => {
    const ok = validateNewTopic('标题', '正文', 'wqy-bitmap-song')
    expect(ok.ok ? ok.value.font : null).toBe('wqy-bitmap-song')

    const omitted = validateNewTopic('标题', '正文')
    expect(omitted.ok ? omitted.value.font : null).toBe(POST_FONT_DEFAULT)

    const bogus = validateNewTopic('标题', '正文', 'sans-serif')
    expect(bogus.ok ? bogus.value.font : null).toBe(POST_FONT_DEFAULT)

    // 校验失败时不额外产生字体相关错误，错误仍只来自标题与正文
    const invalid = validateNewTopic('', '', 'zpix')
    expect(invalid.ok).toBe(false)
  })
})

describe('发帖字体：表单与渲染', () => {
  it('发帖表单提供每种字体的单选，且默认只勾选一个', async () => {
    const token = await session()
    const html = await (
      await request('/topics/new', { headers: { cookie: `${SESSION_COOKIE}=${token}` } })
    ).text()

    expect(html).toContain('name="font"')
    for (const option of POST_FONTS) {
      expect(html).toContain(`value="${option.id}"`)
      expect(html).toContain(option.label)
    }
    // 单选组必须恰好勾选一个，否则浏览器会选最后一个
    expect(html.match(/checked/g) ?? []).toHaveLength(1)
    expect(html).toContain('/js/font-preview.js')
  })

  it('选择「文泉驿点阵宋」发帖后，详情页正文套用对应字体类', async () => {
    const html = await createTopic('wqy-bitmap-song')
    expect(html).toContain('post-font-wqy')
    expect(html).not.toContain('post-font-default')
  })

  it('提交已移除的 zpix 时按默认字体渲染', async () => {
    const html = await createTopic('zpix')
    expect(html).toContain('post-font-default')
    expect(html).not.toContain('post-font-wqy')
  })

  it('未选择字体时按默认字体渲染', async () => {
    const html = await createTopic()
    expect(html).toContain('post-font-default')
    expect(html).not.toContain('post-font-wqy')
  })

  it('伪造的字体值被归一为默认字体，不写入非法标识', async () => {
    const html = await createTopic('comic-sans; color: red')
    expect(html).toContain('post-font-default')
    expect(html).not.toContain('comic-sans')
  })

  it('首页列表的摘要同样按帖子字体渲染', async () => {
    await createTopic('wqy-bitmap-song')
    const token = await session()
    const html = await (await request('/', { headers: { cookie: `${SESSION_COOKIE}=${token}` } })).text()
    expect(html).toContain('post-font-wqy')
  })
})

describe('发帖字体：样式与静态资源', () => {
  it('样式表包含自定义字体的 @font-face 与字体类，并固定为设计尺寸', async () => {
    const css = await (await request('/assets/forum.css')).text()

    expect(css).toContain('@font-face')
    for (const option of POST_FONTS) {
      if (option.file === '') continue
      expect(css).toContain(`/fonts/${option.file}`)
    }
    expect(css).toContain('.post-font-wqy')
    // 已移除的 Zpix 不应再出现在样式表或字体引用里
    expect(css).not.toContain('.post-font-zpix')
    expect(css).not.toContain('zpix.ttf')
    // 点阵字必须落在设计尺寸上，否则会发虚
    expect(css).toContain('font-size: 16px')
  })

  it('字体文件已放入 public/fonts，Pages 才会部署并加载到', () => {
    for (const option of POST_FONTS) {
      if (option.file === '') continue
      const file = join(ROOT, 'public', 'fonts', option.file)
      expect(existsSync(file), `缺少字体文件 public/fonts/${option.file}`).toBe(true)
      expect(statSync(file).size).toBeGreaterThan(1000)
    }
  })

  it('静态路由放行 /fonts/*，否则字体请求会被 Functions 接管', () => {
    const routes = JSON.parse(readFileSync(join(ROOT, 'public', '_routes.json'), 'utf8')) as {
      exclude: string[]
    }
    expect(routes.exclude).toContain('/fonts/*')
  })

  it('迁移只新增列并带默认值，既有主题自动落到默认字体', () => {
    const sql = readFileSync(join(ROOT, 'migrations', '0009_topic_font.sql'), 'utf8')
    expect(sql).toContain('ALTER TABLE topics ADD COLUMN font')
    expect(sql).toContain(`DEFAULT 'default'`)
  })
})
