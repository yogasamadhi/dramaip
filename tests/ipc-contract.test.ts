import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { IPC_EXACT_SCHEMAS, schemasForIpcChannel, validateIpcArgs } from '../packages/core/src/ipc-contract'

function registeredIpcChannels(): string[] {
  const dir = new URL('../apps/desktop/electron/ipc/', import.meta.url)
  return readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .flatMap((file) => {
      const source = readFileSync(new URL(file, dir), 'utf8')
      return [...source.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1])
    })
    .sort()
}

test('validates exact IPC channel arguments', () => {
  assert.deepEqual(validateIpcArgs('project:list', []), [])
  assert.deepEqual(validateIpcArgs('chapter:list', ['project-1']), ['project-1'])
  assert.deepEqual(validateIpcArgs('outline:list', ['project-1', 'book']), ['project-1', 'book'])
  assert.deepEqual(validateIpcArgs('storyArc:list', ['project-1', 'volume']), ['project-1', 'volume'])
  assert.deepEqual(validateIpcArgs('projectSkill:list', ['project-1']), ['project-1'])
  assert.deepEqual(validateIpcArgs('projectAgentScheme:list', ['project-1']), ['project-1'])
  assert.deepEqual(validateIpcArgs('projectAgentScheme:getActive', ['project-1']), ['project-1'])
  assert.deepEqual(
    validateIpcArgs('projectSkill:create', [
      {
        projectId: 'project-1',
        name: '人物对白规范',
        category: 'dialogue',
        taskTypes: ['generate_chapter', 'rewrite_chapter'],
        content: '对白短、狠、带潜台词。',
        priority: 10,
        enabled: true,
      },
    ]),
    [
      {
        projectId: 'project-1',
        name: '人物对白规范',
        category: 'dialogue',
        taskTypes: ['generate_chapter', 'rewrite_chapter'],
        content: '对白短、狠、带潜台词。',
        priority: 10,
        enabled: true,
      },
    ],
  )
  assert.deepEqual(
    validateIpcArgs('projectAgentScheme:create', [
      {
        projectId: 'project-1',
        name: '短剧审稿方案',
        primaryAgentId: 'agent-1',
        agentIds: ['agent-1', 'agent-2'],
        skillIds: ['skill-1'],
        modelBindings: { writing_room: 'model-1' },
        active: true,
      },
    ]),
    [
      {
        projectId: 'project-1',
        name: '短剧审稿方案',
        primaryAgentId: 'agent-1',
        agentIds: ['agent-1', 'agent-2'],
        skillIds: ['skill-1'],
        modelBindings: { writing_room: 'model-1' },
        active: true,
      },
    ],
  )
  assert.deepEqual(
    validateIpcArgs('storyArc:create', [
      {
        projectId: 'project-1',
        kind: 'stage',
        title: '中段反击',
        targetWordCount: 80000,
        keyHighlights: ['反击爽点'],
        foreshadowingPayoffs: ['回收玉佩'],
      },
    ]),
    [
      {
        projectId: 'project-1',
        kind: 'stage',
        title: '中段反击',
        targetWordCount: 80000,
        keyHighlights: ['反击爽点'],
        foreshadowingPayoffs: ['回收玉佩'],
      },
    ],
  )
  assert.deepEqual(validateIpcArgs('log:renderer', ['error', 'runtime', 'unhandled error', { messageLength: 42 }]), [
    'error',
    'runtime',
    'unhandled error',
    { messageLength: 42 },
  ])
  assert.deepEqual(validateIpcArgs('diagnostic:exportPackage', []), [])
  assert.deepEqual(validateIpcArgs('diagnostic:exportPackage', [{ includeContent: true }]), [
    { includeContent: true },
  ])
  assert.deepEqual(validateIpcArgs('asset:listBySource', ['visual_profile', 'vp1']), ['visual_profile', 'vp1'])
  assert.deepEqual(
    validateIpcArgs('asset:create', [
      {
        projectId: 'p1',
        kind: 'character_reference',
        title: '人物参考图',
        sourceEntityKind: 'visual_profile',
        sourceEntityId: 'vp1',
        remoteUrl: 'https://asset.local/ref.png',
        tags: ['角色'],
      },
    ]),
    [
      {
        projectId: 'p1',
        kind: 'character_reference',
        title: '人物参考图',
        sourceEntityKind: 'visual_profile',
        sourceEntityId: 'vp1',
        remoteUrl: 'https://asset.local/ref.png',
        tags: ['角色'],
      },
    ],
  )
})

