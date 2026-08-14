// story_bible_change_sets —— 可审查、可撤销的故事圣经变更包（LM5-05）
import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { DB } from '../client'
import {
  chapters,
  characters,
  characterStates,
  foreshadowings,
  storyBibleChangeSets,
  storyBibleSettings,
  storyBibleStaleMarks,
  storyEvents,
  visualSettings,
  chapterMemories,
} from '../schema'
import {
  StoryBibleChangeSetPayloadSchema,
  type StoryBibleChangeItem,
  type StoryBibleChangeSet,
  type StoryBibleChangeSetPayload,
  type StoryBibleChangeSetStatus,
  type StoryBibleSettings,
} from '@sdns/core'
import { genId, now, stringifyJson, updateRows } from './util'

type ChangeSetRow = typeof storyBibleChangeSets.$inferSelect

interface UndoPayload {
  chapterMemoryIds: string[]
  characterStateIds: string[]
  storyEventIds: string[]
  foreshadowingIds: string[]
  visualSettingIds: string[]
}

const EMPTY_UNDO: UndoPayload = {
  chapterMemoryIds: [],
  characterStateIds: [],
  storyEventIds: [],
  foreshadowingIds: [],
  visualSettingIds: [],
}

function sourceHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function payloadFromJson(value: string | null): StoryBibleChangeSetPayload | undefined {
  if (!value) return undefined
  try {
    return StoryBibleChangeSetPayloadSchema.parse(JSON.parse(value))
  } catch {
    return undefined
  }
}

function itemsFromJson(value: string | null): StoryBibleChangeItem[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed as StoryBibleChangeItem[] : []
  } catch {
    return []
  }
}

