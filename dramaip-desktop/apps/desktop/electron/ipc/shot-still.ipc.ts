import { ipcMain } from 'electron'
import type { ShotStillCandidate } from '@sdns/core'
import { getRepos } from '../db'

/**
 * 静帧候选不直接覆写镜头字段：媒体属于项目资产，候选/采用关系单独保存，
 * 因此用户可以随时采用历史候选来回退，而不会丢掉任何素材记录。
 */
export function registerShotStillIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('shotStill:listByShot', (_event, shotId: string) => {
    const r = repos()
    const shot = r.shot.getShot(r.db, shotId)
    if (!shot) return []
    const candidates = r.shotStill.listShotStillCandidates(r.db, shotId)
    for (const candidate of candidates) {
      const asset = r.asset.getAsset(r.db, candidate.assetId)
      const staleReason = !asset
        ? '引用的静帧素材已不存在；请重新选择候选素材。'
        : candidate.sourceFingerprint !== shot.updatedAt
          ? '镜头的 Prompt 或分镜内容已更新；请复核此静帧，必要时只重做本镜头。'
          : undefined
      if (staleReason && candidate.staleReason !== staleReason) {
        r.shotStill.setShotStillCandidateStaleState(r.db, candidate.id, new Date().toISOString(), staleReason)
      }
    }
    return r.shotStill.listShotStillCandidates(r.db, shotId)
  })

  ipcMain.handle('shotStill:create', (_event, data: Pick<ShotStillCandidate, 'projectId' | 'shotId' | 'assetId' | 'kind' | 'label'> & Pick<Partial<ShotStillCandidate>, 'notes'>) => {
    const r = repos()
    const shot = assertShotProject(r, data.projectId, data.shotId)
    const asset = r.asset.getAsset(r.db, data.assetId)
    if (!asset || asset.projectId !== data.projectId) throw new Error('静帧候选只能引用当前项目的素材')
    // 仅主进程可确定来源版本；renderer 不能伪造“当前”的静帧。
    return r.shotStill.createShotStillCandidate(r.db, { ...data, status: 'candidate', sourceFingerprint: shot.updatedAt })
  })

  ipcMain.handle('shotStill:adopt', (_event, id: string) => {
    const r = repos()
    const candidate = r.shotStill.getShotStillCandidate(r.db, id)
    if (!candidate) return undefined
    const shot = assertShotProject(r, candidate.projectId, candidate.shotId)
    const asset = r.asset.getAsset(r.db, candidate.assetId)
    if (!asset || asset.projectId !== candidate.projectId) throw new Error('候选引用的静帧素材已不存在，不能采用')
    return r.shotStill.adoptShotStillCandidate(r.db, id, shot.updatedAt)
  })
}

function assertShotProject(repos: ReturnType<typeof getRepos>, projectId: string, shotId: string) {
  const shot = repos.shot.getShot(repos.db, shotId)
  if (!shot) throw new Error('未找到静帧所属分镜')
  const scene = repos.scene.getScene(repos.db, shot.sceneId)
  const script = scene ? repos.script.getScript(repos.db, scene.scriptId) : undefined
  const adaptation = script ? repos.adaptationProject.getAdaptationProject(repos.db, script.adaptationProjectId) : undefined
  if (!adaptation || adaptation.sourceProjectId !== projectId) throw new Error('分镜不属于当前项目，不能管理静帧候选')
  return shot
}
