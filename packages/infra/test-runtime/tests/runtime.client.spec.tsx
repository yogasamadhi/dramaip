// @vitest-environment jsdom
/**
 * SlotTestRuntime behavior: root declaration + rendering through the real
 * renderer, root store identity, feature mount/dispose cascade, single-slot
 * mounting, and runtime disposal idempotence. All through the production
 * SlotRegistry + createSlotRenderer stack — this suite is the fixture the
 * feature specs rely on.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '../src/config-form.ts'
import { cleanup } from '@testing-library/react'
import { defineStore } from '@dramaip/infra-client-store'
import type { PropsRenderSlots } from '@dramaip/infra-ui-slots'
import { SlotTestRuntime } from '@dramaip/infra-test-runtime'

declare module '@dramaip/infra-ui-slots' {
  interface SlotMap {
    'trt.panel': { kind: 'single'; scope: 'root'; owner: { label?: string } }
    'trt.chat': { kind: 'single'; scope: 'session' }
    'trt.rows': { kind: 'list'; scope: 'root' }
    'trt.rows.hole': { kind: 'single'; scope: 'root' }
  }
}

afterEach(cleanup)

type FrameProps = PropsRenderSlots<'trt.panel' | 'trt.rows'>

/** Root frame declaring the suite's root slots (render sites for each kind). */
function Frame({ renderSlot }: FrameProps) {
  return (
    <>
      {renderSlot('trt.panel', { label: 'from-owner' }, { fallback: <i>no panel</i> })}
      {renderSlot('trt.rows', {})}
    </>
  )
}

const CHILDREN = {
  'trt.panel': { kind: 'single', scope: 'root' },
  'trt.rows': { kind: 'list', scope: 'root' },
} as const

async function runtimeWithFrame() {
  const runtime = await SlotTestRuntime.create()
  await runtime.root.declare(CHILDREN, props => <Frame {...props} />)
  return runtime
}

describe('root declaration and rendering', () => {
  it('renders declared slots through the real renderer: fallback, then a live registration, then unload', async () => {
    const runtime = await runtimeWithFrame()
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('no panel')

    let dispose = (): void => {}
    await runtime.flush() // no-op guard: flush outside mutations is safe
    await (async () => {
      dispose = runtime.slots.register(
        { name: 'trt.panel' },
        ({ label }: { label?: string }) => <b>panel:{label}</b>)
      await runtime.flush()
    })()
    expect(view.container.textContent).toContain('panel:from-owner')
    dispose()
    await runtime.flush()
    expect(view.container.textContent).toContain('no panel')
    await runtime.dispose()
  })

  it('fails loud when rendering with no root declaration (production boot-order check)', async () => {
    const runtime = await SlotTestRuntime.create()
    expect(() => runtime.renderRoot()).toThrow(/'root' has no registration/)
    await runtime.dispose()
  })
})

describe('stores', () => {
  const createSuiteStore = () => defineStore({
    init: () => ({ note: '' }),
    persist: 'trt.store',
    actions: { setNote: (d, note: string) => { d.note = note } },
  })

  it('resolves the root instance via the host face: shared identity and action-driven re-render', async () => {
    const runtime = await runtimeWithFrame()
    runtime.slots.register(
      { name: 'trt.panel', store: createSuiteStore() },
      ((props: { useStore: <S>(sel: (s: { note: string }) => S) => S }) =>
        <span>note:{props.useStore(s => s.note)}</span>) as never)
    const view = runtime.renderRoot()
    const store = runtime.storeOf('trt.panel')
    ;(store.actions['setNote'] as (note: string) => void)('hello')
    await runtime.flush()
    expect(view.container.textContent).toContain('note:hello')
    expect(runtime.storeOf('trt.panel')).toBe(store)
    await runtime.dispose()
  })

  it('storeOf guards: before renderRoot, unregistered keys, and storeless entries', async () => {
    const runtime = await runtimeWithFrame()
    runtime.slots.register({ name: 'trt.panel' }, () => null)
    expect(() => runtime.storeOf('trt.panel')).toThrow(/before renderRoot/)
    runtime.renderRoot()
    expect(() => runtime.storeOf('trt.panel')).toThrow(/declares no store/)
    expect(() => runtime.storeOf('trt.rows')).toThrow(/no registration/)
    await runtime.dispose()
  })
})

