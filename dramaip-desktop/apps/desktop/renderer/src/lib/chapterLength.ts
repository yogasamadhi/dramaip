/** 章节正文按非空白字符计数，与 AI 生成约束保持一致。 */
export function countChapterCharacters(content: string): number {
  return content.replace(/\s/g, '').length
}

export interface ChapterLengthStatus {
  count: number
  target: number
  minimum: number
  maximum: number
  direction: 'short' | 'long'
}

export interface ChapterLengthPlan {
  target: number
  minimum: number
  maximum: number
  preferredMinimum: number
  preferredTarget: number
  preferredMaximum: number
}

/** 与工作流提示词一致：首稿优选窗口偏向验收区间下半部，给模型超写留余量。 */
export function getChapterLengthPlan(wordGoal: number): ChapterLengthPlan {
  const target = Math.max(1, Math.round(wordGoal))
  const minimum = Math.max(1, target - 300)
  const maximum = target + 300
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

/** 返回需要人工决定是否调整的字数状态；范围内则返回 undefined。 */
export function getChapterLengthStatus(content: string, wordGoal: number): ChapterLengthStatus | undefined {
  const { target, minimum, maximum } = getChapterLengthPlan(wordGoal)
  const count = countChapterCharacters(content)
  if (count < minimum) return { count, target, minimum, maximum, direction: 'short' }
  if (count > maximum) return { count, target, minimum, maximum, direction: 'long' }
  return undefined
}
