import type { VideoProviderConfig } from './types'

/** Renderer-safe provider truth: only configured adapters can be submitted from the production console. */
export interface VideoProviderCapability {
  canSubmit: boolean
  supportsReferenceImages: boolean
  supportsRemoteCancel: boolean
  reason?: string
}

export interface VideoProductionEstimate {
  model: string
  durationSeconds: number
  waitSeconds: number
  estimatedCost?: number
  currency?: string
}

/** 适配器框架已注册但真实 API 映射尚未启用的 Provider；UI 中应标记为「即将支持」并禁用选择。 */
export const PENDING_REAL_ADAPTERS = new Set<VideoProviderConfig['kind']>([
  'jimeng',
  'kling',
  'runway',
  'pika',
])

/**
 * Do not let a config-only adapter look usable. Pending domestic providers remain disabled until
 * their dedicated adapter loops provide an official request mapping and sandbox evidence.
 */
export function getVideoProviderCapability(config: Pick<VideoProviderConfig, 'kind' | 'baseUrl' | 'apiKey' | 'defaultParams'>): VideoProviderCapability {
  if (PENDING_REAL_ADAPTERS.has(config.kind)) {
    return {
      canSubmit: false,
      supportsReferenceImages: false,
      supportsRemoteCancel: false,
      reason: '该 Provider 的真实适配器尚未启用，不能提交任务。',
    }
  }
  if (config.kind === 'custom' && !config.baseUrl?.trim()) {
    return {
      canSubmit: false,
      supportsReferenceImages: true,
      supportsRemoteCancel: false,
      reason: '自定义 Provider 缺少 Base URL，不能提交任务。',
    }
  }
  if (config.kind === 'openai_sora' && !config.apiKey?.trim()) {
    return {
      canSubmit: false,
      supportsReferenceImages: true,
      supportsRemoteCancel: false,
      reason: 'OpenAI Sora 缺少 API Key，不能提交任务。',
    }
  }
  if (config.kind === 'hailuo' || config.kind === 'wan') {
    const label = config.kind === 'wan' ? '阿里云百炼 Wan' : 'MiniMax Hailuo'
    if (!config.apiKey?.trim()) {
      return {
        canSubmit: false,
        supportsReferenceImages: true,
        supportsRemoteCancel: false,
        reason: `${label} 缺少 API Key，不能提交任务。`,
      }
    }
    if (!isVideoProviderFeatureEnabled(config)) {
      return {
        canSubmit: false,
        supportsReferenceImages: true,
        supportsRemoteCancel: false,
        reason: `${label} 生产渠道开关尚未开启，不能提交任务。`,
      }
    }
  }
  return {
    canSubmit: true,
    supportsReferenceImages: true,
    // Model Studio documents remote cancellation for queued tasks only. All other adapters
    // retain honest local stop-tracking semantics through the persisted LongTask boundary.
    supportsRemoteCancel: config.kind === 'wan',
  }
}

/**
 * A provider-local, persisted release switch. It is intentionally opt-in so adding an API key
 * cannot accidentally create a billable external task. The flag is not a secret and is stored
 * alongside the provider defaults; the key itself remains in the local credential store.
 */
export function isVideoProviderFeatureEnabled(
  config: Pick<VideoProviderConfig, 'kind' | 'defaultParams'>,
): boolean {
  if (config.kind !== 'hailuo' && config.kind !== 'wan') return true
  return parseParams(config.defaultParams).featureEnabled === true
}

/** Builds a bounded local estimate from optional provider defaults without claiming an external quote. */
export function estimateVideoProduction(config: Pick<VideoProviderConfig, 'kind' | 'model' | 'defaultParams'>): VideoProductionEstimate {
  const params = parseParams(config.defaultParams)
  const durationSeconds = positiveNumber(params.seconds ?? params.duration, config.kind === 'mock' ? 4 : 8, 1, 60)
  const estimatedCost = finiteNumber(params.estimatedCost ?? params.estimateCost ?? params.cost)
    ?? multiplyFinite(params.costPerSecond, durationSeconds)
  const currency = typeof params.currency === 'string' && params.currency.trim() ? params.currency.trim().toUpperCase() : undefined
  return {
    model: config.model?.trim() || (config.kind === 'mock' ? 'mock-v1' : 'default'),
    durationSeconds,
    waitSeconds: config.kind === 'mock' ? 1 : Math.max(30, durationSeconds * 15),
    estimatedCost,
    currency,
  }
}

function parseParams(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function positiveNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function multiplyFinite(value: unknown, multiplier: number): number | undefined {
  const base = finiteNumber(value)
  return base === undefined ? undefined : Number((base * multiplier).toFixed(6))
}
