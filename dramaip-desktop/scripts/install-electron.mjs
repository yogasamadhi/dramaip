import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const pnpmDir = join(process.cwd(), 'node_modules', '.pnpm')
const pkg = existsSync(pnpmDir)
  ? readdirSync(pnpmDir).find((name) => /^electron@/.test(name))
  : undefined

if (!pkg) {
  console.error('Cannot find electron in node_modules/.pnpm. Run pnpm install first.')
  process.exit(1)
}

const cwd = join(pnpmDir, pkg, 'node_modules', 'electron')
const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/',
  npm_config_electron_mirror: process.env.npm_config_electron_mirror ?? 'https://npmmirror.com/mirrors/electron/',
}
const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(command, ['run', 'postinstall'], {
  cwd,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) console.error(result.error.message)
process.exit(result.status ?? 1)
