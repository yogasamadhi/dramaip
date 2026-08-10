import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chapter, Character, Evaluation, Project, QualityGateReport } from '../packages/core/src'
import {
  buildNovelSubmissionPackage,
  exportNovelSubmissionJson,
  exportNovelSubmissionMarkdown,
  NOVEL_SUBMISSION_PACKAGE_FORMAT,
} from '../packages/export/src'

const now = '2026-01-01T00:00:00.000Z'

const project: Project = {
  id: 'p1',
  title: '重生后我拍爆短剧',
  shortDramaType: '重生逆袭',
  targetAudience: '18-35 岁短剧用户',
  targetWordCount: 200000,
  targetEpisodeCount: 80,
  coreHook: '她重回开机当天，用未来爆款公式逆转全网嘲笑。',
  emotionalCore: '从被否定到掌控创作命运',
  coreSellingPoint: '娱乐圈复仇、爆款制作、公开打脸',
  synopsis: '女主前世被夺创意，重生后从第一场戏开始反击。',
  visualStyleDirection: '都市片场、竖屏强反应',
  createdAt: now,
  updatedAt: now,
}

const characters: Character[] = [
  {
    id: 'char-1',
    projectId: 'p1',
    name: '许知夏',
    role: '女主',
    identity: '重生短剧制作人',
    personality: '冷静、敏锐',
    desire: '夺回创意署名',
    arc: '从被动求生到主动操盘',
    shortDramaFunction: '每章推动反击爽点',
    createdAt: now,
    updatedAt: now,
  },
]

const chapters: Chapter[] = [
  chapter(0, '第一章 开机日重生', '她在片场醒来。', '开机现场当众反击'),
  chapter(1, '第二章 爆款剧本', '她改掉致命桥段。', '剧本围读压迫'),
  chapter(2, '第三章 热搜反转', '黑热搜变成预告。', '全网误判'),
]

const evaluations: Evaluation[] = [
  {
    id: 'ev-1',
    projectId: 'p1',
    totalScore: 82,
    hookScore: 88,
    conflictScore: 84,
    reversalScore: 80,
    emotionScore: 76,
    visualizationScore: 90,
    aiVideoFeasibilityScore: 86,
    characterConsistencyScore: 78,
    shotClarityScore: 82,
    cliffhangerScore: 84,
    adaptationDifficultyScore: 60,
    issues: [],
    suggestions: ['强化第二章尾钩'],
    createdAt: now,
  },
]

const qualityGateReports: QualityGateReport[] = [
  {
    id: 'qg-1',
    projectId: 'p1',
    targetKind: 'project',
    targetId: 'p1',
    stage: 'novel_to_adaptation',
    score: 76,
    verdict: 'warn',
    blockingIssues: [],
    warnings: ['人物小传还可补充反派'],
    suggestions: ['投稿前补齐前三章悬念'],
    createdAt: now,
    updatedAt: now,
  },
]

test('builds a novel submission package with catalog, samples, and quality summary', () => {
  const pkg = buildNovelSubmissionPackage(
    { project, characters, chapters, evaluations, qualityGateReports },
    { chapterLimit: 2, exportedAt: now },
  )

  assert.equal(pkg.meta.format, NOVEL_SUBMISSION_PACKAGE_FORMAT)
  assert.equal(pkg.meta.chapterLimit, 2)
  assert.equal(pkg.sampleChapters.length, 2)
  assert.equal(pkg.chapterCatalog.length, 3)
  assert.equal(pkg.chapterCatalog[0].wordCount, 7)
  assert.equal(pkg.qualitySummary.latestEvaluation?.totalScore, 82)
  assert.equal(pkg.qualitySummary.latestQualityGate?.verdict, 'warn')
})

test('exports submission package markdown and json for publisher review', () => {
  const data = { project, characters, chapters, evaluations, qualityGateReports }
  const md = exportNovelSubmissionMarkdown(data, { chapterLimit: 2 })
  assert.match(md, /# 重生后我拍爆短剧 · 小说投稿包/)
  assert.match(md, /## 卖点摘要/)
  assert.match(md, /## 人物小传/)
  assert.match(md, /## 章节目录/)
  assert.match(md, /## 质量摘要/)
  assert.match(md, /正文试读（前 2 章）/)
  assert.match(md, /第一章 开机日重生/)
  assert.doesNotMatch(md, /第三章 热搜反转\n\n她/)

  const json = JSON.parse(exportNovelSubmissionJson(data, { chapterLimit: 1 })) as ReturnType<typeof buildNovelSubmissionPackage>
  assert.equal(json.meta.format, NOVEL_SUBMISSION_PACKAGE_FORMAT)
  assert.equal(json.sampleChapters.length, 1)
  assert.equal(json.chapterCatalog.length, 3)
  assert.equal(json.characters[0].name, '许知夏')
})

function chapter(orderIndex: number, title: string, content: string, hook: string): Chapter {
  return {
    id: `c${orderIndex + 1}`,
    projectId: 'p1',
    title,
    orderIndex,
    summary: `${title} 摘要`,
    content,
    hook,
    mainConflict: `${title} 冲突`,
    cliffhanger: `${title} 尾钩`,
    createdAt: now,
    updatedAt: now,
  }
}
