#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const checks = [
  {
    file: 'clients/apps/web/app/account/page.tsx',
    patterns: ['<RequireAuth>', '<AccountDashboard />'],
  },
  {
    file: 'clients/apps/web/app/chat/page.tsx',
    patterns: ["import { redirect } from 'next/navigation'", "redirect('/inspiration')"],
  },
  {
    file: 'clients/apps/web/app/inspiration/page.tsx',
    patterns: [
      '<RequireAuth>',
      'apiClient.inspiration.listConversations',
      'apiClient.inspiration.sendMessage',
      'apiClient.inspiration.replayEvents',
      'apiClient.inspiration.cancelRun',
      'apiClient.inspiration.importHistory',
      'window.localStorage.removeItem(key)',
      'apiClient.inspiration.createProjectPreview',
      'apiClient.inspiration.confirmProjectPreview',
    ],
  },
  {
    file: 'clients/apps/web/app/login/page.tsx',
    patterns: ['safeNextPath', 'router.replace(currentNextPath())', 'apiClient.getSession()', 'queryClient.clear()'],
  },
  {
    file: 'clients/apps/web/app/register/page.tsx',
    patterns: ['safeNextPath', "router.replace('/verify-email')", 'apiClient.getSession()', 'queryClient.clear()'],
  },
  {
    file: 'clients/apps/web/components/PricingPlans.tsx',
    patterns: ["router.push(loginPath('/pricing'))", 'checkoutProviders', 'channel: provider', 'router.push(`/account/orders/${encodeURIComponent(result.checkout_id)}`)'],
    forbidden: ["'production'", '"production"'],
  },
  {
    file: 'clients/apps/web/components/AccountDashboard.tsx',
    patterns: ['apiClient.updateProfile', 'apiClient.getAccountBootstrap', "queryKey: ['account-bootstrap'", 'SectionUnavailable', 'useReactTable', "lazy(() => import('./UsageTrendChart'))", '<Suspense', '/account/orders/'],
    forbidden: ['apiClient.getUsageTrend', 'apiClient.getNotifications', "from 'echarts'", "from 'echarts/core'"],
  },
  {
    file: 'clients/apps/web/components/UsageTrendChart.tsx',
    patterns: ["from 'echarts/charts'", "from 'echarts/components'", "from 'echarts/core'", "from 'echarts/renderers'", 'registerECharts([', 'const chart = init('],
    forbidden: ["from 'echarts'"],
  },
  {
    file: 'clients/apps/web/app/account/orders/[orderId]/page.tsx',
    patterns: ['<RequireAuth>', 'apiClient.getOrder', 'apiClient.confirmSimulatedPayment', 'refetchInterval', 'retryCheckout', 'expires_at'],
  },
]

for (const check of checks) {
  const absolutePath = join(root, check.file)
  assert(existsSync(absolutePath), `${check.file} is missing`)
  const source = read(check.file)
  for (const pattern of check.patterns) {
    assert(source.includes(pattern), `${check.file} missing ${pattern}`)
  }
  for (const pattern of check.forbidden ?? []) {
    assert(!source.includes(pattern), `${check.file} must not contain ${pattern}`)
  }
}

console.log(JSON.stringify({ ok: true, checked: checks.length }, null, 2))