describe('feature mount and disposal', () => {
  it('mounts a plugin on a real fiber; dispose() cascades entries, declared children, and services', async () => {
    const runtime = await runtimeWithFrame()
    runtime.ctx.provide('layout', { openDetails: vi.fn() })
    const feature = await runtime.mount({
      inject: ['slots', 'layout'],
      apply: (ctx: typeof runtime.ctx) => {
        ctx.provide('feature-service', { ok: true })
        ctx.slots.register({
          name: 'trt.rows',
          id: 'row-1',
          children: { 'trt.rows.hole': { kind: 'single', scope: 'root' } },
        } as never, ((props: { renderSlot: (key: string, owner: object) => unknown }) =>
          <div data-testid="row">{props.renderSlot('trt.rows.hole', {}) as React.ReactNode}</div>) as never)
      },
    })
    const view = runtime.renderRoot()
    expect(view.getByTestId('row')).toBeTruthy()
    expect(runtime.ctx.get('feature-service')).toEqual({ ok: true })
    expect(runtime.slots.entries('trt.rows')).toHaveLength(1)

    await feature.dispose()
    await feature.dispose() // idempotent
    expect(runtime.slots.entries('trt.rows')).toHaveLength(0)
    expect(runtime.slots.spec('trt.rows.hole')).toBeUndefined()
    expect(runtime.ctx.get('feature-service')).toBeUndefined()
    expect(view.queryByTestId('row')).toBeNull()
    await runtime.dispose()
  })

  it('mount fails loud on missing services instead of suspending forever', async () => {
    const runtime = await runtimeWithFrame()
    await expect(runtime.mount({ inject: ['slots', 'absent-service'], apply: () => {} }))
      .rejects.toThrow(/missing service\(s\) absent-service/)
    await runtime.dispose()
  })

  it('runtime dispose is idempotent, unmounts views, disposes mounted features, and clears persisted state', async () => {
    const runtime = await runtimeWithFrame()
    const feature = await runtime.mount({
      inject: ['slots'],
      apply: (ctx: typeof runtime.ctx) => { ctx.slots.register({ name: 'trt.panel' }, () => <b>p</b>) },
    })
    const view = runtime.renderRoot()
    expect(view.container.textContent).toContain('p')
    localStorage.setItem('trt.leftover', 'x')

    await runtime.dispose()
    expect(view.container.innerHTML).toBe('')
    expect(feature.fiber.uid).toBeNull()
    expect(localStorage.getItem('trt.leftover')).toBeNull()
    await runtime.dispose() // idempotent
    await expect(runtime.dispose()).resolves.toBeUndefined()
  })
})

