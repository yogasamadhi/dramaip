import type { Shot, ShotStillCandidate, ShotVisualAssetLock, VisualAssetVersion } from './types'

export type VisualContinuitySeverity = 'warning' | 'blocking'
export type VisualContinuityKind = 'missing_lock' | 'stale_lock' | 'superseded_version' | 'missing_still' | 'stale_still' | 'aspect_ratio' | 'text_risk'

export interface VisualContinuityIssue {
  shotId: string
  kind: VisualContinuityKind
  severity: VisualContinuitySeverity
  message: string
  visualAssetVersionId?: string
}

export interface VisualContinuitySummary {
  checkedShots: number
  lockedShots: number
  stillCoveredShots: number
  staleShots: number
  issues: VisualContinuityIssue[]
}

/**
 * Deterministic, explainable preflight for manually imported or generated still frames.
 * It deliberately does not claim to recognize a face, costume color, or image text from pixels.
 */
export function analyzeVisualContinuity(input: {
  shots: Shot[]
  locks: ShotVisualAssetLock[]
  versions: VisualAssetVersion[]
  stillCandidates?: ShotStillCandidate[]
  requiredRoles?: string[]
}): VisualContinuitySummary {
  const requiredRoles = input.requiredRoles ?? ['character', 'scene']
  const locksByShot = new Map<string, ShotVisualAssetLock[]>()
  for (const lock of input.locks) locksByShot.set(lock.shotId, [...(locksByShot.get(lock.shotId) ?? []), lock])
  const versionsById = new Map(input.versions.map((version) => [version.id, version]))
  const stillsByShot = new Map<string, ShotStillCandidate[]>()
  for (const candidate of input.stillCandidates ?? []) stillsByShot.set(candidate.shotId, [...(stillsByShot.get(candidate.shotId) ?? []), candidate])
  const issues: VisualContinuityIssue[] = []
  let lockedShots = 0
  let stillCoveredShots = 0
  const staleShotIds = new Set<string>()
  for (const shot of input.shots) {
    const locks = locksByShot.get(shot.id) ?? []
    if (locks.length) lockedShots++
    for (const role of requiredRoles) {
      if (!locks.some((lock) => lock.role === role)) issues.push({ shotId: shot.id, kind: 'missing_lock', severity: 'warning', message: `镜头 ${shot.shotNumber} 未锁定${roleLabel(role)}版本。` })
    }
    for (const lock of locks) {
      const version = versionsById.get(lock.visualAssetVersionId)
      if (lock.staleReason) {
        staleShotIds.add(shot.id)
        issues.push({ shotId: shot.id, kind: 'stale_lock', severity: 'blocking', message: `镜头 ${shot.shotNumber}：${lock.staleReason}`, visualAssetVersionId: lock.visualAssetVersionId })
      } else if (!version || version.status === 'superseded' || version.status === 'rejected') {
        issues.push({ shotId: shot.id, kind: 'superseded_version', severity: 'blocking', message: `镜头 ${shot.shotNumber} 锁定的${roleLabel(lock.role)}版本已不可作为当前生产基线。`, visualAssetVersionId: lock.visualAssetVersionId })
      }
    }
    const stills = stillsByShot.get(shot.id) ?? []
    const adoptedStills = stills.filter((candidate) => candidate.status === 'adopted')
    if (adoptedStills.length) stillCoveredShots++
    else issues.push({ shotId: shot.id, kind: 'missing_still', severity: 'warning', message: `镜头 ${shot.shotNumber} 尚未采用分镜静帧、首帧、尾帧或封面候选。` })
    for (const candidate of adoptedStills) {
      if (candidate.staleReason) {
        staleShotIds.add(shot.id)
        issues.push({ shotId: shot.id, kind: 'stale_still', severity: 'blocking', message: `镜头 ${shot.shotNumber} 的${stillLabel(candidate.kind)}“${candidate.label}”需复核：${candidate.staleReason}` })
      }
    }
    const text = `${shot.visualDescription} ${shot.imagePrompt ?? ''} ${shot.coverPrompt ?? ''}`
    if (/横屏|16:9|landscape/i.test(text)) issues.push({ shotId: shot.id, kind: 'aspect_ratio', severity: 'warning', message: `镜头 ${shot.shotNumber} 包含横屏/16:9 指令，请确认与竖屏交付一致。` })
    if (/文字|字幕|logo|watermark|signage/i.test(text)) issues.push({ shotId: shot.id, kind: 'text_risk', severity: 'warning', message: `镜头 ${shot.shotNumber} 含画面文字风险，需人工检查乱码、Logo 与平台标识。` })
  }
  return { checkedShots: input.shots.length, lockedShots, stillCoveredShots, staleShots: staleShotIds.size, issues }
}

function stillLabel(kind: ShotStillCandidate['kind']): string {
  return ({ still: '分镜静帧', first_frame: '首帧', last_frame: '尾帧', cover: '封面' } as Record<ShotStillCandidate['kind'], string>)[kind]
}

function roleLabel(role: string): string {
  return ({ character: '角色外观', costume: '服装阶段', scene: '场景布局', style: '布光/色彩', prop: '关键道具', voice: '声音参考' } as Record<string, string>)[role] ?? role
}
