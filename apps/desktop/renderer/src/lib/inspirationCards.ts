import type {
  AntiTropeVariant,
  CreativeCaseCard,
  CreativeCaseStudy,
  GenrePreset,
  InspirationCardKind,
  InspirationCardSourceKind,
  InspirationFavorite,
  Template,
} from '@sdns/core'

export interface InspirationCard {
  key: string
  kind: InspirationCardKind
  sourceKind: InspirationCardSourceKind
  sourceId?: string
  sourceTitle: string
  title: string
  pattern: string
  applyTo: string
  risk?: string
  favorite?: InspirationFavorite
}

export interface InspirationCardInput {
  genrePresets?: GenrePreset[]
  templates?: Template[]
  caseStudies?: CreativeCaseStudy[]
  antiTropeVariants?: AntiTropeVariant[]
  favorites?: InspirationFavorite[]
}

export const INSPIRATION_KIND_LABELS: Record<InspirationCardKind, string> = {
  opening: '爆款开局',
  relationship: '人物关系',
  conflict: '冲突机制',
  reversal: '反转',
  cliffhanger: '集尾悬念',
  visual: '视频画面卖点',
}

export const INSPIRATION_SOURCE_LABELS: Record<InspirationCardSourceKind, string> = {
  genre_preset: '类型库',
  case_study: '样本卡片',
  template: '模板',
  anti_trope: '反套路',
}

export function buildInspirationCards(input: InspirationCardInput): InspirationCard[] {
  const cards: InspirationCard[] = []
  for (const preset of input.genrePresets ?? []) cards.push(...cardsFromGenrePreset(preset))
  for (const template of input.templates ?? []) cards.push(cardFromTemplate(template))
  for (const study of input.caseStudies ?? []) cards.push(...cardsFromCaseStudy(study))
  for (const variant of input.antiTropeVariants ?? []) cards.push(cardFromAntiTropeVariant(variant))

  const favorites = new Map((input.favorites ?? []).map((favorite) => [favorite.cardKey, favorite]))
  const seen = new Set<string>()
  return cards
    .filter((card) => {
      if (!card.pattern.trim()) return false
      if (seen.has(card.key)) return false
      seen.add(card.key)
      return true
    })
    .map((card) => ({ ...card, favorite: favorites.get(card.key) }))
}

export function favoritePayloadFromCard(projectId: string, card: InspirationCard): Omit<InspirationFavorite, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    projectId,
    cardKey: card.key,
    sourceKind: card.sourceKind,
    sourceId: card.sourceId,
    kind: card.kind,
    title: card.title,
    pattern: card.pattern,
    applyTo: card.applyTo,
    risk: card.risk,
  }
}

