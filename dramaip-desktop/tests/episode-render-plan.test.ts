import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildEpisodeRenderPlan, serializeVtt, wrapSubtitle, type AnimaticDraft, type AudioTrack, type Shot } from '../packages/core/src'

const animatic = {
  id: 'animatic-1', projectId: 'project-1', adaptationProjectId: 'adaptation-1', episodeId: 'episode-1',
  versionNumber: 2, status: 'approved', sourceFingerprint: 'shot-1@a|shot-2@b', annotations: [], reviewNote: '节奏通过', createdAt: '', updatedAt: '',
  clips: [
    { id: 'clip-2', shotId: 'shot-2', orderIndex: 1, durationSeconds: 3, transition: 'fade', crop: { zoom: 1.1, x: 3, y: -2 } },
    { id: 'clip-1', shotId: 'shot-1', orderIndex: 0, durationSeconds: 2, transition: 'cut', crop: { zoom: 1, x: 0, y: 0 }, assetId: 'asset-1' },
  ],
} as AnimaticDraft

const shots = [
  { id: 'shot-1', dialogue: '欢迎来到短剧制作现场，第一句要清晰且不压画面。', updatedAt: 'a' },
  { id: 'shot-2', subtitleDraft: '第二镜字幕', updatedAt: 'b' },
] as Shot[]

const adoptedTrack = {
  id: 'audio-1', kind: 'dialogue', status: 'adopted', versionNumber: 3, label: '对白 v3', sourceFingerprint: 'shot-1@a|shot-2@b', clips: [],
} as AudioTrack

test('delivery plan has deterministic 9:16 subtitle timing and source lineage', () => {
  const plan = buildEpisodeRenderPlan({
    animatic,
    shots,
    audioTracks: [adoptedTrack],
    resolveVisualSource: ({ shotId }) => shotId === 'shot-1'
      ? { kind: 'still', sourceId: 'asset-1', sourceVersion: 'asset-v1', localPath: '/safe/one.png' }
      : { kind: 'video', sourceId: 'video-2', sourceVersion: 'video-v2', localPath: '/safe/two.mp4' },
  })
  assert.equal(plan.durationSeconds, 5)
  assert.deepEqual(plan.visualClips.map((clip) => [clip.shotId, clip.startSeconds, clip.source.kind]), [['shot-1', 0, 'still'], ['shot-2', 2, 'video']])
  assert.match(plan.sourceFingerprint, /animatic:animatic-1@2/)
  assert.match(plan.sourceFingerprint, /asset-1@asset-v1/)
  assert.match(plan.sourceFingerprint, /audio:audio-1@3/)
  assert.match(plan.srt, /00:00:00,000 --> 00:00:02,000/)
  assert.match(plan.srt, /00:00:02,000 --> 00:00:05,000/)
  assert.match(plan.srt, /\n/)
  assert.match(serializeVtt(plan.subtitles), /^WEBVTT/m)
})

test('subtitle wrapping is short and strips accidental SRT timing rows', () => {
  assert.equal(wrapSubtitle('1\n00:00:00,000 --> 00:00:03,000\n你好，世界'), '你好，世界')
  const wrapped = wrapSubtitle('这是一段足够长的竖屏字幕，需要被限制在安全区域内避免遮挡人物表情。')
  assert.equal(wrapped.split('\n').length, 2)
  assert.ok(Array.from(wrapped.split('\n')[0]).length <= 18)
})
