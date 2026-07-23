import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog, ipcMain } from 'electron'
import { getRepos } from '../db'
import { commitFeedbackPreview, createFeedbackRevisionTask, previewFeedbackContent } from '../feedback'

const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export function registerFeedbackIpc(): void {
  ipcMain.handle('feedback:chooseAndPreview', async (_event, kind) => {
    const selected = await dialog.showOpenDialog({ title: kind === 'metrics' ? '选择运营指标 CSV/JSON' : '选择评论 CSV/JSON', properties: ['openFile'], filters: [{ name: '数据文件', extensions: ['csv', 'json'] }] })
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true }
    const content = await readFile(selected.filePaths[0], 'utf8')
    if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) throw new Error('导入文件超过 10 MB 限制；请按时间窗或集数拆分。')
    return { canceled: false, ...previewFeedbackContent({ kind, sourceName: basename(selected.filePaths[0]), content }) }
  })
  ipcMain.handle('feedback:previewText', (_event, input) => ({ canceled: false, ...previewFeedbackContent(input) }))
  ipcMain.handle('feedback:commitPreview', (_event, input) => commitFeedbackPreview(getRepos(), input))
  ipcMain.handle('feedback:listBatches', (_event, projectId: string) => getRepos().feedback.listFeedbackImportBatches(getRepos().db, projectId))
  ipcMain.handle('feedback:listMetrics', (_event, projectId: string) => getRepos().feedback.listFeedbackMetrics(getRepos().db, projectId))
  ipcMain.handle('feedback:listComments', (_event, projectId: string) => getRepos().feedback.listFeedbackComments(getRepos().db, projectId))
  ipcMain.handle('feedback:listClusters', (_event, projectId: string) => getRepos().feedback.listFeedbackCommentClusters(getRepos().db, projectId))
  ipcMain.handle('feedback:clusterBatch', (_event, input) => getRepos().feedback.createFeedbackCommentClusters(getRepos().db, input))
  ipcMain.handle('feedback:deleteClusters', (_event, input) => getRepos().feedback.deleteFeedbackCommentClusters(getRepos().db, input))
  ipcMain.handle('feedback:deleteBatch', (_event, input) => getRepos().feedback.deleteFeedbackImportBatch(getRepos().db, input))
  ipcMain.handle('feedback:createRevisionTask', (_event, input) => createFeedbackRevisionTask(getRepos(), input))
}
