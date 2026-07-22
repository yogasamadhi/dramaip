import type { EpisodeRenderPlan } from './episode-render'

/** The analyzer reports observable delivery defects; it never pretends to judge artistic quality. */
export type EpisodeQualitySeverity = 'blocker' | 'warning' | 'info'
export type EpisodeQualityTargetKind = 'delivery' | 'shot' | 'audio' | 'subtitle' | 'continuity'
export type EpisodeQualityIssueKind =
  | 'missing_delivery'
  | 'corrupt_media'
  | 'duration_mismatch'
  | 'resolution_mismatch'
  | 'missing_audio'
  | 'black_frames'
  | 'frozen_frames'
  | 'silence'
  | 'clipping'
  | 'loudness'
  | 'placeholder_visual'
  | 'missing_shot'
  | 'subtitle_overlap'
  | 'subtitle_bounds'
  | 'subtitle_safe_area'
  | 'dialogue_subtitle_timing'
  | 'continuity'
  | 'lip_sync_unavailable'

export interface EpisodeQualityInterval {
  startSeconds: number
  endSeconds: number
}

/** Parsed from local FFmpeg output. Undefined means the tool could not measure it, never a pass. */
export interface EpisodeMediaInspection {
  readable: boolean
  durationSeconds?: number
  width?: number
  height?: number
  hasVideo?: boolean
  hasAudio?: boolean
  readErrors?: string[]
  blackIntervals?: EpisodeQualityInterval[]
  frozenIntervals?: EpisodeQualityInterval[]
  silenceIntervals?: EpisodeQualityInterval[]
  integratedLufs?: number
  maxVolumeDb?: number
}

export interface EpisodeContinuityFinding {
  shotId: string
  severity: 'warning' | 'blocking'
  kind: string
  message: string
}

export interface EpisodeQualityIssue {
  id: string
  kind: EpisodeQualityIssueKind
  severity: EpisodeQualitySeverity
  title: string
  detail: string
  targetKind: EpisodeQualityTargetKind
  targetId?: string
  startSeconds?: number
  endSeconds?: number
  /** A minimal redo plan may contain multiple affected shots for one media interval. */
  affectedShotIds?: string[]
}

export interface EpisodeMinimalRedoTarget {
  kind: 'shot' | 'audio' | 'subtitle' | 'delivery'
  targetId?: string
  issueIds: string[]
  reason: string
}

export interface EpisodeQualityReport {
  schemaVersion: 1
  renderTaskId: string
  renderSourceFingerprint: string
  sourceFingerprint: string
  deliveryVersion: string
  generatedAt: string
  inspection: EpisodeMediaInspection
  issues: EpisodeQualityIssue[]
  redoTargets: EpisodeMinimalRedoTarget[]
  blockerCount: number
  warningCount: number
  /** Kept explicit so UI and exports never claim pixel-level lip-sync detection. */
  limitations: string[]
}

export function buildEpisodeQualitySourceFingerprint(input: {
  renderTaskId: string
  renderSourceFingerprint: string
  currentPlanFingerprint?: string
}): string {
  return [
    'episode-quality:v1',
    `render:${input.renderTaskId}`,
    `render-source:${input.renderSourceFingerprint}`,
    `current-plan:${input.currentPlanFingerprint ?? 'unavailable'}`,
  ].join('|')
}

