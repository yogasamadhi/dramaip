// v0.6 分镜与镜头 Prompt CRUD（PROJECT_BRIEF.md §17：Repository 不进 React）
import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerShotIpc(): void {
  const repos = () => getRepos()

  // ---------- 镜头 ----------
  ipcMain.handle('shot:listByScene', (_e, sceneId: string) =>
    repos().shot.listShotsByScene(repos().db, sceneId),
  )
  ipcMain.handle('shot:listByEpisode', (_e, episodeId: string) =>
    repos().shot.listShotsByEpisode(repos().db, episodeId),
  )
  ipcMain.handle('shot:get', (_e, id: string) => repos().shot.getShot(repos().db, id))
  ipcMain.handle('shot:create', (_e, data: unknown) =>
    repos().shot.createShot(repos().db, data as never),
  )
  ipcMain.handle('shot:update', (_e, id: string, patch: unknown) =>
    repos().shot.updateShot(repos().db, id, patch as never),
  )
  ipcMain.handle('shot:delete', (_e, id: string) => {
    repos().shot.deleteShot(repos().db, id)
    return true
  })

  // ---------- 镜头审查 ----------
  ipcMain.handle('shotReview:get', (_e, shotId: string) =>
    repos().shotReview.getShotReview(repos().db, shotId),
  )
  ipcMain.handle('shotReview:delete', (_e, id: string) => {
    repos().shotReview.deleteShotReview(repos().db, id)
    return true
  })

  // ---------- Prompt 版本 ----------
  ipcMain.handle('promptVersion:list', (_e, shotId: string) =>
    repos().shot.listPromptVersions(repos().db, shotId),
  )
}
