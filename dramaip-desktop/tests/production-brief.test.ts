import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createCompatibleProjectProductionBrief,
  createProjectProductionBrief,
  formatProductionDuration,
} from '@sdns/core'

test('production briefs expose three creation goals, editable duration, and a 1–3 episode pilot boundary', () => {
  const direct = createProjectProductionBrief({
    creationGoal: 'direct_drama',
    profile: { pilotEpisodeCount: 5, episodeDuration: { minSeconds: 45, maxSeconds: 90 } },
  })
  assert.equal(direct.nextStep, 'create_direct_adaptation')
  assert.equal(direct.profile.pilotEpisodeCount, 3)
  assert.equal(formatProductionDuration(direct.profile.episodeDuration), '45–90 秒')

  const imported = createProjectProductionBrief({ creationGoal: 'adapt_existing_ip' })
  assert.equal(imported.nextStep, 'import_source')
})

test('older projects receive a compatible profile without needing stored data', () => {
  const compatible = createCompatibleProjectProductionBrief({ shortDramaType: '都市情感' })
  assert.equal(compatible.creationGoal, 'novel_to_drama')
  assert.equal(compatible.profile.pilotEpisodeCount, 3)
})
