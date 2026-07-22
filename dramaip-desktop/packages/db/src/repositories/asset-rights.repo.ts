import { desc, eq } from 'drizzle-orm'
import type {
  AssetPermittedUse,
  AssetRightsRecord,
  AssetRightsStatus,
  AssetRightsType,
  ProjectAsset,
  RightsPreflightInput,
  RightsPreflightIssue,
  RightsPreflightResult,
} from '@sdns/core'
import type { DB } from '../client'
import { assetRightsRecords } from '../schema'
import { getAsset, listProjectAssets } from './project-asset.repo'
import { genId, insertRow, now, parseJsonArray, stringifyArray, updateRows } from './util'

type RightsRow = typeof assetRightsRecords.$inferSelect

function recordFromRow(row: RightsRow): AssetRightsRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    assetId: row.assetId,
    rightsholder: row.rightsholder ?? undefined,
    source: row.source ?? undefined,
    rightsTypes: parseJsonArray(row.rightsTypes) as AssetRightsType[],
    permittedUses: parseJsonArray(row.permittedUses) as AssetPermittedUse[],
    platforms: parseJsonArray(row.platforms),
    regions: parseJsonArray(row.regions),
    validFrom: row.validFrom ?? undefined,
    validUntil: row.validUntil ?? undefined,
    evidenceAssetId: row.evidenceAssetId ?? undefined,
    evidenceSha256: row.evidenceSha256 ?? undefined,
    aiGenerated: row.aiGenerated,
    status: row.status as AssetRightsStatus,
    reviewedAt: row.reviewedAt ?? undefined,
    reviewNote: row.reviewNote ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function normalizePatch(patch: Partial<AssetRightsRecord>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch, updatedAt: now() }
  if (Array.isArray(out.rightsTypes)) out.rightsTypes = stringifyArray(out.rightsTypes as string[])
  if (Array.isArray(out.permittedUses)) out.permittedUses = stringifyArray(out.permittedUses as string[])
  if (Array.isArray(out.platforms)) out.platforms = stringifyArray(out.platforms as string[])
  if (Array.isArray(out.regions)) out.regions = stringifyArray(out.regions as string[])
  return out
}

export function listAssetRightsByProject(db: DB, projectId: string): AssetRightsRecord[] {
  return db.select().from(assetRightsRecords).where(eq(assetRightsRecords.projectId, projectId)).orderBy(desc(assetRightsRecords.updatedAt)).all().map((row) => recordFromRow(row as RightsRow))
}

export function getAssetRightsByAsset(db: DB, assetId: string): AssetRightsRecord | undefined {
  const row = db.select().from(assetRightsRecords).where(eq(assetRightsRecords.assetId, assetId)).get()
  return row ? recordFromRow(row as RightsRow) : undefined
}

export function createAssetRightsRecord(
  db: DB,
  data: Partial<Omit<AssetRightsRecord, 'id' | 'createdAt' | 'updatedAt'>> & { projectId: string; assetId: string },
): AssetRightsRecord {
  const ts = now()
  const [row] = insertRow(db, assetRightsRecords, {
    id: genId(),
    projectId: data.projectId,
    assetId: data.assetId,
    rightsholder: data.rightsholder ?? null,
    source: data.source ?? null,
    rightsTypes: stringifyArray(data.rightsTypes ?? []),
    permittedUses: stringifyArray(data.permittedUses ?? []),
    platforms: stringifyArray(data.platforms ?? []),
    regions: stringifyArray(data.regions ?? []),
    validFrom: data.validFrom ?? null,
    validUntil: data.validUntil ?? null,
    evidenceAssetId: data.evidenceAssetId ?? null,
    evidenceSha256: data.evidenceSha256 ?? null,
    aiGenerated: data.aiGenerated ?? false,
    status: data.status ?? 'unknown',
    reviewedAt: data.reviewedAt ?? null,
    reviewNote: data.reviewNote ?? null,
    createdAt: ts,
    updatedAt: ts,
  })
  return recordFromRow(row as RightsRow)
}

export function updateAssetRightsRecord(db: DB, id: string, patch: Partial<AssetRightsRecord>): AssetRightsRecord | undefined {
  const [row] = updateRows(db, assetRightsRecords, normalizePatch(patch)).where(eq(assetRightsRecords.id, id)).returning().all()
  return row ? recordFromRow(row as RightsRow) : undefined
}

export function upsertAssetRightsRecord(
  db: DB,
  data: Partial<Omit<AssetRightsRecord, 'id' | 'createdAt' | 'updatedAt'>> & { projectId: string; assetId: string },
): AssetRightsRecord {
  const existing = getAssetRightsByAsset(db, data.assetId)
  return existing ? updateAssetRightsRecord(db, existing.id, data) ?? existing : createAssetRightsRecord(db, data)
}

