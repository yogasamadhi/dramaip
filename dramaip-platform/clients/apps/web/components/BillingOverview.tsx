'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { formatApiError } from '../lib/api-error'
import { apiClient } from '../lib/api-client'
import { paymentProviderLabel, planCodeLabel } from '../lib/display'
import { Button } from './ui/Button'

export function BillingOverview() {
  const account = useQuery({
    queryKey: ['account-bootstrap', { usage_limit: 50, trend_days: 30 }],
    queryFn: () => apiClient.getAccountBootstrap({ usage_limit: 50, trend_days: 30 }),
    retry: false,
    staleTime: 30_000,
  })

  if (account.isLoading) return <Panel>正在加载账单...</Panel>
  if (account.error) return <Panel tone="danger">{formatApiError(account.error, '账单暂不可用。')}</Panel>

  const sections = account.data?.sections
  const balance = sections?.token_balance.data
  const subscription = sections?.subscription.data
  const orders = sections?.orders.data
  return (
    <div className="grid gap-4">
      <section className="grid gap-4 md:grid-cols-4">
        <Metric title="当前套餐" value={planCodeLabel(subscription?.plan_code)} />
        <Metric title="剩余额度" value={balance?.remaining_tokens.toLocaleString()} />
        <Metric title="当期已用" value={balance?.used_tokens.toLocaleString()} />
        <Metric title="已支付订单" value={orders ? String(orders.orders.filter((order) => order.status === 'paid').length) : undefined} />
      </section>
      {sections?.subscription.status === 'unavailable' || sections?.token_balance.status === 'unavailable' ? <SectionUnavailable section="订阅或额度" traceID={sections.subscription.trace_id || sections.token_balance.trace_id} updatedAt={sections.subscription.last_updated || sections.token_balance.last_updated} /> : null}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold text-slate-950">订单记录</h2><p className="mt-1 text-sm text-slate-600">每笔订单均可查看状态与模拟支付恢复操作。</p></div>
          <Link href="/pricing"><Button>管理套餐</Button></Link>
        </div>
        <div className="mt-5 overflow-x-auto rounded-md border border-slate-200">
          {sections?.orders.status === 'unavailable' ? <SectionUnavailable section="订单记录" traceID={sections.orders.trace_id} updatedAt={sections.orders.last_updated} /> : <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-3 py-2 font-medium">套餐</th><th className="px-3 py-2 font-medium">状态</th><th className="px-3 py-2 font-medium">渠道</th><th className="px-3 py-2 font-medium">金额</th><th className="px-3 py-2 font-medium">时间</th></tr></thead>
            <tbody>
              {orders?.orders.map((order) => <tr key={order.id} className="border-t border-slate-100"><td className="px-3 py-3"><Link href={`/account/orders/${order.id}`} className="font-medium text-brand-700">{planCodeLabel(order.plan_code)}</Link></td><td className="px-3 py-3 text-slate-700">{statusLabel(order.status)}</td><td className="px-3 py-3 text-slate-700">{paymentProviderLabel(order.provider)}</td><td className="px-3 py-3 text-slate-700">{formatAmount(order.amount, order.currency)}</td><td className="px-3 py-3 text-slate-700">{formatDate(order.created_at)}</td></tr>)}
              {orders?.orders.length === 0 ? <tr><td className="px-3 py-4 text-slate-500" colSpan={5}>暂无订单。可先在套餐页创建订单。</td></tr> : null}
            </tbody>
          </table>
          }
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
function SectionUnavailable({ section, traceID, updatedAt }: { section: string; traceID?: string; updatedAt?: string }) { return <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">{section}暂时不可用，未以零值替代。{updatedAt ? `最近检查：${formatTimestamp(updatedAt)}。` : ''}{traceID ? `追踪号：${traceID}` : ''}</p> }
function statusLabel(value: string) { return ({ pending: '待支付', paid: '已支付', failed: '支付失败', expired: '已过期', canceled: '已取消' } as Record<string, string>)[value] ?? value.replaceAll('_', ' ') }
function formatDate(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(value)) : '-' }
function formatTimestamp(value?: string) { return value ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '-' }
function formatAmount(amount?: string, currency?: string) { return currency === 'CNY' ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(amount || '0')) : `${amount || '0'} ${currency || ''}`.trim() }
