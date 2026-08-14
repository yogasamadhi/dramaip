import { eq } from 'drizzle-orm'
import type { DB } from '../client'
import { characters } from '../schema'
import type { Character, OptionalId } from '@sdns/core'
import { genId, now, insertRow, updateRows } from './util'

export function listCharacters(db: DB, projectId: string): Character[] {
  return db
    .select()
    .from(characters)
    .where(eq(characters.projectId, projectId))
    .orderBy(characters.createdAt)
    .all() as unknown as Character[]
}

export function getCharacter(db: DB, id: string): Character | undefined {
  const row = db.select().from(characters).where(eq(characters.id, id)).get()
  return (row as unknown as Character) ?? undefined
}

export function createCharacter(
  db: DB,
  data: Partial<OptionalId<Character>> & { projectId: string; name: string; role: string },
): Character {
  const ts = now()
  const value: typeof characters.$inferInsert = {
    id: genId(),
    createdAt: ts,
    updatedAt: ts,
    projectId: data.projectId,
    name: data.name,
    role: data.role,
    identity: data.identity ?? null,
    personality: data.personality ?? null,
    desire: data.desire ?? null,
    secret: data.secret ?? null,
    weakness: data.weakness ?? null,
    arc: data.arc ?? null,
    relationshipToProtagonist: data.relationshipToProtagonist ?? null,
    conflictTarget: data.conflictTarget ?? null,
    emotionalFunction: data.emotionalFunction ?? null,
    shortDramaFunction: data.shortDramaFunction ?? null,
    visualDescription: data.visualDescription ?? null,
    appearancePrompt: data.appearancePrompt ?? null,
    negativePrompt: data.negativePrompt ?? null,
    notes: data.notes ?? null,
  }
  const [row] = insertRow(db, characters, value)
  return row as unknown as Character
}

export function updateCharacter(
  db: DB,
  id: string,
  patch: Partial<OptionalId<Character>>,
): Character | undefined {
  const [row] = updateRows(db, characters, { ...patch, updatedAt: now() })
    .where(eq(characters.id, id))
    .returning()
    .all()
  return (row as unknown as Character) ?? undefined
}

export function deleteCharacter(db: DB, id: string): void {
  db.delete(characters).where(eq(characters.id, id)).run()
}
