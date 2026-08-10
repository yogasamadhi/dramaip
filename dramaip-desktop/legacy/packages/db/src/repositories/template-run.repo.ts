// template_runs —— 模板运行记录（ROADMAP v0.8 §3）
import { eq, desc } from 'drizzle-orm'
import type { DB } from '../client'
import { templateRuns } from '../schema'
import type { OptionalId, TemplateRun } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

type TemplateRunRow = typeof templateRuns.$inferSelect

function parseVariables(value: string | null | undefined): Record<string, string> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

function rowToEntity(row: TemplateRunRow): TemplateRun {
  return {
    id: row.id,
    templateId: row.templateId,
    projectId: row.projectId ?? undefined,
    scope: row.scope,
    renderedContent: row.renderedContent,
    variables: parseVariables(row.variables),
    aiRunId: row.aiRunId ?? undefined,
    createdAt: row.createdAt,
  }
}

export function listTemplateRuns(db: DB): TemplateRun[] {
  return db
    .select()
    .from(templateRuns)
    .orderBy(desc(templateRuns.createdAt))
    .all()
    .map((row) => rowToEntity(row as TemplateRunRow))
}

export function listTemplateRunsByTemplate(db: DB, templateId: string): TemplateRun[] {
  return db
    .select()
    .from(templateRuns)
    .where(eq(templateRuns.templateId, templateId))
    .orderBy(desc(templateRuns.createdAt))
    .all()
    .map((row) => rowToEntity(row as TemplateRunRow))
}

export function createTemplateRun(
  db: DB,
  data: OptionalId<TemplateRun> & { templateId: string; scope: string },
): TemplateRun {
  const value: typeof templateRuns.$inferInsert = {
    id: genId(),
    createdAt: now(),
    templateId: data.templateId,
    projectId: data.projectId ?? null,
    scope: data.scope,
    renderedContent: data.renderedContent,
    variables: JSON.stringify(data.variables ?? {}),
    aiRunId: data.aiRunId ?? null,
  }
  const [row] = insertRow(db, templateRuns, value)
  return rowToEntity(row as TemplateRunRow)
}

/** 记账补写：AI 跑完后把 aiRunId 回填到最近一条 template_run */
export function attachAiRunToTemplateRun(db: DB, id: string, aiRunId: string): TemplateRun | undefined {
  const [row] = updateRows(db, templateRuns, { aiRunId })
    .where(eq(templateRuns.id, id))
    .returning()
    .all()
  return row ? rowToEntity(row as TemplateRunRow) : undefined
}
