import type { TextDiffPreviewPayload } from '@sdns/core'

/**
 * An empty chapter has no existing text to protect. Its first generated draft
 * should become the chapter directly; subsequent edits remain reviewable.
 */
export function shouldAutoAdoptChapterDraft(preview: TextDiffPreviewPayload): boolean {
  return preview.targetKind === 'chapter'
    && preview.taskType === 'generate_chapter'
    && !preview.currentContent.trim()
}
