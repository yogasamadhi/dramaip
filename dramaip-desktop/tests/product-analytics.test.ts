import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDb, createRepositories } from '../packages/db/src'

test('product analytics is consent gated, allowlisted, acknowledged idempotently, and cleared on withdrawal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dramaip-product-analytics-'))
  const opened = createDb(join(directory, 'studio.db'))
  const repos = createRepositories(opened.db)
  try {
    assert.equal(repos.productionStudio.recordProductAnalyticsEvent(repos.db, {
      eventName: 'demo_opened',
      appVersion: '2.0.0',
      operatingSystem: 'darwin',
    }), false)
    assert.equal(repos.productionStudio.listPendingProductAnalyticsEvents(repos.db).length, 0)

    const granted = repos.productionStudio.setProductAnalyticsConsent(repos.db, 'granted')
    assert.match(granted.installationId, /^[0-9a-f-]{36}$/)
    assert.equal(repos.productionStudio.recordProductAnalyticsEvent(repos.db, {
      eventName: 'demo_opened',
      appVersion: '2.0.0',
      operatingSystem: 'darwin',
      durationBucket: 'under_1m',
    }), true)
    assert.throws(() => repos.productionStudio.recordProductAnalyticsEvent(repos.db, {
      eventName: 'project_title',
      appVersion: '2.0.0',
      operatingSystem: 'darwin',
    }), /允许列表/)

    const [pending] = repos.productionStudio.listPendingProductAnalyticsEvents(repos.db)
    assert.ok(pending)
    assert.equal(repos.productionStudio.markProductAnalyticsEventsUploaded(repos.db, [pending.id, pending.id]), 1)
    assert.equal(repos.productionStudio.markProductAnalyticsEventsUploaded(repos.db, [pending.id]), 0)

    repos.productionStudio.recordProductAnalyticsEvent(repos.db, {
      eventName: 'first_shot_ready',
      appVersion: '2.0.0',
      operatingSystem: 'darwin',
    })
    assert.equal(repos.productionStudio.listPendingProductAnalyticsEvents(repos.db).length, 1)
    repos.productionStudio.setProductAnalyticsConsent(repos.db, 'denied')
    assert.equal(repos.productionStudio.listPendingProductAnalyticsEvents(repos.db).length, 0)
  } finally {
    opened.raw.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
