import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { ChatInput, ChatOutput, LLMProvider, ModelConfig } from '@sdns/core'
import { withCloudAccessToken } from './cloud-auth'
import {
  CLOUD_AI_PROVIDER_ID,
  cloudBaseUrl,
  isCloudModelConfig,
  parseCloudProvider,
  cloudRequestHash,
  summarizeCloudContext,
  type CloudAIModel,
} from './cloud-ai-protocol'

const CLOUD_AI_TIMEOUT_MS = 95_000

export { CLOUD_AI_PROVIDER_ID, cloudBaseUrl, isCloudModelConfig }
export type { CloudAIModel }

export interface CloudAIPreflight {
  model: CloudAIModel
  estimatedTokens: number
  remainingTokens: number
  requestHash: string
}

interface CloudAIChatReply {
  requestId: string
  content: string
  provider: string
  model: string
  totalTokens: number
  remainingTokens: number
  status: string
}

export async function listCloudAIModels(): Promise<CloudAIModel[]> {
  const response = await cloudRequest('/v1/desktop/ai/models', { method: 'GET' }) as { models?: unknown }
  if (!Array.isArray(response.models)) throw new Error('云端模型列表响应无效')
  return response.models.map(parseCloudModel)
}

export async function preflightCloudAI(provider: string, model: string, input: ChatInput): Promise<CloudAIPreflight> {
  const summary = summarizeCloudContext(input.messages, input.maxTokens ?? 1_024)
  const requestHash = cloudRequestHash(provider, model, input)
  const response = await cloudRequest('/v1/desktop/ai/preflight', {
    method: 'POST',
    body: JSON.stringify({
      provider,
      model,
      context_characters: summary.contextCharacters,
      message_count: summary.messages.length,
      max_tokens: input.maxTokens ?? 1_024,
      request_hash: requestHash,
    }),
    signal: input.signal,
  }) as { model?: unknown; estimated_tokens?: unknown; remaining_tokens?: unknown; request_hash?: unknown }
  const estimatedTokens = integer(response.estimated_tokens)
  const remainingTokens = integer(response.remaining_tokens)
  if (estimatedTokens === undefined || remainingTokens === undefined || response.request_hash !== requestHash) {
    throw new Error('云端预检响应无效')
  }
  if (remainingTokens < estimatedTokens) throw new Error('云端额度不足，无法开始本次生成。')
  return { model: parseCloudModel(response.model), estimatedTokens, remainingTokens, requestHash }
}

export async function preflightCloudModelConfig(config: ModelConfig, input: ChatInput): Promise<CloudAIPreflight> {
  const provider = parseCloudProvider(config.baseUrl)
  if (!isCloudModelConfig(config) || !provider) throw new Error('云端模型配置无效')
  return preflightCloudAI(provider, config.model, input)
}

export function cloudProviderFromModelConfig(
  config: ModelConfig,
  options: { onPreflight?: (preflight: CloudAIPreflight) => void | Promise<void> } = {},
): LLMProvider {
  const provider = parseCloudProvider(config.baseUrl)
  if (!isCloudModelConfig(config) || !provider) throw new Error('云端模型配置无效')
  return {
    name: CLOUD_AI_PROVIDER_ID,
    model: config.model,
    chat: async (input) => {
      const preflight = await preflightCloudModelConfig(config, input)
      await options.onPreflight?.(preflight)
      const reply = await chatCloudAI(provider, config.model, input, preflight.requestHash)
      return {
        content: reply.content,
        tokenUsage: reply.totalTokens,
        raw: {
          requestId: reply.requestId,
          provider: reply.provider,
          model: reply.model,
          remainingTokens: reply.remainingTokens,
          status: reply.status,
        },
      } satisfies ChatOutput
    },
  }
}

async function chatCloudAI(
  provider: string,
  model: string,
  input: ChatInput,
  preflightRequestHash: string,
): Promise<CloudAIChatReply> {
  const summary = summarizeCloudContext(input.messages, input.maxTokens ?? 1_024)
  if (cloudRequestHash(provider, model, input) !== preflightRequestHash) {
    throw new Error('云端预检与生成请求不一致，请重新执行。')
  }
  const requestID = randomUUID()
  const response = await cloudRequest('/v1/desktop/ai/chat', {
    method: 'POST',
    body: JSON.stringify({
      request_id: requestID,
      idempotency_key: requestID,
      provider,
      model,
      messages: summary.messages,
      max_tokens: input.maxTokens ?? 1_024,
      preflight_request_hash: preflightRequestHash,
    }),
    signal: input.signal,
  }) as Record<string, unknown>
  const reply = {
    requestId: stringValue(response.request_id),
    content: stringValue(response.content),
    provider: stringValue(response.provider),
    model: stringValue(response.model),
    totalTokens: integer(response.total_tokens),
    remainingTokens: integer(response.remaining_tokens),
    status: stringValue(response.status),
  }
  if (!reply.requestId || !reply.content || !reply.provider || !reply.model || reply.totalTokens === undefined || reply.remainingTokens === undefined || !reply.status) {
    throw new Error('云端生成响应无效')
  }
  broadcastCloudBalance(reply.remainingTokens)
  return reply as CloudAIChatReply
}

async function cloudRequest(path: string, init: RequestInit): Promise<unknown> {
  return withCloudAccessToken(async ({ bffOrigin }, accessToken) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('云端生成超时')), CLOUD_AI_TIMEOUT_MS)
    const sourceSignal = init.signal ?? undefined
    const abort = () => controller.abort(inputAbortReason(sourceSignal))
    sourceSignal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(`${bffOrigin}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
      })
      const payload = await response.json().catch(() => undefined)
      if (!response.ok) throw new Error(cloudRequestError(response.status, payload))
      return payload
    } finally {
      clearTimeout(timeout)
      sourceSignal?.removeEventListener('abort', abort)
    }
  })
}

function cloudRequestError(status: number, payload: unknown): string {
  const code = payload && typeof payload === 'object'
    ? (payload as { error?: { code?: unknown } }).error?.code
    : undefined
  if (code === 'cloud_quota_insufficient') return '云端额度不足，无法开始本次生成。'
  if (code === 'cloud_preflight_request_mismatch') return '云端预检与生成请求不一致，请重新执行。'
  if (typeof code === 'string' && code) return `云端 AI 请求失败：${code}`
  return `云端 AI 请求失败（${status}）`
}

function parseCloudModel(value: unknown): CloudAIModel {
  const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const provider = stringValue(item.provider)
  const model = stringValue(item.model)
  if (!provider || !model || typeof item.is_default !== 'boolean') throw new Error('云端模型数据无效')
  return { provider, model, isDefault: item.is_default }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function inputAbortReason(signal: AbortSignal | undefined): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error('云端生成已取消')
}

function broadcastCloudBalance(remainingTokens: number): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('cloudAI:balance', { remainingTokens })
  }
}
