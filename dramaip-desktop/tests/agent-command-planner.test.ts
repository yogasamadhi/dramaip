import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AdaptationProject, Chapter, Character, CharacterVisualProfile, CreativeCaseStudy, Episode, Project, Scene, Script, Shot } from '@sdns/core'
import { buildAgentCommandPlan, type AgentCommandContext } from '../apps/desktop/renderer/src/lib/agentCommandPlanner'

function chapter(id: string, orderIndex: number, title: string, content = '正文'): Chapter {
  return { id, projectId: 'p1', title, orderIndex, content, createdAt: '', updatedAt: '' } as Chapter
}

function context(patch: Partial<AgentCommandContext> = {}): AgentCommandContext {
  const adaptation = {
    id: 'a1',
    sourceProjectId: 'p1',
    title: '短剧改编',
    targetEpisodeCount: 24,
    adaptationStyle: '爽剧',
    createdAt: '',
    updatedAt: '',
  } as AdaptationProject
  const episode = {
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
  } as Episode
  const script = {
    id: 's1',
    adaptationProjectId: 'a1',
    episodeId: 'e1',
    episodeNumber: 1,
    title: '第1集',
    content: '剧本',
    createdAt: '',
    updatedAt: '',
  } as Script
  const scene = {
    id: 'sc1',
    scriptId: 's1',
    episodeId: 'e1',
    sceneNumber: 1,
    title: '家中对峙',
    location: '客厅',
    visualDescription: '夜晚室内',
    characters: [],
    summary: '爆发冲突',
    orderIndex: 0,
    createdAt: '',
    updatedAt: '',
  } as Scene

  return {
    projectId: 'p1',
    project: { id: 'p1', title: '短剧小说', shortDramaType: '复仇', createdAt: '', updatedAt: '' } as Project,
    activeChapter: chapter('c2', 1, '第二章'),
    chapters: [chapter('c1', 0, '第一章'), chapter('c2', 1, '第二章')],
    characters: [{ id: 'char1', projectId: 'p1', name: '女主', role: '主角', createdAt: '', updatedAt: '' } as Character],
    caseStudies: [{ id: 'case1', title: '爆款样本', relationshipPatterns: [], openingHooks: [], highlightBeats: [], reversalMechanisms: [], cliffhangers: [], visualPatterns: [], riskTags: [], createdAt: '', updatedAt: '' } as CreativeCaseStudy],
    visualProfiles: [{ id: 'vp1', projectId: 'p1', characterId: 'char1', appearancePrompt: '红裙', createdAt: '', updatedAt: '' } as CharacterVisualProfile],
    adaptations: [adaptation],
    activeAdaptationId: adaptation.id,
    episodes: [episode],
    scripts: [script],
    scenes: [scene],
    shots: [],
    ...patch,
  }
}

test('plans chapter rewrite commands with a text preview target', () => {
  const plan = buildAgentCommandPlan('帮我润色第一章，让情绪更强', context())

  assert.equal(plan?.kind, 'chapter')
  assert.equal(plan?.status, 'ready')
  assert.equal(plan?.taskType, 'polish_chapter')
  assert.equal(plan?.resultMode, 'text_preview')
  assert.equal(plan?.input?.chapterId, 'c1')
})

test('plans episode generation commands against the active adaptation', () => {
  const plan = buildAgentCommandPlan('根据这本小说生成分集大纲', context())

  assert.equal(plan?.kind, 'episodes')
  assert.equal(plan?.status, 'ready')
  assert.equal(plan?.taskType, 'convert_novel_to_episodes')
  assert.equal(plan?.resultMode, 'artifact_preview')
  assert.equal(plan?.input?.adaptationProjectId, 'a1')
})

test('does not fall back to list order when the active adaptation is absent', () => {
  const plan = buildAgentCommandPlan('根据这本小说生成分集大纲', context({ activeAdaptationId: undefined }))

  assert.equal(plan?.status, 'blocked')
  assert.match(plan?.blockedReasons.join(' ') ?? '', /没有改编项目/)
})

test('plans shot split commands with an explicit confirmation warning', () => {
  const plan = buildAgentCommandPlan('把当前场景拆分镜头', context())

  assert.equal(plan?.kind, 'shots')
  assert.equal(plan?.status, 'ready')
  assert.equal(plan?.taskType, 'split_scene_to_shots')
  assert.equal(plan?.resultMode, 'auto_write')
  assert.equal(plan?.input?.sceneId, 'sc1')
  assert.equal(plan?.confirmBeforeRun, true)
  assert.match(plan?.warnings.join('\n') ?? '', /替换目标场景/)
})

test('blocks episode commands when no adaptation project exists', () => {
  const plan = buildAgentCommandPlan('生成分集大纲', context({ adaptations: [] }))

  assert.equal(plan?.status, 'blocked')
  assert.match(plan?.blockedReasons.join('\n') ?? '', /改编项目/)
})
