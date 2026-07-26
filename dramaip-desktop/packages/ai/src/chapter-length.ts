/** 未在编辑器中另行设置时，每章正文默认目标字数。 */
export const DEFAULT_CHAPTER_WORD_GOAL = 2000

/** 章节生成允许相对目标字数上下浮动的字符数。 */
export const CHAPTER_WORD_GOAL_TOLERANCE = 300

/** 防止异常输入把模型请求或 IPC 负载放大到不合理的程度。 */
const MIN_CHAPTER_WORD_GOAL = 1
const MAX_CHAPTER_WORD_GOAL = 100_000

/** 将界面传入的目标字数规范化；未传入时沿用默认 2000 字。 */
export function normalizeChapterWordGoal(wordGoal?: number): number {
  if (!Number.isFinite(wordGoal)) return DEFAULT_CHAPTER_WORD_GOAL
  return Math.min(MAX_CHAPTER_WORD_GOAL, Math.max(MIN_CHAPTER_WORD_GOAL, Math.round(Number(wordGoal))))
}

/** 计算本次生成可接受的字数范围，按非空白字符计，边界包含在内。 */
export function chapterLengthRange(wordGoal?: number): { target: number; minimum: number; maximum: number } {
  const target = normalizeChapterWordGoal(wordGoal)
  return {
    target,
    minimum: Math.max(1, target - CHAPTER_WORD_GOAL_TOLERANCE),
    maximum: target + CHAPTER_WORD_GOAL_TOLERANCE,
  }
}

export function countChapterCharacters(content: string): number {
  return content.replace(/\s/g, '').length
}

/** 返回越界原因；undefined 表示可采用。 */
export function chapterLengthError(content: string, wordGoal?: number): string | undefined {
  const count = countChapterCharacters(content)
  const { target, minimum, maximum } = chapterLengthRange(wordGoal)
  if (count < minimum) {
    return `章节正文为 ${count} 字，少于目标 ${target} 字允许的下限 ${minimum} 字`
  }
  if (count > maximum) {
    return `章节正文为 ${count} 字，超过目标 ${target} 字允许的上限 ${maximum} 字`
  }
  return undefined
}
