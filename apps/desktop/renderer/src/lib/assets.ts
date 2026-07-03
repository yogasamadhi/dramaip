import type { ProjectAsset } from '@sdns/core'

export const ASSET_KIND_LABEL: Record<ProjectAsset['kind'], string> = {
  character_reference: '人物参考',
  casting_reference: '选角参考',
  voice_reference: '音色参考',
  scene_reference: '场景参考',
  style_reference: '风格参考',
  video_result: '视频结果',
  cover_image: '封面图',
  first_frame_image: '首帧图',
  narration_audio: '旁白音频',
  subtitle_file: '字幕文件',
  source_media: '源媒体',
  other: '其他',
}

export const ASSET_STATUS_LABEL: Record<ProjectAsset['status'], string> = {
  available: '可用',
  missing: '文件缺失',
  remote_only: '远端引用',
}

export const ASSET_STATUS_VARIANT: Record<ProjectAsset['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  available: 'default',
  missing: 'destructive',
  remote_only: 'outline',
}

export function assetFieldsFromReference(reference: string): Pick<Partial<ProjectAsset>, 'localPath' | 'remoteUrl' | 'status' | 'mimeType'> {
  const trimmed = reference.trim()
  const mimeType = inferMimeTypeFromReference(trimmed)
  if (/^https?:\/\//i.test(trimmed)) return { remoteUrl: trimmed, status: 'remote_only', mimeType }
  if (trimmed) return { localPath: trimmed, status: 'available', mimeType }
  return { status: 'missing' }
}

export function assetReferenceUrl(asset: ProjectAsset): string | undefined {
  if (asset.remoteUrl) return asset.remoteUrl
  if (!asset.localPath) return undefined
  if (asset.localPath.startsWith('file://')) return asset.localPath
  if (asset.localPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(asset.localPath)) return fileUrlFromPath(asset.localPath)
  return asset.localPath
}

export function isVideoReferenceImageAsset(asset: ProjectAsset): boolean {
  if (
    asset.kind !== 'character_reference' &&
    asset.kind !== 'casting_reference' &&
    asset.kind !== 'scene_reference' &&
    asset.kind !== 'style_reference' &&
    asset.kind !== 'cover_image' &&
    asset.kind !== 'first_frame_image' &&
    asset.kind !== 'source_media'
  ) {
    return false
  }
  if (asset.mimeType) return asset.mimeType.startsWith('image/')
  const reference = asset.remoteUrl ?? asset.localPath ?? asset.relativePath ?? ''
  if (!reference) return false
  if (/\.(mp4|mov|webm|mp3|wav|m4a|aac|srt|vtt|ass|ssa)(?:[?#].*)?$/i.test(reference)) return false
  return true
}

function inferMimeTypeFromReference(reference: string): string | undefined {
  const path = reference.split(/[?#]/)[0] ?? ''
  if (/\.(png)$/i.test(path)) return 'image/png'
  if (/\.(jpe?g)$/i.test(path)) return 'image/jpeg'
  if (/\.(webp)$/i.test(path)) return 'image/webp'
  if (/\.(gif)$/i.test(path)) return 'image/gif'
  if (/\.(avif)$/i.test(path)) return 'image/avif'
  if (/\.(mp3)$/i.test(path)) return 'audio/mpeg'
  if (/\.(wav)$/i.test(path)) return 'audio/wav'
  if (/\.(m4a)$/i.test(path)) return 'audio/mp4'
  if (/\.(aac)$/i.test(path)) return 'audio/aac'
  if (/\.(srt)$/i.test(path)) return 'application/x-subrip'
  if (/\.(vtt)$/i.test(path)) return 'text/vtt'
  if (/\.(ass|ssa)$/i.test(path)) return 'text/plain'
  return undefined
}

function fileUrlFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
  const encoded = normalized
    .split('/')
    .map((part, index) => (index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join('/')
  return prefix + encoded
}
