/**
 * Public environment for the DramaIP mobile client.
 *
 * Expo only exposes variables prefixed with `EXPO_PUBLIC_` to the client bundle.
 * These are read at build time and inlined into Metro output, so they must
 * never hold secrets (see clients/.env.example security red line).
 */

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function readOrigin(): string {
  const explicit = process.env.EXPO_PUBLIC_MOBILE_API_ORIGIN
  const fallback = process.env.EXPO_PUBLIC_API_BASE_URL
  const raw = (explicit && explicit.trim()) || (fallback && fallback.trim()) || ''
  return raw ? trimTrailingSlash(raw) : ''
}

export const API_ORIGIN = readOrigin()

export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? ''

export function isApiConfigured(): boolean {
  return API_ORIGIN.length > 0
}
