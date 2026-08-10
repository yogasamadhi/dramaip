// parseOutputNode —— 解析模型输出（JSON 任务用 extractJson，文本任务取原文）
import { extractJson } from '../parsers/json'
import { effectiveTaskType, isJsonTask } from '../prompts/loader'
import type { NovelGraphStateType } from '../graphs/state'
import type { NodeDeps } from './deps'

export function createParseOutputNode(_deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    if (state.error) return {}

    if (isJsonTask(effectiveTaskType(state.taskType, state.templateScope))) {
      try {
        const parsed = extractJson(state.rawOutput ?? '')
        return { parsedOutput: parsed, error: '' }
      } catch (e) {
        return {
          error: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
          retryable: true,
        }
      }
    }

    // 文本任务：直接取原文
    const content = (state.rawOutput ?? '').trim()
    return { parsedOutput: content, error: '' }
  }
}
