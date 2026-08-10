import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSaveAiRunNode } from '../packages/ai/src/nodes/save-ai-run.node'

function createDeps() {
  const rows: Array<{ input: string; type: string }> = []
  return {
    rows,
    deps: {
      repos: {
        db: {},
        aiRun: {
          createAiRun: (_db: unknown, row: { input: string; type: string }) => {
            rows.push(row)
            return { id: `run-${rows.length}` }
          },
        },
      },
      provider: { name: 'mock', model: 'mock-model' },
    } as never,
  }
}

test('redacts uploaded case study document text from ai run input logs', async () => {
  const { deps, rows } = createDeps()
  const save = createSaveAiRunNode(deps)
  const rawDocumentText = '这是上传样本文档的原文，不应该进入 ai_runs.input。'

  const out = await save({
    taskType: 'extract_case_structure',
    promptText: `# 本次指令\n\n${rawDocumentText}`,
    parsedOutput: { title: '结构样本' },
  } as never)

  assert.equal(out.aiRunId, 'run-1')
  assert.equal(rows[0].type, 'extract_case_structure')
  assert.match(rows[0].input, /上传原文仅用于本次模型调用/)
  assert.doesNotMatch(rows[0].input, new RegExp(rawDocumentText))
})

test('keeps prompt text in ai run input logs for normal tasks', async () => {
  const { deps, rows } = createDeps()
  const save = createSaveAiRunNode(deps)

  await save({
    taskType: 'generate_project',
    promptText: '普通项目生成 prompt',
    parsedOutput: { title: '项目' },
  } as never)

  assert.equal(rows[0].input, '普通项目生成 prompt')
})
