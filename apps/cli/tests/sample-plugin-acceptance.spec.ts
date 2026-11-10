/**
 * P1-b acceptance against the real source CLI and a headless browser. The
 * test-only sample plugin is linked into the shipped web profile of a
 * throwaway `DRAMAIP_HOME` (as DSH's session-snapshot launcher links test
 * packages; the profile manifest is untouched) and inserted through that
 * profile's patch layer: revocation is a live `disabled` edit, and only the
 * profile patch is watched — `--patch` overlays load once, after it. Covers the unary and stream
 * Remote carriers, the event stream's opening frame, reconnect baselines,
 * the boot graph and immutable plugin delivery, the Slot contribution and
 * its revocation, and the single React root.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page, WebSocketRoute } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertBuilt, DESKTOP_ROOT, runToExit, startWeb, stop, waitFor, type RunningWeb } from './web-harness.ts'

const SAMPLE = '@dramaip/test-sample-plugin'
const SAMPLE_DIR = join(DESKTOP_ROOT, 'packages/testing/sample-plugin')
const SAMPLE_SELECTOR = '[data-testid="dramaip-test-sample"]'
// The transitional Studio client shadows ui-layout's frame, whose overlay seat holds the sample badge.
const FRAME = '- id: workspace-studio-client\n  disabled: true\n'
const INSERTED = `${FRAME}- insert:\n    - id: test-sample\n      name: '${SAMPLE}'\n`
const DISABLED = `${INSERTED}      disabled: true\n`
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

const { chromium } = createRequire(join(DESKTOP_ROOT, 'package.json'))('playwright') as typeof import('playwright')

/** One unary result envelope as `/api/<endpoint>` answers it. */
interface UnaryAnswer {
  readonly status: number
  readonly result: { readonly ok: boolean, readonly value?: unknown, readonly error?: { readonly code: string, readonly message: string } }
}

/** One proxied `/api/remote.mux` carrier: its JSON frames in both directions. */
interface MuxCarrier {
  readonly page: WebSocketRoute
  readonly server: WebSocketRoute
  readonly sent: Array<{ type: string, streamId: string, endpoint?: string }>
  readonly received: Array<{ type: string, streamId: string, value?: Record<string, unknown> }>
}

let home: string
let patchFile: string
let browser: Browser
let web: RunningWeb

/** Make the bare sample name resolvable from the profile and insert it through the profile patch. */
function linkSample(): void {
  const profileDir = join(home, 'profiles/web')
  mkdirSync(join(profileDir, 'node_modules/@dramaip'), { recursive: true })
  symlinkSync(SAMPLE_DIR, join(profileDir, 'node_modules', SAMPLE), 'junction')
  writeFileSync(patchFile, INSERTED)
}

/** Open the shell in a fresh context, proxying every mux carrier so the test sees its frames. */
async function openShell(): Promise<{ context: BrowserContext, page: Page, carriers: MuxCarrier[] }> {
  const context = await browser.newContext()
  const carriers: MuxCarrier[] = []
  await context.routeWebSocket(/\/api\/remote\.mux$/u, (page) => {
    const server = page.connectToServer()
    const carrier: MuxCarrier = { page, server, sent: [], received: [] }
    carriers.push(carrier)
    page.onMessage((message) => {
      carrier.sent.push(JSON.parse(String(message)) as MuxCarrier['sent'][number])
      server.send(message)
    })
    server.onMessage((message) => {
      carrier.received.push(JSON.parse(String(message)) as MuxCarrier['received'][number])
      page.send(message)
    })
  })
  const page = await context.newPage()
  await page.goto(web.launchUrl.href)
  await page.locator('[data-slot="root"]').waitFor({ state: 'attached', timeout: 30_000 })
  return { context, page, carriers }
}

/** Call one unary Remote endpoint from the page, with the page's own session cookie. */
function callUnary(page: Page, endpoint: string, args: Record<string, unknown>): Promise<UnaryAnswer> {
  return page.evaluate(async ([target, payload]) => {
    const response = await fetch(`api/${target}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: target, payload: { args: payload } }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${target}: HTTP ${response.status} ${text} at ${location.href}`)
    return { status: response.status, result: (JSON.parse(text) as { result: UnaryAnswer['result'] }).result }
  }, [endpoint, args] as const)
}

/** Status of a bare POST to `/api/<endpoint>`. */
function postStatus(page: Page, endpoint: string): Promise<number> {
  return page.evaluate(async target => (await fetch(`api/${target}`, { method: 'POST' })).status, endpoint)
}

