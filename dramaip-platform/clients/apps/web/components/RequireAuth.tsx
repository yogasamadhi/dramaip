'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { getAccessToken } from '../lib/api-client'
import { loginPath } from '../lib/routes'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)
  const currentPath = useMemo(() => {
    const query = typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, '')
    return query ? `${pathname}?${query}` : pathname
  }, [pathname])

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace(loginPath(currentPath))
      return
    }
    setChecked(true)
  }, [currentPath, router])

  if (!checked) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-slate-600">正在检查登录状态...</p>
      </main>
    )
  }
  return <>{children}</>
}
