// MockVideoProvider —— 视频生成 Provider 的模拟实现（ROADMAP v0.7 §1）
//
// 用途：在没有真实视频平台账号/密钥时，让「提交任务 → 轮询状态 → 保存结果」全链路可用。
// 它不调用任何真实 API，createTask 立即返回 success 并给出一个合成的结果 URL。
// 真实平台（即梦/可灵/Runway 等）可按相同 VideoProvider 接口实现并接入工厂。
import type {
  VideoGenerationInput,
  VideoProvider,
  VideoProviderResult,
  VideoProviderTaskState,
} from '@sdns/core'

export class MockVideoProvider implements VideoProvider {
  readonly kind = 'mock'
  readonly name: string

  constructor(name = 'Mock') {
    this.name = name
  }

  async createTask(input: VideoGenerationInput): Promise<VideoProviderTaskState> {
    const id = `mock-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    // 模拟一个生成结果（合成 URL，便于测试「对比/择优」全链路）
    const results: VideoProviderResult[] = [this.syntheticResult(id, input)]
    return { status: 'success', remoteTaskId: id, results }
  }

  async getTaskStatus(remoteTaskId: string): Promise<VideoProviderTaskState> {
    // Mock 模式下任务一旦提交即成功，轮询恒为 success
    const results: VideoProviderResult[] = [this.syntheticResult(remoteTaskId)]
    return { status: 'success', remoteTaskId, results }
  }

  private syntheticResult(id: string, input?: VideoGenerationInput): VideoProviderResult {
    const slug = input?.prompt ? encodeURIComponent(input.prompt.slice(0, 24)) : 'shot'
    return {
      resultVideoUrl: `https://mock-videos.local/${id}/${slug}.mp4`,
      coverImageUrl: `https://mock-videos.local/${id}/${slug}.jpg`,
      rawMeta: JSON.stringify({ provider: 'mock', model: input?.model ?? 'mock-v1', generatedAt: new Date().toISOString() }),
    }
  }
}
