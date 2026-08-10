import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import {
  collectDiagnosticLogs,
  createDiagnosticPackage,
  redactDiagnosticValue,
} from '../apps/desktop/electron/diagnostics'

test('redacts secrets and body-like fields by default', () => {
  const redacted = redactDiagnosticValue({
    apiKey: 'sk-test_12345678901234567890',
    authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
    message: 'model failed',
    input: '这是一段用于生成的正文内容',
    nested: {
      prompt: '请续写这一章正文',
      output: '模型输出正文',
    },
  }) as Record<string, unknown>

  const text = JSON.stringify(redacted)
  assert.equal(redacted['apiKey'], '***')
  assert.equal(redacted['authorization'], '***')
  assert.match(text, /redacted text metadata/)
  assert.doesNotMatch(text, /sk-test/)
  assert.doesNotMatch(text, /Bearer abcdef/)
  assert.doesNotMatch(text, /续写这一章/)
  assert.doesNotMatch(text, /模型输出正文/)
})

test('explicit content export keeps bounded content while masking secrets', () => {
  const redacted = redactDiagnosticValue(
    {
      input: '短正文',
      apiKey: 'sk-test_12345678901234567890',
    },
    { includeContent: true },
  ) as Record<string, unknown>

  assert.equal(redacted['input'], '短正文')
  assert.equal(redacted['apiKey'], '***')
})

test('collects recent logs with redacted content and errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdns-diagnostics-'))
  const logPath = join(dir, 'studio.log')
  writeFileSync(
    logPath,
    [
      JSON.stringify({ ts: '2026-01-01T00:00:00.000Z', level: 'info', scope: 'ai', message: 'ok' }),
      JSON.stringify({
        ts: '2026-01-01T00:00:01.000Z',
        level: 'error',
        scope: 'ai',
        message: 'failed',
        meta: {
          password: 'plain-password',
          prompt: '正文片段',
          message: 'provider error',
        },
      }),
    ].join('\n'),
    'utf8',
  )

  const logs = collectDiagnosticLogs([logPath])
  assert.equal(logs.files.length, 1)
  assert.equal(logs.recent.length, 2)
  assert.equal(logs.recentErrors.length, 1)
  assert.doesNotMatch(JSON.stringify(logs), /plain-password/)
  assert.doesNotMatch(JSON.stringify(logs), /正文片段/)
})

test('creates a package with migration and redacted paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdns-diagnostics-'))
  const dbPath = join(dir, 'studio.db')
  writeFileSync(dbPath, 'sqlite-placeholder', 'utf8')

  const pkg = createDiagnosticPackage({
    appName: 'Studio',
    appVersion: '1.0.0',
    userDataPath: dir,
    dbPath,
    migration: {
      latestVersion: 8,
      appliedVersion: 8,
      applied: [{ version: 8, appliedAt: '2026-01-01T00:00:00.000Z' }],
    },
    logFilePaths: [],
    now: new Date('2026-01-01T00:00:00.000Z'),
  })

  assert.equal(pkg.meta.format, 'sdns-diagnostic-package')
  assert.equal(pkg.meta.includeContent, false)
  assert.equal(pkg.database.exists, true)
  assert.equal(pkg.database.migration.appliedVersion, 8)
  assert.equal(pkg.logs.recent.length, 0)
})
