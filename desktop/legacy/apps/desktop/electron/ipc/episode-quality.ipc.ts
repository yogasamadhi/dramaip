import { ipcMain } from 'electron'
import { createEpisodeMinimalRedoPlan, listEpisodeQualityHistory, startEpisodeQuality } from '../episode-quality'
import { getRepos } from '../db'

/** The renderer requests scoped report operations only; local media paths remain in Electron main. */
export function registerEpisodeQualityIpc(): void {
  ipcMain.handle('episodeQuality:listByEpisode', async (_event, input) => listEpisodeQualityHistory(getRepos(), input))
  ipcMain.handle('episodeQuality:start', async (_event, input) => startEpisodeQuality(getRepos(), input))
  ipcMain.handle('episodeQuality:createMinimalRedoPlan', async (_event, input) => createEpisodeMinimalRedoPlan(getRepos(), input))
}
