// @vitest-environment jsdom
/**
 * TestClient over the web profile's roster read from its bundles: production
 * `bootClient` over in-process modules, every Remote call answered by a
 * `RemoteMock` bound to that client's Connection instance, mount, HMR-style reload,
 * unload, and fail-loud teardown.
 */
import type {} from '@dramaip/infra-ui-renderer/client'
import { RemoteMock, ok, openStream } from '@dramaip/infra-remote-mock'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AssemblyPlan, ClientPluginModule, TestClientOptions } from '../src/assembly/index.ts'
import { ClientRoster, TestClient, remoteDefaultResponses, webApp } from '../src/assembly/index.ts'

/** The Gateway client and what it injects: the Typert registry and the Connection. */
const API_ROSTER = webApp.closure(['@dramaip/infra-gateway'])
const MODULES = '@dramaip/infra-client-modules'
/** Contributes its rows to the general settings page; nothing injects it. */
const THEME = '@dramaip/infra-ui-theme'
const PARALLEL_PROBE = '@dramaip/infra-test-runtime-parallel-probe'
/** Declared by a General settings page; ui-theme contributes two rows and locale one. */
const GENERAL_ITEMS = 'settings.general.item' as never
/** The root AppFrame; nothing injects it. */
const LAYOUT = '@dramaip/infra-ui-layout'
/** The production settings page also declares the general item list. */
const SYSTEM_SETTINGS = '@dramaip/system-system-client'
/**
 * Test-only stand-in for a General settings page: this row replaces the layout
 * and production settings page to isolate the theme and locale contributions.
 */
const GENERAL_PAGE = '@dramaip/infra-test-runtime-general-page'
const generalPage: ClientPluginModule = {
  inject: ['slots'],
  apply(ctx) {
    return ctx.slots.register({
      name: 'root',
      children: { [GENERAL_ITEMS]: { kind: 'list', scope: 'root' } },
    } as never, () => null)
  },
}
const withGeneralPage: AssemblyPlan = {
  roster: ClientRoster.of([
    ...webApp.rows.filter(row => row.name !== LAYOUT && row.name !== SYSTEM_SETTINGS),
    { name: GENERAL_PAGE, inject: [], immediately: false },
  ]),
  provide: { [GENERAL_PAGE]: generalPage },
}
const globals = globalThis as { EventSource?: unknown; ResizeObserver?: unknown }
/** The whole roster's first boot pays the cold module transform of every plugin package. */
const COLD_BOOT_TIMEOUT_MS = 60_000

async function started(plan: AssemblyPlan, options?: TestClientOptions): Promise<TestClient> {
  const mock = RemoteMock.create().load(remoteDefaultResponses)
  const client = await TestClient.start(plan, mock, options)
  onTestFinished(() => client.dispose())
  return client
}

