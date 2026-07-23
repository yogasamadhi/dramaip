export type PlatformDeliveryProfileSource = 'internal_master' | 'platform_portal' | 'unknown'
export type DeliveryCreativeVariantStatus = 'candidate' | 'adopted' | 'archived'

export interface PlatformDeliveryProfile {
  id: string
  version: string
  title: string
  platform: string
  region: string
  sourceUrl: string
  sourceStatus: PlatformDeliveryProfileSource
  checkedAt: string
  filenamePrefix: string
  video: { width: number; height: number; videoCodec: string; audioCodec: string }
  duration: { status: 'verified' | 'manual'; minSeconds?: number; maxSeconds?: number; note: string }
  subtitleSafeZone: { bottomMarginPx: number; note: string }
  requiredListingFields: Array<'title' | 'description' | 'tags' | 'cover'>
  manualFields: string[]
}

export interface DeliveryCreativeVariant {
  id: string
  projectId: string
  adaptationProjectId: string
  label: string
  title: string
  description: string
  tags: string[]
  coverAssetId?: string
  source: 'manual' | 'ai_draft'
  status: DeliveryCreativeVariantStatus
  versionNumber: number
  createdAt: string
  updatedAt: string
}

export interface PlatformDeliveryExport {
  id: string
  projectId: string
  adaptationProjectId: string
  episodeId: string
  profileId: string
  profileVersion: string
  creativeVariantId: string
  complianceTaskId: string
  deliveryVersion: number
  outputDirectory: string
  manifestPath: string
  sourceFingerprint: string
  createdAt: string
}

/**
 * These profiles describe only what the app can verify locally. Platform-side form fields are
 * intentionally listed as manual instead of being guessed from unofficial creator folklore.
 */
export const BUILT_IN_PLATFORM_DELIVERY_PROFILES: PlatformDeliveryProfile[] = [
  {
    id: 'sdns-vertical-master-2026-07', version: 'sdns-vertical-master/2026-07', title: 'SDNS 竖屏母版交付',
    platform: '通用外部精剪/发布', region: '通用', sourceUrl: 'urn:sdns:episode-render-master', sourceStatus: 'internal_master', checkedAt: '2026-07-23',
    filenamePrefix: 'sdns-master', video: { width: 720, height: 1280, videoCodec: 'H.264', audioCodec: 'AAC' },
    duration: { status: 'manual', note: '成片时长由当前分集策划与外部精剪确认。' }, subtitleSafeZone: { bottomMarginPx: 150, note: '与本地字幕烧录安全边距一致。' },
    requiredListingFields: ['title', 'description', 'tags', 'cover'], manualFields: ['外部精剪后的最终发布规格确认'],
  },
  {
    id: 'douyin-manual-submission-2026-07', version: 'douyin-manual-submission/2026-07', title: '抖音人工提交包',
    platform: '抖音', region: '中国大陆', sourceUrl: 'https://creator.douyin.com/', sourceStatus: 'platform_portal', checkedAt: '2026-07-23',
    filenamePrefix: 'douyin', video: { width: 720, height: 1280, videoCodec: 'H.264', audioCodec: 'AAC' },
    duration: { status: 'manual', note: '以提交时创作后台的实时限制为准，应用不猜测。' }, subtitleSafeZone: { bottomMarginPx: 150, note: '提交前请在平台预览中人工确认字幕不被 UI 遮挡。' },
    requiredListingFields: ['title', 'description', 'tags', 'cover'], manualFields: ['发布后台当前视频规格与时长限制', '内容分类、资质/备案与广告声明', '发布前平台审核结果'],
  },
  {
    id: 'hongguo-manual-submission-2026-07', version: 'hongguo-manual-submission/2026-07', title: '红果人工提交包',
    platform: '红果短剧', region: '中国大陆', sourceUrl: 'https://www.hongguo.com/', sourceStatus: 'platform_portal', checkedAt: '2026-07-23',
    filenamePrefix: 'hongguo', video: { width: 720, height: 1280, videoCodec: 'H.264', audioCodec: 'AAC' },
    duration: { status: 'manual', note: '以当前合作/投稿入口要求为准，应用不猜测。' }, subtitleSafeZone: { bottomMarginPx: 150, note: '提交前请在平台预览中人工确认字幕不被 UI 遮挡。' },
    requiredListingFields: ['title', 'description', 'tags', 'cover'], manualFields: ['当前合作/投稿入口资格', '分集、版权、资质/备案与审核字段', '发布前平台审核结果'],
  },
]

export interface PlatformDeliveryPreflightInput {
  profile?: PlatformDeliveryProfile
  title: string
  description: string
  tags: string[]
  hasCover: boolean
  complianceCurrent: boolean
  media: { width?: number; height?: number; videoCodec?: string; audioCodec?: string }
  manualFieldsConfirmed: boolean
}

export interface PlatformDeliveryPreflightResult {
  ok: boolean
  blockers: string[]
  warnings: string[]
  expectedFiles: string[]
  finalBaseName?: string
}

export interface PlatformDeliveryPreflight extends PlatformDeliveryPreflightResult {
  profile?: PlatformDeliveryProfile
  sourceFingerprint?: string
  complianceTaskId?: string
  media?: PlatformDeliveryPreflightInput['media']
}

export function evaluatePlatformDeliveryPreflight(input: PlatformDeliveryPreflightInput): PlatformDeliveryPreflightResult {
  const blockers: string[] = []
  const warnings: string[] = []
  const profile = input.profile
  if (!profile) blockers.push('未找到平台交付 Profile；未知规则不能创建交付包。')
  if (!input.complianceCurrent) blockers.push('必须选择当前且通过合规 Gate 的 MP4；历史或过期合规文件不能重新打包为当前交付。')
  if (!input.title.trim()) blockers.push('交付文案必须填写标题。')
  if (!input.description.trim()) blockers.push('交付文案必须填写简介。')
  if (!input.tags.map((tag) => tag.trim()).filter(Boolean).length) blockers.push('交付文案至少需要一个标签。')
  if (!input.hasCover) blockers.push('请选择可用且已纳入权利台账的封面资产。')
  if (profile) {
    if (input.media.width !== profile.video.width || input.media.height !== profile.video.height) blockers.push(`成片画幅不符合 Profile：期望 ${profile.video.width}×${profile.video.height}。`)
    if (input.media.videoCodec && !input.media.videoCodec.toLowerCase().includes('h264')) warnings.push(`检测到视频编码“${input.media.videoCodec}”；当前 Profile 以 ${profile.video.videoCodec} 母版为基线，请人工复核。`)
    if (input.media.audioCodec && !input.media.audioCodec.toLowerCase().includes('aac')) warnings.push(`检测到音频编码“${input.media.audioCodec}”；当前 Profile 以 ${profile.video.audioCodec} 母版为基线，请人工复核。`)
    if (profile.manualFields.length && !input.manualFieldsConfirmed) blockers.push(`请确认人工核对：${profile.manualFields.join('；')}。`)
  }
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    expectedFiles: ['episode.mp4', 'subtitles.srt', 'cover', 'listing.json', 'rights-preflight.json', 'compliance-manifest.json', 'quality-report.json', 'checksums.sha256'],
    finalBaseName: profile ? `${profile.filenamePrefix}-${safeFilename(input.title)}` : undefined,
  }
}

export function safeFilename(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '-').slice(0, 80) || 'untitled'
}
