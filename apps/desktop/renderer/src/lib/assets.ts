import type { ProjectAsset } from '@sdns/core'

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

export function assetFieldsFromReference(reference: string): Pick<Partial<ProjectAsset>, 'localPath' | 'remoteUrl' | 'status'> {
  const trimmed = reference.trim()
  if (/^https?:\/\//i.test(trimmed)) return { remoteUrl: trimmed, status: 'remote_only' }
  if (trimmed) return { localPath: trimmed, status: 'available' }
  return { status: 'missing' }
}

export function assetReferenceUrl(asset: ProjectAsset): string | undefined {
  if (asset.remoteUrl) return asset.remoteUrl
  if (!asset.localPath) return undefined
  if (asset.localPath.startsWith('file://')) return asset.localPath
  if (asset.localPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(asset.localPath)) return fileUrlFromPath(asset.localPath)
  return asset.localPath
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
