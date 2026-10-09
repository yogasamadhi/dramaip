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
    patterns: ["router.push(loginPath('/pricing'))", 'apiClient.getPaymentProviders()', ".filter((item) => item.state === 'verified')", 'apiClient.createOrder({', 'planCode,', 'provider,', "idempotencyKey: lifecycleKey('web-order-create')", 'router.push(`/account/orders/${encodeURIComponent(result.id)}`)'],
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
    patterns: ['<RequireAuth>', 'apiClient.getOrder', 'apiClient.confirmSimulatedPayment', 'refetchInterval', 'retryCheckout', 'order.data.paymentExpiresAt', "enabledProviders.has('simulated')"],
  },
  {
    file: 'clients/apps/web/app/page.tsx',
    patterns: ['PRODUCT_POSITIONING.category', 'ADAPTATION_JOURNEY', 'NOVEL_JOURNEY', '目标路径', 'href="/cases"'],
    forbidden: ['一致性 94%', '下载 v2 RC'],
  },
  {
    file: 'clients/apps/web/app/cases/page.tsx',
    patterns: ['href="/cases/story"', 'href="/cases/demo"', 'Mock Provider', '作者编写'],
  },
  {
    file: 'clients/apps/web/app/download/page.tsx',
    patterns: ['desktopReleaseInfo', '未配置', '配置完整也不等于三平台 GA'],
  },
  {
    file: 'clients/apps/web/app/cases/demo/page.tsx',
    patterns: ['历史受控展示', '不证明当前安装已包含', '不是实际模型质量或账单', '未提供完整可核验授权凭证'],
    forbidden: ['随桌面端安装', '全部许可记录', '完全虚构，不含第三方 IP', '均附自有或可再分发许可'],
  },
  {
    file: 'clients/apps/web/app/cases/story/page.tsx',
    patterns: ['展示稿不代替公开许可或真实验收', '小说可以在这里独立完成', '作者编写'],
    forbidden: ['允许复制与改编'],
  },
  {
    file: 'clients/apps/web/app/cases/story/files/[artifact]/route.ts',
    patterns: ["dynamic = 'force-static'", 'dynamicParams = false', 'STORY_CASE_ARTIFACTS', 'storyCaseArtifact(name)', 'Content-Disposition', 'author-written-fictional', 'nosniff'],
    forbidden: ['apiClient', '/api/v1/', 'process.env', 'readFile', 'fetch('],
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
