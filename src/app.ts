import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import type { Env } from './env'
import type { ForumStore } from './db/store'
import { createStore } from './db'
import type { WordFilter } from './moderation/word-filter'
import { pageRoutes } from './routes/pages'
import { apiRoutes } from './routes/api'
import { csrfProtection } from './middleware/csrf'
import { securityHeaders } from './middleware/security-headers'

/** 会话密钥最小长度：短于该长度视为弱密钥，生产环境拒绝启动 */
const MIN_SESSION_SECRET_LENGTH = 32

/**
 * deps.store 仅供测试注入自定义存储；默认按 env 自动选择 D1 / 内存。
 */
export function createApp(
  env: Env,
  deps: { store?: ForumStore; wordFilter?: WordFilter } = {},
): Hono<{ Bindings: Env }> {
  const isProduction = env.ENVIRONMENT === 'production'

  if (isProduction && !env.DB) {
    throw new Error(
      '生产环境必须绑定 D1 数据库（env.DB）；本项目不会静默回退到内存存储，否则数据重启即丢。',
    )
  }

  // 图片字节存进 D1，生产环境不再要求 R2 绑定。

  if (env.DB && !env.SESSION_SECRET) {
    throw new Error(
      '缺少 SESSION_SECRET：启用 D1 时必须先配置会话密钥（线上 `wrangler secret put SESSION_SECRET`，本地开发可写 .dev.vars）。',
    )
  }

  if (isProduction && (env.SESSION_SECRET ?? '').length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET 至少需要 ${MIN_SESSION_SECRET_LENGTH} 个字符，否则可被离线暴力猜测。`,
    )
  }

  const store = deps.store ?? createStore(env)
  const app = new Hono<{ Bindings: Env }>()

  app.use(logger())
  // 头部先写入，保证 404 / 500 等框架生成的响应也带上安全头
  app.use(securityHeaders())
  // CSRF 覆盖全部非安全方法（含 /api），因此表单必须带隐藏令牌、JSON 客户端需带请求头
  app.use(csrfProtection())

  app.route('/api', apiRoutes(store))
  app.route('/', pageRoutes(store, { wordFilter: deps.wordFilter }))

  app.notFound((c) => c.text('404 Not Found', 404))
  app.onError((err, c) => {
    // HTTPException 是框架用来表达 4xx 的正常控制流，不能吞成 500
    if (err instanceof HTTPException) return err.getResponse()
    console.error('[forum] unhandled error:', err)
    return c.text('Internal Server Error', 500)
  })

  return app
}
