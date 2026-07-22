import { getImageProviderCapability, type ImageGenerationInput, type ImageGenerationResult, type ImageProvider, type ImageProviderConfig } from '@sdns/core'
import { fetchWithRetry } from '../http-client'

const DEFAULT_MODEL = 'gpt-image-2'

export interface OpenAIImageTransport {
  request(input: { url: string; headers: Record<string, string>; body: Record<string, unknown> }): Promise<unknown>
}

export class FetchOpenAIImageTransport implements OpenAIImageTransport {
  async request(input: { url: string; headers: Record<string, string>; body: Record<string, unknown> }): Promise<unknown> {
    const response = await fetchWithRetry(input.url, { method: 'POST', headers: input.headers, body: JSON.stringify(input.body) }, { timeoutMs: 120_000, retries: 1 })
    return response.json()
  }
}

/** Official OpenAI Images API adapter. It is synchronous by design: no undocumented polling or cancel endpoint is fabricated. */
export class OpenAIImageProvider implements ImageProvider {
  readonly kind = 'openai_image' as const

  constructor(
    private readonly config: ImageProviderConfig,
    private readonly transport: OpenAIImageTransport = new FetchOpenAIImageTransport(),
  ) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult[]> {
    const capability = getImageProviderCapability(this.config)
    if (!capability.canSubmit) throw new Error(capability.reason ?? 'OpenAI Image 当前不可提交')
    if (input.referenceImages?.length) throw new Error('OpenAI Image 的参考图编辑需走已验证的 edits 流程；当前文本生图任务不会上传本地参考图。')
    const model = input.model?.trim() || this.config.model?.trim() || DEFAULT_MODEL
    const outputFormat = input.outputFormat ?? 'png'
    const raw = await this.transport.request({
      url: 'https://api.openai.com/v1/images/generations',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: { model, prompt: input.prompt, size: input.size ?? '1024x1024', quality: input.quality ?? 'medium', output_format: outputFormat, n: 1 },
    })
    return mapOpenAIImageResponse(raw, model, outputFormat)
  }
}

export function mapOpenAIImageResponse(raw: unknown, model: string, outputFormat: ImageGenerationInput['outputFormat'] = 'png'): ImageGenerationResult[] {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const data = Array.isArray(value.data) ? value.data : []
  const usage = value.usage && typeof value.usage === 'object' ? value.usage as Record<string, unknown> : undefined
  const results = data.flatMap((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    if (typeof row.b64_json !== 'string' || !row.b64_json) return []
    return [{
      model,
      mimeType: outputFormat === 'jpeg' ? 'image/jpeg' : outputFormat === 'webp' ? 'image/webp' : 'image/png',
      b64Json: row.b64_json,
      revisedPrompt: typeof row.revised_prompt === 'string' ? row.revised_prompt : undefined,
      usage: usage ? {
        inputTokens: numberAt(usage.input_tokens),
        outputTokens: numberAt(usage.output_tokens),
        totalTokens: numberAt(usage.total_tokens),
      } : undefined,
    }]
  })
  if (!results.length) throw new Error('OpenAI Image 未返回可归档的 b64_json 图像')
  return results
}

function numberAt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
