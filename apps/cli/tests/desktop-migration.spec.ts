/**
 * P3 acceptance 6, upgrade and downgrade: the D9 migration copies the P0
 * baseline userData (3.0.0-alpha.3) into a DramaIP home. The new composition
 * reads the baseline project from the home, and the migration leaves the old
 * location byte-for-byte unchanged, so alpha.3 still opens it.
 */

import { createHash } from 'node:crypto'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrateLegacyUserData } from '@dramaip/host-migration'
import { BOOT_TIMEOUT_MS, DESKTOP_ROOT, readBaseline, signIn, startWeb, stop } from './web-harness.ts'

const FIXTURE = join(DESKTOP_ROOT, 'tests/fixtures/baseline-userdata/3.0.0-alpha.3')

async function digests(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else files[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  await walk(root)
  return files
}

describe('D9 migration between alpha.3 userData and the DramaIP home', () => {
  let scratch: string
  let legacy: string
  let home: string
  let expected: Record<string, unknown>

  beforeAll(async () => {
    expected = JSON.parse(await readFile(join(FIXTURE, 'readback.json'), 'utf8')) as Record<string, unknown>
    scratch = await mkdtemp(join(tmpdir(), 'dramaip-d9-'))
    legacy = join(scratch, 'userData')
    home = join(scratch, 'home')
    await cp(FIXTURE, legacy, { recursive: true })
    const result = await migrateLegacyUserData({ source: legacy, home })
    expect(result.marker.outcome).toBe('copied')
  })

  afterAll(async () => {
    if (scratch) await rm(scratch, { recursive: true, force: true })
  })

  it('the new composition reads the baseline project from the home', async () => {
    const web = await startWeb(home)
    try {
      const cookie = await signIn(web.launchUrl)
      for (const path of Object.keys(expected)) {
        const answer = await readBaseline(web.launchUrl, path, cookie)
        expect(answer.status, `${path}: ${answer.body}`).toBe(200)
        if (answer.result?.ok !== true) throw new Error(`${path}: ${answer.body}`)
        expect(answer.result.value, path).toEqual(expected[path])
      }
    } finally {
      await stop(web)
    }
  }, BOOT_TIMEOUT_MS * 2)

  it('leaves the old location byte-for-byte as alpha.3 wrote it', async () => {
    expect(await digests(legacy)).toEqual(await digests(FIXTURE))
  })
})
