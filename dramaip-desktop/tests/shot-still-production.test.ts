import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planShotStillBatch, type Shot, type ShotStillCandidate, type ShotVisualAssetLock, type VisualAssetVersion } from '../packages/core/src'

const shot = { id: 'shot-1', shotNumber: 1, visualDescription: '雨夜天台，女主拿着玉佩回头', videoPrompt: '近景，慢推镜', imagePrompt: '国漫厚涂，雨夜霓虹', coverPrompt: '玉佩特写', updatedAt: '2026-07-23T00:00:00.000Z' } as Shot
const version = { id: 'v-1', projectId: 'p', ownerKind: 'visual_profile', ownerId: 'heroine', assetId: 'asset-1', slot: 'face_anchor', label: '林晚定妆', versionNumber: 2, status: 'adopted', createdAt: '', updatedAt: '' } as VisualAssetVersion
const lock = { id: 'lock-1', projectId: 'p', shotId: shot.id, visualAssetVersionId: version.id, role: 'character', createdAt: '', updatedAt: '' } as ShotVisualAssetLock

test('plans only missing still kinds and never overwrites an adopted candidate', () => {
  const adopted = { id: 'still-1', projectId: 'p', shotId: shot.id, assetId: 'asset-2', kind: 'first_frame', status: 'adopted', label: '首帧 A', createdAt: '', updatedAt: '' } as ShotStillCandidate
  const plan = planShotStillBatch({ shots: [shot], candidates: [adopted], locks: [lock], versions: [version], mode: 'missing_only' })
  assert.deepEqual(plan.planned.map((item) => item.kind), ['still'])
  assert.deepEqual(plan.skipped.map((item) => item.kind), ['first_frame'])
  assert.match(plan.planned[0].input.prompt, /林晚定妆 v2/)
  assert.equal(plan.planned[0].input.size, '1024x1536')
  assert.equal(plan.planned[0].estimatedCost.status, 'unknown')
  assert.equal(plan.planned[0].outputPolicy, 'create_candidate_never_overwrite_adopted')
})

test('allows explicitly selected shots to request a new candidate even when one is adopted', () => {
  const adopted = { id: 'still-1', projectId: 'p', shotId: shot.id, assetId: 'asset-2', kind: 'first_frame', status: 'adopted', label: '首帧 A', createdAt: '', updatedAt: '' } as ShotStillCandidate
  const plan = planShotStillBatch({ shots: [shot], candidates: [adopted], locks: [lock], versions: [version], mode: 'selected', selectedShotIds: [shot.id], kinds: ['first_frame', 'cover'] })
  assert.deepEqual(plan.planned.map((item) => item.kind), ['first_frame', 'cover'])
  assert.equal(plan.skipped.length, 0)
  assert.match(plan.planned[1].input.prompt, /玉佩特写/)
})
