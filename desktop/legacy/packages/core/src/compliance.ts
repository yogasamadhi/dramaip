export type ComplianceRuleSourceStatus = 'official' | 'consultation' | 'platform_guidance' | 'unknown'
export type ComplianceIntegrityStatus = 'verified' | 'unchecked' | 'invalid'

/** A versioned, offline rule profile. A profile is evidence, not legal advice or a platform approval. */
export interface ComplianceRuleProfile {
  id: string
  version: string
  title: string
  sourceUrl: string
  sourceStatus: ComplianceRuleSourceStatus
  publishedAt: string
  effectiveAt?: string
  regions: string[]
  platforms: string[]
  requiredVisibleLabel: string
  requiredMetadataKeys: string[]
  contentChecksum: string
  /** Ed25519 signature of the versioned offline rule pack, verified by the desktop main process. */
  signature: string
  integrityStatus: ComplianceIntegrityStatus
  active: boolean
  builtIn: boolean
  createdAt: string
  updatedAt: string
}

export interface BuiltInComplianceRuleProfile extends Omit<ComplianceRuleProfile, 'createdAt' | 'updatedAt'> {}

export interface CompliancePreflightInput {
  profile?: ComplianceRuleProfile
  targetPlatform?: string
  targetRegion?: string
  deliveryDate: string
  title: string
  subtitleLanguage: string
  aigcDeclared: boolean
  manualContentReviewConfirmed: boolean
  rightsStatus: 'pass' | 'warning' | 'blocked'
  qualityReportCurrent: boolean
  qualityBlockerCount: number
}

export interface CompliancePreflightResult {
  ok: boolean
  blockers: string[]
  warnings: string[]
  visibleLabel?: string
  metadata: Record<string, string>
  profileVersion?: string
}

/** IPC-safe description of a completed compliant delivery. It contains no local secrets. */
export interface EpisodeComplianceArchive {
  taskId: string
  mp4Path: string
  manifestPath: string
  sourceFingerprint: string
  profileVersion: string
  visibleLabel: string
  metadata: Record<string, string>
}

/** IPC-safe compliance preflight result. The main process owns all file and FFmpeg operations. */
export interface EpisodeCompliancePreflight extends CompliancePreflightResult {
  sourceFingerprint?: string
  profile?: ComplianceRuleProfile
  sourceMp4Path?: string
}

/**
 * The default is a released official profile. The consultation profile is retained as evidence
 * but intentionally cannot become an enforcement profile or delivery blocker by itself.
 */
export const BUILT_IN_COMPLIANCE_RULE_PROFILES: BuiltInComplianceRuleProfile[] = [
  {
    id: 'cn-aigc-identification-2025-09-01',
    version: 'cn-aigc-identification/2025-09-01',
    title: '中国生成合成内容标识办法（正式规则）',
    sourceUrl: 'https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm',
    sourceStatus: 'official',
    publishedAt: '2025-03-14',
    effectiveAt: '2025-09-01',
    regions: ['中国大陆'],
    platforms: [],
    requiredVisibleLabel: 'AI Generated',
    requiredMetadataKeys: ['sdns:aigc', 'sdns:rule-profile', 'sdns:source-fingerprint'],
    contentChecksum: 'sha256:fa22e0c2573148fac57fcee4206d5a7d6dc579c82ce5573ad3101748abce1110',
    signature: 'kFq5+BEjTf8yJKA+8F104vQPkWRrZ8AuF5/dfJF/AUNrEamIo7hWQ698rlQihU1dRJaK/nAko7qkRYUkPOQrDA==',
    integrityStatus: 'verified',
    active: true,
    builtIn: true,
  },
  {
    id: 'cn-microdrama-consultation-2026-06-24',
    version: 'cn-microdrama-consultation/2026-06-24',
    title: '微短剧发展管理办法（征求意见稿，仅作参考）',
    sourceUrl: 'https://www.nrta.gov.cn/art/2026/6/24/art_113_73514.html',
    sourceStatus: 'consultation',
    publishedAt: '2026-06-24',
    regions: ['中国大陆'],
    platforms: [],
    requiredVisibleLabel: 'AI Generated',
    requiredMetadataKeys: ['sdns:aigc', 'sdns:rule-profile', 'sdns:source-fingerprint'],
    contentChecksum: 'sha256:5712b31878848a52efd9b8e40b2a26101e5bf62dedfc0cf9d89e6a321df85ce9',
    signature: 'RFYw5kNla70f47gjGNgz/OmahTOuOZG5L1HjjG3MUiO4gcU6FzIw5t6/isO2I4FXlCodGESwHWpWlOeTWyJ0Bg==',
    integrityStatus: 'verified',
    active: false,
    builtIn: true,
  },
]

