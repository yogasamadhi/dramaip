// 视频生成 Provider 工厂（ROADMAP v0.7 §1）—— 按 VideoProviderConfig.kind 路由到具体适配器
import type { VideoProvider, VideoProviderConfig } from '@sdns/core'
import { MockVideoProvider } from './mock.provider'
import { HttpVideoProvider } from './http.provider'
import { adapterForVideoProviderKind } from './adapters'

/**
 * 根据 Provider 配置构造 VideoProvider。
 * - mock：不调用任何真实 API，立即返回合成结果，用于无账号场景的全链路验证。
 * - custom：走 OpenAI-compatible 风格的 HTTP adapter。
 * - hailuo/openai_sora：使用各自已验证的官方 API 映射。
 * - jimeng/kling/runway/pika：保留独立 adapter 槽位，未启用时绝不误走 Custom 端点。
 */
export function videoProviderFromConfig(config: VideoProviderConfig): VideoProvider {
  switch (config.kind) {
    case 'mock':
      return new MockVideoProvider(config.name)
    case 'jimeng':
    case 'kling':
    case 'hailuo':
    case 'runway':
    case 'pika':
    case 'openai_sora':
    case 'custom':
    default:
      return new HttpVideoProvider({
        name: config.name,
        kind: config.kind,
        baseUrl: config.baseUrl ?? '',
        apiKey: config.apiKey,
        model: config.model,
        defaultParams: config.defaultParams,
        adapter: adapterForVideoProviderKind(config.kind),
      })
  }
}
