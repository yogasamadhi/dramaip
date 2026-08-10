import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  AdaptationProject,
  Chapter,
  Character,
  Episode,
  Outline,
  Project,
  QualityGateReport,
  Scene,
  Script,
  Shot,
  VideoGenerationTask,
  VideoResult,
} from '@sdns/core'
import { buildQualityGateSourceFingerprint } from '@sdns/core'
import {
  buildVideoDeliveryTruth,
  buildProjectWorkflowStages,
  type ProjectWorkflowSnapshot,
} from '../apps/desktop/renderer/src/lib/projectWorkflowGuide'
import { buildPilotProductionTruth } from '../apps/desktop/renderer/src/lib/pilotProductionTruth'

const baseProject = {
  id: 'p1',
  title: '短剧小说',
  shortDramaType: '复仇',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
} satisfies Project

function snapshot(patch: Partial<ProjectWorkflowSnapshot> = {}): ProjectWorkflowSnapshot {
  return {
    project: baseProject,
    chapters: [],
    characters: [],
    outlines: [],
    qualityReports: [],
    adaptations: [],
    episodes: [],
    scripts: [],
    scenes: [],
    shots: [],
    videoTasks: [],
    videoResults: [],
    ...patch,
  }
}

test('marks setup as the active first step for an empty project', () => {
  const stages = buildProjectWorkflowStages(snapshot())

  assert.equal(stages[0]?.key, 'setup')
  assert.equal(stages[0]?.status, 'active')
  assert.equal(stages.every((stage) => stage.status !== 'done'), true)
})

test('keeps a partially produced season active instead of treating one episode as full coverage', () => {
  const project = { ...baseProject, coreHook: '复仇钩子', synopsis: '女主重生反击。' }
  const characters = [{ id: 'c1', projectId: 'p1', name: '女主', role: '主角', createdAt: '', updatedAt: '' } as Character]
  const outlines = [{ id: 'o1', projectId: 'p1', type: 'book', title: '全书', content: '三幕结构', orderIndex: 0, createdAt: '', updatedAt: '' } as Outline]
  const chapters = [{ id: 'ch1', projectId: 'p1', title: '第一章', orderIndex: 0, content: '正文', createdAt: '', updatedAt: '' } as Chapter]
  const qualityReports = [{
      id: 'q1',
      projectId: 'p1',
      targetKind: 'project',
      targetId: 'p1',
      stage: 'novel_to_adaptation',
      score: 88,
      verdict: 'pass',
      blockingIssues: [],
      warnings: [],
      suggestions: [],
      sourceFingerprint: buildQualityGateSourceFingerprint({ stage: 'novel_to_adaptation', project, chapters, characters, outlines }),
      createdAt: '',
      updatedAt: '',
    } as QualityGateReport]
  const adaptation = { id: 'a1', sourceProjectId: 'p1', title: '改编', targetEpisodeCount: 24, adaptationStyle: '爽剧', createdAt: '', updatedAt: '' } as AdaptationProject
  const stages = buildProjectWorkflowStages(snapshot({
    project,
    characters,
    outlines,
    chapters,
    qualityReports,
    adaptations: [adaptation],
    activeAdaptation: adaptation,
    episodes: [{
      id: 'e1',
      adaptationProjectId: 'a1',
      episodeNumber: 1,
      title: '第1集',
      summary: '开场',
      hook: '钩子',
      mainConflict: '冲突',
      cliffhanger: '悬念',
      keyVisuals: [],
      createdAt: '',
      updatedAt: '',
    } as Episode],
    scripts: [{ id: 's1', adaptationProjectId: 'a1', episodeId: 'e1', episodeNumber: 1, title: '第1集', content: '剧本', createdAt: '', updatedAt: '' } as Script],
    scenes: [{ id: 'sc1', scriptId: 's1', episodeId: 'e1', sceneNumber: 1, title: '开场', location: '家', visualDescription: '室内', characters: [], summary: '冲突', orderIndex: 0, createdAt: '', updatedAt: '' } as Scene],
    shots: [{ id: 'sh1', sceneId: 'sc1', episodeId: 'e1', shotNumber: 1, visualDescription: '特写', characterIds: [], videoPrompt: 'close shot', createdAt: '', updatedAt: '' } as Shot],
  }))

  assert.deepEqual(stages.map((stage) => stage.status), [
    'done',
    'done',
    'done',
    'done',
    'done',
    'active',
    'todo',
    'todo',
    'todo',
  ])
})

