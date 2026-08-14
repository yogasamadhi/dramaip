import type { ImageGenerationInput } from './image-production'
import type { Shot, ShotStillCandidate, ShotStillKind, ShotVisualAssetLock, VisualAssetVersion } from './types'

export type ShotStillBatchMode = 'missing_only' | 'selected'

export interface ShotStillTaskPreview {
  shotId: string
  shotNumber: number
  kind: ShotStillKind
  sourceFingerprint: string
  input: ImageGenerationInput
  lockedVisualVersions: Array<{ role: string; label: string; versionNumber: number }>
  /** A billable provider has no verified local price card, so the UI must not invent an amount. */
  estimatedCost: { status: 'unknown'; reason: string }
  outputPolicy: 'create_candidate_never_overwrite_adopted'
}

export interface ShotStillBatchPlan {
  mode: ShotStillBatchMode
  planned: ShotStillTaskPreview[]
  skipped: Array<{ shotId: string; kind: ShotStillKind; reason: string }>
}

const DEFAULT_KINDS: ShotStillKind[] = ['still', 'first_frame']

/**
 * Builds renderer-safe, reviewable image task inputs from the current storyboard.
 * This is deliberately a planner: a provider submission must be performed only by a
 * separately verified, archived image runtime. The plan itself never mutates assets.
 */
export function planShotStillBatch(input: {
  shots: Shot[]
  candidates: ShotStillCandidate[]
  locks: ShotVisualAssetLock[]
  versions: VisualAssetVersion[]
  mode: ShotStillBatchMode
  selectedShotIds?: string[]
  kinds?: ShotStillKind[]
}): ShotStillBatchPlan {
  const kinds = input.kinds?.length ? input.kinds : DEFAULT_KINDS
  const selectedIds = new Set(input.selectedShotIds ?? [])
  const candidatesByShot = new Map<string, ShotStillCandidate[]>()
  for (const candidate of input.candidates) candidatesByShot.set(candidate.shotId, [...(candidatesByShot.get(candidate.shotId) ?? []), candidate])
  const planned: ShotStillTaskPreview[] = []
  const skipped: ShotStillBatchPlan['skipped'] = []
  for (const shot of input.shots) {
    if (input.mode === 'selected' && !selectedIds.has(shot.id)) continue
    for (const kind of kinds) {
      const hasAdopted = (candidatesByShot.get(shot.id) ?? []).some((candidate) => candidate.kind === kind && candidate.status === 'adopted')
      if (input.mode === 'missing_only' && hasAdopted) {
        skipped.push({ shotId: shot.id, kind, reason: '该镜头已有同类已采用静帧；批量计划不会覆盖。' })
        continue
      }
      planned.push(buildShotStillTaskPreview({ shot, kind, locks: input.locks, versions: input.versions }))
    }
  }
  return { mode: input.mode, planned, skipped }
}

export function buildShotStillTaskPreview(input: {
  shot: Shot
  kind: ShotStillKind
  locks: ShotVisualAssetLock[]
  versions: VisualAssetVersion[]
}): ShotStillTaskPreview {
  const versionsById = new Map(input.versions.map((version) => [version.id, version]))
  const lockedVisualVersions = input.locks
    .filter((lock) => lock.shotId === input.shot.id && !lock.staleReason)
    .flatMap((lock) => {
      const version = versionsById.get(lock.visualAssetVersionId)
      return version ? [{ role: lock.role, label: version.label, versionNumber: version.versionNumber }] : []
    })
  const kindLabel = stillKindLabel(input.kind)
  const promptBase = input.kind === 'cover' ? input.shot.coverPrompt : input.shot.imagePrompt
  const prompt = [
    `竖屏 9:16 AI 漫剧${kindLabel}。`,
    `镜头描述：${input.shot.visualDescription}`,
    promptBase?.trim() ? `画面提示：${promptBase.trim()}` : undefined,
    input.shot.videoPrompt.trim() ? `视频镜头约束：${input.shot.videoPrompt.trim()}` : undefined,
    lockedVisualVersions.length
      ? `已锁定视觉基线（仅作一致性约束，不上传参考图）：${lockedVisualVersions.map((version) => `${roleLabel(version.role)}=${version.label} v${version.versionNumber}`).join('；')}`
      : undefined,
    '不要生成可读文字、平台 Logo、水印或边框；保持角色、服装、关键道具和场景布局与锁定基线一致。',
  ].filter(Boolean).join('\n')
  return {
    shotId: input.shot.id,
    shotNumber: input.shot.shotNumber,
    kind: input.kind,
    sourceFingerprint: input.shot.updatedAt,
    input: { prompt, size: '1024x1536', quality: 'medium', outputFormat: 'png' },
    lockedVisualVersions,
    estimatedCost: { status: 'unknown', reason: '当前没有已验证的图片供应商价目与归档通道；此处只显示任务输入，不提交计费请求。' },
    outputPolicy: 'create_candidate_never_overwrite_adopted',
  }
}

export function stillKindLabel(kind: ShotStillKind): string {
  return ({ still: '分镜静帧', first_frame: '视频首帧', last_frame: '视频尾帧', cover: '镜头封面' } as Record<ShotStillKind, string>)[kind]
}

function roleLabel(role: string): string {
  return ({ character: '角色外观', costume: '服装', scene: '场景', style: '风格', prop: '道具', voice: '声音' } as Record<string, string>)[role] ?? role
}
