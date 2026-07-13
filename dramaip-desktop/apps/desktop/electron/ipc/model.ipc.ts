// 模型配置 CRUD + 默认模型 + 按任务组绑定（ROADMAP v1.0-3）
import { ipcMain } from 'electron'
import { getRepos } from '../db'
import {
  createModelConfigWithSecret,
  deleteModelConfigWithSecret,
  maskModelConfig,
  updateModelConfigWithSecret,
} from '../secrets'

export function registerModelIpc(): void {
  const repos = () => getRepos()

  ipcMain.handle('model:list', () => repos().modelConfig.listModelConfigs(repos().db).map(maskModelConfig))
  ipcMain.handle('model:getDefault', () => {
    const config = repos().modelConfig.getDefaultModelConfig(repos().db)
    return config ? maskModelConfig(config) : undefined
  })
  ipcMain.handle('model:create', async (_e, data: unknown) =>
    maskModelConfig(await createModelConfigWithSecret(repos(), data)),
  )
  ipcMain.handle('model:update', async (_e, id: string, patch: unknown) => {
    const updated = await updateModelConfigWithSecret(repos(), id, patch)
    return updated ? maskModelConfig(updated) : undefined
  })
  ipcMain.handle('model:delete', async (_e, id: string) => {
    await deleteModelConfigWithSecret(repos(), id)
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

  ipcMain.handle('model:getBudgetSettings', () =>
    repos().aiBudget.getAiBudgetSettings(repos().db),
  )
  ipcMain.handle('model:updateBudgetSettings', (_e, patch: unknown) =>
    repos().aiBudget.upsertAiBudgetSettings(repos().db, patch as never),
  )
}
