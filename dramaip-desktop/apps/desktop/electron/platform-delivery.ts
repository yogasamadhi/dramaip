import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import {
  BUILT_IN_PLATFORM_DELIVERY_PROFILES,
  evaluatePlatformDeliveryPreflight,
  safeFilename,
  type DeliveryCreativeVariant,
  type EpisodeQualityReport,
  type PlatformDeliveryPreflight,
  type PlatformDeliveryProfile,
} from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { listEpisodeComplianceHistory, type EpisodeComplianceInput } from './episode-compliance'

export interface PlatformDeliveryInput {
  projectId: string
  adaptationProjectId: string
  episodeId: string
  profileId: string
  creativeVariantId: string
  complianceTaskId: string
  manualFieldsConfirmed: boolean
}

interface PreparedPlatformDelivery {
  ok: true
  input: PlatformDeliveryInput
  profile: PlatformDeliveryProfile
  variant: DeliveryCreativeVariant
  compliance: { taskId: string; mp4Path: string; manifestPath: string; sourceFingerprint: string }
  render: { srtPath: string; vttPath?: string }
  quality: { report: EpisodeQualityReport; reportPath?: string }
  coverPath: string
  preflight: PlatformDeliveryPreflight
}

export interface PlatformDeliveryPackageInput {
  directory: string
  deliveryVersion: number
  profile: PlatformDeliveryProfile
  variant: DeliveryCreativeVariant
  compliance: { taskId: string; mp4Path: string; manifestPath: string }
  render: { srtPath: string; vttPath?: string }
  quality: { report: EpisodeQualityReport; reportPath?: string }
  coverPath: string
  sourceFingerprint: string
  manualFieldsConfirmed: boolean
  rights: unknown
  finalBaseName?: string
}

export interface PlatformDeliveryPackageArchive {
  manifestPath: string
  checksumsPath: string
  files: Record<string, string | undefined>
}

export function listPlatformDeliveryProfiles(): PlatformDeliveryProfile[] { return BUILT_IN_PLATFORM_DELIVERY_PROFILES }

export async function preflightPlatformDelivery(repos: Repositories, input: PlatformDeliveryInput): Promise<PlatformDeliveryPreflight> {
  const prepared = await preparePlatformDelivery(repos, input)
  return prepared.preflight
}

export async function exportPlatformDelivery(repos: Repositories, input: PlatformDeliveryInput) {
  const prepared = await preparePlatformDelivery(repos, input)
  if (!prepared.ok) return { ok: false, error: prepared.error, preflight: prepared.preflight }
  let deliveryVersion = repos.platformDelivery.nextPlatformDeliveryVersion(repos.db, input.episodeId, prepared.profile.id)
  let directory = join(dirname(prepared.compliance.mp4Path), 'platform-deliveries', safeFilename(prepared.profile.id), `delivery-v${String(deliveryVersion).padStart(3, '0')}-${safeFilename(input.complianceTaskId)}`)
  try {
    // A failed run can leave an inspectable orphan directory. Never reuse it or overwrite files;
    // advance to a fresh delivery version before assembling the next package.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await mkdir(directory, { recursive: false })
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt === 99) throw error
        deliveryVersion += 1
        directory = join(dirname(prepared.compliance.mp4Path), 'platform-deliveries', safeFilename(prepared.profile.id), `delivery-v${String(deliveryVersion).padStart(3, '0')}-${safeFilename(input.complianceTaskId)}`)
      }
    }
    const rights = repos.rights.preflightProjectRights(repos.db, { projectId: input.projectId, platform: prepared.profile.platform, region: prepared.profile.region })
    const packageArchive = await writePlatformDeliveryPackage({
      directory, deliveryVersion, profile: prepared.profile, variant: prepared.variant, compliance: prepared.compliance,
      render: prepared.render, quality: prepared.quality, coverPath: prepared.coverPath,
      sourceFingerprint: prepared.preflight.sourceFingerprint!, manualFieldsConfirmed: input.manualFieldsConfirmed, rights,
      finalBaseName: prepared.preflight.finalBaseName,
    })
    const archive = repos.platformDelivery.createPlatformDeliveryExport(repos.db, {
      projectId: input.projectId, adaptationProjectId: input.adaptationProjectId, episodeId: input.episodeId,
      profileId: prepared.profile.id, profileVersion: prepared.profile.version, creativeVariantId: prepared.variant.id,
      complianceTaskId: prepared.compliance.taskId, deliveryVersion, outputDirectory: directory, manifestPath: packageArchive.manifestPath,
      sourceFingerprint: prepared.preflight.sourceFingerprint!,
    })
    return { ok: true, archive, preflight: prepared.preflight }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), preflight: prepared.preflight }
  }
}

