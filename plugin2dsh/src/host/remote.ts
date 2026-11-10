import { TypertRemoteService, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { ProjectSchema, RequestSchema, ResponseSchema } from '../shared/contracts.ts'
import { DramaError, type DramaService } from './domain.ts'
import type { HostContext } from './context.ts'

export class DramaRemote extends TypertRemoteService {
  private readonly domain: DramaService
  constructor(ctx: HostContext, domain: DramaService) {
    super(ctx, 'dramaip', { namespace: 'dramaip' })
    this.domain = domain
  }
  async dispatch(request: unknown) {
    try {
      return await this.domain.dispatch(request)
    } catch (error) {
      if (error instanceof DramaError) throw new RemoteError(error.code, error.message, {})
      throw error
    }
  }
}

/** Strict descriptors derive from the schemas shared by the domain and Client. */
export function remoteContribution() {
  const codec = (name: string, schema: { parse(value: unknown): unknown }) => ({
    mode: 'strict',
    typeSymbol: name,
    create: () => schema,
  })
  return {
    package: 'dramaip-dsh-plugin',
    face: 'host',
    schemas: [
      { name: 'Request', create: () => RequestSchema },
      { name: 'Response', create: () => ResponseSchema },
      { name: 'Project', create: () => ProjectSchema },
    ],
    model: { services: [], events: [], objects: [] },
    invocations: [
      {
        id: 'dramaip-dsh-plugin:dramaip/dispatch',
        service: 'dramaip',
        namespace: 'dramaip',
        method: 'dispatch',
        invocation: { kind: 'direct' },
        parameters: [
          {
            name: 'request',
            wire: 'request',
            source: 'json',
            codec: codec('Request', RequestSchema),
          },
        ],
        result: codec('Response', ResponseSchema),
      },
    ],
  }
}
