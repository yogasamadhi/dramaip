import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const pnpmDir = join(process.cwd(), 'node_modules', '.pnpm')
const pkg = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).find((name) => name.startsWith('better-sqlite3@'))
  : undefined

if (!pkg) {
  console.error('Cannot find better-sqlite3 in node_modules/.pnpm. Run pnpm install first.')
  process.exit(1)
}

const cwd = join(pnpmDir, pkg, 'node_modules', 'better-sqlite3')
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(command, ['run', 'install'], {
  cwd,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
