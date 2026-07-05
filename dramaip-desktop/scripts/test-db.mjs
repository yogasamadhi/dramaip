import { spawnSync } from 'node:child_process'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return result.status ?? 1
}

let status = run(process.execPath, ['scripts/rebuild-better-sqlite3-node.mjs'])
if (status === 0) status = run(pnpm, ['exec', 'tsx', 'tests/db-migration-replay.db.ts'])
if (status === 0) status = run(pnpm, ['exec', 'tsx', 'scripts/smoke-db.ts'])

const restoreStatus = run(pnpm, ['rebuild:electron'])
process.exit(status || restoreStatus)
