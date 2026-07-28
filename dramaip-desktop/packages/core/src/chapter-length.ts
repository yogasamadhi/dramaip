export const DEFAULT_CHAPTER_WORD_GOAL = 2_000
export const MIN_CHAPTER_WORD_GOAL = 1
export const MAX_CHAPTER_WORD_GOAL = 5_000
export const CHAPTER_WORD_GOAL_TOLERANCE = 300

export interface ChapterLengthPlan {
  target: number
  minimum: number
  maximum: number
  preferredMinimum: number
  preferredTarget: number
  preferredMaximum: number
}

export function normalizeChapterWordGoal(wordGoal?: number): number {
  if (!Number.isFinite(wordGoal)) return DEFAULT_CHAPTER_WORD_GOAL
  return Math.min(MAX_CHAPTER_WORD_GOAL, Math.max(MIN_CHAPTER_WORD_GOAL, Math.round(Number(wordGoal))))
}

export function chapterLengthRange(wordGoal?: number): { target: number; minimum: number; maximum: number } {
  const target = normalizeChapterWordGoal(wordGoal)
  return {
    target,
    minimum: Math.max(MIN_CHAPTER_WORD_GOAL, target - CHAPTER_WORD_GOAL_TOLERANCE),
    maximum: target + CHAPTER_WORD_GOAL_TOLERANCE,
  }
}

export function chapterLengthPlan(wordGoal?: number): ChapterLengthPlan {
  const { target, minimum, maximum } = chapterLengthRange(wordGoal)
  const lowerHalfWidth = target - minimum
  const lowerGuard = Math.min(50, Math.floor(lowerHalfWidth / 4))
  const upperBias = Math.min(100, Math.floor(lowerHalfWidth / 3))
  const preferredMinimum = Math.min(maximum, minimum + lowerGuard)
  const preferredMaximum = Math.max(preferredMinimum, target - upperBias)
  return {
    target,
    minimum,
    maximum,
    preferredMinimum,
    preferredTarget: Math.round((preferredMinimum + preferredMaximum) / 2),
    preferredMaximum,
  }
}

export function countChapterCharacters(content: string): number {
  return content.replace(/\s/g, '').length
}
