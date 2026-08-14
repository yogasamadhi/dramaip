import { and, desc, eq, max } from 'drizzle-orm'
import type { DeliveryCreativeVariant, PlatformDeliveryExport } from '@sdns/core'
import type { DB } from '../client'
import { deliveryCreativeVariants, platformDeliveryExports } from '../schema'
import { genId, insertRow, now, parseJsonArray, stringifyArray, updateRows } from './util'

type VariantRow = typeof deliveryCreativeVariants.$inferSelect
type ExportRow = typeof platformDeliveryExports.$inferSelect

function variantFromRow(row: VariantRow): DeliveryCreativeVariant {
  return {
    id: row.id, projectId: row.projectId, adaptationProjectId: row.adaptationProjectId, label: row.label,
    title: row.title, description: row.description, tags: parseJsonArray(row.tags), coverAssetId: row.coverAssetId ?? undefined,
    source: row.source as DeliveryCreativeVariant['source'], status: row.status as DeliveryCreativeVariant['status'],
    versionNumber: row.versionNumber, createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function exportFromRow(row: ExportRow): PlatformDeliveryExport {
  return {
    id: row.id, projectId: row.projectId, adaptationProjectId: row.adaptationProjectId, episodeId: row.episodeId,
    profileId: row.profileId, profileVersion: row.profileVersion, creativeVariantId: row.creativeVariantId,
    complianceTaskId: row.complianceTaskId, deliveryVersion: row.deliveryVersion, outputDirectory: row.outputDirectory,
    manifestPath: row.manifestPath, sourceFingerprint: row.sourceFingerprint, createdAt: row.createdAt,
  }
}

export function listDeliveryCreativeVariants(db: DB, adaptationProjectId: string): DeliveryCreativeVariant[] {
  return db.select().from(deliveryCreativeVariants).where(eq(deliveryCreativeVariants.adaptationProjectId, adaptationProjectId))
    .orderBy(desc(deliveryCreativeVariants.status), desc(deliveryCreativeVariants.versionNumber)).all().map((row) => variantFromRow(row as VariantRow))
}

export function createDeliveryCreativeVariant(db: DB, input: Omit<DeliveryCreativeVariant, 'id' | 'versionNumber' | 'createdAt' | 'updatedAt' | 'status'> & { status?: DeliveryCreativeVariant['status'] }): DeliveryCreativeVariant {
  const ts = now()
  const latest = db.select({ value: max(deliveryCreativeVariants.versionNumber) }).from(deliveryCreativeVariants)
    .where(eq(deliveryCreativeVariants.adaptationProjectId, input.adaptationProjectId)).get()?.value ?? 0
  const [row] = insertRow(db, deliveryCreativeVariants, {
    id: genId(), projectId: input.projectId, adaptationProjectId: input.adaptationProjectId, label: input.label,
    title: input.title, description: input.description, tags: stringifyArray(input.tags), coverAssetId: input.coverAssetId ?? null,
    source: input.source, status: input.status ?? 'candidate', versionNumber: latest + 1, createdAt: ts, updatedAt: ts,
  })
  return variantFromRow(row as VariantRow)
}

export function adoptDeliveryCreativeVariant(db: DB, id: string): DeliveryCreativeVariant | undefined {
  const current = db.select().from(deliveryCreativeVariants).where(eq(deliveryCreativeVariants.id, id)).get() as VariantRow | undefined
  if (!current) return undefined
  const ts = now()
  db.transaction((tx) => {
    updateRows(tx as DB, deliveryCreativeVariants, { status: 'archived', updatedAt: ts })
      .where(and(eq(deliveryCreativeVariants.adaptationProjectId, current.adaptationProjectId), eq(deliveryCreativeVariants.status, 'adopted'))).run()
    updateRows(tx as DB, deliveryCreativeVariants, { status: 'adopted', updatedAt: ts }).where(eq(deliveryCreativeVariants.id, id)).run()
  })
  const row = db.select().from(deliveryCreativeVariants).where(eq(deliveryCreativeVariants.id, id)).get()
  return row ? variantFromRow(row as VariantRow) : undefined
}

export function getDeliveryCreativeVariant(db: DB, id: string): DeliveryCreativeVariant | undefined {
  const row = db.select().from(deliveryCreativeVariants).where(eq(deliveryCreativeVariants.id, id)).get()
  return row ? variantFromRow(row as VariantRow) : undefined
}

export function listPlatformDeliveryExports(db: DB, projectId: string, episodeId: string): PlatformDeliveryExport[] {
  return db.select().from(platformDeliveryExports).where(and(eq(platformDeliveryExports.projectId, projectId), eq(platformDeliveryExports.episodeId, episodeId)))
    .orderBy(desc(platformDeliveryExports.createdAt)).all().map((row) => exportFromRow(row as ExportRow))
}

export function getPlatformDeliveryExport(db: DB, id: string): PlatformDeliveryExport | undefined {
  const row = db.select().from(platformDeliveryExports).where(eq(platformDeliveryExports.id, id)).get()
  return row ? exportFromRow(row as ExportRow) : undefined
}

export function nextPlatformDeliveryVersion(db: DB, episodeId: string, profileId: string): number {
  const latest = db.select({ value: max(platformDeliveryExports.deliveryVersion) }).from(platformDeliveryExports)
    .where(and(eq(platformDeliveryExports.episodeId, episodeId), eq(platformDeliveryExports.profileId, profileId))).get()?.value ?? 0
  return latest + 1
}

export function createPlatformDeliveryExport(db: DB, input: Omit<PlatformDeliveryExport, 'id' | 'createdAt'>): PlatformDeliveryExport {
  const [row] = insertRow(db, platformDeliveryExports, { id: genId(), ...input, createdAt: now() })
  return exportFromRow(row as ExportRow)
}
