import { ipcMain } from 'electron'
import { getRepos } from '../db'
import { createBuiltinDemo } from '../builtin-demo'

export function registerDemoIpc(): void {
  ipcMain.handle('demo:create', () => createBuiltinDemo(getRepos()))
}
