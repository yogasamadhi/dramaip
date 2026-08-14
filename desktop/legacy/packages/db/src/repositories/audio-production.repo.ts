import { and, desc, eq, max } from 'drizzle-orm'
import type { AudioClip, AudioTrack, AudioTrackKind, VoiceProfile } from '@sdns/core'
import type { DB } from '../client'
import { audioTracks, voiceProfiles } from '../schema'
import { genId, insertRow, now, stringifyJson, updateRows } from './util'

type VoiceRow = typeof voiceProfiles.$inferSelect
type TrackRow = typeof audioTracks.$inferSelect
function parseJson<T>(value: string, fallback: T): T { try { return JSON.parse(value) as T } catch { return fallback } }
const fromVoice = (row: VoiceRow): VoiceProfile => ({ ...row, characterId: row.characterId ?? undefined, voiceTone: row.voiceTone ?? undefined, speed: row.speed ?? undefined, emotion: row.emotion ?? undefined, language: row.language ?? undefined, sampleAssetId: row.sampleAssetId ?? undefined, notes: row.notes ?? undefined, pronunciationDictionary: parseJson<Record<string, string>>(row.pronunciationDictionary, {}) })
const fromTrack = (row: TrackRow): AudioTrack => ({ ...row, status: row.status as AudioTrack['status'], kind: row.kind as AudioTrackKind, clips: parseJson<AudioClip[]>(row.clips, []), staleAt: row.staleAt ?? undefined, staleReason: row.staleReason ?? undefined })

export function listVoiceProfilesByProject(db: DB, projectId: string): VoiceProfile[] { return db.select().from(voiceProfiles).where(eq(voiceProfiles.projectId, projectId)).orderBy(desc(voiceProfiles.updatedAt)).all().map((row) => fromVoice(row as VoiceRow)) }
export function createVoiceProfile(db: DB, data: Omit<VoiceProfile, 'id' | 'status' | 'createdAt' | 'updatedAt'> & { status?: VoiceProfile['status'] }): VoiceProfile {
  const ts = now()
  const [row] = insertRow(db, voiceProfiles, { ...data, id: genId(), status: data.status ?? 'candidate', pronunciationDictionary: stringifyJson(data.pronunciationDictionary), characterId: data.characterId ?? null, voiceTone: data.voiceTone ?? null, speed: data.speed ?? null, emotion: data.emotion ?? null, language: data.language ?? null, sampleAssetId: data.sampleAssetId ?? null, notes: data.notes ?? null, createdAt: ts, updatedAt: ts })
  return fromVoice(row as VoiceRow)
}
export function adoptVoiceProfile(db: DB, id: string): VoiceProfile | undefined {
  const current = db.select().from(voiceProfiles).where(eq(voiceProfiles.id, id)).get() as VoiceRow | undefined
  if (!current) return undefined
  const ts = now()
  if (current.characterId) updateRows(db, voiceProfiles, { status: 'superseded', updatedAt: ts }).where(and(eq(voiceProfiles.projectId, current.projectId), eq(voiceProfiles.characterId, current.characterId), eq(voiceProfiles.status, 'adopted'))).run()
  const [row] = updateRows(db, voiceProfiles, { status: 'adopted', updatedAt: ts }).where(eq(voiceProfiles.id, id)).returning().all()
  return row ? fromVoice(row as VoiceRow) : undefined
}
export function listAudioTracksByEpisode(db: DB, episodeId: string): AudioTrack[] { return db.select().from(audioTracks).where(eq(audioTracks.episodeId, episodeId)).orderBy(desc(audioTracks.versionNumber)).all().map((row) => fromTrack(row as TrackRow)) }
export function getAudioTrack(db: DB, id: string): AudioTrack | undefined {
  const row = db.select().from(audioTracks).where(eq(audioTracks.id, id)).get() as TrackRow | undefined
  return row ? fromTrack(row) : undefined
}
export function createAudioTrack(db: DB, data: Pick<AudioTrack, 'projectId' | 'adaptationProjectId' | 'episodeId' | 'kind' | 'label' | 'sourceFingerprint' | 'clips'>): AudioTrack {
  const existing = db.select({ value: max(audioTracks.versionNumber) }).from(audioTracks).where(and(eq(audioTracks.episodeId, data.episodeId), eq(audioTracks.kind, data.kind))).get()
  const ts = now()
  const [row] = insertRow(db, audioTracks, { id: genId(), ...data, versionNumber: (existing?.value ?? 0) + 1, status: 'draft', clips: stringifyJson(data.clips), staleAt: null, staleReason: null, createdAt: ts, updatedAt: ts })
  return fromTrack(row as TrackRow)
}
export function adoptAudioTrack(db: DB, id: string): AudioTrack | undefined {
  const current = db.select().from(audioTracks).where(eq(audioTracks.id, id)).get() as TrackRow | undefined
  if (!current) return undefined
  const ts = now()
  updateRows(db, audioTracks, { status: 'superseded', updatedAt: ts }).where(and(eq(audioTracks.episodeId, current.episodeId), eq(audioTracks.kind, current.kind), eq(audioTracks.status, 'adopted'))).run()
  const [row] = updateRows(db, audioTracks, { status: 'adopted', staleAt: null, staleReason: null, updatedAt: ts }).where(eq(audioTracks.id, id)).returning().all()
  return row ? fromTrack(row as TrackRow) : undefined
}
export function setAudioTrackStaleState(db: DB, id: string, staleAt: string | undefined, staleReason: string | undefined): AudioTrack | undefined {
  const [row] = updateRows(db, audioTracks, { status: staleReason ? 'stale' : 'draft', staleAt: staleAt ?? null, staleReason: staleReason ?? null, updatedAt: now() }).where(eq(audioTracks.id, id)).returning().all()
  return row ? fromTrack(row as TrackRow) : undefined
}
