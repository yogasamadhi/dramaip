import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildEpisodeRenderPlan, type AnimaticDraft, type AudioTrack, type Shot } from '../packages/core/src'
import { renderEpisodeFiles, type EpisodeRenderAudioSource } from '../apps/desktop/electron/episode-render'

const requireFromDesktop = createRequire(join(process.cwd(), 'apps/desktop/package.json'))
const bundledFfmpegPath = requireFromDesktop('ffmpeg-static') as string | null
const ffmpegPath = [bundledFfmpegPath, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']
  .find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))

test('bundled/local FFmpeg renderer archives vertical MP4, subtitles, audio mix and manifest', { skip: !ffmpegPath && 'FFmpeg is not installed on this test host' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sdns-episode-render-'))
  try {
    const imagePath = join(directory, 'still.png')
    const audioPath = join(directory, 'dialogue.wav')
    await run(ffmpegPath!, ['-y', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180', '-frames:v', '1', imagePath])
    await run(ffmpegPath!, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1.2', '-c:a', 'pcm_s16le', audioPath])
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
    const archive = await renderEpisodeFiles({ ffmpegPath: ffmpegPath!, projectId: 'p1', taskId: 'task-1', plan, audioClips: [audio], signal: new AbortController().signal, directory: join(directory, 'delivery') })
    assert.ok((await stat(archive.mp4Path)).size > 1_000)
    assert.ok((await stat(archive.srtPath)).size > 0)
    assert.ok((await stat(archive.vttPath)).size > 0)
    assert.ok((await stat(archive.audioPath)).size > 1_000)
    assert.ok((await stat(archive.manifestPath)).size > 0)
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
