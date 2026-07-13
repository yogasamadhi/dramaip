import * as SecureStore from 'expo-secure-store'

const REFRESH_TOKEN_KEY = 'com.dramaip.mobile.refresh-token.v1'
const DEVICE_ID_KEY = 'com.dramaip.mobile.device-id.v1'
const REQUEST_TIMEOUT_MS = 15_000

export interface MobileSession {
  user: { id: string; name: string }
  expiresAt: number
}

export interface MobileBrief {
  displayName: string
  plan: string
  remainingTokens: number
}

export type RestoreResult =
  | { state: 'signed_in'; session: MobileSession }
  | { state: 'signed_out' }
  | { state: 'expired' }
  | { state: 'offline' }

let accessToken: string | undefined
let currentSession: MobileSession | undefined

export async function signIn(email: string, password: string): Promise<MobileSession> {
  const session = await requestSession('/v1/mobile/auth/login', {
    email: email.trim(),
    password,
    device_id: await deviceID(),
  })
  await persistSession(session)
  return currentSession as MobileSession
}

// The refresh token is the only long-lived session secret. It is written only
// to the iOS Keychain / Android Keystore-backed Expo SecureStore. Access tokens
// intentionally stay inside this module's memory and are lost on process exit.
export async function restoreSession(): Promise<RestoreResult> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
  if (!refreshToken) return { state: 'signed_out' }
  try {
    const session = await requestSession('/v1/mobile/auth/refresh', { refresh_token: refreshToken })
    await persistSession(session)
    return { state: 'signed_in', session: currentSession as MobileSession }
  } catch (error) {
    if (error instanceof MobileRequestError && error.status === 401) {
      await clearSession()
      return { state: 'expired' }
    }
    return { state: 'offline' }
  }
}

export async function getBrief(): Promise<MobileBrief> {
  const token = requireAccessToken()
  const response = await requestJSON('/v1/mobile/me/brief', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = record(response)
  const displayName = string(payload.display_name)
  const plan = string(payload.plan)
  const remainingTokens = nonnegativeInteger(payload.remaining_tokens)
  if (!displayName || !plan || remainingTokens === undefined) throw new Error('移动端账户响应无效')
  return { displayName, plan, remainingTokens }
}

export async function signOut(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
  const token = accessToken
  try {
    if (refreshToken) {
      await requestJSON('/v1/mobile/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ refresh_token: refreshToken, device_id: await deviceID() }),
      })
    }
  } finally {
    // Explicit local logout must clear the secure-store entry even if a weak
    // network prevents remote revocation. The server TTL/revocation remains
    // authoritative for the old token.
    await clearSession()
  }
}

export function activeSession(): MobileSession | undefined {
  return currentSession
}

// Domain modules may make authenticated BFF requests without learning the
// access token. This keeps the token's lifetime and storage boundary inside
// this module even as Mobile gains small creative workflows.
export async function authorizedMobileRequest(path: string, init: RequestInit): Promise<unknown> {
  return requestJSON(path, {
    ...init,
    headers: { Authorization: `Bearer ${requireAccessToken()}`, ...(init.headers ?? {}) },
  })
}

async function requestSession(path: string, body: Record<string, string>): Promise<SessionReply> {
  const response = await requestJSON(path, { method: 'POST', body: JSON.stringify(body) })
  const payload = record(response)
  const access = string(payload.access_token)
  const refresh = string(payload.refresh_token)
  const expiresIn = positiveInteger(payload.expires_in)
  const tokenType = string(payload.token_type)
  const user = record(payload.user)
  const userID = string(user.id)
  const name = string(user.name)
  if (!access || !refresh || !expiresIn || tokenType !== 'Bearer' || !userID || !name) throw new Error('移动端会话响应无效')
  return { access, refresh, expiresIn, user: { id: userID, name } }
}

async function persistSession(session: SessionReply): Promise<void> {
  // Set the secure value before making the in-memory session observable. A
  // storage failure leaves the caller signed out rather than half-persisted.
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refresh, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
  accessToken = session.access
  currentSession = { user: session.user, expiresAt: Date.now() + session.expiresIn * 1_000 }
}

async function clearSession(): Promise<void> {
  accessToken = undefined
  currentSession = undefined
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)
}

async function deviceID(): Promise<string> {
  const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY)
  if (stored) return stored
  const bytes = new Uint8Array(16)
  globalThis.crypto?.getRandomValues?.(bytes)
  const generated = bytes.some((value) => value !== 0)
    ? `mobile-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
    : `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await SecureStore.setItemAsync(DEVICE_ID_KEY, generated, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })
  return generated
}

async function requestJSON(path: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${mobileBFFOrigin()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    const body = await response.json().catch(() => undefined)
    if (!response.ok) throw new MobileRequestError(response.status)
    return body
  } finally {
    clearTimeout(timeout)
  }
}

function mobileBFFOrigin(): string {
  const origin = (process.env.EXPO_PUBLIC_MOBILE_BFF_ORIGIN ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '')
  const url = new URL(origin)
  if (!__DEV__ && url.protocol !== 'https:') throw new Error('生产移动端 BFF 必须使用 HTTPS')
  if (__DEV__ && !['http:', 'https:'].includes(url.protocol)) throw new Error('移动端 BFF 地址无效')
  return url.origin
}

function requireAccessToken(): string {
  if (!accessToken) throw new MobileRequestError(401)
  return accessToken
}

class MobileRequestError extends Error {
  constructor(readonly status: number) {
    super(`移动端请求失败（${status}）`)
  }
}

interface SessionReply {
  access: string
  refresh: string
  expiresIn: number
  user: { id: string; name: string }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