export function formatInspirationCardForAdoption(card: InspirationCard): string {
  return [
    `【灵感卡片｜${INSPIRATION_KIND_LABELS[card.kind]}】${card.title}`,
    `来源：${INSPIRATION_SOURCE_LABELS[card.sourceKind]} / ${card.sourceTitle}`,
    `模式：${card.pattern}`,
    `可用于：${card.applyTo}`,
    card.risk ? `风险提示：${card.risk}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function appendInspirationCardNote(existing: string | undefined, card: InspirationCard): string {
  const next = formatInspirationCardForAdoption(card)
  const current = existing?.trim()
  if (!current) return next
  if (current.includes(`】${card.title}`) && current.includes(card.pattern)) return current
  return `${current}\n\n${next}`
}

function cardsFromGenrePreset(preset: GenrePreset): InspirationCard[] {
  return [
    ...arrayCards(preset.commonOpenings, preset, 'opening', '项目开局 / 第一章钩子'),
    ...arrayCards(preset.commonRelationships, preset, 'relationship', '人物关系 / 人物卡'),
    ...arrayCards(preset.commonHighlights, preset, 'conflict', '章节主冲突 / 爽点设计'),
    ...arrayCards(preset.commonReversals, preset, 'reversal', '章节反转 / 分集转折'),
    ...arrayCards(preset.commonCliffhangers, preset, 'cliffhanger', '章节末尾 / 集尾悬念'),
    makeCard({
      sourceKind: 'genre_preset',
      sourceId: preset.id,
      sourceTitle: preset.name,
      kind: 'visual',
      index: 0,
      title: `${preset.name} 视觉风格`,
      pattern: preset.visualStyle,
      applyTo: '项目视觉方向 / 视频画面基调',
      risk: preset.aiVideoRisks,
    }),
    makeCard({
      sourceKind: 'genre_preset',
      sourceId: preset.id,
      sourceTitle: preset.name,
      kind: 'visual',
      index: 1,
      title: `${preset.name} 镜头卖点`,
      pattern: preset.shotPromptAdvice,
      applyTo: '分镜 Prompt / 章节 AI 视频备注',
      risk: preset.aiVideoRisks,
    }),
  ]
}

function arrayCards(
  values: string[],
  preset: GenrePreset,
  kind: InspirationCardKind,
  applyTo: string,
): InspirationCard[] {
  return values.map((pattern, index) =>
    makeCard({
      sourceKind: 'genre_preset',
      sourceId: preset.id,
      sourceTitle: preset.name,
      kind,
      index,
      title: `${preset.name} ${INSPIRATION_KIND_LABELS[kind]} ${index + 1}`,
      pattern,
      applyTo,
      risk: preset.aiVideoRisks || undefined,
    }),
  )
}

function cardsFromCaseStudy(study: CreativeCaseStudy): InspirationCard[] {
  const cards = [
    ...caseArrayCards(study.openingHooks, study, 'opening', '项目开局 / 章节钩子'),
    ...caseArrayCards(study.relationshipPatterns, study, 'relationship', '人物关系 / 对手设计'),
    ...caseArrayCards(study.highlightBeats, study, 'conflict', '爽点段落 / 章节主冲突'),
    ...caseArrayCards(study.reversalMechanisms, study, 'reversal', '章节反转 / 剧情转折'),
    ...caseArrayCards(study.cliffhangers, study, 'cliffhanger', '章节末尾 / 集尾悬念'),
    ...caseArrayCards(study.visualPatterns, study, 'visual', '视频画面卖点 / 镜头提示'),
    ...(study.creativeCards ?? []).map((card, index) => cardFromCreativeCaseCard(study, card, index)),
  ]
  return cards.map((card) => ({
    ...card,
    risk: card.risk ?? (study.riskTags.length ? study.riskTags.join('；') : undefined),
  }))
}

function caseArrayCards(
  values: string[],
  study: CreativeCaseStudy,
  kind: InspirationCardKind,
  applyTo: string,
): InspirationCard[] {
  return values.map((pattern, index) =>
    makeCard({
      sourceKind: 'case_study',
      sourceId: study.id,
      sourceTitle: study.title,
      kind,
      index,
      title: `${study.title} ${INSPIRATION_KIND_LABELS[kind]} ${index + 1}`,
      pattern,
      applyTo,
      risk: study.riskTags.join('；') || undefined,
    }),
  )
}

function cardFromCreativeCaseCard(study: CreativeCaseStudy, card: CreativeCaseCard, index: number): InspirationCard {
  const kind = mapCaseCardKind(card.kind)
  return makeCard({
    sourceKind: 'case_study',
    sourceId: study.id,
    sourceTitle: study.title,
    kind,
    index: index + 1000,
    title: card.title,
    pattern: card.pattern,
    applyTo: card.applyTo,
    risk: card.risk ?? (study.riskTags.join('；') || undefined),
  })
}

function cardFromTemplate(template: Template): InspirationCard {
  const kind = inferTemplateKind(template)
  return makeCard({
    sourceKind: 'template',
    sourceId: template.id,
    sourceTitle: template.name,
    kind,
    index: 0,
    title: `模板：${template.name}`,
    pattern: excerpt(template.content, 320),
    applyTo: template.description || `${template.type}${template.scope ? ` / ${template.scope}` : ''}`,
  })
}

function cardFromAntiTropeVariant(variant: AntiTropeVariant): InspirationCard {
  const pattern = [
    variant.premise,
    variant.pressureMechanism ? `压力机制：${variant.pressureMechanism}` : '',
    variant.keyChanges.length ? `关键变化：${variant.keyChanges.join('；')}` : '',
    variant.preservedPayoffs.length ? `保留爽感：${variant.preservedPayoffs.join('；')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return makeCard({
    sourceKind: 'anti_trope',
    sourceId: variant.id,
    sourceTitle: variant.mode,
    kind: 'reversal',
    index: 0,
    title: `反套路：${variant.title}`,
    pattern,
    applyTo: variant.sampleRewrite ? `可替换片段：${excerpt(variant.sampleRewrite, 120)}` : '章节反转 / 冲突升级',
    risk: variant.risks.join('；') || undefined,
  })
}

function mapCaseCardKind(kind: CreativeCaseCard['kind']): InspirationCardKind {
  if (kind === 'hook') return 'opening'
  if (kind === 'highlight' || kind === 'rhythm') return 'conflict'
  return kind
}

function inferTemplateKind(template: Template): InspirationCardKind {
  const haystack = `${template.type} ${template.scope ?? ''} ${template.name} ${template.description ?? ''}`.toLowerCase()
  if (haystack.includes('shot') || haystack.includes('prompt') || haystack.includes('video') || haystack.includes('视觉')) return 'visual'
  if (haystack.includes('character') || haystack.includes('人物') || haystack.includes('关系')) return 'relationship'
  if (haystack.includes('reversal') || haystack.includes('反转')) return 'reversal'
  if (haystack.includes('cliffhanger') || haystack.includes('悬念')) return 'cliffhanger'
  if (haystack.includes('hook') || haystack.includes('开局') || haystack.includes('project')) return 'opening'
  return 'conflict'
}

function makeCard(input: Omit<InspirationCard, 'key'> & { index: number }): InspirationCard {
  const { index, ...card } = input
  return {
    ...card,
    key: [
      input.sourceKind,
      input.sourceId ?? input.sourceTitle,
      input.kind,
      String(index),
      input.title,
    ].map((part) => encodeURIComponent(part.trim())).join(':'),
  }
}

function excerpt(value: string, limit: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}...`
}
