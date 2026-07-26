import { and, desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { generationCostEntries, generationLineages } from '../schema'
import type {
  GenerationCostEntry,
  GenerationLineage,
  GenerationReferenceAsset,
  OptionalId,
} from '@sdns/core'
import { genId, insertRow, now, parseJsonObject, stringifyJson, updateRows } from './util'

type LineageRow = typeof generationLineages.$inferSelect
type CostRow = typeof generationCostEntries.$inferSelect

function parseReferences(value: string | null | undefined): GenerationReferenceAsset[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((item) => ({
        assetId: typeof item.assetId === 'string' ? item.assetId : undefined,
        url: typeof item.url === 'string' ? item.url : undefined,
        weight: typeof item.weight === 'number' && Number.isFinite(item.weight) ? item.weight : undefined,
        role: typeof item.role === 'string' ? item.role : undefined,
      }))
  } catch {
    return []
  }
}

function lineageFromRow(row: LineageRow): GenerationLineage {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    adaptationProjectId: row.adaptationProjectId ?? undefined,
    episodeId: row.episodeId ?? undefined,
    sceneId: row.sceneId ?? undefined,
    shotId: row.shotId ?? undefined,
    mediaType: row.mediaType as GenerationLineage['mediaType'],
    taskKind: row.taskKind,
    taskId: row.taskId ?? undefined,
    parentLineageId: row.parentLineageId ?? undefined,
    retryOfLineageId: row.retryOfLineageId ?? undefined,
    sourceEntityKind: row.sourceEntityKind ?? undefined,
    sourceEntityId: row.sourceEntityId ?? undefined,
    sourceVersion: row.sourceVersion ?? undefined,
    sourceSnapshot: parseJsonObject(row.sourceSnapshot, {}),
    providerSnapshot: parseJsonObject(row.providerSnapshot, {}),
    parameterSnapshot: parseJsonObject(row.parameterSnapshot, {}),
    referenceAssets: parseReferences(row.referenceAssets),
    seed: row.seed ?? undefined,
    completeness: row.completeness as GenerationLineage['completeness'],
    adoptedOutputKind: row.adoptedOutputKind ?? undefined,
    adoptedOutputId: row.adoptedOutputId ?? undefined,
    adoptedAt: row.adoptedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function costFromRow(row: CostRow): GenerationCostEntry {
  return {
    id: row.id,
    projectId: row.projectId ?? undefined,
    adaptationProjectId: row.adaptationProjectId ?? undefined,
    episodeId: row.episodeId ?? undefined,
    sceneId: row.sceneId ?? undefined,
    shotId: row.shotId ?? undefined,
    lineageId: row.lineageId ?? undefined,
    taskId: row.taskId ?? undefined,
    mediaType: row.mediaType as GenerationCostEntry['mediaType'],
    status: row.status as GenerationCostEntry['status'],
    currency: row.currency ?? undefined,
    estimatedCost: row.estimatedCost ?? undefined,
    actualCost: row.actualCost ?? undefined,
    estimateBasis: row.estimateBasis ?? undefined,
    actualCostNote: row.actualCostNote ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function normalizeLineagePatch(patch: Partial<OptionalId<GenerationLineage>>): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  for (const key of ['sourceSnapshot', 'providerSnapshot', 'parameterSnapshot', 'referenceAssets']) {
    if (fields[key] && typeof fields[key] === 'object') fields[key] = stringifyJson(fields[key])
  }
  return fields
}

export function createGenerationLineage(
  db: DB,
  data: Partial<OptionalId<GenerationLineage>> & { mediaType: GenerationLineage['mediaType']; taskKind: string },
): GenerationLineage {
  const ts = now()
  const value: typeof generationLineages.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    adaptationProjectId: data.adaptationProjectId ?? null,
    episodeId: data.episodeId ?? null,
    sceneId: data.sceneId ?? null,
    shotId: data.shotId ?? null,
    mediaType: data.mediaType,
    taskKind: data.taskKind,
    taskId: data.taskId ?? null,
    parentLineageId: data.parentLineageId ?? null,
    retryOfLineageId: data.retryOfLineageId ?? null,
    sourceEntityKind: data.sourceEntityKind ?? null,
    sourceEntityId: data.sourceEntityId ?? null,
    sourceVersion: data.sourceVersion ?? null,
    sourceSnapshot: stringifyJson(data.sourceSnapshot ?? {}),
    providerSnapshot: stringifyJson(data.providerSnapshot ?? {}),
    parameterSnapshot: stringifyJson(data.parameterSnapshot ?? {}),
    referenceAssets: stringifyJson(data.referenceAssets ?? []),
    seed: data.seed ?? null,
    completeness: data.completeness ?? 'unknown',
    adoptedOutputKind: data.adoptedOutputKind ?? null,
    adoptedOutputId: data.adoptedOutputId ?? null,
    adoptedAt: data.adoptedAt ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, generationLineages, value)
  return lineageFromRow(row as LineageRow)
}

export function updateGenerationLineage(
  db: DB,
  id: string,
  patch: Partial<OptionalId<GenerationLineage>>,
): GenerationLineage | undefined {
  const [row] = updateRows(db, generationLineages, normalizeLineagePatch(patch))
    .where(eq(generationLineages.id, id))
    .returning()
    .all()
  return row ? lineageFromRow(row as LineageRow) : undefined
}

export function getGenerationLineage(db: DB, id: string): GenerationLineage | undefined {
  const row = db.select().from(generationLineages).where(eq(generationLineages.id, id)).get()
  return row ? lineageFromRow(row as LineageRow) : undefined
}

export function listGenerationLineagesByProject(db: DB, projectId: string): GenerationLineage[] {
  return db.select().from(generationLineages).where(eq(generationLineages.projectId, projectId))
    .orderBy(desc(generationLineages.createdAt)).all().map((row) => lineageFromRow(row as LineageRow))
}

export function listGenerationLineagesByTask(db: DB, taskId: string): GenerationLineage[] {
  return db.select().from(generationLineages).where(eq(generationLineages.taskId, taskId))
    .orderBy(desc(generationLineages.createdAt)).all().map((row) => lineageFromRow(row as LineageRow))
}

export function clearGenerationLineageAdoptionForSource(db: DB, sourceEntityKind: string, sourceEntityId: string): void {
  updateRows(db, generationLineages, { adoptedOutputKind: null, adoptedOutputId: null, adoptedAt: null, updatedAt: now() })
    .where(and(eq(generationLineages.sourceEntityKind, sourceEntityKind), eq(generationLineages.sourceEntityId, sourceEntityId)))
    .run()
}

export function createGenerationCostEntry(
  db: DB,
  data: Partial<OptionalId<GenerationCostEntry>> & { mediaType: GenerationCostEntry['mediaType']; status: GenerationCostEntry['status'] },
): GenerationCostEntry {
  const ts = now()
  const value: typeof generationCostEntries.$inferInsert = {
    id: genId(),
    projectId: data.projectId ?? null,
    adaptationProjectId: data.adaptationProjectId ?? null,
    episodeId: data.episodeId ?? null,
    sceneId: data.sceneId ?? null,
    shotId: data.shotId ?? null,
    lineageId: data.lineageId ?? null,
    taskId: data.taskId ?? null,
    mediaType: data.mediaType,
    status: data.status,
    currency: data.currency ?? null,
    estimatedCost: data.estimatedCost ?? null,
    actualCost: data.actualCost ?? null,
    estimateBasis: data.estimateBasis ?? null,
    actualCostNote: data.actualCostNote ?? null,
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, generationCostEntries, value)
  return costFromRow(row as CostRow)
}

export function updateGenerationCostEntry(
  db: DB,
  id: string,
  patch: Partial<OptionalId<GenerationCostEntry>>,
): GenerationCostEntry | undefined {
  const next = { ...patch, updatedAt: now() }
  if (next.actualCost !== undefined && Number.isFinite(next.actualCost)) next.status = 'actual'
  const [row] = updateRows(db, generationCostEntries, next)
    .where(eq(generationCostEntries.id, id))
    .returning()
    .all()
  return row ? costFromRow(row as CostRow) : undefined
}

export function listGenerationCostEntriesByProject(db: DB, projectId: string): GenerationCostEntry[] {
  return db.select().from(generationCostEntries).where(eq(generationCostEntries.projectId, projectId))
    .orderBy(desc(generationCostEntries.createdAt)).all().map((row) => costFromRow(row as CostRow))
}
