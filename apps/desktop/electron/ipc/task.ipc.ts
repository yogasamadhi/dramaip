import { ipcMain } from 'electron'
import { getRepos } from '../db'
import { retryVideoTask } from '@sdns/ai'
import { runAiTask } from './ai.ipc'
import { createVideoAssetArchiver } from '../video-assets'
import { beginLongTaskRun, cancelLongTaskRun, finishLongTaskRun, isLongTaskRunActive } from '../task-runtime'
import {
  createBatchProgress,
  isBatchProgress,
  pendingBatchItems,
  resetIncompleteBatchItems,
  summarizeBatchProgress,
  updateBatchItem,
} from '../batch-progress'
import type { BatchTaskItem, BatchTaskProgress, LongTask } from '@sdns/core'

interface BatchTaskRunInput {
  kind: 'scripts' | 'shots'
  projectId?: string
  adaptationProjectId: string
  episodeIds?: string[]
  sceneIds?: string[]
  limit?: number
}

type LongTaskOpResult = { ok: boolean; error?: string; longTaskId?: string; task?: LongTask }

export function registerTaskIpc(): void {
  const repos = () => getRepos()
  const videoAssetArchiver = createVideoAssetArchiver()

  ipcMain.handle('longTask:list', (_e, projectId?: string) => {
    const r = repos()
    return projectId ? r.longTask.listLongTasksByProject(r.db, projectId) : r.longTask.listLongTasks(r.db)
  })
  ipcMain.handle('longTask:get', (_e, id: string) => repos().longTask.getLongTask(repos().db, id))
  ipcMain.handle('longTask:cancel', (_e, id: string) => {
    const r = repos()
    const task = r.longTask.getLongTask(r.db, id)
    if (!task) return { ok: false, error: '未找到任务' }
    if (task.status !== 'pending' && task.status !== 'running') return { ok: false, error: '任务已结束，不能取消' }
    cancelLongTaskRun(task.id)
    const updated = r.longTask.finishLongTask(r.db, task.id, 'canceled', { errorMessage: '任务已取消' })
    if (task.kind === 'video' && task.relatedEntityId) {
      r.videoTask.updateVideoTask(r.db, task.relatedEntityId, { status: 'canceled' })
    }
    return { ok: true, task: updated }
  })
  ipcMain.handle('longTask:retry', async (_e, id: string) => {
    const r = repos()
    const task = r.longTask.getLongTask(r.db, id)
    if (!task) return { ok: false, error: '未找到任务' }
    if (task.kind === 'batch') {
      if (task.status === 'success') return { ok: false, error: '批量任务已完成，无需重跑' }
      if (task.status === 'running' && isLongTaskRunActive(task.id)) return { ok: false, error: '批量任务正在运行' }
      return resumeBatchLongTask(r, task.id)
    }
    if (task.status !== 'failed') return { ok: false, error: '只有失败任务可以重试' }
    if (task.kind === 'ai') {
      const retryInput = toAiRetryInput(task.input?.retryInput)
      if (!retryInput) return { ok: false, error: '该 AI 任务缺少可重试输入，请回到原页面重新发起。' }
      const result = await runAiTask(retryInput)
      return { ok: result.ok, error: result.error, longTaskId: result.longTaskId, task: r.longTask.getLongTask(r.db, result.longTaskId) }
    }
    if (!task.relatedEntityId) return { ok: false, error: '该视频任务缺少关联任务，无法重试' }
    return retryVideoLongTask(r, task.relatedEntityId, videoAssetArchiver)
  })
  ipcMain.handle('batchTask:run', async (_e, input: BatchTaskRunInput) => {
    return startBatchLongTask(repos(), input)
  })
}

