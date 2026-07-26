import { ipcMain } from 'electron'
import type { ShotVisualAssetLock, VisualAssetVersion } from '@sdns/core'
import { getRepos } from '../db'

export function registerVisualAssetIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('visualAsset:listByProject', (_event, projectId: string) => {
    const r = repos()
    return r.visualAsset.listVisualAssetVersionsByProject(r.db, projectId)
  })
  ipcMain.handle('visualAsset:listByOwner', (_event, ownerKind: VisualAssetVersion['ownerKind'], ownerId: string) => {
    const r = repos()
    return r.visualAsset.listVisualAssetVersionsByOwner(r.db, ownerKind, ownerId)
  })
  ipcMain.handle('visualAsset:create', (_event, data: Pick<VisualAssetVersion, 'projectId' | 'ownerKind' | 'ownerId' | 'assetId' | 'slot' | 'label'> & Partial<VisualAssetVersion>) => {
    const r = repos()
    assertVisualOwner(r, data.projectId, data.ownerKind, data.ownerId)
    const asset = r.asset.getAsset(r.db, data.assetId)
    if (!asset || asset.projectId !== data.projectId) throw new Error('视觉资产版本只能引用当前项目的素材')
    // Renderer 只能创建候选；成为默认资产必须经过单独的 adopt 操作，才能统一标记旧分镜锁为 stale。
    return r.visualAsset.createVisualAssetVersion(r.db, { ...data, status: 'candidate' })
  })
  ipcMain.handle('visualAsset:adopt', (_event, id: string) => {
    const r = repos()
    return r.visualAsset.adoptVisualAssetVersion(r.db, id)
  })
  ipcMain.handle('visualAsset:listLocksByShot', (_event, shotId: string) => {
    const r = repos()
    return r.visualAsset.listShotVisualAssetLocks(r.db, shotId)
  })
  ipcMain.handle('visualAsset:lockShot', (_event, data: Pick<ShotVisualAssetLock, 'projectId' | 'shotId' | 'visualAssetVersionId' | 'role'>) => {
    const r = repos()
    const shot = r.shot.getShot(r.db, data.shotId)
    if (!shot) throw new Error('未找到要锁定的分镜')
    const scene = r.scene.getScene(r.db, shot.sceneId)
    const script = scene ? r.script.getScript(r.db, scene.scriptId) : undefined
    const adaptation = script ? r.adaptationProject.getAdaptationProject(r.db, script.adaptationProjectId) : undefined
    if (!adaptation || adaptation.sourceProjectId !== data.projectId) throw new Error('分镜不属于当前项目，不能锁定该项目的视觉资产')
    const version = r.visualAsset.getVisualAssetVersion(r.db, data.visualAssetVersionId)
    if (!version || version.projectId !== data.projectId) throw new Error('分镜只能锁定当前项目的视觉资产版本')
    return r.visualAsset.lockShotVisualAsset(r.db, data)
  })
}

function assertVisualOwner(
  repos: ReturnType<typeof getRepos>,
  projectId: string,
  ownerKind: VisualAssetVersion['ownerKind'],
  ownerId: string,
): void {
  const owner = ownerKind === 'visual_profile'
    ? repos.visualProfile.getVisualProfile(repos.db, ownerId)
    : repos.visualSetting.getVisualSetting(repos.db, ownerId)
  if (!owner || owner.projectId !== projectId) throw new Error('视觉资产版本只能关联当前项目的角色或场景设定')
}
