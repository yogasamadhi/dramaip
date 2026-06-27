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

export function registerVideoIpc(): void {
  const repos = () => getRepos()

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
      try {
        const result = await createVideoGenerationTask({ repos: repos() }, input)
        return { ok: true, ...result }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
  )

  // 查询任务状态（轮询）
  ipcMain.handle('videoTask:checkStatus', async (_e, taskId: string) => {
    try {
      const result = await checkVideoTaskStatus({ repos: repos() }, taskId)
      return { ok: true, ...result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 失败重试（返回新任务）
  ipcMain.handle('videoTask:retry', async (_e, taskId: string, providerConfigId?: string) => {
    try {
      const result = await retryVideoTask({ repos: repos() }, taskId, providerConfigId)
      return { ok: true, ...result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
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
