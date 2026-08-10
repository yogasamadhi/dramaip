import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRendererErrorMeta, stackFrames } from '../apps/desktop/renderer/src/lib/runtime-errors'

test('renderer error meta keeps error text out of logs', () => {
  const error = new Error('包含正文和敏感业务描述')
  error.stack = ['Error: 包含正文和敏感业务描述', '    at render(App.tsx:1:1)'].join('\n')

  const meta = createRendererErrorMeta(error)
  const serialized = JSON.stringify(meta)

  assert.equal(meta.type, 'Error')
  assert.equal(meta.name, 'Error')
  assert.equal(meta.messageLength, error.message.length)
  assert.doesNotMatch(serialized, /敏感业务描述/)
  assert.match(serialized, /render/)
})

test('renderer error meta summarizes strings and objects', () => {
  assert.deepEqual(createRendererErrorMeta('plain rejection body'), {
    type: 'string',
    length: 'plain rejection body'.length,
  })

  const meta = createRendererErrorMeta({ prompt: '正文', code: 'E_FAIL' })
  assert.equal(meta.type, 'Object')
  assert.deepEqual(meta.keys, ['prompt', 'code'])
  assert.doesNotMatch(JSON.stringify(meta), /正文/)
})

test('stack frame helper limits collected frames', () => {
  const frames = stackFrames(['Error: boom', 'a', 'b', 'c', 'd'].join('\n'), { limit: 2 })
  assert.deepEqual(frames, ['a', 'b'])
})