test('rejects IPC calls with invalid arity or shape', () => {
  assert.throws(() => validateIpcArgs('project:list', ['extra']), /参数数量错误/)
  assert.throws(() => validateIpcArgs('chapter:list', []), /参数数量错误/)
  assert.throws(() => validateIpcArgs('outline:list', ['project-1', 'bad']), /参数校验失败/)
  assert.throws(() => validateIpcArgs('storyArc:create', [{ projectId: 'project-1', kind: 'act', title: 'x' }]), /kind/)
  assert.throws(() => validateIpcArgs('projectSkill:create', [{ projectId: 'project-1', name: 'x', category: 'bad', content: 'x' }]), /category/)
  assert.throws(() => validateIpcArgs('projectSkill:update', ['skill-1', { taskTypes: ['unknown_task'] }]), /taskTypes/)
  assert.throws(() => validateIpcArgs('projectAgentScheme:create', [{ projectId: 'project-1', name: 'x', modelBindings: { unknown: 'm1' } }]), /modelBindings/)
  assert.throws(() => validateIpcArgs('videoTask:create', [{ providerConfigId: 'p1' }]), /prompt/)
  assert.throws(() => validateIpcArgs('log:renderer', ['trace', 'runtime', 'message']), /参数校验失败/)
  assert.throws(
    () => validateIpcArgs('diagnostic:exportPackage', [{ includeContent: true, apiKey: 'secret' }]),
    /参数校验失败/,
  )
  assert.throws(() => validateIpcArgs('asset:create', [{ projectId: 'p1', kind: 'bad', title: 'x' }]), /kind/)
  assert.throws(() => validateIpcArgs('asset:update', ['a1', { status: 'lost' }]), /status/)
  assert.throws(() => validateIpcArgs('unknown:run', []), /未登记 IPC channel/)
  assert.throws(() => validateIpcArgs('shadow:create', [{ ok: true }]), /未登记 IPC channel/)
})

test('requires every registered Electron IPC channel to have a shared schema', () => {
  for (const channel of registeredIpcChannels()) {
    assert.doesNotThrow(() => schemasForIpcChannel(channel), `${channel} should have an IPC schema`)
  }
})

test('keeps high-risk channels in the shared contract', () => {
  for (const channel of [
    'log:renderer',
    'diagnostic:exportPackage',
    'asset:create',
    'asset:update',
    'asset:listByProject',
    'asset:listBySource',
    'asset:delete',
    'projectSkill:create',
    'projectSkill:update',
    'projectSkill:delete',
    'projectAgentScheme:create',
    'projectAgentScheme:update',
    'projectAgentScheme:setActive',
    'projectAgentScheme:delete',
    'security:getSecretStorageStatus',
    'dataBackup:list',
    'dataBackup:create',
    'dataBackup:restore',
    'longTask:list',
    'longTask:get',
    'longTask:cancel',
    'longTask:retry',
    'batchTask:run',
    'aiRun:listRecent',
    'aiRun:contextPreview',
    'aiRun:exportDebugContext',
    'aiRun:summarizeUsage',
    'project:create',
    'project:update',
    'ai:run',
    'ai:runStream',
    'ai:applyResult',
    'model:create',
    'model:update',
    'model:getBudgetSettings',
    'model:updateBudgetSettings',
    'model:upsertTaskBinding',
    'model:testConnection',
    'template:run',
    'writingRoom:run',
    'videoTask:create',
    'videoTask:update',
    'videoProvider:create',
    'workflow:run',
    'workflow:resume',
    'workflow:retryStep',
    'revisionTask:create',
    'revisionTask:apply',
    'contentVersion:create',
    'contentVersion:listByTarget',
    'contentVersion:restore',
  ]) {
    assert.ok(channel in IPC_EXACT_SCHEMAS, `${channel} should have an exact IPC schema`)
  }
})

