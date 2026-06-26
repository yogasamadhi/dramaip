// templates —— 模板系统（ROADMAP v0.8 §3）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { templates } from '../schema'
import type { BuiltInTemplatePreset, OptionalId, Template } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type TemplateRow = typeof templates.$inferSelect

function rowToEntity(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    scope: (row.scope as Template['scope']) ?? undefined,
    description: row.description ?? undefined,
    content: row.content,
    variables: parseJsonArray(row.variables),
    builtIn: row.builtIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listTemplates(db: DB): Template[] {
  return db
    .select()
    .from(templates)
    .orderBy(templates.createdAt)
    .all()
    .map((row) => rowToEntity(row as TemplateRow))
}

export function listTemplatesByType(db: DB, type: string): Template[] {
  return db
    .select()
    .from(templates)
    .where(eq(templates.type, type))
    .orderBy(templates.createdAt)
    .all()
    .map((row) => rowToEntity(row as TemplateRow))
}

export function getTemplate(db: DB, id: string): Template | undefined {
  const row = db.select().from(templates).where(eq(templates.id, id)).get()
  return row ? rowToEntity(row as TemplateRow) : undefined
}

export function createTemplate(
  db: DB,
  data: Partial<OptionalId<Template>> & { name: string; type: string; content: string },
): Template {
  const ts = now()
  const value: typeof templates.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    name: data.name,
    type: data.type,
    scope: data.scope ?? null,
    description: data.description ?? null,
    content: data.content,
    variables: stringifyArray(data.variables),
    builtIn: data.builtIn ?? false,
  }
  const [row] = insertRow(db, templates, value)
  return rowToEntity(row as TemplateRow)
}

export function updateTemplate(db: DB, id: string, patch: Partial<OptionalId<Template>>): Template | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (Array.isArray(fields['variables'])) fields['variables'] = stringifyArray(fields['variables'] as string[])
  const [row] = updateRows(db, templates, fields).where(eq(templates.id, id)).returning().all()
  return row ? rowToEntity(row as TemplateRow) : undefined
}

export function deleteTemplate(db: DB, id: string): void {
  db.delete(templates).where(eq(templates.id, id)).run()
}

/** 首次启动 seed：按 name 幂等 upsert 内置模板（已存在则不动用户改动） */
export function upsertBuiltInTemplates(db: DB, presets: BuiltInTemplatePreset[]): Template[] {
  const ts = now()
  const existing = listTemplates(db)
  const byName = new Map(existing.map((t) => [t.name, t]))
  const result: Template[] = []
  for (const p of presets) {
    const found = byName.get(p.name)
    if (found) {
      if (!found.builtIn) {
        const updated = updateTemplate(db, found.id, { builtIn: true })
        result.push(updated ?? found)
      } else {
        result.push(found)
      }
    } else {
      const value: typeof templates.$inferInsert = {
        id: genId(),
        createdAt: ts,
        updatedAt: ts,
        name: p.name,
        type: p.type,
        scope: p.scope ?? null,
        description: p.description ?? null,
        content: p.content,
        variables: stringifyArray(p.variables),
        builtIn: true,
      }
      const [row] = insertRow(db, templates, value)
      result.push(rowToEntity(row as TemplateRow))
    }
  }
  return result
}
