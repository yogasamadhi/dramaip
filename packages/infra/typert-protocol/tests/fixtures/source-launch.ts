import { Context } from '@deepseek-ai/cordis'
import {
  TypertRemoteService,
  Remote,
  RemoteScope,
  remoteMethods,
  type TypertContext,
} from '@dramaip/infra-typert-protocol'

declare module '@dramaip/infra-typert-protocol' {
  interface TypertContextMap {
    /** Scoped-context key exercised by this fixture. */
    agent: TypertContext<string>
  }
}

class Goals extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, 'goals')
  }

  @Remote
  create(value: string): string {
    return value
  }

  @RemoteScope('agent')
  scoped(value: string): string {
    return value
  }
}

const methods = remoteMethods(new Goals(new Context()))
const actual = JSON.stringify(methods)
const expected = JSON.stringify([
  { method: 'create', invocation: { kind: 'direct' } },
  { method: 'scoped', invocation: { kind: 'context', context: 'agent' } },
])
if (actual !== expected) throw new Error(`unexpected Remote declarations: ${actual}`)
process.stdout.write(actual)
