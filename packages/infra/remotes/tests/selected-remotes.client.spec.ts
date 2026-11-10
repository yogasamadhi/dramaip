import { Context } from '@deepseek-ai/cordis'
import { apply as applyConnection, type ClientTransportHooks } from '@dramaip/infra-connection/client'
import { apply as applyGateway, inject as gatewayInject } from '@dramaip/infra-gateway/client'
import { RemoteMock } from '@dramaip/infra-remote-mock'
import TypertRegistry from '@dramaip/infra-typert-registry'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.ts'

const globals = ['location', '__DRAMAIP_TRANSPORT__'] as const
const saved = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name))

afterEach(() => {
  globals.forEach((name, index) => {
    const descriptor = saved[index]
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, name)
    else Object.defineProperty(globalThis, name, descriptor)
  })
})

describe('selected Remote contributions', () => {
  // A generated method the Client's namespace service already names (its
  // `remove`, `has`) is refused at mount, which fails the whole web boot.
  it('mount on the real Client Gateway, every namespace beside the others', async () => {
    const mock = RemoteMock.create({ host: { home: '/home/mock' } })
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hostname: '127.0.0.1', search: '' },
    })
    Object.defineProperty(globalThis, '__DRAMAIP_TRANSPORT__', {
      configurable: true,
      value: { rpc: mock.rpc } satisfies ClientTransportHooks,
    })
    const ctx = new Context()
    try {
      await ctx.plugin(TypertRegistry)
      await ctx.plugin({ inject: [], apply: applyConnection })
      await ctx.plugin({ inject: gatewayInject, apply: applyGateway })
      // A refused mount unwinds every namespace the assembly had mounted.
      await ctx.plugin({ inject: [...inject], apply })
      for (const namespace of ['system', 'insights', 'review', 'delivery', 'workspace', 'writing', 'quality', 'knowledge', 'agents', 'automation', 'timeline', 'media', 'production'])
        expect(ctx.get(`remote.${namespace}`), namespace).toBeDefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
