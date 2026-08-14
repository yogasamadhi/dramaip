import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TASK_WRITE_POLICIES } from '../packages/core/src/constants'
import {
  buildAiCommandCatalog,
  filterAiCommands,
  normalizeAiCommandActivity,
  recommendAiCommands,
  recordRecentCommand,
  toggleFavoriteCommand,
} from '../apps/desktop/renderer/src/lib/aiCommandCatalog'

test('AI command catalog keeps every registered task reachable with its original write policy', () => {
  const catalog = buildAiCommandCatalog()
  assert.deepEqual(new Set(catalog.map((command) => command.taskType)), new Set(Object.keys(TASK_WRITE_POLICIES)))
  assert.equal(catalog.find((command) => command.taskType === 'polish_chapter')?.writePolicy.policy, 'preview_then_adopt')
  assert.equal(catalog.find((command) => command.taskType === 'split_scene_to_shots')?.writePolicy.policy, 'snapshot_then_auto_write')
})

test('AI command search and recommendations stay contextual and bounded', () => {
  const catalog = buildAiCommandCatalog()
  assert.ok(filterAiCommands(catalog, '润色').some((command) => command.taskType === 'polish_chapter'))
  assert.equal(catalog.find((command) => command.taskType === 'enhance_conflict')?.category, 'conflict')
  assert.deepEqual(recommendAiCommands(catalog, null).map((command) => command.taskType), ['generate_project', 'generate_chapter_outline', 'generate_characters'])
  assert.deepEqual(
    recommendAiCommands(catalog, { id: 'c1', projectId: 'p1', title: '第一章', orderIndex: 0, content: '已有正文', createdAt: '', updatedAt: '' }).map((command) => command.taskType),
    ['continue_chapter', 'polish_chapter', 'enhance_conflict'],
  )
})

test('AI command activity caps recent commands and removes unsupported persisted values', () => {
  const sanitized = normalizeAiCommandActivity({ favorites: ['polish_chapter', 'unknown'], recent: ['rewrite_chapter', 42] })
  assert.deepEqual(sanitized, { favorites: ['polish_chapter'], recent: ['rewrite_chapter'] })
  const recent = recordRecentCommand(sanitized, 'polish_chapter')
  assert.deepEqual(recent.recent, ['polish_chapter', 'rewrite_chapter'])
  assert.deepEqual(toggleFavoriteCommand(recent, 'polish_chapter').favorites, [])
})
