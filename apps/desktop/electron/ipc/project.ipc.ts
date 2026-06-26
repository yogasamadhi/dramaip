// 项目 / 章节 / 人物 / 大纲 / 评分 CRUD（项目说明.md §17：Repository 不进 React）
import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerProjectIpc(): void {
  const repos = () => getRepos()

  // ---------- 项目 ----------
  ipcMain.handle('project:list', () => repos().project.listProjects(repos().db))
  ipcMain.handle('project:get', (_e, id: string) => repos().project.getProject(repos().db, id))
  ipcMain.handle('project:create', (_e, data: unknown) => repos().project.createProject(repos().db, data as never))
  ipcMain.handle('project:update', (_e, id: string, patch: unknown) =>
    repos().project.updateProject(repos().db, id, patch as never),
  )
  ipcMain.handle('project:delete', (_e, id: string) => {
    repos().project.deleteProject(repos().db, id)
    return true
  })

  // ---------- 章节 ----------
  ipcMain.handle('chapter:list', (_e, projectId: string) =>
    repos().chapter.listChapters(repos().db, projectId),
  )
  ipcMain.handle('chapter:get', (_e, id: string) => repos().chapter.getChapter(repos().db, id))
  ipcMain.handle('chapter:create', (_e, data: unknown) => repos().chapter.createChapter(repos().db, data as never))
  ipcMain.handle('chapter:update', (_e, id: string, patch: unknown) =>
    repos().chapter.updateChapter(repos().db, id, patch as never),
  )
  ipcMain.handle('chapter:updateContent', (_e, id: string, content: string) =>
    repos().chapter.updateChapterContent(repos().db, id, content),
  )
  ipcMain.handle('chapter:delete', (_e, id: string) => {
    repos().chapter.deleteChapter(repos().db, id)
    return true
  })

  // ---------- 人物 ----------
  ipcMain.handle('character:list', (_e, projectId: string) =>
    repos().character.listCharacters(repos().db, projectId),
  )
  ipcMain.handle('character:create', (_e, data: unknown) =>
    repos().character.createCharacter(repos().db, data as never),
  )
  ipcMain.handle('character:update', (_e, id: string, patch: unknown) =>
    repos().character.updateCharacter(repos().db, id, patch as never),
  )
  ipcMain.handle('character:delete', (_e, id: string) => {
    repos().character.deleteCharacter(repos().db, id)
    return true
  })

  // ---------- 大纲 ----------
  ipcMain.handle('outline:list', (_e, projectId: string, type?: 'book' | 'chapter') =>
    repos().outline.listOutlines(repos().db, projectId, type),
  )
  ipcMain.handle('outline:create', (_e, data: unknown) => repos().outline.createOutline(repos().db, data as never))
  ipcMain.handle('outline:update', (_e, id: string, patch: unknown) =>
    repos().outline.updateOutline(repos().db, id, patch as never),
  )
  ipcMain.handle('outline:delete', (_e, id: string) => {
    repos().outline.deleteOutline(repos().db, id)
    return true
  })

  // ---------- 评分（只读列表，生成在 ai 流程中） ----------
  ipcMain.handle('evaluation:list', (_e, projectId: string) =>
    repos().evaluation.listEvaluations(repos().db, projectId),
  )

  // ---------- AI 调用记录（只读） ----------
  ipcMain.handle('aiRun:list', (_e, projectId: string) =>
    repos().aiRun.listAiRunsByProject(repos().db, projectId),
  )
}
