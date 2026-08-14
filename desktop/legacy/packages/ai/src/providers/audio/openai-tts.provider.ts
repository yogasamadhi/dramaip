import { getTtsProviderCapability, type TtsGenerationInput, type TtsGenerationResult, type TtsProvider, type TtsProviderConfig } from '@sdns/core'
import { fetchWithRetry } from '../http-client'

const DEFAULT_MODEL = 'gpt-4o-mini-tts'
export interface OpenAITtsTransport { request(input: { url: string; headers: Record<string, string>; body: Record<string, unknown>; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; contentType?: string }> }
export class FetchOpenAITtsTransport implements OpenAITtsTransport {
  async request(input: { url: string; headers: Record<string, string>; body: Record<string, unknown>; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; contentType?: string }> {
    const response = await fetchWithRetry(input.url, { method: 'POST', headers: input.headers, body: JSON.stringify(input.body) }, { timeoutMs: 120_000, retries: 1, signal: input.signal })
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? undefined }
  }
}
/** Official synchronous Speech endpoint adapter; no undocumented poll/cancel or custom-voice upload is exposed. */
export class OpenAITtsProvider implements TtsProvider {
  readonly kind = 'openai_tts' as const
  constructor(private readonly config: TtsProviderConfig, private readonly transport: OpenAITtsTransport = new FetchOpenAITtsTransport()) {}
  async generate(input: TtsGenerationInput, signal?: AbortSignal): Promise<TtsGenerationResult> {
    const capability = getTtsProviderCapability(this.config)
    if (!capability.canSubmit) throw new Error(capability.reason ?? 'OpenAI TTS 当前不可提交')
    if (!input.input.trim() || input.input.length > 4_096) throw new Error('OpenAI TTS 文本必须为 1 到 4096 个字符')
    const model = input.model?.trim() || this.config.model?.trim() || DEFAULT_MODEL
    const format = input.responseFormat ?? 'mp3'
    const body: Record<string, unknown> = { model, input: input.input, voice: input.voice, response_format: format }
    if (input.instructions?.trim()) body.instructions = input.instructions.trim()
    if (input.speed !== undefined) body.speed = input.speed
    const raw = await this.transport.request({ url: 'https://api.openai.com/v1/audio/speech', headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' }, body, signal })
    if (!raw.bytes.length) throw new Error('OpenAI TTS 未返回音频内容')
    return { model, voice: input.voice, mimeType: raw.contentType?.split(';')[0] || mimeTypeFor(format), b64Audio: Buffer.from(raw.bytes).toString('base64') }
  }
}
function mimeTypeFor(format: NonNullable<TtsGenerationInput['responseFormat']>): string { return ({ mp3: 'audio/mpeg', opus: 'audio/opus', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', pcm: 'audio/pcm' })[format] }
