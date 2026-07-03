import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentProfile, ModelConfig, ProjectAgentScheme, ProjectSkill } from '@sdns/core'
import { selectWritingRoomAgents, selectWritingRoomProjectSkills } from '../packages/ai/src/agents/project-agent-scheme'
import { resolveProviderForTask } from '../packages/ai/src/providers/task-provider-resolver'

const now = '2026-01-01T00:00:00.000Z'

function modelConfig(id: string, model: string): ModelConfig {
  return {
    id,
    name: model,
    provider: 'openai',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  }
}

test('project agent scheme model bindings override global task bindings', () => {
  const configs = {
    project: modelConfig('project', 'project-writing-room'),
    global: modelConfig('global', 'global-writing-room'),
    default: modelConfig('default', 'default-model'),
  }
  const scheme: ProjectAgentScheme = {
    id: 'scheme-1',
    projectId: 'p1',
    name: '项目方案',
    agentIds: [],
    skillIds: [],
    modelBindings: { writing_room: 'project' },
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  const repos = {
    db: {},
    projectAgentScheme: { getActiveProjectAgentScheme: () => scheme },
    taskModelBinding: { getTaskModelBinding: () => ({ modelConfigId: 'global' }) },
    modelConfig: {
      getModelConfig: (_db: unknown, id: string) => configs[id as keyof typeof configs],
      getDefaultModelConfig: () => configs.default,
    },
  } as never

  const resolved = resolveProviderForTask(repos, 'writing_room_consolidate', undefined, 'p1')

  assert.equal(resolved.config?.id, 'project')
  assert.equal(resolved.provider?.model, 'project-writing-room')
  assert.equal(resolved.fromBinding, true)
})

test('writing room helpers apply project scheme agents, primary agent, and bound skills', () => {
  const scheme: ProjectAgentScheme = {
    id: 'scheme-1',
    projectId: 'p1',
    name: '复仇短剧审稿方案',
    description: '主抓前三章留存。',
    primaryAgentId: 'a2',
    agentIds: ['a1', 'a2'],
    skillIds: ['skill-1'],
    modelBindings: {},
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  const agents: AgentProfile[] = [
    { id: 'a1', name: '视觉导演', role: 'visual_director', systemPrompt: '检查画面感。', enabled: false, builtIn: true, createdAt: now, updatedAt: now },
    { id: 'a2', name: '主编', role: 'chief_editor', systemPrompt: '优先判断商业留存。', enabled: true, builtIn: true, createdAt: now, updatedAt: now },
    { id: 'a3', name: '爽点优化', role: 'highlight_optimizer', systemPrompt: '检查爽点。', enabled: true, builtIn: true, createdAt: now, updatedAt: now },
  ]
  const skills: ProjectSkill[] = [
    {
      id: 'skill-1',
      projectId: 'p1',
      name: '复仇节奏规范',
      category: 'genre_pacing',
      taskTypes: ['writing_room_review'],
      content: '每章必须有压迫、反制和悬念。',
      priority: 10,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'skill-2',
      projectId: 'p1',
      name: '停用规范',
      category: 'custom',
      taskTypes: ['writing_room_review'],
      content: '不应进入上下文。',
      priority: 1,
      enabled: false,
      createdAt: now,
      updatedAt: now,
    },
  ]

  const selected = selectWritingRoomAgents(agents, undefined, scheme)
  const boundSkills = selectWritingRoomProjectSkills(skills, skills.filter((skill) => skill.enabled), scheme)
  const autoSelected = selectWritingRoomProjectSkills(skills, skills.filter((skill) => skill.enabled), { ...scheme, skillIds: [] })

  assert.deepEqual(selected.agents.map((agent) => agent.id), ['a2', 'a1'])
  assert.equal(selected.primaryAgent?.id, 'a2')
  assert.deepEqual(boundSkills.map((skill) => skill.id), ['skill-1'])
  assert.deepEqual(autoSelected.map((skill) => skill.id), ['skill-1'])
})
