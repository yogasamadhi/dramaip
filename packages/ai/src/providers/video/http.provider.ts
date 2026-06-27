// HttpVideoProvider —— 通用的「提交 + 轮询」视频生成适配器（ROADMAP v0.7 §1）
//
// 适用于遵循常见「POST 创建任务返回 task id / GET 查询任务返回 status+url」约定的平台（如即梦/可灵/海螺的开放接口）。
// 各平台真实接口字段差异较大，这里给出一个结构化、可被具体平台覆写的基线实现；
// 当某平台需要专门适配时，新增 XxxVideoProvider 并在工厂里按 kind 路由即可。
import type {
  VideoGenerationInput,
  VideoProvider,
  VideoProviderResult,
  VideoProviderTaskState,
  VideoTaskStatus,
} from '@sdns/core'
import { fetchWithRetry, HttpRequestError } from '../http-client'

export interface HttpVideoProviderOptions {
  name: string
  kind: string
  baseUrl: string
  apiKey?: string
  model?: string
  /**
   * 把平台原始返回映射成统一任务态。默认假设响应形如：
   *   { data: { task_id, task_status: 'success'|'processing'|'failed', videos:[{url, cover_image_url}], error } }
   * 不同平台可在 options 里覆写 mapStatus / mapResults。
   */
  mapStatus?: (raw: unknown) => VideoProviderTaskState
}

interface PlatformTaskResponse {
  data?: {
    task_id?: string
    task_status?: string
    status?: string
    videos?: Array<{ url?: string; video_url?: string; cover_image_url?: string; cover_url?: string }>
    video_url?: string
    cover_image_url?: string
    error?: string
    message?: string
  }
  error?: string
  message?: string
}

function defaultMapStatus(raw: unknown): VideoProviderTaskState {
  const r = raw as PlatformTaskResponse
  const data = r.data ?? {}
  const rawStatus = (data.task_status ?? data.status ?? '').toLowerCase()
  const status: VideoTaskStatus =
    rawStatus.includes('succ') ? 'success'
      : rawStatus.includes('fail') || rawStatus.includes('error') ? 'failed'
        : rawStatus.includes('process') || rawStatus.includes('run') || rawStatus.includes('pend') ? 'running'
          : 'pending'
  const videos = data.videos ?? (data.video_url ? [{ video_url: data.video_url, cover_image_url: data.cover_image_url }] : [])
  const results: VideoProviderResult[] = videos
    .map((v) => ({
      resultVideoUrl: v.url ?? v.video_url ?? '',
      coverImageUrl: v.cover_image_url ?? v.cover_url,
    }))
    .filter((v) => v.resultVideoUrl)
  return {
    status,
    remoteTaskId: data.task_id,
    errorMessage: data.error ?? data.message ?? r.error ?? r.message,
    results,
  }
}

function wrapHttpError(prefix: string, e: unknown): never {
  if (e instanceof HttpRequestError) throw new Error(`${prefix} (${e.message})`)
  throw e
}

export class HttpVideoProvider implements VideoProvider {
  readonly kind: string
  readonly name: string
  private readonly baseUrl: string
  private readonly apiKey?: string
  private readonly model?: string
  private readonly mapStatus: (raw: unknown) => VideoProviderTaskState

  constructor(opts: HttpVideoProviderOptions) {
    this.kind = opts.kind
    this.name = opts.name
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '')
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.mapStatus = opts.mapStatus ?? defaultMapStatus
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`
    return h
  }

  async createTask(input: VideoGenerationInput): Promise<VideoProviderTaskState> {
    const body = {
      model: input.model ?? this.model,
      prompt: input.prompt,
      negative_prompt: input.negativePrompt,
      image_url: input.referenceImageUrls?.[0],
      params: input.defaultParams ? safeJson(input.defaultParams) : undefined,
    }
    const res = await fetchWithRetry(
      `${this.baseUrl}/video/generations`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      },
      { timeoutMs: 120_000, retries: 2 },
    ).catch((e) => wrapHttpError('视频任务提交失败', e))
    const data = await res.json()
    return this.mapStatus(data)
  }

  async getTaskStatus(remoteTaskId: string): Promise<VideoProviderTaskState> {
    const res = await fetchWithRetry(
      `${this.baseUrl}/video/generations/${encodeURIComponent(remoteTaskId)}`,
      {
        method: 'GET',
        headers: this.headers(),
      },
      { timeoutMs: 60_000, retries: 2 },
    ).catch((e) => wrapHttpError('视频任务查询失败', e))
    const data = await res.json()
    return this.mapStatus(data)
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}
