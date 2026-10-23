import { describe, expect, it } from 'vitest'
import {
  parseTopicId,
  parseUserId,
  validateLogin,
  validateNewReply,
  validateNewTopic,
  validateRegister,
} from '../src/utils/validate'

describe('validateNewTopic', () => {
  it('接受正常输入并去除首尾空白', () => {
    expect(validateNewTopic('  标题  ', ' 内容 ')).toEqual({
      ok: true,
      value: { title: '标题', content: '内容', font: 'default' },
    })
  })

  it('拒绝空标题', () => {
    const result = validateNewTopic('   ', '内容')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('标题不能为空')
  })

  it('拒绝超过 120 字的标题', () => {
    expect(validateNewTopic('a'.repeat(121), '').ok).toBe(false)
  })

  it('拒绝超过 5000 字的内容', () => {
    expect(validateNewTopic('标题', 'a'.repeat(5001)).ok).toBe(false)
  })
})

describe('validateNewReply', () => {
  it('拒绝空回复', () => {
    expect(validateNewReply('   ').ok).toBe(false)
  })

  it('接受正常回复', () => {
    expect(validateNewReply('你好').ok).toBe(true)
  })
})

describe('validateRegister', () => {
  it('拒绝过短密码', () => {
    expect(validateRegister('alice', '123', '123').ok).toBe(false)
  })

  it('拒绝两次密码不一致', () => {
    expect(validateRegister('alice', 'demo123456', 'demo123457').ok).toBe(false)
  })

  it('拒绝含空格等非法字符的用户名', () => {
    expect(validateRegister('a b', 'demo123456', 'demo123456').ok).toBe(false)
  })

  it('接受合法注册输入并去掉用户名首尾空白', () => {
    expect(validateRegister(' 张三 ', 'demo123456', 'demo123456')).toEqual({
      ok: true,
      value: { username: '张三', password: 'demo123456' },
    })
  })
})

describe('validateLogin', () => {
  it('用户名与密码都为空时给出两条错误', () => {
    const result = validateLogin('', '')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(2)
  })

  it('接受合法登录输入', () => {
    expect(validateLogin('alice', 'demo123456').ok).toBe(true)
  })
})

describe('路径 id 解析', () => {
  it('拒绝非法主题 id', () => {
    expect(parseTopicId(undefined)).toBeNull()
    expect(parseTopicId('abc')).toBeNull()
    expect(parseTopicId('0')).toBeNull()
    expect(parseTopicId('-1')).toBeNull()
    expect(parseTopicId('1.5')).toBeNull()
  })

  it('接受合法 id', () => {
    expect(parseTopicId('12')).toBe(12)
    expect(parseUserId('3')).toBe(3)
  })
})
