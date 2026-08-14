import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseFeedbackImport } from '../packages/core/src'

test('parses a metrics CSV while preserving platform, version, time window, target, and metric definition', () => {
  const preview = parseFeedbackImport({
    kind: 'metrics', sourceName: 'douyin-week.csv', content: [
      'platform,metric,value,recorded_at,variant_key,target_kind,target_id',
      '抖音,views,1200,2026-07-23,A,episode,episode-1',
      '抖音,completion_rate,88%,2026-07-23,B,episode,episode-1',
    ].join('\n'),
  })
  assert.equal(preview.platform, '抖音')
  assert.equal(preview.metrics.length, 2)
  assert.equal(preview.metrics[0].metricKey, 'plays')
  assert.equal(preview.metrics[0].targetKind, 'episode')
  assert.equal(preview.metrics[0].variantKey, 'A')
  assert.equal(preview.metrics[1].value, 0.88)
  assert.match(preview.metrics[1].definition ?? '', /同口径/)
})

test('parses generic metrics columns without presenting cross-platform values as one heat score', () => {
  const preview = parseFeedbackImport({ kind: 'metrics', sourceName: 'redguo.json', content: JSON.stringify({ platform: '红果短剧', version: 'v2', records: [{ views: 90, shares: 4, comments: 3 }] }) })
  assert.equal(preview.platform, '红果短剧')
  assert.equal(preview.sourceVersion, 'v2')
  assert.deepEqual(preview.metrics.map((metric) => metric.metricKey), ['plays', 'comments', 'shares'])
  assert.ok(preview.notices.some((notice) => notice.includes('不同平台数据合成为单一热度')))
})

test('parses, bounds, and file-deduplicates local comments without treating their text as an AI summary', () => {
  const comment = { id: 'c1', 平台: '抖音', 评论内容: '第一集反转很爽，但中段节奏有点拖。', 目标类型: 'episode', 目标ID: 'episode-1' }
  const preview = parseFeedbackImport({ kind: 'comments', sourceName: 'comments.json', content: JSON.stringify({ comments: [comment, comment] }) })
  assert.equal(preview.comments.length, 1)
  assert.equal(preview.comments[0].targetKind, 'episode')
  assert.match(preview.comments[0].text, /反转很爽/)
  assert.ok(preview.notices.some((notice) => notice.includes('仅本地保存')))
  assert.ok(preview.notices.some((notice) => notice.includes('去重')))
})
