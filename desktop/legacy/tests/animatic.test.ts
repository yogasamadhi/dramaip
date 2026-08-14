import assert from 'node:assert/strict'
import { test } from 'node:test'
import { animaticDurationSeconds, initializeAnimaticClips, type Shot, type ShotStillCandidate } from '../packages/core/src'

const shots = [
  { id: 's2', shotNumber: 2, visualDescription: '第二镜', durationSeconds: 4.4, updatedAt: 'b' },
  { id: 's1', shotNumber: 1, visualDescription: '第一镜', dialogue: '别走', durationSeconds: 0.2, updatedAt: 'a' },
] as Shot[]

test('initializes a deterministic animatic from adopted stills and keeps missing stills explicit', () => {
  const candidates = [{ id: 'c1', projectId: 'p', shotId: 's1', assetId: 'a1', kind: 'first_frame', status: 'adopted', label: '首帧', createdAt: '', updatedAt: '' }] as ShotStillCandidate[]
  const timeline = initializeAnimaticClips(shots, candidates)
  assert.deepEqual(timeline.clips.map((clip) => clip.shotId), ['s1', 's2'])
  assert.equal(timeline.clips[0].assetId, 'a1')
  assert.deepEqual(timeline.clips[0].crop, { zoom: 1, x: 0, y: 0 })
  assert.equal(timeline.clips[1].assetId, undefined)
  assert.equal(timeline.clips[0].durationSeconds, 1)
  assert.equal(timeline.clips[1].transition, 'fade')
  assert.equal(animaticDurationSeconds(timeline.clips), 5.4)
  assert.equal(timeline.sourceFingerprint, 's1@a|s2@b')
})
