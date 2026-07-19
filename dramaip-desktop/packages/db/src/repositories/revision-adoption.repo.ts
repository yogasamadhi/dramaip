import { createHash } from 'node:crypto'
import type {
  ContentVersion,
  RevisionTask,
  RevisionTaskAdoptResult,
  RevisionTaskUndoResult,
  TextDiffPreviewPayload,
} from '@sdns/core'
import type { DB } from '../client'
import * as chapterRepo from './chapter.repo'
import * as creativeRepo from './creative.repo'
import * as scriptRepo from './script.repo'
import * as shotRepo from './shot.repo'

type RevisionSnapshot = {
  targetKind: 'chapter' | 'script' | 'shot'
  targetId: string
  content: string
  fields: Record<string, unknown>
  fingerprint: string
}

/**
 * 持久化已生成但尚未采用的候选。预览与当前目标不一致时拒绝保存，避免
 * 用户稍后看到一个已经过期却看似可用的修稿结果。
 */
export function saveRevisionTaskPreview(db: DB, id: string, preview: TextDiffPreviewPayload): RevisionTask {
  return db.transaction((tx) => {
    const transaction = tx as DB
    const task = requireTask(transaction, id)
    if (task.status === 'applied') throw new Error('修稿任务已采用')
    const snapshot = snapshotTarget(transaction, task)
    validatePreview(task, preview, snapshot)
    const updated = creativeRepo.updateRevisionTask(transaction, task.id, {
      status: 'preview_ready',
      preview,
      previewFingerprint: snapshot.fingerprint,
    })
    if (!updated) throw new Error('未能保存修稿预览')
    return updated
  })
}

/**
 * 单一的修稿采用事务：检查预览的基线 → 保存采用前快照 → 写入目标 → 保存采用后版本
 * → 标记任务完成。任何一步失败都会回滚，重复调用则返回同一采用结果。
 */
