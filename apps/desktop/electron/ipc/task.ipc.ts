import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerTaskIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('longTask:list', (_e, projectId?: string) => {
    const r = repos()
    return projectId ? r.longTask.listLongTasksByProject(r.db, projectId) : r.longTask.listLongTasks(r.db)
  })
  ipcMain.handle('longTask:get', (_e, id: string) => repos().longTask.getLongTask(repos().db, id))
  ipcMain.handle('longTask:cancel', (_e, id: string) => {
    const r = repos()
    const task = r.longTask.getLongTask(r.db, id)
    if (!task) return { ok: false, error: '未找到任务' }
    if (task.status !== 'pending' && task.status !== 'running') return { ok: false, error: '任务已结束，不能取消' }
    const updated = r.longTask.finishLongTask(r.db, task.id, 'canceled')
    if (task.kind === 'video' && task.relatedEntityId) {
      r.videoTask.updateVideoTask(r.db, task.relatedEntityId, { status: 'canceled' })
    }
    return { ok: true, task: updated }
  })
}
