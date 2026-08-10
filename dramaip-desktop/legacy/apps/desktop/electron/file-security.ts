import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

export type FileImportKind = 'projectPackage' | 'caseStudyDocument' | 'sourceDocument' | 'videoAsset' | 'audioAsset' | 'rightsEvidence'

export interface FileImportPolicy {
  label: string
  allowedExtensions: readonly string[]
  maxBytes: number
  maxTextChars?: number
}

export interface TruncatedText {
  text: string
  truncated: boolean
}

export interface RemoteImportResource {
  url: string
  ext?: string
  contentType?: string
  contentLength?: number
}

const MB = 1024 * 1024

export const FILE_IMPORT_POLICIES: Record<FileImportKind, FileImportPolicy> = {
  projectPackage: {
    label: '项目包',
    allowedExtensions: ['.sdnspkg', '.json'],
    maxBytes: 20 * MB,
  },
  caseStudyDocument: {
    label: '样本文档',
    allowedExtensions: ['.md', '.txt', '.docx'],
    maxBytes: 10 * MB,
    maxTextChars: 80_000,
  },
  sourceDocument: {
    label: '小说或剧本文稿',
    allowedExtensions: ['.txt', '.md', '.markdown', '.docx', '.epub', '.json'],
    // 源文件只会在主进程读取；压缩文档还会逐条限制解压后的 entry 大小。
    maxBytes: 30 * MB,
    maxTextChars: 1_500_000,
  },
  videoAsset: {
    label: '视频素材',
    allowedExtensions: ['.mp4', '.webm', '.mov', '.m4v', '.jpg', '.jpeg', '.png', '.webp'],
    maxBytes: 300 * MB,
  },
  audioAsset: {
    label: '音频素材',
    allowedExtensions: ['.mp3', '.opus', '.aac', '.flac', '.wav', '.pcm', '.m4a'],
    maxBytes: 50 * MB,
  },
  rightsEvidence: {
    label: '授权证明',
    allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.md', '.docx'],
    maxBytes: 50 * MB,
  },
}

export function getFileImportPolicy(kind: FileImportKind): FileImportPolicy {
  return FILE_IMPORT_POLICIES[kind]
}

export function allowedExtensionsFor(kind: FileImportKind): string[] {
  return [...getFileImportPolicy(kind).allowedExtensions]
}

export function extensionForPath(path: string): string {
  return extname(path).toLowerCase()
}

export function assertAllowedExtension(kind: FileImportKind, pathOrName: string): string {
  const policy = getFileImportPolicy(kind)
  const ext = extensionForPath(pathOrName)
  if (!policy.allowedExtensions.includes(ext)) {
    throw new Error(`${policy.label}仅支持 ${policy.allowedExtensions.join(' / ')} 文件：${basename(pathOrName)}`)
  }
  return ext
}

export function assertAllowedSize(kind: FileImportKind, byteLength: number, name = getFileImportPolicy(kind).label): void {
  const policy = getFileImportPolicy(kind)
  if (!Number.isFinite(byteLength) || byteLength < 0) {
    throw new Error(`${policy.label}大小异常：${name}`)
  }
  if (byteLength > policy.maxBytes) {
    throw new Error(`${policy.label}过大：${name} ${(byteLength / MB).toFixed(1)}MB，限制 ${(policy.maxBytes / MB).toFixed(0)}MB`)
  }
}

export async function assertReadableImportFile(kind: FileImportKind, filePath: string): Promise<void> {
  assertAllowedExtension(kind, filePath)
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error(`${getFileImportPolicy(kind).label}必须是普通文件：${basename(filePath)}`)
  assertAllowedSize(kind, info.size, basename(filePath))
}

export function truncateImportedText(kind: FileImportKind, rawText: string): TruncatedText {
  const limit = getFileImportPolicy(kind).maxTextChars
  if (!limit || rawText.length <= limit) return { text: rawText, truncated: false }
  return { text: rawText.slice(0, limit), truncated: true }
}

export function assertRemoteImportResource(kind: FileImportKind, resource: RemoteImportResource): string {
  const policy = getFileImportPolicy(kind)
  const ext = (resource.ext ?? extensionForPath(new URL(resource.url).pathname)).toLowerCase()
  if (!policy.allowedExtensions.includes(ext)) {
    const contentType = resource.contentType ? `（${resource.contentType}）` : ''
    throw new Error(`${policy.label}远程资源类型不支持：${ext || '未知扩展名'}${contentType}`)
  }
  if (resource.contentLength !== undefined) assertAllowedSize(kind, resource.contentLength, resource.url)
  return ext
}
