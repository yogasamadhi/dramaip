import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PRODUCTION_OUTCOME_BASELINE,
  serializeProductionOutcomeBaseline,
} from '../apps/desktop/electron/production-outcome-baseline'

test('records all three customer creation journeys without pretending unavailable paths work', () => {
  const journeys = PRODUCTION_OUTCOME_BASELINE.journeys

  assert.deepEqual(journeys.map((journey) => journey.id), [
    'idea_to_novel',
    'existing_manuscript_to_drama',
    'direct_script_to_drama',
  ])
  assert.equal(journeys[0]?.state, 'available')
  assert.equal(journeys[0]?.entryRoute, '#/projects/new')
  assert.equal(journeys[1]?.state, 'known_gap')
  assert.equal(journeys[2]?.state, 'known_gap')
  assert.equal(journeys.filter((journey) => journey.state === 'known_gap').every((journey) => journey.missingCapabilities.length > 0), true)
})

test('keeps production and privacy baseline truthful and safe to include in a test report', () => {
  const baseline = PRODUCTION_OUTCOME_BASELINE
  const serialized = serializeProductionOutcomeBaseline()

  assert.equal(baseline.productionTruth.video, 'available')
  assert.equal(baseline.productionTruth.finalDelivery, 'known_gap')
  assert.equal(baseline.operationalTruth.coverage, 'available')
  assert.equal(baseline.operationalTruth.blockingState, 'available')
  assert.equal(baseline.operationalTruth.budget, 'known_gap')
  assert.equal(baseline.operationalTruth.rights, 'known_gap')
  assert.equal(baseline.operationalTruth.providerAvailability, 'available')
  assert.equal(baseline.privacyBoundary.diagnosticContentDefault, 'redacted')
  assert.equal(baseline.privacyBoundary.rendererCredentialAccess, 'restricted')
  assert.doesNotMatch(serialized, /(api[-_]?key|authorization|token|secret|password|credential)\s*[:=]/i)
})
