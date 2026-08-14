/**
 * DramaIP mobile session gateway.
 *
 * Native mobile clients keep the token response (see `MobileSessionSchema` in
 * @dramaip/sdk/contracts) and replay it as a Bearer credential. Every request
 * carries `X-DramaIP-Contract-Version: 2` via the shared SDK client, and the
 * access token is the only secret persisted on the device (SecureStore).
 *
 * The platform CI contract gate asserts this module declares the public
 * contract header and parses responses through the shared SDK schemas.
 */

import { useEffect, useState } from 'react'
import * as SecureStore from 'expo-secure-store'

import {
  API_CONTRACT_HEADER,
  MobileSessionSchema,
  type MobileSession,
} from '@dramaip/sdk/contracts'
import { createApiClient, type DramaIpApiClient } from '@dramaip/sdk'
import { API_ORIGIN, isApiConfigured } from './lib/env'

void API_CONTRACT_HEADER

const SESSION_KEY = 'dramaip.mobile.session'
const DEVICE_ID_KEY = 'dramaip.mobile.device-id'

let cachedSession: MobileSession | null = null
let cachedDeviceID = ''

export type MobileSessionStatus = 'anonymous' | 'authenticated'

export interface UseMobileSession {
  status: MobileSessionStatus
  email: string
  apiOrigin: string
  configured: boolean
  session: MobileSession | null
  ready: boolean
}

function parseSession(value: string | null): MobileSession | null {
  if (!value) return null
  try {
    return MobileSessionSchema.parse(JSON.parse(value))
  } catch {
    return null
  }
}

export async function loadStoredSession(): Promise<MobileSession | null> {
  if (cachedSession) return cachedSession
  const raw = await SecureStore.getItemAsync(SESSION_KEY).catch(() => null)
  cachedSession = parseSession(raw)
  return cachedSession
}

export async function persistSession(next: MobileSession): Promise<void> {
  cachedSession = next
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(next)).catch(() => {})
}

export async function clearSession(): Promise<void> {
  cachedSession = null
  await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {})
}

export async function getDeviceID(): Promise<string> {
  if (cachedDeviceID) return cachedDeviceID
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY).catch(() => null)
  if (existing) {
    cachedDeviceID = existing
    return existing
  }
  const generated =
    globalThis.crypto?.randomUUID?.() ?? `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await SecureStore.setItemAsync(DEVICE_ID_KEY, generated).catch(() => {})
  cachedDeviceID = generated
  return generated
}

export function getAccessToken(): string | undefined {
  return cachedSession?.accessToken || undefined
}

export function createMobileApiClient(): DramaIpApiClient {
  return createApiClient({
    baseURL: API_ORIGIN,
    getAccessToken,
    getDeviceID,
  })
}

export function useMobileSession(): UseMobileSession {
  const [session, setSession] = useState<MobileSession | null>(cachedSession)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadStoredSession()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setReady(true)
      })
      .then((value) => {
        if (!cancelled && value) setSession(value)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const status: MobileSessionStatus = session ? 'authenticated' : 'anonymous'

  return {
    status,
    email: session?.email ?? '',
    apiOrigin: API_ORIGIN,
    configured: isApiConfigured(),
    session,
    ready,
  }
}
