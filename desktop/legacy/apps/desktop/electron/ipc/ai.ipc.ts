// AI 工作流入口：解析任务对应模型 → 构造 provider → 运行 LangGraph 工作流（项目说明.md §10）
import { ipcMain } from 'electron'
import { getRepos } from '../db'
import {
  runNovelWorkflow,
  applyGeneratedArtifact,
  createModelConnectionTestInput,
  resolveProviderForTask,
  type NovelWorkflowInput,
  type ApplyArtifactInput,
} from '@sdns/ai'
import { TASK_TYPE_LABELS, type ModelConfig, type NovelTaskType } from '@sdns/core'
import { providerFromModelConfig } from '@sdns/ai'
import { decryptSecret } from '../secrets'
import {
  cloudProviderFromModelConfig,
  isCloudModelConfig,
  preflightCloudModelConfig,
  type CloudAIPreflight,
} from '../cloud-ai'
import { logger } from '../logger'
import { beginLongTaskRun, finishLongTaskRun } from '../task-runtime'

export function registerAiIpc(): void {
  ipcMain.handle('ai:run', async (_evt, input: NovelWorkflowInput) => {
    return runAiTask(input)
  })

  ipcMain.handle('ai:runStream', async (evt, input: NovelWorkflowInput, requestId: string) => {
    return runAiTask(input, {
      onToken: (chunk) => {
        evt.sender.send('ai:stream:chunk', { requestId, chunk })
      },
      onRetry: () => {
        evt.sender.send('ai:stream:reset', { requestId })
      },
    })
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
      const repos = getRepos()
      const stored = config.id ? repos.modelConfig.getModelConfig(repos.db, config.id) : undefined
      const resolved = stored ?? config
      const startedAt = Date.now()
      const testInput = createModelConnectionTestInput()
      if (isCloudModelConfig(resolved)) {
        const preflight = await preflightCloudModelConfig(resolved, { ...testInput, maxTokens: 8 })
        return {
          ok: true,
          latencyMs: Date.now() - startedAt,
          sample: `云端预检通过（剩余 ${preflight.remainingTokens} tokens）`,
          tokenUsage: preflight.estimatedTokens,
        }
      }
      const provider = providerFromModelConfig({ ...resolved, apiKey: decryptSecret(resolved.apiKey) })
      const out = await provider.chat(testInput)
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
  ipcMain.handle('aiRun:summarizeUsage', () => {
    const repos = getRepos()
    const settings = repos.aiBudget.getAiBudgetSettings(repos.db)
    return repos.aiRun.summarizeAiRunUsage(repos.db, { costPer1kTokens: settings.costPer1kTokens })
  })
}

export async function runAiTask(
  input: NovelWorkflowInput,
  options: { onToken?: (token: string) => void; onRetry?: () => void; signal?: AbortSignal } = {},
): Promise<{
  ok: boolean
  error?: string
  result?: { kind: string; data: unknown }
  aiRunId?: string
  longTaskId: string
  state: unknown
}> {
  const repos = getRepos()
  const longTaskId = createAiLongTask(repos, input)
  const runtime = beginLongTaskRun('ai', longTaskId)
  logger.info('ai', 'run started', { longTaskId, taskType: input.taskType, projectId: input.projectId })
  if (!runtime.ok) {
    repos.longTask.finishLongTask(repos.db, longTaskId, 'failed', { errorMessage: runtime.error })
    return failedAiResult(longTaskId, runtime.error ?? 'AI 任务并发限制')
  }
  const workflowAbort = mergeAbortSignals(runtime.signal, options.signal)

  try {
    const resolution = resolveProviderForTask(repos, input.taskType, input.templateScope, input.projectId)
    const provider = resolution.config && isCloudModelConfig(resolution.config)
      ? cloudProviderFromModelConfig(resolution.config, {
          onPreflight: async (preflight) => recordCloudPreflight(repos, longTaskId, preflight),
        })
      : resolution.provider
    const result = await runNovelWorkflow(
      {
        repos,
        provider,
        onToken: options.onToken,
        onRetry: options.onRetry,
        signal: workflowAbort.signal,
      },
      input,
    )
    if (isLongTaskCanceled(repos, longTaskId) || workflowAbort.signal?.aborted) {
      repos.longTask.finishLongTask(repos.db, longTaskId, 'canceled', { errorMessage: '任务已取消' })
      return failedAiResult(longTaskId, '任务已取消')
    }
    if (input.taskType === 'propose_story_bible_changes' && result.ok && result.result?.kind === 'story_bible_change_set') {
      const changeSetId = (result.result.data as { id?: unknown } | undefined)?.id
      if (typeof changeSetId === 'string') repos.storyBible.attachStoryBibleChangeSetTask(repos.db, changeSetId, result.aiRunId ?? longTaskId)
    }
    finishAiLongTask(repos, longTaskId, result)
    logger.info('ai', 'run finished', { longTaskId, taskType: input.taskType, ok: result.ok, aiRunId: result.aiRunId })
    return { ...result, longTaskId }
  } catch (e) {
    const canceled = workflowAbort.signal?.aborted || isLongTaskCanceled(repos, longTaskId)
    repos.longTask.finishLongTask(repos.db, longTaskId, canceled ? 'canceled' : 'failed', {
      errorMessage: canceled ? '任务已取消' : e instanceof Error ? e.message : String(e),
    })
    logger[canceled ? 'warn' : 'error']('ai', canceled ? 'run canceled' : 'run failed', {
      longTaskId,
      taskType: input.taskType,
      error: e instanceof Error ? e.message : String(e),
    })
    return failedAiResult(longTaskId, canceled ? '任务已取消' : e instanceof Error ? e.message : String(e))
  } finally {
    workflowAbort.cleanup()
    finishLongTaskRun(longTaskId)
  }
}

function mergeAbortSignals(...signals: Array<AbortSignal | undefined>): { signal?: AbortSignal; cleanup: () => void } {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (active.length <= 1) return { signal: active[0], cleanup: () => undefined }
  const controller = new AbortController()
  const abort = () => controller.abort(new Error('任务已取消'))
  const subscribed: AbortSignal[] = []
  for (const signal of active) {
    if (signal.aborted) {
      abort()
      break
    }
    signal.addEventListener('abort', abort, { once: true })
    subscribed.push(signal)
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of subscribed) signal.removeEventListener('abort', abort)
    },
  }
}

