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
    patterns: ['<RequireAuth>', 'setAdvancedOpen', "queryKey: ['usage-trend']"],
  },
  {
    file: 'clients/apps/web/app/login/page.tsx',
    patterns: ['safeNextPath', 'router.replace(currentNextPath())', 'getAccessToken()'],
  },
  {
    file: 'clients/apps/web/app/register/page.tsx',
    patterns: ['safeNextPath', 'router.replace(currentNextPath())', 'getAccessToken()'],
  },
  {
    file: 'clients/apps/web/components/PricingPlans.tsx',
    patterns: ["router.push(loginPath('/pricing'))", 'isSimulatedPaymentEnabled', 'checkout.mutate', '/account/orders/'],
  },
  {
    file: 'clients/apps/web/components/AccountDashboard.tsx',
    patterns: ['apiClient.updateProfile', 'apiClient.getUsageTrend', 'apiClient.getNotifications', 'useReactTable', 'echarts.init', '/account/orders/'],
  },
  {
    file: 'clients/apps/web/app/account/orders/[orderId]/page.tsx',
    patterns: ['<RequireAuth>', 'apiClient.getOrder', 'apiClient.confirmSimulatedPayment'],
  },
]

for (const check of checks) {
  const absolutePath = join(root, check.file)
  assert(existsSync(absolutePath), `${check.file} is missing`)
  const source = read(check.file)
  for (const pattern of check.patterns) {
    assert(source.includes(pattern), `${check.file} missing ${pattern}`)
  }
}

console.log(JSON.stringify({ ok: true, checked: checks.length }, null, 2))
