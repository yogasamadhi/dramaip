import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const bun = process.platform === 'win32' ? 'bun.exe' : 'bun'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return result.status ?? 1
}

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory()
        ? testFiles(path)
        : entry.isFile() && entry.name.endsWith('.test.ts')
          ? [path]
          : []
    })
    .sort()
}

let status = run(process.execPath, ['scripts/rebuild-better-sqlite3-node.mjs'])
if (status === 0) {
  status = run(process.execPath, ['--import', 'tsx', '--test', ...testFiles('tests')])
}

// 单测无论成功或失败都恢复桌面运行时，避免下一次 bun dev 命中 Node ABI。
const restoreStatus = run(bun, ['run', 'rebuild:electron'])
process.exit(status || restoreStatus)
