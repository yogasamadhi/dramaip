export interface FetchRetryOptions {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  signal?: AbortSignal
}

export class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`HTTP ${status}: ${detail.slice(0, 500)}`)
  }
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout)
          reject(new Error('请求已取消'))
        },
        { once: true },
      )
    }
  })
}

function createAttemptSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`请求超时（${timeoutMs}ms）`)), timeoutMs)
  const abort = () => controller.abort(external?.reason ?? new Error('请求已取消'))
  external?.addEventListener('abort', abort, { once: true })
  controller.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(timeout)
      external?.removeEventListener('abort', abort)
    },
    { once: true },
  )
  return controller.signal
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const retries = options.retries ?? 2
  const retryDelayMs = options.retryDelayMs ?? 500

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: createAttemptSignal(timeoutMs, options.signal) })
      if (res.ok) return res

      const detail = await res.text().catch(() => '')
      if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) {
        throw new HttpRequestError(res.status, detail)
      }
      await delay(retryDelayMs * 2 ** attempt, options.signal)
    } catch (e) {
      lastError = e
      if (e instanceof HttpRequestError || attempt === retries) break
      await delay(retryDelayMs * 2 ** attempt, options.signal)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
