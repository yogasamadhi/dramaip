import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import * as keytar from 'keytar'
import { shell } from 'electron'
import {
  assertCloudEndpoint,
  createDesktopAuthorizationURL,
  createDesktopPKCERequest,
  isDevelopmentRuntime,
  parseDesktopCallback,
  type CloudAuthEndpoints,
} from './cloud-auth-protocol'
import { DESKTOP_CONTRACT_HEADER, DESKTOP_CONTRACT_VERSION } from './cloud-contract'

const CLOUD_SESSION_SERVICE = 'com.sdns.studio.cloud-session'
const CLOUD_SESSION_ACCOUNT = 'current'
const CALLBACK_TIMEOUT_MS = 90_000
const LOOPBACK_CALLBACK_HOST = '127.0.0.1'

interface StoredCloudSession {
  version: 1
  refreshToken: string
  deviceID: string
}

interface PrivateCloudSession extends StoredCloudSession {
  accessToken: string
  expiresAt: number
  user: CloudAuthUser
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  user: CloudAuthUser
}

export interface CloudAuthUser {
  id: string
  email: string
  name: string
  emailVerified?: boolean
}

export interface CloudAuthStatus {
  enabled: boolean
  configured: boolean
  signedIn: boolean
  expiresAt?: string
  user?: CloudAuthUser
  error?: string
}

export interface CloudContext {
  user: CloudAuthUser
  subscription: { id: string; plan: string; status: string }
  tokenBalance: { plan: string; quotaTokens: number; usedTokens: number; remainingTokens: number }
}

let cloudSession: PrivateCloudSession | undefined
let configError: string | undefined

function cloudLoginEnabled(): boolean {
  return process.env['DESKTOP_CLOUD_LOGIN_ENABLED'] === 'true'
}

function endpoints(): CloudAuthEndpoints {
  const development = isDevelopmentRuntime()
  const webOrigin = process.env['DESKTOP_CLOUD_WEB_ORIGIN'] ?? 'http://127.0.0.1:3009'
  const bffOrigin = process.env['DESKTOP_CLOUD_BFF_ORIGIN'] ?? 'http://127.0.0.1:8000'
  assertCloudEndpoint(webOrigin, { development })
  assertCloudEndpoint(bffOrigin, { development })
  return { webOrigin, bffOrigin }
}

export async function initializeCloudAuth(): Promise<void> {
  if (!cloudLoginEnabled()) return
  try {
    endpoints()
    await restoreCloudSession()
    configError = undefined
  } catch (error) {
    cloudSession = undefined
    configError = safeCloudAuthError(error)
  }
}

export function getCloudAuthStatus(): CloudAuthStatus {
  const enabled = cloudLoginEnabled()
  return {
    enabled,
    configured: enabled && !configError,
    signedIn: Boolean(cloudSession),
    ...(cloudSession ? { expiresAt: new Date(cloudSession.expiresAt).toISOString(), user: cloudSession.user } : {}),
    ...(configError ? { error: configError } : {}),
  }
}

// Runs entirely in the Electron main process. The renderer can trigger this
// operation but cannot choose callback URLs or read any token value.
export async function loginWithSystemBrowser(): Promise<CloudAuthStatus> {
  if (!cloudLoginEnabled()) throw new Error('云端登录当前已关闭')
  const config = configuredEndpoints()
  const deviceID = randomUUID()
  const pkce = createDesktopPKCERequest()
  const callback = await startLoopbackCallback(pkce.state)
  try {
    const authorizationURL = createDesktopAuthorizationURL(config.webOrigin, {
      challenge: pkce.challenge,
      state: pkce.state,
      redirectURI: callback.redirectURI,
      deviceID,
    })
    await shell.openExternal(authorizationURL)
    const code = await callback.waitForCode
    const token = await exchangeAuthorizationCode(config, code, pkce.verifier, callback.redirectURI, deviceID)
    await persistSession(token, deviceID)
    configError = undefined
    return getCloudAuthStatus()
  } finally {
    await callback.close()
  }
}

