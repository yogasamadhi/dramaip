import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { arch, cpus, freemem, homedir, platform, release, totalmem, type } from 'node:os'
import type { DatabaseMigrationInfo } from './db'

export const DIAGNOSTIC_PACKAGE_FORMAT = 'sdns-diagnostic-package'
export const DIAGNOSTIC_PACKAGE_VERSION = 1

const MAX_RECENT_LOG_LINES = 300
const MAX_RECENT_ERRORS = 40
const MAX_INCLUDED_TEXT_CHARS = 2_000
const MAX_SAFE_TEXT_CHARS = 600

const SENSITIVE_KEY = /(api[-_]?key|authorization|token|secret|password|credential|cookie|session)/i
const CONTENT_KEY = /(prompt|content|document|raw|text|chatHistory|userInstruction|templateContent|input|output|body|正文|script|chapter)/i
const STACK_KEY = /^stack$/i

export interface DiagnosticExportOptions {
  includeContent?: boolean
}

export interface DiagnosticPackageInput {
  appName: string
  appVersion: string
  userDataPath: string
  dbPath: string
  migration: DatabaseMigrationInfo
  logFilePaths: string[]
  includeContent?: boolean
  now?: Date
}

export interface DiagnosticLogFileInfo {
  fileName: string
  path: string
  sizeBytes: number
  modifiedAt: string
}

export interface DiagnosticLogEntry {
  ts?: string
  level: string
  scope?: string
  message?: unknown
  meta?: unknown
  raw?: string
}

export interface DiagnosticPackage {
  meta: {
    format: typeof DIAGNOSTIC_PACKAGE_FORMAT
    version: typeof DIAGNOSTIC_PACKAGE_VERSION
    exportedAt: string
    includeContent: boolean
  }
  app: {
    name: string
    version: string
  }
  system: {
    platform: NodeJS.Platform
    type: string
    release: string
    arch: string
    cpuCount: number
    totalMemoryMb: number
    freeMemoryMb: number
    locale?: string
    timeZone?: string
    versions: {
      electron?: string
      chrome?: string
      node: string
      v8: string
    }
  }
  database: {
    path: string
    exists: boolean
    sizeBytes?: number
    migration: DatabaseMigrationInfo
  }
  paths: {
    userData: string
  }
  logs: {
    files: DiagnosticLogFileInfo[]
    recent: DiagnosticLogEntry[]
    recentErrors: DiagnosticLogEntry[]
  }
}

interface SafeFileStat {
  size: number
  mtime: Date
}

export function createDiagnosticFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('')
  return `short-drama-novel-studio-diagnostic-${stamp}.sdnsdiag.json`
}

export function serializeDiagnosticPackage(pkg: DiagnosticPackage): string {
  return JSON.stringify(pkg, null, 2)
}

export function createDiagnosticPackage(input: DiagnosticPackageInput): DiagnosticPackage {
  const includeContent = input.includeContent === true
  const exportedAt = (input.now ?? new Date()).toISOString()
  const logs = collectDiagnosticLogs(input.logFilePaths, { includeContent })
  const dbStat = safeFileStat(input.dbPath)
  const intl = Intl.DateTimeFormat().resolvedOptions()

  return {
    meta: {
      format: DIAGNOSTIC_PACKAGE_FORMAT,
      version: DIAGNOSTIC_PACKAGE_VERSION,
      exportedAt,
      includeContent,
    },
    app: {
      name: input.appName,
      version: input.appVersion,
    },
    system: {
      platform: platform(),
      type: type(),
      release: release(),
      arch: arch(),
      cpuCount: cpus().length,
      totalMemoryMb: bytesToMb(totalmem()),
      freeMemoryMb: bytesToMb(freemem()),
      locale: intl.locale,
      timeZone: intl.timeZone,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        v8: process.versions.v8,
      },
    },
    database: {
      path: redactHomePath(input.dbPath),
      exists: dbStat !== undefined,
      sizeBytes: dbStat?.size,
      migration: input.migration,
    },
    paths: {
      userData: redactHomePath(input.userDataPath),
    },
    logs,
  }
}

