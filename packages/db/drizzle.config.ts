import { defineConfig } from 'drizzle-kit'

// 运行期使用 src/migrations.ts 的幂等 DDL（ensureSchema），
// 这里保留 drizzle-kit 配置以便后续生成/对比 SQL 迁移（pnpm db:generate）。
export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './studio.db',
  },
})
