import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { TtsAssetArchiver } from '@sdns/ai'
import { projectAssetKindDir, projectAssetRelativePath, safeAssetFileName } from './asset-library'
import { assertAllowedSize } from './file-security'

/** Archives generated TTS bytes before an asset record is written. */
export function createTtsAssetArchiver(): TtsAssetArchiver {
  return async ({ projectId, task, result, kind }) => {
    const extension = extensionForMimeType(result.mimeType)
    const bytes = decodeBase64Audio(result.b64Audio)
    const fileName = safeAssetFileName(`openai-tts-${task.id.slice(0, 8)}${extension}`)
    const assetKind = kind === 'dialogue' ? 'dialogue_audio' : 'narration_audio'
    const directory = projectAssetKindDir(app.getPath('userData'), projectId, assetKind)
    const localPath = join(directory, `${randomUUID()}-${fileName}`)
    await mkdir(directory, { recursive: true })
    await writeFile(localPath, bytes)
    return {
      localPath,
      relativePath: projectAssetRelativePath(projectId, assetKind, localPath.split(/[\\/]/).at(-1) ?? fileName),
      originalName: fileName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
    }
  }
}

function decodeBase64Audio(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) throw new Error('TTS Provider 返回的 base64 内容无效')
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length) throw new Error('TTS Provider 返回空内容')
  assertAllowedSize('audioAsset', bytes.byteLength, '生成音频')
  return bytes
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'audio/opus') return '.opus'
  if (mimeType === 'audio/aac') return '.aac'
  if (mimeType === 'audio/flac') return '.flac'
  if (mimeType === 'audio/wav') return '.wav'
  if (mimeType === 'audio/pcm') return '.pcm'
  return '.mp3'
}
