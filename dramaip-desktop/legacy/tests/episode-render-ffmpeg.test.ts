import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BUILT_IN_COMPLIANCE_RULE_PROFILES, buildEpisodeRenderPlan, type AnimaticDraft, type AudioTrack, type ComplianceRuleProfile, type Shot } from '../packages/core/src'
import { discoverEpisodeFfmpeg, renderEpisodeFiles, type EpisodeRenderAudioSource } from '../apps/desktop/electron/episode-render'
import { inspectEpisodeMedia } from '../apps/desktop/electron/episode-quality'
import { renderCompliantEpisode } from '../apps/desktop/electron/episode-compliance'

test('bundled/local FFmpeg renderer archives vertical MP4, subtitles, audio mix and manifest', async (t) => {
  const ffmpegPath = await discoverEpisodeFfmpeg()
  if (!ffmpegPath) return t.skip('FFmpeg is not installed on this test host')
  const directory = await mkdtemp(join(tmpdir(), 'sdns-episode-render-'))
  try {
    const imagePath = join(directory, 'still.png')
    const audioPath = join(directory, 'dialogue.wav')
    await run(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180', '-frames:v', '1', imagePath])
    await run(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1.2', '-c:a', 'pcm_s16le', audioPath])
    const animatic = {
      id: 'a1', projectId: 'p1', adaptationProjectId: 'ap1', episodeId: 'e1', versionNumber: 1, status: 'approved', sourceFingerprint: 's1@1', annotations: [], createdAt: '', updatedAt: '',
      clips: [{ id: 'c1', shotId: 's1', orderIndex: 0, durationSeconds: 1.2, transition: 'fade', crop: { zoom: 1, x: 0, y: 0 }, assetId: 'image-1' }],
    } as AnimaticDraft
    const plan = buildEpisodeRenderPlan({
      animatic,
      shots: [{ id: 's1', dialogue: '测试字幕', updatedAt: '1' }] as Shot[],
      audioTracks: [{ id: 't1', kind: 'dialogue', label: '对白', status: 'adopted', versionNumber: 1, sourceFingerprint: 's1@1', clips: [] } as AudioTrack],
      resolveVisualSource: () => ({ kind: 'still', sourceId: 'image-1', localPath: imagePath, label: '静帧' }),
    })
    const audio: EpisodeRenderAudioSource = {
      trackKind: 'dialogue',
      clip: { id: 'clip-a', assetId: 'audio-1', startSeconds: 0, durationSeconds: 1.2, volume: 1, fadeInSeconds: 0.05, fadeOutSeconds: 0.05, loop: false, duckingIntent: false },
      asset: { id: 'audio-1', projectId: 'p1', kind: 'dialogue_audio', title: '对白', localPath: audioPath, tags: [], metadata: {}, status: 'available', packagePolicy: 'include_binary', createdAt: '', updatedAt: '' },
    }
    const archive = await renderEpisodeFiles({ ffmpegPath, projectId: 'p1', taskId: 'task-1', plan, audioClips: [audio], signal: new AbortController().signal, directory: join(directory, 'delivery') })
    assert.ok((await stat(archive.mp4Path)).size > 1_000)
    assert.ok((await stat(archive.srtPath)).size > 0)
    assert.ok((await stat(archive.vttPath)).size > 0)
    assert.ok((await stat(archive.audioPath)).size > 1_000)
    assert.ok((await stat(archive.manifestPath)).size > 0)
    const inspection = await inspectEpisodeMedia(ffmpegPath, archive.mp4Path, new AbortController().signal)
    assert.equal(inspection.readable, true)
    assert.equal(inspection.width, 720)
    assert.equal(inspection.height, 1280)
    assert.equal(inspection.hasVideo, true)
    assert.equal(inspection.hasAudio, true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('compliance transcode writes mandatory visible labeling pipeline and verified hidden AIGC metadata', async (t) => {
  const ffmpegPath = await discoverEpisodeFfmpeg()
  if (!ffmpegPath) return t.skip('FFmpeg is not installed on this test host')
  const directory = await mkdtemp(join(tmpdir(), 'sdns-episode-compliance-'))
  try {
    const sourceMp4Path = join(directory, 'source.mp4')
    await run(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=navy:s=720x1280:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourceMp4Path])
    const profile: ComplianceRuleProfile = { ...BUILT_IN_COMPLIANCE_RULE_PROFILES[0], createdAt: '', updatedAt: '' }
    const archive = await renderCompliantEpisode({
      ffmpegPath,
      sourceMp4Path,
      taskId: 'compliance-task-1',
      sourceFingerprint: 'render-fingerprint@1',
      profile,
      visibleLabel: profile.requiredVisibleLabel,
      metadata: {
        'sdns:aigc': 'true',
        'sdns:rule-profile': profile.version,
        'sdns:source-fingerprint': 'render-fingerprint@1',
        'sdns:subtitle-language': 'zh-CN',
        title: '合规样本',
      },
      contentRecord: {
        userAigcDeclaration: true,
        text: { subtitleLanguage: 'zh-CN', contentMarker: 'sdns:aigc' },
        images: [{ assetId: 'image-1', kind: 'first_frame_image', title: '关键帧', aiGenerated: true, provider: 'fixture', rightsStatus: 'verified' }],
        audio: [{ assetId: 'audio-1', kind: 'dialogue_audio', title: '对白', aiGenerated: null, rightsStatus: 'verified' }],
        video: [{ assetId: 'video-1', kind: 'video_result', title: '视频', aiGenerated: true, provider: 'fixture', contentMarker: 'source-1', rightsStatus: 'verified' }],
        finalFile: { contentMarker: 'SDNS-AIGC', metadataKeys: ['sdns:aigc'] },
      },
      signal: new AbortController().signal,
      directory: join(directory, 'compliance'),
    })
    assert.ok((await stat(archive.mp4Path)).size > 1_000)
    const manifest = JSON.parse(await readFile(archive.manifestPath, 'utf8')) as { explicitLabel?: string; hiddenMetadata?: Record<string, string>; contentDeclaration?: { finalFile?: { contentMarker?: string } } }
    assert.equal(manifest.explicitLabel, 'AI Generated')
    assert.equal(manifest.hiddenMetadata?.['sdns:aigc'], 'true')
    assert.equal(manifest.hiddenMetadata?.['sdns:rule-profile'], profile.version)
    assert.equal(manifest.contentDeclaration?.finalFile?.contentMarker, 'SDNS-AIGC')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ['-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4_000) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr)))
  })
}
