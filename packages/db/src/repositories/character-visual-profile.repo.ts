// character_visual_profiles —— 人物视觉档案（ROADMAP v0.2 §3）
import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { characterVisualProfiles } from '../schema'
import type { CharacterVisualProfile, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export function listVisualProfiles(db: DB, projectId: string): CharacterVisualProfile[] {
  return db
    .select()
    .from(characterVisualProfiles)
    .where(eq(characterVisualProfiles.projectId, projectId))
    .orderBy(characterVisualProfiles.createdAt)
    .all() as unknown as CharacterVisualProfile[]
}

export function getVisualProfileByCharacter(
  db: DB,
  characterId: string,
): CharacterVisualProfile | undefined {
  const row = db
    .select()
    .from(characterVisualProfiles)
    .where(eq(characterVisualProfiles.characterId, characterId))
    .get()
  return (row as unknown as CharacterVisualProfile) ?? undefined
}

export function getVisualProfile(db: DB, id: string): CharacterVisualProfile | undefined {
  const row = db
    .select()
    .from(characterVisualProfiles)
    .where(eq(characterVisualProfiles.id, id))
    .get()
  return (row as unknown as CharacterVisualProfile) ?? undefined
}

export function createVisualProfile(
  db: DB,
  data: Partial<OptionalId<CharacterVisualProfile>> & {
    projectId: string
    characterId: string
    appearancePrompt: string
  },
): CharacterVisualProfile {
  const ts = now()
  const value: typeof characterVisualProfiles.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    characterId: data.characterId,
    appearancePrompt: data.appearancePrompt,
    faceDescription: data.faceDescription ?? null,
    hairstyle: data.hairstyle ?? null,
    clothingStyle: data.clothingStyle ?? null,
    bodyType: data.bodyType ?? null,
    ageLook: data.ageLook ?? null,
    temperament: data.temperament ?? null,
    colorPalette: data.colorPalette ?? null,
    negativePrompt: data.negativePrompt ?? null,
    referenceImageUrl: data.referenceImageUrl ?? null,
  }
  const [row] = insertRow(db, characterVisualProfiles, value)
  return row as unknown as CharacterVisualProfile
}

export function updateVisualProfile(
  db: DB,
  id: string,
  patch: Partial<OptionalId<CharacterVisualProfile>>,
): CharacterVisualProfile | undefined {
  const [row] = updateRows(db, characterVisualProfiles, { ...patch, updatedAt: now() })
    .where(eq(characterVisualProfiles.id, id))
    .returning()
    .all()
  return (row as unknown as CharacterVisualProfile) ?? undefined
}

/** 视觉档案每人一份：已存在则更新，否则新建 */
export function upsertVisualProfileByCharacter(
  db: DB,
  data: Partial<OptionalId<CharacterVisualProfile>> & {
    projectId: string
    characterId: string
    appearancePrompt: string
  },
): CharacterVisualProfile {
  const existing = getVisualProfileByCharacter(db, data.characterId)
  if (existing) {
    const updated = updateVisualProfile(db, existing.id, data)
    return updated ?? existing
  }
  return createVisualProfile(db, data)
}

export function deleteVisualProfile(db: DB, id: string): void {
  db.delete(characterVisualProfiles).where(eq(characterVisualProfiles.id, id)).run()
}
