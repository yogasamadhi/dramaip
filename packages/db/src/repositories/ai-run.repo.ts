import { desc, eq, sql } from 'drizzle-orm'
import type { DB } from '../client'
import { aiRuns } from '../schema'
import type { AiRun, AiRunStatus } from '@sdns/core'
import { genId, now, insertRow } from './util'

export interface NewAiRun {
  projectId?: string
  chapterId?: string
  graphName: string
  nodeName?: string
  type: string
  provider: string
  model: string
  input: string
  output?: string
  status: AiRunStatus
  errorMessage?: string
  tokenUsage?: number
  latencyMs?: number
}

export function createAiRun(db: DB, data: NewAiRun): AiRun {
  const value: typeof aiRuns.$inferInsert = {
    id: genId(),
    createdAt: now(),
    projectId: data.projectId ?? null,
    chapterId: data.chapterId ?? null,
    graphName: data.graphName,
    nodeName: data.nodeName ?? null,
    type: data.type,
    provider: data.provider,
    model: data.model,
    input: data.input,
    output: data.output ?? '',
    status: data.status,
    errorMessage: data.errorMessage ?? null,
    tokenUsage: data.tokenUsage ?? null,
    latencyMs: data.latencyMs ?? null,
  }
  const [row] = insertRow(db, aiRuns, value)
  return row as unknown as AiRun
}

export function listAiRunsByProject(db: DB, projectId: string, limit = 100): AiRun[] {
  return db
    .select()
    .from(aiRuns)
    .where(eq(aiRuns.projectId, projectId))
    .orderBy(desc(aiRuns.createdAt))
    .limit(limit)
    .all() as unknown as AiRun[]
}

export function listAllAiRuns(db: DB, limit = 200): AiRun[] {
  return db.select().from(aiRuns).orderBy(desc(aiRuns.createdAt)).limit(limit).all() as unknown as AiRun[]
}

/** v1.0：Token / 耗时统计行（按 model 分组聚合） */
export interface AiRunSummaryRow {
  model: string
  provider: string
  successCount: number
  failedCount: number
  totalTokens: number
  totalLatencyMs: number
}

/** v1.0：按模型汇总成功/失败次数、token、耗时（ROADMAP v1.0-3） */
export function summarizeAiRuns(db: DB): AiRunSummaryRow[] {
  const rows = db
    .select({
      model: aiRuns.model,
      provider: aiRuns.provider,
      successCount: sql<number>`SUM(CASE WHEN ${aiRuns.status} = 'success' THEN 1 ELSE 0 END)`,
      failedCount: sql<number>`SUM(CASE WHEN ${aiRuns.status} = 'failed' THEN 1 ELSE 0 END)`,
      totalTokens: sql<number>`COALESCE(SUM(${aiRuns.tokenUsage}), 0)`,
      totalLatencyMs: sql<number>`COALESCE(SUM(${aiRuns.latencyMs}), 0)`,
    })
    .from(aiRuns)
    .groupBy(aiRuns.model)
    // SQLite 不允许在 ORDER BY 引用 select 别名，故重复表达式
    .orderBy(sql`COALESCE(SUM(${aiRuns.tokenUsage}), 0) DESC`)
    .all()
  return rows.map((r) => ({
    model: String(r.model ?? ''),
    provider: String(r.provider ?? ''),
    successCount: Number(r.successCount ?? 0),
    failedCount: Number(r.failedCount ?? 0),
    totalTokens: Number(r.totalTokens ?? 0),
    totalLatencyMs: Number(r.totalLatencyMs ?? 0),
  }))
}
