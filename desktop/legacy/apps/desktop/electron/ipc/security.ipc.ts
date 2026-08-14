import { ipcMain } from 'electron'
import { getSecretStorageStatus } from '../secrets'
import { getRepos } from '../db'

export function registerSecurityIpc(): void {
  ipcMain.handle('security:getSecretStorageStatus', () => getSecretStorageStatus(getRepos()))
}