test('validates creative IPC contracts', () => {
  assert.deepEqual(validateIpcArgs('contentVersion:listByTarget', ['chapter', 'c1']), ['chapter', 'c1'])
  assert.deepEqual(validateIpcArgs('contentVersion:restore', ['v1']), ['v1'])
  assert.deepEqual(validateIpcArgs('creative:freshness:list', []), [])
  assert.deepEqual(validateIpcArgs('creative:freshness:list', ['p1']), ['p1'])
  assert.throws(() => validateIpcArgs('revisionTask:apply', []), /参数数量错误/)
  assert.deepEqual(validateIpcArgs('dataBackup:list', []), [])
  assert.deepEqual(validateIpcArgs('dataBackup:restore', ['/tmp/studio.db']), ['/tmp/studio.db'])
  assert.throws(() => validateIpcArgs('dataBackup:restore', ['']), /参数校验失败/)
  assert.deepEqual(validateIpcArgs('export:projectPackage', ['p1', { includeAssets: true }]), [
    'p1',
    { includeAssets: true },
  ])
  assert.throws(() => validateIpcArgs('export:projectPackage', ['p1', { includeAssets: true, token: 'secret' }]), /Unrecognized|unrecognized|无法识别/)
  assert.deepEqual(validateIpcArgs('longTask:list', []), [])
  assert.deepEqual(validateIpcArgs('longTask:list', ['p1']), ['p1'])
  assert.deepEqual(validateIpcArgs('longTask:cancel', ['task1']), ['task1'])
  assert.deepEqual(validateIpcArgs('longTask:retry', ['task1']), ['task1'])
  assert.deepEqual(validateIpcArgs('batchTask:run', [{ kind: 'scripts', adaptationProjectId: 'a1', episodeIds: ['e1'] }]), [
    { kind: 'scripts', adaptationProjectId: 'a1', episodeIds: ['e1'] },
  ])
  assert.throws(() => validateIpcArgs('batchTask:run', [{ kind: 'scripts' }]), /adaptationProjectId/)
  assert.deepEqual(validateIpcArgs('aiRun:listRecent', []), [])
  assert.deepEqual(validateIpcArgs('aiRun:listRecent', ['p1']), ['p1'])
  assert.deepEqual(validateIpcArgs('aiRun:contextPreview', ['run1']), ['run1'])
  assert.deepEqual(validateIpcArgs('aiRun:exportDebugContext', ['run1']), ['run1'])
  assert.deepEqual(validateIpcArgs('aiRun:summarizeUsage', []), [])
  assert.deepEqual(validateIpcArgs('template:list', []), [])
  assert.throws(() => validateIpcArgs('template:list', ['extra']), /参数数量错误/)
  assert.deepEqual(validateIpcArgs('workflow:resume', [{ runId: 'wf1' }]), [{ runId: 'wf1' }])
  assert.deepEqual(validateIpcArgs('workflow:retryStep', [{ runId: 'wf1', stepKey: 'convert_to_episodes' }]), [
    { runId: 'wf1', stepKey: 'convert_to_episodes' },
  ])
  assert.throws(() => validateIpcArgs('workflow:retryStep', [{ runId: 'wf1' }]), /stepKey/)
  assert.deepEqual(validateIpcArgs('script:updateContent', ['s1', '正文']), ['s1', '正文'])
  assert.throws(() => validateIpcArgs('script:updateContent', ['s1', { content: '正文' }]), /参数校验失败/)
})

test('validates high-risk business IPC payload schemas', () => {
  assert.deepEqual(validateIpcArgs('project:create', [{ title: '短剧项目', shortDramaType: '复仇' }]), [
    { title: '短剧项目', shortDramaType: '复仇' },
  ])
  assert.throws(() => validateIpcArgs('project:create', [{ title: '短剧项目' }]), /shortDramaType/)
  assert.throws(() => validateIpcArgs('ai:run', [{ taskType: 'unknown_task' }]), /taskType/)
  assert.deepEqual(validateIpcArgs('model:getBudgetSettings', []), [])
  assert.deepEqual(
    validateIpcArgs('model:updateBudgetSettings', [
      { dailyTokenLimit: 1000, costPer1kTokens: 0.01, currency: 'USD' },
    ]),
    [{ dailyTokenLimit: 1000, costPer1kTokens: 0.01, currency: 'USD' }],
  )
  assert.throws(() => validateIpcArgs('model:updateBudgetSettings', [{ dailyTokenLimit: -1 }]), /参数校验失败/)
  assert.throws(() => validateIpcArgs('model:upsertTaskBinding', ['unknown_group', 'm1']), /参数校验失败/)
  assert.throws(
    () => validateIpcArgs('template:run', [{ templateId: 't1', variables: { name: 1 } }]),
    /variables.name/,
  )
  assert.deepEqual(validateIpcArgs('workflow:run', [{ templateKey: 'novel_to_video_pipeline', pauseAfterStep: true }]), [
    { templateKey: 'novel_to_video_pipeline', pauseAfterStep: true },
  ])
  assert.throws(() => validateIpcArgs('workflow:run', [{ templateKey: 'unknown_workflow' }]), /templateKey/)
  assert.deepEqual(validateIpcArgs('videoTask:update', ['v1', { status: 'canceled' }]), [
    'v1',
    { status: 'canceled' },
  ])
  assert.throws(
    () =>
      validateIpcArgs('contentVersion:create', [
        { targetKind: 'chapter', targetId: 'c1', label: 'v1', content: '正文' },
      ]),
    /source/,
  )
  assert.deepEqual(
    validateIpcArgs('contentVersion:create', [
      { targetKind: 'chapter', targetId: 'c1', label: '恢复', source: 'restore', content: '正文' },
    ]),
    [{ targetKind: 'chapter', targetId: 'c1', label: '恢复', source: 'restore', content: '正文' }],
  )
})
