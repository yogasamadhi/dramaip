import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  insertScriptBlock,
  moveScriptBlock,
  parseScriptMarkdown,
  parseStructuredScriptImport,
  removeScriptBlock,
  replaceScriptBlock,
  serializeScriptMarkdown,
  serializeStructuredScriptDocument,
} from '../packages/core/src/script-blocks'
import type { Script } from '../packages/core/src'
import { exportScriptJson } from '../packages/export/src/json'

const legacyMarkdown = [
  '## 场景 1：医院走廊 · 夜',
  '',
  '动作：林夏攥紧化验单，快步走向手术室。',
  '',
  '**林夏**',
  '',
  '林夏：医生，我爸怎么样？',
  '',
  '转场：切至手术室门口。',
].join('\n')

test('reads legacy script Markdown into scene, action, character, dialogue and transition blocks', () => {
  const document = parseScriptMarkdown(legacyMarkdown)
  assert.deepEqual(document.blocks.map((block) => block.kind), ['scene_heading', 'action', 'character', 'dialogue', 'transition'])
  assert.equal(document.blocks[0].text, '医院走廊 · 夜')
  assert.equal(document.blocks[3].speaker, '林夏')

  const roundtrip = parseScriptMarkdown(serializeScriptMarkdown(document))
  assert.deepEqual(roundtrip.blocks.map((block) => block.kind), ['scene_heading', 'action', 'character', 'dialogue', 'transition'])
  assert.equal(roundtrip.blocks[3].text, '医生，我爸怎么样？')
  assert.equal(roundtrip.blocks[4].text, '切至手术室门口。')
})

test('supports structured JSON, existing export JSON, and safe block editing without a storage migration', () => {
  const document = parseScriptMarkdown(legacyMarkdown)
  const fromStructuredJson = parseStructuredScriptImport(serializeStructuredScriptDocument(document))
  const fromExistingExport = parseStructuredScriptImport(JSON.stringify({ script: { content: legacyMarkdown } }))
  const script: Script = {
    id: 'script-1',
    adaptationProjectId: 'adaptation-1',
    episodeId: 'episode-1',
    episodeNumber: 1,
    title: '第 1 集',
    content: legacyMarkdown,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
  const exported = JSON.parse(exportScriptJson(script, [])) as { structuredDocument?: { format?: string } }
  const fromActualExport = parseStructuredScriptImport(exportScriptJson(script, []))
  assert.equal(fromStructuredJson.blocks.length, 5)
  assert.equal(fromExistingExport.blocks[3].speaker, '林夏')
  assert.equal(exported.structuredDocument?.format, 'dramaip-script-blocks')
  assert.equal(fromActualExport.blocks[4].kind, 'transition')

  const inserted = insertScriptBlock(document, document.blocks[3].id, 'dialogue')
  const edited = replaceScriptBlock(inserted, inserted.blocks[4].id, { speaker: '医生', text: '先去缴费。' })
  const reordered = moveScriptBlock(edited, edited.blocks[4].id, -1)
  const withoutTransition = removeScriptBlock(reordered, reordered.blocks.at(-1)!.id)
  const markdown = serializeScriptMarkdown(withoutTransition)
  assert.match(markdown, /医生：先去缴费。/)
  assert.doesNotMatch(markdown, /转场：/)
})

test('rejects malformed JSON rather than silently treating it as a script', () => {
  assert.throws(() => parseStructuredScriptImport('{not-json}'), /JSON 格式无效/)
})
