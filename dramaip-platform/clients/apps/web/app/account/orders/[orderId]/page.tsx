'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RequireAuth } from '../../../../components/RequireAuth'
import { Button } from '../../../../components/ui/Button'
import { formatApiError } from '../../../../lib/api-error'
import { apiClient } from '../../../../lib/api-client'
import { paymentProviderLabel, planCodeLabel } from '../../../../lib/display'
import { isSimulatedPaymentEnabled } from '../../../../lib/runtime'

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>()
  const queryClient = useQueryClient()
  const orderID = params.orderId
  const order = useQuery({
    queryKey: ['order', orderID],
    queryFn: () => apiClient.getOrder(orderID),
    enabled: Boolean(orderID),
    retry: false,
  })
  const simulatedConfirm = useMutation({
    mutationFn: () => apiClient.confirmSimulatedPayment({ checkout_id: orderID }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['order', orderID] })
      await queryClient.invalidateQueries({ queryKey: ['orders'] })
      await queryClient.invalidateQueries({ queryKey: ['subscription'] })
      await queryClient.invalidateQueries({ queryKey: ['token-balance'] })
    },
  })

  return (
    <RequireAuth>
      <main className="mx-auto max-w-4xl px-6 py-10">
        <Link href="/account" className="text-sm text-slate-600">
          返回账号中心
        </Link>
        <h1 className="mt-4 text-3xl font-semibold text-slate-950">订单详情</h1>
        {order.isLoading ? <p className="mt-8 text-sm text-slate-600">正在加载订单...</p> : null}
        {order.error ? (
          <section className="mt-8 rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
            {formatApiError(order.error, '订单暂不可用。')}
          </section>
        ) : null}
        {order.data ? (
          <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="grid gap-4 text-sm text-slate-700 md:grid-cols-2">
              <Row label="订单编号" value={order.data.id} />
              <Row label="状态" value={statusLabel(order.data.status)} />
              <Row label="套餐" value={planCodeLabel(order.data.plan_code)} />
              <Row label="支付服务商" value={paymentProviderLabel(order.data.provider)} />
              <Row label="金额" value={formatAmount(order.data.amount, order.data.currency)} />
              <Row label="创建时间" value={formatDate(order.data.created_at)} />
              <Row label="支付时间" value={formatDate(order.data.paid_at)} />
              <Row label="订阅编号" value={order.data.subscription_id || '-'} />
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              {order.data.payment_url ? (
                <a href={order.data.payment_url}>
                  <Button type="button" variant="secondary">
                    打开支付地址
                  </Button>
                </a>
              ) : null}
              {isSimulatedPaymentEnabled() && order.data.status === 'pending' ? (
                <Button type="button" onClick={() => simulatedConfirm.mutate()} disabled={simulatedConfirm.isPending}>
                  {simulatedConfirm.isPending ? '确认中...' : '使用模拟支付完成订单'}
                </Button>
              ) : null}
            </div>
            {simulatedConfirm.data ? (
              <p className="mt-4 text-sm text-emerald-700">
                支付已确认。剩余额度：{simulatedConfirm.data.token_balance.remaining_tokens.toLocaleString()}。
              </p>
            ) : null}
            {simulatedConfirm.error ? (
              <p className="mt-4 text-sm text-rose-700">{formatApiError(simulatedConfirm.error, '模拟支付暂不可用。')}</p>
            ) : null}
          </section>
        ) : null}
      </main>
    </RequireAuth>
  )
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase text-slate-500">{label}</div>
      <div className="mt-1 break-all font-medium text-slate-950">{value || '-'}</div>
    </div>
  )
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(value))
}

function formatAmount(amount?: string, currency?: string) {
  const numeric = Number(amount || '0')
  if (currency === 'CNY') {
    return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(numeric)
  }
  return `${amount || '0'} ${currency || ''}`.trim()
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
