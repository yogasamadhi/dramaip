// 视频生成 Provider 工厂（ROADMAP v0.7 §1）—— 按 VideoProviderConfig.kind 路由到具体适配器
import type { VideoProvider, VideoProviderConfig } from '@sdns/core'
import { MockVideoProvider } from './mock.provider'
import { HttpVideoProvider } from './http.provider'

/**
 * 根据 Provider 配置构造 VideoProvider。
 * - mock：不调用任何真实 API，立即返回合成结果，用于无账号场景的全链路验证。
 * - jimeng/kling/hailuo/runway/pika/openai_sora/custom：走通用 HTTP 提交+轮询适配器
 *   （各平台真实字段差异需按平台文档在 http.provider 里细化或新增专用 provider）。
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
      })
  }
}
