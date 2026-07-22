import { and, desc, eq } from 'drizzle-orm'
import type { ShotStillCandidate } from '@sdns/core'
import type { DB } from '../client'
import { shotStillCandidates } from '../schema'
import { genId, insertRow, now, updateRows } from './util'

type Row = typeof shotStillCandidates.$inferSelect
const fromRow = (row: Row): ShotStillCandidate => ({ ...row, notes: row.notes ?? undefined, sourceFingerprint: row.sourceFingerprint ?? undefined, staleAt: row.staleAt ?? undefined, staleReason: row.staleReason ?? undefined })
export function listShotStillCandidates(db: DB, shotId: string): ShotStillCandidate[] { return db.select().from(shotStillCandidates).where(eq(shotStillCandidates.shotId, shotId)).orderBy(desc(shotStillCandidates.updatedAt)).all().map((row) => fromRow(row as Row)) }
export function getShotStillCandidate(db: DB, id: string): ShotStillCandidate | undefined {
  const row = db.select().from(shotStillCandidates).where(eq(shotStillCandidates.id, id)).get() as Row | undefined
  return row ? fromRow(row) : undefined
}
export function listShotStillCandidatesByProject(db: DB, projectId: string): ShotStillCandidate[] { return db.select().from(shotStillCandidates).where(eq(shotStillCandidates.projectId, projectId)).orderBy(desc(shotStillCandidates.updatedAt)).all().map((row) => fromRow(row as Row)) }
export function createShotStillCandidate(db: DB, data: Pick<ShotStillCandidate, 'projectId' | 'shotId' | 'assetId' | 'kind' | 'label'> & Partial<Pick<ShotStillCandidate, 'notes' | 'sourceFingerprint' | 'status'>>): ShotStillCandidate {
  const ts = now()
  const [row] = insertRow(db, shotStillCandidates, {
    id: genId(), projectId: data.projectId, shotId: data.shotId, assetId: data.assetId, kind: data.kind,
    label: data.label, status: data.status ?? 'candidate', notes: data.notes ?? null,
    sourceFingerprint: data.sourceFingerprint ?? null, staleAt: null, staleReason: null, createdAt: ts, updatedAt: ts,
  })
  return fromRow(row as Row)
}
export function adoptShotStillCandidate(db: DB, id: string, sourceFingerprint?: string): ShotStillCandidate | undefined {
  const current = db.select().from(shotStillCandidates).where(eq(shotStillCandidates.id, id)).get() as Row | undefined
  if (!current) return undefined
  const ts = now()
  updateRows(db, shotStillCandidates, { status: 'superseded', updatedAt: ts }).where(and(eq(shotStillCandidates.shotId, current.shotId), eq(shotStillCandidates.kind, current.kind), eq(shotStillCandidates.status, 'adopted'))).run()
  const [row] = updateRows(db, shotStillCandidates, { status: 'adopted', sourceFingerprint: sourceFingerprint ?? current.sourceFingerprint, staleAt: null, staleReason: null, updatedAt: ts }).where(eq(shotStillCandidates.id, id)).returning().all()
  return row ? fromRow(row as Row) : undefined
}
export function setShotStillCandidateStaleState(db: DB, id: string, staleAt: string | undefined, staleReason: string | undefined): ShotStillCandidate | undefined {
  const [row] = updateRows(db, shotStillCandidates, { staleAt: staleAt ?? null, staleReason: staleReason ?? null, updatedAt: now() }).where(eq(shotStillCandidates.id, id)).returning().all()
  return row ? fromRow(row as Row) : undefined
}
