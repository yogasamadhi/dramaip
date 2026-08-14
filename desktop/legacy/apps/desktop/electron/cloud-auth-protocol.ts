import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export interface DesktopPKCERequest {
  verifier: string
  challenge: string
  state: string
}

export interface CloudAuthEndpoints {
  webOrigin: string
  bffOrigin: string
}

const LOOPBACK_CALLBACK_HOST = '127.0.0.1'

export function createDesktopPKCERequest(): DesktopPKCERequest {
  const verifier = base64url(randomBytes(64))
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    state: base64url(randomBytes(32)),
  }
}

export function createDesktopAuthorizationURL(
  webOrigin: string,
  input: { challenge: string; state: string; redirectURI: string; deviceID: string },
): string {
  const origin = assertCloudEndpoint(webOrigin, { development: isDevelopmentRuntime() })
  const target = new URL('/desktop/authorize', origin)
  target.searchParams.set('code_challenge', input.challenge)
  target.searchParams.set('state', input.state)
  target.searchParams.set('redirect_uri', input.redirectURI)
  target.searchParams.set('device_id', input.deviceID)
  return target.toString()
}

export function parseDesktopCallback(rawURL: string, expectedState: string, expectedRedirectURI: string): string {
  const callback = new URL(rawURL)
  const expected = new URL(expectedRedirectURI)
  if (
    callback.protocol !== 'http:' ||
    callback.hostname !== LOOPBACK_CALLBACK_HOST ||
    callback.port !== expected.port ||
    callback.pathname !== '/callback' ||
    callback.hash !== ''
  ) {
    throw new Error('不受信任的登录回调')
  }
  const state = callback.searchParams.get('state') ?? ''
  if (!safeEqual(state, expectedState)) throw new Error('登录状态校验失败，请重新登录')
  const code = callback.searchParams.get('code') ?? ''
  if (!isAuthorizationCode(code)) throw new Error('登录回调缺少有效授权码')
  if (callback.searchParams.has('access_token') || callback.searchParams.has('refresh_token')) {
    throw new Error('登录回调包含不允许的长期凭据')
  }
  return code
}

export function assertCloudEndpoint(rawOrigin: string, options: { development: boolean }): URL {
  const origin = new URL(rawOrigin)
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('云端地址必须是纯 Origin')
  }
  if (origin.protocol === 'https:') return origin
  if (options.development && origin.protocol === 'http:' && isLoopback(origin.hostname)) return origin
  throw new Error('云端登录仅允许 HTTPS；开发环境仅可使用回环 HTTP 地址')
}

export function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase())
}

export function isAuthorizationCode(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value)
}

export function isDevelopmentRuntime(): boolean {
  // Packaged Electron builds do not necessarily set NODE_ENV. Only the
  // electron-vite development renderer (or an explicit dev NODE_ENV) may use
  // an HTTP loopback platform; every other runtime defaults to HTTPS-only.
  return Boolean(process.env['ELECTRON_RENDERER_URL']) || process.env['NODE_ENV'] === 'development'
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const leftValue = Buffer.from(left)
  const rightValue = Buffer.from(right)
  return leftValue.length === rightValue.length && timingSafeEqual(leftValue, rightValue)
}