async function startBatchLongTask(
  repos: ReturnType<typeof getRepos>,
  input: BatchTaskRunInput,
): Promise<LongTaskOpResult> {
  const progress = createBatchProgress(input.kind, batchTitle(input.kind), createBatchItems(repos, input))
  const longTask = repos.longTask.createLongTask(repos.db, {
    kind: 'batch',
    title: progress.title,
    taskType: input.kind === 'scripts' ? 'batch_generate_ai_drama_script' : 'batch_split_scene_to_shots',
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    input: {
      batchInput: {
        kind: input.kind,
        projectId: input.projectId,
        adaptationProjectId: input.adaptationProjectId,
        episodeIds: input.episodeIds,
        sceneIds: input.sceneIds,
        limit: input.limit,
      },
      itemCount: progress.total,
    },
    output: progress,
  })
  return runBatchLongTask(repos, longTask.id, progress)
}

async function resumeBatchLongTask(
  repos: ReturnType<typeof getRepos>,
  longTaskId: string,
): Promise<LongTaskOpResult> {
  const task = repos.longTask.getLongTask(repos.db, longTaskId)
  if (!task) return { ok: false, error: '未找到批量任务' }
  if (task.kind !== 'batch') return { ok: false, error: '不是批量任务' }
  if (!isBatchProgress(task.output)) return { ok: false, error: '批量任务缺少进度明细，无法重跑' }
  const progress = resetIncompleteBatchItems(task.output)
  repos.longTask.updateLongTask(repos.db, task.id, { output: progress, errorMessage: undefined })
  return runBatchLongTask(repos, task.id, progress)
}

async function runBatchLongTask(
  repos: ReturnType<typeof getRepos>,
  longTaskId: string,
  initialProgress: BatchTaskProgress,
): Promise<LongTaskOpResult> {
  const runtime = beginLongTaskRun('batch', longTaskId)
  if (!runtime.ok) {
    const failed = repos.longTask.finishLongTask(repos.db, longTaskId, 'failed', { errorMessage: runtime.error })
    return { ok: false, error: runtime.error, longTaskId, task: failed }
  }

  repos.longTask.markLongTaskRunning(repos.db, longTaskId)
  let progress = writeBatchProgress(repos, longTaskId, summarizeBatchProgress(initialProgress))

  try {
    for (const item of pendingBatchItems(progress)) {
      if (isBatchCanceled(repos, longTaskId, runtime.signal)) {
        progress = writeBatchProgress(repos, longTaskId, updateBatchItem(progress, item.key, { status: 'canceled' }))
        const canceled = repos.longTask.finishLongTask(repos.db, longTaskId, 'canceled', {
          output: progress,
          errorMessage: '任务已取消',
        })
        return { ok: false, error: '任务已取消', longTaskId, task: canceled }
      }

      const currentTarget = inspectBatchTarget(repos, item)
      if (currentTarget.error) {
        progress = writeBatchProgress(repos, longTaskId, updateBatchItem(progress, item.key, {
          status: 'failed',
          error: currentTarget.error,
        }))
        continue
      }
      if (currentTarget.skip) {
        progress = writeBatchProgress(repos, longTaskId, updateBatchItem(progress, item.key, {
          status: 'skipped',
          error: currentTarget.skip,
        }))
        continue
      }

      progress = writeBatchProgress(repos, longTaskId, updateBatchItem(progress, item.key, { status: 'running' }))
      const result = await runAiTask(aiInputForBatchItem(repos, longTaskId, item), { signal: runtime.signal })
      if (isBatchCanceled(repos, longTaskId, runtime.signal)) {
        progress = writeBatchProgress(repos, longTaskId, updateBatchItem(progress, item.key, {
          status: 'canceled',
          longTaskId: result.longTaskId,
          aiRunId: result.aiRunId,
          error: '任务已取消',
        }))
        const canceled = repos.longTask.finishLongTask(repos.db, longTaskId, 'canceled', {
          output: progress,
          errorMessage: '任务已取消',
        })
        return { ok: false, error: '任务已取消', longTaskId, task: canceled }
      }
      progress = writeBatchProgress(repos, longTaskId, updateBatchItem(progress, item.key, {
        status: result.ok ? 'success' : 'failed',
        longTaskId: result.longTaskId,
        aiRunId: result.aiRunId,
        error: result.error,
      }))
    }

    const finalProgress = summarizeBatchProgress(progress)
    const error = finalProgress.failed > 0 ? `批量任务有 ${finalProgress.failed} 项失败` : undefined
    const finished = repos.longTask.finishLongTask(repos.db, longTaskId, error ? 'failed' : 'success', {
      output: finalProgress,
      errorMessage: error,
    })
    return { ok: !error, error, longTaskId, task: finished }
  } catch (error) {
    const canceled = isBatchCanceled(repos, longTaskId, runtime.signal)
    const message = canceled ? '任务已取消' : error instanceof Error ? error.message : String(error)
    const finished = repos.longTask.finishLongTask(repos.db, longTaskId, canceled ? 'canceled' : 'failed', {
      output: progress,
      errorMessage: message,
    })
    return { ok: false, error: message, longTaskId, task: finished }
  } finally {
    finishLongTaskRun(longTaskId)
  }
}

