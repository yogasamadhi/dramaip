// 模型配置 CRUD + 默认模型 + 按任务组绑定（ROADMAP v1.0-3）
import { ipcMain } from 'electron'
import { getRepos } from '../db'

export function registerModelIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('model:list', () => repos().modelConfig.listModelConfigs(repos().db))
  ipcMain.handle('model:getDefault', () => repos().modelConfig.getDefaultModelConfig(repos().db))
  ipcMain.handle('model:create', (_e, data: unknown) =>
    repos().modelConfig.createModelConfig(repos().db, data as never),
  )
  ipcMain.handle('model:update', (_e, id: string, patch: unknown) =>
    repos().modelConfig.updateModelConfig(repos().db, id, patch as never),
  )
  ipcMain.handle('model:delete', (_e, id: string) => {
    repos().modelConfig.deleteModelConfig(repos().db, id)
    return true
  })
  ipcMain.handle('model:setDefault', (_e, id: string) => {
    repos().modelConfig.setDefaultModelConfig(repos().db, id)
    return true
  })

  // v1.0：按任务组指定模型（CRUD）
  ipcMain.handle('model:listTaskBindings', () =>
    repos().taskModelBinding.listTaskModelBindings(repos().db),
  )
  ipcMain.handle('model:upsertTaskBinding', (_e, taskGroup: string, modelConfigId: string) =>
    repos().taskModelBinding.upsertTaskModelBinding(repos().db, { taskGroup, modelConfigId }),
  )
  ipcMain.handle('model:deleteTaskBinding', (_e, taskGroup: string) => {
    repos().taskModelBinding.deleteTaskModelBinding(repos().db, taskGroup)
    return true
  })
}
