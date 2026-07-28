import { ipcMain } from 'electron'
import { getRepos } from '../db'
import {
  exportEditorPackage,
  exportOfflineReviewPackage,
  importOfflineReviewComments,
  preflightEditorExport,
  type TimelineScope,
} from '../review-editor'

export function registerReviewEditorIpc(): void {
  ipcMain.handle('review:exportOffline', (_event, input: TimelineScope) => exportOfflineReviewPackage(getRepos(), input))
  ipcMain.handle('review:importOffline', () => importOfflineReviewComments(getRepos()))
  ipcMain.handle('review:publishCloud', () => ({ published: false, error: '云审片服务尚未配置；离线审片包仍可完整使用。' }))
  ipcMain.handle('review:sync', (_event, projectId: string, episodeId?: string) => {
    const r = getRepos()
    return {
      packages: r.productionStudio.listReviewPackageRecords(r.db, projectId, episodeId),
      comments: r.productionStudio.listReviewPackageRecords(r.db, projectId, episodeId)
        .flatMap((record) => r.productionStudio.listReviewComments(r.db, record.id)),
      decisions: r.productionStudio.listReviewPackageRecords(r.db, projectId, episodeId)
        .flatMap((record) => r.productionStudio.listReviewDecisions(r.db, record.id)),
    }
  })
  ipcMain.handle('review:delete', (_event, id: string) => {
    const r = getRepos()
    return r.productionStudio.updateReviewPackageRecord(r.db, id, { status: 'deleted', outputPath: undefined })
  })
  ipcMain.handle('editorExport:preflight', (_event, input: TimelineScope) => preflightEditorExport(getRepos(), input))
  ipcMain.handle('editorExport:export', (_event, input: TimelineScope) => exportEditorPackage(getRepos(), input))
}