export function collectDiagnosticLogs(
  logFilePaths: string[],
  options: DiagnosticExportOptions = {},
): DiagnosticPackage['logs'] {
  const files = logFilePaths.flatMap((path) => {
    const stat = safeFileStat(path)
    if (!stat) return []
    return [
      {
        fileName: basename(path),
        path: redactHomePath(path),
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      },
    ]
  })

  const recent = readRecentLines(logFilePaths, MAX_RECENT_LOG_LINES).map((line) =>
    parseDiagnosticLogLine(line, options),
  )
  const recentErrors = recent
    .filter((entry) => entry.level === 'error')
    .slice(-MAX_RECENT_ERRORS)

  return { files, recent, recentErrors }
}

export function redactDiagnosticValue(
  value: unknown,
  options: DiagnosticExportOptions = {},
  keyHint = '',
): unknown {
  if (value == null) return value

  if (SENSITIVE_KEY.test(keyHint)) return '***'

  if (typeof value === 'string') {
    const masked = maskSecrets(value)
    if (STACK_KEY.test(keyHint)) return stackFrames(masked)
    if (CONTENT_KEY.test(keyHint)) {
      return options.includeContent ? truncateText(masked, MAX_INCLUDED_TEXT_CHARS) : textMetadata(masked)
    }
    if (!options.includeContent && looksLikeLongFreeText(masked)) return textMetadata(masked)
    return truncateText(masked, MAX_INCLUDED_TEXT_CHARS)
  }

  if (Array.isArray(value)) {
    if (CONTENT_KEY.test(keyHint) && !options.includeContent) {
      return `[redacted list metadata: ${value.length} items]`
    }
    return value.slice(0, 80).map((item) => redactDiagnosticValue(item, options, keyHint))
  }

  if (typeof value === 'object') {
    if (CONTENT_KEY.test(keyHint) && !options.includeContent) return '[redacted object metadata]'
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactDiagnosticValue(item, options, key)
    }
    return out
  }

  return value
}

function parseDiagnosticLogLine(line: string, options: DiagnosticExportOptions): DiagnosticLogEntry {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    const level = typeof parsed['level'] === 'string' ? parsed['level'] : 'unknown'
    return {
      ts: typeof parsed['ts'] === 'string' ? parsed['ts'] : undefined,
      level,
      scope: typeof parsed['scope'] === 'string' ? parsed['scope'] : undefined,
      message: redactDiagnosticValue(parsed['message'], options, 'message'),
      meta: redactDiagnosticValue(parsed['meta'], options, 'meta'),
    }
  } catch {
    const raw = redactRawLogLine(line, options)
    return {
      level: 'unknown',
      raw,
      message: raw,
    }
  }
}

function readRecentLines(paths: string[], maxLines: number): string[] {
  const lines = paths.flatMap((path) => {
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  })
  return lines.slice(-maxLines)
}

function safeFileStat(path: string): SafeFileStat | undefined {
  try {
    const stat = statSync(path, { bigint: false })
    return { size: stat.size, mtime: stat.mtime }
  } catch {
    return undefined
  }
}

function redactRawLogLine(line: string, options: DiagnosticExportOptions): string {
  let value = maskSecrets(line)
  if (!options.includeContent) {
    value = value.replace(
      /"([^"]*(?:prompt|content|document|raw|text|chatHistory|userInstruction|templateContent|input|output|body|chapter|script)[^"]*)"\s*:\s*"([^"\\]|\\.)*"/gi,
      (_match, key) => `"${key}":"${textMetadata(line)}"`,
    )
  }
  if (!options.includeContent && looksLikeLongFreeText(value)) return textMetadata(value)
  return truncateText(value, MAX_INCLUDED_TEXT_CHARS)
}

function maskSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer ***')
    .replace(
      /((?:api[-_]?key|authorization|token|secret|password|credential|cookie|session)\s*[:=]\s*)["']?[^"',\s}]+/gi,
      '$1***',
    )
    .replace(/((?:密码|口令)\s*[:：=]\s*)\S+/g, '$1***')
}

function stackFrames(value: string): string[] {
  return value
    .split('\n')
    .slice(0, 8)
    .map((line) => line.trim())
    .filter(Boolean)
}

function textMetadata(value: string): string {
  return `[redacted text metadata: ${value.length} chars]`
}

function looksLikeLongFreeText(value: string): boolean {
  return value.length > MAX_SAFE_TEXT_CHARS || value.includes('\n')
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]`
}

function bytesToMb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024)
}

function redactHomePath(path: string): string {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
