import { app } from 'electron'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { VideoAssetArchiveResult, VideoAssetArchiver } from '@sdns/ai'
import type { VideoProviderConfig } from '@sdns/core'

interface ArchivedResource {
  localPath?: string
  localUrl?: string
  error?: string
}

const ASSET_ROOT = 'assets'

export function createVideoAssetArchiver(): VideoAssetArchiver {
  return async ({ providerConfig, task, result }) => {
    const dir = join(
      app.getPath('userData'),
      ASSET_ROOT,
      'projects',
      safeSegment(task.projectId ?? 'unassigned'),
      'video-results',
      safeSegment(task.id),
    )
    await mkdir(dir, { recursive: true })

    const video = await archiveResource({
      url: result.resultVideoUrl,
      providerConfig,
      dir,
      stem: 'result',
      fallbackExt: '.mp4',
    })
    const cover = result.coverImageUrl
      ? await archiveResource({
          url: result.coverImageUrl,
          providerConfig,
          dir,
          stem: 'cover',
          fallbackExt: '.jpg',
        })
      : undefined
    const archiveError = [video.error, cover?.error].filter(Boolean).join('; ') || undefined
    const archivedAt = video.localPath || cover?.localPath ? new Date().toISOString() : undefined

    return {
      resultVideoUrl: video.localUrl ?? result.resultVideoUrl,
      remoteVideoUrl: result.resultVideoUrl,
      localVideoPath: video.localPath,
      coverImageUrl: cover?.localUrl ?? result.coverImageUrl,
      remoteCoverImageUrl: result.coverImageUrl,
      localCoverImagePath: cover?.localPath,
      archivedAt,
      archiveError,
    } satisfies VideoAssetArchiveResult
  }
}

async function archiveResource(input: {
  url: string
  providerConfig: VideoProviderConfig
  dir: string
  stem: string
  fallbackExt: string
}): Promise<ArchivedResource> {
  try {
    const parsed = new URL(input.url)
    if (parsed.protocol === 'file:') {
      return copyLocalFile(fileURLToPath(parsed), input.dir, input.stem, extname(parsed.pathname) || input.fallbackExt)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: `不支持归档协议：${parsed.protocol}` }
    }
    const res = await fetch(input.url, { headers: authHeaders(input.providerConfig, input.url) })
    if (!res.ok) return { error: `下载失败 HTTP ${res.status}` }
    const contentType = res.headers.get('content-type') ?? undefined
    const ext = extensionFromUrl(input.url) || extensionFromContentType(contentType) || input.fallbackExt
    const localPath = join(input.dir, `${input.stem}${ext}`)
    await writeFile(localPath, Buffer.from(await res.arrayBuffer()))
    return { localPath, localUrl: pathToFileURL(localPath).toString() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function copyLocalFile(source: string, dir: string, stem: string, ext: string): Promise<ArchivedResource> {
  const localPath = join(dir, `${stem}${ext}`)
  await copyFile(source, localPath)
  return { localPath, localUrl: pathToFileURL(localPath).toString() }
}

function authHeaders(config: VideoProviderConfig, url: string): Record<string, string> {
  if (config.kind !== 'openai_sora' || !config.apiKey) return {}
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'api.openai.com') return {}
    return { Authorization: `Bearer ${config.apiKey}` }
  } catch {
    return {}
  }
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase()
    return ext && ext.length <= 8 ? ext : undefined
  } catch {
    return undefined
  }
}

function extensionFromContentType(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined
  if (contentType.includes('mp4')) return '.mp4'
  if (contentType.includes('webm')) return '.webm'
  if (contentType.includes('quicktime')) return '.mov'
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('webp')) return '.webp'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg'
  return undefined
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'unknown'
}