describe('TestClient (jsdom)', () => {
  it('boots the whole web-app roster, connects, mounts, and disposes with nothing unmatched', async () => {
    // Exercise missing-API cleanup independently of the suite's browser defaults.
    vi.stubGlobal('ResizeObserver', undefined)
    onTestFinished(() => { vi.unstubAllGlobals() })
    const mock = RemoteMock.create().load(remoteDefaultResponses)
    const client = await TestClient.start({ roster: webApp }, mock, { mount: true })
    expect(client.connection.state.getSnapshot()).toBe('connected')
    expect(mock.log.streams('$events')).toHaveLength(1)
    const container = client.container!
    expect(document.body.contains(container)).toBe(true)
    expect(container.childElementCount).toBeGreaterThan(0)
    expect('__DRAMAIP_TRANSPORT__' in globalThis).toBe(false)
    expect(globals.EventSource).toBeDefined()
    expect(globals.ResizeObserver).toBeDefined()
    expect(document.fonts).toBeInstanceOf(EventTarget)
    await client.dispose()
    expect(document.body.contains(container)).toBe(false)
    expect('__DRAMAIP_TRANSPORT__' in globalThis).toBe(false)
    expect(globals.EventSource).toBeUndefined()
    expect(globals.ResizeObserver).toBeUndefined()
    expect(document.fonts).toBeUndefined()
    await client.dispose()
  }, COLD_BOOT_TIMEOUT_MS)

  it('leaves a pre-existing global alone and removes only the shims it installed', async () => {
    const existing = { existing: true }
    vi.stubGlobal('ResizeObserver', existing)
    const fonts = new EventTarget()
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    onTestFinished(() => {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(document, 'fonts')
    })
    const client = await started({ roster: API_ROSTER })
    expect(globals.ResizeObserver).toBe(existing)
    expect(globals.EventSource).toBeDefined()
    await client.dispose()
    expect(globals.ResizeObserver).toBe(existing)
    expect(globals.EventSource).toBeUndefined()
    expect(document.fonts).toBe(fonts)
  })

  it('restores an existing undefined fonts property after disposal', async () => {
    const original = Object.getOwnPropertyDescriptor(document, 'fonts')
    onTestFinished(() => {
      if (original === undefined) Reflect.deleteProperty(document, 'fonts')
      else Object.defineProperty(document, 'fonts', original)
    })
    const descriptor = { configurable: true, enumerable: true, writable: true, value: undefined }
    Object.defineProperty(document, 'fonts', descriptor)
    const client = await started({ roster: API_ROSTER })
    expect(document.fonts).toBeInstanceOf(EventTarget)
    await client.dispose()
    expect(Object.getOwnPropertyDescriptor(document, 'fonts')).toEqual(descriptor)
  })

  it('boots separate client instances against their own mocks and keeps shared shims until the last dispose', async () => {
    const view = (revision: number) => ({
      autoGenerate: true, ns: 'ui-theme', schema: null, value: {}, applies: 'live' as const, secrets: [], revision,
    })
    const mockA = RemoteMock.create().load(remoteDefaultResponses).unary('settings/update', ok(view(1)))
    const mockB = RemoteMock.create().load(remoteDefaultResponses).unary('settings/update', ok(view(2)))
    const [a, b] = await Promise.all([
      TestClient.start({ roster: API_ROSTER }, mockA),
      TestClient.start({ roster: API_ROSTER }, mockB),
    ])
    onTestFinished(() => a.dispose())
    onTestFinished(() => b.dispose())
    const update = async (client: TestClient): Promise<unknown> =>
      await client.ctx.remote.settings.update('ui-theme', {}, undefined)
    await expect(update(a)).resolves.toEqual({ ok: true, value: view(1) })
    await expect(update(b)).resolves.toEqual({ ok: true, value: view(2) })
    expect(mockA.log.calls('settings/update')).toHaveLength(1)
    expect(mockB.log.calls('settings/update')).toHaveLength(1)
    await a.reload('@dramaip/infra-connection')
    await vi.waitFor(() => { expect(a.connection.state.getSnapshot()).toBe('connected') })
    await expect(update(a)).resolves.toEqual({ ok: true, value: view(1) })
    expect(mockA.log.calls('settings/update')).toHaveLength(2)
    expect(mockB.log.calls('settings/update')).toHaveLength(1)
    await a.dispose()
    expect('__DRAMAIP_TRANSPORT__' in globalThis).toBe(false)
    expect(globals.EventSource).toBeDefined()
    expect(document.fonts).toBeInstanceOf(EventTarget)
    await b.dispose()
    expect('__DRAMAIP_TRANSPORT__' in globalThis).toBe(false)
    expect(globals.EventSource).toBeUndefined()
    expect(document.fonts).toBeUndefined()
  })

  it('boots two plugin trees concurrently instead of serializing the worker', async () => {
    let arrivals = 0
    const gate = Promise.withResolvers<undefined>()
    const probe: ClientPluginModule = {
      async apply() {
        arrivals += 1
        await gate.promise
      },
    }
    const roster = ClientRoster.of([
      { name: MODULES, inject: [], immediately: true },
      { name: PARALLEL_PROBE, inject: [], immediately: false },
    ])
    const first = TestClient.start({ roster, provide: { [PARALLEL_PROBE]: probe } }, RemoteMock.create(), { awaitConnected: false })
    const second = TestClient.start({ roster, provide: { [PARALLEL_PROBE]: probe } }, RemoteMock.create(), { awaitConnected: false })
    const starts = Promise.allSettled([first, second])
    let overlapFailure: unknown
    try {
      await vi.waitFor(() => { expect(arrivals).toBe(2) }, { timeout: 5_000 })
    } catch (error) {
      overlapFailure = error
    } finally {
      gate.resolve(undefined)
    }
    const results = await starts
    for (const result of results) {
      if (result.status === 'fulfilled') onTestFinished(() => result.value.dispose())
    }
    const rejected = results.find(result => result.status === 'rejected')
    if (rejected?.status === 'rejected') {
      const reason: unknown = rejected.reason
      throw reason
    }
    if (overlapFailure !== undefined) throw overlapFailure
  }, COLD_BOOT_TIMEOUT_MS)

  it('reloads the bootstrap modules row against its own Loader internal', async () => {
    const roster = ClientRoster.of([{ name: MODULES, inject: [], immediately: true }])
    const a = await TestClient.start({ roster }, RemoteMock.create(), { awaitConnected: false })
    onTestFinished(() => a.dispose())
    const b = await TestClient.start({ roster }, RemoteMock.create(), { awaitConnected: false })
    onTestFinished(() => b.dispose())
    const modulesA = a.ctx.modules
    const modulesB = b.ctx.modules
    expect(modulesA).not.toBe(modulesB)
    expect(modulesA).toBe(a.ctx.loader.internal)
    expect(modulesB).toBe(b.ctx.loader.internal)
    await a.reload(MODULES)
    expect(a.ctx.modules).toBe(modulesA)
    expect(b.ctx.modules).toBe(modulesB)
  })

  it('boots the api subset without a mount and exposes the typed Remote', async () => {
    const client = await started({ roster: API_ROSTER })
    expect(client.container).toBeUndefined()
    expect(client.ctx.remote.settings).toBeDefined()
    expect(client.connection.state.getSnapshot()).toBe('connected')
  })

  it('refuses to mount a roster that provides no uiRenderer instead of returning an empty container', async () => {
    const before = document.body.childElementCount
    await expect(TestClient.start({ roster: API_ROSTER }, RemoteMock.create().load(remoteDefaultResponses), { mount: true }))
      .rejects.toThrow('mount requested, but the roster provides no `uiRenderer`')
    expect(document.body.childElementCount).toBe(before)
  })

  it('creates no mount element when the roster cannot be loaded', async () => {
    const roster = ClientRoster.of([{ name: '@dramaip/infra-test-runtime-missing', inject: [], immediately: true }])
    const before = document.body.childElementCount
    await expect(TestClient.start({ roster }, RemoteMock.create(), { mount: true })).rejects.toThrow()
    expect(document.body.childElementCount).toBe(before)
  })

  it('mounts into a caller-supplied element and leaves it in place on dispose', async () => {
    const host = document.createElement('main')
    document.body.appendChild(host)
    const mock = RemoteMock.create().load(remoteDefaultResponses)
    const client = await TestClient.start({ roster: webApp }, mock, { mount: host })
    expect(client.container).toBe(host)
    expect(host.childElementCount).toBeGreaterThan(0)
    await client.dispose()
    expect(document.body.contains(host)).toBe(true)
    host.remove()
  })

  it('boots with a provided row in place of the real plugin', async () => {
    const apply = vi.fn()
    const layout: ClientPluginModule = {
      inject: ['slots'],
      apply(ctx) {
        apply()
        return ctx.slots.register({ name: 'root' }, () => null)
      },
    }
    const client = await started({ roster: webApp, provide: { [LAYOUT]: layout } }, { mount: true })
    expect(apply).toHaveBeenCalledOnce()
    expect([...client.ctx.loader.entries()].some(entry => entry.options.name === LAYOUT)).toBe(true)
  })

  it('reload rebuilds the declaring entry; unload collapses it', async () => {
    const client = await started(withGeneralPage, { mount: true })
    expect(client.ctx.slots.entries(GENERAL_ITEMS)).toHaveLength(3)
    await client.reload(THEME)
    await client.flush()
    expect(client.ctx.slots.entries(GENERAL_ITEMS)).toHaveLength(3)
    const cleanupStarted = Promise.withResolvers<undefined>()
    const releaseCleanup = Promise.withResolvers<undefined>()
    const theme = [...client.ctx.loader.entries()].find(entry => entry.options.name === THEME)!
    theme.fiber!.ctx.effect(() => async () => {
      cleanupStarted.resolve(undefined)
      await releaseCleanup.promise
    })
    let unloaded = false
    const unloading = client.unload(THEME).then(() => { unloaded = true })
    try {
      await cleanupStarted.promise
      await client.flush()
      expect(unloaded).toBe(false)
    } finally {
      releaseCleanup.resolve(undefined)
      await unloading
    }
    expect(unloaded).toBe(true)
    await client.flush()
    expect(client.ctx.slots.entries(GENERAL_ITEMS)).toHaveLength(1)
    await expect(client.reload(THEME)).rejects.toThrow(`no Loader entry named ${THEME}`)
  })

  it('fails loud by teardown at the latest when a boot-time endpoint has no fixture', async () => {
    const mock = RemoteMock.create()
    const run = TestClient.start({ roster: webApp }, mock, { mount: true }).then(client => client.dispose())
    await expect(run).rejects.toThrow(/settings\/describe|remoteAccess\/follow/)
  })

  it('waits through a carrier flap for the connection to become ready', async () => {
    let opens = 0
    const mock = RemoteMock.create().load(remoteDefaultResponses).stream('$events', (_args, stream) => {
      opens += 1
      const first = opens === 1
      setTimeout(() => {
        if (first) stream.fail(new Error('flap'))
        // Branded on the Gateway side; the test mints a plain string.
        else stream.push({ type: 'ready', clientId: 'reconnected' as never, host: { home: '/home/mock' } })
      }, 20)
    })
    const client = await TestClient.start({ roster: API_ROSTER }, mock)
    onTestFinished(() => client.dispose())
    expect(client.connection.state.getSnapshot()).toBe('connected')
    expect(mock.log.streams('$events')).toHaveLength(2)
  })

  it('reports the log when the connection never becomes ready', async () => {
    // No fixtures: ui-settings' describe has no rule, so the mock logs it as unmatched, while $events never sends ready.
    const roster = webApp.closure(['@dramaip/infra-ui-settings'])
    const mock = RemoteMock.create().stream('$events', openStream([]))
    await expect(TestClient.start({ roster }, mock, { connectTimeoutMs: 300 }))
      .rejects.toThrow(/connection state is \S+ after 300ms; unmatched: \[unary settings\/describe\]; streams: \[.*\$events \(open\).*\]/)
    expect(globals.EventSource).toBeUndefined()
  })
})
