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
  for (const channel of ['ai:run', 'ai:runStream', 'ai:applyResult', 'model:testConnection', 'videoTask:create']) {
    assert.ok(channel in IPC_EXACT_SCHEMAS, `${channel} should have an exact IPC schema`)
  }
})
