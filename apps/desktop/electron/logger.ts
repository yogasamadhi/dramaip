import { app } from 'electron'
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 2 * 1024 * 1024
const SENSITIVE_KEY = /(api[-_]?key|authorization|token|secret|password)/i
const CONTENT_KEY = /(prompt|content|document|raw|text|chatHistory|userInstruction|templateContent)/i
const DIAGNOSTIC_TEXT_KEY = /^(error|message|reason)$/i
const STACK_KEY = /^stack$/i

function summarizeText(value: string): string {
  return `[redacted text metadata: ${value.length} chars]`
}

function stackFrames(value: string): string[] {
  return value
    .split('\n')
    .slice(1, 8)
    .map((line) => line.trim())
    .filter(Boolean)
}

function maskSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer ***')
}

function sanitizeLogMessage(value: string): string {
  const masked = maskSecrets(value)
  if (masked.length > 200 || masked.includes('\n')) return summarizeText(masked)
  return masked
}

function logPath(): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'studio.log')
}

function rotateIfNeeded(path: string): void {
  if (!existsSync(path)) return
  if (statSync(path).size < MAX_LOG_BYTES) return
  const rotated = `${path}.1`
  if (existsSync(rotated)) unlinkSync(rotated)
  renameSync(path, rotated)
}

function redact(value: unknown, keyHint = ''): unknown {
  if (value == null) return value
  if (typeof value === 'string') {
    if (CONTENT_KEY.test(keyHint)) return summarizeText(value)
    if (DIAGNOSTIC_TEXT_KEY.test(keyHint)) return `[redacted diagnostic text: ${value.length} chars]`
    if (STACK_KEY.test(keyHint)) return stackFrames(value)
    return maskSecrets(value)
  }
  if (Array.isArray(value)) {
    if (CONTENT_KEY.test(keyHint)) return `[redacted list metadata: ${value.length} items]`
    return value.map((item) => redact(item, keyHint))
  }
  if (typeof value === 'object') {
    if (CONTENT_KEY.test(keyHint)) return '[redacted object metadata]'
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = '***'
      } else {
        out[key] = redact(item, key)
      }
    }
    return out
  }
  return value
}

export function writeLog(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  try {
    const path = logPath()
    rotateIfNeeded(path)
    const entry = {
      ts: new Date().toISOString(),
      level,
      scope,
      message: sanitizeLogMessage(message),
      meta: redact(meta),
    }
    appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8')
  } catch {
    // 日志失败不能影响主流程。
  }
}

export const logger = {
  debug: (scope: string, message: string, meta?: unknown) => writeLog('debug', scope, message, meta),
  info: (scope: string, message: string, meta?: unknown) => writeLog('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => writeLog('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => writeLog('error', scope, message, meta),
}

export function installProcessLoggers(): void {
  process.on('uncaughtException', (error) => {
    logger.error('main', 'uncaughtException', { message: error.message, stack: error.stack })
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('main', 'unhandledRejection', {
      reason: reason instanceof Error ? { message: reason.message, stack: reason.stack } : String(reason),
    })
  })
  app.on('render-process-gone', (_event, webContents, details) => {
    logger.error('main', 'render-process-gone', { url: webContents.getURL(), details })
  })
  app.on('child-process-gone', (_event, details) => {
    logger.error('main', 'child-process-gone', details)
  })
}
