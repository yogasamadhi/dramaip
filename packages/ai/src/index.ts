export * from './providers/openai-compatible.provider'
export type { LLMProvider, ChatInput, ChatOutput, ChatMessage } from '@sdns/core'
export { extractJson } from './parsers/json'
export { buildChapterContext, buildEvaluationContext } from './context/context-builder'
export {
  buildNovelWorkflow,
  runNovelWorkflow,
  type NovelWorkflowDeps,
  type NovelWorkflowInput,
  type NovelWorkflowResult,
} from './graphs/novel-workflow.graph'
export { NovelGraphState, type NovelGraphStateType, type WorkflowResult } from './graphs/state'
export {
  applyGeneratedArtifact,
  type GenerateTaskType,
  type ApplyArtifactInput,
  type ApplyArtifactOutput,
} from './persistence'
// v0.8 多 Agent 编剧室与模板系统
export {
  buildWritingRoomWorkflow,
  runWritingRoomWorkflow,
  WritingRoomState,
  type WritingRoomDeps,
  type WritingRoomInput,
  type WritingRoomResultPayload,
  type WritingRoomStateType,
} from './graphs/writing-room.graph'
export { renderTemplate, extractTemplateVariables } from './prompts/template-render'
export { getTaskWritePolicy } from './prompts/loader'
// v1.0 模型配置增强：按任务指定模型 + 连接测试
export { resolveProviderForTask, type ProviderResolution } from './providers/task-provider-resolver'
// v0.7 AI 视频平台对接
export type {
  VideoProvider,
  VideoProviderTaskState,
  VideoProviderResult,
  VideoGenerationInput,
} from '@sdns/core'
export { MockVideoProvider } from './providers/video/mock.provider'
export {
  HttpVideoProvider,
  FetchVideoHttpTransport,
  type HttpVideoProviderOptions,
  type VideoHttpTransport,
} from './providers/video/http.provider'
export type {
  VideoProviderAdapter,
  VideoProviderHttpRequest,
  VideoProviderRequestPhase,
  VideoProviderRuntimeConfig,
} from './providers/video/adapter'
export {
  VIDEO_PROVIDER_ADAPTERS,
  REAL_VIDEO_PROVIDER_KINDS,
  adapterForVideoProviderKind,
  customVideoProviderAdapter,
  mapOpenAiCompatibleTaskState,
  normalizeVideoProviderError,
  type RealVideoProviderKind,
} from './providers/video/adapters'
export { videoProviderFromConfig } from './providers/video/factory'
export {
  createVideoGenerationTask,
  checkVideoTaskStatus,
  retryVideoTask,
  compareVideoResults,
  selectBestVideoResult,
  type VideoServiceDeps,
} from './providers/video/video-generation.service'
