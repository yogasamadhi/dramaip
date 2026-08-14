import { ipcMain } from 'electron'
import type { AssetRightsRecord, RightsPreflightInput } from '@sdns/core'
import { getRepos } from '../db'

export function registerRightsIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('rights:listByProject', (_event, projectId: string) => {
    const r = repos()
    return r.rights.listAssetRightsByProject(r.db, projectId)
  })
  ipcMain.handle('rights:create', (_event, data: Partial<AssetRightsRecord> & { projectId: string; assetId: string }) => {
    const r = repos()
    assertAssetInProject(r, data.projectId, data.assetId)
    assertEvidenceInProject(r, data.projectId, data.evidenceAssetId, data.evidenceSha256)
    return r.rights.upsertAssetRightsRecord(r.db, data)
  })
  ipcMain.handle('rights:update', (_event, id: string, patch: Partial<AssetRightsRecord>) => {
    const r = repos()
    const current = r.rights.listAssetRightsByProject(r.db, patch.projectId ?? '').find((record) => record.id === id)
      ?? findRightsRecord(r, id)
    if (!current) return undefined
    assertEvidenceInProject(r, current.projectId, patch.evidenceAssetId, patch.evidenceSha256)
    return r.rights.updateAssetRightsRecord(r.db, id, patch)
  })
  ipcMain.handle('rights:preflight', (_event, input: RightsPreflightInput) => {
    const r = repos()
    return r.rights.preflightProjectRights(r.db, input)
  })
}

function findRightsRecord(repos: ReturnType<typeof getRepos>, id: string): AssetRightsRecord | undefined {
  // 本地应用没有跨用户权限模型；通过项目资产反查仍避免 renderer 伪造 evidence 归属。
  for (const project of repos.project.listProjects(repos.db)) {
    const found = repos.rights.listAssetRightsByProject(repos.db, project.id).find((record) => record.id === id)
    if (found) return found
  }
  return undefined
}

function assertAssetInProject(repos: ReturnType<typeof getRepos>, projectId: string, assetId: string): void {
  const asset = repos.asset.getAsset(repos.db, assetId)
  if (!asset || asset.projectId !== projectId) throw new Error('权利记录只能关联当前项目中的资产')
}

function assertEvidenceInProject(
  repos: ReturnType<typeof getRepos>,
  projectId: string,
  evidenceAssetId: string | undefined,
  evidenceSha256: string | undefined,
): void {
  if (!evidenceAssetId) return
  const evidence = repos.asset.getAsset(repos.db, evidenceAssetId)
  if (!evidence || evidence.projectId !== projectId || evidence.kind !== 'rights_evidence') throw new Error('证明文件必须是当前项目受控保存的权利证据资产')
  if (evidenceSha256 && evidence.sha256 && evidenceSha256 !== evidence.sha256) throw new Error('证明文件 hash 与受控资产不一致')
}