test('does not combine another adaptation into the current workflow progress', () => {
  const active = { id: 'active', sourceProjectId: 'p1', title: '第一季', targetEpisodeCount: 12, adaptationStyle: '爽剧', createdAt: '', updatedAt: '' } as AdaptationProject
  const other = { id: 'other', sourceProjectId: 'p1', title: '第二季', targetEpisodeCount: 12, adaptationStyle: '悬疑', createdAt: '', updatedAt: '' } as AdaptationProject
  const stages = buildProjectWorkflowStages(snapshot({
    adaptations: [active, other],
    activeAdaptation: active,
    episodes: [{ id: 'episode-other', adaptationProjectId: other.id, episodeNumber: 1, title: '第二季第1集', summary: '', hook: '', mainConflict: '', cliffhanger: '', keyVisuals: [], createdAt: '', updatedAt: '' } as Episode],
  }))

  assert.equal(stages.find((stage) => stage.key === 'adaptation')?.complete, false)
  assert.match(stages.find((stage) => stage.key === 'adaptation')?.detail ?? '', /第一季/)
})

test('does not count an unscoped best result as season delivery', () => {
  const stages = buildProjectWorkflowStages(snapshot({
    videoTasks: [
      { id: 'v1', provider: 'mock', model: 'mock', prompt: 'p', referenceImageUrls: [], status: 'success', createdAt: '', updatedAt: '' } as VideoGenerationTask,
    ],
    videoResults: [{ id: 'r1', taskId: 'v1', resultVideoUrl: 'https://example.test/video.mp4', isBest: true, createdAt: '' } as VideoResult],
  }))
  const video = stages.find((stage) => stage.key === 'video')

  assert.equal(video?.complete, false)
  assert.match(video?.detail ?? '', /0\/3/)
})

test('shows 3/20 script coverage and prevents one best shot from completing a season', () => {
  const project = {
    ...baseProject,
    targetEpisodeCount: 20,
    productionBrief: { version: 1, creationGoal: 'novel_to_drama', profile: { presentation: 'ai_2d_animation', platform: 'short_video_vertical', region: 'mainland_china', aspectRatio: '9:16', episodeDuration: { minSeconds: 60, maxSeconds: 120 }, pilotEpisodeCount: 3, budgetTier: 'starter' }, nextStep: 'write_or_plan' },
  } as Project
  const adaptation = { id: 'a1', sourceProjectId: 'p1', title: '第一季', targetEpisodeCount: 20, adaptationStyle: '爽剧', createdAt: '', updatedAt: '' } as AdaptationProject
  const episodes = [1, 2, 3].map((episodeNumber) => ({ id: `e${episodeNumber}`, adaptationProjectId: 'a1', episodeNumber })) as Episode[]
  const scripts = episodes.map((episode) => ({ id: `s${episode.episodeNumber}`, adaptationProjectId: 'a1', episodeId: episode.id, episodeNumber: episode.episodeNumber, title: `第${episode.episodeNumber}集`, content: '剧本', createdAt: '', updatedAt: '' } as Script))
  const scenes = episodes.map((episode) => ({ id: `sc${episode.episodeNumber}`, scriptId: `s${episode.episodeNumber}`, episodeId: episode.id, sceneNumber: 1, title: '场景', location: '室内', visualDescription: '画面', characters: [], summary: '剧情', orderIndex: 0, createdAt: '', updatedAt: '' } as Scene))
  const shots = episodes.map((episode) => ({ id: `sh${episode.episodeNumber}`, sceneId: `sc${episode.episodeNumber}`, episodeId: episode.id, shotNumber: 1, visualDescription: '特写', characterIds: [], videoPrompt: 'prompt', createdAt: '', updatedAt: '' } as Shot))
  const truth = buildPilotProductionTruth({
    project,
    chapters: [],
    qualityReports: [],
    activeAdaptation: adaptation,
    episodes,
    scripts,
    scenes,
    shots,
    videoTasks: [{ id: 'v1', episodeId: 'e1', provider: 'mock', model: 'mock', prompt: 'p', referenceImageUrls: [], status: 'success', createdAt: '', updatedAt: '' } as VideoGenerationTask],
    videoResults: [{ id: 'r1', taskId: 'v1', resultVideoUrl: 'https://example.test/video.mp4', isBest: true, createdAt: '' } as VideoResult],
  })

  assert.deepEqual(truth.coverage.map((coverage) => [coverage.key, coverage.detail]), [
    ['episodes', '3/20 集'],
    ['scripts', '3/20 集'],
    ['scenes', '3/20 集'],
    ['shots', '3/20 集'],
    ['video', '1/20 集'],
  ])
  assert.equal(truth.pilotCoverage.find((coverage) => coverage.key === 'video')?.detail, '1/3 集')
  assert.equal(truth.coverage.find((coverage) => coverage.key === 'video')?.complete, false)
  assert.equal(truth.canCreateExpansionPlan, false)
})