/** Open one logical stream on a fresh mux carrier and collect its frames up to the terminal one. */
function openMuxStream(page: Page, endpoint: string, args: Record<string, unknown>): Promise<unknown[]> {
  return page.evaluate(([target, payload]) => new Promise<unknown[]>((resolve, reject) => {
    const socket = new WebSocket(new URL('api/remote.mux', location.href).href.replace(/^http/u, 'ws'))
    const frames: unknown[] = []
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'open', streamId: 'probe', endpoint: target, payload: { args: payload } }))
    }
    socket.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as { type: string }
      frames.push(frame)
      if (frame.type !== 'item') { socket.close(); resolve(frames) }
    }
    socket.onerror = () => { reject(new Error('mux socket failed')) }
  }), [endpoint, args] as const)
}

/** The first item a carrier received on the stream it opened at `endpoint`. */
function firstItem(carrier: MuxCarrier, endpoint: string): Record<string, unknown> | undefined {
  const opened = carrier.sent.find(frame => frame.type === 'open' && frame.endpoint === endpoint)
  if (opened === undefined) return undefined
  return carrier.received.find(frame => frame.streamId === opened.streamId && frame.type === 'item')?.value
}

/** Elements carrying a React 18 root container marker. */
function reactRoots(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll('*')]
    .filter(element => Object.keys(element).some(key => key.startsWith('__reactContainer$')))
    .map(element => element.id))
}

beforeAll(async () => {
  assertBuilt([
    'apps/web/dist/index.html',
    'packages/testing/sample-plugin/lib/client.js',
    'packages/testing/sample-plugin/lib/typert.host.js',
    'packages/testing/sample-plugin/lib/typert.remote-client.d.ts',
  ])
  home = mkdtempSync(join(tmpdir(), 'dramaip-p1b-'))
  patchFile = join(home, 'profiles/web/cordis.patch.yml')
  // The first composition writes the profile directory the link goes into.
  const init = await runToExit(home, ['--profile', 'web', '--dump-config'])
  expect(init.code, init.output).toBe(0)
  linkSample()
  browser = await chromium.launch({ headless: true })
  web = await startWeb(home)
}, 120_000)

afterAll(async () => {
  await browser?.close()
  if (web !== undefined) await stop(web)
  rmSync(home, { recursive: true, force: true })
})