/** Writes a self-contained, checksum-addressable handoff folder after the caller reserved a fresh directory. */
export async function writePlatformDeliveryPackage(input: PlatformDeliveryPackageInput): Promise<PlatformDeliveryPackageArchive> {
  const baseName = input.finalBaseName ?? safeFilename(input.variant.title)
  const files = {
    mp4: join(input.directory, `${baseName}.mp4`),
    srt: join(input.directory, `${baseName}.srt`),
    vtt: input.render.vttPath ? join(input.directory, `${baseName}.vtt`) : undefined,
    cover: join(input.directory, `${baseName}-cover${extname(input.coverPath).toLowerCase() || '.jpg'}`),
    listingJson: join(input.directory, 'listing.json'),
    listingMarkdown: join(input.directory, 'listing.md'),
    rights: join(input.directory, 'rights-preflight.json'),
    compliance: join(input.directory, 'compliance-manifest.json'),
    quality: join(input.directory, 'quality-report.json'),
    manifest: join(input.directory, 'delivery-manifest.json'),
    checksums: join(input.directory, 'checksums.sha256'),
  }
  await Promise.all([copyFile(input.compliance.mp4Path, files.mp4), copyFile(input.render.srtPath, files.srt), copyFile(input.coverPath, files.cover), copyFile(input.compliance.manifestPath, files.compliance)])
  if (input.render.vttPath) await copyFile(input.render.vttPath, files.vtt!)
  if (input.quality.reportPath) await copyFile(input.quality.reportPath, files.quality)
  else await writeFile(files.quality, JSON.stringify(input.quality.report, null, 2), 'utf8')
  const listing = { profile: profileSnapshot(input.profile), creativeVariant: creativeSnapshot(input.variant), manualFieldsConfirmed: input.manualFieldsConfirmed, manualFields: input.profile.manualFields }
  await Promise.all([
    writeFile(files.listingJson, JSON.stringify(listing, null, 2), 'utf8'),
    writeFile(files.listingMarkdown, renderListingMarkdown(listing), 'utf8'),
    writeFile(files.rights, JSON.stringify(input.rights, null, 2) ?? 'null', 'utf8'),
  ])
  const sourceFiles = Object.values(files).filter((path): path is string => Boolean(path && path !== files.manifest && path !== files.checksums))
  const checksums = await checksumsFor(sourceFiles)
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    deliveryVersion: input.deliveryVersion,
    profile: profileSnapshot(input.profile),
    creativeVariant: creativeSnapshot(input.variant),
    complianceTaskId: input.compliance.taskId,
    sourceFingerprint: input.sourceFingerprint,
    files: Object.fromEntries(Object.entries(files).filter(([key]) => key !== 'checksums').map(([key, value]) => [key, value ? basename(value) : undefined])),
    checksums,
    manualFieldsConfirmed: input.manualFieldsConfirmed,
    manualFields: input.profile.manualFields,
    note: '本包用于人工上传或外部精剪；应用不会登录、代投或自动发布到平台。',
  }
  await writeFile(files.manifest, JSON.stringify(manifest, null, 2), 'utf8')
  const checksumText = await checksumLines([...sourceFiles, files.manifest])
  await writeFile(files.checksums, checksumText, 'utf8')
  return { manifestPath: files.manifest, checksumsPath: files.checksums, files }
}

