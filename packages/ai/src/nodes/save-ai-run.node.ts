// saveAiRunNode —— 记录 AI 调用日志到 ai_runs（§10.2 / §17 第 10 条）
import { GRAPH_NAME } from '@sdns/core'
import type { NovelGraphStateType } from '../graphs/state'
import type { NodeDeps } from './deps'

export function createSaveAiRunNode(deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    const { repos, provider } = deps
    const failed = Boolean(state.error)

    const output =
      state.rawOutput ??
      (typeof state.parsedOutput === 'string'
        ? state.parsedOutput
        : state.parsedOutput
          ? JSON.stringify(state.parsedOutput)
          : '')

    const run = repos.aiRun.createAiRun(repos.db, {
      projectId: state.projectId,
      chapterId: state.chapterId,
      graphName: GRAPH_NAME,
      type: state.taskType,
      provider: state.providerName ?? provider?.name ?? 'unknown',
      model: state.modelName ?? provider?.model ?? 'unknown',
      input: state.promptText ?? state.contextText ?? '',
      output: failed ? '' : output,
      status: failed ? 'failed' : 'success',
      errorMessage: failed ? state.error : undefined,
      tokenUsage: state.tokenUsage,
      latencyMs: state.latencyMs,
    })

    return { aiRunId: run.id }
  }
}
