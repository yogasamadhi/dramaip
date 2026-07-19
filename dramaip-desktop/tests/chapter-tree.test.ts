import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chapter, StoryArc } from '../packages/core/src/types'
import { buildChapterTreeRows, chapterTreeVirtualRange, moveChapterIds } from '../apps/desktop/renderer/src/lib/chapterTree'

function chapter(index: number, title = `第 ${index + 1} 章`): Chapter {
  return {
    id: `c${index + 1}`,
    projectId: 'p1',
    title,
    orderIndex: index,
    content: index === 1 ? '宴会反击正文' : '普通正文',
    createdAt: '',
    updatedAt: '',
  }
}

function arc(id: string, kind: StoryArc['kind'], title: string, parentId?: string, chapterStart?: number, chapterEnd?: number): StoryArc {
  return {
    id,
    projectId: 'p1',
    parentId,
    kind,
    title,
    chapterStart,
    chapterEnd,
    keyHighlights: [],
    foreshadowingPayoffs: [],
    orderIndex: 0,
    createdAt: '',
    updatedAt: '',
  }
}

test('builds a volume/unit/chapter tree without changing legacy chapter order', () => {
  const chapters = [chapter(0), chapter(1), chapter(2)]
  const volume = arc('v1', 'volume', '第一卷')
  const unit = arc('u1', 'unit', '宴会反击', volume.id, 1, 2)
  const rows = buildChapterTreeRows(chapters, [volume, unit])

  assert.deepEqual(rows.map((row) => `${row.kind}:${row.id}`), ['arc:v1', 'arc:u1', 'chapter:c1', 'chapter:c2', 'arc:__ungrouped__', 'chapter:c3'])
  assert.equal(rows.find((row) => row.id === 'u1' && row.kind === 'arc')?.chapterCount, 2)
})

test('search retains matching chapter ancestors and expands collapsed arcs', () => {
  const volume = arc('v1', 'volume', '第一卷')
  const unit = arc('u1', 'unit', '宴会反击', volume.id, 1, 2)
  const rows = buildChapterTreeRows([chapter(0), chapter(1)], [volume, unit], {
    query: '宴会',
    collapsedArcIds: new Set(['v1', 'u1']),
  })

  assert.deepEqual(rows.map((row) => `${row.kind}:${row.id}`), ['arc:v1', 'arc:u1', 'chapter:c2'])
  assert.equal(rows.find((row) => row.id === 'v1' && row.kind === 'arc')?.collapsed, false)
})

test('moves selected chapters as an ordered group and virtualizes a 300 chapter fixture', () => {
  assert.deepEqual(moveChapterIds(['c1', 'c2', 'c3', 'c4'], ['c2', 'c4'], 'c3'), ['c1', 'c2', 'c4', 'c3'])
  assert.deepEqual(moveChapterIds(['c1', 'c2', 'c3'], ['c2']), ['c1', 'c3', 'c2'])

  const range = chapterTreeVirtualRange(300, 36 * 120, 36 * 8)
  assert.ok(range.start > 0)
  assert.ok(range.end < 300)
  assert.ok(range.end - range.start <= 24)
})
