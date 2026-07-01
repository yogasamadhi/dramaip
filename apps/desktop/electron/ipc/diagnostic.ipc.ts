import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import {
  createDiagnosticFileName,
  createDiagnosticPackage,
  serializeDiagnosticPackage,
  type DiagnosticExportOptions,
} from '../diagnostics'
import { getDatabaseRuntimeInfo } from '../db'
import { getLogFilePaths, logger } from '../logger'

export function registerDiagnosticIpc(): void {
  ipcMain.handle('diagnostic:exportPackage', async (_event, options: DiagnosticExportOptions = {}) => {
    try {
      const database = getDatabaseRuntimeInfo()
      const pkg = createDiagnosticPackage({
        appName: app.getName(),
        appVersion: app.getVersion(),
        userDataPath: database.userData,
        dbPath: database.dbPath,
        migration: database.migration,
        logFilePaths: getLogFilePaths(),
        includeContent: options.includeContent === true,
      })

      const win = BrowserWindow.getFocusedWindow()
      const saveOptions = {
        title: '导出诊断包',
        defaultPath: createDiagnosticFileName(),
        filters: [{ name: '诊断包 JSON', extensions: ['json'] }],
      }
      const result = win
        ? await dialog.showSaveDialog(win, saveOptions)
        : await dialog.showSaveDialog(saveOptions)
      if (result.canceled || !result.filePath) return { saved: false as const }

      await writeFile(result.filePath, serializeDiagnosticPackage(pkg), 'utf8')
      logger.info('diagnostic', 'diagnostic package exported', {
        includeContent: pkg.meta.includeContent,
        logLines: pkg.logs.recent.length,
        errorLines: pkg.logs.recentErrors.length,
      })

      return {
        saved: true as const,
        path: result.filePath,
        summary: {
          includeContent: pkg.meta.includeContent,
          logLines: pkg.logs.recent.length,
          errorLines: pkg.logs.recentErrors.length,
          appliedMigrationVersion: pkg.database.migration.appliedVersion,
          latestMigrationVersion: pkg.database.migration.latestVersion,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('diagnostic', 'diagnostic package export failed', { message })
      return { saved: false as const, error: '诊断包导出失败：' + message }
    }
  })
}
