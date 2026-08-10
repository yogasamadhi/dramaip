import { BUILT_IN_GENRE_PRESETS } from './genre-presets'

/** 数据来源类型只说明证据性质，不把研究结论伪装成实时平台榜单。 */
export type GenreMarketSourceKind = 'official_report' | 'research_report' | 'user_imported' | 'unknown'
export type GenreMarketStatus = 'hot' | 'rising' | 'steady' | 'classic' | 'saturated'
export type GenreAudience = 'female' | 'male' | 'general'
export type GenrePresentation = 'ai_animation' | 'live_action'
export type GenreProductionCost = 'low' | 'medium' | 'high'
export type GenreSaturation = 'low' | 'medium' | 'high'

export interface GenreMarketSource {
  kind: GenreMarketSourceKind
  label: string
  url?: string
  publishedAt?: string
  accessedAt: string
  note?: string
}

export interface GenreOpportunity {
  id: string
  genreName: string
  status: GenreMarketStatus
  audiences: GenreAudience[]
  presentations: GenrePresentation[]
  platforms: string[]
  productionCost: GenreProductionCost
  saturation: GenreSaturation
  whyRecommended: string[]
  primaryRisks: string[]
  differentiationIdeas: string[]
}

export interface GenreMarketSnapshot {
  version: string
  observedAt: string
  sources: GenreMarketSource[]
  opportunities: GenreOpportunity[]
}

export interface GenreOpportunitySelection {
  snapshotVersion: string
  snapshotObservedAt: string
  opportunity: GenreOpportunity
}

const SNAPSHOT_OBSERVED_AT = '2026-07-22'

const SOURCE_SUMMARY: GenreMarketSource[] = [
  {
    kind: 'research_report',
    label: '2026 中国 AI 短剧行业发展与受众洞察报告',
    url: 'https://pdf.dfcfw.com/pdf/H3_AP202604101821108151_1.pdf?1775812269000.pdf=',
    publishedAt: '2026-04-10',
    accessedAt: SNAPSHOT_OBSERVED_AT,
    note: '用于离线方向判断；不代表任何平台的实时榜单、保量或收益承诺。',
  },
  {
    kind: 'research_report',
    label: '2025 中国网络文学发展研究报告',
    url: 'https://www.cssn.cn/skgz/bwyc/202604/t20260420_5981165.shtml',
    publishedAt: '2026-04-20',
    accessedAt: SNAPSHOT_OBSERVED_AT,
    note: '用于识别网络文学题材细分与创作趋势，不采集私有榜单。',
  },
  {
    kind: 'official_report',
    label: '微短剧精品创作传播计划实施方案',
    url: 'https://www.nrta.gov.cn/art/2026/5/26/art_113_73378.html',
    publishedAt: '2026-05-26',
    accessedAt: SNAPSHOT_OBSERVED_AT,
    note: '用于识别原创、全流程管理与内容审核方向，不作为市场热度排序依据。',
  },
]

const STATUS_BY_NAME: Record<string, GenreMarketStatus> = {
  '奇幻玄幻·修仙逆袭': 'hot',
  '游戏系统·副本升级': 'rising',
  '末世求生·领地经营': 'hot',
  '悬疑灵异·民俗奇谭': 'rising',
  '规则怪谈·无限流': 'hot',
  '兽态进化·非人主角': 'rising',
  '古风女频·重生复仇': 'hot',
  '年代乡村·经营逆袭': 'steady',
  '萌宝团宠·奇能破局': 'steady',
  '恋综娱乐圈·穿越逆袭': 'rising',
  '乙女游戏·多男主攻略': 'hot',
  '真假千金·豪门复仇': 'saturated',
  '青春校园·甜宠成长': 'classic',
  '霸总虐恋·追妻火葬场': 'saturated',
}

function opportunityFor(genreName: string, index: number): GenreOpportunity {
  const status = STATUS_BY_NAME[genreName] ?? 'steady'
  const maleFocused = /玄幻|游戏|末世|规则|兽态/.test(genreName)
  const femaleFocused = /女频|萌宝|恋综|乙女|千金|校园|霸总/.test(genreName)
  const aiAnimationFirst = /玄幻|游戏|末世|灵异|规则|兽态|乙女/.test(genreName)
  const highCost = /玄幻|末世|灵异|规则|兽态/.test(genreName)
  const highSaturation = status === 'saturated'

  return {
    id: `genre-market-20260722-${String(index + 1).padStart(2, '0')}`,
    genreName,
    status,
    audiences: maleFocused ? ['male', 'general'] : femaleFocused ? ['female', 'general'] : ['general'],
    presentations: aiAnimationFirst ? ['ai_animation', 'live_action'] : ['live_action', 'ai_animation'],
    platforms: ['短剧 App', '短视频竖屏', ...(aiAnimationFirst ? ['AI 漫剧'] : [])],
    productionCost: highCost ? 'high' : /恋综|校园|年代|豪门|霸总/.test(genreName) ? 'medium' : 'low',
    saturation: highSaturation ? 'high' : status === 'hot' ? 'medium' : 'low',
    whyRecommended: [
      `${genreName}具备清晰的开局承诺、连续升级或关系推进，适合拆成短集钩子。`,
      aiAnimationFirst ? '世界观和视觉符号可先固化为资产包，适合 AI 漫剧的可控试播。' : '人物关系和情绪反应易先用低成本试播验证。',
    ],
    primaryRisks: [
      highCost ? '奇观、群像或复杂动作会显著抬高素材与一致性成本。' : '同类供给较多，若只复刻套路会降低点击与留存差异。',
      highSaturation ? '题材已高度饱和，必须先验证反套路钩子和角色差异点。' : '市场状态是离线快照，发布前应自行复核目标平台受众。',
    ],
    differentiationIdeas: [
      '把主角目标、代价和每集升级规则写成可检查的因果链，而不是只堆叠爽点。',
      aiAnimationFirst ? '先为角色、法器/技能或怪物建立可复用视觉锚点，再扩展大场面。' : '用明确职业、地域或关系困境替代泛化的人设与场景。',
    ],
  }
}

