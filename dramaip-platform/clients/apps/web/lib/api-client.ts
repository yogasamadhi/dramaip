import { createApiClient } from '@dramaip/sdk'

export const ACCESS_TOKEN_STORAGE_KEY = 'dramaip.access_token'
export const REFRESH_TOKEN_STORAGE_KEY = 'dramaip.refresh_token'

export const apiClient = createApiClient({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000',
  getAccessToken: () => {
    if (typeof window === 'undefined') return undefined
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? undefined
  },
})
