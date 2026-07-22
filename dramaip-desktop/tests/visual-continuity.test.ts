import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeVisualContinuity, type Shot, type ShotStillCandidate, type ShotVisualAssetLock, type VisualAssetVersion } from '../packages/core/src'

const shot = { id: 'shot-1', shotNumber: 1, visualDescription: '横屏 16:9 的招牌文字', imagePrompt: '', coverPrompt: '' } as Shot
const version = { id: 'v-1', projectId: 'p', ownerKind: 'visual_profile', ownerId: 'owner', assetId: 'asset', slot: 'face_anchor', label: '女主定妆', versionNumber: 1, status: 'adopted', createdAt: '', updatedAt: '' } as VisualAssetVersion

test('visual continuity explains missing locks, stale upstream changes, aspect ratio and text risks', () => {
  const lock = { id: 'l-1', projectId: 'p', shotId: shot.id, visualAssetVersionId: version.id, role: 'character', staleReason: '上游已采用新服装版本', createdAt: '', updatedAt: '' } as ShotVisualAssetLock
  const report = analyzeVisualContinuity({ shots: [shot], locks: [lock], versions: [version] })
  assert.equal(report.checkedShots, 1)
  assert.equal(report.stillCoveredShots, 0)
  assert.equal(report.staleShots, 1)
  assert.deepEqual(report.issues.map((issue) => issue.kind), ['missing_lock', 'stale_lock', 'missing_still', 'aspect_ratio', 'text_risk'])
  assert.equal(report.issues.find((issue) => issue.kind === 'stale_lock')?.severity, 'blocking')
})

test('marks only an adopted stale still as a blocking minimal redo and preserves coverage truth', () => {
  const still = { id: 'still-1', projectId: 'p', shotId: shot.id, assetId: 'asset', kind: 'first_frame', status: 'adopted', label: '首帧 A', staleReason: '镜头 Prompt 已更新', createdAt: '', updatedAt: '' } as ShotStillCandidate
  const report = analyzeVisualContinuity({ shots: [shot], locks: [], versions: [], stillCandidates: [still] })
  assert.equal(report.stillCoveredShots, 1)
  assert.equal(report.staleShots, 1)
  assert.equal(report.issues.find((issue) => issue.kind === 'stale_still')?.severity, 'blocking')
  assert.match(report.issues.find((issue) => issue.kind === 'stale_still')?.message ?? '', /首帧 A/)
})
