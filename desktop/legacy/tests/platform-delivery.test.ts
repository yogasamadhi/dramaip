import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILT_IN_PLATFORM_DELIVERY_PROFILES, evaluatePlatformDeliveryPreflight, safeFilename } from '../packages/core/src'
import { writePlatformDeliveryPackage } from '../apps/desktop/electron/platform-delivery'

function readyInput() {
  return {
    profile: BUILT_IN_PLATFORM_DELIVERY_PROFILES.find((profile) => profile.id.startsWith('douyin'))!,
    title: '真千金归来，先撕全家剧本',
    description: '被夺走人生的真千金带着证据回归，在第一集公开反击。',
    tags: ['反转', '女性成长'],
    hasCover: true,
    complianceCurrent: true,
    media: { width: 720, height: 1280, videoCodec: 'h264', audioCodec: 'aac' },
    manualFieldsConfirmed: true,
  }
}

test('delivery profiles declare locally-verifiable media and manual platform fields without guessing portal rules', () => {
  const douyin = BUILT_IN_PLATFORM_DELIVERY_PROFILES.find((profile) => profile.id.startsWith('douyin'))!
  const hongguo = BUILT_IN_PLATFORM_DELIVERY_PROFILES.find((profile) => profile.id.startsWith('hongguo'))!
  for (const profile of [douyin, hongguo]) {
    assert.equal(profile.sourceStatus, 'platform_portal')
    assert.equal(profile.video.width, 720)
    assert.equal(profile.video.height, 1280)
    assert.equal(profile.video.videoCodec, 'H.264')
    assert.equal(profile.video.audioCodec, 'AAC')
    assert.equal(profile.duration.status, 'manual')
    assert.ok(profile.subtitleSafeZone.bottomMarginPx > 0)
    assert.ok(profile.manualFields.length > 0)
  }
})

test('current compliant media plus adopted creative inputs produces a deterministic package plan', () => {
  const result = evaluatePlatformDeliveryPreflight(readyInput())
  assert.equal(result.ok, true)
  assert.equal(result.finalBaseName, 'douyin-真千金归来，先撕全家剧本')
  assert.ok(result.expectedFiles.includes('episode.mp4'))
  assert.ok(result.expectedFiles.includes('checksums.sha256'))
})

test('missing current compliance, cover, manual confirmation, or an invalid aspect ratio fails closed', () => {
  const result = evaluatePlatformDeliveryPreflight({
    ...readyInput(), complianceCurrent: false, hasCover: false, manualFieldsConfirmed: false,
    media: { width: 1280, height: 720 },
  })
  assert.equal(result.ok, false)
  assert.ok(result.blockers.some((blocker) => blocker.includes('合规 Gate')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('封面')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('人工核对')))
  assert.ok(result.blockers.some((blocker) => blocker.includes('720×1280')))
})

test('delivery filenames remain portable and keep a nonempty fallback', () => {
  assert.equal(safeFilename('  标题 / A:B?  '), '标题-_-A_B_')
  assert.equal(safeFilename('   '), 'untitled')
})

test('golden package keeps media, listing, evidence and checksums in one independent handoff directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sdns-platform-delivery-'))
  try {
    const source = join(root, 'source')
    const output = join(root, 'delivery-v001')
    await mkdir(source); await mkdir(output)
    const mp4 = join(source, 'episode.mp4'); const srt = join(source, 'episode.srt'); const vtt = join(source, 'episode.vtt')
    const cover = join(source, 'cover.jpg'); const compliance = join(source, 'compliance.json'); const quality = join(source, 'quality.json')
    await Promise.all([
      writeFile(mp4, 'fixture-mp4'), writeFile(srt, '1\n00:00:00,000 --> 00:00:01,000\n字幕\n'), writeFile(vtt, 'WEBVTT\n'),
      writeFile(cover, 'fixture-cover'), writeFile(compliance, '{"aigc":true}'), writeFile(quality, '{"quality":"pass"}'),
    ])
    const profile = BUILT_IN_PLATFORM_DELIVERY_PROFILES.find((item) => item.id.startsWith('douyin'))!
    const result = await writePlatformDeliveryPackage({
      directory: output, deliveryVersion: 1, profile,
      variant: { id: 'variant-1', projectId: 'p1', adaptationProjectId: 'a1', label: '方案 A', title: '归来反击', description: '第一集公开反击。', tags: ['反转'], coverAssetId: 'cover-1', source: 'manual', status: 'adopted', versionNumber: 2, createdAt: '', updatedAt: '' },
      compliance: { taskId: 'compliance-1', mp4Path: mp4, manifestPath: compliance }, render: { srtPath: srt, vttPath: vtt },
      quality: { report: { schemaVersion: 1, renderTaskId: 'render-1', renderSourceFingerprint: 'render@1', sourceFingerprint: 'quality@1', deliveryVersion: 'render-1', generatedAt: '', inspection: { readable: true }, issues: [], redoTargets: [], blockerCount: 0, warningCount: 0, limitations: [] }, reportPath: quality },
      coverPath: cover, sourceFingerprint: 'platform@1', manualFieldsConfirmed: true, rights: { status: 'pass' }, finalBaseName: 'douyin-归来反击',
    })
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as { files: Record<string, string>; checksums: Record<string, string>; note: string }
    const checksums = await readFile(result.checksumsPath, 'utf8')
    assert.equal(manifest.files.mp4, 'douyin-归来反击.mp4')
    assert.equal(manifest.files.srt, 'douyin-归来反击.srt')
    assert.equal(manifest.files.cover, 'douyin-归来反击-cover.jpg')
    assert.ok(manifest.files.compliance)
    assert.ok(manifest.files.rights)
    assert.ok(manifest.files.quality)
    assert.match(manifest.note, /不会登录、代投或自动发布/)
    for (const [name, expected] of Object.entries(manifest.checksums)) {
      const actual = `sha256:${createHash('sha256').update(await readFile(join(output, name))).digest('hex')}`
      assert.equal(actual, expected)
      assert.match(checksums, new RegExp(`${expected}  ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    }
    assert.match(checksums, /delivery-manifest\.json/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
