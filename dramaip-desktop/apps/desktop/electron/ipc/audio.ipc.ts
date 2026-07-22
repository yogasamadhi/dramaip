import { ipcMain } from 'electron'
import { initializeAnimaticClips, type AudioTrack, type VoiceProfile } from '@sdns/core'
import { getRepos } from '../db'

export function registerAudioIpc(): void {
  const repos = () => getRepos()
  ipcMain.handle('audio:listVoiceProfiles', (_event, projectId: string) => repos().audio.listVoiceProfilesByProject(repos().db, projectId))
  ipcMain.handle('audio:createVoiceProfile', (_event, data: Omit<VoiceProfile, 'id' | 'status' | 'createdAt' | 'updatedAt'>) => {
    const r = repos()
    if (data.characterId && r.character.getCharacter(r.db, data.characterId)?.projectId !== data.projectId) throw new Error('声音 Profile 的角色不属于当前项目')
    if (data.sampleAssetId && r.asset.getAsset(r.db, data.sampleAssetId)?.projectId !== data.projectId) throw new Error('声音样本不属于当前项目')
    return r.audio.createVoiceProfile(r.db, data)
  })
  ipcMain.handle('audio:adoptVoiceProfile', (_event, id: string) => repos().audio.adoptVoiceProfile(repos().db, id))
  ipcMain.handle('audio:listTracksByEpisode', (_event, episodeId: string) => {
    const r = repos()
    const episode = r.episode.getEpisode(r.db, episodeId)
    if (!episode) return []
    const adaptation = r.adaptationProject.getAdaptationProject(r.db, episode.adaptationProjectId)
    if (!adaptation) return []
    const { shots } = assertEpisodeProject(r, adaptation.sourceProjectId, episodeId)
    const sourceFingerprint = initializeAnimaticClips(shots, []).sourceFingerprint
    for (const track of r.audio.listAudioTracksByEpisode(r.db, episodeId)) {
      const staleReason = track.sourceFingerprint === sourceFingerprint ? undefined : '镜头中的对白、旁白或时长已更新；请从当前分集另存音轨版本。'
      if (staleReason && track.staleReason !== staleReason) r.audio.setAudioTrackStaleState(r.db, track.id, new Date().toISOString(), staleReason)
    }
    return r.audio.listAudioTracksByEpisode(r.db, episodeId)
  })
  ipcMain.handle('audio:saveTrack', (_event, data: Pick<AudioTrack, 'projectId' | 'adaptationProjectId' | 'episodeId' | 'kind' | 'label' | 'sourceFingerprint' | 'clips'>) => {
    const r = repos()
    const { adaptation, shots } = assertEpisodeProject(r, data.projectId, data.episodeId)
    if (adaptation.id !== data.adaptationProjectId) throw new Error('音轨不能写入其他改编项目')
    if (data.sourceFingerprint !== initializeAnimaticClips(shots, []).sourceFingerprint) throw new Error('镜头已更新，请重新初始化音轨后再另存版本')
    const shotIds = new Set(shots.map((shot) => shot.id))
    for (const clip of data.clips) {
      if (clip.shotId && !shotIds.has(clip.shotId)) throw new Error('音频片段引用了其他分集的镜头')
      if (clip.characterId && r.character.getCharacter(r.db, clip.characterId)?.projectId !== data.projectId) throw new Error('音频片段引用了其他项目角色')
      if (clip.assetId && r.asset.getAsset(r.db, clip.assetId)?.projectId !== data.projectId) throw new Error('音频片段素材不属于当前项目')
      if (clip.voiceProfileId && r.audio.listVoiceProfilesByProject(r.db, data.projectId).every((profile) => profile.id !== clip.voiceProfileId)) throw new Error('音频片段声音 Profile 不属于当前项目')
    }
    return r.audio.createAudioTrack(r.db, data)
  })
  ipcMain.handle('audio:adoptTrack', (_event, id: string) => {
    const r = repos()
    const track = r.audio.getAudioTrack(r.db, id)
    if (!track) return undefined
    const { shots } = assertEpisodeProject(r, track.projectId, track.episodeId)
    if (track.sourceFingerprint !== initializeAnimaticClips(shots, []).sourceFingerprint) throw new Error('镜头已更新，不能采用过期音轨')
    return r.audio.adoptAudioTrack(r.db, id)
  })
}

function assertEpisodeProject(repos: ReturnType<typeof getRepos>, projectId: string, episodeId: string) {
  const episode = repos.episode.getEpisode(repos.db, episodeId)
  if (!episode) throw new Error('未找到音轨分集')
  const adaptation = repos.adaptationProject.getAdaptationProject(repos.db, episode.adaptationProjectId)
  if (!adaptation || adaptation.sourceProjectId !== projectId) throw new Error('分集不属于当前项目')
  const script = repos.script.getScriptByEpisode(repos.db, episodeId)
  const shots = script ? repos.scene.listScenesByScript(repos.db, script.id).flatMap((scene) => repos.shot.listShotsByScene(repos.db, scene.id)) : []
  return { adaptation, shots }
}
