// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { createSnapshotStore } from '@dramaip/infra-client-store'
import type { MainPanelId, PanelInfo } from '@dramaip/infra-ui-layout/client'
import type { PropsRuntime } from '@dramaip/infra-ui-slots'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import {
  allowAllAccess,
  bindSnapshotSelector,
  SlotTestRuntime,
  usePinnedBrowserLanguages,
} from '../src/index.ts'

const originalLanguages = [...navigator.languages]
const originalLanguage = navigator.language

declare module '@dramaip/infra-ui-slots' {
  interface SlotMap {
    'trt.panel-info': { kind: 'keyed'; scope: 'root'; owner: { label: string } }
  }
}

usePinnedBrowserLanguages('zh-CN', 'en-US')
afterEach(cleanup)
afterAll(() => {
  expect(navigator.languages).toEqual(originalLanguages)
  expect(navigator.language).toBe(originalLanguage)
})

describe('fixture helpers', () => {
  it('allows every global action through the hand-built access Hook', () => {
    expect(allowAllAccess.useRemoteAccess('settings/describe')).toBe(true)
  })

  it('installs an allow-all remoteAccess service whose sources never change', async () => {
    const runtime = await SlotTestRuntime.create()
    try {
      // No resource kind is declared yet; the service answers for any kind.
      const source = runtime.ctx.remoteAccess.source('fixture-room' as never, 'r1', 'room/read')
      expect(source.getSnapshot()).toBe(true)
      const unsubscribe = source.subscribe(() => {})
      unsubscribe()
      expect(source.getSnapshot()).toBe(true)
    } finally {
      await runtime.dispose()
    }
  })

  it('retracts the default panel source without removing its live replacement', async () => {
    const runtime = await SlotTestRuntime.create()
    let releaseReplacement: (() => void) | undefined
    try {
      runtime.releasePanelInfoSource()
      releaseReplacement = runtime.slots.provideRoot({ hooks: { panelInfo: runtime.panelInfo } })
      runtime.releasePanelInfoSource()
      expect(() => runtime.slots.provideRoot({ hooks: { panelInfo: runtime.panelInfo } }))
        .toThrow(`duplicate root standard hook 'panelInfo'`)
    } finally {
      try {
        releaseReplacement?.()
        runtime.releasePanelInfoSource()
      } finally {
        await runtime.dispose()
      }
    }
  })

  it('drives panel hooks, retains keyed selection on owner updates, and releases the default source', async () => {
    const runtime = await SlotTestRuntime.create()
    try {
      await runtime.declare({ 'trt.panel-info': { kind: 'keyed', scope: 'root' } })
      runtime.slots.register({ name: 'trt.panel-info', key: 'probe' },
        ({ usePanelInfo, label }: PropsRuntime<'trt.panel-info'>) => (
          <span>{label}:{usePanelInfo(info => info.activePanelId) ?? 'main'}</span>
        ))
      const view = runtime.renderSlot('trt.panel-info', { label: 'first' }, { entryKey: 'probe' })
      expect(view.container.textContent).toBe('first:main')
      act(() => { runtime.panelInfo.set({ activePanelId: 'custom' as MainPanelId }) })
      expect(view.container.textContent).toBe('first:custom')
      view.update({ label: 'next' })
      expect(view.container.textContent).toBe('next:custom')
      const replacement = createSnapshotStore<PanelInfo>({ activePanelId: null })
      await act(async () => {
        runtime.releasePanelInfoSource()
        await runtime.mount({
          inject: ['slots'],
          apply(ctx) { ctx.slots.provideRoot({ hooks: { panelInfo: replacement } }) },
        })
      })
      expect(view.container.textContent).toBe('next:main')
    } finally {
      await runtime.dispose()
    }
  })

  it('binds an observable snapshot through the production selector hook', () => {
    const source = createSnapshotStore({ value: 1 })
    const useValue = bindSnapshotSelector(source)
    const view = renderHook(() => useValue(snapshot => snapshot.value))
    expect(view.result.current).toBe(1)

    act(() => { source.update((draft) => { draft.value = 2 }) })
    expect(view.result.current).toBe(2)
  })

  it('pins both browser language fields for the calling suite', () => {
    expect(navigator.languages).toEqual(['zh-CN', 'en-US'])
    expect(navigator.language).toBe('zh-CN')
  })
})
