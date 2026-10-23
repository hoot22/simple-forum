import { defineConfig } from 'vitest/config'

export default defineConfig({
  // 视图使用 hono/jsx 的 automatic runtime，显式声明避免测试环境用错 JSX 工厂
  esbuild: { jsx: 'automatic', jsxImportSource: 'hono/jsx' },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Miniflare（D1 契约测试）首次启动 workerd 需要更多时间；普通用例不受影响
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