describe('single-slot mounting (declare + renderSlot)', () => {
  it('rejects a slot outside the root scope', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.chat': { kind: 'single', scope: 'session' } })
    runtime.slots.register({ name: 'trt.chat' }, () => <b>chat</b>)
    // Desktop installs no 'session' scope adapter, so the renderer refuses the slot before this bench would.
    expect(() => runtime.renderSlot('trt.chat', {})).toThrow(/without an installed 'session' scope adapter/)
    await runtime.dispose()
  })

  it('renders one slot inside its data-slot wrapper and updates owner props in place', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register(
      { name: 'trt.panel' },
      ({ label }: { label?: string }) => <b data-testid="panel">{label ?? 'none'}</b>)
    const slot = runtime.renderSlot('trt.panel', { label: 'first' })
    expect(slot.container.getAttribute('data-slot')).toBe('trt.panel')
    expect(slot.view.getByTestId('panel').textContent).toBe('first')

    const panel = slot.view.getByTestId('panel')
    slot.update({ label: 'second' })
    expect(slot.view.getByTestId('panel').textContent).toBe('second')
    // In-place re-render: the element identity survived the owner flip.
    expect(slot.view.getByTestId('panel')).toBe(panel)
    await runtime.dispose()
  })

  it('views sibling slots of one tree separately and rejects undeclared keys', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({
      'trt.panel': { kind: 'single', scope: 'root' },
      'trt.rows': { kind: 'list', scope: 'root' },
    })
    runtime.slots.register({ name: 'trt.panel' }, () => <b>panel</b>)
    runtime.slots.register({ name: 'trt.rows', id: 'r1' }, () => <i>row</i>)
    const panel = runtime.renderSlot('trt.panel', {})
    const rows = runtime.renderSlot('trt.rows', {})
    expect(panel.container.textContent).toBe('panel')
    expect(rows.container.textContent).toBe('row')
    expect(() => runtime.renderSlot('trt.chat', {})).toThrow(/without declare\(\)/)
    await runtime.dispose()
  })

  it('folds class hashes and collapses svg internals in snapshots, leaving the live DOM alone', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => (
      <div className="_frame_a1b2c3 plain">
        <span className="_label_ff00aa">styled</span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M0 0L16 16" fill="currentColor" />
        </svg>
      </div>
    ))
    const slot = runtime.renderSlot('trt.panel', {})
    expect(slot.container).toMatchSnapshot()
    // The serializer works on a clone: the live DOM keeps hashes and paths.
    expect(slot.container.querySelector('div')!.className).toBe('_frame_a1b2c3 plain')
    expect(slot.container.querySelector('svg path')).not.toBeNull()
    await runtime.dispose()
  })
})

describe('single-slot mounting edge arms', () => {
  it('renderSlot fails loud after dispose and after an external unmount', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => <b>p</b>)
    runtime.renderSlot('trt.panel', {})
    // RTL cleanup empties the mounted tree behind the runtime's back: the
    // wrapper lookup names the state instead of returning a dead container.
    cleanup()
    expect(() => runtime.renderSlot('trt.panel', {})).toThrow(/rendered no wrapper/)
    await runtime.dispose()
    expect(() => runtime.renderSlot('trt.panel', {})).toThrow(/slot renderer not installed/)
  })

  it('serializes childless svg untouched next to scoped classes', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.declare({ 'trt.panel': { kind: 'single', scope: 'root' } })
    runtime.slots.register({ name: 'trt.panel' }, () => (
      <div className="_frame_a1b2c3">
        <svg viewBox="0 0 1 1" aria-hidden="true" />
      </div>
    ))
    const slot = runtime.renderSlot('trt.panel', {})
    expect(slot.container).toMatchSnapshot()
    await runtime.dispose()
  })
})

describe('stubbed settings scope', () => {
  it('records both write kinds and publishes a Host acceptance to its listeners', async () => {
    const host = stubConfigForm<{ preference: string }>()
    let notified = 0
    const stop = host.scope.subscribe(() => { notified += 1 })
    expect(host.listenerCount()).toBe(1)
    expect(host.scope.getSnapshot()).toMatchObject({
      status: 'loading', base: undefined, user: undefined,
    })

    await host.scope.set('preference', 'dark')
    await expect(host.scope.unset('preference')).resolves.toBe(true)
    await expect(host.scope.mutate([{ op: 'set', path: ['preference'], value: 'dark' }])).resolves.toBe(true)
    host.publish({
      status: 'ready',
      value: { preference: 'system' },
      base: { preference: 'system' },
      revision: 2,
      writable: true,
    })

    expect(host.set).toHaveBeenCalledWith('preference', 'dark')
    expect(host.unset).toHaveBeenCalledWith('preference')
    expect(notified).toBe(1)
    expect(host.scope.getSnapshot()).toMatchObject({ status: 'ready', revision: 2, writable: true })
    stop()
    expect(host.listenerCount()).toBe(0)
  })
})
