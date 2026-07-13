'use client'

import * as echarts from 'echarts'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type Table } from '@tanstack/react-table'
import { z } from 'zod'
import type { Notification, Order, TokenUsage } from '@dramaip/sdk'
import { formatApiError } from '../lib/api-error'
import { apiClient } from '../lib/api-client'
import { displayNameLabel, paymentProviderLabel, planCodeLabel } from '../lib/display'
import { Button } from './ui/Button'

const profileSchema = z.object({
  display_name: z.string().min(1, '请输入昵称'),
  phone: z.string().optional(),
  avatar_url: z.string().optional(),
  locale: z.string().default('zh-CN'),
  timezone: z.string().default('Asia/Shanghai'),
})

type ProfileForm = z.infer<typeof profileSchema>
type AccountTab = 'profile' | 'subscription' | 'orders' | 'usage' | 'notifications' | 'report'

export function AccountDashboard() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<AccountTab>('profile')
  const [nextPlanID, setNextPlanID] = useState('')
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => apiClient.getProfile(), retry: false })
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => apiClient.getDashboard(), retry: false })
  const tokenBalance = useQuery({ queryKey: ['token-balance'], queryFn: () => apiClient.getTokenBalance(), retry: false })
  const subscription = useQuery({ queryKey: ['subscription'], queryFn: () => apiClient.getSubscription(), retry: false })
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => apiClient.getPlans(), retry: false })
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => apiClient.getOrders(), retry: false })
  const usage = useQuery({ queryKey: ['token-usage'], queryFn: () => apiClient.getTokenUsage({ limit: 50 }), retry: false })
  const usageTrend = useQuery({ queryKey: ['usage-trend'], queryFn: () => apiClient.getUsageTrend({ days: 30 }), retry: false })
  const notifications = useQuery({ queryKey: ['notifications'], queryFn: () => apiClient.getNotifications(), retry: false })
  const report = useQuery({ queryKey: ['account-report'], queryFn: () => apiClient.getAccountReport(), retry: false })

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: '', phone: '', avatar_url: '', locale: 'zh-CN', timezone: 'Asia/Shanghai' },
  })

  useEffect(() => {
    if (!profile.data) return
    profileForm.reset({
      display_name: displayNameLabel(profile.data.display_name),
      phone: profile.data.phone,
      avatar_url: profile.data.avatar_url,
      locale: profile.data.locale || 'zh-CN',
      timezone: profile.data.timezone || 'Asia/Shanghai',
    })
  }, [profile.data, profileForm])

  const updateProfile = useMutation({
    mutationFn: (input: ProfileForm) => apiClient.updateProfile(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profile'] })
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })

  const cancelSubscription = useMutation({
    mutationFn: (immediate: boolean) => apiClient.cancelSubscription({ immediate }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscription'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['token-balance'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: ['account-report'] }),
      ])
    },
  })

  const resumeSubscription = useMutation({
    mutationFn: () => apiClient.resumeSubscription({ subscription_id: activeSubscriptionID(subscription.data), idempotency_key: lifecycleKey('web-resume') }),
    onSuccess: async () => {
      await invalidateSubscriptionQueries(queryClient)
    },
  })

  const changeSubscriptionPlan = useMutation({
    mutationFn: () => apiClient.changeSubscriptionPlan({
      subscription_id: activeSubscriptionID(subscription.data),
      plan_id: nextPlanID,
      idempotency_key: lifecycleKey('web-plan-change'),
    }),
    onSuccess: async () => {
      setNextPlanID('')
      await invalidateSubscriptionQueries(queryClient)
    },
  })

  const requestRefund = useMutation({
    mutationFn: () => apiClient.requestRefund({
      subscription_id: activeSubscriptionID(subscription.data),
      reason: 'web_account_request',
      idempotency_key: lifecycleKey('web-refund'),
    }),
    onSuccess: async () => {
      await invalidateSubscriptionQueries(queryClient)
    },
  })

  const markNotificationRead = useMutation({
    mutationFn: (notificationID: string) => apiClient.markNotificationRead(notificationID),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
      await queryClient.invalidateQueries({ queryKey: ['account-report'] })
    },
  })

  const orderTable = useReactTable({
    data: orders.data?.orders ?? [],
    columns: orderColumns,
    getCoreRowModel: getCoreRowModel(),
  })
  const usageTable = useReactTable({
    data: usage.data?.usage ?? [],
    columns: usageColumns,
    getCoreRowModel: getCoreRowModel(),
  })
  const notificationTable = useReactTable({
    data: notifications.data?.notifications ?? [],
    columns: useMemo<ColumnDef<Notification>[]>(
      () => [
        { header: '标题', accessorKey: 'title' },
        { header: '类型', accessorKey: 'type' },
        { header: '时间', cell: ({ row }) => formatDate(row.original.created_at) },
        {
          header: '状态',
          cell: ({ row }) =>
            row.original.read_at ? (
              <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">已读</span>
            ) : (
              <Button type="button" variant="secondary" onClick={() => markNotificationRead.mutate(row.original.id)}>
                标为已读
              </Button>
            ),
        },
      ],
      [markNotificationRead],
    ),
    getCoreRowModel: getCoreRowModel(),
  })

  const chartRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!chartRef.current || tab !== 'report') return
    const chart = echarts.init(chartRef.current)
    chart.setOption({
      tooltip: {},
      grid: { left: 32, right: 16, top: 24, bottom: 28 },
      xAxis: { type: 'category', data: (usageTrend.data?.points ?? []).map((point) => point.date) },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: (usageTrend.data?.points ?? []).map((point) => point.total_tokens), itemStyle: { color: '#2563eb' } }],
    })
    return () => chart.dispose()
  }, [tab, usageTrend.data?.points])

  if (dashboard.isLoading || tokenBalance.isLoading || profile.isLoading) {
    return <Panel><p className="text-sm text-slate-600">正在加载账号数据...</p></Panel>
  }

  const firstError = profile.error || dashboard.error || tokenBalance.error
  if (firstError) {
    return <Panel tone="danger">{formatApiError(firstError, '账号数据暂不可用。')}</Panel>
  }

  const balance = tokenBalance.data
  const activeSubscription = subscription.data
  const subscriptionActionError = cancelSubscription.error || resumeSubscription.error || changeSubscriptionPlan.error || requestRefund.error
  const tabs: Array<{ id: AccountTab; label: string }> = [
    { id: 'profile', label: '资料' },
    { id: 'subscription', label: '订阅' },
    { id: 'orders', label: '订单' },
    { id: 'usage', label: '用量' },
    { id: 'notifications', label: `通知${notifications.data?.unread_count ? ` ${notifications.data.unread_count}` : ''}` },
    { id: 'report', label: '报表' },
  ]

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`px-3 py-2 text-sm font-medium ${tab === item.id ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'profile' ? (
        <Panel>
          <form className="grid gap-4" onSubmit={profileForm.handleSubmit((values) => updateProfile.mutate(values))}>
            <h2 className="text-xl font-semibold text-slate-950">{displayNameLabel(profile.data?.display_name)}</h2>
            <Field label="昵称" error={profileForm.formState.errors.display_name?.message}>
              <input className="h-10 rounded-md border border-slate-300 px-3" {...profileForm.register('display_name')} />
            </Field>
            <Field label="手机号">
              <input className="h-10 rounded-md border border-slate-300 px-3" {...profileForm.register('phone')} />
            </Field>
            <Field label="头像地址">
              <input className="h-10 rounded-md border border-slate-300 px-3" {...profileForm.register('avatar_url')} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="语言区域">
                <select className="h-10 rounded-md border border-slate-300 px-3" {...profileForm.register('locale')}>
                  <option value="zh-CN">简体中文（中国）</option>
                  <option value="en-US">英文（美国）</option>
                </select>
              </Field>
              <Field label="时区">
                <select className="h-10 rounded-md border border-slate-300 px-3" {...profileForm.register('timezone')}>
                  <option value="Asia/Shanghai">中国标准时间（上海）</option>
                  <option value="UTC">协调世界时</option>
                </select>
              </Field>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="grid gap-1 text-sm text-slate-500"><span>{profile.data?.email}</span><Link href="/verify-email" className="font-medium text-brand-700">验证邮箱</Link></div>
              <Button type="submit" disabled={updateProfile.isPending}>{updateProfile.isPending ? '保存中...' : '保存资料'}</Button>
            </div>
            {updateProfile.error ? <p className="text-sm text-rose-600">{formatApiError(updateProfile.error, '资料保存暂不可用。')}</p> : null}
          </form>
        </Panel>
      ) : null}

      {tab === 'subscription' ? (
        <Panel>
          <div className="grid gap-4 md:grid-cols-2">
            <Metric title="当前套餐" value={planCodeLabel(activeSubscription?.plan_code ?? dashboard.data?.plan)} />
            <Metric title="剩余额度" value={balance?.remaining_tokens.toLocaleString()} />
            <Metric title="已使用" value={balance?.used_tokens.toLocaleString()} />
            <Metric title="月度额度" value={balance?.quota_tokens.toLocaleString()} />
          </div>
          <div className="mt-5 grid gap-3 text-sm text-slate-700">
            <Row label="订阅状态" value={statusLabel(activeSubscription?.status ?? dashboard.data?.subscription_status)} />
            <Row label="周期" value={`${formatDate(activeSubscription?.current_period_start)} - ${formatDate(activeSubscription?.current_period_end)}`} />
            {activeSubscription?.scheduled_plan_code ? <Row label="计划变更" value={`${planCodeLabel(activeSubscription.scheduled_plan_code)}（${formatDate(activeSubscription.scheduled_change_at)} 生效）`} /> : null}
            {subscriptionNotice(activeSubscription?.status, activeSubscription?.cancel_at_period_end)}
            <div className="flex flex-wrap gap-3">
              {activeSubscription?.cancel_at_period_end ? (
                <Button type="button" onClick={() => resumeSubscription.mutate()} disabled={resumeSubscription.isPending}>
                  {resumeSubscription.isPending ? '恢复中...' : '恢复续订'}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (window.confirm('确定在当前周期结束时取消续订吗？')) cancelSubscription.mutate(false)
                  }}
                  disabled={cancelSubscription.isPending || !activeSubscription?.id}
                >
                  {cancelSubscription.isPending ? '取消中...' : '取消续订'}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (window.confirm('退款申请将进入人工审核，确定继续吗？')) requestRefund.mutate()
                }}
                disabled={requestRefund.isPending || !activeSubscription?.id}
              >
                {requestRefund.isPending ? '提交中...' : '申请退款'}
              </Button>
            </div>
            <div className="grid gap-3 rounded-md border border-slate-200 p-4 md:grid-cols-[1fr_auto]">
              <label className="grid gap-1 text-sm text-slate-700">
                升级或降级套餐
                <select
                  className="h-10 rounded-md border border-slate-300 bg-white px-3"
                  value={nextPlanID || activeSubscription?.plan_code || ''}
                  onChange={(event) => setNextPlanID(event.target.value)}
                  disabled={plans.isLoading || !activeSubscription?.id}
                >
                  <option value="">请选择套餐</option>
                  {plans.data?.plans.map((plan) => <option key={plan.id} value={plan.id}>{planCodeLabel(plan.id)} · 每月 {plan.quota_tokens.toLocaleString()} 额度</option>)}
                </select>
              </label>
              <Button
                type="button"
                className="self-end"
                onClick={() => changeSubscriptionPlan.mutate()}
                disabled={changeSubscriptionPlan.isPending || !nextPlanID || nextPlanID === activeSubscription?.plan_code || !activeSubscription?.id}
              >
                {changeSubscriptionPlan.isPending ? '提交中...' : '提交套餐变更'}
              </Button>
            </div>
            {requestRefund.data ? <div className="rounded-md bg-amber-50 p-3 text-amber-800">退款申请已提交，状态：{statusLabel(requestRefund.data.status)}。</div> : null}
            {subscriptionActionError ? <ErrorNotice error={subscriptionActionError} fallback="订阅操作暂不可用。" /> : null}
          </div>
        </Panel>
      ) : null}

      {tab === 'orders' ? <Panel><DataTable table={orderTable} empty="暂无订单。" /></Panel> : null}
      {tab === 'usage' ? <Panel><DataTable table={usageTable} empty="暂无用量记录。" /></Panel> : null}
      {tab === 'notifications' ? <Panel><DataTable table={notificationTable} empty="暂无通知。" /></Panel> : null}
      {tab === 'report' ? (
        <Panel>
          <div className="grid gap-4 md:grid-cols-4">
            <Metric title="订单总数" value={String(report.data?.order_summary.total ?? 0)} />
            <Metric title="已支付订单" value={String(report.data?.order_summary.paid ?? 0)} />
            <Metric title="消耗 token" value={(report.data?.usage_summary.total_tokens ?? 0).toLocaleString()} />
            <Metric title="未读通知" value={String(report.data?.notification_summary.unread ?? 0)} />
          </div>
          <div ref={chartRef} className="mt-6 h-64 w-full" />
        </Panel>
      ) : null}
    </div>
  )
}

const orderColumns: ColumnDef<Order>[] = [
  { header: '套餐', cell: ({ row }) => <Link href={`/account/orders/${row.original.id}`} className="font-medium text-brand-700">{planCodeLabel(row.original.plan_code)}</Link> },
  { header: '状态', cell: ({ row }) => statusLabel(row.original.status) },
  { header: '渠道', cell: ({ row }) => paymentProviderLabel(row.original.provider) },
  { header: '金额', cell: ({ row }) => formatAmount(row.original.amount, row.original.currency) },
  { header: '时间', cell: ({ row }) => formatDate(row.original.created_at) },
]

const usageColumns: ColumnDef<TokenUsage>[] = [
  { header: '请求', cell: ({ row }) => row.original.request_id || row.original.reservation_id },
  { header: '模型', accessorKey: 'model' },
  { header: '状态', cell: ({ row }) => statusLabel(row.original.status) },
  { header: '总量', cell: ({ row }) => row.original.total_tokens.toLocaleString() },
  { header: '时间', cell: ({ row }) => formatDate(row.original.created_at) },
]

function DataTable<T>({ table, empty }: { table: Table<T>; empty: string }) {
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-3 py-2 font-medium">{flexRender(header.column.columnDef.header, header.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-t border-slate-100">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-3 text-slate-700">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
          {table.getRowModel().rows.length === 0 ? (
            <tr><td className="px-3 py-4 text-slate-500" colSpan={table.getAllColumns().length}>{empty}</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

function Panel({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'danger' }) {
  return <section className={`rounded-lg border p-6 shadow-sm ${tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white'}`}>{children}</section>
}