function createAiLongTask(repos: ReturnType<typeof getRepos>, input: NovelWorkflowInput): string {
  const task = repos.longTask.createLongTask(repos.db, {
    kind: 'ai',
    title: TASK_TYPE_LABELS[input.taskType] ?? input.taskType,
    taskType: input.taskType,
    projectId: input.projectId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    sceneId: input.sceneId,
    shotId: input.shotId,
    input: {
      ...summarizeAiInput(input),
      retryInput: buildAiRetryInput(input),
    },
  })
  repos.longTask.markLongTaskRunning(repos.db, task.id)
  return task.id
}

function summarizeAiInput(input: NovelWorkflowInput): Record<string, unknown> {
  return {
    taskType: input.taskType,
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterWordGoal: input.chapterWordGoal,
    characterId: input.characterId,
    adaptationProjectId: input.adaptationProjectId,
    episodeId: input.episodeId,
    sceneId: input.sceneId,
    shotId: input.shotId,
    templateScope: input.templateScope,
    hasTemplateContent: Boolean(input.templateContent),
    hasUserInstruction: Boolean(input.userInstruction?.trim()),
    chatMessageCount: input.chatHistory?.length ?? 0,
    hasContextControls: Boolean(input.contextControls),
  }
}

function buildAiRetryInput(input: NovelWorkflowInput): NovelWorkflowInput {
  const { currentChapter: _currentChapter, ...rest } = input
  void _currentChapter
  return {
    ...rest,
    chatHistory: input.chatHistory?.slice(-20),
    contextControls: input.contextControls,
  }
}

function isLongTaskCanceled(repos: ReturnType<typeof getRepos>, longTaskId: string): boolean {
  return repos.longTask.getLongTask(repos.db, longTaskId)?.status === 'canceled'
}

function failedAiResult(longTaskId: string, error: string): {
  ok: false
  error: string
  result: undefined
  aiRunId: undefined
  longTaskId: string
  state: null
} {
  return {
    ok: false,
    error,
    result: undefined,
    aiRunId: undefined,
    longTaskId,
    state: null,
  }
}

function finishAiLongTask(
  repos: ReturnType<typeof getRepos>,
  longTaskId: string,
  result: { ok: boolean; error?: string; aiRunId?: string; result?: { kind: string } },
): void {
  const existing = repos.longTask.getLongTask(repos.db, longTaskId)
  repos.longTask.finishLongTask(repos.db, longTaskId, result.ok ? 'success' : 'failed', {
    relatedEntityId: result.aiRunId,
    errorMessage: result.error,
    output: { ...existing?.output, aiRunId: result.aiRunId, resultKind: result.result?.kind },
  })
}

function recordCloudPreflight(
  repos: ReturnType<typeof getRepos>,
  longTaskId: string,
  preflight: CloudAIPreflight,
): void {
  const existing = repos.longTask.getLongTask(repos.db, longTaskId)
  repos.longTask.updateLongTask(repos.db, longTaskId, {
    output: {
      ...existing?.output,
      cloudPreflight: {
        provider: preflight.model.provider,
        model: preflight.model.model,
        estimatedTokens: preflight.estimatedTokens,
        remainingTokens: preflight.remainingTokens,
        requestHashPrefix: preflight.requestHash.slice(0, 12),
        checkedAt: new Date().toISOString(),
      },
    },
  })
}

/** 用不到的占位，避免 NovelTaskType 类型在 tree-shaking 下被误删 */
export type _TaskTypeRef = NovelTaskType
