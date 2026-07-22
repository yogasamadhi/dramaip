import { desc, eq, max } from 'drizzle-orm'
import type { AnimaticAnnotation, AnimaticClip, AnimaticDraft, AnimaticStatus } from '@sdns/core'
import type { DB } from '../client'
import { animaticDrafts } from '../schema'
import { genId, insertRow, now, stringifyJson, updateRows } from './util'

type Row = typeof animaticDrafts.$inferSelect

function parseArray<T>(value: string, fallback: T[]): T[] {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed as T[] : fallback } catch { return fallback }
}
function fromRow(row: Row): AnimaticDraft {
  return { ...row, status: row.status as AnimaticStatus, clips: parseArray<AnimaticClip>(row.clips, []), annotations: parseArray<AnimaticAnnotation>(row.annotations, []), reviewNote: row.reviewNote ?? undefined }
}
export function listAnimaticDraftsByEpisode(db: DB, episodeId: string): AnimaticDraft[] {
  return db.select().from(animaticDrafts).where(eq(animaticDrafts.episodeId, episodeId)).orderBy(desc(animaticDrafts.versionNumber)).all().map((row) => fromRow(row as Row))
}
export function getAnimaticDraft(db: DB, id: string): AnimaticDraft | undefined {
  const row = db.select().from(animaticDrafts).where(eq(animaticDrafts.id, id)).get() as Row | undefined
  return row ? fromRow(row) : undefined
}
/** Each save appends a revision. Existing playbacks and approval decisions remain reviewable. */
export function createAnimaticDraft(db: DB, data: Pick<AnimaticDraft, 'projectId' | 'adaptationProjectId' | 'episodeId' | 'sourceFingerprint' | 'clips' | 'annotations'>): AnimaticDraft {
  const existing = db.select({ value: max(animaticDrafts.versionNumber) }).from(animaticDrafts).where(eq(animaticDrafts.episodeId, data.episodeId)).get()
  const ts = now()
  const [row] = insertRow(db, animaticDrafts, { id: genId(), ...data, versionNumber: (existing?.value ?? 0) + 1, status: 'draft', clips: stringifyJson(data.clips), annotations: stringifyJson(data.annotations), reviewNote: null, createdAt: ts, updatedAt: ts })
  return fromRow(row as Row)
}
export function reviewAnimaticDraft(db: DB, id: string, status: Extract<AnimaticStatus, 'approved' | 'returned'>, reviewNote?: string): AnimaticDraft | undefined {
  const [row] = updateRows(db, animaticDrafts, { status, reviewNote: reviewNote ?? null, updatedAt: now() }).where(eq(animaticDrafts.id, id)).returning().all()
  return row ? fromRow(row as Row) : undefined
}