export async function restoreCloudSession(): Promise<CloudAuthStatus> {
  if (!cloudLoginEnabled()) return getCloudAuthStatus()
  const config = configuredEndpoints()
  const saved = await readStoredSession()
  if (!saved) {
    cloudSession = undefined
    return getCloudAuthStatus()
  }
  try {
    const token = await refreshSession(config, saved.refreshToken)
    await persistSession(token, saved.deviceID)
  } catch (error) {
    cloudSession = undefined
    await keytar.deletePassword(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)
    configError = safeCloudAuthError(error)
  }
  return getCloudAuthStatus()
}

export async function logoutCloudSession(): Promise<CloudAuthStatus> {
  const current = cloudSession
  cloudSession = undefined
  try {
    if (cloudLoginEnabled()) {
      const config = configuredEndpoints()
      const saved = current ?? await readStoredSession()
      if (saved) await revokeSession(config, saved, current?.accessToken)
    }
  } finally {
    await keytar.deletePassword(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)
  }
  return getCloudAuthStatus()
}

export async function getCloudContext(): Promise<CloudContext> {
  if (!cloudLoginEnabled()) throw new Error('云端登录当前已关闭')
  if (!cloudSession || cloudSession.expiresAt <= Date.now() + 30_000) await restoreCloudSession()
  if (!cloudSession) throw new Error('请先登录云端账号')
  const config = configuredEndpoints()
  const response = await fetchJSON(`${config.bffOrigin}/v1/desktop/me/cloud-context`, {
    method: 'GET', headers: { Authorization: `Bearer ${cloudSession.accessToken}` },
  }) as {
    user?: CloudAuthUser
    subscription?: { id?: string; plan?: string; status?: string }
    token_balance?: { plan?: string; quota_tokens?: number; used_tokens?: number; remaining_tokens?: number }
  }
  if (!response.user || !response.subscription || !response.token_balance) throw new Error('云端账户响应无效')
  return {
    user: response.user,
    subscription: { id: String(response.subscription.id ?? ''), plan: String(response.subscription.plan ?? ''), status: String(response.subscription.status ?? '') },
    tokenBalance: {
      plan: String(response.token_balance.plan ?? ''), quotaTokens: Number(response.token_balance.quota_tokens ?? 0),
      usedTokens: Number(response.token_balance.used_tokens ?? 0), remainingTokens: Number(response.token_balance.remaining_tokens ?? 0),
    },
  }
}

// Cloud AI is confined to Electron main. Callers receive a short-lived access
// token only inside this callback; it is never returned to IPC or renderer.
export async function withCloudAccessToken<T>(operation: (endpoints: CloudAuthEndpoints, accessToken: string) => Promise<T>): Promise<T> {
	if (!cloudLoginEnabled()) throw new Error('云端登录当前已关闭')
	if (!cloudSession || cloudSession.expiresAt <= Date.now() + 30_000) await restoreCloudSession()
	if (!cloudSession) throw new Error('请先登录云端账号')
	return operation(configuredEndpoints(), cloudSession.accessToken)
}

function configuredEndpoints(): CloudAuthEndpoints {
  try {
    return endpoints()
  } catch (error) {
    configError = safeCloudAuthError(error)
    throw error
  }
}

async function exchangeAuthorizationCode(config: CloudAuthEndpoints, code: string, verifier: string, redirectURI: string, deviceID: string): Promise<TokenResponse> {
  return parseTokenResponse(await fetchJSON(`${config.bffOrigin}/v1/desktop/auth/token`, {
    method: 'POST', body: JSON.stringify({ authorization_code: code, code_verifier: verifier, redirect_uri: redirectURI, device_id: deviceID }),
  }))
}

async function refreshSession(config: CloudAuthEndpoints, refreshToken: string): Promise<TokenResponse> {
  return parseTokenResponse(await fetchJSON(`${config.bffOrigin}/v1/desktop/auth/refresh`, {
    method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }),
  }))
}

async function revokeSession(config: CloudAuthEndpoints, saved: StoredCloudSession, accessToken?: string): Promise<void> {
  try {
    await fetchJSON(`${config.bffOrigin}/v1/desktop/auth/logout`, {
      method: 'POST', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: JSON.stringify({ refresh_token: saved.refreshToken, device_id: saved.deviceID }),
    })
  } catch {
    // Clearing the local Keychain entry is still required for an explicit local
    // logout; remote revocation will be retried by token expiry controls.
  }
}

