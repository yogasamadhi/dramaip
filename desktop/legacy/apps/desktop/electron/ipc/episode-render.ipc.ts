import { ipcMain } from 'electron'
import { listEpisodeRenderHistory, preflightEpisodeRender, startEpisodeRender } from '../episode-render'
import { getRepos } from '../db'

/** Final MP4 rendering stays in Electron main: paths, FFmpeg and archives never cross into React. */
export function registerEpisodeRenderIpc(): void {
  ipcMain.handle('episodeRender:listByEpisode', async (_event, input) => listEpisodeRenderHistory(getRepos(), input))
  ipcMain.handle('episodeRender:preflight', async (_event, input) => preflightEpisodeRender(getRepos(), input))
  ipcMain.handle('episodeRender:start', async (_event, input) => startEpisodeRender(getRepos(), input))
}
