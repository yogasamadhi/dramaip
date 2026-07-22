/** Renderer-safe capability truth for the first-party image generation boundary. */
export type ImageProviderKind = 'mock' | 'openai_image'

export interface ImageProviderConfig {
  kind: ImageProviderKind
  apiKey?: string
  model?: string
  /** Non-secret, persisted release switch. A key alone must never create billable requests. */
  featureEnabled?: boolean
}

export interface ImageProviderCapability {
  canSubmit: boolean
  supportsTextToImage: boolean
  supportsImageEdit: boolean
  supportsReferenceImages: boolean
  supportsRemoteCancel: boolean
  reason?: string
}

export interface ImageGenerationInput {
  prompt: string
  model?: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  quality?: 'low' | 'medium' | 'high'
  outputFormat?: 'png' | 'jpeg' | 'webp'
  /** Base64 image inputs are intentionally not sent by this text-to-image path. */
  referenceImages?: string[]
}

export interface ImageGenerationResult {
  model: string
  mimeType: string
  b64Json: string
  revisedPrompt?: string
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
}

export interface ImageProvider {
  readonly kind: ImageProviderKind
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult[]>
}

export function getImageProviderCapability(config: ImageProviderConfig): ImageProviderCapability {
  if (config.kind === 'mock') {
    return { canSubmit: true, supportsTextToImage: true, supportsImageEdit: false, supportsReferenceImages: false, supportsRemoteCancel: false }
  }
  if (!config.apiKey?.trim()) {
    return { canSubmit: false, supportsTextToImage: true, supportsImageEdit: true, supportsReferenceImages: true, supportsRemoteCancel: false, reason: 'OpenAI Image 缺少 API Key，不能提交任务。' }
  }
  if (config.featureEnabled !== true) {
    return { canSubmit: false, supportsTextToImage: true, supportsImageEdit: true, supportsReferenceImages: true, supportsRemoteCancel: false, reason: 'OpenAI Image 生产渠道开关尚未开启，不能提交任务。' }
  }
  return { canSubmit: true, supportsTextToImage: true, supportsImageEdit: true, supportsReferenceImages: true, supportsRemoteCancel: false }
}
