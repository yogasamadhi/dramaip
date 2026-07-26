// character_states —— 人物状态（ROADMAP v0.2 §2）
import { desc, eq } from 'drizzle-orm'
import type { DB } from '../client'
import { characterStates } from '../schema'
import type { CharacterState, OptionalId } from '@sdns/core'
import { genId, now, parseJsonArray, stringifyArray, insertRow } from './util'

type CharacterStateRow = typeof characterStates.$inferSelect

function rowToEntity(row: CharacterStateRow): CharacterState {
  return {
    id: row.id,
    projectId: row.projectId,
    characterId: row.characterId,
    chapterId: row.chapterId ?? undefined,
    currentStatus: row.currentStatus,
    emotionalState: row.emotionalState ?? undefined,
    relationshipChanges: row.relationshipChanges ?? undefined,
    knownSecrets: parseJsonArray(row.knownSecrets),
    hiddenSecrets: parseJsonArray(row.hiddenSecrets),
    visualContinuityNotes: row.visualContinuityNotes ?? undefined,
    createdAt: row.createdAt,
  }
}

export function listCharacterStates(db: DB, projectId: string): CharacterState[] {
  return db
    .select()
    .from(characterStates)
    .where(eq(characterStates.projectId, projectId))
    .orderBy(desc(characterStates.createdAt))
    .all()
    .map(rowToEntity)
}

export function listCharacterStatesByCharacter(
  db: DB,
  characterId: string,
): CharacterState[] {
  return db
    .select()
    .from(characterStates)
    .where(eq(characterStates.characterId, characterId))
    .orderBy(desc(characterStates.createdAt))
    .all()
    .map(rowToEntity)
}

export function listCharacterStatesByChapter(db: DB, chapterId: string): CharacterState[] {
  return db
    .select()
    .from(characterStates)
    .where(eq(characterStates.chapterId, chapterId))
    .orderBy(desc(characterStates.createdAt))
    .all()
    .map(rowToEntity)
}

export function getCharacterState(db: DB, id: string): CharacterState | undefined {
  const row = db.select().from(characterStates).where(eq(characterStates.id, id)).get()
  return row ? rowToEntity(row as CharacterStateRow) : undefined
}

export function createCharacterState(
  db: DB,
  data: Partial<OptionalId<CharacterState>> & { projectId: string; characterId: string; currentStatus: string },
): CharacterState {
  const value: typeof characterStates.$inferInsert = {
    id: genId(),
    createdAt: now(),
    projectId: data.projectId,
    characterId: data.characterId,
    chapterId: data.chapterId ?? null,
    currentStatus: data.currentStatus,
    emotionalState: data.emotionalState ?? null,
    relationshipChanges: data.relationshipChanges ?? null,
    knownSecrets: stringifyArray(data.knownSecrets),
    hiddenSecrets: stringifyArray(data.hiddenSecrets),
    visualContinuityNotes: data.visualContinuityNotes ?? null,
  }
  const [row] = insertRow(db, characterStates, value)
  return rowToEntity(row as CharacterStateRow)
}

export function deleteCharacterState(db: DB, id: string): void {
  db.delete(characterStates).where(eq(characterStates.id, id)).run()
}