export function analyzeEpisodeQuality(input: {
  renderTaskId: string
  renderSourceFingerprint: string
  currentPlanFingerprint?: string
  plan: EpisodeRenderPlan
  inspection: EpisodeMediaInspection
  continuity?: EpisodeContinuityFinding[]
  generatedAt?: string
}): EpisodeQualityReport {
  const issues: EpisodeQualityIssue[] = []
  const { plan, inspection } = input
  const add = (issue: Omit<EpisodeQualityIssue, 'id'>) => {
    const location = issue.targetId ?? `${issue.startSeconds ?? ''}-${issue.endSeconds ?? ''}`
    issues.push({ ...issue, id: `episode-quality:${input.renderTaskId}:${issue.kind}:${issue.targetKind}:${location}` })
  }

  if (!inspection.readable) {
    add({
      kind: 'corrupt_media', severity: 'blocker', title: '成片文件无法完整读取',
      detail: inspection.readErrors?.join('；') || 'FFmpeg 无法读取该交付文件。', targetKind: 'delivery',
    })
  }
  if (!inspection.hasVideo) {
    add({ kind: 'missing_delivery', severity: 'blocker', title: '成片缺少视频流', detail: '交付文件不包含可播放视频流。', targetKind: 'delivery' })
  }
  if (!inspection.hasAudio) {
    add({ kind: 'missing_audio', severity: 'blocker', title: '成片缺少正式音频', detail: '交付文件不包含可播放音频流，不能以静音占位交付。', targetKind: 'audio' })
  }
  if (inspection.width !== undefined && inspection.height !== undefined && (inspection.width !== 720 || inspection.height !== 1280)) {
    add({
      kind: 'resolution_mismatch', severity: 'blocker', title: '成片画幅或分辨率不符合竖屏交付',
      detail: `检测到 ${inspection.width}×${inspection.height}，交付基线要求 720×1280。`, targetKind: 'delivery',
    })
  }
  if (inspection.durationSeconds !== undefined && Math.abs(inspection.durationSeconds - plan.durationSeconds) > 0.5) {
    add({
      kind: 'duration_mismatch', severity: 'blocker', title: '成片时长与时间线不一致',
      detail: `时间线为 ${plan.durationSeconds.toFixed(2)} 秒，文件为 ${inspection.durationSeconds.toFixed(2)} 秒。`, targetKind: 'delivery',
    })
  }

  for (const clip of plan.visualClips) {
    if (clip.source.kind === 'missing') {
      add({ kind: 'missing_shot', severity: 'blocker', title: `镜头 ${clip.orderIndex + 1} 缺少画面素材`, detail: '时间线仍指向缺失画面，不能输出成片。', targetKind: 'shot', targetId: clip.shotId, startSeconds: clip.startSeconds, endSeconds: clip.startSeconds + clip.durationSeconds, affectedShotIds: [clip.shotId] })
    }
    if (/占位|placeholder|temp/i.test(clip.source.label ?? '')) {
      add({ kind: 'placeholder_visual', severity: 'blocker', title: `镜头 ${clip.orderIndex + 1} 疑似占位素材`, detail: `素材标签“${clip.source.label}”含占位标记，须替换为已审核素材。`, targetKind: 'shot', targetId: clip.shotId, startSeconds: clip.startSeconds, endSeconds: clip.startSeconds + clip.durationSeconds, affectedShotIds: [clip.shotId] })
    }
  }

  for (const interval of inspection.blackIntervals ?? []) {
    if (!isExpectedFadeInterval(plan, interval)) addIntervalIssue(add, plan, interval, 'black_frames', 'blocker', '检测到黑帧', '黑场会以失败镜头处理，须确认不是有意转场。')
  }
  for (const interval of inspection.frozenIntervals ?? []) {
    if (!isExpectedStillInterval(plan, interval)) addIntervalIssue(add, plan, interval, 'frozen_frames', 'blocker', '检测到冻结画面', '画面长时间无变化，须检查源视频或重新生成对应镜头。')
  }
  for (const interval of inspection.silenceIntervals ?? []) addIntervalIssue(add, plan, interval, 'silence', 'warning', '检测到较长静音', '请人工确认这段静音是否为叙事留白；若非预期，仅重做对应音频片段。', 'audio')

  if (inspection.maxVolumeDb !== undefined && inspection.maxVolumeDb >= -0.1) {
    add({ kind: 'clipping', severity: 'warning', title: '音频可能削波', detail: `检测到最大音量 ${inspection.maxVolumeDb.toFixed(1)} dBFS，接近或达到 0 dBFS。`, targetKind: 'audio' })
  }
  if (inspection.integratedLufs !== undefined && (inspection.integratedLufs < -18 || inspection.integratedLufs > -14)) {
    add({ kind: 'loudness', severity: 'warning', title: '综合响度偏离交付基线', detail: `检测到 ${inspection.integratedLufs.toFixed(1)} LUFS，建议复核 -16 LUFS 基线。`, targetKind: 'audio' })
  }

  const sortedCues = [...plan.subtitles].sort((left, right) => left.startSeconds - right.startSeconds || left.index - right.index)
  for (let index = 0; index < sortedCues.length; index++) {
    const cue = sortedCues[index]
    const lineLengths = cue.text.split('\n').map((line) => Array.from(line).length)
    if (cue.startSeconds < 0 || cue.endSeconds > plan.durationSeconds + 0.05 || cue.endSeconds <= cue.startSeconds) {
      add({ kind: 'subtitle_bounds', severity: 'blocker', title: `字幕 ${cue.index} 时序越界`, detail: '字幕起止时间不在当前成片范围内。', targetKind: 'subtitle', targetId: String(cue.index), startSeconds: cue.startSeconds, endSeconds: cue.endSeconds })
    }
    if (cue.text.split('\n').length > 2 || lineLengths.some((length) => length > 18)) {
      add({ kind: 'subtitle_safe_area', severity: 'blocker', title: `字幕 ${cue.index} 超出竖屏安全区规则`, detail: '字幕最多两行、每行最多 18 个字符，避免遮挡画面主体。', targetKind: 'subtitle', targetId: String(cue.index), startSeconds: cue.startSeconds, endSeconds: cue.endSeconds })
    }
    const next = sortedCues[index + 1]
    if (next && cue.endSeconds > next.startSeconds + 0.001) {
      add({ kind: 'subtitle_overlap', severity: 'blocker', title: `字幕 ${cue.index} 与 ${next.index} 重叠`, detail: '同一字幕轨不能在同一时间叠放两段文本。', targetKind: 'subtitle', targetId: `${cue.index},${next.index}`, startSeconds: next.startSeconds, endSeconds: cue.endSeconds })
    }
  }
  for (const track of plan.audioTracks.filter((track) => track.kind === 'dialogue' || track.kind === 'narration')) {
    for (const clip of track.clips.filter((clip) => Boolean(clip.text?.trim()))) {
      const start = clip.startSeconds
      const end = clip.startSeconds + (clip.durationSeconds ?? 0.25)
      if (!sortedCues.some((cue) => cue.startSeconds < end && cue.endSeconds > start)) {
        add({ kind: 'dialogue_subtitle_timing', severity: 'warning', title: '对白/旁白未找到对应字幕时间段', detail: `音轨“${track.label}”的一段文本没有与字幕轨重叠，请校对台词时间。`, targetKind: 'subtitle', targetId: clip.id, startSeconds: start, endSeconds: end })
      }
    }
  }

  for (const finding of input.continuity ?? []) {
    add({
      kind: 'continuity', severity: finding.severity === 'blocking' ? 'blocker' : 'warning', title: '视觉连续性需复核',
      detail: finding.message, targetKind: 'continuity', targetId: finding.shotId, affectedShotIds: [finding.shotId],
    })
  }
  add({ kind: 'lip_sync_unavailable', severity: 'info', title: '未启用嘴型同步识别', detail: '当前没有可靠的逐帧口型模型；报告不会把嘴型同步写成确定结论，请人工播放核对。', targetKind: 'audio' })

  const redoTargets = buildMinimalRedoTargets(issues)
  return {
    schemaVersion: 1,
    renderTaskId: input.renderTaskId,
    renderSourceFingerprint: input.renderSourceFingerprint,
    sourceFingerprint: buildEpisodeQualitySourceFingerprint(input),
    deliveryVersion: `render:${input.renderTaskId.slice(0, 8)}`,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inspection,
    issues,
    redoTargets,
    blockerCount: issues.filter((issue) => issue.severity === 'blocker').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    limitations: ['嘴型同步仅在接入经验证的口型模型后才可提供置信建议；当前报告未执行该项检测。'],
  }
}

