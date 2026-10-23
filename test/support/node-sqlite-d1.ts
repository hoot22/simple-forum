/// <reference types="node" />

/**
 * D1 API 的最小适配层，底层使用 Node 内置的 node:sqlite。
 *
 * 存在的理由：Miniflare 需要启动 workerd 原生二进制，而部分 Windows 环境
 * （杀毒软件、应用控制策略）会拒绝执行该文件，导致 D1 契约测试在
 * beforeAll 阶段整体崩溃。本适配层让同一批契约用例跑在真实 SQLite 上，
 * 仍然完整执行 migrations/*.sql，只是不再经过 workerd。
 *
 * 覆盖范围：D1ForumStore 实际用到的 prepare / bind / first / all / run /
 * exec / batch 子集。语义上尽量贴近 D1：BLOB 读出为 ArrayBuffer，
 * run() 返回 { meta: { changes, last_row_id } }，batch 在事务内执行。
 */

interface SqliteRunResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

interface SqliteStatementSync {
  all(...params: unknown[]): Record<string, unknown>[]
  get(...params: unknown[]): Record<string, unknown> | undefined
  run(...params: unknown[]): SqliteRunResult
}

interface SqliteDatabaseSync {
  prepare(sql: string): SqliteStatementSync
  exec(sql: string): void
  close(): void
}

interface SqliteModule {
  DatabaseSync: new (location: string) => SqliteDatabaseSync
}

export interface NodeSqliteD1Handle {
  readonly db: unknown
  close(): void
}

function toParam(value: unknown): unknown {
  if (value === undefined) return null
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return value
}

function toD1Row(row: Record<string, unknown>): Record<string, unknown> {
  let converted = false
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Uint8Array) {
      // node:sqlite 返回 Uint8Array，D1 返回 ArrayBuffer，这里对齐 D1。
      const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      result[key] = buffer
      converted = true
    } else {
      result[key] = value
    }
  }
  return converted ? result : row
}

function toMeta(result: SqliteRunResult): Record<string, unknown> {
  return { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) }
}

class D1StatementAdapter {
  constructor(
    private readonly sqlite: SqliteDatabaseSync,
    private readonly sql: string,
    private readonly params: readonly unknown[] = [],
  ) {}

  bind(...params: unknown[]): D1StatementAdapter {
    return new D1StatementAdapter(this.sqlite, this.sql, params)
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.params.map(toParam))
    if (row === undefined) return null
    if (column !== undefined) return (row[column] ?? null) as T | null
    return toD1Row(row) as unknown as T
  }

  async all<T = Record<string, unknown>>(): Promise<{
    results: T[]
    success: true
    meta: Record<string, unknown>
  }> {
    const rows = this.sqlite.prepare(this.sql).all(...this.params.map(toParam))
    return { results: rows.map((row) => toD1Row(row)) as unknown as T[], success: true, meta: {} }
  }

  async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
    const result = this.sqlite.prepare(this.sql).run(...this.params.map(toParam))
    return { success: true, meta: toMeta(result) }
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const rows = this.sqlite.prepare(this.sql).all(...this.params.map(toParam))
    return rows.map((row) => Object.values(toD1Row(row))) as unknown as T[]
  }
}

class D1DatabaseAdapter {
  constructor(private readonly sqlite: SqliteDatabaseSync) {}

  prepare(sql: string): D1StatementAdapter {
    return new D1StatementAdapter(this.sqlite, sql)
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(sql)
    return { count: 0, duration: 0 }
  }

  async batch(statements: unknown[]): Promise<unknown[]> {
    const results: unknown[] = []
    this.sqlite.exec('BEGIN')
    try {
      for (const statement of statements) {
        results.push(await (statement as { run: () => Promise<unknown> }).run())
      }
      this.sqlite.exec('COMMIT')
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
    return results
  }

  async dump(): Promise<ArrayBuffer> {
    return new ArrayBuffer(0)
  }
}

/**
 * 创建一个内存 SQLite 数据库，并包装成 D1 兼容对象。
 * 不支持 node:sqlite 的 Node 版本会抛出可读错误，而不是静默失败。
 */
export function createNodeSqliteD1(name = ':memory:'): NodeSqliteD1Handle {
  const getBuiltinModule = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
    .getBuiltinModule
  if (typeof getBuiltinModule !== 'function') {
    throw new Error('当前 Node 不支持 process.getBuiltinModule，无法加载 node:sqlite')
  }
  const sqlite = getBuiltinModule('node:sqlite') as SqliteModule | undefined
  if (!sqlite || typeof sqlite.DatabaseSync !== 'function') {
    throw new Error('当前 Node 不支持 node:sqlite（需要 Node 22.5 及以上），D1 契约测试无法运行')
  }
  const database = new sqlite.DatabaseSync(name)
  // D1 默认启用外键约束，本地适配层保持一致，否则级联删除相关断言会失真。
  database.exec('PRAGMA foreign_keys = ON')
  return {
    db: new D1DatabaseAdapter(database),
    close: () => database.close(),
  }
}