function rowToEntity(row: ChangeSetRow): StoryBibleChangeSet {
  return {
    id: row.id,
    projectId: row.projectId,
    chapterId: row.chapterId,
    sourceChapterUpdatedAt: row.sourceChapterUpdatedAt,
    sourceContentHash: row.sourceContentHash,
    taskId: row.taskId ?? undefined,
    status: row.status as StoryBibleChangeSetStatus,
    estimatedTokens: row.estimatedTokens ?? undefined,
    estimatedCost: row.estimatedCost ?? undefined,
    currency: row.currency ?? undefined,
    payload: payloadFromJson(row.payload),
    conflicts: itemsFromJson(row.conflicts),
    errorMessage: row.errorMessage ?? undefined,
    appliedAt: row.appliedAt ?? undefined,
    undoneAt: row.undoneAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function estimate(content: string, costPer1kTokens: number): { tokens: number; cost: number | undefined } {
  // 中文通常接近 1 token / 1.5~2 字；采用保守的 1.5 字估算，并包含结构化输出余量。
  const tokens = Math.max(128, Math.ceil(content.trim().length / 1.5) + 320)
  return { tokens, cost: costPer1kTokens > 0 ? Number(((tokens / 1000) * costPer1kTokens).toFixed(4)) : undefined }
}

export function getStoryBibleSettings(db: DB, projectId: string): StoryBibleSettings {
  const row = db.select().from(storyBibleSettings).where(eq(storyBibleSettings.projectId, projectId)).get()
  return row
    ? { projectId: row.projectId, autoSuggest: row.autoSuggest, updatedAt: row.updatedAt }
    : { projectId, autoSuggest: false, updatedAt: now() }
}

export function updateStoryBibleSettings(db: DB, projectId: string, patch: Pick<StoryBibleSettings, 'autoSuggest'>): StoryBibleSettings {
  const ts = now()
  const existing = db.select().from(storyBibleSettings).where(eq(storyBibleSettings.projectId, projectId)).get()
  if (existing) {
    const [row] = updateRows(db, storyBibleSettings, { autoSuggest: patch.autoSuggest, updatedAt: ts })
      .where(eq(storyBibleSettings.projectId, projectId))
      .returning()
      .all()
    return { projectId: row.projectId, autoSuggest: row.autoSuggest, updatedAt: row.updatedAt }
  }
  db.insert(storyBibleSettings).values({ projectId, autoSuggest: patch.autoSuggest, updatedAt: ts }).run()
  return { projectId, autoSuggest: patch.autoSuggest, updatedAt: ts }
}

export function listStoryBibleChangeSets(db: DB, projectId: string): StoryBibleChangeSet[] {
  return db.select().from(storyBibleChangeSets)
    .where(eq(storyBibleChangeSets.projectId, projectId))
    .orderBy(desc(storyBibleChangeSets.updatedAt))
    .all()
    .map(rowToEntity)
}

export function getStoryBibleChangeSet(db: DB, id: string): StoryBibleChangeSet | undefined {
  const row = db.select().from(storyBibleChangeSets).where(eq(storyBibleChangeSets.id, id)).get()
  return row ? rowToEntity(row as ChangeSetRow) : undefined
}

/** 在章节稳定保存后进入建议队列；相同内容不会重复排队。 */
export function queueStoryBibleChangeSet(
  db: DB,
  input: { projectId: string; chapterId: string; costPer1kTokens: number; currency: string },
): StoryBibleChangeSet {
  const chapter = db.select().from(chapters).where(and(eq(chapters.id, input.chapterId), eq(chapters.projectId, input.projectId))).get()
  if (!chapter) throw new Error('未找到要生成故事圣经建议的章节')
  if (!chapter.content.trim()) throw new Error('章节正文为空，无法生成故事圣经建议')
  const hash = sourceHash(chapter.content)
  const existing = db.select().from(storyBibleChangeSets)
    .where(and(
      eq(storyBibleChangeSets.projectId, input.projectId),
      eq(storyBibleChangeSets.chapterId, input.chapterId),
      eq(storyBibleChangeSets.sourceContentHash, hash),
      inArray(storyBibleChangeSets.status, ['queued', 'draft', 'paused']),
    ))
    .get()
  if (existing) return rowToEntity(existing as ChangeSetRow)

  const ts = now()
  const pricing = estimate(chapter.content, input.costPer1kTokens)
  const value: typeof storyBibleChangeSets.$inferInsert = {
    id: genId(), projectId: input.projectId, chapterId: input.chapterId,
    sourceChapterUpdatedAt: chapter.updatedAt, sourceContentHash: hash,
    status: 'queued', estimatedTokens: pricing.tokens, estimatedCost: pricing.cost ?? null,
    currency: input.currency, conflicts: '[]', createdAt: ts, updatedAt: ts,
  }
  const [row] = db.insert(storyBibleChangeSets).values(value).returning().all()
  return rowToEntity(row as ChangeSetRow)
}

/** AI 结构化输出只填充草案；不会在此处修改故事圣经实体。 */
export function saveStoryBibleDraft(
  db: DB,
  input: { projectId: string; chapterId: string; payload: StoryBibleChangeSetPayload; taskId?: string; costPer1kTokens: number; currency: string },
): StoryBibleChangeSet {
  const chapter = db.select().from(chapters).where(and(eq(chapters.id, input.chapterId), eq(chapters.projectId, input.projectId))).get()
  if (!chapter) throw new Error('生成期间章节已不存在')
  const hash = sourceHash(chapter.content)
  const ts = now()
  const pricing = estimate(chapter.content, input.costPer1kTokens)
  const queued = db.select().from(storyBibleChangeSets)
    .where(and(
      eq(storyBibleChangeSets.projectId, input.projectId),
      eq(storyBibleChangeSets.chapterId, input.chapterId),
      eq(storyBibleChangeSets.sourceContentHash, hash),
      eq(storyBibleChangeSets.status, 'queued'),
    ))
    .get()
  const values = {
    taskId: input.taskId ?? null,
    status: 'draft',
    estimatedTokens: pricing.tokens,
    estimatedCost: pricing.cost ?? null,
    currency: input.currency,
    payload: stringifyJson(input.payload),
    conflicts: stringifyJson(findConflicts(db, input.projectId, input.payload)),
    errorMessage: null,
    updatedAt: ts,
  }
  if (queued) {
    const [row] = updateRows(db, storyBibleChangeSets, { ...values, sourceChapterUpdatedAt: chapter.updatedAt }).where(eq(storyBibleChangeSets.id, queued.id)).returning().all()
    return rowToEntity(row as ChangeSetRow)
  }
  const [row] = db.insert(storyBibleChangeSets).values({
    id: genId(), projectId: input.projectId, chapterId: input.chapterId,
    sourceChapterUpdatedAt: chapter.updatedAt, sourceContentHash: hash,
    createdAt: ts, ...values,
  }).returning().all()
  return rowToEntity(row as ChangeSetRow)
}

function findConflicts(db: DB, projectId: string, payload: StoryBibleChangeSetPayload): StoryBibleChangeItem[] {
  const conflicts: StoryBibleChangeItem[] = []
  for (const state of payload.characterStates) {
    // 角色 id 必须归属项目；不根据名字猜测，避免写到错误人物。
    const character = db.select({ id: characters.id }).from(characters)
      .where(and(eq(characters.id, state.characterId), eq(characters.projectId, projectId))).get()
    if (!character) conflicts.push({
      id: genId(), kind: 'character_state', action: 'conflict', title: state.currentStatus,
      detail: '人物不存在或不属于本项目；不会按名字猜测写入位置。', targetId: state.characterId,
    })
  }
  for (const item of payload.foreshadowings.filter((entry) => entry.action === 'resolve' && entry.targetId)) {
    const target = db.select().from(foreshadowings).where(and(eq(foreshadowings.id, item.targetId!), eq(foreshadowings.projectId, projectId))).get()
    if (!target) conflicts.push({ id: genId(), kind: 'foreshadowing', action: 'conflict', title: item.title, detail: '要回收的伏笔已不存在或不属于本项目。', targetId: item.targetId })
  }
  return conflicts
}

export function markStoryBibleChangeSetFailed(db: DB, id: string, errorMessage: string): StoryBibleChangeSet | undefined {
  const [row] = updateRows(db, storyBibleChangeSets, { status: 'failed', errorMessage, updatedAt: now() })
    .where(eq(storyBibleChangeSets.id, id)).returning().all()
  return row ? rowToEntity(row as ChangeSetRow) : undefined
}

export function setStoryBibleChangeSetStatus(
  db: DB,
  id: string,
  status: Extract<StoryBibleChangeSetStatus, 'paused' | 'queued' | 'skipped' | 'discarded'>,
): StoryBibleChangeSet | undefined {
  const [row] = updateRows(db, storyBibleChangeSets, { status, updatedAt: now() })
    .where(eq(storyBibleChangeSets.id, id)).returning().all()
  return row ? rowToEntity(row as ChangeSetRow) : undefined
}

export function attachStoryBibleChangeSetTask(db: DB, id: string, taskId: string): void {
  updateRows(db, storyBibleChangeSets, { taskId, updatedAt: now() }).where(eq(storyBibleChangeSets.id, id)).run()
}

/** 章节正文改变后，旧变更包与下游诊断提示都会变为过期，原实体不会被删除。 */
export function markStoryBibleStaleForChapter(db: DB, projectId: string, chapterId: string): void {
  const ts = now()
  updateRows(db, storyBibleChangeSets, { status: 'stale', updatedAt: ts })
    .where(and(eq(storyBibleChangeSets.projectId, projectId), eq(storyBibleChangeSets.chapterId, chapterId), inArray(storyBibleChangeSets.status, ['queued', 'draft', 'applied', 'paused'])))
    .run()
  for (const targetKind of ['story_bible', 'diagnostic'] as const) {
    const existing = db.select().from(storyBibleStaleMarks)
      .where(and(eq(storyBibleStaleMarks.projectId, projectId), eq(storyBibleStaleMarks.chapterId, chapterId), eq(storyBibleStaleMarks.targetKind, targetKind), isNull(storyBibleStaleMarks.resolvedAt)))
      .get()
    if (!existing) db.insert(storyBibleStaleMarks).values({
      id: genId(), projectId, chapterId, targetKind,
      reason: targetKind === 'story_bible' ? '章节正文已更新，需要重新核对故事圣经。' : '章节正文已更新，相关诊断需要重新核对。',
      createdAt: ts, updatedAt: ts,
    }).run()
  }
}

export function listStoryBibleStaleMarks(db: DB, projectId: string) {
  return db.select().from(storyBibleStaleMarks)
    .where(and(eq(storyBibleStaleMarks.projectId, projectId), isNull(storyBibleStaleMarks.resolvedAt)))
    .orderBy(desc(storyBibleStaleMarks.updatedAt)).all()
}

/** 一次确认后，在单个事务中写入所有新增实体并保存可撤销的精确 id 列表。 */
export function applyStoryBibleChangeSet(db: DB, id: string): StoryBibleChangeSet {
  const changeSet = getStoryBibleChangeSet(db, id)
  if (!changeSet) throw new Error('未找到故事圣经变更包')
  if (changeSet.status !== 'draft') throw new Error('只有待确认草案可以采用')
  if (!changeSet.payload) throw new Error('变更包缺少可采用内容')
  if (changeSet.conflicts.length) throw new Error('变更包存在冲突，请先处理后再采用')
  const chapter = db.select().from(chapters).where(eq(chapters.id, changeSet.chapterId)).get()
  if (!chapter || sourceHash(chapter.content) !== changeSet.sourceContentHash) {
    markStoryBibleStaleForChapter(db, changeSet.projectId, changeSet.chapterId)
    throw new Error('章节已修改，当前变更包已过期；请重新生成建议')
  }

  const undo: UndoPayload = { ...EMPTY_UNDO, chapterMemoryIds: [], characterStateIds: [], storyEventIds: [], foreshadowingIds: [], visualSettingIds: [] }
  const ts = now()
  db.transaction((tx) => {
    const txDb = tx as DB
    for (const memory of changeSet.payload!.memories) {
      const id = genId()
      txDb.insert(chapterMemories).values({ id, projectId: changeSet.projectId, chapterId: changeSet.chapterId, ...memory, createdAt: ts, updatedAt: ts,
        importantEvents: stringifyJson(memory.importantEvents), characterChanges: stringifyJson(memory.characterChanges), revealedSecrets: stringifyJson(memory.revealedSecrets), newForeshadowing: stringifyJson(memory.newForeshadowing), resolvedForeshadowing: stringifyJson(memory.resolvedForeshadowing), keyVisualElements: stringifyJson(memory.keyVisualElements),
      }).run()
      undo.chapterMemoryIds.push(id)
    }
    for (const state of changeSet.payload!.characterStates) {
      const id = genId()
      txDb.insert(characterStates).values({ id, projectId: changeSet.projectId, characterId: state.characterId, chapterId: changeSet.chapterId,
        currentStatus: state.currentStatus, emotionalState: state.emotionalState ?? null, relationshipChanges: state.relationshipChanges ?? null,
        knownSecrets: stringifyJson(state.knownSecrets), hiddenSecrets: stringifyJson(state.hiddenSecrets), visualContinuityNotes: state.visualContinuityNotes ?? null, createdAt: ts,
      }).run()
      undo.characterStateIds.push(id)
    }
    const currentEventCount = txDb.select().from(storyEvents).where(eq(storyEvents.projectId, changeSet.projectId)).all().length
    changeSet.payload!.storyEvents.forEach((event, index) => {
      const id = genId()
      txDb.insert(storyEvents).values({ id, projectId: changeSet.projectId, chapterId: changeSet.chapterId, title: event.title, description: event.description,
        eventType: event.eventType, relatedCharacterIds: stringifyJson(event.relatedCharacterIds), orderIndex: currentEventCount + index, createdAt: ts,
      }).run()
      undo.storyEventIds.push(id)
    })
    for (const foreshadowing of changeSet.payload!.foreshadowings) {
      const id = genId()
      txDb.insert(foreshadowings).values({ id, projectId: changeSet.projectId, title: foreshadowing.title, setupChapterId: changeSet.chapterId,
        payoffChapterId: foreshadowing.action === 'resolve' ? changeSet.chapterId : null,
        status: foreshadowing.action === 'resolve' ? 'paid_off' : foreshadowing.status,
        description: foreshadowing.description, payoffPlan: foreshadowing.payoffPlan ?? null,
        relatedCharacterIds: stringifyJson(foreshadowing.relatedCharacterIds), createdAt: ts, updatedAt: ts,
      }).run()
      undo.foreshadowingIds.push(id)
    }
    for (const visual of changeSet.payload!.visualSettings) {
      const id = genId()
      txDb.insert(visualSettings).values({ id, projectId: changeSet.projectId, title: visual.title, type: visual.type, visualPrompt: visual.visualPrompt,
        negativePrompt: null, referenceImageUrl: null, notes: visual.notes ?? null, createdAt: ts, updatedAt: ts,
      }).run()
      undo.visualSettingIds.push(id)
    }
    updateRows(txDb, storyBibleChangeSets, { status: 'applied', undoPayload: stringifyJson(undo), appliedAt: ts, updatedAt: ts })
      .where(eq(storyBibleChangeSets.id, id)).run()
    updateRows(txDb, storyBibleStaleMarks, { resolvedAt: ts, updatedAt: ts })
      .where(and(eq(storyBibleStaleMarks.projectId, changeSet.projectId), eq(storyBibleStaleMarks.chapterId, changeSet.chapterId), eq(storyBibleStaleMarks.targetKind, 'story_bible'), isNull(storyBibleStaleMarks.resolvedAt))).run()
  })
  return getStoryBibleChangeSet(db, id)!
}

/** 撤销只删除该变更包亲自创建的实体，绝不删除章节或用户原有记录。 */
export function undoStoryBibleChangeSet(db: DB, id: string): StoryBibleChangeSet {
  const changeSet = getStoryBibleChangeSet(db, id)
  if (!changeSet) throw new Error('未找到故事圣经变更包')
  if (changeSet.status !== 'applied' && changeSet.status !== 'stale') throw new Error('只有已采用或过期的变更包可以撤销')
  const row = db.select().from(storyBibleChangeSets).where(eq(storyBibleChangeSets.id, id)).get() as ChangeSetRow
  let undo: UndoPayload = EMPTY_UNDO
  try { undo = row.undoPayload ? JSON.parse(row.undoPayload) as UndoPayload : EMPTY_UNDO } catch { /* 无可撤销实体 */ }
  const ts = now()
  db.transaction((tx) => {
    const txDb = tx as DB
    if (undo.chapterMemoryIds.length) txDb.delete(chapterMemories).where(inArray(chapterMemories.id, undo.chapterMemoryIds)).run()
    if (undo.characterStateIds.length) txDb.delete(characterStates).where(inArray(characterStates.id, undo.characterStateIds)).run()
    if (undo.storyEventIds.length) txDb.delete(storyEvents).where(inArray(storyEvents.id, undo.storyEventIds)).run()
    if (undo.foreshadowingIds.length) txDb.delete(foreshadowings).where(inArray(foreshadowings.id, undo.foreshadowingIds)).run()
    if (undo.visualSettingIds.length) txDb.delete(visualSettings).where(inArray(visualSettings.id, undo.visualSettingIds)).run()
    updateRows(txDb, storyBibleChangeSets, { status: 'discarded', undoneAt: ts, updatedAt: ts }).where(eq(storyBibleChangeSets.id, id)).run()
  })
  return getStoryBibleChangeSet(db, id)!
}
