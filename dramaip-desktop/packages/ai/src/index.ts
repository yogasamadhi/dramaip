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
  hailuoVideoProviderAdapter,
  wanVideoProviderAdapter,
  mapOpenAiCompatibleTaskState,
  mapWanTaskState,
  normalizeVideoProviderError,
  type RealVideoProviderKind,
} from './providers/video/adapters'
export { videoProviderFromConfig } from './providers/video/factory'
// LM5-10 image providers remain opt-in until the Desktop settings/keychain/task persistence boundary is enabled.
export { OpenAIImageProvider, FetchOpenAIImageTransport, mapOpenAIImageResponse, type OpenAIImageTransport } from './providers/image/openai-image.provider'
export { MockImageProvider } from './providers/image/mock.provider'
export {
  createImageGenerationTask,
  retryImageGenerationTask,
  type ImageAssetArchiver,
  type ImageAssetArchiveResult,
  type ImageGenerationServiceDeps,
  type ImageGenerationTaskInput,
  type ImageGenerationTaskResult,
} from './providers/image/image-generation.service'
export { OpenAITtsProvider, FetchOpenAITtsTransport, type OpenAITtsTransport } from './providers/audio/openai-tts.provider'
export {
  createTtsGenerationTask,
  retryTtsGenerationTask,
  type TtsAssetArchiver,
  type TtsAssetArchiveResult,
  type TtsGenerationServiceDeps,
  type TtsGenerationTaskInput,
  type TtsGenerationTaskResult,
} from './providers/audio/audio-generation.service'
export {
  createVideoGenerationTask,
  checkVideoTaskStatus,
  cancelVideoGenerationTask,
  retryVideoTask,
  compareVideoResults,
  selectBestVideoResult,
  type VideoServiceDeps,
  type VideoAssetArchiveInput,
  type VideoAssetArchiveResult,
  type VideoAssetArchiver,
} from './providers/video/video-generation.service'
