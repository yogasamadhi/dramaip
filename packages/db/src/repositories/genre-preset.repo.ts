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

/** 首次启动 seed：按 name 幂等 upsert 内置类型预设（已存在则不动用户改动） */
export function upsertBuiltInGenrePresets(db: DB, presets: BuiltInGenrePreset[]): GenrePreset[] {
  const ts = now()
  const result: GenrePreset[] = []
  for (const p of presets) {
    const existing = getGenrePresetByName(db, p.name)
    if (existing) {
      if (!existing.builtIn) {
        const updated = updateGenrePreset(db, existing.id, { builtIn: true })
        result.push(updated ?? existing)
      } else {
        result.push(existing)
      }
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