export function buildMinimalRedoTargets(issues: EpisodeQualityIssue[]): EpisodeMinimalRedoTarget[] {
  const targets = new Map<string, EpisodeMinimalRedoTarget>()
  for (const issue of issues.filter((item) => item.severity === 'blocker')) {
    const affectedShots = issue.affectedShotIds?.length ? issue.affectedShotIds : issue.targetKind === 'shot' && issue.targetId ? [issue.targetId] : []
    const candidates: Array<Pick<EpisodeMinimalRedoTarget, 'kind' | 'targetId' | 'reason'>> = affectedShots.length
      ? affectedShots.map((shotId) => ({ kind: 'shot', targetId: shotId, reason: issue.title }))
      : [{ kind: issue.targetKind === 'audio' ? 'audio' : issue.targetKind === 'subtitle' ? 'subtitle' : 'delivery', targetId: issue.targetId, reason: issue.title }]
    for (const candidate of candidates) {
      const key = `${candidate.kind}:${candidate.targetId ?? 'episode'}`
      const existing = targets.get(key)
      if (existing) existing.issueIds.push(issue.id)
      else targets.set(key, { ...candidate, issueIds: [issue.id] })
    }
  }
  return [...targets.values()]
}

function addIntervalIssue(
  add: (issue: Omit<EpisodeQualityIssue, 'id'>) => void,
  plan: EpisodeRenderPlan,
  interval: EpisodeQualityInterval,
  kind: 'black_frames' | 'frozen_frames' | 'silence',
  severity: EpisodeQualitySeverity,
  title: string,
  detail: string,
  targetKind: EpisodeQualityTargetKind = 'shot',
): void {
  const affectedShotIds = plan.visualClips
    .filter((clip) => clip.startSeconds < interval.endSeconds && clip.startSeconds + clip.durationSeconds > interval.startSeconds)
    .map((clip) => clip.shotId)
  add({ kind, severity, title, detail, targetKind, startSeconds: interval.startSeconds, endSeconds: interval.endSeconds, affectedShotIds })
}

/** Static image shots and the renderer's short fade-to-black are intentional, not frozen-media defects. */
function isExpectedStillInterval(plan: EpisodeRenderPlan, interval: EpisodeQualityInterval): boolean {
  const overlaps = plan.visualClips.filter((clip) => clip.startSeconds < interval.endSeconds && clip.startSeconds + clip.durationSeconds > interval.startSeconds)
  return overlaps.length > 0 && overlaps.every((clip) => clip.source.kind === 'still')
}

function isExpectedFadeInterval(plan: EpisodeRenderPlan, interval: EpisodeQualityInterval): boolean {
  return plan.visualClips.some((clip) => {
    if (clip.transition !== 'fade' || clip.durationSeconds < 0.7) return false
    const fadeSeconds = 0.22
    const atStart = interval.startSeconds >= clip.startSeconds - 0.01 && interval.endSeconds <= clip.startSeconds + fadeSeconds
    const end = clip.startSeconds + clip.durationSeconds
    const atEnd = interval.startSeconds >= end - fadeSeconds && interval.endSeconds <= end + 0.01
    return atStart || atEnd
  })
}
