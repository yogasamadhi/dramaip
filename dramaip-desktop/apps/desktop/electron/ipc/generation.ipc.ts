import { ipcMain } from 'electron'
import { getRepos } from '../db'

/** LM5-07 本地生产账本：只暴露脱敏谱系与费用，不把 Provider 凭据交给 renderer。 */
export function registerGenerationIpc(): void {
  ipcMain.handle('generation:listLineagesByProject', (_event, projectId: string) => {
    const repos = getRepos()
    return repos.generation.listGenerationLineagesByProject(repos.db, projectId)
  })
  ipcMain.handle('generation:listCostsByProject', (_event, projectId: string) => {
    const repos = getRepos()
    return repos.generation.listGenerationCostEntriesByProject(repos.db, projectId)
  })
  ipcMain.handle('generation:updateCost', (_event, id: string, patch: { actualCost?: number; currency?: string; actualCostNote?: string }) => {
    const repos = getRepos()
    return repos.generation.updateGenerationCostEntry(repos.db, id, patch)
  })
}
