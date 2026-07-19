import { ipcMain } from 'electron'
import { createCloudProjectSnapshot, deleteCloudProjectSnapshot, listCloudProjectSnapshots, restoreCloudProjectSnapshot } from '../cloud-snapshot'

// Every operation remains an explicit user action. The renderer gets metadata
// and a one-time recovery key, but never an access token or raw envelope.
export function registerCloudSnapshotIpc(): void {
  ipcMain.handle('cloudSnapshot:list', () => listCloudProjectSnapshots())
  ipcMain.handle('cloudSnapshot:create', (_event, input: { projectId: string }) => createCloudProjectSnapshot(input.projectId))
  ipcMain.handle('cloudSnapshot:restore', (_event, input: { snapshotId: string; recoveryKey?: string }) => restoreCloudProjectSnapshot(input.snapshotId, input.recoveryKey))
  ipcMain.handle('cloudSnapshot:delete', async (_event, input: { snapshotId: string }) => {
    await deleteCloudProjectSnapshot(input.snapshotId)
    return { ok: true }
  })
}
