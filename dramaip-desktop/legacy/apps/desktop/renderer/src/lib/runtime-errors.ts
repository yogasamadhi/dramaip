export interface RendererErrorMeta {
  type: string
  name?: string
  messageLength?: number
  length?: number
  keys?: string[]
  stackFrames?: string[]
}

export function stackFrames(stack?: string, options: { skipFirst?: boolean; limit?: number } = {}): string[] | undefined {
  const skipFirst = options.skipFirst ?? true
  const limit = options.limit ?? 7
  const frames = stack
    ?.split('\n')
    .slice(skipFirst ? 1 : 0, (skipFirst ? 1 : 0) + limit)
    .map((line) => line.trim())
    .filter(Boolean)
  return frames && frames.length > 0 ? frames : undefined
}

export function createRendererErrorMeta(reason: unknown): RendererErrorMeta {
  if (reason instanceof Error) {
    return {
      type: 'Error',
      name: reason.name,
      messageLength: reason.message.length,
      stackFrames: stackFrames(reason.stack),
    }
  }
  if (typeof reason === 'string') {
    return { type: 'string', length: reason.length }
  }
  if (reason && typeof reason === 'object') {
    const constructorName = (reason as { constructor?: { name?: string } }).constructor?.name
    return {
      type: constructorName ?? 'object',
      keys: Object.keys(reason).slice(0, 10),
    }
  }
  return { type: typeof reason }
}
