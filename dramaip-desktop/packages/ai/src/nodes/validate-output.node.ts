// validateOutputNode —— 使用任务定义表中的 Zod schema 校验结构化输出（§10.2 / §14）
import type { NovelGraphStateType } from '../graphs/state'
import { effectiveTaskType, getTaskSchema } from '../prompts/loader'
import type { NodeDeps } from './deps'

export function createValidateOutputNode(_deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    if (state.error) return {}

    // v0.8：template_run 按 templateScope 取校验 schema
    const schema = getTaskSchema(effectiveTaskType(state.taskType, state.templateScope))
    if (!schema) {
      // 文本任务：仅校验非空
      const content = String(state.parsedOutput ?? '')
      if (!content.trim()) {
        return { error: '模型输出为空', retryable: true }
      }
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
