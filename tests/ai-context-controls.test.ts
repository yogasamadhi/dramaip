import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chapter, Character, Project } from '@sdns/core'
import { applyContextControls } from '../packages/ai/src/context/context-controls'
import { buildAiPreflightContext } from '../apps/desktop/renderer/src/lib/aiPreflightContext'

test('applies context controls by excluding ids and moving pinned ids first', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const controlled = applyContextControls(items, 'chapters', {
    pinned: { chapters: ['c'] },
    excluded: { chapters: ['b'] },
  })

  assert.deepEqual(controlled.map((item) => item.id), ['c', 'a'])
})

test('preflight preview exposes pinned and excluded context choices', () => {
  const preview = buildAiPreflightContext('rewrite_chapter', {
    project: { id: 'p1', title: '短剧小说', shortDramaType: '复仇', createdAt: '', updatedAt: '' } as Project,
    chapters: [
      { id: 'c1', projectId: 'p1', title: '第一章', orderIndex: 0, content: '开局正文', createdAt: '', updatedAt: '' },
      { id: 'c2', projectId: 'p1', title: '第二章', orderIndex: 1, content: '后续正文', createdAt: '', updatedAt: '' },
    ] as Chapter[],
    characters: [
      { id: 'char1', projectId: 'p1', name: '女主', role: '主角', createdAt: '', updatedAt: '' },
      { id: 'char2', projectId: 'p1', name: '反派', role: '反派', createdAt: '', updatedAt: '' },
    ] as Character[],
    caseStudies: [],
    visualProfiles: [],
  }, {
    pinned: { chapters: ['c2'] },
    excluded: { characters: ['char2'] },
  })

  assert.match(preview.preview.sections[0]?.excerpt ?? '', /固定章节：1 项/)
  assert.match(preview.preview.sections[0]?.excerpt ?? '', /排除人物：1 项/)
  assert.match(preview.preview.sections.find((section) => section.title === '章节上下文')?.excerpt ?? '', /第二章/)
  assert.doesNotMatch(preview.preview.sections.find((section) => section.title === '人物上下文')?.excerpt ?? '', /反派/)
  assert.equal(preview.groups.find((group) => group.key === 'chapters')?.items.find((item) => item.id === 'c2')?.mode, 'pinned')
})
