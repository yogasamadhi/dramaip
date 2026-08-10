import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import type { ProjectAsset } from '@sdns/core'
import { getRepos } from '../db'
import { projectAssetKindDir, projectAssetRelativePath, safeAssetFileName } from '../asset-library'
import { assertReadableImportFile } from '../file-security'

export function registerAssetIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('asset:listByProject', async (_e, projectId: string) => {
    const r = repos()
    return Promise.all(r.asset.listProjectAssets(r.db, projectId).map((asset) => refreshAssetStatus(r, asset)))
  })
  ipcMain.handle('asset:listBySource', async (_e, sourceEntityKind: string, sourceEntityId: string) => {
    const r = repos()
    return Promise.all(r.asset.listAssetsBySource(r.db, sourceEntityKind, sourceEntityId).map((asset) => refreshAssetStatus(r, asset)))
  })
  ipcMain.handle('asset:create', async (_e, data: Partial<ProjectAsset>) => {
    const r = repos()
    const created = r.asset.createAsset(r.db, await normalizeAssetPayload(data) as never)
    return refreshAssetStatus(r, created)
  })
  ipcMain.handle('asset:update', async (_e, id: string, patch: Partial<ProjectAsset>) => {
    const r = repos()
    const updated = r.asset.updateAsset(r.db, id, await normalizeAssetPayload(patch))
    return updated ? refreshAssetStatus(r, updated) : undefined
  })
  ipcMain.handle('asset:delete', (_e, id: string) => {
    const r = repos()
    r.asset.deleteAsset(r.db, id)
    return true
  })
  ipcMain.handle('asset:chooseLocalFile', async (_e, kind: ProjectAsset['kind']) => {
    const filters = assetFileFilters(kind)
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const result = win
      ? await dialog.showOpenDialog(win, { title: '选择本地素材引用', filters, properties: ['openFile'] })
      : await dialog.showOpenDialog({ title: '选择本地素材引用', filters, properties: ['openFile'] })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    const path = result.filePaths[0]
    return { ok: true, path, name: path.split(/[\\/]/).at(-1) }
  })
}

function assetFileFilters(kind: ProjectAsset['kind']) {
  if (kind === 'narration_audio' || kind === 'dialogue_audio' || kind === 'bgm_audio' || kind === 'sfx_audio' || kind === 'voice_reference') return [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac'] }]
  if (kind === 'subtitle_file') return [{ name: '字幕文件', extensions: ['srt', 'vtt', 'ass', 'ssa'] }]
  if (kind === 'rights_evidence') return [{ name: '授权证明', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'docx'] }]
  return [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }]
}

async function normalizeAssetPayload<T extends Partial<ProjectAsset>>(input: T): Promise<T> {
  const next: Partial<ProjectAsset> = { ...input }
  if (next.localPath?.startsWith('file://')) {
    try {
      next.localPath = fileURLToPath(next.localPath)
    } catch {
      /* keep original value; validation and refresh will surface missing */
    }
  }
  if (!next.status) {
    next.status = next.localPath ? 'available' : next.remoteUrl ? 'remote_only' : 'missing'
  }
  if (next.kind === 'rights_evidence' && next.projectId && next.localPath) {
    Object.assign(next, await archiveRightsEvidence(next.projectId, next.localPath))
  }
  return next as T
}

async function archiveRightsEvidence(projectId: string, sourcePath: string): Promise<Pick<ProjectAsset, 'localPath' | 'relativePath' | 'originalName' | 'sha256' | 'sizeBytes' | 'status'>> {
  await assertReadableImportFile('rightsEvidence', sourcePath)
  const originalName = sourcePath.split(/[\\/]/).at(-1) || 'rights-evidence'
  const fileName = `${randomUUID()}-${safeAssetFileName(originalName)}`
  const directory = projectAssetKindDir(app.getPath('userData'), projectId, 'rights_evidence')
  const localPath = join(directory, fileName)
  await mkdir(directory, { recursive: true })
  await copyFile(sourcePath, localPath)
  const bytes = await readFile(localPath)
  const details = await stat(localPath)
  return {
    localPath,
    relativePath: projectAssetRelativePath(projectId, 'rights_evidence', fileName),
    originalName,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: details.size,
    status: 'available',
  }
}

async function refreshAssetStatus(r: ReturnType<typeof getRepos>, asset: ProjectAsset): Promise<ProjectAsset> {
  let status: ProjectAsset['status'] = asset.status
  if (asset.localPath) {
    try {
      await access(asset.localPath)
      status = 'available'
    } catch {
      status = 'missing'
    }
  } else if (asset.remoteUrl) {
    status = 'remote_only'
  } else {
    status = 'missing'
  }
  if (status === asset.status) return asset
  return r.asset.updateAsset(r.db, asset.id, { status }) ?? { ...asset, status }
}
