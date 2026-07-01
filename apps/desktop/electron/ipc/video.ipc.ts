// v0.7 AI 视频平台对接 IPC（ROADMAP v0.7 §3）
// —— Provider 配置 CRUD + 视频生成任务操作（提交/查询/重试/对比/择优）
import { ipcMain } from 'electron'
import { getRepos } from '../db'
import {
  createVideoGenerationTask,
  checkVideoTaskStatus,
  retryVideoTask,
  compareVideoResults,
  selectBestVideoResult,
} from '@sdns/ai'
import { maskVideoConfig } from '../secrets'
import { logger } from '../logger'
import { createVideoAssetArchiver } from '../video-assets'
import { beginLongTaskRun, finishLongTaskRun } from '../task-runtime'

export function registerVideoIpc(): void {
  const repos = () => getRepos()
  const videoAssetArchiver = createVideoAssetArchiver()

  // ---------- Provider 配置 ----------
  ipcMain.handle('videoProvider:list', () =>
    repos().videoProviderConfig.listVideoProviderConfigs(repos().db).map(maskVideoConfig),
  )
  ipcMain.handle('videoProvider:getDefault', () => {
    const config = repos().videoProviderConfig.getDefaultVideoProviderConfig(repos().db)
    return config ? maskVideoConfig(config) : undefined
  })
  ipcMain.handle('videoProvider:create', (_e, data: unknown) =>
    maskVideoConfig(repos().videoProviderConfig.createVideoProviderConfig(repos().db, data as never)),
  )
  ipcMain.handle('videoProvider:update', (_e, id: string, patch: unknown) => {
    const updated = repos().videoProviderConfig.updateVideoProviderConfig(repos().db, id, patch as never)
    return updated ? maskVideoConfig(updated) : undefined
  })
  ipcMain.handle('videoProvider:delete', (_e, id: string) => {
    repos().videoProviderConfig.deleteVideoProviderConfig(repos().db, id)
    return true
  })
  ipcMain.handle('videoProvider:setDefault', (_e, id: string) => {
    repos().videoProviderConfig.setDefaultVideoProviderConfig(repos().db, id)
    return true
  })

  // ---------- 视频生成任务（同步返回 task + 当前结果） ----------
  ipcMain.handle('videoTask:list', () => repos().videoTask.listVideoTasks(repos().db))
  ipcMain.handle('videoTask:listByShot', (_e, shotId: string) =>
    repos().videoTask.listVideoTasksByShot(repos().db, shotId),
  )
  ipcMain.handle('videoTask:listByEpisode', (_e, episodeId: string) =>
    repos().videoTask.listVideoTasksByEpisode(repos().db, episodeId),
  )
  ipcMain.handle('videoTask:get', (_e, id: string) => repos().videoTask.getVideoTask(repos().db, id))

  // 提交镜头 Prompt 为视频生成任务
  ipcMain.handle(
    'videoTask:create',
    async (_e, input: {
      providerConfigId: string
      projectId?: string
      episodeId?: string
      sceneId?: string
      shotId?: string
      prompt: string
      negativePrompt?: string
      referenceImageUrls?: string[]
      note?: string
    }) => {
      const r = repos()
      const longTaskId = createVideoLongTask(r, input, '视频生成')
      const runtime = beginLongTaskRun('video', longTaskId)
      if (!runtime.ok) {
        r.longTask.finishLongTask(r.db, longTaskId, 'failed', { errorMessage: runtime.error })
        return { ok: false, longTaskId, error: runtime.error }
      }
      logger.info('video', 'task create started', { longTaskId, shotId: input.shotId, providerConfigId: input.providerConfigId })
      try {
        const result = await createVideoGenerationTask({ repos: r, videoAssetArchiver }, input)
        if (isLongTaskCanceled(r, longTaskId) || runtime.signal?.aborted) {
          r.videoTask.updateVideoTask(r.db, result.task.id, { status: 'canceled' })
          return { ok: false, longTaskId, error: '任务已取消', task: result.task, results: result.results }
        }
        syncVideoLongTask(r, longTaskId, result.task, result.results)
        logger.info('video', 'task create finished', { longTaskId, videoTaskId: result.task.id, status: result.task.status })
        return { ok: true, longTaskId, ...result }
      } catch (e) {
        const canceled = runtime.signal?.aborted || isLongTaskCanceled(r, longTaskId)
        r.longTask.finishLongTask(r.db, longTaskId, canceled ? 'canceled' : 'failed', {
          errorMessage: canceled ? '任务已取消' : e instanceof Error ? e.message : String(e),
        })
        logger[canceled ? 'warn' : 'error']('video', canceled ? 'task create canceled' : 'task create failed', { longTaskId, error: e instanceof Error ? e.message : String(e) })
        return { ok: false, longTaskId, error: canceled ? '任务已取消' : e instanceof Error ? e.message : String(e) }
      } finally {
        finishLongTaskRun(longTaskId)
      }
    },
  )

  // 查询任务状态（轮询）
  ipcMain.handle('videoTask:checkStatus', async (_e, taskId: string) => {
    const r = repos()
    try {
      const result = await checkVideoTaskStatus({ repos: r, videoAssetArchiver }, taskId)
      const longTask = result.task ? r.longTask.getLongTaskByRelatedEntity(r.db, 'video', result.task.id) : undefined
      if (longTask) syncVideoLongTask(r, longTask.id, result.task, result.results)
      logger.info('video', 'task status checked', { longTaskId: longTask?.id, videoTaskId: taskId, status: result.task.status })
      return { ok: true, longTaskId: longTask?.id, ...result }
    } catch (e) {
      logger.error('video', 'task status failed', { videoTaskId: taskId, error: e instanceof Error ? e.message : String(e) })
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 失败重试（返回新任务）
  ipcMain.handle('videoTask:retry', async (_e, taskId: string, providerConfigId?: string) => {
    const r = repos()
    const original = r.videoTask.getVideoTask(r.db, taskId)
    if (!original) return { ok: false, error: '未找到视频任务' }
    const longTaskId = createVideoLongTask(
      r,
      {
        projectId: original.projectId,
        episodeId: original.episodeId,
        sceneId: original.sceneId,
        shotId: original.shotId,
        prompt: original.prompt,
        negativePrompt: original.negativePrompt,
        referenceImageUrls: original.referenceImageUrls,
        note: original.note,
      },
      '重试视频生成',
    )
    const runtime = beginLongTaskRun('video', longTaskId)
    if (!runtime.ok) {
      r.longTask.finishLongTask(r.db, longTaskId, 'failed', { errorMessage: runtime.error })
      return { ok: false, longTaskId, error: runtime.error }
    }
    logger.info('video', 'task retry started', { longTaskId, originalTaskId: taskId, providerConfigId })
    try {
      const result = await retryVideoTask({ repos: r, videoAssetArchiver }, taskId, providerConfigId)
      if (isLongTaskCanceled(r, longTaskId) || runtime.signal?.aborted) {
        r.videoTask.updateVideoTask(r.db, result.task.id, { status: 'canceled' })
        return { ok: false, longTaskId, error: '任务已取消', task: result.task, results: result.results }
      }
      syncVideoLongTask(r, longTaskId, result.task, result.results)
      logger.info('video', 'task retry finished', { longTaskId, videoTaskId: result.task.id, status: result.task.status })
      return { ok: true, longTaskId, ...result }
    } catch (e) {
      const canceled = runtime.signal?.aborted || isLongTaskCanceled(r, longTaskId)
      r.longTask.finishLongTask(r.db, longTaskId, canceled ? 'canceled' : 'failed', {
        errorMessage: canceled ? '任务已取消' : e instanceof Error ? e.message : String(e),
      })
      logger[canceled ? 'warn' : 'error']('video', canceled ? 'task retry canceled' : 'task retry failed', { longTaskId, originalTaskId: taskId, error: e instanceof Error ? e.message : String(e) })
      return { ok: false, longTaskId, error: canceled ? '任务已取消' : e instanceof Error ? e.message : String(e) }
    } finally {
      finishLongTaskRun(longTaskId)
    }
  })

  ipcMain.handle('videoTask:update', (_e, id: string, patch: unknown) =>
    repos().videoTask.updateVideoTask(repos().db, id, patch as never),
  )
  ipcMain.handle('videoTask:delete', (_e, id: string) => {
    const db = repos().db
    repos().videoResult.deleteVideoResultsByTask(db, id)
    repos().videoTask.deleteVideoTask(db, id)
    return true
  })

  // ---------- 视频结果 ----------
  ipcMain.handle('videoResult:listByTask', (_e, taskId: string) =>
    repos().videoResult.listVideoResultsByTask(repos().db, taskId),
  )
  ipcMain.handle('videoResult:listByShot', (_e, shotId: string) =>
    repos().videoResult.listVideoResultsByShot(repos().db, shotId),
  )
  // 对比同一镜头的多个结果
  ipcMain.handle('videoResult:compare', (_e, shotId: string) =>
    compareVideoResults({ repos: repos() }, shotId),
  )
  // 标记最佳结果
  ipcMain.handle('videoResult:selectBest', (_e, resultId: string) => {
    const updated = selectBestVideoResult({ repos: repos() }, resultId)
    return { ok: !!updated, result: updated }
  })
  ipcMain.handle('videoResult:update', (_e, id: string, patch: unknown) =>
    repos().videoResult.updateVideoResult(repos().db, id, patch as never),
  )
  ipcMain.handle('videoResult:delete', (_e, id: string) => {
    repos().videoResult.deleteVideoResult(repos().db, id)
    return true
  })
}

function isLongTaskCanceled(repos: ReturnType<typeof getRepos>, longTaskId: string): boolean {
  return repos.longTask.getLongTask(repos.db, longTaskId)?.status === 'canceled'
}

function createVideoLongTask(
  repos: ReturnType<typeof getRepos>,
  input: {
    projectId?: string
    episodeId?: string
    sceneId?: string
    shotId?: string
    prompt: string
    negativePrompt?: string
    referenceImageUrls?: string[]
    note?: string
  },
  title: string,
): string {
  const task = repos.longTask.createLongTask(repos.db, {
    kind: 'video',
    title,
    taskType: 'video_generation',
    projectId: input.projectId,
    episodeId: input.episodeId,
    sceneId: input.sceneId,
    shotId: input.shotId,
    input: {
      hasPrompt: Boolean(input.prompt.trim()),
      hasNegativePrompt: Boolean(input.negativePrompt?.trim()),
      referenceImageCount: input.referenceImageUrls?.length ?? 0,
      note: input.note,
    },
  })
  repos.longTask.markLongTaskRunning(repos.db, task.id)
  return task.id
}

function syncVideoLongTask(
  repos: ReturnType<typeof getRepos>,
  longTaskId: string,
  task: { id: string; status: 'pending' | 'running' | 'success' | 'failed' | 'canceled'; errorMessage?: string } | undefined,
  results: unknown[] | undefined,
): void {
  if (!task) return
  const output = { videoTaskId: task.id, resultCount: results?.length ?? 0 }
  if (task.status === 'success' || task.status === 'failed' || task.status === 'canceled') {
    repos.longTask.finishLongTask(repos.db, longTaskId, task.status, {
      relatedEntityId: task.id,
      errorMessage: task.errorMessage,
      output,
    })
    return
  }
  repos.longTask.updateLongTask(repos.db, longTaskId, {
    status: task.status,
    relatedEntityId: task.id,
    output,
  })
}
