import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAiContextPreview, createAiRunDebugPayload } from '../apps/desktop/electron/ai-context-preview'
import type { AiRun } from '../packages/core/src/types'

function run(input: string): AiRun {
  return {
    id: 'run1',
    projectId: 'p1',
    graphName: 'novel-workflow',
    type: 'generate_ai_drama_script',
    provider: 'mock',
    model: 'mock-model',
    input,
    output: 'ok',
    status: 'success',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

test('creates a sectioned AI context preview from model input material', () => {
  const preview = createAiContextPreview(run([
    '模板',
    '---',
    '# 输入材料',
    '## 项目设定',
    '- 作品名称：测试',
    '## 主要人物',
    '- 女主：目标明确',
    '# 本次指令',
    '生成第一集',
  ].join('\n')))

  assert.equal(preview.aiRunId, 'run1')
  assert.equal(preview.sections.length, 2)
  assert.equal(preview.sections[0].title, '项目设定')
  assert.match(preview.sections[1].excerpt, /女主/)
  assert.ok(preview.estimatedContextTokens > 0)
})

test('debug payload masks secrets and keeps sample documents redacted', () => {
  const payload = createAiRunDebugPayload(run('样本文档上传抽取：上传原文仅用于本次模型调用，ai_runs 不保存原文。 sk-1234567890abcdef'))
  const preview = payload.preview as { redacted: boolean }

  assert.equal(preview.redacted, true)
  assert.doesNotMatch(String(payload.modelInput), /sk-1234567890abcdef/)
  assert.match(String(payload.modelInput), /sk-\*\*\*/)
})
