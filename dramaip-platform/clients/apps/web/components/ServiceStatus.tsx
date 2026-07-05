'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api-client'

export function ServiceStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.getHealth(),
  })

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiClient.getDashboard(),
  })

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-500">Service connection</div>
          <div className="mt-1 text-lg font-semibold text-slate-950">
            {health.isLoading ? 'Checking BFF...' : health.data?.ok ? 'BFF online' : 'BFF unavailable'}
          </div>
        </div>
        <div
          className={`h-3 w-3 rounded-full ${
            health.data?.ok ? 'bg-emerald-500' : health.isLoading ? 'bg-amber-400' : 'bg-rose-500'
          }`}
        />
      </div>

      {health.error ? (
        <p className="mt-4 text-sm leading-6 text-rose-600">
          Cannot reach the service. Start it with `make run-bff` from `services/`.
        </p>
      ) : null}

      {dashboard.data ? (
        <div className="mt-5 grid gap-3 text-sm text-slate-700">
          <div className="flex justify-between gap-4">
            <span>Service</span>
            <span className="font-medium">{health.data?.service}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Account</span>
            <span className="font-medium">{dashboard.data.email}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Plan</span>
            <span className="font-medium uppercase">{dashboard.data.plan}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>Remaining tokens</span>
            <span className="font-medium">{dashboard.data.remaining_tokens.toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-500">Dashboard data will appear after the BFF responds.</p>
      )}
    </section>
  )
}
