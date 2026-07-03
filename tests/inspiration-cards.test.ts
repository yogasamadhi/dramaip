import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AntiTropeVariant, CreativeCaseStudy, GenrePreset, InspirationFavorite, Template } from '../packages/core/src/types'
import {
  appendInspirationCardNote,
  buildInspirationCards,
  favoritePayloadFromCard,
  INSPIRATION_KIND_LABELS,
} from '../apps/desktop/renderer/src/lib/inspirationCards'

const now = '2026-01-01T00:00:00.000Z'

test('builds inspiration cards from genre presets, templates, case studies, and anti-trope variants', () => {
  const genrePreset: GenrePreset = {
    id: 'genre-1',
    name: '女频复仇',
    commonOpenings: ['婚礼现场被夺身份，女主当众拿出证据反击'],
    commonRelationships: ['真假千金互为镜像，一个抢身份一个抢命运'],
    commonHighlights: ['弱者被逼到台前，用公开证据完成第一轮反杀'],
    commonReversals: ['看似失去靠山，实则靠山正在直播间看完整场'],
    commonCliffhangers: ['男主认出女主旧物，却在片尾说她已经死过一次'],
    visualStyle: '豪门宴会、冷白灯、证据投屏',
    shotPromptAdvice: '竖屏近景切证据投屏和围观反应',
    aiVideoRisks: '群演多，注意镜头聚焦',
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  }
  const template: Template = {
    id: 'tpl-1',
    name: '章节冲突模板',
    type: 'chapter',
    scope: 'generate_chapter',
    content: '本章必须包含压迫、误判、公开反击、尾钩。',
    variables: [],
    builtIn: true,
    createdAt: now,
    updatedAt: now,
  }
  const caseStudy: CreativeCaseStudy = {
    id: 'case-1',
    title: '样本结构',
    openingHooks: ['第一屏给结果，第二屏倒回原因'],
    relationshipPatterns: [],
    highlightBeats: [],
    reversalMechanisms: [],
    cliffhangers: [],
    visualPatterns: ['用一件可识别道具贯穿身份反转'],
    rhythmCurve: [8, 6, 9],
    creativeCards: [{ kind: 'cliffhanger', title: '尾钩卡', pattern: '门外人听到秘密', applyTo: '集尾' }],
    riskTags: ['避免照搬样本句子'],
    createdAt: now,
    updatedAt: now,
  }
  const antiTrope: AntiTropeVariant = {
    id: 'anti-1',
    projectId: 'p1',
    targetKind: 'chapter',
    targetId: 'c1',
    mode: 'balanced',
    title: '不靠误会拖延',
    premise: '误会当场解开，新的冲突来自代价',
    pressureMechanism: '女主必须公开证据，同时牺牲一个盟友身份',
    preservedPayoffs: ['公开反击', '身份压迫'],
    keyChanges: ['从误会改成代价选择'],
    risks: ['信息量偏高'],
    createdAt: now,
  }
  const favorites: InspirationFavorite[] = [
    {
      id: 'fav-1',
      projectId: 'p1',
      cardKey: 'genre_preset:genre-1:opening:0:%E5%A5%B3%E9%A2%91%E5%A4%8D%E4%BB%87%20%E7%88%86%E6%AC%BE%E5%BC%80%E5%B1%80%201',
      sourceKind: 'genre_preset',
      sourceId: 'genre-1',
      kind: 'opening',
      title: '女频复仇 爆款开局 1',
      pattern: genrePreset.commonOpenings[0],
      applyTo: '项目开局 / 第一章钩子',
      createdAt: now,
      updatedAt: now,
    },
  ]

  const cards = buildInspirationCards({
    genrePresets: [genrePreset],
    templates: [template],
    caseStudies: [caseStudy],
    antiTropeVariants: [antiTrope],
    favorites,
  })

  for (const kind of Object.keys(INSPIRATION_KIND_LABELS)) {
    assert.ok(cards.some((card) => card.kind === kind), `${kind} card should exist`)
  }
  assert.ok(cards.some((card) => card.sourceKind === 'template' && card.kind === 'conflict'))
  assert.ok(cards.some((card) => card.sourceKind === 'anti_trope' && card.pattern.includes('代价选择')))
  assert.ok(cards.some((card) => card.favorite?.id === 'fav-1'))
})

test('creates favorite payloads and appends adoption notes without duplicates', () => {
  const [card] = buildInspirationCards({
    genrePresets: [
      {
        id: 'genre-1',
        name: '悬疑反转',
        commonOpenings: ['尸检结果先出现，凶手却在镜头外说话'],
        commonRelationships: [],
        commonHighlights: [],
        commonReversals: [],
        commonCliffhangers: [],
        visualStyle: '',
        shotPromptAdvice: '',
        aiVideoRisks: '',
        builtIn: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
  })

  const payload = favoritePayloadFromCard('p1', card)
  assert.equal(payload.projectId, 'p1')
  assert.equal(payload.cardKey, card.key)
  assert.equal(payload.kind, 'opening')

  const note = appendInspirationCardNote('原有要求', card)
  assert.match(note, /原有要求/)
  assert.match(note, /灵感卡片/)
  assert.equal(appendInspirationCardNote(note, card), note)
})

test('renders mobile imported favorites as inspiration cards', () => {
  const favorites: InspirationFavorite[] = [
    {
      id: 'fav-mobile',
      projectId: 'p1',
      cardKey: 'mobile_import:mobile%3Aphone.md:visual:abc123',
      sourceKind: 'mobile_import',
      sourceId: 'mobile:phone.md',
      kind: 'visual',
      title: '雨夜车窗倒影',
      pattern: '男主只在车窗倒影中露出半张脸。',
      applyTo: '封面首帧 / 分镜 Prompt',
      createdAt: now,
      updatedAt: now,
    },
  ]

  const cards = buildInspirationCards({ favorites })

  assert.equal(cards.length, 1)
  assert.equal(cards[0].sourceKind, 'mobile_import')
  assert.equal(cards[0].sourceTitle, 'phone.md')
  assert.equal(cards[0].favorite?.id, 'fav-mobile')
})
