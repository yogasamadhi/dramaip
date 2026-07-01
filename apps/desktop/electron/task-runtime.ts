import type { LongTaskKind } from '@sdns/core'

interface RuntimeEntry {
  kind: LongTaskKind
  controller: AbortController
}

const DEFAULT_LIMITS: Record<LongTaskKind, number> = {
  ai: 1,
  video: 1,
}

const running = new Map<string, RuntimeEntry>()

export interface BeginLongTaskRunResult {
  ok: boolean
  error?: string
  signal?: AbortSignal
}

export function beginLongTaskRun(kind: LongTaskKind, id: string): BeginLongTaskRunResult {
  const limit = DEFAULT_LIMITS[kind]
  const active = [...running.values()].filter((entry) => entry.kind === kind).length
  if (active >= limit) {
    return { ok: false, error: `${kind === 'ai' ? 'AI' : '视频'}任务正在运行，请稍后再试。` }
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

export function longTaskConcurrencyLimit(kind: LongTaskKind): number {
  return DEFAULT_LIMITS[kind]
}
