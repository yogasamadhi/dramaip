import {
  chapterLengthPlan,
  countChapterCharacters,
  type ChapterLengthPlan,
} from '@sdns/core'

export { countChapterCharacters }
export type { ChapterLengthPlan }

export interface ChapterLengthStatus {
  count: number
  target: number
  minimum: number
  maximum: number
  direction: 'short' | 'long'
}

export function getChapterLengthPlan(wordGoal: number): ChapterLengthPlan {
  return chapterLengthPlan(wordGoal)
}

export function getChapterLengthStatus(content: string, wordGoal: number): ChapterLengthStatus | undefined {
  const { target, minimum, maximum } = getChapterLengthPlan(wordGoal)
  const count = countChapterCharacters(content)
  if (count < minimum) return { count, target, minimum, maximum, direction: 'short' }
  if (count > maximum) return { count, target, minimum, maximum, direction: 'long' }
  return undefined
}
