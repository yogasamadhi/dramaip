'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { parseApiError } from '../lib/api-error'
import { apiClient } from '../lib/api-client'
import { paymentProviderLabel, planCodeLabel } from '../lib/display'
import { Button } from './ui/Button'

export function BillingOverview() {
  const report = useQuery({ queryKey: ['account-report'], queryFn: () => apiClient.getAccountReport(), retry: false })
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => apiClient.getOrders(), retry: false })

  if (report.isLoading || orders.isLoading) return <Panel>正在加载账单...</Panel>
  if (report.error || orders.error) {
    const details = parseApiError(report.error || orders.error, '账单暂不可用。')
    return <Panel tone="danger">{details.message}{details.trace_id ? `（追踪号：${details.trace_id}）` : ''}</Panel>
  }

  const balance = report.data?.token_balance
  const subscription = report.data?.subscription
  return (
    <div className="grid gap-4">
      <section className="grid gap-4 md:grid-cols-4">
        <Metric title="当前套餐" value={planCodeLabel(subscription?.plan_code)} />
        <Metric title="剩余额度" value={(balance?.remaining_tokens ?? 0).toLocaleString()} />
        <Metric title="当期已用" value={(balance?.used_tokens ?? 0).toLocaleString()} />
        <Metric title="已支付订单" value={String(report.data?.order_summary.paid ?? 0)} />
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold text-slate-950">订单记录</h2><p className="mt-1 text-sm text-slate-600">每笔订单均可查看状态与模拟支付恢复操作。</p></div>
          <Link href="/pricing"><Button>管理套餐</Button></Link>
        </div>
        <div className="mt-5 overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2 font-medium">套餐</th><th className="px-3 py-2 font-medium">状态</th><th className="px-3 py-2 font-medium">渠道</th><th className="px-3 py-2 font-medium">金额</th><th className="px-3 py-2 font-medium">时间</th></tr></thead>
            <tbody>
              {orders.data?.orders.map((order) => <tr key={order.id} className="border-t border-slate-100"><td className="px-3 py-3"><Link href={`/account/orders/${order.id}`} className="font-medium text-brand-700">{planCodeLabel(order.plan_code)}</Link></td><td className="px-3 py-3 text-slate-700">{statusLabel(order.status)}</td><td className="px-3 py-3 text-slate-700">{paymentProviderLabel(order.provider)}</td><td className="px-3 py-3 text-slate-700">{formatAmount(order.amount, order.currency)}</td><td className="px-3 py-3 text-slate-700">{formatDate(order.created_at)}</td></tr>)}
              {orders.data?.orders.length === 0 ? <tr><td className="px-3 py-4 text-slate-500" colSpan={5}>暂无订单。可先在套餐页创建订单。</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600 shadow-sm">
        当期计费周期：{formatDate(balance?.period_start)} 至 {formatDate(balance?.period_end)}。订阅取消、恢复、升降级与退款申请在账号中心完成。
      </section>
    </div>
  )
}

function Panel({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'danger' }) { return <section className={`rounded-lg border p-6 text-sm shadow-sm ${tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600'}`}>{children}</section> }
function Metric({ title, value }: { title: string; value?: string }) { return <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="text-sm text-slate-500">{title}</div><div className="mt-2 text-2xl font-semibold text-slate-950">{value || '-'}</div></div> }
function statusLabel(value: string) { return ({ pending: '待支付', paid: '已支付', failed: '支付失败', expired: '已过期', canceled: '已取消' } as Record<string, string>)[value] ?? value.replaceAll('_', ' ') }
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(value)) : '-' }
function formatAmount(amount?: string, currency?: string) { return currency === 'CNY' ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(amount || '0')) : `${amount || '0'} ${currency || ''}`.trim() }
