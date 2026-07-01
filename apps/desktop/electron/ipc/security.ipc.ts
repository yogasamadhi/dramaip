import { ipcMain } from 'electron'
import { getSecretStorageStatus } from '../secrets'

export function registerSecurityIpc(): void {
  ipcMain.handle('security:getSecretStorageStatus', () => getSecretStorageStatus())
}
