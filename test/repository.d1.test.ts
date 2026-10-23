import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll } from 'vitest'
import { D1ForumStore } from '../src/db/d1'
import type { ForumStore } from '../src/db/store'
import type { Env } from '../src/env'
import { createPostImageRepository } from '../src/uploads/post-images'
import { runRepositoryContract } from './contract/repository-contract'
import { runPostPreviewContract } from './contract/post-preview-contract'
import { runTopicImageSummaryContract } from './contract/topic-image-contract'
import { createNodeSqliteD1 } from './support/node-sqlite-d1'

/**
 * D1 契约测试：在真实 SQLite 上执行 migrations/*.sql，再跑与内存实现
 * 完全相同的契约用例。
 *
 * 驱动为什么是 node:sqlite 而不是 Miniflare：
 * Miniflare 需要启动 workerd 原生二进制。部分 Windows 环境（杀毒软件、
 * 应用控制策略）会拒绝执行该文件，表现为 `workerd.exe` 直接返回
 * “拒绝访问”，Miniflare 随即抛 ERR_DISPOSED，整个文件在任何断言执行前
 * 就崩掉，35 个用例全部变红且看不到真实原因。
 * 改用 Node 内置 SQLite 后，SQL、迁移、BLOB 读写仍然跑在真实 SQLite 上，
 * 但不再依赖任何外部原生进程。D1 API 的差异由
 * test/support/node-sqlite-d1.ts 的适配层吸收。
 *
 * 代价：不再验证 workerd 的 D1 方言是否接受这些 SQL。若需要在真实 D1
 * 运行时上回归，请在能执行 workerd 的机器（Linux/macOS 或已放行该二进
 * 制的机器）上另跑 wrangler 本地环境。
 */

const migrationsDir = join(process.cwd(), 'migrations')

let handle: { close(): void } | null = null
let database: D1Database | null = null

async function applyMigrations(db: D1Database): Promise<void> {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    await db.exec(sql)
  }
}

/** 清空所有业务表，但保留表结构与自增序列，模拟“空库但有迁移”的状态。 */
async function wipe(db: D1Database): Promise<void> {
  const tables = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all<{ name: string }>()
  for (const row of tables.results) {
    await db.exec(`DELETE FROM "${row.name.replace(/"/g, '""')}"`)
  }
}

async function ensureDatabase(): Promise<D1Database> {
  if (database) return database
  const created = createNodeSqliteD1()
  handle = created
  database = created.db as D1Database
  await applyMigrations(database)
  return database
}

afterAll(() => {
  handle?.close()
  handle = null
  database = null
})

const label = 'D1（node:sqlite）'

runRepositoryContract(label, {
  create: async () => {
    const db = await ensureDatabase()
    await wipe(db)
    return new D1ForumStore(db)
  },
})

runTopicImageSummaryContract(label, {
  create: async () => {
    const db = await ensureDatabase()
    await wipe(db)
    return new D1ForumStore(db)
  },
  images: (store: ForumStore) => createPostImageRepository(store, { DB: database } as Env),
})

runPostPreviewContract(label, async () => {
  const db = await ensureDatabase()
  await wipe(db)
  return { store: new D1ForumStore(db), env: { DB: db } as Env }
})
