import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localizationCuesFromShots, localizationSourceFingerprint, localizationSubtitleFiles } from '../packages/core/src/localization'

const shots = [{ id: 's1', shotNumber: 1, updatedAt: '2026-07-23T00:00:00Z', durationSeconds: 2, subtitleDraft: '她回来了。' }, { id: 's2', shotNumber: 2, updatedAt: '2026-07-23T00:00:00Z', durationSeconds: 3, dialogue: '现在轮到我反击。' }] as never[]
test('creates aligned localization cues and a source fingerprint from the Chinese master', () => {
  const cues = localizationCuesFromShots(shots)
  assert.equal(cues.length, 2); assert.equal(cues[1].startSeconds, 2); assert.match(localizationSourceFingerprint(shots), /s1/)
})
test('serializes localized subtitles and flags unreadably dense lines', () => {
  const result = localizationSubtitleFiles([{ id: 'c1', startSeconds: 0, endSeconds: 0.5, sourceText: '原文', localizedText: 'This line is intentionally far too long to be read in half a second.' }])
  assert.match(result.srt, /00:00:00,000/); assert.ok(result.warnings.length > 0)
})
