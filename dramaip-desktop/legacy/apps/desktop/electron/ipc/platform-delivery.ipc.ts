import { ipcMain, shell } from 'electron'
import { getRepos } from '../db'
import { exportPlatformDelivery, listPlatformDeliveryProfiles, preflightPlatformDelivery } from '../platform-delivery'

function assertScope(projectId: string, adaptationProjectId: string): void {
  const repos = getRepos()
  const adaptation = repos.adaptationProject.getAdaptationProject(repos.db, adaptationProjectId)
  if (!adaptation || adaptation.sourceProjectId !== projectId) throw new Error('改编项目不属于当前作品。')
}

/** Local delivery packages are explicit, scoped exports. No creator credential or publish action crosses IPC. */
export function registerPlatformDeliveryIpc(): void {
  ipcMain.handle('platformDelivery:listProfiles', () => listPlatformDeliveryProfiles())
  ipcMain.handle('platformDelivery:listVariants', (_event, input) => {
    assertScope(input.projectId, input.adaptationProjectId)
    const repos = getRepos()
    return repos.platformDelivery.listDeliveryCreativeVariants(repos.db, input.adaptationProjectId)
  })
  ipcMain.handle('platformDelivery:createVariant', (_event, input) => {
    assertScope(input.projectId, input.adaptationProjectId)
    const repos = getRepos()
    if (input.coverAssetId) {
      const asset = repos.asset.getAsset(repos.db, input.coverAssetId)
      if (!asset || asset.projectId !== input.projectId) throw new Error('封面资产不属于当前作品。')
    }
    return repos.platformDelivery.createDeliveryCreativeVariant(repos.db, input)
  })
  ipcMain.handle('platformDelivery:adoptVariant', (_event, input) => {
    assertScope(input.projectId, input.adaptationProjectId)
    const repos = getRepos()
    const variant = repos.platformDelivery.getDeliveryCreativeVariant(repos.db, input.id)
    if (!variant || variant.projectId !== input.projectId || variant.adaptationProjectId !== input.adaptationProjectId) throw new Error('创意候选不属于当前项目。')
    return repos.platformDelivery.adoptDeliveryCreativeVariant(repos.db, input.id)
  })
  ipcMain.handle('platformDelivery:listExports', (_event, input) => {
    assertScope(input.projectId, input.adaptationProjectId)
    const repos = getRepos()
    return repos.platformDelivery.listPlatformDeliveryExports(repos.db, input.projectId, input.episodeId)
  })
  ipcMain.handle('platformDelivery:preflight', async (_event, input) => {
    assertScope(input.projectId, input.adaptationProjectId)
    return preflightPlatformDelivery(getRepos(), input)
  })
  ipcMain.handle('platformDelivery:export', async (_event, input) => {
    assertScope(input.projectId, input.adaptationProjectId)
    return exportPlatformDelivery(getRepos(), input)
  })
  ipcMain.handle('platformDelivery:openExportDirectory', async (_event, input) => {
    assertScope(input.projectId, input.adaptationProjectId)
    const repos = getRepos()
    const record = repos.platformDelivery.getPlatformDeliveryExport(repos.db, input.id)
    if (record && (record.projectId !== input.projectId || record.adaptationProjectId !== input.adaptationProjectId)) throw new Error('交付记录不属于当前项目。')
    if (!record) throw new Error('找不到当前项目的交付记录。')
    return shell.openPath(record.outputDirectory)
  })
}
