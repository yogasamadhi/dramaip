import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildProductionStageSummaries, productionStagePath } from '../apps/desktop/renderer/src/lib/productionWorkspace'

test('production shell only marks downstream stages complete from their real local outputs', () => {
  const empty = buildProductionStageSummaries({ targetEpisodes: 12, episodes: 0, scripts: 0 })
  assert.equal(empty.find((stage) => stage.key === 'scripts')?.state, 'blocked')
  assert.equal(empty.find((stage) => stage.key === 'video')?.state, 'blocked')

  const inProgress = buildProductionStageSummaries({ targetEpisodes: 12, episodes: 12, scripts: 8, scenes: 8, shots: 4 })
  assert.equal(inProgress.find((stage) => stage.key === 'episodes')?.state, 'complete')
  assert.equal(inProgress.find((stage) => stage.key === 'scripts')?.state, 'in_progress')
  assert.equal(inProgress.find((stage) => stage.key === 'shots')?.state, 'in_progress')

  const downstreamPreview = buildProductionStageSummaries({ targetEpisodes: 2, episodes: 2, scripts: 2, scenes: 3, shots: 3, videos: 1 })
  assert.deepEqual(downstreamPreview.map((stage) => stage.state), ['complete', 'complete', 'complete', 'in_progress', 'in_progress'])
})

test('production shell keeps an episode context when moving between downstream stages', () => {
  assert.equal(productionStagePath('a1', 'episodes'), '/adaptations/a1?section=episodes')
  assert.equal(productionStagePath('a1', 'scripts', 'e 1'), '/adaptations/a1/scripts?episode=e%201')
  assert.equal(productionStagePath('a1', 'video', 'e1'), '/adaptations/a1/video?episode=e1')
})
