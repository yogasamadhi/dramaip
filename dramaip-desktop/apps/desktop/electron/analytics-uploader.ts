import type { Repositories } from '@sdns/db'
import { DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION } from './cloud-contract'
import { getDesktopBffOrigin } from './cloud-auth'

const ANALYTICS_UPLOAD_TIMEOUT_MS = 15_000
const ANALYTICS_UPLOAD_INTERVAL_MS = 60_000
const MAX_ANALYTICS_BATCH_SIZE = 100

interface AnalyticsUploadResponse {
  accepted_event_ids?: unknown
}

let uploadInFlight: Promise<number> | undefined

export async function flushProductAnalytics(repos: Repositories): Promise<number> {
  if (uploadInFlight) return uploadInFlight
  uploadInFlight = uploadPendingEvents(repos).finally(() => {
    uploadInFlight = undefined
  })
  return uploadInFlight
}

export function startProductAnalyticsUploader(getRepositories: () => Repositories): () => void {
  const flush = () => {
    try {
      void flushProductAnalytics(getRepositories()).catch(() => {
        // Network and configuration failures deliberately retain the local
        // queue for a later bounded retry. Payloads are never written to logs.
      })
    } catch {
      // The database may be unavailable during shutdown.
    }
  }
  const initial = setTimeout(flush, 5_000)
  initial.unref()
  const interval = setInterval(flush, ANALYTICS_UPLOAD_INTERVAL_MS)
  interval.unref()
  return () => {
    clearTimeout(initial)
    clearInterval(interval)
  }
}

async function uploadPendingEvents(repos: Repositories): Promise<number> {
  const settings = repos.productionStudio.getProductAnalyticsSettings(repos.db)
  if (settings.consent !== 'granted') return 0
  const events = repos.productionStudio
    .listPendingProductAnalyticsEvents(repos.db)
    .slice(0, MAX_ANALYTICS_BATCH_SIZE)
  if (!events.length) return 0

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ANALYTICS_UPLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(`${getDesktopBffOrigin()}/v1/desktop/analytics/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [DESKTOP_CONTRACT_HEADER]: DESKTOP_CONTRACT_VERSION,
      },
      body: JSON.stringify({
        events: events.map((event) => ({
          installation_id: settings.installationId,
          event_id: event.id,
          app_version: event.appVersion,
          operating_system: event.operatingSystem,
          event_name: event.eventName,
          duration_bucket: event.durationBucket ?? '',
          result_code: event.resultCode ?? '',
        })),
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`analytics upload failed (${response.status})`)
    const body = await response.json() as AnalyticsUploadResponse
    if (!Array.isArray(body.accepted_event_ids)) throw new Error('analytics upload response is invalid')
    const pendingIds = new Set(events.map((event) => event.id))
    const accepted = body.accepted_event_ids.filter(
      (id): id is string => typeof id === 'string' && pendingIds.has(id),
    )
    if (accepted.length !== events.length) throw new Error('analytics upload response is incomplete')
    return repos.productionStudio.markProductAnalyticsEventsUploaded(repos.db, accepted)
  } finally {
    clearTimeout(timeout)
  }
}
