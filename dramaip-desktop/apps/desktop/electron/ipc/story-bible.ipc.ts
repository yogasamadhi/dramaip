// LM5-05：故事圣经变更包 IPC。生成草案与采用实体写入始终分离。
import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerStoryBibleIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('storyBible:settings:get', (_e, projectId: string) =>
    repos().storyBible.getStoryBibleSettings(repos().db, projectId),
  )
  ipcMain.handle('storyBible:settings:update', (_e, projectId: string, patch: { autoSuggest: boolean }) =>
    repos().storyBible.updateStoryBibleSettings(repos().db, projectId, patch),
  )
  ipcMain.handle('storyBible:changeSet:list', (_e, projectId: string) =>
    repos().storyBible.listStoryBibleChangeSets(repos().db, projectId),
  )
  ipcMain.handle('storyBible:changeSet:queue', (_e, input: { projectId: string; chapterId: string }) => {
    const r = repos()
    const budget = r.aiBudget.getAiBudgetSettings(r.db)
    return r.storyBible.queueStoryBibleChangeSet(r.db, {
      ...input,
      costPer1kTokens: budget.costPer1kTokens,
      currency: budget.currency,
    })
  })
  ipcMain.handle('storyBible:changeSet:apply', (_e, id: string) =>
    repos().storyBible.applyStoryBibleChangeSet(repos().db, id),
  )
  ipcMain.handle('storyBible:changeSet:undo', (_e, id: string) =>
    repos().storyBible.undoStoryBibleChangeSet(repos().db, id),
  )
  ipcMain.handle('storyBible:changeSet:fail', (_e, id: string, message: string) =>
    repos().storyBible.markStoryBibleChangeSetFailed(repos().db, id, message),
  )
  ipcMain.handle('storyBible:changeSet:setStatus', (_e, id: string, status: 'paused' | 'queued' | 'skipped' | 'discarded') =>
    repos().storyBible.setStoryBibleChangeSetStatus(repos().db, id, status),
  )
  ipcMain.handle('storyBible:stale:list', (_e, projectId: string) =>
    repos().storyBible.listStoryBibleStaleMarks(repos().db, projectId),
  )
}