export function adoptRevisionTask(db: DB, id: string): RevisionTaskAdoptResult {
  try {
    return db.transaction((tx) => {
      const transaction = tx as DB
      const task = requireTask(transaction, id)
      if (task.status === 'applied' && task.appliedVersionId) {
        return {
          ok: true,
          task,
          beforeVersion: task.undoVersionId ? creativeRepo.getContentVersion(transaction, task.undoVersionId) : undefined,
          appliedVersion: creativeRepo.getContentVersion(transaction, task.appliedVersionId),
          alreadyApplied: true,
        }
      }
      if (task.status !== 'preview_ready' || !task.preview || !task.previewFingerprint) {
        throw new Error('请先生成并确认最新的修稿预览')
      }

      const before = snapshotTarget(transaction, task)
      if (before.fingerprint !== task.previewFingerprint) {
        throw new Error('目标内容已在预览后发生变化，请重新生成修稿预览')
      }
      validatePreview(task, task.preview, before)

      const beforeVersion = creativeRepo.createContentVersion(transaction, {
        projectId: task.projectId,
        targetKind: before.targetKind,
        targetId: before.targetId,
        label: `修稿采用前：${task.title}`,
        source: 'revision_task',
        content: before.content,
        meta: { phase: 'before_adopt', taskId: task.id, targetSnapshot: before.fields, targetFingerprint: before.fingerprint },
      })
      const after = applyPreview(transaction, task, task.preview)
      const appliedVersion = creativeRepo.createContentVersion(transaction, {
        projectId: task.projectId,
        targetKind: after.targetKind,
        targetId: after.targetId,
        label: `修稿采用：${task.title}`,
        source: 'revision_task',
        content: after.content,
        meta: {
          phase: 'after_adopt',
          taskId: task.id,
          beforeVersionId: beforeVersion.id,
          targetSnapshot: after.fields,
          targetFingerprint: after.fingerprint,
        },
      })
      const updated = creativeRepo.updateRevisionTask(transaction, task.id, {
        status: 'applied',
        appliedVersionId: appliedVersion.id,
        undoVersionId: beforeVersion.id,
        preview: undefined,
        previewFingerprint: undefined,
      })
      if (!updated) throw new Error('未能更新修稿任务状态')
      return { ok: true, task: updated, beforeVersion, appliedVersion }
    })
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/** 一步撤销只恢复同一任务的采用前快照；采用后的后续人工编辑不会被静默覆盖。 */
export function undoRevisionTask(db: DB, id: string): RevisionTaskUndoResult {
  try {
    return db.transaction((tx) => {
      const transaction = tx as DB
      const task = requireTask(transaction, id)
      if (task.status !== 'applied' || !task.undoVersionId || !task.appliedVersionId) {
        throw new Error('当前修稿任务没有可撤销的采用记录')
      }
      const beforeVersion = creativeRepo.getContentVersion(transaction, task.undoVersionId)
      const appliedVersion = creativeRepo.getContentVersion(transaction, task.appliedVersionId)
      if (!beforeVersion || !appliedVersion) throw new Error('修稿版本记录不完整，无法安全撤销')
      const expectedFingerprint = stringMeta(appliedVersion.meta?.targetFingerprint)
      const current = snapshotTarget(transaction, task)
      if (!expectedFingerprint || current.fingerprint !== expectedFingerprint) {
        throw new Error('采用后内容已继续编辑，请使用版本记录手动恢复以避免覆盖')
      }
      const beforeSnapshot = snapshotFromVersion(beforeVersion)
      const restored = applySnapshot(transaction, beforeSnapshot)
      const result = creativeRepo.createContentVersion(transaction, {
        projectId: task.projectId,
        targetKind: restored.targetKind,
        targetId: restored.targetId,
        label: `撤销修稿采用：${task.title}`,
        source: 'restore',
        content: restored.content,
        meta: {
          phase: 'undo_adopt',
          taskId: task.id,
          restoreFromVersionId: beforeVersion.id,
          replacedVersionId: appliedVersion.id,
          targetSnapshot: restored.fields,
          targetFingerprint: restored.fingerprint,
        },
      })
      const updated = creativeRepo.updateRevisionTask(transaction, task.id, { status: 'undone' })
      if (!updated) throw new Error('未能记录修稿撤销状态')
      return { ok: true, task: updated, result }
    })
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

function requireTask(db: DB, id: string): RevisionTask {
  const task = creativeRepo.getRevisionTask(db, id)
  if (!task) throw new Error('未找到修稿任务')
  if (!task.targetId || !isTextTarget(task.targetKind)) throw new Error('当前修稿任务目标不支持原子采用')
  return task
}

function snapshotTarget(db: DB, task: RevisionTask): RevisionSnapshot {
  const targetId = task.targetId!
  if (task.targetKind === 'chapter') {
    const chapter = chapterRepo.getChapter(db, targetId)
    if (!chapter) throw new Error('未找到章节')
    return makeSnapshot('chapter', chapter.id, chapter.content, { content: chapter.content })
  }
  if (task.targetKind === 'script') {
    const script = scriptRepo.getScript(db, targetId)
    if (!script) throw new Error('未找到剧本')
    return makeSnapshot('script', script.id, script.content, scriptFields(script))
  }
  const shot = shotRepo.getShot(db, targetId)
  if (!shot) throw new Error('未找到镜头')
  const fields = shotFields(shot)
  return makeSnapshot('shot', shot.id, renderShotPrompt(fields), fields)
}

function validatePreview(task: RevisionTask, preview: TextDiffPreviewPayload, snapshot: RevisionSnapshot): void {
  const previewTargetId = preview.targetKind === 'shot' ? preview.shotId ?? preview.targetId : preview.targetId
  if (preview.targetKind !== snapshot.targetKind || previewTargetId !== snapshot.targetId || task.targetId !== snapshot.targetId) {
    throw new Error('修稿预览与任务目标不一致')
  }
  if (preview.currentContent !== snapshot.content) {
    throw new Error('目标内容已在生成预览期间发生变化，请重新生成修稿预览')
  }
}

function applyPreview(db: DB, task: RevisionTask, preview: TextDiffPreviewPayload): RevisionSnapshot {
  if (task.targetKind === 'chapter') {
    const updated = chapterRepo.updateChapterContent(db, task.targetId!, preview.nextContent)
    if (!updated) throw new Error('未找到要更新的章节')
    return makeSnapshot('chapter', updated.id, updated.content, { content: updated.content })
  }
  if (task.targetKind === 'script') {
    if (!preview.script || preview.script.content !== preview.nextContent) throw new Error('剧本修稿预览数据无效')
    const updated = scriptRepo.updateScript(db, task.targetId!, preview.script)
    if (!updated) throw new Error('未找到要更新的剧本')
    return makeSnapshot('script', updated.id, updated.content, scriptFields(updated))
  }
  const updated = shotRepo.updateShot(db, task.targetId!, preview.shotPatch ?? {})
  if (!updated) throw new Error('未找到要更新的镜头')
  shotRepo.appendPromptVersion(db, {
    shotId: updated.id,
    taskType: preview.taskType,
    videoPrompt: updated.videoPrompt,
    negativePrompt: updated.negativePrompt,
    imagePrompt: updated.imagePrompt,
    note: preview.note,
  })
  const fields = shotFields(updated)
  return makeSnapshot('shot', updated.id, renderShotPrompt(fields), fields)
}

function applySnapshot(db: DB, snapshot: RevisionSnapshot): RevisionSnapshot {
  if (snapshot.targetKind === 'chapter') {
    const updated = chapterRepo.updateChapterContent(db, snapshot.targetId, snapshot.content)
    if (!updated) throw new Error('未找到要恢复的章节')
    return makeSnapshot('chapter', updated.id, updated.content, { content: updated.content })
  }
  if (snapshot.targetKind === 'script') {
    const updated = scriptRepo.updateScript(db, snapshot.targetId, snapshot.fields)
    if (!updated) throw new Error('未找到要恢复的剧本')
    return makeSnapshot('script', updated.id, updated.content, scriptFields(updated))
  }
  const updated = shotRepo.updateShot(db, snapshot.targetId, snapshot.fields)
  if (!updated) throw new Error('未找到要恢复的镜头')
  shotRepo.appendPromptVersion(db, {
    shotId: updated.id,
    taskType: 'restore_shot_prompt',
    videoPrompt: updated.videoPrompt,
    negativePrompt: updated.negativePrompt,
    imagePrompt: updated.imagePrompt,
    note: '撤销修稿采用',
  })
  const fields = shotFields(updated)
  return makeSnapshot('shot', updated.id, renderShotPrompt(fields), fields)
}

function snapshotFromVersion(version: ContentVersion): RevisionSnapshot {
  const fields = objectMeta(version.meta?.targetSnapshot)
  if (!isTextTarget(version.targetKind) || !fields) throw new Error('采用前版本快照无效')
  return makeSnapshot(version.targetKind, version.targetId, version.content, fields)
}

function makeSnapshot(
  targetKind: RevisionSnapshot['targetKind'],
  targetId: string,
  content: string,
  fields: Record<string, unknown>,
): RevisionSnapshot {
  return { targetKind, targetId, content, fields, fingerprint: fingerprint({ targetKind, targetId, fields }) }
}

function scriptFields(script: {
  title: string; content: string; hook?: string; mainConflict?: string; emotionalBeat?: string; reversal?: string; cliffhanger?: string; estimatedDuration?: string
}): Record<string, unknown> {
  return {
    title: script.title,
    content: script.content,
    hook: script.hook,
    mainConflict: script.mainConflict,
    emotionalBeat: script.emotionalBeat,
    reversal: script.reversal,
    cliffhanger: script.cliffhanger,
    estimatedDuration: script.estimatedDuration,
  }
}

function shotFields(shot: { videoPrompt: string; negativePrompt?: string; imagePrompt?: string }): Record<string, unknown> {
  return { videoPrompt: shot.videoPrompt, negativePrompt: shot.negativePrompt, imagePrompt: shot.imagePrompt }
}

function renderShotPrompt(fields: Record<string, unknown>): string {
  return [
    `视频 Prompt:\n${stringMeta(fields.videoPrompt) ?? ''}`,
    `负面 Prompt:\n${stringMeta(fields.negativePrompt) ?? ''}`,
    `图片 Prompt:\n${stringMeta(fields.imagePrompt) ?? ''}`,
  ].join('\n\n')
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}

function objectMeta(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function stringMeta(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isTextTarget(value: RevisionTask['targetKind']): value is RevisionSnapshot['targetKind'] {
  return value === 'chapter' || value === 'script' || value === 'shot'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
