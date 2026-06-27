// AI 工作流入口：解析任务对应模型 → 构造 provider → 运行 LangGraph 工作流（项目说明.md §10）
import { ipcMain } from 'electron'
import { getRepos } from '../db'
import {
  runNovelWorkflow,
  applyGeneratedArtifact,
  resolveProviderForTask,
  type NovelWorkflowInput,
  type ApplyArtifactInput,
} from '@sdns/ai'
import type { ChatMessage, ModelConfig, NovelTaskType } from '@sdns/core'
import { providerFromModelConfig } from '@sdns/ai'
import { decryptSecret } from '../secrets'

export function registerAiIpc(): void {
  ipcMain.handle('ai:run', async (_evt, input: NovelWorkflowInput) => {
    const repos = getRepos()
    // v1.0：按任务组解析模型（命中绑定则用绑定模型，否则默认模型）
    const { provider } = resolveProviderForTask(repos, input.taskType, input.templateScope)

    try {
      const result = await runNovelWorkflow({ repos, provider }, input)
      return result
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        result: undefined,
        aiRunId: undefined,
        state: null,
      }
    }
  })

  ipcMain.handle('ai:runStream', async (evt, input: NovelWorkflowInput, requestId: string) => {
    const repos = getRepos()
    const { provider } = resolveProviderForTask(repos, input.taskType, input.templateScope)

    try {
      const result = await runNovelWorkflow(
        {
          repos,
          provider,
          onToken: (chunk) => {
            evt.sender.send('ai:stream:chunk', { requestId, chunk })
          },
        },
        input,
      )
      return result
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        result: undefined,
        aiRunId: undefined,
        state: null,
      }
    }
  })

  // generate 类产物「预览后落库」入口（项目说明.md §10.3 / §11.1-11.4）
  ipcMain.handle('ai:applyResult', async (_evt, input: ApplyArtifactInput) => {
    const repos = getRepos()
    try {
      const result = await applyGeneratedArtifact({ repos }, input)
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // v1.0：模型连接测试（ROADMAP v1.0-3）—— 用指定 config 发一个最小 chat 请求
  ipcMain.handle('model:testConnection', async (_evt, config: ModelConfig) => {
    try {
      const provider = providerFromModelConfig({ ...config, apiKey: decryptSecret(config.apiKey) })
      const startedAt = Date.now()
      const messages: ChatMessage[] = [
        { role: 'system', content: '连接测试。只回复 ok。' },
        { role: 'user', content: 'ping' },
      ]
      const out = await provider.chat({ messages, maxTokens: 8, temperature: 0 })
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        sample: out.content.slice(0, 120),
        tokenUsage: out.tokenUsage,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // v1.0：Token / 耗时统计（ROADMAP v1.0-3）
  ipcMain.handle('aiRun:summarize', () => {
    const repos = getRepos()
    return repos.aiRun.summarizeAiRuns(repos.db)
  })
}

/** 用不到的占位，避免 NovelTaskType 类型在 tree-shaking 下被误删 */
export type _TaskTypeRef = NovelTaskType
