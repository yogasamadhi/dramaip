import { ipcMain } from 'electron'
import { getRepos } from '../db'
import { retryVideoTask } from '@sdns/ai'
import { runAiTask } from './ai.ipc'
import { createVideoAssetArchiver } from '../video-assets'
import { beginLongTaskRun, cancelLongTaskRun, finishLongTaskRun } from '../task-runtime'

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
