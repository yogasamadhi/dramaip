// callModelNode —— 调用 OpenAI-compatible 模型（§10.2 / §9）
import { effectiveTaskType, isJsonTask } from '../prompts/loader'
import type { ChatInput, ChatMessage } from '@sdns/core'
import type { NovelGraphStateType } from '../graphs/state'
import type { NodeDeps } from './deps'
import { checkAiBudgetBeforeCall } from '../budget'

export function createCallModelNode(deps: NodeDeps) {
  return async (state: NovelGraphStateType): Promise<Partial<NovelGraphStateType>> => {
    // 上游（如缺模板）已置错 → 跳过模型调用，由路由送入失败记账
    if (state.error) return {}

    const provider = deps.provider
    if (!provider) {
      return { error: '未配置可用模型（请在设置中添加并设为默认）', retryable: false }
    }

    const effectiveType = effectiveTaskType(state.taskType, state.templateScope)
    // 校验失败后会从 build_prompt 回到这里。通知流式 UI 清空上一轮不合格文本，
    // 让重试结果从空编辑器开始显示，而不是与第一次结果拼接。
    if ((state.retryCount ?? 0) > 0) deps.onRetry?.()
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: '你是「短剧 IP 小说写作工作台」的 AI 写作助手。严格遵循用户给出的格式与要求。',
      },
      { role: 'user', content: state.promptText ?? '' },
    ]

    const input: ChatInput = {
      messages,
      temperature: effectiveType === 'evaluate_ai_drama_fit' ? 0.2 : 0.9,
      responseFormat: isJsonTask(effectiveType) ? 'json' : 'text',
      signal: deps.signal,
    }

    const startedAt = Date.now()
    try {
      const budget = checkAiBudgetBeforeCall(deps.repos, state.promptText ?? '')
      if (!budget.ok) {
        return {
          error: budget.error,
          retryable: false,
          providerName: provider.name,
          modelName: provider.model,
          latencyMs: Date.now() - startedAt,
        }
      }

      if (deps.onToken && provider.stream) {
        let content = ''
        for await (const token of provider.stream(input)) {
          content += token
          deps.onToken(token)
        }
        if (!content) throw new Error('模型返回空内容')
        return {
          rawOutput: content,
          providerName: provider.name,
          modelName: provider.model,
          latencyMs: Date.now() - startedAt,
        }
      }

      const out = await provider.chat(input)
      return {
        rawOutput: out.content,
        providerName: provider.name,
        modelName: provider.model,
        tokenUsage: out.tokenUsage,
        latencyMs: Date.now() - startedAt,
      }
    } catch (e) {
      if (deps.signal?.aborted) throw new Error('任务已取消')
      return {
        error: `模型调用失败：${e instanceof Error ? e.message : String(e)}`,
        retryable: false,
        providerName: provider.name,
        modelName: provider.model,
        latencyMs: Date.now() - startedAt,
      }
    }
  }
}
