'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '../../../lib/api-client'
import { loginPath, safeNextPath } from '../../../lib/routes'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''

// This page is intentionally only a browser-session bridge. It never receives
// a verifier or token: the Electron main process owns those values and opens
// the final local callback server.
export default function DesktopAuthorizePage() {
  const router = useRouter()
  const [message, setMessage] = useState('正在检查登录状态…')
  const nextPath = useMemo(() => {
    if (typeof window === 'undefined') return '/desktop/authorize'
    const current = new URL(window.location.href)
    return safeNextPath(`${current.pathname}${current.search}`, '/desktop/authorize')
  }, [])

  useEffect(() => {
    let active = true
    const begin = async () => {
      const current = new URL(window.location.href)
      const codeChallenge = current.searchParams.get('code_challenge') ?? ''
      const state = current.searchParams.get('state') ?? ''
      const redirectURI = current.searchParams.get('redirect_uri') ?? ''
      const deviceID = current.searchParams.get('device_id') ?? ''
      if (!codeChallenge || !state || !redirectURI || !deviceID) {
        if (active) setMessage('桌面登录请求不完整，请回到桌面应用重新发起。')
        return
      }
      try {
        await apiClient.getSession()
        if (!active) return
        setMessage('正在安全返回桌面应用…')
        // Empty API base means same-origin /v1.  Resolve against the current
        // page so the local Web proxy is used instead of an invalid URL.
        const target = new URL('/api/v1/auth/desktop/authorize', API_BASE_URL || window.location.origin)
        target.searchParams.set('code_challenge', codeChallenge)
        target.searchParams.set('state', state)
        target.searchParams.set('redirect_uri', redirectURI)
        target.searchParams.set('device_id', deviceID)
        window.location.replace(target.toString())
      } catch {
        router.replace(loginPath(nextPath))
      }
    }
    void begin()
    return () => { active = false }
  }, [nextPath, router])

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-950">连接桌面应用</h1>
      <p className="mt-4 text-sm leading-6 text-slate-600">{message}</p>
    </main>
  )
}
