import type { AnimaticDraft, AudioTrack, Shot } from './types'

/**
 * A delivery timeline is intentionally a data-only contract. The renderer can
 * preview it, while the desktop main process turns the exact same plan into
 * files. Keeping media-process details out of this module makes the lineage
 * testable and prevents the renderer from claiming a successful export.
 */
export type EpisodeRenderVisualKind = 'video' | 'still' | 'missing'

export interface EpisodeRenderVisualSource {
  kind: EpisodeRenderVisualKind
  /** Project asset / video-result reference, never a renderer supplied URL. */
  sourceId?: string
  /** Immutable asset/video revision captured by the render lineage. */
  sourceVersion?: string
  localPath?: string
  label?: string
}

export interface EpisodeRenderVisualClip {
  id: string
  shotId: string
  orderIndex: number
  startSeconds: number
  durationSeconds: number
  transition: 'cut' | 'fade'
  crop: { zoom: number; x: number; y: number }
  source: EpisodeRenderVisualSource
}

export interface EpisodeSubtitleCue {
  index: number
  startSeconds: number
  endSeconds: number
  text: string
}

export interface EpisodeRenderPlan {
  episodeId: string
  animaticId: string
  animaticVersionNumber: number
  durationSeconds: number
  sourceFingerprint: string
  visualClips: EpisodeRenderVisualClip[]
  audioTracks: Array<Pick<AudioTrack, 'id' | 'kind' | 'versionNumber' | 'label' | 'status' | 'sourceFingerprint' | 'clips'>>
  subtitles: EpisodeSubtitleCue[]
  srt: string
  vtt: string
}

export interface EpisodeRenderPreflight {
  ok: boolean
  plan?: EpisodeRenderPlan
  blockers: string[]
  warnings: string[]
  ffmpegPath?: string
}

export interface EpisodeRenderArchive {
  taskId: string
  mp4Path: string
  srtPath: string
  vttPath: string
  audioPath: string
  manifestPath: string
  sourceFingerprint: string
  durationSeconds: number
}

export interface EpisodeRenderPlanInput {
  animatic: AnimaticDraft
  shots: Shot[]
  audioTracks: AudioTrack[]
  resolveVisualSource: (input: { shotId: string; assetId?: string; stillCandidateId?: string }) => EpisodeRenderVisualSource
}

/** Build a deterministic 9:16 delivery plan from approved production records. */
export function buildEpisodeRenderPlan(input: EpisodeRenderPlanInput): EpisodeRenderPlan {
  const shots = new Map(input.shots.map((shot) => [shot.id, shot]))
  let startSeconds = 0
  const visualClips = [...input.animatic.clips]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((clip, orderIndex) => {
      const durationSeconds = clampDuration(clip.durationSeconds)
      const source = input.resolveVisualSource({ shotId: clip.shotId, assetId: clip.assetId, stillCandidateId: clip.stillCandidateId })
      const timelineClip: EpisodeRenderVisualClip = {
        id: clip.id,
        shotId: clip.shotId,
        orderIndex,
        startSeconds,
        durationSeconds,
        transition: clip.transition === 'fade' ? 'fade' : 'cut',
        crop: normalizeCrop(clip.crop),
        source,
      }
      startSeconds += durationSeconds
      return timelineClip
    })

  const subtitles = visualClips.flatMap((clip) => {
    const shot = shots.get(clip.shotId)
    const text = subtitleText(shot)
    if (!text) return []
    return [{
      index: 0,
      startSeconds: clip.startSeconds,
      endSeconds: clip.startSeconds + clip.durationSeconds,
      text: wrapSubtitle(text),
    }]
  }).map((cue, index) => ({ ...cue, index: index + 1 }))

  const tracks = input.audioTracks
    .filter((track) => track.status === 'adopted' && !track.staleReason)
    .sort((left, right) => left.kind.localeCompare(right.kind) || right.versionNumber - left.versionNumber)
    .map((track) => ({
      id: track.id,
      kind: track.kind,
      versionNumber: track.versionNumber,
      label: track.label,
      status: track.status,
      sourceFingerprint: track.sourceFingerprint,
      clips: [...track.clips].sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id)),
    }))

  const sourceFingerprint = [
    input.animatic.sourceFingerprint,
    `animatic:${input.animatic.id}@${input.animatic.versionNumber}`,
    ...visualClips.map((clip) => `${clip.shotId}:${clip.source.kind}:${clip.source.sourceId ?? 'missing'}@${clip.source.sourceVersion ?? 'unknown'}`),
    ...tracks.map((track) => `audio:${track.id}@${track.versionNumber}:${track.sourceFingerprint}`),
  ].join('|')

  return {
    episodeId: input.animatic.episodeId,
    animaticId: input.animatic.id,
    animaticVersionNumber: input.animatic.versionNumber,
    durationSeconds: roundSeconds(startSeconds),
    sourceFingerprint,
    visualClips,
    audioTracks: tracks,
    subtitles,
    srt: serializeSrt(subtitles),
    vtt: serializeVtt(subtitles),
  }
}

export function serializeSrt(cues: EpisodeSubtitleCue[]): string {
  return cues.map((cue) => `${cue.index}\n${formatTimestamp(cue.startSeconds, ',')} --> ${formatTimestamp(cue.endSeconds, ',')}\n${cue.text}`).join('\n\n') + (cues.length ? '\n' : '')
}

export function serializeVtt(cues: EpisodeSubtitleCue[]): string {
  const body = cues.map((cue) => `${formatTimestamp(cue.startSeconds, '.')} --> ${formatTimestamp(cue.endSeconds, '.')}\n${cue.text}`).join('\n\n')
  return `WEBVTT\n\n${body}${body ? '\n' : ''}`
}

/** Two short lines keep Chinese subtitle text within a 9:16 safe area. */
export function wrapSubtitle(value: string, maxLineLength = 18): string {
  const plain = value
    .replace(/\r/g, '')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/^\s*\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return ''
  const chars = Array.from(plain)
  if (chars.length <= maxLineLength) return plain
  const first = chars.slice(0, maxLineLength).join('').trim()
  const second = chars.slice(maxLineLength, maxLineLength * 2).join('').trim()
  return second ? `${first}\n${second}` : first
}

export function formatTimestamp(seconds: number, decimal: ',' | '.'): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((milliseconds % 60_000) / 1000)
  const fraction = milliseconds % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}${decimal}${String(fraction).padStart(3, '0')}`
}

function subtitleText(shot: Shot | undefined): string | undefined {
  const draft = shot?.subtitleDraft?.trim()
  if (draft) return draft
  return shot?.dialogue?.trim() || shot?.narration?.trim()
}

function clampDuration(value: number): number {
  return Math.min(60, Math.max(0.25, Math.round(value * 1000) / 1000))
}

function normalizeCrop(value: { zoom: number; x: number; y: number } | undefined): { zoom: number; x: number; y: number } {
  return {
    zoom: Math.min(2, Math.max(0.8, value?.zoom ?? 1)),
    x: Math.min(50, Math.max(-50, value?.x ?? 0)),
    y: Math.min(50, Math.max(-50, value?.y ?? 0)),
  }
}

function roundSeconds(value: number): number { return Math.round(value * 1000) / 1000 }
