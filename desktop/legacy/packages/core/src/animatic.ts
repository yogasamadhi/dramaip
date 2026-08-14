import type { AnimaticClip, Shot, ShotStillCandidate } from './types'

/** Deterministic initial timeline: users may later change duration/transition and save a new revision. */
export function initializeAnimaticClips(shots: Shot[], candidates: ShotStillCandidate[]): { clips: AnimaticClip[]; sourceFingerprint: string } {
  const adoptedByShot = new Map<string, ShotStillCandidate[]>()
  for (const candidate of candidates.filter((candidate) => candidate.status === 'adopted' && !candidate.staleReason)) {
    adoptedByShot.set(candidate.shotId, [...(adoptedByShot.get(candidate.shotId) ?? []), candidate])
  }
  const ordered = [...shots].sort((left, right) => left.shotNumber - right.shotNumber)
  const clips = ordered.map((shot, index) => {
    const preferred = (adoptedByShot.get(shot.id) ?? []).find((candidate) => candidate.kind === 'still')
      ?? (adoptedByShot.get(shot.id) ?? []).find((candidate) => candidate.kind === 'first_frame')
      ?? (adoptedByShot.get(shot.id) ?? [])[0]
    return {
      id: `clip:${shot.id}`,
      shotId: shot.id,
      orderIndex: index,
      durationSeconds: clampDuration(shot.durationSeconds ?? 3),
      stillCandidateId: preferred?.id,
      assetId: preferred?.assetId,
      transition: index === 0 ? 'cut' : 'fade',
      crop: { zoom: 1, x: 0, y: 0 },
      dialogue: shot.dialogue,
      narration: shot.narration,
    } satisfies AnimaticClip
  })
  return { clips, sourceFingerprint: ordered.map((shot) => `${shot.id}@${shot.updatedAt}`).join('|') }
}

export function clampDuration(value: number): number { return Math.min(15, Math.max(1, Math.round(value * 10) / 10)) }

export function animaticDurationSeconds(clips: AnimaticClip[]): number { return clips.reduce((total, clip) => total + clampDuration(clip.durationSeconds), 0) }
