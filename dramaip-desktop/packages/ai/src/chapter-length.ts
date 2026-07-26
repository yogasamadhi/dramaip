/** 未在编辑器中另行设置时，每章正文默认目标字数。 */
export const DEFAULT_CHAPTER_WORD_GOAL = 2000

/** 章节生成允许相对目标字数上下浮动的字符数。 */
export const CHAPTER_WORD_GOAL_TOLERANCE = 300

/**
 * 章节正文请求的输出 Token 上限。
 *
 * 云端 AI 协议当前最多接受 8192 tokens；本地 OpenAI-compatible Provider
 * 也使用同一上限，避免模型忽略字数指令后无限扩写。它只是防失控护栏，
 * 最终是否合格仍以非空白字符数校验为准。
 */
export const MAX_CHAPTER_OUTPUT_TOKENS = 8_192

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

export interface ChapterLengthPlan {
  target: number
  minimum: number
  maximum: number
  preferredMinimum: number
  preferredTarget: number
  preferredMaximum: number
}

/**
 * 模型通常更容易超写而不是少写，因此首稿窗口主动偏向验收区间下半部。
 *
 * 以默认 2000 字为例：
 * - 最终验收：1700–2300
 * - 首稿优选：1750–1900（中心 1825）
 *
 * 即使模型比自估篇幅多写约 20%，通常仍不会撞过 2300 字红线；严格按
 * 指令生成的模型也仍处于验收范围内。
 */
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

/**
 * 把目标字符数换算成宽松的输出 Token 预算。
 *
 * 不用 Token 数代替中文字数，只把它作为第二道上限。1.4 倍字符数加固定
 * 余量可容纳常见中文分词差异和 Markdown 标题，同时显著缩小失控扩写空间。
 */
export function chapterOutputTokenLimit(wordGoal?: number): number {
  const { maximum } = chapterLengthRange(wordGoal)
  return Math.min(MAX_CHAPTER_OUTPUT_TOKENS, Math.max(512, Math.ceil(maximum * 1.4) + 512))
}

export function chapterRewriteLengthGuidance(
  sourceCount: number,
  preferredMinimum: number,
  preferredTarget: number,
  preferredMaximum: number,
): string {
  if (sourceCount > preferredMaximum) {
    return `当前待改正文实测 ${sourceCount} 字。必须做净压缩：至少删去 ${sourceCount - preferredMaximum} 字，建议净删约 ${sourceCount - preferredTarget} 字后收束在优选区间。新增任何钩子、冲突、爽点、对白或描写时，都要同步删除更多低价值文字，不能只加不减。`
  }
  if (sourceCount < preferredMinimum) {
    return `当前待改正文实测 ${sourceCount} 字。需要净补足：至少增加 ${preferredMinimum - sourceCount} 字，建议净增约 ${preferredTarget - sourceCount} 字；只补与原情节直接相关的动作、对白和必要过渡，不得新开支线。`
  }
  return `当前待改正文实测 ${sourceCount} 字，已在首稿优选区间。采用等量替换：新增钩子、冲突、爽点、对白或描写时，必须同步删去相近篇幅的低价值文字，使最终篇幅基本不增长。`
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

/**
 * 首次越界时返回可触发工作流自动纠偏的错误；第二稿保留给 UI 兜底。
 */
export function chapterLengthRetryError(
  content: string,
  wordGoal: number | undefined,
  retryCount: number,
): string | undefined {
  const error = chapterLengthError(content, wordGoal)
  return error && retryCount === 0
    ? `${error}。程序验收未通过，请按实测偏差重新生成`
    : undefined
}
