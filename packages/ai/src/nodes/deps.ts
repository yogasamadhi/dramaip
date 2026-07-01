// 节点依赖注入（节点保持为纯函数：输入 state → 输出 Partial<State>）
import type { LLMProvider } from '@sdns/core'
import type { Repositories } from '@sdns/db'

export interface NodeDeps {
  repos: Repositories
  provider?: LLMProvider
  onToken?: (token: string) => void
  signal?: AbortSignal
}
