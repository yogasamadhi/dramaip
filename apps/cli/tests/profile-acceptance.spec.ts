/**
 * P1-a acceptance against the real source CLI: `--dump-config` snapshots for
 * the template profiles, the web profile's authentication, static serving and
 * trust fence, wildcard-bind rejection, signal exit codes, the one-shot
 * headless run, and configuration HMR from the profile's own patch layer.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertBuilt, runToExit, send, signIn, startWeb, stop, waitFor } from './web-harness.ts'

let home: string

beforeAll(() => {
  // The static root the web profile serves: the Vite shell's production build.
  assertBuilt(['apps/web/dist/index.html'])
  home = mkdtempSync(join(tmpdir(), 'dramaip-p1a-'))
})

afterAll(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('dramaip profile acceptance', { timeout: 120_000 }, () => {
  it.each(['web', 'headless'])('dumps the %s profile composition matching its snapshot', async (profile) => {
    const { code, output } = await runToExit(home, ['--profile', profile, '--dump-config'])
    expect(code, output).toBe(0)
    await expect(output).toMatchFileSnapshot(`./snapshots/${profile}.dump-config.yml`)
  })

  it('serves the web profile behind the launch token and the trust fence', async () => {
    const web = await startWeb(home)
    try {
      expect(web.launchUrl.searchParams.get('token')).toMatch(/\S+/u)
      const cookie = await signIn(web.launchUrl)

      const index = await send(web.launchUrl, '/', { headers: { cookie } })
      expect(index.status).toBe(200)
      expect(index.body).toContain('<div id="root"></div>')

      const missing = await send(web.launchUrl, '/missing.js', { headers: { cookie } })
      expect([missing.status, missing.body]).toEqual([404, ''])
      expect((await send(web.launchUrl, '/..%2fpackage.json', { headers: { cookie } })).status).toBe(403)
      expect((await send(web.launchUrl, '/', { method: 'DELETE' })).status).toBe(405)

      expect((await send(web.launchUrl, '/api/settings/describe')).status).toBe(401)
      expect((await send(web.launchUrl, '/api/settings/describe', { headers: { cookie, host: 'evil.example' } })).status).toBe(403)
      expect((await send(web.launchUrl, '/api/settings/describe', { headers: { cookie, origin: 'http://evil.example' } })).status).toBe(403)
    } finally {
      await stop(web)
    }
  })

  it.each(['0.0.0.0', '::'])('refuses the wildcard bind %s at startup', async (host) => {
    const { code, output } = await runToExit(home, ['--profile', 'web', '--host', host, '--port', '0', '--no-open'])
    expect(code).not.toBe(0)
    expect(output).toContain('unspecified (wildcard) address')
  })

  it.each([['SIGTERM', 0], ['SIGINT', 130]] as const)('exits on %s with code %i', async (signal, expected) => {
    const web = await startWeb(home)
    const { code } = await stop(web, signal)
    expect(code).toBe(expected)
  })

  it('runs the headless profile once without listening on any port', async () => {
    const { code, output } = await runToExit(home, ['--profile', 'headless'])
    expect(code, output).toBe(0)
    const report = JSON.parse(output.trim().split('\n').at(-1)!) as {
      profile: string
      listeners: number
      entries: Array<{ id: string, active: boolean }>
    }
    expect(report.profile).toBe('headless')
    expect(report.listeners).toBe(0)
    expect(report.entries.map(entry => entry.id)).not.toContain('webserver')
    expect(report.entries.find(entry => entry.id === 'hmr')?.active).toBe(false)
  })

  it('unloads an entry disabled in the profile patch without restarting', async () => {
    const patchFile = join(home, 'profiles/web/cordis.patch.yml')
    const web = await startWeb(home)
    const original = readFileSync(patchFile, 'utf8')
    const apiStatus = async (): Promise<number> => (await send(web.launchUrl, '/api/settings/describe')).status
    try {
      expect(await apiStatus()).toBe(401)
      writeFileSync(patchFile, '- id: connection\n  disabled: true\n')
      // Without Connection the /api route is gone and the static fallback answers.
      await waitFor(async () => await apiStatus() === 404, 'connection to unload')
      writeFileSync(patchFile, original)
      await waitFor(async () => await apiStatus() === 401, 'connection to reload')
      expect(web.child.exitCode).toBeNull()
    } finally {
      writeFileSync(patchFile, original)
      await stop(web)
    }
  })
})