async function persistSession(token: TokenResponse, deviceID: string): Promise<void> {
  const stored: StoredCloudSession = { version: 1, refreshToken: token.refresh_token, deviceID }
  await keytar.setPassword(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT, JSON.stringify(stored))
  cloudSession = {
    ...stored,
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    user: token.user,
  }
}

async function readStoredSession(): Promise<StoredCloudSession | undefined> {
  const raw = await keytar.getPassword(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as Partial<StoredCloudSession>
    if (value.version !== 1 || typeof value.refreshToken !== 'string' || typeof value.deviceID !== 'string' || !value.refreshToken || !value.deviceID) {
      throw new Error('invalid keychain session')
    }
    return { version: 1, refreshToken: value.refreshToken, deviceID: value.deviceID }
  } catch {
    await keytar.deletePassword(CLOUD_SESSION_SERVICE, CLOUD_SESSION_ACCOUNT)
    return undefined
  }
}

function parseTokenResponse(value: unknown): TokenResponse {
  const response = value as Partial<TokenResponse>
  if (
    typeof response.access_token !== 'string' || !response.access_token ||
    typeof response.refresh_token !== 'string' || !response.refresh_token ||
    typeof response.expires_in !== 'number' || response.expires_in <= 0 ||
    response.token_type !== 'Bearer' || !response.user ||
    typeof response.user.id !== 'string' || typeof response.user.email !== 'string' || typeof response.user.name !== 'string'
  ) throw new Error('云端令牌响应无效')
  return response as TokenResponse
}

async function fetchJSON(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', [DESKTOP_CONTRACT_HEADER]: DESKTOP_CONTRACT_VERSION, ...(init.headers ?? {}) },
    })
    if (!response.ok) throw new Error(`云端请求失败（${response.status}）`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

async function startLoopbackCallback(expectedState: string): Promise<{ redirectURI: string; waitForCode: Promise<string>; close: () => Promise<void> }> {
	let server: Server
  let settled = false
  let timeout: ReturnType<typeof setTimeout> | undefined
	let resolveCode!: (code: string) => void
	let rejectCode!: (reason?: unknown) => void
  const waitForCode = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  const close = async () => {
    if (timeout) clearTimeout(timeout)
    if (!server) return
	    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
	server = createServer((request, response) => {
		const address = server.address() as { port: number } | null
		const port = address?.port ?? 0
		const requestURL = new URL(request.url ?? '/', `http://${LOOPBACK_CALLBACK_HOST}:${port}`)
		const redirectURI = `http://${LOOPBACK_CALLBACK_HOST}:${port}/callback`
    if (settled || request.method !== 'GET') {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end('登录回调无效。')
      return
    }
    settled = true
    try {
      const code = parseDesktopCallback(requestURL.toString(), expectedState, redirectURI)
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end('<!doctype html><title>登录完成</title><p>登录已完成，可返回桌面应用。</p>')
      resolveCode(code)
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      response.end('<!doctype html><title>登录失败</title><p>登录校验失败，请返回桌面应用重试。</p>')
      rejectCode(error)
    }
  })
	await new Promise<void>((resolve, reject) => {
		const rejectStartup = (error: Error) => reject(error)
		server.once('error', rejectStartup)
		server.listen(0, LOOPBACK_CALLBACK_HOST, () => {
			server.removeListener('error', rejectStartup)
			resolve()
		})
	})
	const address = server.address() as { port: number } | null
	if (!address?.port) throw new Error('无法创建本地登录回调')
	const redirectURI = `http://${LOOPBACK_CALLBACK_HOST}:${address.port}/callback`
  timeout = setTimeout(() => {
    if (!settled) {
      settled = true
      rejectCode(new Error('登录超时，请重新开始'))
    }
  }, CALLBACK_TIMEOUT_MS)
  return { redirectURI, waitForCode, close }
}

function safeCloudAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[A-Za-z0-9_-]{43,}/g, '[已隐藏]')
}
