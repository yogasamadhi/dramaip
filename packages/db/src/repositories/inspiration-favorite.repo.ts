import { and, desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { inspirationFavorites } from '../schema'
import type { InspirationFavorite, OptionalId } from '@sdns/core'
import { genId, insertRow, now, updateRows } from './util'

type InspirationFavoriteRow = typeof inspirationFavorites.$inferSelect

function rowToEntity(row: InspirationFavoriteRow): InspirationFavorite {
  return {
    id: row.id,
    projectId: row.projectId,
    cardKey: row.cardKey,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId ?? undefined,
    kind: row.kind,
    title: row.title,
    pattern: row.pattern,
    applyTo: row.applyTo,
    risk: row.risk ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listInspirationFavorites(db: DB, projectId: string): InspirationFavorite[] {
  return db
    .select()
    .from(inspirationFavorites)
    .where(eq(inspirationFavorites.projectId, projectId))
    .orderBy(desc(inspirationFavorites.updatedAt))
    .all()
    .map((row) => rowToEntity(row as InspirationFavoriteRow))
}

export function getInspirationFavoriteByCardKey(
  db: DB,
  projectId: string,
  cardKey: string,
): InspirationFavorite | undefined {
  const row = db
    .select()
    .from(inspirationFavorites)
    .where(and(eq(inspirationFavorites.projectId, projectId), eq(inspirationFavorites.cardKey, cardKey)))
    .get()
  return row ? rowToEntity(row as InspirationFavoriteRow) : undefined
}

export function upsertInspirationFavorite(
  db: DB,
  data: Partial<OptionalId<InspirationFavorite>> & {
    projectId: string
    cardKey: string
    sourceKind: InspirationFavorite['sourceKind']
    kind: InspirationFavorite['kind']
    title: string
    pattern: string
    applyTo: string
  },
): InspirationFavorite {
  const current = getInspirationFavoriteByCardKey(db, data.projectId, data.cardKey)
  if (current) return updateInspirationFavorite(db, current.id, data) ?? current

  const ts = now()
  const value: typeof inspirationFavorites.$inferInsert = {
    id: genId(),
    projectId: data.projectId,
    cardKey: data.cardKey,
    sourceKind: data.sourceKind,
    sourceId: data.sourceId ?? null,
    kind: data.kind,
    title: data.title,
    pattern: data.pattern,
    applyTo: data.applyTo,
    risk: data.risk ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, inspirationFavorites, value)
  return rowToEntity(row as InspirationFavoriteRow)
}

export function updateInspirationFavorite(
  db: DB,
  id: string,
  patch: Partial<OptionalId<InspirationFavorite>>,
): InspirationFavorite | undefined {
  const fields: Partial<typeof inspirationFavorites.$inferInsert> = { updatedAt: now() }
  if (patch.cardKey !== undefined) fields.cardKey = patch.cardKey
  if (patch.sourceKind !== undefined) fields.sourceKind = patch.sourceKind
  if (patch.sourceId !== undefined || 'sourceId' in patch) fields.sourceId = patch.sourceId ?? null
  if (patch.kind !== undefined) fields.kind = patch.kind
  if (patch.title !== undefined) fields.title = patch.title
  if (patch.pattern !== undefined) fields.pattern = patch.pattern
  if (patch.applyTo !== undefined) fields.applyTo = patch.applyTo
  if (patch.risk !== undefined || 'risk' in patch) fields.risk = patch.risk ?? null
  const [row] = updateRows(db, inspirationFavorites, fields).where(eq(inspirationFavorites.id, id)).returning().all()
  return row ? rowToEntity(row as InspirationFavoriteRow) : undefined
}

export function deleteInspirationFavorite(db: DB, id: string): void {
  db.delete(inspirationFavorites).where(eq(inspirationFavorites.id, id)).run()
}

export function deleteInspirationFavoriteByCardKey(db: DB, projectId: string, cardKey: string): void {
  db
    .delete(inspirationFavorites)
    .where(and(eq(inspirationFavorites.projectId, projectId), eq(inspirationFavorites.cardKey, cardKey)))
    .run()
}
