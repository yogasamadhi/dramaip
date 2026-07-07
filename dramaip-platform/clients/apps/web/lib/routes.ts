export function safeNextPath(value: string | null | undefined, fallback = '/account') {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export function loginPath(nextPath: string) {
  return `/login?next=${encodeURIComponent(safeNextPath(nextPath))}`
}