function createBatchItems(repos: ReturnType<typeof getRepos>, input: BatchTaskRunInput): BatchTaskItem[] {
  return input.kind === 'scripts' ? createScriptBatchItems(repos, input) : createShotBatchItems(repos, input)
}

function createScriptBatchItems(repos: ReturnType<typeof getRepos>, input: BatchTaskRunInput): BatchTaskItem[] {
  const episodes = repos.episode.listEpisodes(repos.db, input.adaptationProjectId)
  const selected = new Set(input.episodeIds?.length ? input.episodeIds : episodes.slice(0, input.limit ?? episodes.length).map((ep) => ep.id))
  return episodes
    .filter((episode) => selected.has(episode.id))
    .map((episode) => ({
      key: `episode:${episode.id}`,
      label: `第 ${episode.episodeNumber} 集 · ${episode.title}`,
      targetKind: 'episode',
      targetId: episode.id,
      episodeId: episode.id,
      taskType: 'generate_ai_drama_script',
      status: repos.script.getScriptByEpisode(repos.db, episode.id) ? 'skipped' : 'pending',
    }))
}

function createShotBatchItems(repos: ReturnType<typeof getRepos>, input: BatchTaskRunInput): BatchTaskItem[] {
  const scenes = input.sceneIds?.length
    ? input.sceneIds.map((id) => repos.scene.getScene(repos.db, id)).filter((scene): scene is NonNullable<typeof scene> => Boolean(scene))
    : scriptsForBatch(repos, input).flatMap((script) => repos.scene.listScenesByScript(repos.db, script.id))
  return scenes.map((scene) => ({
    key: `scene:${scene.id}`,
    label: `场景 ${scene.sceneNumber} · ${scene.title}`,
    targetKind: 'scene',
    targetId: scene.id,
    episodeId: scene.episodeId,
    sceneId: scene.id,
    taskType: 'split_scene_to_shots',
    status: repos.shot.listShotsByScene(repos.db, scene.id).length > 0 ? 'skipped' : 'pending',
  }))
}

function scriptsForBatch(repos: ReturnType<typeof getRepos>, input: BatchTaskRunInput) {
  const scripts = repos.script.listScripts(repos.db, input.adaptationProjectId)
  if (!input.episodeIds?.length) return scripts
  const selected = new Set(input.episodeIds)
  return scripts.filter((script) => selected.has(script.episodeId))
}

function batchTitle(kind: BatchTaskRunInput['kind']): string {
  return kind === 'scripts' ? '批量生成剧本' : '批量拆分镜头'
}

function inspectBatchTarget(
  repos: ReturnType<typeof getRepos>,
  item: BatchTaskItem,
): { skip?: string; error?: string } {
  if (item.targetKind === 'episode') {
    if (!repos.episode.getEpisode(repos.db, item.targetId)) return { error: '目标分集不存在' }
    if (repos.script.getScriptByEpisode(repos.db, item.targetId)) return { skip: '已存在剧本，跳过' }
    return {}
  }
  if (!repos.scene.getScene(repos.db, item.targetId)) return { error: '目标场景不存在' }
  if (repos.shot.listShotsByScene(repos.db, item.targetId).length > 0) return { skip: '已存在镜头，跳过' }
  return {}
}

