/**
 * P2 acceptance of the business plugins in the `web` profile: the 14
 * plugins mount as Cordis fibers on the relational backend and the
 * compat runtime, and their domains answer through the Remote namespaces
 * behind the connection's Host/Origin trust and signed browser cookie. No
 * `/api/v2` operation is served over HTTP: each was migrated to a Remote
 * method or retired (P4/P5).
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import manifests from '@dramaip/compat-runtime/plugin-manifests' with { type: 'json' }
import ledger from '../../../architecture/refactor-ledger.json' with { type: 'json' }
import { BOOT_TIMEOUT_MS, callRemote, signIn, startWeb, stop, type RunningWeb } from './web-harness.ts'

const BUSINESS_PLUGINS = (manifests as readonly { id: string }[]).map(manifest => manifest.id)

interface Operation { operationId: string, method: string, path: string }

/** One request whose response is judged by its head; streams are cut after the first bytes. */
function probe(origin: URL, operation: Operation, cookie: string): Promise<{ status: number, contentType: string, body: string }> {
  const path = operation.path.replace(/\{[^}]+\}/gu, 'probe-0000')
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: origin.hostname,
      port: origin.port,
      path,
      method: operation.method.toUpperCase(),
      headers: { cookie, 'content-type': 'application/json' },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      const done = (): void => {
        res.destroy()
        resolve({ status: res.statusCode ?? 0, contentType: String(res.headers['content-type'] ?? ''), body })
      }
      res.on('data', (chunk: string) => {
        body += chunk
        if (body.length > 2048) done()
      })
      res.on('end', done)
      if (String(res.headers['content-type']).startsWith('text/event-stream')) done()
    })
    req.once('error', reject)
    // The server answers a DELETE that carries a body with a bare 400 before
    // routing, which would hide whether a route exists.
    req.end(['post', 'put', 'patch'].includes(operation.method) ? '{}' : undefined)
  })
}

describe('business plugins in the web profile', () => {
  let home: string
  let web: RunningWeb
  let cookie: string

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'dramaip-business-'))
    web = await startWeb(home)
    cookie = await signIn(web.launchUrl)
  }, BOOT_TIMEOUT_MS)

  afterAll(async () => {
    if (web !== undefined) await stop(web)
    await rm(home, { recursive: true, force: true })
  })

  const remote = <T>(endpoint: string, args: Record<string, unknown> = {}) =>
    callRemote<T>(web.launchUrl, endpoint, args, { cookie })
  const valueOf = <T>(answer: Awaited<ReturnType<typeof remote<T>>>): T => {
    expect(answer.status, answer.body + web.output()).toBe(200)
    if (answer.result?.ok !== true) throw new Error(`Remote call failed: ${answer.body}`)
    return answer.result.value
  }

  it('mounts every business plugin fiber as ACTIVE', async () => {
    expect(BUSINESS_PLUGINS).toHaveLength(14)
    const { plugins } = valueOf(await remote<{ plugins: { id: string, status: string }[] }>('system/diagnostics'))
    expect(plugins.map(plugin => plugin.id).sort()).toEqual([...BUSINESS_PLUGINS].sort())
    expect(plugins.every(plugin => plugin.status === 'active')).toBe(true)
  })

  it('applies every declared migration to the relational database', async () => {
    const database = new DatabaseSync(join(home, 'storage', 'dramaip.sqlite'), { readOnly: true })
    try {
      const applied = database.prepare('SELECT plugin_id AS owner, COUNT(*) AS count FROM plugin_migrations GROUP BY plugin_id').all() as { owner: string, count: number }[]
      const declared = Object.fromEntries((manifests as readonly { id: string, migrations: unknown[] }[]).map(manifest => [manifest.id, manifest.migrations.length]))
      expect(Object.fromEntries(applied.map(row => [row.owner, row.count]))).toEqual(declared)
    } finally {
      database.close()
    }
  })

  it('reports the composed plugins and UI contributions through system/runtime', async () => {
    const info = valueOf(await remote<{ profile: string, mode: string, plugins: { id: string, status: string }[], uiContributions: unknown[] }>('system/runtime'))
    expect(info).toMatchObject({ profile: 'server', mode: 'server' })
    expect(info.plugins).toHaveLength(14)
    expect(info.uiContributions.length).toBeGreaterThan(0)
  })

  it('keeps the Remote endpoints behind the connection trust fence', async () => {
    expect((await callRemote(web.launchUrl, 'workspace/projectsList', {}, {})).status).toBe(401)
    expect((await callRemote(web.launchUrl, 'workspace/projectsList', {}, { cookie, host: 'evil.example' })).status).toBe(403)
    expect((await callRemote(web.launchUrl, 'workspace/projectsList', {}, { cookie, origin: 'http://evil.example' })).status).toBe(403)
    expect((await remote('workspace/projectsList')).status).toBe(200)
    expect((await callRemote(web.launchUrl, 'system/health', {}, {})).status).toBe(401)
    expect((await callRemote(web.launchUrl, 'system/health', {}, { cookie, origin: 'http://evil.example' })).status).toBe(403)
    expect(valueOf(await remote('system/health'))).toMatchObject({ healthy: true })
  })

  it('writes and reads business data through the Remote namespaces', async () => {
    const { project } = valueOf(await remote<{ project: { id: string, title: string } }>('workspace/projectsCreate', {
      input: { title: 'Web profile project' },
      idempotencyKey: crypto.randomUUID(),
    }))
    expect(valueOf(await remote<{ id: string, title: string }[]>('workspace/projectsList'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: project.id, title: 'Web profile project' })]),
    )
  })

  it('serves no ledger operation over HTTP', async () => {
    const operations = (ledger as { operations: (Operation & { state: string })[] }).operations
    expect(operations).toHaveLength(745)
    expect(operations.filter(operation => !['migrated', 'retired'].includes(operation.state))).toEqual([])
    const stillServed: string[] = []
    for (const operation of operations) {
      // The playback bytes are not JSON, so they keep their URL (production-media).
      if (operation.operationId === 'media-playback.read') continue
      const response = await probe(web.launchUrl, operation, cookie)
      // Nothing routes the path: the static frontend's plain 404 or 405. A
      // route's own 404 is a problem document.
      const routerMiss = response.status === 405 || (response.status === 404 && !response.contentType.includes('json'))
      if (!routerMiss) stillServed.push(`${operation.operationId} ${operation.method} ${operation.path} -> ${response.status}`)
    }
    expect(stillServed).toEqual([])
  }, 300_000)
})
