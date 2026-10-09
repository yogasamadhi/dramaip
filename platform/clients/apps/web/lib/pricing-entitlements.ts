import type { PlanEntitlements } from '@dramaip/sdk'

/** Presentation of the current Platform plan, never a Desktop license or an entitlement grant. */
export function pricingEntitlementRows(entitlements: PlanEntitlements) {
  const enabled = (value: boolean) => value === true ? '包含' : '未包含'
  const storage = (bytes: number) => bytes >= 1_000_000_000
    ? `${Math.round(bytes / 1_000_000_000)} GB`
    : `${Math.round(bytes / 1_000_000)} MB`
  return [
    { id: 'byok', group: '模型接入', label: '平台 BYOK', value: enabled(entitlements.byok_enabled) },
    { id: 'offline-review', group: '审阅与交付', label: '离线审片资料', value: enabled(entitlements.offline_review_enabled) },
    { id: 'advanced-export', group: '审阅与交付', label: '高级交换格式', value: enabled(entitlements.advanced_export_enabled) },
    { id: 'cloud-review', group: '可选协作', label: '云审片容量与保留期', value: entitlements.cloud_review_enabled === true ? `${storage(entitlements.review_storage_bytes)} · ${entitlements.review_retention_days} 天` : '未包含' },
    { id: 'seats', group: '可选协作', label: '包含席位', value: String(entitlements.included_seats) },
    { id: 'private-gateway', group: '团队治理', label: '私有模型网关', value: enabled(entitlements.private_gateway_enabled) },
  ] as const
}
