import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chapter, ChapterMemory, Character, Outline, QualityGateReport } from '@sdns/core'
import { buildAdaptationReadiness } from '../apps/desktop/renderer/src/lib/adaptationReadiness'

function chapter(id: string, content = '正文'): Chapter {
  return { id, projectId: 'p1', title: id, orderIndex: 0, content, createdAt: '', updatedAt: '' } as Chapter
}

function qualityReport(blockingIssues: string[] = []): QualityGateReport {
  return {
    id: 'q1',
    projectId: 'p1',
    targetKind: 'project',
    stage: 'novel',
    score: blockingIssues.length ? 55 : 86,
    verdict: blockingIssues.length ? 'block' : 'pass',
    blockingIssues,
    warnings: [],
    suggestions: [],
    createdAt: '',
    updatedAt: '',
  } as QualityGateReport
}

test('flags empty source projects with clear adaptation risks', () => {
  const readiness = buildAdaptationReadiness({
    chapters: [],
    characters: [],
    outlines: [],
    chapterMemories: [],
    qualityReports: [],
  })

  assert.equal(readiness.riskCount, 2)
  assert.equal(readiness.warningCount, 3)
})

test('surfaces quality gate blocking issues', () => {
  const readiness = buildAdaptationReadiness({
    chapters: [chapter('c1'), chapter('c2'), chapter('c3')],
    characters: [{ id: 'char1', projectId: 'p1', name: '女主', role: '主角', createdAt: '', updatedAt: '' } as Character],
    outlines: [{ id: 'o1', projectId: 'p1', type: 'book', title: '全书', content: '大纲', orderIndex: 0, createdAt: '', updatedAt: '' } as Outline],
    chapterMemories: [{ id: 'm1', projectId: 'p1', chapterId: 'c1', summary: '摘要', importantEvents: [], characterChanges: [], revealedSecrets: [], newForeshadowing: [], resolvedForeshadowing: [], keyVisualElements: [], createdAt: '', updatedAt: '' } as ChapterMemory],
    qualityReports: [qualityReport(['主角目标不清晰'])],
  })
  const quality = readiness.items.find((item) => item.key === 'quality')

  assert.equal(quality?.severity, 'risk')
  assert.match(quality?.detail ?? '', /阻塞项 1 个/)
})

test('marks a prepared source project as ready', () => {
  const readiness = buildAdaptationReadiness({
    chapters: [chapter('c1'), chapter('c2'), chapter('c3')],
    characters: [{ id: 'char1', projectId: 'p1', name: '女主', role: '主角', createdAt: '', updatedAt: '' } as Character],
    outlines: [{ id: 'o1', projectId: 'p1', type: 'book', title: '全书', content: '大纲', orderIndex: 0, createdAt: '', updatedAt: '' } as Outline],
    chapterMemories: [
      { id: 'm1', projectId: 'p1', chapterId: 'c1', summary: '摘要', importantEvents: [], characterChanges: [], revealedSecrets: [], newForeshadowing: [], resolvedForeshadowing: [], keyVisualElements: [], createdAt: '', updatedAt: '' } as ChapterMemory,
      { id: 'm2', projectId: 'p1', chapterId: 'c2', summary: '摘要', importantEvents: [], characterChanges: [], revealedSecrets: [], newForeshadowing: [], resolvedForeshadowing: [], keyVisualElements: [], createdAt: '', updatedAt: '' } as ChapterMemory,
    ],
    qualityReports: [qualityReport()],
  })

  assert.equal(readiness.riskCount, 0)
  assert.equal(readiness.readyCount, 5)
})
