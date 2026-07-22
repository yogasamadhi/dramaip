/**
 * LM5-00 production baseline.
 *
 * This is deliberately a description of the product's verified starting
 * point, not a feature flag or a promise that an unavailable route works.
 * Subsequent LM5 loops change individual entries only when the matching
 * user-facing path and its acceptance checks are implemented.
 */
export type OutcomeBaselineState = 'available' | 'known_gap'

export interface OutcomeJourneyBaseline {
  id: 'idea_to_novel' | 'existing_manuscript_to_drama' | 'direct_script_to_drama'
  name: string
  state: OutcomeBaselineState
  entryRoute?: string
  currentOutcome: string
  missingCapabilities: string[]
}

export interface ProductionTruthBaseline {
  content: OutcomeBaselineState
  visualAssets: OutcomeBaselineState
  sound: OutcomeBaselineState
  video: OutcomeBaselineState
  finalDelivery: OutcomeBaselineState
  notes: string[]
}

export interface ProductionOutcomeBaseline {
  version: 1
  journeys: OutcomeJourneyBaseline[]
  productionTruth: ProductionTruthBaseline
  operationalTruth: {
    coverage: OutcomeBaselineState
    blockingState: OutcomeBaselineState
    budget: OutcomeBaselineState
    rights: OutcomeBaselineState
    providerAvailability: OutcomeBaselineState
  }
  privacyBoundary: {
    diagnosticContentDefault: 'redacted'
    rendererCredentialAccess: 'restricted'
  }
}

export const PRODUCTION_OUTCOME_BASELINE: ProductionOutcomeBaseline = {
  version: 1,
  journeys: [
    {
      id: 'idea_to_novel',
      name: '从灵感开始',
      state: 'available',
      entryRoute: '#/projects/new',
      currentOutcome: '可用名称、题材、钩子和灵感摘要创建本地小说项目，再进入项目工作台。',
      missingCapabilities: [
        '尚未在创建页提供可解释的市场机会排序或平台目标选择。',
        '尚未在创建阶段生成可审阅的项目生产简报。',
      ],
    },
    {
      id: 'existing_manuscript_to_drama',
      name: '导入已有小说/IP',
      state: 'known_gap',
      currentOutcome: '当前仅能导入本应用项目包；不能将 TXT、DOCX、EPUB 等主稿作为第一等来源导入并开始改编。',
      missingCapabilities: [
        '主稿文件导入、分章和解析校验。',
        '权利来源、授权范围和导入版本记录。',
        '导入后直接进入小说到短剧改编的可恢复路径。',
      ],
    },
    {
      id: 'direct_script_to_drama',
      name: '直接制作 AI 漫剧',
      state: 'known_gap',
      currentOutcome: '当前必须先有小说项目再创建改编项目；没有从剧本、梗概或分集输入直接进入制作的入口。',
      missingCapabilities: [
        '剧本/梗概/分集输入入口与结构化校验。',
        '不依赖小说章节的项目生产简报。',
        '直接进入资产、分镜和试播生产的可恢复路径。',
      ],
    },
  ],
  productionTruth: {
    content: 'available',
    visualAssets: 'known_gap',
    sound: 'known_gap',
    video: 'available',
    finalDelivery: 'known_gap',
    notes: [
      '当前可保存小说、改编分集、剧本、场景、镜头和视频生成任务。',
      '当前视频结果只表示候选生成结果；没有时间线、音频轨、字幕轨、媒体质检和最终 MP4 交付。',
      '当前没有第一等图片资产、配音、BGM/SFX、角色一致性或成片质检能力。',
    ],
  },
  operationalTruth: {
    coverage: 'available',
    blockingState: 'available',
    // 本地账本可显示估算、实际与未知；未知不再被压成 0 或“已结算”。
    budget: 'available',
    // LM5-08 provides an explicit rights ledger and fail-closed delivery preflight.
    rights: 'available',
    providerAvailability: 'available',
  },
  privacyBoundary: {
    diagnosticContentDefault: 'redacted',
    rendererCredentialAccess: 'restricted',
  },
}

export function serializeProductionOutcomeBaseline(): string {
  return JSON.stringify(PRODUCTION_OUTCOME_BASELINE)
}
