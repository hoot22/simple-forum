/**
 * 认证工具：PBKDF2 密码哈希 + HMAC 签名 Cookie 会话。
 * 全部基于 Web Crypto（crypto.subtle），可直接在 Cloudflare Workers 运行。
 *
 * 会话是无状态的：Cookie 里只放 { uid, exp } 的签名载荷，不建 session 表，
 * 因此内存模式与 D1 模式行为一致，也便于水平扩容。
 */

export const SESSION_COOKIE = 'forum_session'
/** 会话有效期：7 天 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

/** 仅内存开发模式使用的默认密钥；启用 D1 时必须在 env.ts / README 指引下配置 SESSION_SECRET */
export const DEV_SESSION_SECRET = 'simple-forum-dev-only-secret'

const encoder = new TextEncoder()

const PBKDF2_ITERATIONS = 100_000
const PREFIX = 'pbkdf2-sha256'

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin)
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function encodeB64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeB64Url(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  return fromBase64(value.replace(/-/g, '+').replace(/_/g, '/') + pad)
}

// ---------- 密码哈希 ----------

/**
 * 生成 PBKDF2-SHA256 哈希，格式：pbkdf2-sha256$iterations$salt$hash（均为 base64）。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  )
  return `${PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`
}

/**
 * 校验密码。解析存储串中的 salt/迭代数重新派生，并用常量时间比较。
 * 任何解析失败都按“不匹配”处理。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== PREFIX) return false
  const iterations = Number(parts[1])
  if (!Number.isSafeInteger(iterations) || iterations <= 0) return false
  try {
    const salt = fromBase64(parts[2])
    const expected = fromBase64(parts[3])
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = new Uint8Array(
      await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
    )
    if (bits.length !== expected.length) return false
    let diff = 0
    for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i]
    return diff === 0
  } catch {
    return false
  }
}

// ---------- 会话 Cookie ----------

/** 当前密钥版本号，写入 token 便于将来按版本排查/清理 */
const KID = 'v1'

type SessionEnv = { SESSION_SECRET?: string; SESSION_SECRET_PREVIOUS?: string }

function sessionSecret(env: SessionEnv): string {
  const secret = env.SESSION_SECRET
  return secret && secret.trim().length > 0 ? secret : DEV_SESSION_SECRET
}

/**
 * 校验用的候选密钥：当前密钥优先，其次是上一个密钥。
 * 轮换 SESSION_SECRET 后，旧密钥签发的会话在过渡期内仍然有效，不必强制所有人重登。
 */
function secretCandidates(env: SessionEnv): string[] {
  const current = sessionSecret(env)
  const previous = env.SESSION_SECRET_PREVIOUS
  if (previous && previous.trim().length > 0 && previous !== current) return [current, previous]
  return [current]
}

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)))
  return encodeB64Url(sig)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 创建会话令牌：base64url({uid,exp,kid}).base64url(HMAC-SHA256) */
export async function createSessionToken(env: SessionEnv, userId: number): Promise<string> {
  const secret = sessionSecret(env)
  const payload = encodeB64Url(
    encoder.encode(
      JSON.stringify({
        uid: userId,
        exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
        kid: KID,
      }),
    ),
  )
  return `${payload}.${await hmacSign(secret, payload)}`
}

/** 校验并解析会话令牌，返回 userId；无效或过期返回 null。 */
export async function readSessionToken(env: SessionEnv, token: string | null | undefined): Promise<number | null> {
  if (!token) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)

  let signatureOk = false
  for (const secret of secretCandidates(env)) {
    if (constantTimeEqual(signature, await hmacSign(secret, payload))) {
      signatureOk = true
      break
    }
  }
  if (!signatureOk) return null
  try {
    const data = JSON.parse(new TextDecoder().decode(decodeB64Url(payload))) as { uid?: unknown; exp?: unknown }
    if (typeof data.uid !== 'number' || typeof data.exp !== 'number') return null
    if (!Number.isSafeInteger(data.uid) || data.uid <= 0) return null
    if (data.exp < Date.now() / 1000) return null
    return data.uid
  } catch {
    return null
  }
}
