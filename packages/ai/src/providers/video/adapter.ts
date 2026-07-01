import type {
  VideoGenerationInput,
  VideoProviderConfig,
  VideoProviderKind,
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
  normalizeError(error: unknown, phase: VideoProviderRequestPhase): Error
}
