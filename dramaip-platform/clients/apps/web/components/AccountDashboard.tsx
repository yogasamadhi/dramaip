'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api-client'
import { Button } from './ui/Button'

export function AccountDashboard() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.getDashboard(),
    retry: false,
  })

  const tokenBalance = useQuery({
    queryKey: ['token-balance'],
    queryFn: () => apiClient.getTokenBalance(),
    retry: false,
  })

  if (dashboard.error || tokenBalance.error) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Account access</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Demo account data is protected. Sign in once and the web app will attach the demo token to API requests.
        </p>
        <Link href="/login" className="mt-5 inline-flex">
          <Button>Login</Button>
        </Link>
      </section>
    )
  }

  if (dashboard.isLoading || tokenBalance.isLoading) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">Loading account data...</p>
      </section>
    )
  }

  const account = dashboard.data
  const balance = tokenBalance.data
  const usagePercent = balance ? Math.round((balance.used_tokens / balance.quota_tokens) * 100) : 0

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-500">Profile</div>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">{account?.name}</h2>
        <div className="mt-5 grid gap-3 text-sm text-slate-700">
          <div className="flex justify-between gap-4">
            <span>Email</span>
            <span className="font-medium">{account?.email}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Subscription</span>
            <span className="font-medium capitalize">{account?.subscription_status}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Plan</span>
            <span className="font-medium uppercase">{account?.plan}</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-sm font-medium text-slate-500">Token balance</div>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">
          {balance?.remaining_tokens.toLocaleString()} left
        </h2>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand-500" style={{ width: `${usagePercent}%` }} />
        </div>
        <div className="mt-4 grid gap-3 text-sm text-slate-700">
          <div className="flex justify-between gap-4">
            <span>Used</span>
            <span className="font-medium">{balance?.used_tokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Monthly quota</span>
            <span className="font-medium">{balance?.quota_tokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Period</span>
            <span className="font-medium">Jul 2026</span>
          </div>
        </div>
      </section>
    </div>
  )
}
