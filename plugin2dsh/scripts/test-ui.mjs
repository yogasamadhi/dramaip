import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const temp = mkdtempSync(join(tmpdir(), 'dramaip-ui-'))
const stateFile = join(temp, 'state.json')
const server = spawn(process.execPath, ['scripts/verify-temp-home.mjs', '--serve'], {
  env: { ...process.env, DRAMAIP_TEST_STATE_FILE: stateFile },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', (b) => {
  output += b
  process.stdout.write(b)
})
server.stderr.on('data', (b) => {
  output += b
  process.stderr.write(b)
})
try {
  for (let i = 0; !existsSync(stateFile); i++) {
    if (server.exitCode !== null || i > 1200) throw new Error(`DSH startup failed: ${output}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const require = createRequire(import.meta.url)
  const tests = spawn(
    process.execPath,
    [
      require.resolve('@playwright/test/cli'),
      'test',
      ...process.argv.slice(2).filter((arg) => arg !== '--'),
    ],
    { env: { ...process.env, DRAMAIP_TEST_STATE_FILE: stateFile }, stdio: 'inherit' },
  )
  const [code] = await once(tests, 'exit')
  process.exitCode = code ?? 1
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM')
    await once(server, 'exit')
  }
  rmSync(temp, { recursive: true, force: true })
}
