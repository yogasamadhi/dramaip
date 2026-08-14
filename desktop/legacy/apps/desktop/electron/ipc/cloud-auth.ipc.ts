import { ipcMain } from 'electron'
import { getCloudAuthStatus, getCloudContext, loginWithSystemBrowser, logoutCloudSession } from '../cloud-auth'
import { listCloudAIModels } from '../cloud-ai'

export function registerCloudAuthIpc(): void {
  ipcMain.handle('cloudAuth:status', () => getCloudAuthStatus())
  ipcMain.handle('cloudAuth:login', () => loginWithSystemBrowser())
  ipcMain.handle('cloudAuth:logout', () => logoutCloudSession())
  ipcMain.handle('cloudAuth:context', () => getCloudContext())
  ipcMain.handle('cloudAI:models', () => listCloudAIModels())
}
