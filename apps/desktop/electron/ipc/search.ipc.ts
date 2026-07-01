import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerSearchIpc(): void {
  ipcMain.handle('search:global', (_e, input: { query: string; limit?: number }) => {
    const repos = getRepos()
    return repos.search.globalSearch(repos.db, input)
  })
}
