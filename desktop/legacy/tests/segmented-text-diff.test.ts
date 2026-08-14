import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TextDiffPreviewPayload } from '../packages/core/src/types'
import {
  buildSegmentedTextDiff,
  changedBlockIds,
  selectedText,
  withPreviewContent,
} from '../apps/desktop/renderer/src/lib/segmentedTextDiff'

test('paragraph diff keeps Chinese revisions readable and can adopt one selected change', () => {
  const before = '雨落在窗上。\n\n林晚没有回头。\n\n门铃响了。'
  const after = '雨落在窗上。\n\n林晚攥紧门卡，却没有回头。\n\n门铃响了。\n\n倒计时只剩十秒。'
  const diff = buildSegmentedTextDiff(before, after)
  const changed = changedBlockIds(diff)

  assert.equal(changed.length, 2)
  assert.equal(selectedText(diff, new Set([changed[1]])), '雨落在窗上。\n\n林晚没有回头。\n\n门铃响了。\n\n倒计时只剩十秒。')
})

test('long paragraph diff stays bounded without quadratic line matrix', () => {
  const before = Array.from({ length: 2_000 }, (_, index) => `第 ${index + 1} 段原文。`).join('\n\n')
  const after = before.replace('第 1 段原文。', '第 1 段修改后正文。').replace('第 1999 段原文。', '第 1999 段修改后正文。')
  const started = performance.now()
  const diff = buildSegmentedTextDiff(before, after)

  assert.ok(performance.now() - started < 1_500)
  assert.ok(changedBlockIds(diff).length >= 2)
})

test('editing a structured preview retains the fields required for atomic adoption', () => {
  const script: TextDiffPreviewPayload = {
    targetKind: 'script', targetId: 'script-1', taskType: 'rewrite_ai_drama_script', currentContent: '旧剧本', nextContent: '新剧本',
    script: { episodeNumber: 1, title: '第一集', content: '新剧本', hook: '新钩子' },
  }
  const shot: TextDiffPreviewPayload = {
    targetKind: 'shot', targetId: 'shot-1', shotId: 'shot-1', taskType: 'rewrite_shot_prompt', currentContent: '旧', nextContent: '新',
    shotPatch: { videoPrompt: '旧视频', negativePrompt: '旧负面', imagePrompt: '旧图片' },
  }

  assert.equal(withPreviewContent(script, '只采用这段剧本').script?.content, '只采用这段剧本')
  const editedShot = withPreviewContent(shot, '视频 Prompt:\n新视频\n\n负面 Prompt:\n新负面\n\n图片 Prompt:\n新图片')
  assert.deepEqual(editedShot.shotPatch, { videoPrompt: '新视频', negativePrompt: '新负面', imagePrompt: '新图片' })
})
