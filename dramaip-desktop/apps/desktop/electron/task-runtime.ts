import type { LongTaskKind } from '@sdns/core'

interface RuntimeEntry {
  kind: LongTaskKind
  controller: AbortController
}

const DEFAULT_LIMITS: Record<LongTaskKind, number> = {
  ai: 1,
  image: 1,
  audio: 1,
  video: 1,
  batch: 1,
}

const running = new Map<string, RuntimeEntry>()
const retrying = new Set<string>()

export interface BeginLongTaskRunResult {
  ok: boolean
  error?: string
  signal?: AbortSignal
}

export function beginLongTaskRun(kind: LongTaskKind, id: string): BeginLongTaskRunResult {
  const limit = DEFAULT_LIMITS[kind]
  const active = [...running.values()].filter((entry) => entry.kind === kind).length
  if (active >= limit) {
    return { ok: false, error: `${longTaskKindLabel(kind)}任务正在运行，请稍后再试。` }
  }
  const controller = new AbortController()
  running.set(id, { kind, controller })
  return { ok: true, signal: controller.signal }
}

export function cancelLongTaskRun(id: string): boolean {
  const entry = running.get(id)
  if (!entry) return false
  entry.controller.abort(new Error('任务已取消'))
  return true
}

export function finishLongTaskRun(id: string): void {
  running.delete(id)
}

export function isLongTaskRunActive(id: string): boolean {
  return running.has(id)
}

/**
 * Claims the single retry slot for a persisted task. This closes the race where
 * two renderer clicks submit two independent retry jobs before either starts.
 */
export function beginLongTaskRetry(id: string): boolean {
  if (retrying.has(id)) return false
  retrying.add(id)
  return true
}

export function finishLongTaskRetry(id: string): void {
  retrying.delete(id)
}

export function longTaskConcurrencyLimit(kind: LongTaskKind): number {
  return DEFAULT_LIMITS[kind]
}

function longTaskKindLabel(kind: LongTaskKind): string {
  if (kind === 'ai') return 'AI'
  if (kind === 'image') return '图片'
  if (kind === 'audio') return '音频'
  if (kind === 'video') return '视频'
  return '批量'
}
