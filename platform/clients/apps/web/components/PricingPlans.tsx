'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { PaymentProvider, Plan } from '@dramaip/sdk'
import { formatApiError, parseApiError } from '../lib/api-error'
import { apiClient } from '../lib/api-client'
import { paymentProviderLabel } from '../lib/display'
import { loginPath } from '../lib/routes'
import { Button } from './ui/Button'
import { PLAN_DESCRIPTIONS } from '../lib/product-positioning'
import { pricingEntitlementRows } from '../lib/pricing-entitlements'

const orderedCodes = ['free', 'creator', 'studio', 'enterprise']

export function PricingPlans() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mounted, setMounted] = useState(false)
  const session = useQuery({ queryKey: ['session'], queryFn: () => apiClient.getSession(), enabled: mounted, retry: false })
  const hasSession = session.isSuccess
  const paymentProviders = useQuery({ queryKey: ['payment-providers'], queryFn: () => apiClient.getPaymentProviders() })
  const providers = (paymentProviders.data ?? [])
    .filter((item) => item.state === 'verified')
    .map((item) => item.provider)
  const simulatedPayment = providers.includes('simulated')
  const [provider, setProvider] = useState<PaymentProvider>('wechatPay')
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiClient.getPlans() })
  const subscription = useQuery({ queryKey: ['subscription'], queryFn: () => apiClient.getSubscription(), retry: false, enabled: hasSession })

  const checkout = useMutation({
    mutationFn: (planCode: string) => apiClient.createOrder({
      planCode,
      provider,
      idempotencyKey: lifecycleKey('web-order-create'),
    }),
    onSuccess: (result) => router.push(`/account/orders/${encodeURIComponent(result.id)}`),
    onError: (error) => {
      if (parseApiError(error).status === 401) router.push(loginPath('/pricing'))
    },
  })
  const changePlan = useMutation({
    mutationFn: (planID: string) => apiClient.changeSubscriptionPlan({
      subscription_id: subscription.data?.id,
      plan_id: planID,
      idempotency_key: lifecycleKey('web-plan-change'),
    }),
    onSuccess: async () => {
      for (const queryKey of ['subscription', 'dashboard', 'token-balance', 'account-report', 'account-bootstrap', 'workspaces']) {
        await queryClient.invalidateQueries({ queryKey: [queryKey] })
      }
    },
  })

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!providers.includes(provider) && providers[0]) setProvider(providers[0])
  }, [provider, providers])

  if (plans.isLoading) return <p className="mt-10 text-sm text-stone-600">正在加载套餐...</p>
  if (plans.error) return <p className="mt-10 text-sm text-rose-700">{formatApiError(plans.error, '无法加载套餐。')}</p>

  const sorted = [...(plans.data?.plans ?? [])].sort((a, b) => orderedCodes.indexOf(a.id) - orderedCodes.indexOf(b.id))

  return (
    <div className="mt-10">
      <div className="grid gap-4 lg:grid-cols-4">
        {sorted.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            current={subscription.data?.plan_code === plan.id && subscription.data.status === 'active'}
            pending={checkout.isPending || changePlan.isPending}
            disabled={plan.purchase_mode !== 'sales_contact' && (paymentProviders.isLoading || providers.length === 0) && plan.id !== 'free'}
            onChoose={() => {
              if (!hasSession) return router.push(loginPath('/pricing'))
              if (subscription.data?.id && subscription.data.status === 'active') return changePlan.mutate(plan.id)
              checkout.mutate(plan.id)
            }}
          />
        ))}
      </div>

      <section className="mt-6 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-semibold text-ink">结账渠道</h2>
          <p className="mt-1 text-sm text-stone-600">
            {simulatedPayment ? '当前为模拟环境，只验证订单与权益流转。' : '订单页展示支付入口，最终状态以服务端通知为准。'}
          </p>
        </div>
        {providers.length > 0 ? (
          <label className="grid min-w-56 gap-1 text-sm font-medium text-stone-700">
            支付方式
            <select className="h-10 rounded-xl border border-stone-300 bg-white px-3" value={provider} onChange={(event) => setProvider(event.target.value as PaymentProvider)}>
              {providers.map((item) => <option key={item} value={item}>{paymentProviderLabel(item)}</option>)}
            </select>
          </label>
        ) : <p className="text-sm text-amber-800">{paymentProviders.isLoading ? '正在查询服务端支付能力…' : '当前环境没有通过验证的自助支付渠道。'}</p>}
      </section>

      {paymentProviders.data?.some((item) => item.state === 'unavailable') ? (
        <p className="mt-3 text-xs text-stone-500">未完成商户配置与发行验收的渠道不会出现在结账选项中。</p>
      ) : null}

      {(checkout.error || changePlan.error) ? (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">
          {formatApiError(checkout.error ?? changePlan.error, '暂时无法提交套餐变更。')}
        </p>
      ) : null}

      <div className="mt-12 overflow-x-auto rounded-3xl border border-stone-200 bg-white">
        <table className="w-full min-w-[780px] border-collapse text-left text-sm">
          <caption className="px-6 py-5 text-left text-lg font-semibold text-ink">按创作资源、审阅交付与协作比较平台权益</caption>
          <thead className="border-y border-stone-200 bg-stone-50 text-stone-500">
            <tr><th className="px-6 py-4 font-medium">能力</th>{sorted.map((plan) => <th key={plan.id} className="px-6 py-4 font-medium">{planName(plan.id)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-stone-100 text-stone-700">
            <CompareRow label="创作资源 · 平台文本额度 / 月" plans={sorted} render={(plan) => plan.quota_tokens.toLocaleString()} />
            {sorted[0] ? pricingEntitlementRows(sorted[0].entitlements).map((row, index) => (
              <CompareRow key={row.id} label={`${row.group} · ${row.label}`} plans={sorted} render={(plan) => pricingEntitlementRows(plan.entitlements)[index].value} />
            )) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PlanCard({ plan, current, pending, disabled, onChoose }: { plan: Plan; current: boolean; pending: boolean; disabled: boolean; onChoose: () => void }) {
  const enterprise = plan.purchase_mode === 'sales_contact'
  const highlight = plan.id === 'studio'
  return (
    <article className={`relative flex min-h-[430px] flex-col rounded-3xl border p-6 ${highlight ? 'border-rust bg-[#292725] text-white shadow-studio' : 'border-stone-200 bg-white text-ink'}`}>
      {highlight ? <span className="absolute right-5 top-5 rounded-full bg-[#ef8964] px-3 py-1 text-xs font-semibold text-ink">小型内容工作室</span> : null}
      <p className={`text-xs font-semibold uppercase tracking-[.16em] ${highlight ? 'text-[#efa88d]' : 'text-rust'}`}>{plan.id}</p>
      <h2 className="mt-3 text-2xl font-semibold">{planName(plan.id)}</h2>
      <div className="mt-6 flex items-end gap-1">
        <span className="text-4xl font-semibold tracking-tight">{enterprise ? '联系销售' : plan.price_cny === 0 ? '¥0' : `¥${plan.price_cny}`}</span>
        {!enterprise && plan.price_cny > 0 ? <span className={`pb-1 text-sm ${highlight ? 'text-stone-400' : 'text-stone-500'}`}>/ 月</span> : null}
      </div>
      <p className={`mt-5 min-h-12 text-sm leading-6 ${highlight ? 'text-stone-300' : 'text-stone-600'}`}>{planDescription(plan.id)}</p>
      <ul className={`mt-6 space-y-3 text-sm ${highlight ? 'text-stone-200' : 'text-stone-700'}`}>
        <li>创作资源：{plan.quota_tokens.toLocaleString()} 平台文本额度 / 月</li>
        {pricingEntitlementRows(plan.entitlements).map((row) => <li key={row.id}>{row.label}：{row.value}</li>)}
      </ul>
      <div className="mt-auto pt-8">
        {enterprise ? (
          <Link href="/contact-sales"><Button className="w-full" variant={highlight ? 'secondary' : 'primary'}>联系销售</Button></Link>
        ) : (
          <Button className={`w-full ${highlight ? '!bg-[#ef8964] !text-ink hover:!bg-[#f2a187]' : ''}`} onClick={onChoose} disabled={pending || current || disabled}>
            {current ? '当前套餐' : plan.id === 'free' ? '免费开始' : '选择套餐'}
          </Button>
        )}
      </div>
    </article>
  )
}

function CompareRow({ label, plans, render }: { label: string; plans: Plan[]; render: (plan: Plan) => string }) {
  return <tr><th className="px-6 py-4 font-medium text-ink">{label}</th>{plans.map((plan) => <td key={plan.id} className="px-6 py-4">{render(plan)}</td>)}</tr>
}

function lifecycleKey(prefix: string) {
  const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${id}`
}

function planName(id: string) {
  return ({ free: 'Free', creator: 'Creator', studio: 'Studio', enterprise: 'Enterprise' } as Record<string, string>)[id] ?? id
}

function planDescription(id: string) {
  return PLAN_DESCRIPTIONS[id] ?? ''
}
