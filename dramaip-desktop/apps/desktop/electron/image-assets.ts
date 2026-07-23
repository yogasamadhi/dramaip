import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ImageAssetArchiver } from '@sdns/ai'
import { projectAssetKindDir, projectAssetRelativePath, safeAssetFileName } from './asset-library'
import { assertAllowedSize } from './file-security'

/** Archives generated image bytes before an asset/candidate record is written. */
export function createImageAssetArchiver(): ImageAssetArchiver {
  return async ({ projectId, task, result, index }) => {
    const extension = extensionForMimeType(result.mimeType)
    const bytes = decodeBase64Image(result.b64Json)
    const fileName = safeAssetFileName(`openai-image-${task.id.slice(0, 8)}-${index + 1}${extension}`)
    const kind = task.input?.kind === 'cover' ? 'cover_image' : 'first_frame_image'
    const directory = projectAssetKindDir(app.getPath('userData'), projectId, kind)
    const localPath = join(directory, `${randomUUID()}-${fileName}`)
    await mkdir(directory, { recursive: true })
    await writeFile(localPath, bytes)
    return {
      localPath,
      relativePath: projectAssetRelativePath(projectId, kind, localPath.split(/[\\/]/).at(-1) ?? fileName),
      originalName: fileName,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
    }
  }
}

function decodeBase64Image(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) throw new Error('图片 Provider 返回的 base64 内容无效')
  const bytes = Buffer.from(value, 'base64')
  if (!bytes.length) throw new Error('图片 Provider 返回空内容')
  assertAllowedSize('videoAsset', bytes.byteLength, '生成图片')
  return bytes
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  return '.png'
}
