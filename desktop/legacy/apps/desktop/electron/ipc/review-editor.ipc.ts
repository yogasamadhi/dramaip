import { ipcMain } from 'electron'
import { getRepos } from '../db'
import {
  exportEditorPackage,
  exportOfflineReviewPackage,
  importOfflineReviewComments,
  preflightEditorExport,
  type TimelineScope,
} from '../review-editor'
import {
  deleteCloudReview,
  listCloudReviewWorkspaces,
  publishCloudReview,
  syncCloudReviews,
  type PublishCloudReviewInput,
} from '../cloud-review'

export function registerReviewEditorIpc(): void {
  ipcMain.handle('review:exportOffline', (_event, input: TimelineScope) => exportOfflineReviewPackage(getRepos(), input))
  ipcMain.handle('review:importOffline', () => importOfflineReviewComments(getRepos()))
  ipcMain.handle('review:listCloudWorkspaces', () => listCloudReviewWorkspaces())
  ipcMain.handle('review:publishCloud', (_event, input: PublishCloudReviewInput) => publishCloudReview(getRepos(), input))
  ipcMain.handle('review:sync', async (_event, projectId: string, episodeId?: string) => {
    const r = getRepos()
    let cloudSyncError: string | undefined
    try {
      await syncCloudReviews(r, projectId, episodeId)
    } catch (error) {
      cloudSyncError = error instanceof Error ? error.message : String(error)
    }
    return {
      packages: r.productionStudio.listReviewPackageRecords(r.db, projectId, episodeId),
      comments: r.productionStudio.listReviewPackageRecords(r.db, projectId, episodeId)
        .flatMap((record) => r.productionStudio.listReviewComments(r.db, record.id)),
      decisions: r.productionStudio.listReviewPackageRecords(r.db, projectId, episodeId)
        .flatMap((record) => r.productionStudio.listReviewDecisions(r.db, record.id)),
      cloudSyncError,
    }
  })
  ipcMain.handle('review:delete', (_event, id: string) => deleteCloudReview(getRepos(), id))
  ipcMain.handle('editorExport:preflight', (_event, input: TimelineScope) => preflightEditorExport(getRepos(), input))
  ipcMain.handle('editorExport:export', (_event, input: TimelineScope) => exportEditorPackage(getRepos(), input))
}
