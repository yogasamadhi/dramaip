import type { NextConfig } from 'next'

function apiProxyTarget() {
  const configured = process.env.DRAMAIP_WEB_API_PROXY_TARGET?.trim()
  if (!configured) return undefined

  let target: URL
  try {
    target = new URL(configured)
  } catch {
    throw new Error('DRAMAIP_WEB_API_PROXY_TARGET 必须是有效的 http(s) URL。')
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('DRAMAIP_WEB_API_PROXY_TARGET 仅支持 http 或 https。')
  }
  if (target.username || target.password || target.search || target.hash) {
    throw new Error('DRAMAIP_WEB_API_PROXY_TARGET 不能包含凭据、查询参数或片段。')
  }

  return target.toString().replace(/\/$/, '')
}

const apiTarget = apiProxyTarget()

const nextConfig: NextConfig = {
  // Package a self-contained Node server for Kubernetes.  The public API base
  // is injected at image-build time; staging intentionally uses an empty
  // value so browser requests stay on the same origin as the Web UI.
  output: 'standalone',
  reactStrictMode: true,
  // The local launcher configures this server-only target.  Browser requests
  // remain relative, so opening the dev UI from a LAN device does not make
  // that device try to reach its own localhost:8000.  Production ingress
  // already owns /v1 routing and deliberately leaves this unset.
  async rewrites() {
    if (!apiTarget) return []
    return [{ source: '/v1/:path*', destination: `${apiTarget}/v1/:path*` }]
  },
}

export default nextConfig
