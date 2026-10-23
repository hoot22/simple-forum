import type { Env } from '../env'
import type { ForumStore } from './store'
import { MemoryForumStore } from './memory'
import { D1ForumStore } from './d1'

/** 内存实现进程级单例：worker 隔离实例内共享一份演示数据 */
let memoryStore: MemoryForumStore | null = null

/**
 * 存储工厂：绑定存在时用 D1，否则使用内存实现。
 * 服务层与路由不感知切换。
 *
 * 注意：内存实现只是本地开发 / 测试适配器；ENVIRONMENT=production 且缺少
 * D1 binding 时 createApp 会直接拒绝启动，不会静默降级到内存。
 */
export function createStore(env: Env): ForumStore {
  if (env.DB) {
    return new D1ForumStore(env.DB)
  }
  if (!memoryStore) {
    memoryStore = new MemoryForumStore()
  }
  return memoryStore
}
