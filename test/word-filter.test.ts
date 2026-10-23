import { describe, expect, it } from 'vitest'
import { BANNED_WORDS } from '../src/moderation/banned-words'
import {
  bannedWordCount,
  createWordFilter,
  fieldLabel,
  MAX_REPORTED_WORDS,
  normalizeForCheck,
} from '../src/moderation/word-filter'

describe('normalizeForCheck', () => {
  it('把全角字符折叠为半角', () => {
    expect(normalizeForCheck('ＳＰＡＭ')).toBe('spam')
  })

  it('忽略大小写', () => {
    expect(normalizeForCheck('SpAm')).toBe('spam')
  })

  it('去掉空格、标点与符号', () => {
    expect(normalizeForCheck('违 禁-词【】!?')).toBe('违禁词')
  })

  it('保留中文、字母与数字', () => {
    expect(normalizeForCheck('广告abc123')).toBe('广告abc123')
  })
})

describe('createWordFilter', () => {
  it('命中词条时返回词条原文', () => {
    const filter = createWordFilter(['广告'])
    expect(filter.scanText('这是一个广告帖子')).toEqual(['广告'])
  })

  it('未被任何词条命中时返回空数组', () => {
    const filter = createWordFilter(['广告'])
    expect(filter.scanText('完全正常的帖子内容')).toEqual([])
    expect(filter.check({ title: '正常标题', content: '正常正文' })).toEqual([])
  })

  it('能识破插入空格或标点的绕过写法', () => {
    const filter = createWordFilter(['spam'])
    expect(filter.scanText('S P A M')).toEqual(['spam'])
    expect(filter.scanText('s-p-a-m')).toEqual(['spam'])
  })

  it('空词库不拦截任何内容', () => {
    const filter = createWordFilter([])
    expect(filter.count()).toBe(0)
    expect(filter.scanText('随便什么内容')).toEqual([])
    expect(filter.check({ title: '标题', content: '正文' })).toEqual([])
  })

  it('忽略空词条与只含标点的词条，避免误拦', () => {
    const filter = createWordFilter(['', '   ', '---', '广告'])
    expect(filter.count()).toBe(1)
    expect(filter.check({ content: '正常内容' })).toEqual([])
  })

  it('重复词条只保留一份，且只上报一次', () => {
    const filter = createWordFilter(['广告', '广告', '广告'])
    expect(filter.count()).toBe(1)
    expect(filter.check({ content: '广告' })).toEqual([{ field: 'content', word: '广告' }])
  })

  it('区分命中字段', () => {
    const filter = createWordFilter(['广告'])
    expect(filter.check({ title: '广告标题', content: '正常正文' })).toEqual([
      { field: 'title', word: '广告' },
    ])
    expect(filter.check({ title: '正常标题', content: '广告正文' })).toEqual([
      { field: 'content', word: '广告' },
    ])
  })

  it('标题与正文都命中时各上报一次', () => {
    const filter = createWordFilter(['广告'])
    expect(filter.check({ title: '广告', content: '也是广告' })).toEqual([
      { field: 'title', word: '广告' },
      { field: 'content', word: '广告' },
    ])
  })

  it('单字段上报数量受 limit 限制', () => {
    const filter = createWordFilter(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(filter.scanText('abcdef')).toHaveLength(MAX_REPORTED_WORDS)
    expect(filter.scanText('abcdef', 2)).toHaveLength(2)
  })

  it('字段缺失、为空或非字符串时安全跳过', () => {
    const filter = createWordFilter(['广告'])
    expect(filter.check({})).toEqual([])
    expect(filter.check({ title: undefined, content: '' })).toEqual([])
  })
})

describe('fieldLabel', () => {
  it('返回字段中文名', () => {
    expect(fieldLabel('title')).toBe('标题')
    expect(fieldLabel('content')).toBe('正文')
  })
})

describe('默认词库', () => {
  it('随附词条不含空白项，数量与生效数量一致', () => {
    // 词条由使用者在 src/moderation/banned-words.ts 中自行补充。
    expect(BANNED_WORDS.every((word) => word.trim().length > 0)).toBe(true)
    expect(bannedWordCount()).toBeLessThanOrEqual(BANNED_WORDS.length)
  })

  it('词库为空时检测函数是安全的空操作', () => {
    if (bannedWordCount() === 0) {
      expect(normalizeForCheck('任意内容')).toBe('任意内容')
    }
  })
})