export const DEFAULT_GENRE_MARKET_SNAPSHOT: GenreMarketSnapshot = {
  version: 'cn-ai-drama-market-2026-07-22-v1',
  observedAt: SNAPSHOT_OBSERVED_AT,
  sources: SOURCE_SUMMARY,
  opportunities: BUILT_IN_GENRE_PRESETS.map((preset, index) => opportunityFor(preset.name, index)),
}

export function selectGenreOpportunity(
  snapshot: GenreMarketSnapshot,
  opportunityId: string | undefined,
): GenreOpportunity | undefined {
  return snapshot.opportunities.find((item) => item.id === opportunityId)
}

export function createGenreOpportunitySelection(
  snapshot: GenreMarketSnapshot,
  opportunity: GenreOpportunity,
): GenreOpportunitySelection {
  return {
    snapshotVersion: snapshot.version,
    snapshotObservedAt: snapshot.observedAt,
    opportunity: structuredClone(opportunity),
  }
}

/** 用于手动离线导入前的最小校验；不请求网络，也不接受缺少出处日期的“实时热榜”。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const MARKET_STATUSES = new Set<GenreMarketStatus>(['hot', 'rising', 'steady', 'classic', 'saturated'])
const MARKET_AUDIENCES = new Set<GenreAudience>(['female', 'male', 'general'])
const MARKET_PRESENTATIONS = new Set<GenrePresentation>(['ai_animation', 'live_action'])
const MARKET_COSTS = new Set<GenreProductionCost>(['low', 'medium', 'high'])
const MARKET_SATURATIONS = new Set<GenreSaturation>(['low', 'medium', 'high'])
const MARKET_SOURCE_KINDS = new Set<GenreMarketSourceKind>(['official_report', 'research_report', 'user_imported', 'unknown'])

/**
 * 用于手动离线导入前的最小校验；不请求网络，也不接受缺少出处日期的“实时热榜”。
 * 入参保持为 unknown，避免 IPC 或 JSON 文件绕开 TypeScript 后让无效结构直接落库。
 */
export function validateGenreMarketSnapshot(input: unknown): GenreMarketSnapshot {
  if (!isRecord(input) || typeof input.version !== 'string' || !/^cn-ai-drama-market-\d{4}-\d{2}-\d{2}-v\d+$/.test(input.version)) {
    throw new Error('市场快照版本格式无效')
  }
  if (
    typeof input.observedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.observedAt) ||
    !Array.isArray(input.sources) ||
    input.sources.length === 0 ||
    !Array.isArray(input.opportunities) ||
    input.opportunities.length === 0
  ) {
    throw new Error('市场快照必须包含日期和来源')
  }

  for (const source of input.sources) {
    if (
      !isRecord(source) ||
      typeof source.kind !== 'string' ||
      !MARKET_SOURCE_KINDS.has(source.kind as GenreMarketSourceKind) ||
      typeof source.label !== 'string' ||
      !source.label.trim() ||
      typeof source.accessedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(source.accessedAt)
    ) {
      throw new Error('市场快照来源信息无效')
    }
  }

  const ids = new Set<string>()
  for (const item of input.opportunities) {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      typeof item.genreName !== 'string' ||
      !item.id ||
      !item.genreName ||
      ids.has(item.id) ||
      typeof item.status !== 'string' ||
      !MARKET_STATUSES.has(item.status as GenreMarketStatus) ||
      !Array.isArray(item.audiences) ||
      !item.audiences.every((value) => typeof value === 'string' && MARKET_AUDIENCES.has(value as GenreAudience)) ||
      !Array.isArray(item.presentations) ||
      !item.presentations.every((value) => typeof value === 'string' && MARKET_PRESENTATIONS.has(value as GenrePresentation)) ||
      !Array.isArray(item.platforms) ||
      !item.platforms.every((value) => typeof value === 'string' && value.trim()) ||
      typeof item.productionCost !== 'string' ||
      !MARKET_COSTS.has(item.productionCost as GenreProductionCost) ||
      typeof item.saturation !== 'string' ||
      !MARKET_SATURATIONS.has(item.saturation as GenreSaturation) ||
      !Array.isArray(item.whyRecommended) ||
      !Array.isArray(item.primaryRisks) ||
      !Array.isArray(item.differentiationIdeas) ||
      !item.whyRecommended.every((value) => typeof value === 'string' && value.trim()) ||
      !item.primaryRisks.every((value) => typeof value === 'string' && value.trim()) ||
      !item.differentiationIdeas.every((value) => typeof value === 'string' && value.trim())
    ) {
      throw new Error('市场机会项必须说明推荐依据、风险和差异化建议')
    }
    ids.add(item.id)
  }
  return structuredClone(input as unknown as GenreMarketSnapshot)
}

/** 新快照只要通过校验即可离线并存；回退只是选择历史版本，不会删除用户自定义题材。 */
export function resolveGenreMarketSnapshot(
  snapshots: GenreMarketSnapshot[],
  version?: string,
): GenreMarketSnapshot | undefined {
  const valid = snapshots.map(validateGenreMarketSnapshot)
  return version ? valid.find((snapshot) => snapshot.version === version) : valid.at(-1)
}
