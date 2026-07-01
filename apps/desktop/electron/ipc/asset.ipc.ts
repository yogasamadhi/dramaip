import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ipcMain } from 'electron'
import type { ProjectAsset } from '@sdns/core'
import { getRepos } from '../db'

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
    const created = r.asset.createAsset(r.db, normalizeAssetPayload(data) as never)
    return refreshAssetStatus(r, created)
  })
  ipcMain.handle('asset:update', async (_e, id: string, patch: Partial<ProjectAsset>) => {
    const r = repos()
    const updated = r.asset.updateAsset(r.db, id, normalizeAssetPayload(patch))
    return updated ? refreshAssetStatus(r, updated) : undefined
  })
  ipcMain.handle('asset:delete', (_e, id: string) => {
    const r = repos()
    r.asset.deleteAsset(r.db, id)
    return true
  })
}

function normalizeAssetPayload<T extends Partial<ProjectAsset>>(input: T): T {
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
  return next as T
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
