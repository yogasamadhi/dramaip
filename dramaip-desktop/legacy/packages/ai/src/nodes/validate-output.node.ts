// validateOutputNode —— 使用任务定义表中的 Zod schema 校验结构化输出（§10.2 / §14）
import type { NovelGraphStateType } from '../graphs/state'
import { effectiveTaskType, getTaskSchema, isTextChapterTask } from '../prompts/loader'
import { chapterLengthRetryError } from '../chapter-length'
import type { NodeDeps } from './deps'

export function createValidateOutputNode(_deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    if (state.error) return {}

    // v0.8：template_run 按 templateScope 取校验 schema
    const effectiveType = effectiveTaskType(state.taskType, state.templateScope)
    const schema = getTaskSchema(effectiveType)
    if (!schema) {
      // 文本任务：仅校验非空
      const content = String(state.parsedOutput ?? '')
      if (!content.trim()) {
        return { error: '模型输出为空', retryable: true }
      }
      const lengthBound = state.chapterWordGoal !== undefined
        && isTextChapterTask(effectiveType)
        && effectiveType !== 'continue_chapter'
      const lengthError = lengthBound
        ? chapterLengthRetryError(content, state.chapterWordGoal, state.retryCount ?? 0)
        : undefined
      if (lengthError) {
        return {
          error: lengthError,
          retryable: true,
        }
      }
      // 自动纠偏只额外调用一次模型。若第二稿仍越界，保留完整文本交给
      // 现有前端字数决策弹窗，用户仍可保留或继续定向调整，不丢失结果。
      return { parsedOutput: content, error: '' }
    }

    const result = schema.safeParse(state.parsedOutput)
    if (result.success) {
      return { parsedOutput: result.data, error: '' }
    }
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { error: `结构校验失败：${detail}`, retryable: true }
  }
}
