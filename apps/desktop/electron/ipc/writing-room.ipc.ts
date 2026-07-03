// v0.8 多 Agent 编剧室与模板系统 IPC（ROADMAP v0.8）
// —— Agent 配置 CRUD + 编剧室运行 + 模板 CRUD + 模板运行 + 类型库 CRUD + 模板运行记录
import { ipcMain } from 'electron'
import { getRepos } from '../db'
import {
  runWritingRoomWorkflow,
  renderTemplate,
  extractTemplateVariables,
  resolveProviderForTask,
  type WritingRoomInput,
} from '@sdns/ai'
import type { NovelTaskType } from '@sdns/core'

export function registerWritingRoomIpc(): void {
  const repos = () => getRepos()

  // ---------- Agent 配置 ----------
  ipcMain.handle('agent:list', () => repos().agentProfile.listAgentProfiles(repos().db))
  ipcMain.handle('agent:get', (_e, id: string) => repos().agentProfile.getAgentProfile(repos().db, id))
  ipcMain.handle('agent:create', (_e, data: unknown) =>
    repos().agentProfile.createAgentProfile(repos().db, data as never),
  )
  ipcMain.handle('agent:update', (_e, id: string, patch: unknown) =>
    repos().agentProfile.updateAgentProfile(repos().db, id, patch as never),
  )
  ipcMain.handle('agent:delete', (_e, id: string) => {
    repos().agentProfile.deleteAgentProfile(repos().db, id)
    return true
  })

  // ---------- 编剧室运行 ----------
  ipcMain.handle('writingRoom:run', async (_e, input: WritingRoomInput) => {
    const r = repos()
    // v1.0：编剧室用 writing_room 任务组的模型
    const { provider } = resolveProviderForTask(r, 'writing_room_consolidate' as NovelTaskType, undefined, input.projectId)
    try {
      const result = await runWritingRoomWorkflow({ repos: r, provider }, input)
      return result
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ---------- 模板 ----------
  ipcMain.handle('template:list', () => repos().template.listTemplates(repos().db))
  ipcMain.handle('template:listByType', (_e, type: string) =>
    repos().template.listTemplatesByType(repos().db, type),
  )
  ipcMain.handle('template:get', (_e, id: string) => repos().template.getTemplate(repos().db, id))
  ipcMain.handle('template:create', (_e, data: unknown) =>
    repos().template.createTemplate(repos().db, data as never),
  )
  ipcMain.handle('template:update', (_e, id: string, patch: unknown) =>
    repos().template.updateTemplate(repos().db, id, patch as never),
  )
  ipcMain.handle('template:delete', (_e, id: string) => {
    repos().template.deleteTemplate(repos().db, id)
    return true
  })
  // 解析模板正文中的变量占位符（供前端生成填写表单）
  ipcMain.handle('template:extractVariables', (_e, content: string) =>
    extractTemplateVariables(content ?? ''),
  )

  // 模板运行：渲染变量 → 记录 template_run → 通过 ai:run 复用对应生成类流水线
  ipcMain.handle(
    'template:run',
    async (
      _e,
      payload: {
        templateId: string
        projectId?: string
        variables?: Record<string, string>
        userInstruction?: string
      },
    ) => {
      const r = repos()
      const tpl = r.template.getTemplate(r.db, payload.templateId)
      if (!tpl) return { ok: false, error: '未找到模板' }
      const scope = (tpl.scope ?? 'snippet') as NovelTaskType | 'snippet'
      const rendered = renderTemplate(tpl.content, payload.variables ?? {})
      // 记录一条 template_run 快照（aiRunId 在前端拿到 ai:run 结果后可回填）
      const run = r.templateRun.createTemplateRun(r.db, {
        templateId: tpl.id,
        projectId: payload.projectId,
        scope,
        renderedContent: rendered,
        variables: payload.variables ?? {},
      })
      return {
        ok: true,
        templateRunId: run.id,
        scope,
        // 若是可驱动生成类任务，返回供前端调用 ai:run 的入参（template_run）
        aiInput:
          scope !== 'snippet'
            ? {
                projectId: payload.projectId,
                taskType: 'template_run' as NovelTaskType,
                templateScope: scope,
                templateContent: rendered,
                userInstruction: payload.userInstruction,
              }
            : undefined,
      }
    },
  )

  // ---------- 类型库（genre_presets） ----------
  ipcMain.handle('genrePreset:list', () => repos().genrePreset.listGenrePresets(repos().db))
  ipcMain.handle('genrePreset:get', (_e, id: string) => repos().genrePreset.getGenrePreset(repos().db, id))
  ipcMain.handle('genrePreset:create', (_e, data: unknown) =>
    repos().genrePreset.createGenrePreset(repos().db, data as never),
  )
  ipcMain.handle('genrePreset:update', (_e, id: string, patch: unknown) =>
    repos().genrePreset.updateGenrePreset(repos().db, id, patch as never),
  )
  ipcMain.handle('genrePreset:delete', (_e, id: string) => {
    repos().genrePreset.deleteGenrePreset(repos().db, id)
    return true
  })

  // ---------- 模板运行记录 ----------
  ipcMain.handle('templateRun:list', () => repos().templateRun.listTemplateRuns(repos().db))
  ipcMain.handle('templateRun:listByTemplate', (_e, templateId: string) =>
    repos().templateRun.listTemplateRunsByTemplate(repos().db, templateId),
  )
}
