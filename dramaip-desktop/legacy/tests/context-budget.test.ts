import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chapter, Project } from '@sdns/core'
import {
  applyContextBudget,
  buildAdaptationContext,
  buildChatContext,
  contextBudgetForTask,
  estimateContextTokens,
} from '../packages/ai/src/context/context-builder'

function project(): Project {
  return {
    id: 'p1',
    title: '超长项目',
    shortDramaType: '女频复仇',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Project
}

function chapter(index: number): Chapter {
  return {
    id: `c${index}`,
    projectId: 'p1',
    title: `第 ${index} 章`,
    orderIndex: index,
    summary: `这一章发生了大量事件。${'关键冲突与人物关系变化。'.repeat(80)}`,
    content: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Chapter
}

test('applies task context budget to oversized project context', () => {
  const raw = buildAdaptationContext({
    project: project(),
    chapters: Array.from({ length: 200 }, (_, index) => chapter(index + 1)),
  })
  const budgeted = applyContextBudget(raw, 'convert_novel_to_episodes')

  assert.ok(estimateContextTokens(raw) > contextBudgetForTask('convert_novel_to_episodes'))
  assert.ok(budgeted.includes('上下文裁剪说明'))
  assert.ok(estimateContextTokens(budgeted) <= contextBudgetForTask('convert_novel_to_episodes'))
})

test('chat context keeps recent turns instead of full history', () => {
  const context = buildChatContext({
    project: project(),
    chatHistory: Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}`,
    })),
  })

  assert.equal(context.includes('message-0'), false)
  assert.equal(context.includes('message-19'), true)
})
