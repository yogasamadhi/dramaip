import { createApiClient } from '@dramaip/sdk'
import type { AxiosRequestConfig } from 'axios'

declare module 'axios' {
  interface AxiosRequestConfig {
    __dramaipRetry?: boolean
    __dramaipSkipRefresh?: boolean
  }
}

export const DEVICE_ID_STORAGE_KEY = 'dramaip.device_id'
const CSRF_COOKIE_NAME = 'dramaip_web_csrf'
// An empty value intentionally means the current Web origin.  In local
// development run-platform.py configures a server-side rewrite to the Java
// Gateway; in deployment the ingress routes /api/v1 itself. This keeps Cookie sessions and
// LAN development on one browser origin.
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''

if (typeof window !== 'undefined') {
  // Cookie migration intentionally invalidates obsolete JavaScript-readable
  // credentials instead of attempting an unsafe token handoff.
  window.localStorage.removeItem('dramaip.access_token')
  window.localStorage.removeItem('dramaip.refresh_token')
}

export const apiClient = createApiClient({
  baseURL: API_BASE_URL,
  withCredentials: true,
  getDeviceID,
  getCSRFToken,
  webSession: true,
})

export function getDeviceID() {
  if (typeof window === 'undefined') return undefined
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing) return existing
  const generated = typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated)
  return generated
}

export function getCSRFToken() {
  if (typeof document === 'undefined') return undefined
  const prefix = `${CSRF_COOKIE_NAME}=`
  const value = document.cookie.split('; ').find((item) => item.startsWith(prefix))?.slice(prefix.length)
  return value ? decodeURIComponent(value) : undefined
}

/**
 * The readable CSRF cookie is issued together with the HttpOnly Web session
 * cookies. It lets public pages avoid an expected unauthenticated probe.
 */
export function hasWebSessionMarker() {
  return Boolean(getCSRFToken())
}

let refreshInFlight: Promise<void> | undefined

async function sessionCookieIsValid() {
  try {
    await apiClient.http.get('/api/v1/auth/session', { __dramaipSkipRefresh: true })
    return true
  } catch {
    return false
  }
}

async function refreshWebSession() {
  if (refreshInFlight) return refreshInFlight
  const rotateIfNeeded = async () => {
    if (await sessionCookieIsValid()) return
    await apiClient.refresh()
  }
  const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks
  refreshInFlight = lockManager
    ? lockManager.request('dramaip-web-refresh', rotateIfNeeded)
    : rotateIfNeeded()
  try {
    await refreshInFlight
  } finally {
    refreshInFlight = undefined
  }
}

apiClient.http.interceptors.response.use(
  (response) => response,
  async (error) => {
    const response = error?.response
    const config = error?.config
    if (
      typeof window === 'undefined' ||
      response?.status !== 401 ||
      !config ||
      config.__dramaipRetry ||
      config.__dramaipSkipRefresh ||
      String(config.url ?? '').includes('/auth/refresh') ||
      String(config.url ?? '').includes('/auth/logout')
    ) {
      throw error
    }

    // A Web session always includes the readable half of the double-submit
    // token. Without it there is no safe way to rotate a Cookie session.
    if (!getCSRFToken()) {
      throw error
    }

    try {
      config.__dramaipRetry = true
      await refreshWebSession()
      return apiClient.http.request(config)
    } catch (refreshError) {
      throw refreshError
    }
  },
)
