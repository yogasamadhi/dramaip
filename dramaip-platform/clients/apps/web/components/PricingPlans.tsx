'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { formatApiError, parseApiError } from '../lib/api-error'
import { apiClient } from '../lib/api-client'
import { planCodeLabel } from '../lib/display'
import { isSimulatedPaymentEnabled } from '../lib/runtime'
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
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiClient.getPlans() })
  const subscription = useQuery({
    queryKey: ['subscription'],
    queryFn: () => apiClient.getSubscription(),
    retry: false,
    enabled: hasSession,
  })

  const checkout = useMutation({
    mutationFn: (planID: string) => apiClient.createCheckout({ plan_id: planID, channel: simulatedPayment ? 'simulated' : 'production' }),
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

  const simulatedConfirm = useMutation({
    mutationFn: (checkoutID: string) => apiClient.confirmSimulatedPayment({ checkout_id: checkoutID }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      await queryClient.invalidateQueries({ queryKey: ['token-balance'] })
      await queryClient.invalidateQueries({ queryKey: ['subscription'] })
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  if (plans.isLoading) return <p className="mt-8 text-sm text-slate-600">正在加载套餐...</p>
  if (plans.error) return <p className="mt-8 text-sm text-rose-600">{formatApiError(plans.error, '无法加载套餐。')}</p>

  return (
    <div className="mt-8 grid gap-4 md:grid-cols-4">
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
              disabled={checkout.isPending || changePlan.isPending || isCurrent}
            >
              {isCurrent ? '当前套餐' : canChangePlan ? '切换套餐' : plan.price_cny === 0 ? '免费开始' : '订阅'}
            </Button>
          </section>
        )
      })}

      {checkout.data ? (
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800 md:col-span-4">
          <div className="font-medium">订单已创建：{checkout.data.checkout_id}</div>
          <div className="mt-2">状态：{statusLabel(checkout.data.status)}</div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/account/orders/${checkout.data.checkout_id}`}>
              <Button type="button" variant="secondary">
                查看订单
              </Button>
            </Link>
            {simulatedPayment ? (
              <Button
                type="button"
                onClick={() => simulatedConfirm.mutate(checkout.data.checkout_id)}
                disabled={simulatedConfirm.isPending}
              >
                {simulatedConfirm.isPending ? '确认中...' : '使用模拟支付完成订单'}
              </Button>
            ) : (
              <span className="self-center text-slate-600">等待支付服务商确认。</span>
            )}
          </div>
        </section>
      ) : null}

      {simulatedConfirm.data ? (
        <section className="rounded-lg border border-emerald-200 bg-white p-5 text-sm text-emerald-800 md:col-span-4">
          支付已确认。套餐 {planCodeLabel(simulatedConfirm.data.subscription.plan_code)}，剩余{' '}
          {simulatedConfirm.data.token_balance.remaining_tokens.toLocaleString()} 模型额度。
        </section>
      ) : null}
      {simulatedConfirm.error ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 md:col-span-4">
          {formatApiError(simulatedConfirm.error, '模拟支付暂不可用。')}
        </section>
      ) : null}
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

function statusLabel(value?: string) {
  const labels: Record<string, string> = {
    pending: '待支付',
    paid: '已支付',
    active: '已生效',
    canceled: '已取消',
    failed: '失败',
  }
  return value ? labels[value] ?? value.replaceAll('_', ' ') : '-'
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
