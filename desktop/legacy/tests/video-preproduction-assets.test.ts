import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProjectAsset } from '../packages/core/src'
import { assetFieldsFromReference, isVideoReferenceImageAsset } from '../apps/desktop/renderer/src/lib/assets'

function asset(kind: ProjectAsset['kind'], reference: string, mimeType?: string): ProjectAsset {
  const fields = assetFieldsFromReference(reference)
  return {
    id: `${kind}-1`,
    projectId: 'p1',
    kind,
    title: kind,
    remoteUrl: fields.remoteUrl,
    localPath: fields.localPath,
    mimeType: mimeType ?? fields.mimeType,
    tags: [],
    metadata: {},
    status: fields.status ?? 'available',
    packagePolicy: 'reference_only',
    createdAt: '',
    updatedAt: '',
  }
}

test('classifies video preproduction assets for reference image submission', () => {
  assert.equal(isVideoReferenceImageAsset(asset('casting_reference', 'https://asset.example.test/cast.png')), true)
  assert.equal(isVideoReferenceImageAsset(asset('first_frame_image', '/tmp/first-frame.webp')), true)
  assert.equal(isVideoReferenceImageAsset(asset('cover_image', 'https://asset.example.test/signed-cover')), true)

  assert.equal(isVideoReferenceImageAsset(asset('voice_reference', 'https://asset.example.test/voice.mp3')), false)
  assert.equal(isVideoReferenceImageAsset(asset('narration_audio', '/tmp/narration.wav')), false)
  assert.equal(isVideoReferenceImageAsset(asset('subtitle_file', '/tmp/subtitle.srt')), false)
  assert.equal(isVideoReferenceImageAsset(asset('source_media', '/tmp/source.mp4')), false)
})
