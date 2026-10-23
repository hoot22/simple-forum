import { describe, expect, it } from 'vitest'
import {
  createSessionToken,
  hashPassword,
  readSessionToken,
  verifyPassword,
} from '../src/utils/auth'

const SECRET = 'unit-test-secret-0123456789abcdef'

describe('密码哈希（PBKDF2-SHA256）', () => {
  it('同一密码两次哈希不同（随机盐），但都能校验通过', async () => {
    const first = await hashPassword('demo123456')
    const second = await hashPassword('demo123456')
    expect(first).not.toBe(second)
    await expect(verifyPassword('demo123456', first)).resolves.toBe(true)
    await expect(verifyPassword('demo123456', second)).resolves.toBe(true)
  })

  it('哈希串不自带明文密码', async () => {
    const stored = await hashPassword('demo123456')
    expect(stored).not.toContain('demo123456')
    expect(stored.startsWith('pbkdf2-sha256$')).toBe(true)
  })

  it('错误密码校验失败', async () => {
    const stored = await hashPassword('demo123456')
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false)
  })

  it('损坏的存储串按不匹配处理，而不是抛异常', async () => {
    await expect(verifyPassword('demo123456', 'not-a-hash')).resolves.toBe(false)
    await expect(verifyPassword('demo123456', 'pbkdf2-sha256$0$$')).resolves.toBe(false)
  })
})

describe('会话令牌（HMAC-SHA256）', () => {
  it('签名后的令牌可以读回用户 id', async () => {
    const token = await createSessionToken({ SESSION_SECRET: SECRET }, 42)
    await expect(readSessionToken({ SESSION_SECRET: SECRET }, token)).resolves.toBe(42)
  })

  it('换一个密钥后签名不再通过', async () => {
    const token = await createSessionToken({ SESSION_SECRET: SECRET }, 42)
    await expect(
      readSessionToken({ SESSION_SECRET: 'another-secret-0123456789abcdef' }, token),
    ).resolves.toBeNull()
  })

  it('篡改载荷会失效', async () => {
    const token = await createSessionToken({ SESSION_SECRET: SECRET }, 42)
    const dot = token.indexOf('.')
    const payload = token.slice(0, dot)
    const signature = token.slice(dot + 1)
    const tampered = `${payload.slice(0, -2)}xx.${signature}`
    await expect(readSessionToken({ SESSION_SECRET: SECRET }, tampered)).resolves.toBeNull()
  })

  it('缺少或格式错误的令牌返回 null', async () => {
    await expect(readSessionToken({ SESSION_SECRET: SECRET }, null)).resolves.toBeNull()
    await expect(readSessionToken({ SESSION_SECRET: SECRET }, undefined)).resolves.toBeNull()
    await expect(readSessionToken({ SESSION_SECRET: SECRET }, 'no-dot-here')).resolves.toBeNull()
    await expect(readSessionToken({ SESSION_SECRET: SECRET }, '.onlysignature')).resolves.toBeNull()
  })
})
