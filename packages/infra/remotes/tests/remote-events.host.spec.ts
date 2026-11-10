import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { RemoteEventHostInfo, TypertRemoteEventSource } from '@dramaip/infra-gateway'
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'

interface GatewayProbe {
  source: TypertRemoteEventSource | undefined
  host: RemoteEventHostInfo | undefined
  removals: number
  registerRemoteEvents(
    source: TypertRemoteEventSource,
    host: RemoteEventHostInfo,
  ): () => Promise<void>
}

async function setup(): Promise<{
  readonly ctx: Context
  readonly gateway: GatewayProbe
  readonly fiber: Fiber
}> {
  const ctx = new Context()
  const gateway: GatewayProbe = {
    source: undefined,
    host: undefined,
    removals: 0,
    registerRemoteEvents(source, host) {
      gateway.source = source
      gateway.host = host
      return async () => {
        if (gateway.source !== source) return
        gateway.source = undefined
        gateway.host = undefined
        gateway.removals += 1
      }
    },
  }
  ctx.reflect.provide('typertGateway', gateway)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber
  return { ctx, gateway, fiber }
}

function sourceOf(gateway: GatewayProbe): TypertRemoteEventSource {
  if (gateway.source === undefined) throw new Error('fixture Gateway has no Remote event source')
  return gateway.source
}

function emitRaw(ctx: Context, event: string, args: readonly unknown[]): void {
  const emit = ctx.emit.bind(ctx) as (name: string, ...values: readonly unknown[]) => void
  emit(event, ...args)
}

describe('Remote event Host source', () => {
  it('registers the Host home used by Client connection generations', async () => {
    const { gateway, fiber } = await setup()
    expect(gateway.host?.home).toBeTypeOf('string')
    expect(gateway.host?.home.length).toBeGreaterThan(0)
    await fiber.dispose()
    expect(gateway.host).toBeUndefined()
  })

  it('gives each Client stream an independent allowlisted event queue', async () => {
    const { ctx, gateway, fiber } = await setup()
    const firstAbort = new AbortController()
    const secondAbort = new AbortController()
    const first = sourceOf(gateway)(firstAbort.signal)[Symbol.asyncIterator]()
    const second = sourceOf(gateway)(secondAbort.signal)[Symbol.asyncIterator]()

    emitRaw(ctx, 'settings/document-updated', ['ui-theme', 1])
    await expect(first.next()).resolves.toEqual({
      done: false,
      value: { event: 'settings/document-updated', args: ['ui-theme', 1] },
    })
    await expect(second.next()).resolves.toEqual({
      done: false,
      value: { event: 'settings/document-updated', args: ['ui-theme', 1] },
    })

    emitRaw(ctx, 'credentials/reference-updated', ['ref-1'])
    await expect(first.next()).resolves.toEqual({
      done: false,
      value: { event: 'credentials/reference-updated', args: ['ref-1'] },
    })
    await expect(second.next()).resolves.toEqual({
      done: false,
      value: { event: 'credentials/reference-updated', args: ['ref-1'] },
    })

    const firstDone = first.next()
    firstAbort.abort(new Error('first Client disconnected'))
    emitRaw(ctx, 'credentials/record-updated', ['record-1'])
    await expect(firstDone).resolves.toEqual({ done: true, value: undefined })
    await expect(second.next()).resolves.toEqual({
      done: false,
      value: { event: 'credentials/record-updated', args: ['record-1'] },
    })

    const secondDone = second.next()
    secondAbort.abort(new Error('second Client disconnected'))
    await expect(secondDone).resolves.toEqual({ done: true, value: undefined })

    await fiber.dispose()
    expect(gateway.source).toBeUndefined()
    expect(gateway.removals).toBe(1)
    await ctx.fiber.dispose()
  })

  it('forwards an event that declares no resources without readers', async () => {
    const { ctx, gateway, fiber } = await setup()
    const abort = new AbortController()
    const stream = sourceOf(gateway)(abort.signal)[Symbol.asyncIterator]()
    // No resource readers means access control sees the global resource.
    emitRaw(ctx, 'settings/document-updated', ['ui-theme', 3])
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { event: 'settings/document-updated', args: ['ui-theme', 3] },
    })
    abort.abort(new Error('Client disconnected'))
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('does not forward an event outside the allowlist', async () => {
    const { ctx, gateway, fiber } = await setup()
    const abort = new AbortController()
    const stream = sourceOf(gateway)(abort.signal)[Symbol.asyncIterator]()
    emitRaw(ctx, 'commands/change', [])
    emitRaw(ctx, 'settings/document-updated', ['ui-theme', 4])
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { event: 'settings/document-updated', args: ['ui-theme', 4] },
    })
    abort.abort(new Error('Client disconnected'))
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('rejects a non-JSON argument without poisoning the stream', async () => {
    const { ctx, gateway } = await setup()
    const abort = new AbortController()
    const iterator = sourceOf(gateway)(abort.signal)[Symbol.asyncIterator]()
    const pending = iterator.next()

    expect(() => {
      emitRaw(ctx, 'settings/document-updated', ['ui-theme', 1n])
    }).toThrow('argument 1 is not lossless JSON data')
    emitRaw(ctx, 'settings/document-updated', ['ui-theme', 2])
    await expect(pending).resolves.toEqual({
      done: false,
      value: { event: 'settings/document-updated', args: ['ui-theme', 2] },
    })

    const done = iterator.next()
    abort.abort()
    await expect(done).resolves.toEqual({ done: true, value: undefined })

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(sourceOf(gateway)(alreadyAborted.signal)[Symbol.asyncIterator]().next())
      .resolves.toEqual({ done: true, value: undefined })
    await ctx.fiber.dispose()
  })
})