function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="grid gap-1 text-sm text-slate-700">
      {label}
      {children}
      {error ? <span className="text-rose-600">{error}</span> : null}
    </label>
  )
}

function Metric({ title, value }: { title: string; value?: string }) {
  return (
    <div className="rounded-md border border-slate-100 p-4">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value || '-'}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="font-medium">{value || '-'}</span>
    </div>
  )
}

function subscriptionNotice(status?: string, cancelAtPeriodEnd?: boolean) {
  if (cancelAtPeriodEnd) return <div className="rounded-md bg-amber-50 p-3 text-amber-800">已设置在周期结束时取消续订。</div>
  if (status === 'quota_pending') return <div className="rounded-md bg-amber-50 p-3 text-amber-800">额度正在发放中。</div>
  if (status === 'activation_failed') return <div className="rounded-md bg-rose-50 p-3 text-rose-700">订阅激活需要处理。</div>
  return null
}

function ErrorNotice({ error, fallback }: { error: unknown; fallback: string }) {
  return <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{formatApiError(error, fallback)}</div>
}

function lifecycleKey(prefix: string) {
  const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${id}`
}

function activeSubscriptionID(subscription?: { id?: string }) {
  return subscription?.id || undefined
}

async function invalidateSubscriptionQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['subscription'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    queryClient.invalidateQueries({ queryKey: ['token-balance'] }),
    queryClient.invalidateQueries({ queryKey: ['orders'] }),
    queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    queryClient.invalidateQueries({ queryKey: ['account-report'] }),
  ])
}

function statusLabel(value?: string) {
  const labels: Record<string, string> = {
    active: '已生效',
    pending: '待处理',
    paid: '已支付',
    canceled: '已取消',
    quota_pending: '额度发放中',
    activation_failed: '激活失败',
    succeeded: '成功',
    failed: '失败',
    reserved: '已预留',
    settled: '已结算',
    over_quota_settled: '超额结算',
  }
  return value ? labels[value] ?? value.replaceAll('_', ' ') : '-'
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