async function preparePlatformDelivery(repos: Repositories, input: PlatformDeliveryInput): Promise<PreparedPlatformDelivery | { ok: false; error: string; preflight: PlatformDeliveryPreflight }> {
  const profile = BUILT_IN_PLATFORM_DELIVERY_PROFILES.find((item) => item.id === input.profileId)
  const variant = repos.platformDelivery.getDeliveryCreativeVariant(repos.db, input.creativeVariantId)
  const base = (overrides: Partial<PlatformDeliveryPreflight> = {}): PlatformDeliveryPreflight => ({ ok: false, blockers: [], warnings: [], expectedFiles: [], profile, ...overrides })
  if (!profile) return { ok: false, error: '未找到平台交付 Profile。', preflight: base({ blockers: ['未找到平台交付 Profile。'] }) }
  if (!variant || variant.projectId !== input.projectId || variant.adaptationProjectId !== input.adaptationProjectId) return { ok: false, error: '创意候选不属于当前项目。', preflight: base({ blockers: ['创意候选不属于当前项目。'] }) }
  const history = await listEpisodeComplianceHistory(repos, { projectId: input.projectId, adaptationProjectId: input.adaptationProjectId, episodeId: input.episodeId })
  const selected = history.find((item) => item.task.id === input.complianceTaskId)
  const compliance = complianceArchive(selected?.task.output)
  const complianceInput = complianceInputFromTask(selected?.task.input)
  const render = renderArchiveFromTask(repos.longTask.getLongTask(repos.db, complianceInput?.renderTaskId ?? '')?.output)
  const qualityTask = repos.longTask.getLongTask(repos.db, complianceInput?.qualityTaskId ?? '')
  const quality = qualityReportFromTask(qualityTask?.output)
  const cover = variant.coverAssetId ? repos.asset.getAsset(repos.db, variant.coverAssetId) : undefined
  const coverAvailable = Boolean(cover && cover.projectId === input.projectId && cover.status === 'available' && cover.localPath)
  const currentCompliance = Boolean(selected && selected.task.status === 'success' && !selected.stale && compliance)
  const media = quality?.report.inspection ?? {}
  const evaluation = evaluatePlatformDeliveryPreflight({ profile, title: variant.title, description: variant.description, tags: variant.tags, hasCover: coverAvailable, complianceCurrent: currentCompliance, media, manualFieldsConfirmed: input.manualFieldsConfirmed })
  if (variant.status !== 'adopted') evaluation.blockers.push('请先采用一个标题/封面/简介/标签候选；候选草稿不会静默成为发布文案。')
  if (!render?.srtPath) evaluation.blockers.push('当前渲染归档缺少 SRT 字幕，不能生成完整平台交付包。')
  if (!quality || quality.report.blockerCount > 0) evaluation.blockers.push('当前媒体质检报告不可用或仍有 blocker。')
  if (!compliance || !await exists(compliance.mp4Path) || !await exists(compliance.manifestPath)) evaluation.blockers.push('当前合规 MP4 或合规 Manifest 不存在，不能创建发布包。')
  if (render?.srtPath && !await exists(render.srtPath)) evaluation.blockers.push('当前 SRT 字幕文件不存在。')
  if (cover?.localPath && !await exists(cover.localPath)) evaluation.blockers.push('封面文件不存在。')
  const sourceFingerprint = compliance && quality ? [`platform-delivery:v1`, `compliance:${selected?.task.id}:${compliance.sourceFingerprint}`, `profile:${profile.id}@${profile.version}`, `creative:${variant.id}@${variant.versionNumber}:${variant.updatedAt}`, `manual:${input.manualFieldsConfirmed}`].join('|') : undefined
  const preflight: PlatformDeliveryPreflight = { ...evaluation, ok: evaluation.blockers.length === 0, profile, sourceFingerprint, complianceTaskId: selected?.task.id, media }
  if (!preflight.ok || !compliance || !render?.srtPath || !quality || !cover?.localPath || !selected) return { ok: false, error: preflight.blockers.join('；') || '平台交付预检未通过。', preflight }
  return { ok: true, input, profile, variant, compliance: { taskId: selected.task.id, ...compliance }, render, quality, coverPath: cover.localPath, preflight }
}

