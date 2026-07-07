'use client'

import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../lib/api-client'
import { serviceLabel } from '../lib/display'

export function ServiceStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.getHealth(),
  })

  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => apiClient.getPlans(),
  })

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-500">服务连接</div>
          <div className="mt-1 text-lg font-semibold text-slate-950">
            {health.isLoading ? '正在检查平台服务...' : health.data?.ok ? '平台服务已连接' : '平台服务不可用'}
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
          无法通过 Kong 访问平台服务。
        </p>
      ) : null}

      {health.data ? (
        <div className="mt-5 grid gap-3 text-sm text-slate-700">
          <div className="flex justify-between gap-4">
            <span>服务</span>
            <span className="font-medium">{serviceLabel(health.data?.service)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>版本</span>
            <span className="font-medium">{health.data.version}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>套餐数</span>
            <span className="font-medium">{plans.data?.plans.length ?? '-'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span>网关</span>
            <span className="font-medium">平台网关</span>
          </div>
        </div>
      ) : (
        <p className="mt-5 text-sm text-slate-500">网关响应后会显示服务数据。</p>
      )}
    </section>
  )
}
