// genre_presets —— 类型库（ROADMAP v0.8 §4）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { genrePresets } from '../schema'
import type { BuiltInGenrePreset, GenrePreset, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow, updateRows } from './util'

type GenreRow = typeof genrePresets.$inferSelect

function rowToEntity(row: GenreRow): GenrePreset {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    commonRelationships: parseJsonArray(row.commonRelationships),
    commonHighlights: parseJsonArray(row.commonHighlights),
    commonReversals: parseJsonArray(row.commonReversals),
    commonOpenings: parseJsonArray(row.commonOpenings),
    commonCliffhangers: parseJsonArray(row.commonCliffhangers),
    visualStyle: row.visualStyle,
    shotPromptAdvice: row.shotPromptAdvice,
    aiVideoRisks: row.aiVideoRisks,
    builtIn: row.builtIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listGenrePresets(db: DB): GenrePreset[] {
  return db
    .select()
    .from(genrePresets)
    .orderBy(genrePresets.createdAt)
    .all()
    .map((row) => rowToEntity(row as GenreRow))
}

export function getGenrePreset(db: DB, id: string): GenrePreset | undefined {
  const row = db.select().from(genrePresets).where(eq(genrePresets.id, id)).get()
  return row ? rowToEntity(row as GenreRow) : undefined
}

export function getGenrePresetByName(db: DB, name: string): GenrePreset | undefined {
  const row = db.select().from(genrePresets).where(eq(genrePresets.name, name)).get()
  return row ? rowToEntity(row as GenreRow) : undefined
}

const ARR_FIELDS = [
  'commonRelationships',
  'commonHighlights',
  'commonReversals',
  'commonOpenings',
  'commonCliffhangers',
] as const

export function createGenrePreset(
  db: DB,
  data: Partial<OptionalId<GenrePreset>> & { name: string; visualStyle: string; shotPromptAdvice: string; aiVideoRisks: string },
): GenrePreset {
  const ts = now()
  const value: typeof genrePresets.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    name: data.name,
    description: data.description ?? null,
    commonRelationships: stringifyArray(data.commonRelationships),
    commonHighlights: stringifyArray(data.commonHighlights),
    commonReversals: stringifyArray(data.commonReversals),
    commonOpenings: stringifyArray(data.commonOpenings),
    commonCliffhangers: stringifyArray(data.commonCliffhangers),
    visualStyle: data.visualStyle,
    shotPromptAdvice: data.shotPromptAdvice,
    aiVideoRisks: data.aiVideoRisks,
    builtIn: data.builtIn ?? false,
  }
  const [row] = insertRow(db, genrePresets, value)
  return rowToEntity(row as GenreRow)
}

export function updateGenrePreset(db: DB, id: string, patch: Partial<OptionalId<GenrePreset>>): GenrePreset | undefined {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  for (const k of ARR_FIELDS) {
    if (Array.isArray(fields[k])) fields[k] = stringifyArray(fields[k] as string[])
  }
  const [row] = updateRows(db, genrePresets, fields).where(eq(genrePresets.id, id)).returning().all()
  return row ? rowToEntity(row as GenreRow) : undefined
}

export function deleteGenrePreset(db: DB, id: string): void {
  db.delete(genrePresets).where(eq(genrePresets.id, id)).run()
}

/**
 * 启动时同步内置题材：更新当前 built-in、移除已退役 built-in，同时保留所有用户自定义项。
 * 项目只保存题材名称而不引用预设 id，因此退役预设不会改写已有项目。
 */
export function upsertBuiltInGenrePresets(
  db: DB,
  presets: BuiltInGenrePreset[],
  retiredNames: readonly string[] = [],
): GenrePreset[] {
  const ts = now()
  const result: GenrePreset[] = []
  const currentNames = new Set(presets.map((preset) => preset.name))

  for (const name of retiredNames) {
    if (currentNames.has(name)) continue
    const retired = getGenrePresetByName(db, name)
    if (retired?.builtIn) deleteGenrePreset(db, retired.id)
  }

  for (const p of presets) {
    const existing = getGenrePresetByName(db, p.name)
    if (existing) {
      if (!existing.builtIn) {
        // 用户可能先创建了同名自定义项；不夺取所有权，也不覆盖内容。
        result.push(existing)
        continue
      }
      const updated = updateGenrePreset(db, existing.id, {
        name: p.name,
        description: p.description,
        commonRelationships: p.commonRelationships,
        commonHighlights: p.commonHighlights,
        commonReversals: p.commonReversals,
        commonOpenings: p.commonOpenings,
        commonCliffhangers: p.commonCliffhangers,
        visualStyle: p.visualStyle,
        shotPromptAdvice: p.shotPromptAdvice,
        aiVideoRisks: p.aiVideoRisks,
        builtIn: true,
      })
      result.push(updated ?? existing)
    } else {
      const value: typeof genrePresets.$inferInsert = {
        id: genId(),
        createdAt: ts,
        updatedAt: ts,
        name: p.name,
        description: p.description,
        commonRelationships: stringifyArray(p.commonRelationships),
        commonHighlights: stringifyArray(p.commonHighlights),
        commonReversals: stringifyArray(p.commonReversals),
        commonOpenings: stringifyArray(p.commonOpenings),
        commonCliffhangers: stringifyArray(p.commonCliffhangers),
        visualStyle: p.visualStyle,
        shotPromptAdvice: p.shotPromptAdvice,
        aiVideoRisks: p.aiVideoRisks,
        builtIn: true,
      }
      const [row] = insertRow(db, genrePresets, value)
      result.push(rowToEntity(row as GenreRow))
    }
  }
  return result
}
