// v0.2 长篇一致性与视觉记忆系统 CRUD（PROJECT_BRIEF.md §17：Repository 不进 React）
import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerMemoryIpc(): void {
  const repos = () => getRepos()

  // ---------- 章节记忆 ----------
  ipcMain.handle('chapterMemory:list', (_e, projectId: string) =>
    repos().chapterMemory.listChapterMemories(repos().db, projectId),
  )
  ipcMain.handle('chapterMemory:get', (_e, id: string) =>
    repos().chapterMemory.getChapterMemory(repos().db, id),
  )
  ipcMain.handle('chapterMemory:create', (_e, data: unknown) =>
    repos().chapterMemory.createChapterMemory(repos().db, data as never),
  )
  ipcMain.handle('chapterMemory:update', (_e, id: string, patch: unknown) =>
    repos().chapterMemory.updateChapterMemory(repos().db, id, patch as never),
  )
  ipcMain.handle('chapterMemory:delete', (_e, id: string) => {
    repos().chapterMemory.deleteChapterMemory(repos().db, id)
    return true
  })

  // ---------- 人物状态 ----------
  ipcMain.handle('characterState:list', (_e, projectId: string) =>
    repos().characterState.listCharacterStates(repos().db, projectId),
  )
  ipcMain.handle('characterState:listByCharacter', (_e, characterId: string) =>
    repos().characterState.listCharacterStatesByCharacter(repos().db, characterId),
  )
  ipcMain.handle('characterState:create', (_e, data: unknown) =>
    repos().characterState.createCharacterState(repos().db, data as never),
  )
  ipcMain.handle('characterState:delete', (_e, id: string) => {
    repos().characterState.deleteCharacterState(repos().db, id)
    return true
  })

  // ---------- 人物视觉档案 ----------
  ipcMain.handle('visualProfile:list', (_e, projectId: string) =>
    repos().visualProfile.listVisualProfiles(repos().db, projectId),
  )
  ipcMain.handle('visualProfile:getByCharacter', (_e, characterId: string) =>
    repos().visualProfile.getVisualProfileByCharacter(repos().db, characterId),
  )
  ipcMain.handle('visualProfile:create', (_e, data: unknown) =>
    repos().visualProfile.createVisualProfile(repos().db, data as never),
  )
  ipcMain.handle('visualProfile:update', (_e, id: string, patch: unknown) =>
    repos().visualProfile.updateVisualProfile(repos().db, id, patch as never),
  )
  ipcMain.handle('visualProfile:delete', (_e, id: string) => {
    repos().visualProfile.deleteVisualProfile(repos().db, id)
    return true
  })

  // ---------- 视觉设定 ----------
  ipcMain.handle('visualSetting:list', (_e, projectId: string) =>
    repos().visualSetting.listVisualSettings(repos().db, projectId),
  )
  ipcMain.handle('visualSetting:create', (_e, data: unknown) =>
    repos().visualSetting.createVisualSetting(repos().db, data as never),
  )
  ipcMain.handle('visualSetting:update', (_e, id: string, patch: unknown) =>
    repos().visualSetting.updateVisualSetting(repos().db, id, patch as never),
  )
  ipcMain.handle('visualSetting:delete', (_e, id: string) => {
    repos().visualSetting.deleteVisualSetting(repos().db, id)
    return true
  })

  // ---------- 故事事件 ----------
  ipcMain.handle('storyEvent:list', (_e, projectId: string) =>
    repos().storyEvent.listStoryEvents(repos().db, projectId),
  )
  ipcMain.handle('storyEvent:create', (_e, data: unknown) =>
    repos().storyEvent.createStoryEvent(repos().db, data as never),
  )
  ipcMain.handle('storyEvent:update', (_e, id: string, patch: unknown) =>
    repos().storyEvent.updateStoryEvent(repos().db, id, patch as never),
  )
  ipcMain.handle('storyEvent:delete', (_e, id: string) => {
    repos().storyEvent.deleteStoryEvent(repos().db, id)
    return true
  })

  // ---------- 伏笔 ----------
  ipcMain.handle('foreshadowing:list', (_e, projectId: string) =>
    repos().foreshadowing.listForeshadowings(repos().db, projectId),
  )
  ipcMain.handle('foreshadowing:create', (_e, data: unknown) =>
    repos().foreshadowing.createForeshadowing(repos().db, data as never),
  )
  ipcMain.handle('foreshadowing:update', (_e, id: string, patch: unknown) =>
    repos().foreshadowing.updateForeshadowing(repos().db, id, patch as never),
  )
  ipcMain.handle('foreshadowing:delete', (_e, id: string) => {
    repos().foreshadowing.deleteForeshadowing(repos().db, id)
    return true
  })
}
