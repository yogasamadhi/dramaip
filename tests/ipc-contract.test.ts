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
  assert.deepEqual(validateIpcArgs('log:renderer', ['error', 'runtime', 'unhandled error', { messageLength: 42 }]), [
    'error',
    'runtime',
    'unhandled error',
    { messageLength: 42 },
  ])
})

test('rejects IPC calls with invalid arity or shape', () => {
  assert.throws(() => validateIpcArgs('project:list', ['extra']), /参数数量错误/)
  assert.throws(() => validateIpcArgs('chapter:list', []), /参数数量错误/)
  assert.throws(() => validateIpcArgs('outline:list', ['project-1', 'bad']), /参数校验失败/)
  assert.throws(() => validateIpcArgs('videoTask:create', [{ providerConfigId: 'p1' }]), /prompt/)
  assert.throws(() => validateIpcArgs('log:renderer', ['trace', 'runtime', 'message']), /参数校验失败/)
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
    'security:getSecretStorageStatus',
    'dataBackup:list',
    'dataBackup:create',
    'dataBackup:restore',
    'longTask:list',
    'longTask:get',
    'longTask:cancel',
    'longTask:retry',
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
  assert.deepEqual(validateIpcArgs('longTask:list', []), [])
  assert.deepEqual(validateIpcArgs('longTask:list', ['p1']), ['p1'])
  assert.deepEqual(validateIpcArgs('longTask:cancel', ['task1']), ['task1'])
  assert.deepEqual(validateIpcArgs('longTask:retry', ['task1']), ['task1'])
  assert.deepEqual(validateIpcArgs('template:list', []), [])
  assert.throws(() => validateIpcArgs('template:list', ['extra']), /参数数量错误/)
  assert.deepEqual(validateIpcArgs('script:updateContent', ['s1', '正文']), ['s1', '正文'])
  assert.throws(() => validateIpcArgs('script:updateContent', ['s1', { content: '正文' }]), /参数校验失败/)
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