function aiInputForBatchItem(
  repos: ReturnType<typeof getRepos>,
  longTaskId: string,
  item: BatchTaskItem,
): Parameters<typeof runAiTask>[0] {
  const task = repos.longTask.getLongTask(repos.db, longTaskId)
  return {
    projectId: task?.projectId,
    adaptationProjectId: task?.adaptationProjectId,
    episodeId: item.episodeId,
    sceneId: item.sceneId,
    taskType: item.taskType,
  }
}

function writeBatchProgress(
  repos: ReturnType<typeof getRepos>,
  longTaskId: string,
  progress: BatchTaskProgress,
): BatchTaskProgress {
  const next = summarizeBatchProgress(progress)
  repos.longTask.updateLongTask(repos.db, longTaskId, { output: next })
  return next
}

function isBatchCanceled(
  repos: ReturnType<typeof getRepos>,
  longTaskId: string,
  signal?: AbortSignal,
): boolean {
  return Boolean(signal?.aborted || repos.longTask.getLongTask(repos.db, longTaskId)?.status === 'canceled')
}

async function retryVideoLongTask(
  repos: ReturnType<typeof getRepos>,
  videoTaskId: string,
  videoAssetArchiver: ReturnType<typeof createVideoAssetArchiver>,
): Promise<{ ok: boolean; error?: string; longTaskId?: string; task?: unknown }> {
  const original = repos.videoTask.getVideoTask(repos.db, videoTaskId)
  if (!original) return { ok: false, error: '未找到视频任务' }
  const longTask = repos.longTask.createLongTask(repos.db, {
    kind: 'video',
    title: '重试视频生成',
    taskType: 'video_generation',
    projectId: original.projectId,
    episodeId: original.episodeId,
    sceneId: original.sceneId,
    shotId: original.shotId,
    input: {
      retryFrom: original.id,
      hasPrompt: Boolean(original.prompt.trim()),
      hasNegativePrompt: Boolean(original.negativePrompt?.trim()),
      referenceImageCount: original.referenceImageUrls.length,
    },
  })
  repos.longTask.markLongTaskRunning(repos.db, longTask.id)
  const runtime = beginLongTaskRun('video', longTask.id)
  if (!runtime.ok) {
    const failed = repos.longTask.finishLongTask(repos.db, longTask.id, 'failed', { errorMessage: runtime.error })
    return { ok: false, error: runtime.error, longTaskId: longTask.id, task: failed }
  }
  try {
    const result = await retryVideoTask({ repos, videoAssetArchiver }, videoTaskId)
    const current = repos.longTask.getLongTask(repos.db, longTask.id)
    if (current?.status === 'canceled') {
      repos.videoTask.updateVideoTask(repos.db, result.task.id, { status: 'canceled' })
      return { ok: false, error: '任务已取消', longTaskId: longTask.id, task: current }
    }
    const output = { videoTaskId: result.task.id, resultCount: result.results.length }
    const synced = result.task.status === 'success' || result.task.status === 'failed' || result.task.status === 'canceled'
      ? repos.longTask.finishLongTask(repos.db, longTask.id, result.task.status, {
          relatedEntityId: result.task.id,
          errorMessage: result.task.errorMessage,
          output,
        })
      : repos.longTask.updateLongTask(repos.db, longTask.id, {
          status: result.task.status,
          relatedEntityId: result.task.id,
          errorMessage: result.task.errorMessage,
          output,
        })
    return { ok: true, longTaskId: longTask.id, task: synced }
  } catch (error) {
    const failed = repos.longTask.finishLongTask(repos.db, longTask.id, runtime.signal?.aborted ? 'canceled' : 'failed', {
      errorMessage: runtime.signal?.aborted ? '任务已取消' : error instanceof Error ? error.message : String(error),
    })
    return { ok: false, error: failed?.errorMessage, longTaskId: longTask.id, task: failed }
  } finally {
    finishLongTaskRun(longTask.id)
  }
}

function toAiRetryInput(value: unknown): Parameters<typeof runAiTask>[0] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as { taskType?: unknown }
  return typeof input.taskType === 'string' ? value as Parameters<typeof runAiTask>[0] : undefined
}
