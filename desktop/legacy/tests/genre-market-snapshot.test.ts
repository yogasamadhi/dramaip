import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_GENRE_MARKET_SNAPSHOT,
  createGenreOpportunitySelection,
  resolveGenreMarketSnapshot,
  selectGenreOpportunity,
  validateGenreMarketSnapshot,
} from '@sdns/core'

test('the offline genre market snapshot distinguishes direction, cost, saturation and evidence state', () => {
  const snapshot = validateGenreMarketSnapshot(DEFAULT_GENRE_MARKET_SNAPSHOT)
  const statuses = new Set(snapshot.opportunities.map((item) => item.status))

  assert.equal(snapshot.version, 'cn-ai-drama-market-2026-07-22-v1')
  assert.equal(snapshot.sources.some((source) => source.kind === 'research_report'), true)
  assert.equal(snapshot.sources.some((source) => source.kind === 'official_report'), true)
  assert.deepEqual([...statuses].sort(), ['classic', 'hot', 'rising', 'saturated', 'steady'])
  assert.equal(snapshot.opportunities.every((item) => item.whyRecommended.length > 0 && item.primaryRisks.length > 0 && item.differentiationIdeas.length > 0), true)
})

test('a project selection keeps the chosen opportunity as a historical copy', () => {
  const opportunity = selectGenreOpportunity(DEFAULT_GENRE_MARKET_SNAPSHOT, 'genre-market-20260722-01')
  assert.ok(opportunity)

  const selection = createGenreOpportunitySelection(DEFAULT_GENRE_MARKET_SNAPSHOT, opportunity)
  opportunity.whyRecommended[0] = 'changed after selection'

  assert.equal(selection.snapshotVersion, DEFAULT_GENRE_MARKET_SNAPSHOT.version)
  assert.notEqual(selection.opportunity.whyRecommended[0], opportunity.whyRecommended[0])
})

test('manual offline snapshot validation rejects missing provenance and history resolution supports rollback', () => {
  const malformed = structuredClone(DEFAULT_GENRE_MARKET_SNAPSHOT)
  malformed.sources = []
  assert.throws(() => validateGenreMarketSnapshot(malformed), /日期和来源/)

  const older = structuredClone(DEFAULT_GENRE_MARKET_SNAPSHOT)
  older.version = 'cn-ai-drama-market-2026-07-01-v1'
  older.observedAt = '2026-07-01'
  assert.equal(resolveGenreMarketSnapshot([older, DEFAULT_GENRE_MARKET_SNAPSHOT], older.version)?.version, older.version)
})
