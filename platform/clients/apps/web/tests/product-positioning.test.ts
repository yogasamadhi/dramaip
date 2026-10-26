import assert from 'node:assert/strict'
import { test } from "vitest"
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import HomePage from '../app/page'
import CasesPage from '../app/cases/page'
import StoryCasePage from '../app/cases/story/page'
import DemoCasePage from '../app/cases/demo/page'
import { ADAPTATION_JOURNEY, NOVEL_JOURNEY, PLAN_DESCRIPTIONS, PRODUCT_POSITIONING, desktopReleaseInfo } from '../lib/product-positioning'
import { PlanCard } from '../components/PricingPlans'
import { pricingEntitlementRows } from '../lib/pricing-entitlements'
import PricingPage from '../app/pricing/page'
import { PlanSchema } from '@dramaip/sdk'

test('public positioning preserves independent novel outcomes and labels planned adaptation stages', () => {
  const html = renderToStaticMarkup(createElement(HomePage))
  for (const text of [PRODUCT_POSITIONING.category, PRODUCT_POSITIONING.novelHeadline, '小说可以独立完成', '优化目标', '目标路径']) assert.ok(html.includes(text))
  assert.ok(!html.includes('一致性 94%'))
  assert.ok(!html.includes('下载 v2 RC'))
  for (const stage of ADAPTATION_JOURNEY) assert.ok(html.includes(stage.title))
  for (const stage of NOVEL_JOURNEY) assert.ok(html.includes(stage))
})

test('story example and production demo are separate, with no fake model/adoption evidence', () => {
  const index = renderToStaticMarkup(createElement(CasesPage))
  assert.ok(index.includes('/cases/story'))
  assert.ok(index.includes('/cases/demo'))
  const story = renderToStaticMarkup(createElement(StoryCasePage))
  for (const text of ['作者编写', '不是已运行的 AI', '小说可以在这里独立完成', '策略 A', '策略 B', '三集季纲', '首集剧本', '首集分镜', '局部影响']) assert.ok(story.includes(text))
  assert.ok(PLAN_DESCRIPTIONS.free.includes('小说'))
  assert.ok(PLAN_DESCRIPTIONS.creator.includes('不要求先做视频'))
})

test('download configuration cannot manufacture a version or release readiness', () => {
  const missing = desktopReleaseInfo({})
  assert.equal(missing.configured, false)
  assert.equal(missing.version, undefined)
  const valid = { url: 'https://downloads.test/releases', version: '3.0.0-alpha.3', sha256: 'a'.repeat(64) }
  assert.equal(desktopReleaseInfo(valid).configured, true)
  for (const input of [
    { ...valid, version: '' }, { ...valid, sha256: 'not-a-hash' },
    { ...valid, url: 'http://downloads.test/releases' },
    { ...valid, url: 'https://example.invalid/release' },
    { ...valid, url: 'https://user:password@downloads.test/release' },
  ]) assert.equal(desktopReleaseInfo(input).configured, false)
})

test('historical controlled case does not certify current installation, model quality, costs or authorization', () => {
  const demo = renderToStaticMarkup(createElement(DemoCasePage))
  for (const text of ['历史受控展示', '不证明当前安装已包含', '不是实际模型质量或账单', '未提供完整可核验授权凭证']) assert.ok(demo.includes(text))
  for (const text of ['随桌面端安装', '全部许可记录', '原结果、成本', '完全虚构，不含第三方 IP', '均附自有或可再分发许可', '看完整生产闭环']) assert.ok(!demo.includes(text))
  const story = renderToStaticMarkup(createElement(StoryCasePage))
  assert.ok(!story.includes('允许复制与改编'))
  assert.ok(story.includes('展示稿不代替公开许可或真实验收'))
})

function pricingPlan() {
  return PlanSchema.parse({ id: 'creator', name: 'Creator', price_cny: 19, quota_tokens: 0, description: '',
    entitlements: { included_seats: 0, byok_enabled: false, offline_review_enabled: false, advanced_export_enabled: false,
      cloud_review_enabled: false, review_storage_bytes: 1_000_000_000, review_retention_days: 30, private_gateway_enabled: false } })
}

test('pricing cards read every real entitlement and do not invent BYOK, offline review or custom seats', () => {
  const plan = pricingPlan()
  const html = renderToStaticMarkup(createElement(PlanCard, { plan, current: false, pending: false, disabled: true, onChoose: () => undefined }))
  for (const text of ['平台 BYOK：未包含', '离线审片资料：未包含', '高级交换格式：未包含', '云审片容量与保留期：未包含', '包含席位：0', '私有模型网关：未包含']) assert.ok(html.includes(text))
  for (const text of ['本地项目无限', '标准媒体与离线审片导出', '正式剪辑工程导出', '自定义', '1 GB']) assert.ok(!html.includes(text))
  assert.ok(html.includes('disabled'))
})

test('pricing groups existing fields by outcomes without turning the same plan name into a grant', () => {
  const plan = pricingPlan()
  const before = structuredClone(plan)
  assert.equal(pricingEntitlementRows(plan.entitlements).length, 6)
  assert.deepEqual(plan, before)
  plan.entitlements.byok_enabled = true
  plan.entitlements.offline_review_enabled = true
  plan.entitlements.cloud_review_enabled = true
  plan.entitlements.included_seats = 2
  const rows = pricingEntitlementRows(plan.entitlements)
  assert.equal(rows[0].value, '包含')
  assert.equal(rows[1].value, '包含')
  assert.equal(rows[2].value, '未包含')
  assert.equal(rows[3].value, '1 GB · 30 天')
  assert.equal(rows[4].value, '2')
  assert.equal(rows[5].value, '未包含')
  // This assertion covers the actual static introduction; PricingPlans needs
  // Next's router/query providers and is additionally checked by the Web build.
  const intro = PricingPage().props.children.filter((child: { type: unknown }) => typeof child.type === 'string')
  const html = renderToStaticMarkup(createElement('div', null, ...intro))
  for (const text of ['创作资源、审阅交换', '不要求小说作者先改编', '不是 Desktop 本地功能的授权表', '不保证文学质量或发行就绪']) assert.ok(html.includes(text))
})
