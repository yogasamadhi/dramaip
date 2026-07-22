/** Explicit capability truth for remote TTS. Voice cloning is never enabled by this adapter. */
export type TtsProviderKind = 'mock_tts' | 'openai_tts'
export interface TtsProviderConfig { kind: TtsProviderKind; apiKey?: string; model?: string; featureEnabled?: boolean }
export interface TtsProviderCapability {
  canSubmit: boolean
  supportsBuiltInVoices: boolean
  supportsCustomVoices: boolean
  supportsRemoteCancel: boolean
  reason?: string
}
export interface TtsGenerationInput {
  input: string
  voice: string
  model?: string
  instructions?: string
  speed?: number
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
}
export interface TtsGenerationResult { model: string; voice: string; mimeType: string; b64Audio: string }
export interface TtsProvider { readonly kind: TtsProviderKind; generate(input: TtsGenerationInput, signal?: AbortSignal): Promise<TtsGenerationResult> }

export function getTtsProviderCapability(config: TtsProviderConfig): TtsProviderCapability {
  if (config.kind === 'mock_tts') return { canSubmit: true, supportsBuiltInVoices: true, supportsCustomVoices: false, supportsRemoteCancel: false }
  if (!config.apiKey?.trim()) return { canSubmit: false, supportsBuiltInVoices: true, supportsCustomVoices: false, supportsRemoteCancel: false, reason: 'OpenAI TTS 缺少 API Key，不能提交任务。' }
  if (config.featureEnabled !== true) return { canSubmit: false, supportsBuiltInVoices: true, supportsCustomVoices: false, supportsRemoteCancel: false, reason: 'OpenAI TTS 生产渠道开关尚未开启，不能提交任务。' }
  return { canSubmit: true, supportsBuiltInVoices: true, supportsCustomVoices: false, supportsRemoteCancel: false }
}
