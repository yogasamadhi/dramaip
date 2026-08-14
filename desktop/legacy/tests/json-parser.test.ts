import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractJson } from '../packages/ai/src/parsers/json'

test('extracts direct JSON', () => {
  assert.deepEqual(extractJson('{"ok":true,"items":[1,2]}'), { ok: true, items: [1, 2] })
})

test('extracts fenced JSON', () => {
  assert.deepEqual(extractJson('```json\n{"title":"短剧"}\n```'), { title: '短剧' })
})

test('extracts JSON embedded in model prose', () => {
  assert.deepEqual(extractJson('好的，结果如下：\n{"score":88}\n请查收。'), { score: 88 })
})

test('rejects empty or non-JSON output', () => {
  assert.throws(() => extractJson(''), /空输出/)
  assert.throws(() => extractJson('没有结构化内容'), /无法从模型输出中解析出 JSON/)
})
