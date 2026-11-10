/** Real bundle dependency closures activate their requested client plugins without extra roster rows. */
import type { FiberState } from '@deepseek-ai/cordis'
import { describe, expect, vi } from 'vitest'
import { createClientTest, webApp } from '../src/assembly/index.ts'

// Value mirror of cordis's `FiberState` const enum, which has no runtime value in the built framework.
const FIBER_STATE = {
  ACTIVE: 2 as FiberState.ACTIVE,
}

const HMR = '@dramaip/infra-client-hmr'
const MODULES = '@dramaip/infra-client-modules'
const SETTINGS = '@dramaip/infra-ui-settings'
const REMOTES = '@dramaip/infra-remotes'
const hmrRoster = webApp.closure([HMR])
const settingsRoster = webApp.closure([SETTINGS])
const hmrTest = createClientTest({ roster: hmrRoster }, { awaitConnected: false })
const settingsTest = createClientTest({ roster: settingsRoster })

describe('bundle dependency closures', () => {
  hmrTest('activates HMR with its declared module provider and no Connection', async ({ start }) => {
    expect(hmrRoster.rows.map(row => row.name)).toContain(MODULES)
    const client = await start()
    const entry = [...client.ctx.loader.entries()].find(row => row.options.name === HMR)
    expect(entry?.fiber?.state).toBe(FIBER_STATE.ACTIVE)
    expect(client.ctx.get('modules')).toBeDefined()
    expect(client.ctx.get('connection')).toBeUndefined()
  }, 60_000)

  settingsTest('activates ui-settings over its declared Remote selection', async ({ mock, start }) => {
    expect(settingsRoster.rows.map(row => row.name)).toContain(REMOTES)
    const client = await start()
    const entry = [...client.ctx.loader.entries()].find(row => row.options.name === SETTINGS)
    expect(entry?.fiber?.state).toBe(FIBER_STATE.ACTIVE)
    // The mirror reads once at activation and again on each connection reset.
    await vi.waitFor(() => {
      expect(mock.log.calls('settings/describe').length).toBeGreaterThan(0)
    })
  }, 60_000)
})
