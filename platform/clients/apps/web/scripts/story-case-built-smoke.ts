import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORY_CASE_ARTIFACTS, storyCaseArtifact, storyCaseFileURL } from '../lib/story-case'

const root = fileURLToPath(new URL('..', import.meta.url))
const server = join(root, '.next/standalone/apps/web/server.js')
await access(server)
// Get an unused loopback port. Never terminate another listener or use launchers.
const probe = createServer()
await new Promise<void>((resolve, reject) => {
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', resolve)
})
const address = probe.address()
assert(address && typeof address === 'object')
const port = address.port
await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))
const child = spawn(process.execPath, [server], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', DRAMAIP_DEBUG_BACKGROUND: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = '', exited = false
const closed = new Promise<void>((resolve, reject) => {
  child.once('error', reject)
  child.once('close', () => { exited = true; resolve() })
})
const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-8192) }
child.stdout.on('data', collect)
child.stderr.on('data', collect)
const origin = `http://127.0.0.1:${port}`
try {
  const deadline = Date.now() + 20_000
  while (!/Ready in/u.test(output)) {
    assert(!exited, 'Owned Web server exited before readiness')
    assert(Date.now() < deadline, 'Owned Web server readiness timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const fetchLocal = (path: string) => fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10_000) })
  const page = await fetchLocal('/cases/story')
  assert.equal(page.status, 200)
  const html = await page.text()
  for (const descriptor of STORY_CASE_ARTIFACTS) {
    const expected = storyCaseArtifact(descriptor.file)
    assert(expected)
    const path = storyCaseFileURL(descriptor.file)
    assert(html.includes(path), 'Built page does not link its exact display artifact')
    const response = await fetchLocal(path)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="${descriptor.file}"`)
    assert.equal(response.headers.get('Content-Type'), descriptor.mediaType)
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
    assert.equal(response.headers.get('X-DramaIP-Example-Evidence'), 'author-written-fictional')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.deepEqual(bytes, Buffer.from(expected.body), 'Built artifact bytes differ from current author display source')
    assert.equal(response.headers.get('ETag'), `"sha256-${createHash('sha256').update(bytes).digest('hex')}"`)
  }
  assert.equal((await fetchLocal('/cases/story/files/missing.json')).status, 404)
  console.log(JSON.stringify({ ok: true, scope: 'owned-local-built-web-public-author-demo', checks: 6, downloads: 4, qualityConclusion: 'not-established', releaseReady: false }))
} finally {
  if (!exited) child.kill('SIGTERM')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([closed, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); reject(new Error('Owned Web server cleanup timed out')) }, 5000)
    })])
  } finally { clearTimeout(timer) }
}
