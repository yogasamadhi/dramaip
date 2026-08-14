import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chapter, ChapterMemory, LongTask, Script, Shot, ShotReview } from '@sdns/core'
import {
  chaptersWithoutMemory,
  failedLongTasks,
  isHighRiskShot,
  latestQualityIssueAcknowledgements,
  needsScriptReview,
  summarizeQualityGateIssues,
} from '../apps/desktop/renderer/src/lib/qualityGateDashboard'

test('quality gate helpers find missing memories and unreviewed scripts', () => {
  const chapters = [
    { id: 'c1', projectId: 'p1', title: '第一章', content: 'a', createdAt: '', updatedAt: '' },
    { id: 'c2', projectId: 'p1', title: '第二章', content: 'b', createdAt: '', updatedAt: '' },
  ] as Chapter[]
  const memories = [{ id: 'm1', projectId: 'p1', chapterId: 'c1' }] as ChapterMemory[]
  assert.deepEqual(chaptersWithoutMemory(chapters, memories).map((chapter) => chapter.id), ['c2'])

  const script = { id: 's1', adaptationProjectId: 'a1', episodeId: 'e1', episodeNumber: 1, title: '第 1 集', content: '正文', createdAt: '', updatedAt: '' } as Script
  assert.equal(needsScriptReview(script), true)
  assert.equal(needsScriptReview({ ...script, content: '   ' }), false)
})

test('quality gate helpers flag risky shots and failed tasks', () => {
  const shot = { id: 'sh1', sceneId: 'sc1', episodeId: 'e1', shotNumber: 1, visualDescription: '', characterIds: [], videoPrompt: '', aiVideoDifficulty: 'medium', createdAt: '', updatedAt: '' } as Shot
  const lowScoreReview = { shotId: 'sh1', overallScore: 45, aiVideoDifficulty: 'medium' } as ShotReview
  assert.equal(isHighRiskShot(shot, lowScoreReview), true)
  assert.equal(isHighRiskShot({ ...shot, aiVideoDifficulty: 'high' }), true)
  assert.equal(isHighRiskShot(shot, { ...lowScoreReview, overallScore: 80, aiVideoDifficulty: 'low' }), false)

  const tasks = [
    { id: 't1', kind: 'ai', status: 'success', title: 'ok', createdAt: '', updatedAt: '' },
    { id: 't2', kind: 'video', status: 'failed', title: 'bad', createdAt: '', updatedAt: '' },
  ] as LongTask[]
  assert.deepEqual(failedLongTasks(tasks).map((task) => task.id), ['t2'])
})

test('quality gate issue summary counts severities', () => {
  const summary = summarizeQualityGateIssues([
    { id: '1', kind: 'failed_task', severity: 'block', title: 'a', detail: '' },
    { id: '2', kind: 'shot_risk', severity: 'block', title: 'b', detail: '' },
    { id: '3', kind: 'chapter_memory', severity: 'warn', title: 'c', detail: '' },
  ])
  assert.deepEqual(summary, { total: 3, block: 2, warn: 1, info: 0 })
})

test('latest acknowledgement wins while earlier risk decisions remain auditable', () => {
  const latest = latestQualityIssueAcknowledgements([
    { id: 'ack-1', projectId: 'p1', issueId: 'quality-report:r1:block:0', issueKind: 'quality_report', issueTitle: '风险', disposition: 'accepted', actorLabel: '本地用户', createdAt: '2026-07-20T10:00:00.000Z' },
    { id: 'ack-2', projectId: 'p1', issueId: 'quality-report:r1:block:0', issueKind: 'quality_report', issueTitle: '风险', disposition: 'ignored', actorLabel: '本地用户', createdAt: '2026-07-20T10:01:00.000Z' },
  ])

  assert.equal(latest.get('quality-report:r1:block:0')?.id, 'ack-2')
})
