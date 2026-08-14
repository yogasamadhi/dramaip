import { ipcMain } from 'electron'
import { createManualDatabaseBackup, listDatabaseBackups, restoreDatabaseBackup } from '../db'

export function registerDataBackupIpc(): void {
  ipcMain.handle('dataBackup:list', () => listDatabaseBackups())
  ipcMain.handle('dataBackup:create', () => createManualDatabaseBackup())
  ipcMain.handle('dataBackup:restore', (_e, backupPath: string) => restoreDatabaseBackup(backupPath))
}
