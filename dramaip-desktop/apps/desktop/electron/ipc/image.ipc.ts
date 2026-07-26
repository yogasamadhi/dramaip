import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { createImageGenerationTask } from '@sdns/ai'
import { getRepos } from '../db'
import { createImageAssetArchiver } from '../image-assets'
import {
  createImageProviderConfigWithSecret,
  deleteImageProviderConfigWithSecret,
  maskImageProviderConfig,
  updateImageProviderConfigWithSecret,
} from '../secrets'
import { beginLongTaskRun, finishLongTaskRun } from '../task-runtime'

export function registerImageIpc(): void {
  const repos = () => getRepos()
  const imageAssetArchiver = createImageAssetArchiver()

  ipcMain.handle('imageProvider:list', () => repos().imageProviderConfig.listImageProviderConfigs(repos().db).map(maskImageProviderConfig))
  ipcMain.handle('imageProvider:getDefault', () => {
    const config = repos().imageProviderConfig.getDefaultImageProviderConfig(repos().db)
    return config ? maskImageProviderConfig(config) : undefined
  })
  ipcMain.handle('imageProvider:create', async (_event, data: unknown) =>
    maskImageProviderConfig(await createImageProviderConfigWithSecret(repos(), data)),
  )
  ipcMain.handle('imageProvider:update', async (_event, id: string, patch: unknown) => {
    const updated = await updateImageProviderConfigWithSecret(repos(), id, patch)
    return updated ? maskImageProviderConfig(updated) : undefined
  })
  ipcMain.handle('imageProvider:delete', async (_event, id: string) => {
    await deleteImageProviderConfigWithSecret(repos(), id)
    return true
  })
  ipcMain.handle('imageProvider:setDefault', (_event, id: string) => {
    repos().imageProviderConfig.setDefaultImageProviderConfig(repos().db, id)
    return true
  })

  ipcMain.handle('imageTask:create', async (_event, input: ImageTaskInput) => {
    const r = repos()
    const longTaskId = randomUUID()
    const runtime = beginLongTaskRun('image', longTaskId)
    if (!runtime.ok) return { ok: false, error: runtime.error }
    try {
      return await createImageGenerationTask({ repos: r, imageAssetArchiver }, input, runtime.signal, { longTaskId })
    } finally {
      finishLongTaskRun(longTaskId)
    }
  })
}

interface ImageTaskInput {
  providerConfigId: string
  projectId: string
  shotId: string
  kind: 'still' | 'first_frame' | 'last_frame' | 'cover'
  prompt: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  quality?: 'low' | 'medium' | 'high'
  outputFormat?: 'png' | 'jpeg' | 'webp'
}
