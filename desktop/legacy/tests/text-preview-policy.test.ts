import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TextDiffPreviewPayload } from '@sdns/core'
import { shouldAutoAdoptChapterDraft } from '../apps/desktop/renderer/src/lib/textPreviewPolicy'

function preview(patch: Partial<TextDiffPreviewPayload> = {}): TextDiffPreviewPayload {
  return {
    targetKind: 'chapter',
    targetId: 'chapter-1',
    taskType: 'generate_chapter',
    currentContent: '',
    nextContent: '新生成的正文。',
    projectId: 'project-1',
    ...patch,
  }
}

test('automatically adopts only the first generated draft for an empty chapter', () => {
  assert.equal(shouldAutoAdoptChapterDraft(preview()), true)
  assert.equal(shouldAutoAdoptChapterDraft(preview({ currentContent: '已有正文。' })), false)
  assert.equal(shouldAutoAdoptChapterDraft(preview({ currentContent: '  \n' })), true)
  assert.equal(shouldAutoAdoptChapterDraft(preview({ taskType: 'polish_chapter' })), false)
})
