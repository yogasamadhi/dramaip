import type {
  VideoGenerationInput,
  VideoProviderConfig,
  VideoProviderKind,
  VideoProviderResult,
  VideoProviderTaskState,
} from '@sdns/core'

export type VideoProviderRequestPhase = 'create' | 'status'

export interface VideoProviderRuntimeConfig
  extends Pick<VideoProviderConfig, 'name' | 'kind' | 'baseUrl' | 'apiKey' | 'model' | 'defaultParams'> {}

export interface VideoProviderHttpRequest {
  method: 'GET' | 'POST'
  url: string
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  retries?: number
}

export interface VideoProviderAdapter {
  readonly kind: Exclude<VideoProviderKind, 'mock'>
  readonly label: string
  authHeaders(config: VideoProviderRuntimeConfig): Record<string, string>
  createTaskRequest(input: VideoGenerationInput, config: VideoProviderRuntimeConfig): VideoProviderHttpRequest
  getTaskStatusRequest(remoteTaskId: string, config: VideoProviderRuntimeConfig): VideoProviderHttpRequest
  mapTaskState(raw: unknown, phase: VideoProviderRequestPhase): VideoProviderTaskState
  /**
   * Some providers expose a file identifier rather than a playable URL in the terminal task
   * response. Keep that second retrieval request inside the dedicated adapter so the shared
   * video service never needs to know provider-specific file APIs.
   */
  getResultRequest?(taskResponse: unknown, config: VideoProviderRuntimeConfig): VideoProviderHttpRequest | undefined
  mapTaskResults?(taskResponse: unknown, resultResponse: unknown): VideoProviderResult[]
  normalizeError(error: unknown, phase: VideoProviderRequestPhase): Error
}
