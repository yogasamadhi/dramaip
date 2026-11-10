/**
 * P2 acceptance 4: the `web` profile started on the P0 baseline user data
 * reads the baseline project exactly as the existing Desktop did. The
 * expected content is the P0 read-back alpha.3 recorded
 * (tests/fixtures/baseline-userdata); the Remote method that replaced each
 * read answers it.
 */

import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BOOT_TIMEOUT_MS, DESKTOP_ROOT, callRemote, readBaseline, signIn, startWeb, stop, type RunningWeb } from './web-harness.ts'

const FIXTURE = join(DESKTOP_ROOT, 'tests/fixtures/baseline-userdata/3.0.0-alpha.3')

/** The database files never change: each reader opens its own copy. */
async function copyDatabase(target: string): Promise<void> {
  await mkdir(join(target, '..'), { recursive: true })
  await copyFile(join(FIXTURE, 'dramaip.db'), target)
}

describe('baseline user data in the web profile', () => {
  let home: string
  let web: RunningWeb
  let cookie: string
  let expected: Record<string, unknown>

  beforeAll(async () => {
    expected = JSON.parse(await readFile(join(FIXTURE, 'readback.json'), 'utf8')) as Record<string, unknown>
    home = await mkdtemp(join(tmpdir(), 'dramaip-baseline-web-'))
    await copyDatabase(join(home, 'storage', 'dramaip.sqlite'))
    web = await startWeb(home)
    cookie = await signIn(web.launchUrl)
  }, BOOT_TIMEOUT_MS)

  afterAll(async () => {
    if (web) await stop(web)
    if (home) await rm(home, { recursive: true, force: true })
  })

  it('applies any new migrations before serving the baseline database', async () => {
    const answer = await callRemote<{ migrationRuns: { run: { pendingCount: number; appliedCount: number; integrity: string } }[] }>(web.launchUrl, 'system/diagnostics', {}, { cookie })
    expect(answer.status, answer.body).toBe(200)
    if (answer.result?.ok !== true) throw new Error(answer.body)
    const diagnostics = answer.result.value
    for (const { run } of diagnostics.migrationRuns) {
      expect(run.appliedCount).toBe(run.pendingCount)
      expect(run.integrity).toBe('ok')
    }
  })

  it('reads back the P0 project content', async () => {
    const actual: Record<string, unknown> = {}
    for (const path of Object.keys(expected)) {
      const answer = await readBaseline(web.launchUrl, path, cookie)
      expect(answer.status, `${path}: ${answer.body}`).toBe(200)
      if (answer.result?.ok !== true) throw new Error(`${path}: ${answer.body}`)
      actual[path] = answer.result.value
    }
    expect(actual).toEqual(expected)
  })
})
