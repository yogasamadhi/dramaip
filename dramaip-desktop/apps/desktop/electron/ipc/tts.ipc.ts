import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { createTtsGenerationTask } from '@sdns/ai'
import { getRepos } from '../db'
import { createTtsAssetArchiver } from '../audio-assets'
import {
  createTtsProviderConfigWithSecret,
  deleteTtsProviderConfigWithSecret,
  maskTtsProviderConfig,
  updateTtsProviderConfigWithSecret,
} from '../secrets'
import { beginLongTaskRun, finishLongTaskRun } from '../task-runtime'

export function registerTtsIpc(): void {
  const repos = () => getRepos()
  const ttsAssetArchiver = createTtsAssetArchiver()

  ipcMain.handle('ttsProvider:list', () => repos().ttsProviderConfig.listTtsProviderConfigs(repos().db).map(maskTtsProviderConfig))
  ipcMain.handle('ttsProvider:getDefault', () => {
    const config = repos().ttsProviderConfig.getDefaultTtsProviderConfig(repos().db)
    return config ? maskTtsProviderConfig(config) : undefined
  })
  ipcMain.handle('ttsProvider:create', async (_event, data: unknown) =>
    maskTtsProviderConfig(await createTtsProviderConfigWithSecret(repos(), data)),
  )
  ipcMain.handle('ttsProvider:update', async (_event, id: string, patch: unknown) => {
    const updated = await updateTtsProviderConfigWithSecret(repos(), id, patch)
    return updated ? maskTtsProviderConfig(updated) : undefined
  })
  ipcMain.handle('ttsProvider:delete', async (_event, id: string) => {
    await deleteTtsProviderConfigWithSecret(repos(), id)
    return true
  })
  ipcMain.handle('ttsProvider:setDefault', (_event, id: string) => {
    repos().ttsProviderConfig.setDefaultTtsProviderConfig(repos().db, id)
    return true
  })

  ipcMain.handle('ttsTask:create', async (_event, input: TtsTaskInput) => {
    const r = repos()
    const longTaskId = randomUUID()
    const runtime = beginLongTaskRun('audio', longTaskId)
    if (!runtime.ok) return { ok: false, error: runtime.error }
    try {
      return await createTtsGenerationTask({ repos: r, ttsAssetArchiver }, input, runtime.signal, { longTaskId })
    } finally {
      finishLongTaskRun(longTaskId)
    }
  })
}

interface TtsTaskInput {
  providerConfigId: string
  projectId: string
  episodeId: string
  shotId?: string
  voiceProfileId?: string
  kind: 'dialogue' | 'narration'
  input: string
  voice: string
  instructions?: string
  speed?: number
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
}