function complianceArchive(value: Record<string, unknown> | undefined): { mp4Path: string; manifestPath: string; sourceFingerprint: string } | undefined {
  const archive = value?.archive
  if (!archive || typeof archive !== 'object') return undefined
  const row = archive as Record<string, unknown>
  return typeof row.mp4Path === 'string' && typeof row.manifestPath === 'string' && typeof row.sourceFingerprint === 'string' ? { mp4Path: row.mp4Path, manifestPath: row.manifestPath, sourceFingerprint: row.sourceFingerprint } : undefined
}

function renderArchiveFromTask(value: Record<string, unknown> | undefined): { srtPath: string; vttPath?: string } | undefined {
  const archive = value?.archive
  if (!archive || typeof archive !== 'object') return undefined
  const row = archive as Record<string, unknown>
  return typeof row.srtPath === 'string' ? { srtPath: row.srtPath, vttPath: typeof row.vttPath === 'string' ? row.vttPath : undefined } : undefined
}

function qualityReportFromTask(value: Record<string, unknown> | undefined): { report: EpisodeQualityReport; reportPath?: string } | undefined {
  const report = value?.report
  if (!report || typeof report !== 'object' || (report as { schemaVersion?: unknown }).schemaVersion !== 1) return undefined
  const reportPath = typeof value?.reportPath === 'string' ? value.reportPath : undefined
  return { report: report as EpisodeQualityReport, reportPath }
}

function complianceInputFromTask(value: Record<string, unknown> | undefined): Pick<EpisodeComplianceInput, 'renderTaskId' | 'qualityTaskId'> | undefined {
  const candidate = value?.episodeCompliance
  if (!candidate || typeof candidate !== 'object') return undefined
  const row = candidate as Record<string, unknown>
  return typeof row.renderTaskId === 'string' && typeof row.qualityTaskId === 'string' ? { renderTaskId: row.renderTaskId, qualityTaskId: row.qualityTaskId } : undefined
}

async function exists(path: string): Promise<boolean> { try { await access(path); return true } catch { return false } }

async function checksumsFor(paths: string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [basename(path), await hashFile(path)])))
}

async function checksumLines(paths: string[]): Promise<string> {
  return (await Promise.all(paths.map(async (path) => `${await hashFile(path)}  ${basename(path)}`))).join('\n') + '\n'
}

async function hashFile(path: string): Promise<string> { return `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}` }
function profileSnapshot(profile: PlatformDeliveryProfile) { return { id: profile.id, version: profile.version, title: profile.title, platform: profile.platform, region: profile.region, sourceUrl: profile.sourceUrl, sourceStatus: profile.sourceStatus, checkedAt: profile.checkedAt, video: profile.video, duration: profile.duration, subtitleSafeZone: profile.subtitleSafeZone } }
function creativeSnapshot(variant: DeliveryCreativeVariant) { return { id: variant.id, versionNumber: variant.versionNumber, label: variant.label, title: variant.title, description: variant.description, tags: variant.tags, coverAssetId: variant.coverAssetId, source: variant.source } }
function renderListingMarkdown(input: { profile: ReturnType<typeof profileSnapshot>; creativeVariant: ReturnType<typeof creativeSnapshot>; manualFieldsConfirmed: boolean; manualFields: string[] }): string { return [`# ${input.creativeVariant.title}`, '', input.creativeVariant.description, '', `标签：${input.creativeVariant.tags.join('、')}`, `Profile：${input.profile.title} (${input.profile.version})`, `人工核对：${input.manualFieldsConfirmed ? '已确认' : '未确认'}`, ...input.manualFields.map((field) => `- ${field}`), ''].join('\n') }
