import { VIDEO_PROVIDER_KIND_LABELS, type VideoProviderKind } from '@sdns/core'
import type {
  VideoProviderAdapter,
  VideoProviderHttpRequest,
  VideoProviderRequestPhase,
  VideoProviderRuntimeConfig,
} from './adapter'
import type { VideoProviderResult, VideoProviderTaskState, VideoTaskStatus } from '@sdns/core'
import { HttpRequestError } from '../http-client'

export type RealVideoProviderKind = Exclude<VideoProviderKind, 'mock' | 'custom'>

export const REAL_VIDEO_PROVIDER_KINDS: RealVideoProviderKind[] = [
  'jimeng',
  'kling',
  'hailuo',
  'runway',
  'pika',
  'openai_sora',
]

interface PlatformTaskResponse {
  id?: string
  task_id?: string
  status?: string
  task_status?: string
  data?: {
    id?: string
    task_id?: string
    status?: string
    task_status?: string
    videos?: Array<{ url?: string; video_url?: string; cover_image_url?: string; cover_url?: string }>
    video_url?: string
    cover_image_url?: string
    error?: string
    message?: string
  }
  videos?: Array<{ url?: string; video_url?: string; cover_image_url?: string; cover_url?: string }>
  video_url?: string
  cover_image_url?: string
  error?: string
  message?: string
}

export const customVideoProviderAdapter: VideoProviderAdapter = {
  kind: 'custom',
  label: VIDEO_PROVIDER_KIND_LABELS['custom'] ?? 'Custom',
  authHeaders,
  createTaskRequest(input, config) {
    const baseUrl = requireBaseUrl(config, this.label)
    return {
      method: 'POST',
      url: `${baseUrl}/video/generations`,
      headers: jsonHeaders(this.authHeaders(config)),
      body: {
        model: input.model ?? config.model,
        prompt: input.prompt,
        negative_prompt: input.negativePrompt,
        image_url: input.referenceImageUrls?.[0],
        reference_image_urls: input.referenceImageUrls,
        params: input.defaultParams ? safeJson(input.defaultParams) : undefined,
      },
      timeoutMs: 120_000,
      retries: 2,
    }
  },
  getTaskStatusRequest(remoteTaskId, config) {
    const baseUrl = requireBaseUrl(config, this.label)
    return {
      method: 'GET',
      url: `${baseUrl}/video/generations/${encodeURIComponent(remoteTaskId)}`,
      headers: jsonHeaders(this.authHeaders(config)),
      timeoutMs: 60_000,
      retries: 2,
    }
  },
  mapTaskState: mapOpenAiCompatibleTaskState,
  normalizeError(error, phase) {
    return normalizeVideoProviderError(this.label, phase, error)
  },
}

export const VIDEO_PROVIDER_ADAPTERS: Record<Exclude<VideoProviderKind, 'mock'>, VideoProviderAdapter> = {
  custom: customVideoProviderAdapter,
  jimeng: notImplementedRealPlatformAdapter('jimeng'),
  kling: notImplementedRealPlatformAdapter('kling'),
  hailuo: notImplementedRealPlatformAdapter('hailuo'),
  runway: notImplementedRealPlatformAdapter('runway'),
  pika: notImplementedRealPlatformAdapter('pika'),
  openai_sora: notImplementedRealPlatformAdapter('openai_sora'),
}

export function adapterForVideoProviderKind(kind: Exclude<VideoProviderKind, 'mock'>): VideoProviderAdapter {
  return VIDEO_PROVIDER_ADAPTERS[kind] ?? customVideoProviderAdapter
}

export function mapOpenAiCompatibleTaskState(raw: unknown): VideoProviderTaskState {
  const r = raw as PlatformTaskResponse
  const data = r.data ?? {}
  const rawStatus = (data.task_status ?? data.status ?? r.task_status ?? r.status ?? '').toLowerCase()
  const status: VideoTaskStatus =
    rawStatus.includes('succ') || rawStatus === 'completed' || rawStatus === 'done'
      ? 'success'
      : rawStatus.includes('fail') || rawStatus.includes('error') || rawStatus === 'canceled'
        ? 'failed'
        : rawStatus.includes('process') || rawStatus.includes('run') || rawStatus.includes('pend')
          ? 'running'
          : 'pending'
  const videos = data.videos ?? r.videos ?? (data.video_url || r.video_url
    ? [{ video_url: data.video_url ?? r.video_url, cover_image_url: data.cover_image_url ?? r.cover_image_url }]
    : [])
  const rawMeta = safeStringify(raw)
  const results: VideoProviderResult[] = videos
    .map((v) => ({
      resultVideoUrl: v.url ?? v.video_url ?? '',
      coverImageUrl: v.cover_image_url ?? v.cover_url,
      rawMeta,
    }))
    .filter((v) => v.resultVideoUrl)
  return {
    status,
    remoteTaskId: data.task_id ?? data.id ?? r.task_id ?? r.id,
    errorMessage: data.error ?? data.message ?? r.error ?? r.message,
    results,
  }
}

export function normalizeVideoProviderError(label: string, phase: VideoProviderRequestPhase, error: unknown): Error {
  const action = phase === 'create' ? '提交' : '查询'
  if (error instanceof HttpRequestError) return new Error(`${label} 视频任务${action}失败：${error.message}`)
  if (error instanceof Error) return new Error(`${label} 视频任务${action}失败：${error.message}`)
  return new Error(`${label} 视频任务${action}失败：${String(error)}`)
}

function notImplementedRealPlatformAdapter(kind: RealVideoProviderKind): VideoProviderAdapter {
  const label = VIDEO_PROVIDER_KIND_LABELS[kind] ?? kind
  const notReady = (): VideoProviderHttpRequest => {
    throw new Error(`视频平台「${label}」适配器框架已注册，但真实 API 映射尚未启用；请在 L5-02 中补充平台专用鉴权、请求路径、状态映射和错误归一化。`)
  }
  return {
    kind,
    label,
    authHeaders,
    createTaskRequest: notReady,
    getTaskStatusRequest: notReady,
    mapTaskState: mapOpenAiCompatibleTaskState,
    normalizeError(error, phase) {
      return normalizeVideoProviderError(label, phase, error)
    },
  }
}

function authHeaders(config: VideoProviderRuntimeConfig): Record<string, string> {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}
}

function jsonHeaders(headers: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', ...headers }
}

function requireBaseUrl(config: VideoProviderRuntimeConfig, label: string): string {
  const baseUrl = config.baseUrl?.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error(`${label} 缺少 Base URL`)
  return baseUrl
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}
