import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Package a self-contained Node server for Kubernetes.  The public API base
  // is injected at image-build time; staging intentionally uses an empty
  // value so browser requests stay on the same origin as the Web UI.
  output: 'standalone',
  reactStrictMode: true,
}

export default nextConfig