/** Final delivery checks are deliberately conservative: draft work stays available, delivery never infers rights. */
export function preflightProjectRights(db: DB, input: RightsPreflightInput): RightsPreflightResult {
  const deliveryAt = input.deliveryAt ?? new Date().toISOString().slice(0, 10)
  const assets = listProjectAssets(db, input.projectId).filter(isRightsScopedAsset)
  const records = new Map(listAssetRightsByProject(db, input.projectId).map((record) => [record.assetId, record]))
  const blockers: RightsPreflightIssue[] = []
  const warnings: RightsPreflightIssue[] = []
  let verifiedAssetCount = 0

  for (const asset of assets) {
    const record = records.get(asset.id)
    if (!record) {
      blockers.push(issue(asset, 'missing_record', '缺少权利台账；草稿可继续，最终交付已阻止。'))
      continue
    }
    if (record.status !== 'verified') {
      blockers.push(issue(asset, `status_${record.status}`, `权利状态为“${statusLabel(record.status)}”，不能作为最终交付依据。`))
      continue
    }
    const evidence = record.evidenceAssetId ? getAsset(db, record.evidenceAssetId) : undefined
    if (!evidence || evidence.projectId !== input.projectId || evidence.kind !== 'rights_evidence' || evidence.status !== 'available' || !record.evidenceSha256 || evidence.sha256 !== record.evidenceSha256) {
      blockers.push(issue(asset, 'evidence_missing', '核验状态必须关联可用的本地证明文件及匹配 hash；当前证据缺失或已变化。'))
      continue
    }
    if ((record.validFrom && record.validFrom > deliveryAt) || (record.validUntil && record.validUntil < deliveryAt)) {
      blockers.push(issue(asset, 'out_of_term', `授权期限不覆盖交付日期 ${deliveryAt}。`))
      continue
    }
    const requiredUses = requiredUsesFor(asset)
    const absentUses = requiredUses.filter((use) => !record.permittedUses.includes(use))
    if (absentUses.length) {
      blockers.push(issue(asset, 'use_not_permitted', `未明确允许：${absentUses.map(useLabel).join('、')}。`))
      continue
    }
    if (record.aiGenerated && !record.rightsTypes.includes('provider_terms')) {
      blockers.push(issue(asset, 'provider_terms_missing', 'AI 生成资产缺少 Provider 条款/使用权记录。'))
      continue
    }
    if (input.platform && !scopeContains(record.platforms, input.platform)) {
      blockers.push(issue(asset, 'platform_mismatch', `授权范围未覆盖目标平台：${input.platform}。`))
      continue
    }
    if (input.region && !scopeContains(record.regions, input.region)) {
      blockers.push(issue(asset, 'region_mismatch', `授权范围未覆盖目标地区：${input.region}。`))
      continue
    }
    verifiedAssetCount += 1
    if (!record.rightsholder?.trim() || !record.source?.trim()) warnings.push(issue(asset, 'attribution_incomplete', '已核验证据，但权利人或来源说明不完整。', 'warning'))
  }
  return { projectId: input.projectId, platform: input.platform, region: input.region, deliveryAt, status: blockers.length ? 'blocked' : 'pass', reviewedAssetCount: assets.length, verifiedAssetCount, blockers, warnings }
}

export function assertReferenceAssetRights(db: DB, projectId: string | undefined, assets: ProjectAsset[]): void {
  if (!projectId) return
  for (const asset of assets.filter((item) => item.kind === 'character_reference' || item.kind === 'casting_reference')) {
    const record = getAssetRightsByAsset(db, asset.id)
    const hasRelease = asset.kind !== 'casting_reference' || Boolean(record?.rightsTypes.includes('talent_release'))
    const evidence = record?.evidenceAssetId ? getAsset(db, record.evidenceAssetId) : undefined
    const hasEvidence = Boolean(evidence && evidence.projectId === projectId && evidence.kind === 'rights_evidence' && evidence.status === 'available' && record?.evidenceSha256 && evidence.sha256 === record.evidenceSha256)
    if (!record || record.status !== 'verified' || !record.permittedUses.includes('generative') || !hasRelease || !hasEvidence) {
      throw new Error(`参考资产“${asset.title}”缺少已核验的生成授权${asset.kind === 'casting_reference' ? '或肖像授权' : ''}，不能提交。`)
    }
  }
}

function isRightsScopedAsset(asset: ProjectAsset): boolean {
  return !['rights_evidence', 'subtitle_file', 'other'].includes(asset.kind)
}

function requiredUsesFor(asset: ProjectAsset): AssetPermittedUse[] {
  if (asset.kind === 'source_media') return ['commercial', 'adaptation']
  if (asset.kind === 'voice_reference') return ['commercial', 'voice_cloning']
  if (['character_reference', 'casting_reference', 'scene_reference', 'style_reference', 'first_frame_image', 'cover_image'].includes(asset.kind)) return ['commercial', 'generative']
  return ['commercial']
}

function scopeContains(values: string[], expected: string): boolean {
  return values.some((value) => ['all', '全部', '*'].includes(value.trim().toLowerCase()) || value.trim().toLowerCase() === expected.trim().toLowerCase())
}

function issue(asset: ProjectAsset, code: string, message: string, severity: RightsPreflightIssue['severity'] = 'blocker'): RightsPreflightIssue {
  return { assetId: asset.id, assetTitle: asset.title, severity, code, message }
}

function statusLabel(status: AssetRightsStatus): string {
  return ({ verified: '已核验', declared: '已声明', unknown: '未知', expired: '已过期', restricted: '受限' } as const)[status]
}

function useLabel(use: AssetPermittedUse): string {
  return ({ commercial: '商业使用', adaptation: '改编', generative: '生成/参考使用', voice_cloning: '声音复刻' } as const)[use]
}
