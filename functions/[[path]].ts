import type { PagesFunction } from '@cloudflare/workers-types'
import { createApp } from '../src/app'
import type { Env } from '../src/env'

/**
 * Cloudflare Pages Functions catch-all entry.
 *
 * Pages supplies bindings on context.env. Recreate the Hono app for each
 * request so production binding validation stays identical to Workers.
 */
export const onRequest: PagesFunction<Env> = (context) =>
  createApp(context.env).fetch(context.request, context.env, {
    waitUntil: (promise) => context.waitUntil(promise),
    passThroughOnException: () => context.passThroughOnException(),
    props: {},
  })
