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

/** 返回需要人工决定是否调整的字数状态；范围内则返回 undefined。 */
export function getChapterLengthStatus(content: string, wordGoal: number): ChapterLengthStatus | undefined {
  const target = Math.max(1, Math.round(wordGoal))
  const minimum = Math.max(1, target - 300)
  const maximum = target + 300
  const count = countChapterCharacters(content)
  if (count < minimum) return { count, target, minimum, maximum, direction: 'short' }
  if (count > maximum) return { count, target, minimum, maximum, direction: 'long' }
  return undefined
}
