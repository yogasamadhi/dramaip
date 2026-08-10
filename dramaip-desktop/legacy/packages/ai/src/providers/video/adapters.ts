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
  'wan',
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

interface OpenAiSoraTaskResponse {
  id?: string
  status?: string
  progress?: number
  error?: string | { code?: string; message?: string }
  model?: string
  prompt?: string
  seconds?: string | number
  size?: string
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

export const openAiSoraVideoProviderAdapter: VideoProviderAdapter = {
  kind: 'openai_sora',
  label: VIDEO_PROVIDER_KIND_LABELS['openai_sora'] ?? 'OpenAI Sora',
  authHeaders,
  createTaskRequest(input, config) {
    const baseUrl = baseUrlOrDefault(config, 'https://api.openai.com/v1')
    const params = objectParams(input.defaultParams ?? config.defaultParams)
    const seconds = stringParam(params.seconds ?? params.duration, '8')
    const size = stringParam(params.size, '720x1280')
    const reference = buildSoraInputReference(input.referenceImageUrls?.[0], params)
    return {
      method: 'POST',
      url: `${baseUrl}/videos`,
      headers: jsonHeaders(this.authHeaders(config)),
      body: pruneUndefined({
        ...omitOpenAiSoraAliases(params),
        model: stringParam(input.model ?? config.model ?? params.model, 'sora-2'),
        prompt: input.prompt,
        size,
        seconds,
        input_reference: reference,
      }),
      timeoutMs: 120_000,
      retries: 1,
    }
  },
  getTaskStatusRequest(remoteTaskId, config) {
    const baseUrl = baseUrlOrDefault(config, 'https://api.openai.com/v1')
    return {
      method: 'GET',
      url: `${baseUrl}/videos/${encodeURIComponent(remoteTaskId)}`,
      headers: jsonHeaders(this.authHeaders(config)),
      timeoutMs: 60_000,
      retries: 2,
    }
  },
  mapTaskState(raw) {
    return mapOpenAiSoraTaskState(raw)
  },
  normalizeError(error, phase) {
    return normalizeVideoProviderError(this.label, phase, error)
  },
}

/**
 * MiniMax Hailuo's official API is deliberately modeled as three separate steps:
 * create task, query task, and retrieve the completed file's download URL.  The shared HTTP
 * provider executes the final retrieval through this adapter instead of leaking the MiniMax
 * file API into renderer, IPC, or persistence code.
 */
export const hailuoVideoProviderAdapter: VideoProviderAdapter = {
  kind: 'hailuo',
  label: VIDEO_PROVIDER_KIND_LABELS['hailuo'] ?? '海螺 Hailuo',
  authHeaders,
  createTaskRequest(input, config) {
    const baseUrl = baseUrlOrDefault(config, MINIMAX_DEFAULT_BASE_URL)
    const params = objectParams(input.defaultParams ?? config.defaultParams)
    const referenceImage = stringOrUndefined(input.referenceImageUrls?.[0])
    const duration = hailuoDuration(params.duration ?? params.seconds)
    const model = stringParam(input.model ?? config.model ?? params.model, 'MiniMax-Hailuo-2.3')
    const firstFrameImage = referenceImage ?? stringOrUndefined(params.first_frame_image)
    const lastFrameImage = model === 'MiniMax-Hailuo-02' ? stringOrUndefined(params.last_frame_image) : undefined
    if (firstFrameImage && !isHailuoImageReference(firstFrameImage)) {
      throw new Error('MiniMax Hailuo 参考图必须是可公开访问的 HTTPS URL 或 data:image Base64；本地文件不会自动上传')
    }
    if (lastFrameImage && !isHailuoImageReference(lastFrameImage)) {
      throw new Error('MiniMax Hailuo 尾帧必须是可公开访问的 HTTPS URL 或 data:image Base64；本地文件不会自动上传')
    }
    const body = pruneUndefined({
      model,
      prompt: input.prompt,
      // Hailuo does not accept a separate negative prompt. Do not concatenate it into the
      // authored prompt, which would silently change its semantics.
      first_frame_image: firstFrameImage,
      // The documented start/end-frame mode belongs to Hailuo-02. Do not silently submit an
      // unsupported parameter to the newer default model.
      last_frame_image: lastFrameImage,
      duration,
      resolution: hailuoResolution(params.resolution, duration),
      prompt_optimizer: booleanParam(params.prompt_optimizer, true),
      fast_pretreatment: booleanOrUndefined(params.fast_pretreatment),
      aigc_watermark: booleanOrUndefined(params.aigc_watermark),
    })
    return {
      method: 'POST',
      url: `${baseUrl}/v1/video_generation`,
      headers: jsonHeaders(this.authHeaders(config)),
      body,
      timeoutMs: 120_000,
      retries: 1,
    }
  },
  getTaskStatusRequest(remoteTaskId, config) {
    const baseUrl = baseUrlOrDefault(config, MINIMAX_DEFAULT_BASE_URL)
    return {
      method: 'GET',
      url: `${baseUrl}/v1/query/video_generation?task_id=${encodeURIComponent(remoteTaskId)}`,
      headers: jsonHeaders(this.authHeaders(config)),
      timeoutMs: 60_000,
      retries: 2,
    }
  },
  mapTaskState(raw) {
    return mapHailuoTaskState(raw)
  },
  getResultRequest(taskResponse, config) {
    const fileId = hailuoFileId(taskResponse)
    if (!fileId) return undefined
    const baseUrl = baseUrlOrDefault(config, MINIMAX_DEFAULT_BASE_URL)
    return {
      method: 'GET',
      url: `${baseUrl}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
      headers: jsonHeaders(this.authHeaders(config)),
      timeoutMs: 60_000,
      retries: 2,
    }
  },
  mapTaskResults(taskResponse, resultResponse) {
    const response = resultResponse as HailuoFileResponse
    const error = hailuoErrorMessage(response.base_resp?.status_code, response.base_resp?.status_msg)
    if (error) throw new Error(error)
    const downloadUrl = stringOrUndefined(response.file?.download_url)
    if (!downloadUrl) return []
    return [{
      resultVideoUrl: downloadUrl,
      rawMeta: safeStringify({ task: taskResponse, file: resultResponse }),
    }]
  },
  normalizeError(error, phase) {
    return normalizeVideoProviderError(this.label, phase, error)
  },
}

/**
 * Alibaba Cloud Model Studio Wan uses the DashScope asynchronous task protocol. The task result
 * contains a time-limited HTTPS video URL, which the shared video archiver persists locally.
 * The platform documents a remote cancel endpoint, but only while the task is still queued.
 */
export const wanVideoProviderAdapter: VideoProviderAdapter = {
  kind: 'wan',
  label: VIDEO_PROVIDER_KIND_LABELS.wan ?? '阿里云百炼 Wan',
  authHeaders,
  createTaskRequest(input, config) {
    const baseUrl = baseUrlOrDefault(config, DASHSCOPE_DEFAULT_BASE_URL)
    const params = objectParams(input.defaultParams ?? config.defaultParams)
    const referenceImageUrls = input.referenceImageUrls ?? []
    if (referenceImageUrls.length > 2) {
      throw new Error('阿里云百炼 Wan 2.7 仅接受首帧或首尾帧；一次最多提交 2 张参考图')
    }
    for (const reference of referenceImageUrls) {
      if (!isWanImageReference(reference)) {
        throw new Error('阿里云百炼 Wan 参考图必须是可公开访问的 HTTPS URL；本地文件不会自动上传')
      }
    }
    const model = wanModel(input.model ?? config.model ?? params.model, params, referenceImageUrls.length > 0)
    const imageToVideo = isWanImageToVideoModel(model)
    if (imageToVideo && referenceImageUrls.length === 0) {
      throw new Error('当前 Wan 图生视频模型需要至少一张 HTTPS 首帧参考图')
    }
    const media = referenceImageUrls.length
      ? referenceImageUrls.map((url, index) => ({ type: index === 0 ? 'first_frame' : 'last_frame', url }))
      : undefined
    const parameters = pruneUndefined({
      resolution: wanResolution(params.resolution),
      duration: wanDuration(params.duration ?? params.seconds),
      prompt_extend: booleanParam(params.prompt_extend, true),
      watermark: booleanParam(params.watermark, true),
      // The current Wan text-to-video API documents ratio; Wan image-to-video documents the
      // media list instead, so do not send a speculative ratio field in that mode.
      ratio: imageToVideo ? undefined : wanRatio(params.ratio ?? params.aspect_ratio),
    })
    return {
      method: 'POST',
      url: `${baseUrl}/services/aigc/video-generation/video-synthesis`,
      headers: jsonHeaders({ ...this.authHeaders(config), 'X-DashScope-Async': 'enable' }),
      body: {
        model,
        input: pruneUndefined({ prompt: input.prompt, media }),
        parameters,
      },
      timeoutMs: 120_000,
      retries: 1,
    }
  },
  getTaskStatusRequest(remoteTaskId, config) {
    const baseUrl = baseUrlOrDefault(config, DASHSCOPE_DEFAULT_BASE_URL)
    return {
      method: 'GET',
      url: `${baseUrl}/tasks/${encodeURIComponent(remoteTaskId)}`,
      headers: this.authHeaders(config),
      timeoutMs: 60_000,
      retries: 2,
    }
  },
  cancelTaskRequest(remoteTaskId, config) {
    const baseUrl = baseUrlOrDefault(config, DASHSCOPE_DEFAULT_BASE_URL)
    return {
      method: 'POST',
      url: `${baseUrl}/tasks/${encodeURIComponent(remoteTaskId)}/cancel`,
      headers: this.authHeaders(config),
      timeoutMs: 30_000,
      retries: 1,
    }
  },
  mapTaskState(raw) {
    return mapWanTaskState(raw)
  },
  normalizeError(error, phase) {
    return normalizeWanProviderError(phase, error)
  },
}

export const VIDEO_PROVIDER_ADAPTERS: Record<Exclude<VideoProviderKind, 'mock'>, VideoProviderAdapter> = {
  custom: customVideoProviderAdapter,
  jimeng: notImplementedRealPlatformAdapter('jimeng'),
  kling: notImplementedRealPlatformAdapter('kling'),
  hailuo: hailuoVideoProviderAdapter,
  wan: wanVideoProviderAdapter,
  runway: notImplementedRealPlatformAdapter('runway'),
  pika: notImplementedRealPlatformAdapter('pika'),
  openai_sora: openAiSoraVideoProviderAdapter,
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

export function mapOpenAiSoraTaskState(raw: unknown): VideoProviderTaskState {
  const r = raw as OpenAiSoraTaskResponse
  const rawStatus = (r.status ?? '').toLowerCase()
  const status: VideoTaskStatus =
    rawStatus === 'completed'
      ? 'success'
      : rawStatus === 'failed' || rawStatus === 'canceled'
        ? 'failed'
        : rawStatus === 'queued' || rawStatus === 'in_progress'
          ? 'running'
          : 'pending'
  const rawMeta = safeStringify(raw)
  const errorMessage = typeof r.error === 'string'
    ? r.error
    : r.error?.message
  const resultVideoUrl = status === 'success' && r.id
    ? `${OPENAI_SORA_DEFAULT_BASE_URL}/videos/${encodeURIComponent(r.id)}/content`
    : undefined
  return {
    status,
    remoteTaskId: r.id,
    errorMessage,
    results: resultVideoUrl
      ? [{
          resultVideoUrl,
          rawMeta,
        }]
      : [],
  }
}

interface HailuoTaskResponse {
  task_id?: string | number
  status?: string
  file_id?: string | number
  error_message?: string
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

interface HailuoFileResponse {
  file?: {
    file_id?: string | number
    download_url?: string
  }
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
}

interface WanTaskResponse {
  request_id?: string
  code?: string
  message?: string
  output?: {
    task_id?: string
    task_status?: string
    video_url?: string
    code?: string
    message?: string
  }
}

/** Map documented MiniMax task and business-error responses to the shared task vocabulary. */
export function mapHailuoTaskState(raw: unknown): VideoProviderTaskState {
  const response = raw as HailuoTaskResponse
  const code = response.base_resp?.status_code
  const message = hailuoErrorMessage(code, response.base_resp?.status_msg)
    ?? (code === undefined ? stringOrUndefined(response.error_message) : undefined)
  if (code !== undefined && code !== 0) {
    return {
      status: 'failed',
      remoteTaskId: valueToString(response.task_id),
      errorMessage: message,
      results: [],
    }
  }

  const rawStatus = (response.status ?? '').trim().toLowerCase()
  const status: VideoTaskStatus = rawStatus === 'success'
    ? 'success'
    : rawStatus === 'fail' || rawStatus === 'failed'
      ? 'failed'
      : rawStatus === 'processing'
        ? 'running'
        : 'pending'
  return {
    status,
    remoteTaskId: valueToString(response.task_id),
    errorMessage: status === 'failed' ? message ?? 'MiniMax Hailuo 返回任务失败' : undefined,
    results: [],
  }
}

/** Map DashScope's documented PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED vocabulary. */
export function mapWanTaskState(raw: unknown): VideoProviderTaskState {
  const response = raw as WanTaskResponse
  const output = response.output ?? {}
  const rawStatus = (output.task_status ?? '').trim().toUpperCase()
  const videoUrl = stringOrUndefined(output.video_url)
  const normalizedError = wanErrorMessage(output.code ?? response.code, output.message ?? response.message)

  const status: VideoTaskStatus = rawStatus === 'SUCCEEDED'
    ? videoUrl ? 'success' : 'failed'
    : rawStatus === 'FAILED' || rawStatus === 'UNKNOWN'
      ? 'failed'
      : rawStatus === 'CANCELED'
        ? 'canceled'
        : rawStatus === 'RUNNING'
          ? 'running'
          : 'pending'

  return {
    status,
    remoteTaskId: stringOrUndefined(output.task_id),
    errorMessage: status === 'failed'
      ? normalizedError ?? (rawStatus === 'SUCCEEDED' ? '阿里云百炼 Wan 已成功但未返回可下载的视频 URL' : '阿里云百炼 Wan 返回任务失败')
      : undefined,
    results: status === 'success' && videoUrl
      ? [{ resultVideoUrl: videoUrl, rawMeta: safeStringify(raw) }]
      : [],
  }
}

export function normalizeVideoProviderError(label: string, phase: VideoProviderRequestPhase, error: unknown): Error {
  const action = phase === 'create' ? '提交' : phase === 'cancel' ? '取消' : '查询'
  if (error instanceof HttpRequestError) return new Error(`${label} 视频任务${action}失败：${error.message}`)
  if (error instanceof Error) return new Error(`${label} 视频任务${action}失败：${error.message}`)
  return new Error(`${label} 视频任务${action}失败：${String(error)}`)
}

function normalizeWanProviderError(phase: VideoProviderRequestPhase, error: unknown): Error {
  const action = phase === 'create' ? '提交' : phase === 'cancel' ? '取消' : '查询'
  if (error instanceof HttpRequestError) {
    const detail = safeJson(error.detail)
    const source = detail && typeof detail === 'object' && !Array.isArray(detail)
      ? detail as { code?: unknown; message?: unknown }
      : undefined
    const code = stringOrUndefined(source?.code)
    const message = stringOrUndefined(source?.message)
    return new Error(`阿里云百炼 Wan 视频任务${action}失败：${wanErrorMessage(code, message) ?? error.message}`)
  }
  return normalizeVideoProviderError('阿里云百炼 Wan', phase, error)
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

const OPENAI_SORA_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.com'
const DASHSCOPE_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
const WAN_TEXT_TO_VIDEO_DEFAULT_MODEL = 'wan2.7-t2v-2026-06-12'
const WAN_IMAGE_TO_VIDEO_DEFAULT_MODEL = 'wan2.7-i2v-2026-04-25'

function baseUrlOrDefault(config: VideoProviderRuntimeConfig, defaultBaseUrl: string): string {
  return config.baseUrl?.trim().replace(/\/+$/, '') || defaultBaseUrl
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

function objectParams(s: string | undefined): Record<string, unknown> {
  const parsed = s ? safeJson(s) : undefined
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
}

function stringParam(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function buildSoraInputReference(
  url: string | undefined,
  params: Record<string, unknown>,
): { image_url?: string; file_id?: string } | undefined {
  if (params.input_reference && typeof params.input_reference === 'object') {
    return params.input_reference as { image_url?: string; file_id?: string }
  }
  const fileId = stringOrUndefined(params.input_reference_file_id ?? params.file_id)
  const imageUrl = stringOrUndefined(url ?? params.input_reference_url ?? params.reference_image_url ?? params.image_url)
  if (!fileId && !imageUrl) return undefined
  return pruneUndefined({ file_id: fileId, image_url: imageUrl }) as { image_url?: string; file_id?: string }
}

function omitOpenAiSoraAliases(params: Record<string, unknown>): Record<string, unknown> {
  const {
    duration: _duration,
    input_reference: _inputReference,
    input_reference_file_id: _inputReferenceFileId,
    input_reference_url: _inputReferenceUrl,
    reference_image_url: _referenceImageUrl,
    image_url: _imageUrl,
    file_id: _fileId,
    ...rest
  } = params
  return rest
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function valueToString(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function hailuoFileId(raw: unknown): string | undefined {
  return valueToString((raw as HailuoTaskResponse).file_id)
}

function isHailuoImageReference(value: string): boolean {
  return /^https:\/\//i.test(value) || /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)
}

function hailuoDuration(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return parsed === 10 ? 10 : 6
}

function hailuoResolution(value: unknown, duration: number): string {
  const normalized = stringOrUndefined(value)?.toUpperCase()
  if (duration === 10 && normalized === '1080P') return '768P'
  return normalized === '512P' || normalized === '1080P' ? normalized : '768P'
}

function wanModel(value: unknown, params: Record<string, unknown>, hasReferenceImages: boolean): string {
  const configured = stringParam(value, WAN_TEXT_TO_VIDEO_DEFAULT_MODEL)
  if (!hasReferenceImages) return configured
  if (isWanImageToVideoModel(configured)) return configured
  return stringParam(params.imageModel ?? params.image_model, WAN_IMAGE_TO_VIDEO_DEFAULT_MODEL)
}

function isWanImageToVideoModel(model: string): boolean {
  return /(?:^|-)i2v(?:-|$)|(?:^|-)kf2v(?:-|$)/i.test(model)
}

function isWanImageReference(value: string): boolean {
  return /^https:\/\//i.test(value)
}

function wanResolution(value: unknown): string {
  const resolution = stringOrUndefined(value)?.toUpperCase()
  return resolution === '480P' || resolution === '1080P' || resolution === '4K' ? resolution : '720P'
}

function wanDuration(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return 10
  return Math.min(15, Math.max(3, Math.round(parsed)))
}

function wanRatio(value: unknown): string {
  const ratio = stringOrUndefined(value)
  return ratio === '16:9' || ratio === '1:1' ? ratio : '9:16'
}

function booleanParam(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function hailuoErrorMessage(code: number | undefined, detail?: string): string | undefined {
  if (code === undefined || code === 0) return undefined
  const category = new Map<number, string>([
    [1002, '请求被限流，请稍后重试'],
    [1004, 'API Key 鉴权失败，请检查钥匙串中的凭据'],
    [1008, '账户额度不足，请检查 MiniMax 账户余额'],
    [1026, '输入内容未通过平台内容审核，请调整镜头描述'],
    [1027, '生成结果未通过平台内容审核，请调整镜头描述'],
    [2013, '请求参数无效，请检查模型、时长、分辨率与参考图'],
    [2049, 'API Key 无效，请检查钥匙串中的凭据'],
  ]).get(code) ?? `平台业务错误（${code}）`
  return detail && detail !== 'success' ? `${category}：${detail}` : category
}

function wanErrorMessage(code: string | undefined, detail?: string): string | undefined {
  if (!code && !detail) return undefined
  const category = new Map<string, string>([
    ['InvalidApiKey', 'API Key 鉴权失败，请检查本地凭据配置与地域'],
    ['Throttling.RateQuota', '请求被限流，请稍后重试'],
    ['QuotaExhausted', '账户额度不足，请检查百炼账户余额'],
    ['DataInspectionFailed', '输入或生成结果未通过平台内容审核，请调整镜头描述'],
    ['InvalidParameter', '请求参数无效，请检查模型、时长、分辨率与参考图'],
    ['UnsupportedOperation', '远端取消失败：任务可能已开始执行；百炼仅允许取消排队中的任务'],
  ]).get(code ?? '') ?? (code ? `平台业务错误（${code}）` : '平台业务错误')
  return detail ? `${category}：${detail}` : category
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}