export function evaluateCompliancePreflight(input: CompliancePreflightInput): CompliancePreflightResult {
  const blockers: string[] = []
  const warnings: string[] = []
  const profile = input.profile
  if (!profile) blockers.push('没有可用的合规规则 Profile；未知规则不能静默放行交付。')
  else {
    if (profile.integrityStatus !== 'verified') blockers.push('规则 Profile 未通过本地完整性校验，不能用于最终交付。')
    if (profile.sourceStatus !== 'official') blockers.push('当前 Profile 不是正式规则，不能作为强制交付依据；征求意见稿仅可参考。')
    if (profile.effectiveAt && input.deliveryDate < profile.effectiveAt) warnings.push(`规则 Profile 将于 ${profile.effectiveAt} 生效；当前交付日期早于生效日，仍保留标识作为保守实践。`)
    if (profile.platforms.length && input.targetPlatform && !profile.platforms.includes(input.targetPlatform)) warnings.push(`Profile 未明确覆盖平台“${input.targetPlatform}”；请核对平台最新要求。`)
    if (profile.regions.length && input.targetRegion && !profile.regions.includes(input.targetRegion)) warnings.push(`Profile 未明确覆盖地区“${input.targetRegion}”；请使用对应地区的已验证 Profile。`)
  }
  if (!input.title.trim()) blockers.push('交付必须填写剧名。')
  if (!input.subtitleLanguage.trim()) blockers.push('交付必须声明字幕语言。')
  if (!input.aigcDeclared) blockers.push('请明确声明此交付包含 AI 生成/合成内容；系统不会替用户做该声明。')
  if (!input.manualContentReviewConfirmed) blockers.push('请完成未成年人、历史/民俗、版权、许可证/备案等人工内容复核后再交付。')
  if (input.rightsStatus === 'blocked') blockers.push('版权与授权预检未通过。')
  else if (input.rightsStatus === 'warning') warnings.push('版权与授权台账仍有待补充信息；请在交付前核对。')
  if (!input.qualityReportCurrent) blockers.push('媒体质检报告已过期或不可用；重新渲染后必须复检。')
  if (input.qualityBlockerCount > 0) blockers.push(`媒体质检仍有 ${input.qualityBlockerCount} 个 blocker；风险接受不会自动放行。`)

  const metadata = profile ? buildAigcMetadata({ profile, title: input.title, subtitleLanguage: input.subtitleLanguage }) : {}
  return { ok: blockers.length === 0, blockers, warnings, visibleLabel: profile?.requiredVisibleLabel, metadata, profileVersion: profile?.version }
}

export function buildAigcMetadata(input: { profile: ComplianceRuleProfile; title: string; subtitleLanguage: string; sourceFingerprint?: string }): Record<string, string> {
  return {
    'sdns:aigc': 'true',
    'sdns:rule-profile': input.profile.version,
    'sdns:rule-source': input.profile.sourceUrl,
    'sdns:source-fingerprint': input.sourceFingerprint ?? 'pending',
    'sdns:subtitle-language': input.subtitleLanguage,
    'title': input.title.trim(),
  }
}
