export interface SecurityPolicyOptions {
  dev?: boolean
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

export function canOpenExternalUrl(rawUrl: string, options: SecurityPolicyOptions = {}): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'https:') return true
    if (options.dev && url.protocol === 'http:' && isLoopbackHost(url.hostname)) return true
    return false
  } catch {
    return false
  }
}

export function createContentSecurityPolicy(options: SecurityPolicyOptions = {}): string {
  const scriptSrc = options.dev ? "script-src 'self' 'unsafe-eval' 'unsafe-inline';" : "script-src 'self';"
  const localhostSources = [
    'http://localhost:*',
    'http://127.0.0.1:*',
    'http://[::1]:*',
    'ws://localhost:*',
    'ws://127.0.0.1:*',
    'ws://[::1]:*',
  ]
  const devConnect = options.dev ? ` ${localhostSources.join(' ')}` : ''
  const devMedia = options.dev ? ' http://localhost:* http://127.0.0.1:* http://[::1]:*' : ''

  return [
    "default-src 'self';",
    scriptSrc,
    "style-src 'self' 'unsafe-inline';",
    `img-src 'self' data: https: file:${devMedia};`,
    `media-src 'self' data: https: file:${devMedia};`,
    `connect-src 'self' https:${devConnect};`,
  ].join(' ')
}
