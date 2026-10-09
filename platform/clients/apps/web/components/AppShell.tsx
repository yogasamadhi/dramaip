'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { apiClient, hasWebSessionMarker } from '../lib/api-client'
import { displayNameLabel } from '../lib/display'
import { Button } from './ui/Button'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mounted, setMounted] = useState(false)
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => apiClient.getSession(),
    enabled: mounted && hasWebSessionMarker(),
    retry: false,
  })
  const hasSession = session.isSuccess
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiClient.getProfile(),
    enabled: hasSession,
    retry: false,
  })
  const logout = useMutation({
    mutationFn: () => apiClient.logout(),
    onSettled: () => {
      queryClient.clear()
      router.replace('/login')
    },
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-stone-50/90 backdrop-blur-xl">
        <nav className="mx-auto flex min-h-[72px] max-w-7xl items-center justify-between gap-6 px-5 py-3 lg:px-8">
          <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-tight text-stone-950">
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-ink text-sm text-white">意</span>
            <span>尽意 <span className="font-normal text-stone-400">DramaIP</span></span>
          </Link>
          <div className="hidden items-center gap-5 text-sm lg:flex">
            <NavLink href="/cases" current={pathname.startsWith('/cases')}>
              创作案例
            </NavLink>
            <NavLink href="/trust" current={pathname === '/trust'}>
              信任中心
            </NavLink>
            <NavLink href="/pricing" current={pathname === '/pricing'}>
              套餐
            </NavLink>
            <NavLink href="/download" current={pathname === '/download'}>
              下载
            </NavLink>
            <NavLink href="/account" current={pathname.startsWith('/account')}>
              工作区
            </NavLink>
            <NavLink href="/inspiration" current={pathname.startsWith('/inspiration')}>
              灵感空间
            </NavLink>
            {hasSession ? (
              <>
                <span className="hidden max-w-40 truncate text-slate-500 sm:inline">
                  {displayNameLabel(profile.data?.display_name)}
                </span>
                <Button type="button" variant="secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>
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
          <Link href="/download" className="lg:hidden">
            <Button type="button">下载</Button>
          </Link>
        </nav>
      </header>
      {children}
    </div>
  )
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={current ? 'font-medium text-rust' : 'text-stone-600 transition hover:text-stone-950'}>
      {children}
    </Link>
  )
}
