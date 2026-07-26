import { and, desc, eq, max } from 'drizzle-orm'
import type { OptionalId, ShotVisualAssetLock, VisualAssetVersion } from '@sdns/core'
import type { DB } from '../client'
import { shotVisualAssetLocks, visualAssetVersions } from '../schema'
import { genId, insertRow, now, updateRows } from './util'

type VersionRow = typeof visualAssetVersions.$inferSelect
type LockRow = typeof shotVisualAssetLocks.$inferSelect
const versionFromRow = (row: VersionRow) => ({ ...row, notes: row.notes ?? undefined, adoptedAt: row.adoptedAt ?? undefined }) as VisualAssetVersion
const lockFromRow = (row: LockRow) => ({ ...row, staleAt: row.staleAt ?? undefined, staleReason: row.staleReason ?? undefined }) as ShotVisualAssetLock

export function listVisualAssetVersionsByProject(db: DB, projectId: string): VisualAssetVersion[] {
  return db.select().from(visualAssetVersions).where(eq(visualAssetVersions.projectId, projectId)).orderBy(desc(visualAssetVersions.updatedAt)).all().map((row) => versionFromRow(row as VersionRow))
}
export function listVisualAssetVersionsByOwner(db: DB, ownerKind: VisualAssetVersion['ownerKind'], ownerId: string): VisualAssetVersion[] {
  return db.select().from(visualAssetVersions).where(and(eq(visualAssetVersions.ownerKind, ownerKind), eq(visualAssetVersions.ownerId, ownerId))).orderBy(desc(visualAssetVersions.versionNumber)).all().map((row) => versionFromRow(row as VersionRow))
}
export function getVisualAssetVersion(db: DB, id: string): VisualAssetVersion | undefined {
  const row = db.select().from(visualAssetVersions).where(eq(visualAssetVersions.id, id)).get() as VersionRow | undefined
  return row ? versionFromRow(row) : undefined
}
export function createVisualAssetVersion(db: DB, data: Partial<OptionalId<VisualAssetVersion>> & Pick<VisualAssetVersion, 'projectId' | 'ownerKind' | 'ownerId' | 'assetId' | 'slot' | 'label'>): VisualAssetVersion {
  const ts = now()
  const existing = db.select({ value: max(visualAssetVersions.versionNumber) }).from(visualAssetVersions).where(and(eq(visualAssetVersions.ownerKind, data.ownerKind), eq(visualAssetVersions.ownerId, data.ownerId), eq(visualAssetVersions.slot, data.slot))).get()
  const [row] = insertRow(db, visualAssetVersions, { id: genId(), projectId: data.projectId, ownerKind: data.ownerKind, ownerId: data.ownerId, assetId: data.assetId, slot: data.slot, label: data.label, versionNumber: (existing?.value ?? 0) + 1, status: data.status ?? 'candidate', notes: data.notes ?? null, adoptedAt: data.adoptedAt ?? null, createdAt: ts, updatedAt: ts })
  return versionFromRow(row as VersionRow)
}
export function adoptVisualAssetVersion(db: DB, id: string): VisualAssetVersion | undefined {
  const current = db.select().from(visualAssetVersions).where(eq(visualAssetVersions.id, id)).get() as VersionRow | undefined
  if (!current) return undefined
  const ts = now()
  const prior = db.select().from(visualAssetVersions).where(and(eq(visualAssetVersions.ownerKind, current.ownerKind), eq(visualAssetVersions.ownerId, current.ownerId), eq(visualAssetVersions.slot, current.slot), eq(visualAssetVersions.status, 'adopted'))).all() as VersionRow[]
  for (const old of prior) {
    updateRows(db, visualAssetVersions, { status: 'superseded', updatedAt: ts }).where(eq(visualAssetVersions.id, old.id)).run()
    updateRows(db, shotVisualAssetLocks, { staleAt: ts, staleReason: `上游已采用 ${current.label} v${current.versionNumber}；原锁定版本仍保留，需人工确认是否替换。`, updatedAt: ts }).where(eq(shotVisualAssetLocks.visualAssetVersionId, old.id)).run()
  }
  const [row] = updateRows(db, visualAssetVersions, { status: 'adopted', adoptedAt: ts, updatedAt: ts }).where(eq(visualAssetVersions.id, id)).returning().all()
  return row ? versionFromRow(row as VersionRow) : undefined
}
export function listShotVisualAssetLocks(db: DB, shotId: string): ShotVisualAssetLock[] {
  return db.select().from(shotVisualAssetLocks).where(eq(shotVisualAssetLocks.shotId, shotId)).orderBy(desc(shotVisualAssetLocks.updatedAt)).all().map((row) => lockFromRow(row as LockRow))
}
export function listShotVisualAssetLocksByProject(db: DB, projectId: string): ShotVisualAssetLock[] {
  return db.select().from(shotVisualAssetLocks).where(eq(shotVisualAssetLocks.projectId, projectId)).orderBy(desc(shotVisualAssetLocks.updatedAt)).all().map((row) => lockFromRow(row as LockRow))
}
export function lockShotVisualAsset(db: DB, data: Pick<ShotVisualAssetLock, 'projectId' | 'shotId' | 'visualAssetVersionId' | 'role'>): ShotVisualAssetLock {
  const existing = db.select().from(shotVisualAssetLocks).where(and(eq(shotVisualAssetLocks.shotId, data.shotId), eq(shotVisualAssetLocks.role, data.role))).get() as LockRow | undefined
  const ts = now()
  if (existing) {
    const [row] = updateRows(db, shotVisualAssetLocks, { visualAssetVersionId: data.visualAssetVersionId, staleAt: null, staleReason: null, updatedAt: ts }).where(eq(shotVisualAssetLocks.id, existing.id)).returning().all()
    return lockFromRow(row as LockRow)
  }
  const [row] = insertRow(db, shotVisualAssetLocks, { id: genId(), ...data, staleAt: null, staleReason: null, createdAt: ts, updatedAt: ts })
  return lockFromRow(row as LockRow)
}
export function setShotVisualAssetLockStaleState(db: DB, id: string, staleAt: string | undefined, staleReason: string | undefined): ShotVisualAssetLock | undefined {
  const [row] = updateRows(db, shotVisualAssetLocks, {
    staleAt: staleAt ?? null,
    staleReason: staleReason ?? null,
    updatedAt: now(),
  }).where(eq(shotVisualAssetLocks.id, id)).returning().all()
  return row ? lockFromRow(row as LockRow) : undefined
}
