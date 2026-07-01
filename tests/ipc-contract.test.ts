import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IPC_EXACT_SCHEMAS, validateIpcArgs } from '../packages/core/src/ipc-contract'

test('validates exact IPC channel arguments', () => {
  assert.deepEqual(validateIpcArgs('project:list', []), [])
  assert.deepEqual(validateIpcArgs('chapter:list', ['project-1']), ['project-1'])
  assert.deepEqual(validateIpcArgs('outline:list', ['project-1', 'book']), ['project-1', 'book'])
})

test('rejects IPC calls with invalid arity or shape', () => {
  assert.throws(() => validateIpcArgs('project:list', ['extra']), /参数数量错误/)
  assert.throws(() => validateIpcArgs('chapter:list', []), /参数数量错误/)
  assert.throws(() => validateIpcArgs('outline:list', ['project-1', 'bad']), /参数校验失败/)
  assert.throws(() => validateIpcArgs('videoTask:create', [{ providerConfigId: 'p1' }]), /prompt/)
})

test('keeps high-risk channels in the shared contract', () => {
  for (const channel of [
    'security:getSecretStorageStatus',
    'dataBackup:list',
    'dataBackup:create',
    'dataBackup:restore',
    'project:create',
    'project:update',
    'ai:run',
    'ai:runStream',
    'ai:applyResult',
    'model:create',
    'model:update',
    'model:upsertTaskBinding',
    'model:testConnection',
    'template:run',
    'writingRoom:run',
    'videoTask:create',
    'videoTask:update',
    'videoProvider:create',
    'workflow:run',
    'revisionTask:create',
    'revisionTask:apply',
    'contentVersion:create',
    'contentVersion:listByTarget',
  ]) {
    assert.ok(channel in IPC_EXACT_SCHEMAS, `${channel} should have an exact IPC schema`)
  }
})

test('validates creative IPC contracts', () => {
  assert.deepEqual(validateIpcArgs('contentVersion:listByTarget', ['chapter', 'c1']), ['chapter', 'c1'])
  assert.deepEqual(validateIpcArgs('creative:freshness:list', []), [])
  assert.deepEqual(validateIpcArgs('creative:freshness:list', ['p1']), ['p1'])
  assert.throws(() => validateIpcArgs('revisionTask:apply', []), /参数数量错误/)
  assert.deepEqual(validateIpcArgs('dataBackup:list', []), [])
  assert.deepEqual(validateIpcArgs('dataBackup:restore', ['/tmp/studio.db']), ['/tmp/studio.db'])
  assert.throws(() => validateIpcArgs('dataBackup:restore', ['']), /参数校验失败/)
})

test('validates high-risk business IPC payload schemas', () => {
  assert.deepEqual(validateIpcArgs('project:create', [{ title: '短剧项目', shortDramaType: '复仇' }]), [
    { title: '短剧项目', shortDramaType: '复仇' },
  ])
  assert.throws(() => validateIpcArgs('project:create', [{ title: '短剧项目' }]), /shortDramaType/)
  assert.throws(() => validateIpcArgs('ai:run', [{ taskType: 'unknown_task' }]), /taskType/)
  assert.throws(() => validateIpcArgs('model:upsertTaskBinding', ['unknown_group', 'm1']), /参数校验失败/)
  assert.throws(
    () => validateIpcArgs('template:run', [{ templateId: 't1', variables: { name: 1 } }]),
    /variables.name/,
  )
  assert.throws(() => validateIpcArgs('workflow:run', [{ templateKey: 'unknown_workflow' }]), /templateKey/)
  assert.throws(
    () =>
      validateIpcArgs('contentVersion:create', [
        { targetKind: 'chapter', targetId: 'c1', label: 'v1', content: '正文' },
      ]),
    /source/,
  )
})
