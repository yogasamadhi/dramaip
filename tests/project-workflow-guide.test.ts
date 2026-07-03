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
} from '@sdns/core'
import {
  buildProjectWorkflowStages,
  type ProjectWorkflowSnapshot,
} from '../apps/desktop/renderer/src/lib/projectWorkflowGuide'

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
    ...patch,
  }
}

test('marks setup as the active first step for an empty project', () => {
  const stages = buildProjectWorkflowStages(snapshot())

  assert.equal(stages[0]?.key, 'setup')
  assert.equal(stages[0]?.status, 'active')
  assert.equal(stages.every((stage) => stage.status !== 'done'), true)
})

test('advances through novel and adaptation production stages', () => {
  const stages = buildProjectWorkflowStages(snapshot({
    project: { ...baseProject, coreHook: '复仇钩子', synopsis: '女主重生反击。' },
    characters: [{ id: 'c1', projectId: 'p1', name: '女主', role: '主角', createdAt: '', updatedAt: '' } as Character],
    outlines: [{ id: 'o1', projectId: 'p1', type: 'book', title: '全书', content: '三幕结构', orderIndex: 0, createdAt: '', updatedAt: '' } as Outline],
    chapters: [{ id: 'ch1', projectId: 'p1', title: '第一章', orderIndex: 0, content: '正文', createdAt: '', updatedAt: '' } as Chapter],
    qualityReports: [{
      id: 'q1',
      projectId: 'p1',
      targetKind: 'project',
      stage: 'novel',
      score: 88,
      verdict: 'pass',
      blockingIssues: [],
      warnings: [],
      suggestions: [],
      createdAt: '',
      updatedAt: '',
    } as QualityGateReport],
    adaptations: [{ id: 'a1', sourceProjectId: 'p1', title: '改编', targetEpisodeCount: 24, adaptationStyle: '爽剧', createdAt: '', updatedAt: '' } as AdaptationProject],
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
    'done',
    'done',
    'done',
    'active',
  ])
})

test('reports video task progress as the final stage', () => {
  const stages = buildProjectWorkflowStages(snapshot({
    videoTasks: [
      { id: 'v1', provider: 'mock', model: 'mock', prompt: 'p', referenceImageUrls: [], status: 'success', createdAt: '', updatedAt: '' } as VideoGenerationTask,
    ],
  }))
  const video = stages.find((stage) => stage.key === 'video')

  assert.equal(video?.complete, true)
  assert.equal(video?.detail, '视频任务 1 个，成功 1 个')
})
