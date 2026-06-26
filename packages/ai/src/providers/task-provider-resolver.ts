// resolveProviderForTask —— 按任务组解析 LLM Provider（ROADMAP v1.0-3）
//
// 优先级：task_model_bindings[taskGroup] → 默认模型 → undefined
// 让「不同任务用不同模型」：例如写作用大模型、分析用快模型。
import type { LLMProvider, ModelConfig, NovelTaskType } from '@sdns/core'
import { resolveTaskGroup } from '@sdns/core'
import type { Repositories } from '@sdns/db'
import { providerFromModelConfig } from './openai-compatible.provider'

export interface ProviderResolution {
  provider?: LLMProvider
  /** 实际命中的模型配置（便于记账/日志） */
  config?: ModelConfig
  /** 是否走了任务组绑定（true）还是默认模型（false） */
  fromBinding: boolean
}

/**
 * 按 taskType 解析应使用的模型配置与 Provider。
 * - template_run 按 templateScope 归组（如 templateScope=generate_project → setup 组）。
 */
export function resolveProviderForTask(
  repos: Repositories,
  taskType: NovelTaskType,
  templateScope?: NovelTaskType,
): ProviderResolution {
  const db = repos.db
  // template_run 归组依据其实际 scope
  const effectiveForGrouping = taskType === 'template_run' ? (templateScope ?? 'generate_project') : taskType
  const group = resolveTaskGroup(effectiveForGrouping)

  const binding = repos.taskModelBinding.getTaskModelBinding(db, group)
  if (binding) {
    const config = repos.modelConfig.getModelConfig(db, binding.modelConfigId)
    if (config) {
      return { provider: providerFromModelConfig(config), config, fromBinding: true }
    }
  }

  // 回退默认模型
  const config = repos.modelConfig.getDefaultModelConfig(db)
  return { provider: config ? providerFromModelConfig(config) : undefined, config, fromBinding: false }
}
