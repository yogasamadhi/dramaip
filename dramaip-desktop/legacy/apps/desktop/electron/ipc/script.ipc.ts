// v0.5 AI 短剧剧本 CRUD（PROJECT_BRIEF.md §17：Repository 不进 React）
import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerScriptIpc(): void {
  const repos = () => getRepos()

  // ---------- 剧本 ----------
  ipcMain.handle('script:list', (_e, adaptationProjectId: string) =>
    repos().script.listScripts(repos().db, adaptationProjectId),
  )
  ipcMain.handle('script:get', (_e, id: string) => repos().script.getScript(repos().db, id))
  ipcMain.handle('script:getByEpisode', (_e, episodeId: string) =>
    repos().script.getScriptByEpisode(repos().db, episodeId),
  )
  ipcMain.handle('script:create', (_e, data: unknown) =>
    repos().script.createScript(repos().db, data as never),
  )
  ipcMain.handle('script:update', (_e, id: string, patch: unknown) =>
    repos().script.updateScript(repos().db, id, patch as never),
  )
  ipcMain.handle('script:updateContent', (_e, id: string, content: string) =>
    repos().script.updateScriptContent(repos().db, id, content),
  )
  ipcMain.handle('script:delete', (_e, id: string) => {
    // 级联删除该剧本下的场景与审稿
    const db = repos().db
    repos().scene.deleteScenesByScript(db, id)
    const review = repos().scriptReview.getScriptReview(db, id)
    if (review) repos().scriptReview.deleteScriptReview(db, review.id)
    repos().script.deleteScript(db, id)
    return true
  })

  // ---------- 场景 ----------
  ipcMain.handle('scene:listByScript', (_e, scriptId: string) =>
    repos().scene.listScenesByScript(repos().db, scriptId),
  )
  ipcMain.handle('scene:update', (_e, id: string, patch: unknown) =>
    repos().scene.updateScene(repos().db, id, patch as never),
  )
  ipcMain.handle('scene:delete', (_e, id: string) => {
    repos().scene.deleteScene(repos().db, id)
    return true
  })

  // ---------- 剧本审稿 ----------
  ipcMain.handle('scriptReview:get', (_e, scriptId: string) =>
    repos().scriptReview.getScriptReview(repos().db, scriptId),
  )
  ipcMain.handle('scriptReview:delete', (_e, id: string) => {
    repos().scriptReview.deleteScriptReview(repos().db, id)
    return true
  })
}
