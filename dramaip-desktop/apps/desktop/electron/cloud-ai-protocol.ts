import { createHash } from 'node:crypto'
import type { ChatInput, ChatMessage, ModelConfig } from '@sdns/core'

export const CLOUD_AI_PROVIDER_ID = 'dramaip-cloud'
export const CLOUD_AI_BASE_URL_PREFIX = 'cloud://'
export const CLOUD_AI_MAX_CONTEXT_CHARACTERS = 24_000
export const CLOUD_AI_MAX_MESSAGES = 8
export const CLOUD_AI_MAX_TOKENS = 8_192

export interface CloudAIModel {
  provider: string
  model: string
  isDefault: boolean
}

export interface CloudAIContextSummary {
  messages: ChatMessage[]
  contextCharacters: number
}

/**
 * A content-free binding sent to the authority before generation. The digest
 * is recomputed by the gateway when Chat arrives, so a preflight for one
 * prompt/model cannot authorize another request.
 */
export function cloudRequestHash(provider: string, model: string, input: ChatInput): string {
  const summary = summarizeCloudContext(input.messages, input.maxTokens ?? 1_024)
  const hash = createHash('sha256')
  for (const part of [provider, model, String(input.maxTokens ?? 1_024)]) hash.update(part).update('\0')
  for (const message of summary.messages) hash.update(message.role).update('\0').update(message.content).update('\0')
  return hash.digest('base64url')
}

export function isCloudModelConfig(config: Pick<ModelConfig, 'provider' | 'baseUrl'>): boolean {
  return config.provider === CLOUD_AI_PROVIDER_ID && parseCloudProvider(config.baseUrl) !== undefined
}

export function cloudBaseUrl(provider: string): string {
  if (!isCloudProviderName(provider)) throw new Error('云端 Provider 标识无效')
  return `${CLOUD_AI_BASE_URL_PREFIX}${provider}`
}

export function parseCloudProvider(baseUrl: string): string | undefined {
  if (!baseUrl.startsWith(CLOUD_AI_BASE_URL_PREFIX)) return undefined
  const provider = baseUrl.slice(CLOUD_AI_BASE_URL_PREFIX.length)
  return isCloudProviderName(provider) ? provider : undefined
}

// Cloud calls accept only the active workflow prompt. They never read a local
// project database, file path, diagnostic payload, or arbitrary renderer state.
export function summarizeCloudContext(messages: ChatMessage[], maxTokens: number): CloudAIContextSummary {
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > CLOUD_AI_MAX_TOKENS) {
    throw new Error('云端生成 Token 上限无效')
  }
  if (messages.length === 0 || messages.length > CLOUD_AI_MAX_MESSAGES) {
    throw new Error('云端上下文消息数量超出限制')
  }
  let contextCharacters = 0
  const safeMessages = messages.map((message) => {
    if (!['system', 'user', 'assistant'].includes(message.role) || !message.content.trim()) {
      throw new Error('云端上下文包含无效消息')
    }
    contextCharacters += Array.from(message.content).length
    if (contextCharacters > CLOUD_AI_MAX_CONTEXT_CHARACTERS) {
      throw new Error('云端上下文超过 24,000 字符限制')
    }
    return { role: message.role, content: message.content }
  })
  return { messages: safeMessages, contextCharacters }
}

function isCloudProviderName(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(value)
}
