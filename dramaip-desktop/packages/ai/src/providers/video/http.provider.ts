// HttpVideoProvider —— adapter 驱动的 HTTP 视频 Provider 基类。
//
// 它只负责编排请求、重试和错误归一化；平台差异全部下沉到 VideoProviderAdapter。
import type { VideoGenerationInput, VideoProvider, VideoProviderTaskState } from '@sdns/core'
import { fetchWithRetry } from '../http-client'
import type { VideoProviderAdapter, VideoProviderHttpRequest, VideoProviderRuntimeConfig } from './adapter'
import { customVideoProviderAdapter } from './adapters'

export interface HttpVideoProviderOptions {
  name: string
  kind: string
  baseUrl: string
  apiKey?: string
  model?: string
  defaultParams?: string
  adapter?: VideoProviderAdapter
  transport?: VideoHttpTransport
}

export interface VideoHttpTransport {
  request(request: VideoProviderHttpRequest): Promise<unknown>
}

export class FetchVideoHttpTransport implements VideoHttpTransport {
  async request(request: VideoProviderHttpRequest): Promise<unknown> {
    const res = await fetchWithRetry(
      request.url,
      {
        method: request.method,
        headers: request.headers,
        body: request.body == null
          ? undefined
          : typeof request.body === 'string'
            ? request.body
            : JSON.stringify(request.body),
      },
      { timeoutMs: request.timeoutMs, retries: request.retries },
    )
    return res.json()
  }
}

export class HttpVideoProvider implements VideoProvider {
  readonly kind: string
  readonly name: string
  private readonly config: VideoProviderRuntimeConfig
  private readonly adapter: VideoProviderAdapter
  private readonly transport: VideoHttpTransport

  constructor(opts: HttpVideoProviderOptions) {
    this.kind = opts.kind
    this.name = opts.name
    this.config = {
      name: opts.name,
      kind: opts.kind as VideoProviderRuntimeConfig['kind'],
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.model,
      defaultParams: opts.defaultParams,
    }
    this.adapter = opts.adapter ?? customVideoProviderAdapter
    this.transport = opts.transport ?? new FetchVideoHttpTransport()
  }

  async createTask(input: VideoGenerationInput): Promise<VideoProviderTaskState> {
    try {
      const request = this.adapter.createTaskRequest(input, this.config)
      const raw = await this.transport.request(request)
      return this.adapter.mapTaskState(raw, 'create')
    } catch (error) {
      throw this.adapter.normalizeError(error, 'create')
    }
  }

  async getTaskStatus(remoteTaskId: string): Promise<VideoProviderTaskState> {
    try {
      const request = this.adapter.getTaskStatusRequest(remoteTaskId, this.config)
      const raw = await this.transport.request(request)
      return this.adapter.mapTaskState(raw, 'status')
    } catch (error) {
      throw this.adapter.normalizeError(error, 'status')
    }
  }
}
