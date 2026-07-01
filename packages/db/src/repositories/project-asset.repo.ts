// project_assets —— 本地资产库统一账本
import { and, desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { projectAssets } from '../schema'
import type { OptionalId, ProjectAsset } from '@sdns/core'
import { genId, insertRow, now, parseJsonArray, parseJsonObject, stringifyArray, stringifyJson, updateRows } from './util'

type AssetRow = typeof projectAssets.$inferSelect

function assetFromRow(row: AssetRow): ProjectAsset {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as ProjectAsset['kind'],
    title: row.title,
    description: row.description ?? undefined,
    sourceEntityKind: row.sourceEntityKind ? row.sourceEntityKind as ProjectAsset['sourceEntityKind'] : undefined,
    sourceEntityId: row.sourceEntityId ?? undefined,
    localPath: row.localPath ?? undefined,
    relativePath: row.relativePath ?? undefined,
    remoteUrl: row.remoteUrl ?? undefined,
    mimeType: row.mimeType ?? undefined,
    originalName: row.originalName ?? undefined,
    sha256: row.sha256 ?? undefined,
    sizeBytes: row.sizeBytes ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationSeconds: row.durationSeconds ?? undefined,
    tags: parseJsonArray(row.tags),
    metadata: parseJsonObject<Record<string, unknown>>(row.metadata, {}),
    status: row.status as ProjectAsset['status'],
    packagePolicy: row.packagePolicy as ProjectAsset['packagePolicy'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function normalizePatch(patch: Partial<OptionalId<ProjectAsset>>): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (Array.isArray(fields.tags)) fields.tags = stringifyArray(fields.tags as string[])
  if (fields.metadata && typeof fields.metadata === 'object') fields.metadata = stringifyJson(fields.metadata)
  return fields
}

export function listProjectAssets(db: DB, projectId: string): ProjectAsset[] {
  return db
    .select()
    .from(projectAssets)
    .where(eq(projectAssets.projectId, projectId))
    .orderBy(desc(projectAssets.updatedAt))
    .all()
    .map((row) => assetFromRow(row as AssetRow))
}

export function listAssetsBySource(db: DB, sourceEntityKind: string, sourceEntityId: string): ProjectAsset[] {
  return db
    .select()
    .from(projectAssets)
    .where(and(eq(projectAssets.sourceEntityKind, sourceEntityKind), eq(projectAssets.sourceEntityId, sourceEntityId)))
    .orderBy(desc(projectAssets.updatedAt))
    .all()
    .map((row) => assetFromRow(row as AssetRow))
}

export function getAsset(db: DB, id: string): ProjectAsset | undefined {
  const row = db.select().from(projectAssets).where(eq(projectAssets.id, id)).get()
  return row ? assetFromRow(row as AssetRow) : undefined
}

export function createAsset(
  db: DB,
  data: Partial<OptionalId<ProjectAsset>> & { projectId: string; kind: ProjectAsset['kind']; title: string },
): ProjectAsset {
  const ts = now()
  const value: typeof projectAssets.$inferInsert = {
    id: genId(),
    projectId: data.projectId,
    kind: data.kind,
    title: data.title,
    description: data.description ?? null,
    sourceEntityKind: data.sourceEntityKind ?? null,
    sourceEntityId: data.sourceEntityId ?? null,
    localPath: data.localPath ?? null,
    relativePath: data.relativePath ?? null,
    remoteUrl: data.remoteUrl ?? null,
    mimeType: data.mimeType ?? null,
    originalName: data.originalName ?? null,
    sha256: data.sha256 ?? null,
    sizeBytes: data.sizeBytes ?? null,
    width: data.width ?? null,
    height: data.height ?? null,
    durationSeconds: data.durationSeconds ?? null,
    tags: stringifyArray(data.tags),
    metadata: stringifyJson(data.metadata ?? {}),
    status: data.status ?? 'available',
    packagePolicy: data.packagePolicy ?? 'reference_only',
    createdAt: ts,
    updatedAt: ts,
  }
  const [row] = insertRow(db, projectAssets, value)
  return assetFromRow(row as AssetRow)
}

export function updateAsset(db: DB, id: string, patch: Partial<OptionalId<ProjectAsset>>): ProjectAsset | undefined {
  const [row] = updateRows(db, projectAssets, normalizePatch(patch)).where(eq(projectAssets.id, id)).returning().all()
  return row ? assetFromRow(row as AssetRow) : undefined
}

export function deleteAsset(db: DB, id: string): void {
  db.delete(projectAssets).where(eq(projectAssets.id, id)).run()
}
