import { ipcMain } from 'electron'
import { listEpisodeComplianceHistory, preflightEpisodeCompliance, startEpisodeCompliance } from '../episode-compliance'
import { getRepos } from '../db'

export function registerEpisodeComplianceIpc(): void {
  ipcMain.handle('compliance:listProfiles', () => getRepos().compliance.listComplianceRuleProfiles(getRepos().db))
  ipcMain.handle('compliance:activateProfile', (_event, id: string) => getRepos().compliance.activateComplianceRuleProfile(getRepos().db, id))
  ipcMain.handle('episodeCompliance:listByEpisode', async (_event, input) => listEpisodeComplianceHistory(getRepos(), input))
  ipcMain.handle('episodeCompliance:preflight', async (_event, input) => preflightEpisodeCompliance(getRepos(), input))
  ipcMain.handle('episodeCompliance:start', async (_event, input) => startEpisodeCompliance(getRepos(), input))
}
