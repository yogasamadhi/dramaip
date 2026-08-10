// v0.3 AI 短剧小说强化系统 CRUD（PROJECT_BRIEF.md §17：Repository 不进 React）
import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerAnalysisIpc(): void {
  const repos = () => getRepos()

  // ---------- 戏剧节拍 ----------
  ipcMain.handle('beat:list', (_e, projectId: string) =>
    repos().beat.listBeats(repos().db, projectId),
  )
  ipcMain.handle('beat:listByChapter', (_e, chapterId: string) =>
    repos().beat.listBeatsByChapter(repos().db, chapterId),
  )
  ipcMain.handle('beat:create', (_e, data: unknown) =>
    repos().beat.createBeat(repos().db, data as never),
  )
  ipcMain.handle('beat:update', (_e, id: string, patch: unknown) =>
    repos().beat.updateBeat(repos().db, id, patch as never),
  )
  ipcMain.handle('beat:delete', (_e, id: string) => {
    repos().beat.deleteBeat(repos().db, id)
    return true
  })

  // ---------- 爽点分析 ----------
  ipcMain.handle('highlight:list', (_e, projectId: string) =>
    repos().highlight.listHighlights(repos().db, projectId),
  )
  ipcMain.handle('highlight:getByChapter', (_e, projectId: string, chapterId: string) =>
    repos().highlight.getHighlightByChapter(repos().db, projectId, chapterId),
  )
  ipcMain.handle('highlight:create', (_e, data: unknown) =>
    repos().highlight.createHighlight(repos().db, data as never),
  )
  ipcMain.handle('highlight:delete', (_e, id: string) => {
    repos().highlight.deleteHighlight(repos().db, id)
    return true
  })

  // ---------- AI 视频可行性 ----------
  ipcMain.handle('feasibility:list', (_e, projectId: string) =>
    repos().feasibility.listFeasibilityReports(repos().db, projectId),
  )
  ipcMain.handle('feasibility:getByChapter', (_e, projectId: string, chapterId: string) =>
    repos().feasibility.getFeasibilityByChapter(repos().db, projectId, chapterId),
  )
  ipcMain.handle('feasibility:create', (_e, data: unknown) =>
    repos().feasibility.createFeasibilityReport(repos().db, data as never),
  )
  ipcMain.handle('feasibility:delete', (_e, id: string) => {
    repos().feasibility.deleteFeasibilityReport(repos().db, id)
    return true
  })

  // ---------- 全书趋势 ----------
  ipcMain.handle('dramaTrend:get', (_e, projectId: string) =>
    repos().dramaTrend.getDramaTrend(repos().db, projectId),
  )
  ipcMain.handle('dramaTrend:delete', (_e, id: string) => {
    repos().dramaTrend.deleteDramaTrend(repos().db, id)
    return true
  })
}