describe('sample plugin acceptance', { timeout: 120_000 }, () => {
  it('answers the unary method over /api and fails a direct call of the unmarked method structurally', async () => {
    const remoteTypes = readFileSync(join(SAMPLE_DIR, 'lib/typert.remote-client.d.ts'), 'utf8')
    expect(remoteTypes).toContain(`'sample/echo'`)
    expect(remoteTypes).toContain(`'sample/count'`)
    expect(remoteTypes).not.toContain('unmarked')

    const { context, page } = await openShell()
    try {
      expect(await callUnary(page, 'sample/echo', { text: 'hello' })).toEqual({
        status: 200,
        result: { ok: true, value: { text: 'hello' } },
      })
      // The Gateway claims only exported endpoints on /api, so the shared
      // channel answers an unexported one as an unknown route ...
      expect(await postStatus(page, 'sample/unmarked')).toBe(404)
      // ... while a direct invocation reaches the Gateway and fails structurally.
      expect(await openMuxStream(page, 'sample/unmarked', {})).toEqual([{
        type: 'error',
        streamId: 'probe',
        error: {
          code: 'gateway/invocation-unavailable',
          message: 'typert gateway: sample/unmarked: no active Remote method exports this endpoint',
          details: { endpoint: 'sample/unmarked' },
        },
      }])
    } finally {
      await context.close()
    }
  })

  it('streams over /api/remote.mux, opens $events with ready, and rebaselines after a reconnect', async () => {
    const { context, page, carriers } = await openShell()
    try {
      await waitFor(async () => firstItem(carriers[0]!, '$events') !== undefined, 'the $events opening frame')
      const ready = firstItem(carriers[0]!, '$events')!
      expect(ready.type).toBe('ready')
      await waitFor(async () => firstItem(carriers[0]!, 'remoteAccess/follow') !== undefined, 'the access baseline')
      expect(firstItem(carriers[0]!, 'remoteAccess/follow')?.type).toBe('baseline')

      const ticks = await openMuxStream(page, 'sample/count', { limit: 3 })
      expect(ticks).toEqual([
        { type: 'item', streamId: 'probe', value: { n: 1 } },
        { type: 'item', streamId: 'probe', value: { n: 2 } },
        { type: 'item', streamId: 'probe', value: { n: 3 } },
        { type: 'end', streamId: 'probe' },
      ])

      // Drop the shell's carrier: the Client reconnects on a new carrier and
      // every follower starts again from a fresh baseline.
      const shellCarriers = carriers.filter(carrier => carrier.sent.some(frame => frame.endpoint === '$events'))
      expect(shellCarriers).toHaveLength(1)
      const describes = (): Promise<number> => page.evaluate(() =>
        performance.getEntriesByType('resource').filter(entry => entry.name.endsWith('/api/settings/describe')).length)
      const describedBefore = await describes()
      await shellCarriers[0]!.server.close({ code: 1012, reason: 'acceptance reconnect' })
      await shellCarriers[0]!.page.close({ code: 1012, reason: 'acceptance reconnect' })
      const reconnected = (): MuxCarrier | undefined => carriers.find(carrier =>
        carrier !== shellCarriers[0] && firstItem(carrier, '$events') !== undefined
        && firstItem(carrier, 'remoteAccess/follow') !== undefined)
      await waitFor(async () => reconnected() !== undefined, 'the reconnected carrier')
      const next = reconnected()!
      expect(firstItem(next, '$events')?.type).toBe('ready')
      expect(firstItem(next, '$events')?.clientId).not.toBe(ready.clientId)
      expect(firstItem(next, 'remoteAccess/follow')?.type).toBe('baseline')
      // The settings mirror replaces its model on the connection reset.
      await waitFor(async () => await describes() > describedBefore, 'the settings mirror to rebaseline')
    } finally {
      await context.close()
    }
  })

  it('injects the boot graph and serves plugin bundles as immutable resources', async () => {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      const bundles: Array<{ url: string, cacheControl: string | undefined }> = []
      page.on('response', (response) => {
        // `/plugins/events` is the HMR event channel, not a bundle resource.
        const path = new URL(response.url()).pathname
        if (path.startsWith('/plugins/') && path !== '/plugins/events') {
          bundles.push({ url: response.url(), cacheControl: response.headers()['cache-control'] })
        }
      })
      await page.goto(web.launchUrl.href)
      await page.locator(SAMPLE_SELECTOR).waitFor({ state: 'attached', timeout: 30_000 })
      const boot = await page.evaluate(() => JSON.stringify((window as { __DRAMAIP_BOOT__?: unknown }).__DRAMAIP_BOOT__ ?? null))
      expect(boot).not.toBe('null')
      expect(boot).toContain(SAMPLE)
      expect(bundles.length).toBeGreaterThan(0)
      expect(bundles.some(bundle => decodeURIComponent(bundle.url).includes(SAMPLE))).toBe(true)
      for (const bundle of bundles) expect(bundle, bundle.url).toMatchObject({ cacheControl: IMMUTABLE_CACHE })
    } finally {
      await context.close()
    }
  })

  it('shows the Slot contribution and revokes it with the Remote when the profile patch disables the plugin', async () => {
    const { context, page } = await openShell()
    try {
      await page.locator(SAMPLE_SELECTOR).waitFor({ state: 'attached' })
      expect(await page.locator(SAMPLE_SELECTOR).count()).toBe(1)

      writeFileSync(patchFile, DISABLED)
      await waitFor(async () => await page.locator(SAMPLE_SELECTOR).count() === 0, 'the Slot contribution to leave')
      const revoked = await callUnary(page, 'sample/echo', { text: 'gone' })
      expect(revoked.status).toBe(200)
      expect(revoked.result).toMatchObject({ ok: false, error: { code: 'gateway/definition-unavailable' } })

      writeFileSync(patchFile, INSERTED)
      await waitFor(async () => await page.locator(SAMPLE_SELECTOR).count() === 1, 'the Slot contribution to return')
      expect((await callUnary(page, 'sample/echo', { text: 'back' })).result).toEqual({ ok: true, value: { text: 'back' } })
      expect(web.child.exitCode).toBeNull()
    } finally {
      writeFileSync(patchFile, INSERTED)
      await context.close()
    }
  })

  it('renders the root Slot once into a single React root', async () => {
    const { context, page } = await openShell()
    try {
      await page.locator(SAMPLE_SELECTOR).waitFor({ state: 'attached' })
      expect(await page.locator('[data-slot="root"]').count()).toBe(1)
      expect(await reactRoots(page)).toEqual(['root'])
      // A plugin reload re-renders inside the same root rather than mounting another.
      writeFileSync(patchFile, DISABLED)
      await waitFor(async () => await page.locator(SAMPLE_SELECTOR).count() === 0, 'the Slot contribution to leave')
      writeFileSync(patchFile, INSERTED)
      await waitFor(async () => await page.locator(SAMPLE_SELECTOR).count() === 1, 'the Slot contribution to return')
      expect(await page.locator('[data-slot="root"]').count()).toBe(1)
      expect(await reactRoots(page)).toEqual(['root'])
    } finally {
      writeFileSync(patchFile, INSERTED)
      await context.close()
    }
  })
})
