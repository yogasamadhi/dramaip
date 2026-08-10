import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const requireFromDesktop = createRequire(join(process.cwd(), 'apps', 'desktop', 'package.json'))

let packageJsonPath
try {
  packageJsonPath = requireFromDesktop.resolve('better-sqlite3/package.json')
} catch {
  console.error('Cannot resolve better-sqlite3 from apps/desktop. Run bun install first.')
  process.exit(1)
}

const cwd = dirname(packageJsonPath)
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(command, ['run', 'install'], {
  cwd,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
