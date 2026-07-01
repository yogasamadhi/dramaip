// novel-workflow.graph.ts —— LangGraph.js 工作流组装与执行（项目说明.md §10）
import { END, START, StateGraph } from '@langchain/langgraph'
import type { Chapter, LLMProvider, NovelTaskType } from '@sdns/core'
import type { Repositories } from '@sdns/db'

import { NovelGraphState, type NovelGraphStateType } from './state'
import { createLoadProjectContextNode } from '../nodes/load-project-context.node'
import { createBuildPromptNode } from '../nodes/build-prompt.node'
import { createCallModelNode } from '../nodes/call-model.node'
import { createParseOutputNode } from '../nodes/parse-output.node'
import { createValidateOutputNode } from '../nodes/validate-output.node'
import { createSaveResultNode } from '../nodes/save-result.node'
import { createSaveAiRunNode } from '../nodes/save-ai-run.node'
import type { NodeDeps } from '../nodes/deps'

export interface NovelWorkflowDeps {
  repos: Repositories
  provider?: LLMProvider
  onToken?: (token: string) => void
  signal?: AbortSignal
}

export interface NovelWorkflowInput {
  projectId?: string
  chapterId?: string
  /** v0.2：按人物生成视觉档案 / 更新人物状态时用 */
  characterId?: string
  /** v0.4：改编项目相关 */
  adaptationProjectId?: string
  episodeId?: string
  /** v0.6：镜头相关 */
  sceneId?: string
  shotId?: string
  taskType: NovelTaskType
  userInstruction?: string
  /** 对话式项目设定的多轮历史 */
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  currentChapter?: Chapter
  /** v0.8 模板驱动生成：渲染后的模板正文（仅 taskType='template_run' 使用） */
  templateContent?: string
  /** v0.8 模板驱动生成：实际复用的生成类 taskType（如 generate_project） */
  templateScope?: NovelTaskType
}

export interface NovelWorkflowResult {
  ok: boolean
  error?: string
  result?: { kind: string; data: unknown }
  aiRunId?: string
  state: NovelGraphStateType
}

/** 构建并编译工作流图 */
export function buildNovelWorkflow(deps: NovelWorkflowDeps) {
  const nodeDeps: NodeDeps = { repos: deps.repos, provider: deps.provider, onToken: deps.onToken, signal: deps.signal }
  const cancellable = <T extends Partial<NovelGraphStateType> | Promise<Partial<NovelGraphStateType>>>(
    fn: (state: NovelGraphStateType) => T,
  ) => async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    throwIfAborted(deps.signal)
    const next = await fn(state)
    throwIfAborted(deps.signal)
    return next
  }

  const graph = new StateGraph(NovelGraphState)
    .addNode('load_project_context', cancellable(createLoadProjectContextNode(nodeDeps)))
    .addNode('build_prompt', cancellable(createBuildPromptNode(nodeDeps)))
    .addNode('call_model', cancellable(createCallModelNode(nodeDeps)))
    .addNode('parse_output', cancellable(createParseOutputNode(nodeDeps)))
    .addNode('validate_output', cancellable(createValidateOutputNode(nodeDeps)))
    .addNode('save_result', cancellable(createSaveResultNode(nodeDeps)))
    .addNode('save_ai_run', cancellable(createSaveAiRunNode(nodeDeps)))
    .addEdge(START, 'load_project_context')
    .addEdge('load_project_context', 'build_prompt')
    .addEdge('build_prompt', 'call_model')
    .addEdge('call_model', 'parse_output')
    .addEdge('parse_output', 'validate_output')
    .addConditionalEdges('validate_output', routeAfterValidate, {
      save_result: 'save_result',
      build_prompt: 'build_prompt',
      save_ai_run: 'save_ai_run',
    })
    .addEdge('save_result', 'save_ai_run')
    .addEdge('save_ai_run', END)

  return graph.compile()
}

/** 校验通过 → 存结果；可重试的解析/校验错误 → 回到 build_prompt（仅一次）；否则 → 失败记账 */
function routeAfterValidate(state: NovelGraphStateType): 'save_result' | 'build_prompt' | 'save_ai_run' {
  if (!state.error) return 'save_result'
  if (state.retryable && (state.retryCount ?? 0) === 0) return 'build_prompt'
  return 'save_ai_run'
}

/** 运行工作流（供 IPC 调用） */
export async function runNovelWorkflow(
  deps: NovelWorkflowDeps,
  input: NovelWorkflowInput,
): Promise<NovelWorkflowResult> {
  const app = buildNovelWorkflow(deps)
  const state = (await app.invoke(
    { ...input, retryCount: 0 },
    { recursionLimit: 25 },
  )) as NovelGraphStateType

  return {
    ok: !state.error,
    error: state.error,
    result: state.result,
    aiRunId: state.aiRunId,
    state,
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('任务已取消')
}
