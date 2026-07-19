import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

function rendererSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return rendererSourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

test('destructive dialog copy identifies the target and irreversible impact', () => {
  const source = readFileSync(join(process.cwd(), 'apps/desktop/renderer/src/components/ConfirmActionDialog.tsx'), 'utf8')
  assert.match(source, /title: `删除\$\{subject\}？`/)
  assert.match(source, /将永久删除\$\{subject\}及其关联信息，当前操作不可撤销。/)
  assert.match(source, /confirmLabel: '删除'/)
  assert.match(source, /destructive: true/)
})

test('renderer has no native blocking confirm or prompt calls', () => {
  const sources = rendererSourceFiles(join(process.cwd(), 'apps/desktop/renderer/src'))
  const offenders = sources.filter((file) => /window\.(confirm|prompt)\s*\(/.test(readFileSync(file, 'utf8')))
  assert.deepEqual(offenders, [])
})