test('uses the latest matching quality report and marks changed sources stale', () => {
  const project = { ...baseProject, coreHook: '复仇钩子', synopsis: '女主重生反击。' }
  const chapters = [{ id: 'ch1', projectId: 'p1', title: '第一章', orderIndex: 0, content: '正文 A', createdAt: '', updatedAt: '' } as Chapter]
  const sourceFingerprint = buildQualityGateSourceFingerprint({ stage: 'novel_to_adaptation', project, chapters, characters: [], outlines: [] })
  const reports: QualityGateReport[] = [
    { id: 'old-block', projectId: 'p1', targetKind: 'project', targetId: 'p1', stage: 'novel_to_adaptation', score: 40, verdict: 'block', blockingIssues: ['旧问题'], warnings: [], suggestions: [], sourceFingerprint, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'latest-pass', projectId: 'p1', targetKind: 'project', targetId: 'p1', stage: 'novel_to_adaptation', score: 90, verdict: 'pass', blockingIssues: [], warnings: [], suggestions: [], sourceFingerprint, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  ]
  const current = buildProjectWorkflowStages(snapshot({ project, chapters, qualityReports: reports }))
  assert.equal(current.find((stage) => stage.key === 'quality')?.complete, true)

  const changed = buildProjectWorkflowStages(snapshot({
    project,
    chapters: [{ ...chapters[0], content: '正文 B' }],
    qualityReports: reports,
  }))
  const quality = changed.find((stage) => stage.key === 'quality')
  assert.equal(quality?.complete, false)
  assert.match(quality?.detail ?? '', /已过期/)
})

test('does not treat pending, failed, or result-less video tasks as delivery complete', () => {
  const pending = buildVideoDeliveryTruth([
    { id: 'p', provider: 'mock', model: 'mock', prompt: '', referenceImageUrls: [], status: 'pending', createdAt: '', updatedAt: '' } as VideoGenerationTask,
    { id: 'f', provider: 'mock', model: 'mock', prompt: '', referenceImageUrls: [], status: 'failed', createdAt: '', updatedAt: '' } as VideoGenerationTask,
  ], [])
  assert.equal(pending.complete, false)

  const noResult = buildVideoDeliveryTruth([
    { id: 's', provider: 'mock', model: 'mock', prompt: '', referenceImageUrls: [], status: 'success', createdAt: '', updatedAt: '' } as VideoGenerationTask,
  ], [])
  assert.equal(noResult.complete, false)
})

test('requires an explicitly selected best video before delivery is complete', () => {
  const truth = buildVideoDeliveryTruth([
    { id: 's', provider: 'mock', model: 'mock', prompt: '', referenceImageUrls: [], status: 'success', createdAt: '', updatedAt: '' } as VideoGenerationTask,
  ], [
    { id: 'r', taskId: 's', resultVideoUrl: 'https://example.test/unselected.mp4', isBest: false, createdAt: '' } as VideoResult,
  ])

  assert.equal(truth.complete, false)
  assert.equal(truth.usableResultCount, 1)
  assert.equal(truth.bestResultCount, 0)
  assert.match(truth.detail, /待选择最佳交付版本/)
})
