// v0.4 改编分集大纲 CRUD（PROJECT_BRIEF.md §17：Repository 不进 React）
import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerAdaptationIpc(): void {
  const repos = () => getRepos()

  // ---------- 改编项目 ----------
  ipcMain.handle('adaptationProject:list', () => repos().adaptationProject.listAdaptationProjects(repos().db))
  ipcMain.handle('adaptationProject:listByProject', (_e, sourceProjectId: string) =>
    repos().adaptationProject.listAdaptationsByProject(repos().db, sourceProjectId),
  )
  ipcMain.handle('adaptationProject:get', (_e, id: string) =>
    repos().adaptationProject.getAdaptationProject(repos().db, id),
  )
  ipcMain.handle('adaptationProject:create', (_e, data: unknown) =>
    repos().adaptationProject.createAdaptationProject(repos().db, data as never),
  )
  ipcMain.handle('adaptationProject:update', (_e, id: string, patch: unknown) =>
    repos().adaptationProject.updateAdaptationProject(repos().db, id, patch as never),
  )
  ipcMain.handle('adaptationProject:delete', (_e, id: string) => {
    repos().adaptationProject.deleteAdaptationProject(repos().db, id)
    return true
  })

  // ---------- 分集 ----------
  ipcMain.handle('episode:list', (_e, adaptationProjectId: string) =>
    repos().episode.listEpisodes(repos().db, adaptationProjectId),
  )
  ipcMain.handle('episode:create', (_e, data: unknown) =>
    repos().episode.createEpisode(repos().db, data as never),
  )
  ipcMain.handle('episode:update', (_e, id: string, patch: unknown) =>
    repos().episode.updateEpisode(repos().db, id, patch as never),
  )
  ipcMain.handle('episode:reorder', (_e, orderedIds: string[]) => {
    repos().episode.reorderEpisodes(repos().db, orderedIds)
    return true
  })
  ipcMain.handle('episode:delete', (_e, id: string) => {
    repos().episode.deleteEpisode(repos().db, id)
    return true
  })

  // ---------- 前 10 集分析 ----------
  ipcMain.handle('episodeAnalysis:get', (_e, adaptationProjectId: string) =>
    repos().episodeAnalysis.getEpisodeAnalysis(repos().db, adaptationProjectId),
  )
  ipcMain.handle('episodeAnalysis:delete', (_e, id: string) => {
    repos().episodeAnalysis.deleteEpisodeAnalysis(repos().db, id)
    return true
  })
}
