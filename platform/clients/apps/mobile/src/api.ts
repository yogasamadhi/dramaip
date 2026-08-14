import { createMobileApiClient, getAccessToken } from './mobile-session'
import type { DramaIpApiClient } from '@dramaip/sdk'
import { API_ORIGIN, isApiConfigured } from './lib/env'

export type { DramaIpApiClient }

let client: DramaIpApiClient | null = null

/**
 * Lazily build the shared DramaIP API client for the mobile app. The client is
 * bound to `EXPO_PUBLIC_MOBILE_API_ORIGIN` (or `EXPO_PUBLIC_API_BASE_URL`) and
 * reads the access token from the in-memory session cache kept in sync with
 * SecureStore by `mobile-session.ts`.
 */
export function getApiClient(): DramaIpApiClient {
  if (!client) client = createMobileApiClient()
  return client
}

export { getAccessToken, API_ORIGIN, isApiConfigured }
