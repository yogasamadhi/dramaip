import { join, basename, extname } from 'node:path'
import type { ProjectAssetKind } from '@sdns/core'

export const ASSET_ROOT = 'assets'
export const PROJECT_ASSET_LIBRARY_DIR = 'library'

export function projectAssetRoot(userDataPath: string, projectId: string): string {
  return join(userDataPath, ASSET_ROOT, 'projects', safeAssetSegment(projectId), PROJECT_ASSET_LIBRARY_DIR)
}

export function projectAssetKindDir(userDataPath: string, projectId: string, kind: ProjectAssetKind): string {
  return join(projectAssetRoot(userDataPath, projectId), safeAssetSegment(kind))
}

export function projectAssetRelativePath(projectId: string, kind: ProjectAssetKind, fileName: string): string {
  return join('projects', safeAssetSegment(projectId), PROJECT_ASSET_LIBRARY_DIR, safeAssetSegment(kind), safeAssetFileName(fileName))
}

export function safeAssetFileName(fileName: string): string {
  const ext = extname(fileName).toLowerCase()
  const stem = basename(fileName, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'asset'
  return `${stem}${ext && ext.length <= 8 ? ext : ''}`
}

export function safeAssetSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96) || 'unknown'
}
