import { ipcMain } from 'electron'
import { writeLog, type LogLevel } from '../logger'

const LEVELS = new Set<LogLevel>(['debug', 'info', 'warn', 'error'])

export function registerLogIpc(): void {
  ipcMain.handle('log:renderer', (_e, level: LogLevel, scope: string, message: string, meta?: unknown) => {
    const safeLevel = LEVELS.has(level) ? level : 'info'
    writeLog(safeLevel, `renderer:${scope}`, message, meta)
    return true
  })
}
