import assert from 'node:assert/strict'
import test from 'node:test'
import type { EditorTimelineManifest, ReviewPackageManifest } from '@sdns/core'
import {
  preflightEditorTimeline,
  renderCmx3600Edl,
  renderEditorMediaCsv,
  renderFcpxml110,
  renderOfflineReviewHtml,
  renderSrt,
  validateReviewPackageManifest,
} from '@sdns/export'

const timeline: EditorTimelineManifest = {
  format: 'dramaip-editor-timeline',
  version: 1,
  projectId: 'project-1',
  adaptationProjectId: 'adaptation-1',
  episodeId: 'episode-1',
  title: '样片第一集',
  frameRate: 25,
  width: 1080,
  height: 1920,
  clips: [
    {
      id: 'clip-1',
      shotId: 'shot-1',
      name: '镜头 1',
      sourcePath: '/workspace/shot-1.mp4',
      startSeconds: 0,
      durationSeconds: 2,
      sourceInSeconds: 1,
      sourceOutSeconds: 3,
      dialogue: '你终于来了。',
      subtitle: '你终于来了。',
      transition: 'cut',
      mediaKind: 'video',
    },
    {
      id: 'clip-2',
      shotId: 'shot-2',
      name: '镜头 2',
      startSeconds: 2,
      durationSeconds: 3.2,
      sourceInSeconds: 0,
      sourceOutSeconds: 3.2,
      narration: '门外没有人。',
      transition: 'fade',
      mediaKind: 'still',
    },
  ],
  createdAt: '2026-07-28T00:00:00.000Z',
}

test('editor exports share one timeline without silently losing EDL limitations', () => {
  const preflight = preflightEditorTimeline(timeline)
  assert.equal(preflight.canExport, true)
  assert.equal(preflight.totalDurationSeconds, 5.2)
  assert.ok(preflight.warnings.some((warning) => warning.code === 'edl_still_slate'))

  const fcpxml = renderFcpxml110(timeline)
  assert.match(fcpxml, /<fcpxml version="1.10">/)
  assert.match(fcpxml, /duration="130\/25s"/)
  assert.match(fcpxml, /src="media\/shot-1.mp4"/)
  assert.doesNotMatch(fcpxml, /\/workspace\//)

  const edl = renderCmx3600Edl(timeline)
  assert.match(edl.content, /001  SSHOT100 V     C        00:00:01:00 00:00:03:00 00:00:00:00 00:00:02:00/)
  assert.match(edl.content, /002  SSHOT200 V     C        00:00:00:00 00:00:03:05 00:00:02:00 00:00:05:05/)
  assert.ok(edl.warnings.some((warning) => warning.code === 'edl_flattened'))
  assert.ok(edl.warnings.some((warning) => warning.code === 'transition_degraded'))

  assert.match(renderSrt(timeline), /00:00:00,000 --> 00:00:02,000/)
  assert.match(renderSrt(timeline), /门外没有人。/)
  assert.match(renderEditorMediaCsv(timeline), /clipId,shotId,name,mediaKind/)
})

test('offline review manifest rejects traversal and HTML keeps production-only data out', () => {
  const manifest: ReviewPackageManifest = {
    format: 'dramaip-review',
    version: 1,
    packageId: 'package-1',
    projectId: 'project-1',
    adaptationProjectId: 'adaptation-1',
    episodeId: 'episode-1',
    title: '<样片>',
    createdAt: '2026-07-28T00:00:00.000Z',
    media: [{
      id: 'media-1',
      shotId: 'shot-1',
      orderIndex: 0,
      label: '镜头 1',
      relativePath: 'media/shot-1.mp4',
      mimeType: 'video/mp4',
      durationSeconds: 2,
    }],
  }
  assert.deepEqual(validateReviewPackageManifest(manifest), [])
  const html = renderOfflineReviewHtml(manifest)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /&lt;样片&gt;/)
  assert.doesNotMatch(html, /apiKey|sourcePrompt|novelText/)

  const malicious = structuredClone(manifest)
  malicious.media[0].relativePath = '../master.mp4'
  assert.ok(validateReviewPackageManifest(malicious).some((issue) => issue.includes('路径不安全')))
})
