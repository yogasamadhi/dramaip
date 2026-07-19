'use client'

import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { PaymentProvider } from '@dramaip/sdk'
import { formatApiError, parseApiError } from '../lib/api-error'
import { apiClient } from '../lib/api-client'
import { paymentProviderLabel, planCodeLabel } from '../lib/display'
import { checkoutProviders, isSimulatedPaymentEnabled } from '../lib/runtime'
import { loginPath } from '../lib/routes'
import { Button } from './ui/Button'

export function PricingPlans() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [mounted, setMounted] = useState(false)
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => apiClient.getSession(),
    enabled: mounted,
    retry: false,
  })
  const hasSession = session.isSuccess
  const simulatedPayment = isSimulatedPaymentEnabled()
  const providers = useMemo(() => checkoutProviders(), [])
  const [provider, setProvider] = useState<PaymentProvider>(() => providers[0] ?? 'wechat_pay')
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiClient.getPlans() })
  const subscription = useQuery({
    queryKey: ['subscription'],
    queryFn: () => apiClient.getSubscription(),
    retry: false,
    enabled: hasSession,
  })

  const checkout = useMutation({
    mutationFn: (planID: string) => apiClient.createCheckout({ plan_id: planID, channel: provider }),
    onSuccess: (result) => {
      router.push(`/account/orders/${encodeURIComponent(result.checkout_id)}`)
    },
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
      await queryClient.invalidateQueries({ queryKey: ['subscription'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      await queryClient.invalidateQueries({ queryKey: ['token-balance'] })
      await queryClient.invalidateQueries({ queryKey: ['account-report'] })
    },
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!providers.includes(provider) && providers[0]) setProvider(providers[0])
  }, [provider, providers])

  if (plans.isLoading) return <p className="mt-8 text-sm text-slate-600">正在加载套餐...</p>
  if (plans.error) return <p className="mt-8 text-sm text-rose-600">{formatApiError(plans.error, '无法加载套餐。')}</p>

  return (
    <div className="mt-8 grid gap-4 md:grid-cols-4">
      <fieldset className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm md:col-span-4">
        <legend className="text-base font-semibold text-slate-950">支付方式</legend>
        <p className="mt-1 text-sm text-slate-600">
          {simulatedPayment ? '当前为模拟环境，仅用于验证下单和状态流转。' : '创建订单后将在订单页展示支付入口，并以服务端状态为准。'}
        </p>
        {providers.length > 0 ? (
          <label className="mt-4 grid max-w-sm gap-1 text-sm font-medium text-slate-700">
            使用渠道
            <select
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950"
              value={provider}
              onChange={(event) => setProvider(event.target.value as PaymentProvider)}
            >
              {providers.map((item) => <option key={item} value={item}>{paymentProviderLabel(item)}</option>)}
            </select>
          </label>
        ) : (
          <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800" role="status">
            当前环境未公布可用支付渠道。请联系运营配置已启用的微信支付或支付宝渠道。
          </p>
        )}
      </fieldset>
      {plans.data?.plans.map((plan) => {
        const isCurrent = subscription.data?.plan_code === plan.id && subscription.data.status === 'active'
        const canChangePlan = Boolean(subscription.data?.id && subscription.data.status === 'active')
        return (
          <section key={plan.id} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-950">{planName(plan.id, plan.name)}</h2>
              {isCurrent ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">当前套餐</span> : null}
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{planDescription(plan.id, plan.description)}</p>
            <p className="mt-5 text-sm text-slate-500">每月 {plan.quota_tokens.toLocaleString()} 模型额度</p>
            <p className="mt-3 text-2xl font-semibold text-slate-950">
              {plan.price_cny === 0 ? '免费' : `¥${plan.price_cny}`}
            </p>
            <Button
              className="mt-5 w-full"
              onClick={() => {
                if (!hasSession) {
                  router.push(loginPath('/pricing'))
                  return
                }
                if (canChangePlan) {
                  changePlan.mutate(plan.id)
                  return
                }
                checkout.mutate(plan.id)
              }}
              disabled={checkout.isPending || changePlan.isPending || isCurrent || (!canChangePlan && providers.length === 0)}
            >
              {isCurrent ? '当前套餐' : canChangePlan ? '切换套餐' : plan.price_cny === 0 ? '免费开始' : '订阅'}
            </Button>
          </section>
        )
      })}

      {checkout.isPending ? <p className="text-sm text-slate-600 md:col-span-4" role="status">正在创建订单并跳转到支付页...</p> : null}
      {checkout.error ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 md:col-span-4">
          {formatApiError(checkout.error, '暂时无法创建订单。')}
        </section>
      ) : null}
      {changePlan.error ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 md:col-span-4">
          {formatError(changePlan.error, '暂时无法变更套餐。')}
        </section>
      ) : null}
      {changePlan.data ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 md:col-span-4">
          已提交套餐变更为 {planCodeLabel(changePlan.data.plan_code)}。若服务端设置了周期末生效，请以账号中心显示的生效时间为准。
        </section>
      ) : null}
    </div>
  )
}

function lifecycleKey(prefix: string) {
  const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${id}`
}

function formatError(error: unknown, fallback: string) {
  return formatApiError(error, fallback)
}

function planName(id?: string, fallback?: string) {
  const labels: Record<string, string> = {
    free: '免费版',
    basic: '基础版',
    pro: '专业版',
    premium: '高级版',
    creator: '创作者版',
    team: '团队版',
    enterprise: '企业版',
  }
  return id ? labels[id] ?? planCodeLabel(id) ?? fallback ?? id : fallback ?? '-'
}

function planDescription(id?: string, fallback?: string) {
  const descriptions: Record<string, string> = {
    free: '适合体验平台订阅、模型额度和智能网关流程。',
    basic: '适合轻量创作和稳定的日常模型调用。',
    pro: '适合持续创作短剧项目的个人创作者。',
    premium: '适合高频项目开发和更大上下文创作。',
    creator: '适合高频创作和稳定云端 AI 调用。',
    team: '适合多人协作与更高频率的创作团队。',
    enterprise: '面向机构客户的高额度与定制模型访问。',
  }
  return id ? descriptions[id] ?? fallback ?? '' : fallback ?? ''
}
