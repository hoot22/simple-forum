import type { ExportedHandler } from '@cloudflare/workers-types'
import type { Env } from './env'
import { createApp } from './app'

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return createApp(env).fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
