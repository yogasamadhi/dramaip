import type { ImageGenerationInput, ImageGenerationResult, ImageProvider } from '@sdns/core'

/** 1×1 PNG fixture: mock is only for contract/E2E, never presented as an external generation result. */
const PNG_1PX_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL1eQAAAABJRU5ErkJggg=='

export class MockImageProvider implements ImageProvider {
  readonly kind = 'mock' as const
  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult[]> {
    return [{ model: input.model ?? 'mock-image-v1', mimeType: 'image/png', b64Json: PNG_1PX_B64, revisedPrompt: input.prompt }]
  }
}
