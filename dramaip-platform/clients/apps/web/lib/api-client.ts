import { createApiClient } from '@dramaip/sdk'

export const ACCESS_TOKEN_STORAGE_KEY = 'dramaip.access_token'
export const REFRESH_TOKEN_STORAGE_KEY = 'dramaip.refresh_token'
export const DEVICE_ID_STORAGE_KEY = 'dramaip.device_id'
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

export const apiClient = createApiClient({
  baseURL: API_BASE_URL,
  getAccessToken: () => {
    if (typeof window === 'undefined') return undefined
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? undefined
  },
  getDeviceID,
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

export function saveSession(session: { access_token: string; refresh_token: string }) {
  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, session.access_token)
  window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, session.refresh_token)
}

export function getAccessToken() {
  if (typeof window === 'undefined') return undefined
  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? undefined
}

export function clearSession() {
  window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY)
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
}

export function getRefreshToken() {
  if (typeof window === 'undefined') return undefined
  return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? undefined
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
      String(config.url ?? '').includes('/auth/refresh')
    ) {
      throw error
    }

    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      clearSession()
      throw error
    }

    try {
      config.__dramaipRetry = true
      const session = await apiClient.refresh({ refresh_token: refreshToken })
      saveSession(session)
      config.headers = config.headers ?? {}
      config.headers.Authorization = `Bearer ${session.access_token}`
      return apiClient.http.request(config)
    } catch (refreshError) {
      clearSession()
      throw refreshError
    }
  },
)
