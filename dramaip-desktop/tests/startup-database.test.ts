import assert from 'node:assert/strict'
import test from 'node:test'

import {
  runDatabaseGatedStartup,
  runStartupDatabaseInitialization,
} from '../apps/desktop/electron/startup-database'

test('database initialization failure is reported and returned to the startup gate', async () => {
  const reported: string[] = []
  const ready = await runStartupDatabaseInitialization(
    async () => { throw new Error('database is corrupt') },
    (message) => reported.push(message),
  )
  assert.equal(ready, false)
  assert.deepEqual(reported, ['database is corrupt'])
})

test('application startup steps are skipped when the database is unavailable', async () => {
  let applicationStarts = 0
  const started = await runDatabaseGatedStartup(
    async () => false,
    async () => { applicationStarts++ },
  )
  assert.equal(started, false)
  assert.equal(applicationStarts, 0)
})

test('application startup steps run once after database initialization succeeds', async () => {
  let applicationStarts = 0
  const started = await runDatabaseGatedStartup(
    async () => true,
    async () => { applicationStarts++ },
  )
  assert.equal(started, true)
  assert.equal(applicationStarts, 1)
})
