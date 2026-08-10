import type { LocalizationCue, Shot } from './types'
import { formatTimestamp, serializeSrt, serializeVtt, wrapSubtitle } from './episode-render'

export function localizationSourceFingerprint(shots: Shot[]): string {
  return shots.slice().sort((a, b) => a.shotNumber - b.shotNumber).map((shot) => `${shot.id}@${shot.updatedAt}:${subtitleText(shot)}`).join('|')
}
export function localizationCuesFromShots(shots: Shot[]): LocalizationCue[] {
  let start = 0
  return shots.slice().sort((a, b) => a.shotNumber - b.shotNumber).flatMap((shot) => {
    const text = subtitleText(shot); const duration = Math.max(0.5, shot.durationSeconds ?? 3)
    const cue = text ? [{ id: `cue-${shot.id}`, shotId: shot.id, startSeconds: start, endSeconds: start + duration, sourceText: text, localizedText: '' }] : []
    start += duration; return cue
  })
}
export function localizationSubtitleFiles(cues: LocalizationCue[]): { srt: string; vtt: string; warnings: string[] } {
  const warnings: string[] = []
  const rows = cues.map((cue, index) => {
    const text = wrapSubtitle(cue.localizedText, 42)
    const charsPerSecond = Array.from(text.replace(/\s/g, '')).length / Math.max(0.1, cue.endSeconds - cue.startSeconds)
    if (charsPerSecond > 17) warnings.push(`第 ${index + 1} 句阅读速度约 ${charsPerSecond.toFixed(1)} 字/秒，请缩短或延长时长。`)
    return { index: index + 1, startSeconds: cue.startSeconds, endSeconds: cue.endSeconds, text }
  }).filter((cue) => cue.text)
  return { srt: serializeSrt(rows), vtt: serializeVtt(rows), warnings }
}
export function localizationCueComparison(cue: LocalizationCue): string { return `${formatTimestamp(cue.startSeconds, '.')} ${cue.sourceText} → ${cue.localizedText || '（待译）'}` }
function subtitleText(shot: Shot): string { return (shot.subtitleDraft || shot.dialogue || shot.narration || '').trim() }
