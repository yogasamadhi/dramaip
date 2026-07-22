import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeEpisodeQuality, buildEpisodeQualitySourceFingerprint, type EpisodeRenderPlan } from '../packages/core/src'

const plan: EpisodeRenderPlan = {
  episodeId: 'episode-1', animaticId: 'animatic-1', animaticVersionNumber: 1, durationSeconds: 4, sourceFingerprint: 'plan-v1',
  visualClips: [
    { id: 'clip-1', shotId: 'shot-1', orderIndex: 0, startSeconds: 0, durationSeconds: 2, transition: 'cut', crop: { zoom: 1, x: 0, y: 0 }, source: { kind: 'video', sourceId: 'video-1' } },
    { id: 'clip-2', shotId: 'shot-2', orderIndex: 1, startSeconds: 2, durationSeconds: 2, transition: 'fade', crop: { zoom: 1, x: 0, y: 0 }, source: { kind: 'video', sourceId: 'video-2' } },
  ],
  audioTracks: [{ id: 'dialogue-1', kind: 'dialogue', versionNumber: 1, label: '对白', status: 'adopted', sourceFingerprint: 'plan-v1', clips: [{ id: 'voice-1', text: '第一句', startSeconds: 0, durationSeconds: 1, volume: 1, fadeInSeconds: 0, fadeOutSeconds: 0, loop: false, duckingIntent: false }] }],
  subtitles: [{ index: 1, startSeconds: 0, endSeconds: 1, text: '第一句' }],
  srt: '', vtt: '',
}

test('episode quality localizes injected delivery defects and plans minimal redo only for blockers', () => {
  const report = analyzeEpisodeQuality({
    renderTaskId: 'render-1', renderSourceFingerprint: 'plan-v1', currentPlanFingerprint: 'plan-v1', plan,
    inspection: {
      readable: true, durationSeconds: 4, width: 720, height: 1280, hasVideo: true, hasAudio: true,
      blackIntervals: [{ startSeconds: 0.2, endSeconds: 0.8 }],
      frozenIntervals: [{ startSeconds: 2.1, endSeconds: 3 }],
      silenceIntervals: [{ startSeconds: 1.2, endSeconds: 1.9 }],
      integratedLufs: -10, maxVolumeDb: 0,
    },
    continuity: [{ shotId: 'shot-2', kind: 'stale_lock', severity: 'blocking', message: '镜头 2 的角色锁已过期。' }],
    generatedAt: '2026-07-23T00:00:00.000Z',
  })
  assert.ok(report.issues.some((issue) => issue.kind === 'black_frames' && issue.affectedShotIds?.includes('shot-1')))
  assert.ok(report.issues.some((issue) => issue.kind === 'frozen_frames' && issue.affectedShotIds?.includes('shot-2')))
  assert.ok(report.issues.some((issue) => issue.kind === 'silence' && issue.severity === 'warning'))
  assert.ok(report.issues.some((issue) => issue.kind === 'clipping'))
  assert.ok(report.issues.some((issue) => issue.kind === 'loudness'))
  assert.ok(report.issues.some((issue) => issue.kind === 'continuity' && issue.targetId === 'shot-2'))
  assert.deepEqual(report.redoTargets.filter((target) => target.kind === 'shot').map((target) => target.targetId).sort(), ['shot-1', 'shot-2'])
  assert.ok(report.limitations[0]?.includes('嘴型同步'))
})

test('episode quality blocks malformed or overlapping vertical subtitles and placeholder visuals', () => {
  const malformed: EpisodeRenderPlan = {
    ...plan,
    visualClips: [{ ...plan.visualClips[0]!, source: { kind: 'still', sourceId: 'still-1', label: 'placeholder-image' } }, plan.visualClips[1]!],
    subtitles: [
      { index: 1, startSeconds: 0, endSeconds: 3, text: '这是超过十八个字符的竖屏字幕第一行文本\n第二行\n第三行' },
      { index: 2, startSeconds: 2, endSeconds: 5, text: '重叠且越界' },
    ],
  }
  const report = analyzeEpisodeQuality({
    renderTaskId: 'render-2', renderSourceFingerprint: 'plan-v2', currentPlanFingerprint: 'plan-v2', plan: malformed,
    inspection: { readable: true, durationSeconds: 4, width: 720, height: 1280, hasVideo: true, hasAudio: true },
  })
  assert.ok(report.issues.some((issue) => issue.kind === 'placeholder_visual' && issue.severity === 'blocker'))
  assert.ok(report.issues.some((issue) => issue.kind === 'subtitle_safe_area' && issue.severity === 'blocker'))
  assert.ok(report.issues.some((issue) => issue.kind === 'subtitle_overlap' && issue.severity === 'blocker'))
  assert.ok(report.issues.some((issue) => issue.kind === 'subtitle_bounds' && issue.severity === 'blocker'))
})

test('expected still-image holds and short fade boundaries are not misreported as frozen or black media', () => {
  const stillPlan: EpisodeRenderPlan = {
    ...plan,
    visualClips: [{ ...plan.visualClips[0]!, transition: 'fade', source: { kind: 'still', sourceId: 'still-1' } }, plan.visualClips[1]!],
  }
  const report = analyzeEpisodeQuality({
    renderTaskId: 'render-still', renderSourceFingerprint: 'plan-still', currentPlanFingerprint: 'plan-still', plan: stillPlan,
    inspection: {
      readable: true, durationSeconds: 4, width: 720, height: 1280, hasVideo: true, hasAudio: true,
      frozenIntervals: [{ startSeconds: 0, endSeconds: 2 }],
      blackIntervals: [{ startSeconds: 1.85, endSeconds: 2 }],
    },
  })
  assert.equal(report.issues.some((issue) => issue.kind === 'frozen_frames'), false)
  assert.equal(report.issues.some((issue) => issue.kind === 'black_frames'), false)
})

test('quality source fingerprint changes when either the render artifact or current plan changes', () => {
  const one = buildEpisodeQualitySourceFingerprint({ renderTaskId: 'render-1', renderSourceFingerprint: 'render-v1', currentPlanFingerprint: 'plan-v1' })
  const two = buildEpisodeQualitySourceFingerprint({ renderTaskId: 'render-2', renderSourceFingerprint: 'render-v1', currentPlanFingerprint: 'plan-v1' })
  const three = buildEpisodeQualitySourceFingerprint({ renderTaskId: 'render-1', renderSourceFingerprint: 'render-v1', currentPlanFingerprint: 'plan-v2' })
  assert.notEqual(one, two)
  assert.notEqual(one, three)
})
