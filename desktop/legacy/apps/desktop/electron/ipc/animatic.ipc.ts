import { ipcMain } from 'electron'
import { initializeAnimaticClips, type AnimaticDraft } from '@sdns/core'
import { getRepos } from '../db'

export function registerAnimaticIpc(): void {
  const repos = () => getRepos()
  ipcMain.handle('animatic:listByEpisode', (_event, episodeId: string) => repos().animatic.listAnimaticDraftsByEpisode(repos().db, episodeId))
  ipcMain.handle('animatic:initialize', (_event, projectId: string, episodeId: string) => {
    const r = repos()
    const { adaptation, shots } = assertEpisodeProject(r, projectId, episodeId)
    const candidates = r.shotStill.listShotStillCandidatesByProject(r.db, projectId).filter((candidate) => shots.some((shot) => shot.id === candidate.shotId))
    const initial = initializeAnimaticClips(shots, candidates)
    return { projectId, adaptationProjectId: adaptation.id, episodeId, ...initial }
  })
  ipcMain.handle('animatic:save', (_event, data: Pick<AnimaticDraft, 'projectId' | 'adaptationProjectId' | 'episodeId' | 'sourceFingerprint' | 'clips' | 'annotations'>) => {
    const r = repos()
    const { adaptation, shots } = assertEpisodeProject(r, data.projectId, data.episodeId)
    if (adaptation.id !== data.adaptationProjectId) throw new Error('Animatic 不能写入其他改编项目')
    if (data.clips.length === 0) throw new Error('Animatic 至少需要一个镜头片段')
    const knownShotIds = new Set(shots.map((shot) => shot.id))
    if (data.clips.some((clip) => !knownShotIds.has(clip.shotId))) throw new Error('Animatic 包含不属于当前分集的镜头')
    if (data.sourceFingerprint !== initializeAnimaticClips(shots, []).sourceFingerprint) {
      throw new Error('镜头已更新，请重新初始化 Animatic 后再另存版本')
    }
    return r.animatic.createAnimaticDraft(r.db, data)
  })
  ipcMain.handle('animatic:review', (_event, id: string, review: { status: 'approved' | 'returned'; reviewNote?: string }) => {
    const r = repos()
    const draft = r.animatic.getAnimaticDraft(r.db, id)
    if (!draft) throw new Error('未找到 Animatic 版本')
    const { shots } = assertEpisodeProject(r, draft.projectId, draft.episodeId)
    if (draft.status !== 'draft') throw new Error('该 Animatic 已有审核结论；请另存新版本后再提交试播')
    if (draft.sourceFingerprint !== initializeAnimaticClips(shots, []).sourceFingerprint) {
      throw new Error('镜头已更新，不能审核过期 Animatic；请重新初始化')
    }
    return r.animatic.reviewAnimaticDraft(r.db, id, review.status, review.reviewNote)
  })
}

function assertEpisodeProject(repos: ReturnType<typeof getRepos>, projectId: string, episodeId: string) {
  const episode = repos.episode.getEpisode(repos.db, episodeId)
  if (!episode) throw new Error('未找到 Animatic 分集')
  const adaptation = repos.adaptationProject.getAdaptationProject(repos.db, episode.adaptationProjectId)
  if (!adaptation || adaptation.sourceProjectId !== projectId) throw new Error('分集不属于当前项目')
  const script = repos.script.getScriptByEpisode(repos.db, episodeId)
  const shots = script ? repos.scene.listScenesByScript(repos.db, script.id).flatMap((scene) => repos.shot.listShotsByScene(repos.db, scene.id)) : []
  return { adaptation, shots }
}
