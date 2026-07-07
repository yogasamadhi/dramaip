'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiClient, clearSession, getAccessToken, getRefreshToken } from '../lib/api-client'
import { displayNameLabel } from '../lib/display'
import { Button } from './ui/Button'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mounted, setMounted] = useState(false)
  const hasToken = mounted && Boolean(getAccessToken())
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiClient.getProfile(),
    enabled: hasToken,
    retry: false,
  })
  const logout = useMutation({
    mutationFn: () => apiClient.logout({ refresh_token: getRefreshToken() }),
    onSettled: () => {
      clearSession()
      queryClient.clear()
      router.replace('/login')
    },
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold text-slate-950">
            DramaIP
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <NavLink href="/pricing" current={pathname === '/pricing'}>
              套餐
            </NavLink>
            <NavLink href="/chat" current={pathname === '/chat'}>
              AI 对话
            </NavLink>
            <NavLink href="/account" current={pathname.startsWith('/account')}>
              账号中心
            </NavLink>
            {hasToken ? (
              <>
                <span className="hidden max-w-40 truncate text-slate-500 sm:inline">
                  {displayNameLabel(profile.data?.display_name)}
                </span>
                <Button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
                  {logout.isPending ? '退出中...' : '退出登录'}
                </Button>
              </>
            ) : (
              <>
                <NavLink href="/login" current={pathname === '/login'}>
                  登录
                </NavLink>
                <Link href="/register">
                  <Button type="button" variant="secondary">
                    注册
                  </Button>
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>
      {children}
    </div>
  )
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={current ? 'font-medium text-brand-700' : 'text-slate-600 hover:text-slate-950'}>
      {children}
    </Link>
  )
}
