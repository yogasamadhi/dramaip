import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUILT_IN_GENRE_PRESETS,
  CLASSIC_GENRE_PRESET_NAMES,
  HOT_GENRE_PRESET_NAMES,
  RETIRED_BUILT_IN_GENRE_PRESET_NAMES,
  SHORT_DRAMA_TYPES,
} from '@sdns/core'

test('built-in genre presets prioritize the 2026 AI-drama market leaders', () => {
  assert.deepEqual(SHORT_DRAMA_TYPES.slice(0, 5), [
    '奇幻玄幻·修仙逆袭',
    '游戏系统·副本升级',
    '末世求生·领地经营',
    '悬疑灵异·民俗奇谭',
    '规则怪谈·无限流',
  ])
  assert.deepEqual(SHORT_DRAMA_TYPES, BUILT_IN_GENRE_PRESETS.map((preset) => preset.name))
  assert.equal(HOT_GENRE_PRESET_NAMES.length, 12)
  assert.equal(CLASSIC_GENRE_PRESET_NAMES.length, 3)
})

test('current and retired built-in genre names stay disjoint and presets remain production-ready', () => {
  const currentNames = new Set(SHORT_DRAMA_TYPES)
  for (const retiredName of RETIRED_BUILT_IN_GENRE_PRESET_NAMES) {
    assert.equal(currentNames.has(retiredName), false)
  }

  for (const preset of BUILT_IN_GENRE_PRESETS) {
    assert.ok(preset.commonRelationships.length >= 3)
    assert.ok(preset.commonHighlights.length >= 4)
    assert.ok(preset.commonReversals.length >= 3)
    assert.ok(preset.commonOpenings.length >= 3)
    assert.ok(preset.commonCliffhangers.length >= 3)
    assert.ok(preset.visualStyle.length > 0)
    assert.ok(preset.shotPromptAdvice.length > 0)
    assert.ok(preset.aiVideoRisks.length > 0)
  }
})
