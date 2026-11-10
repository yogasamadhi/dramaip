import {
  DRAMAIP_RUNTIME_VERSION,
  defineCapabilityDescriptor,
  type CapabilityDescriptor,
} from "@dramaip/contracts";

/** The capability states RuntimeInfo reports, by Desktop Host availability. */
export function runtimeCapabilityDescriptors(
  hostAvailable: boolean,
): Readonly<Record<string, CapabilityDescriptor>> {
  const hostState = hostAvailable ? "experimental" : "unavailable";
  return Object.freeze({
    "desktop.host": defineCapabilityDescriptor({
      id: "desktop.host",
      state: hostState,
      version: DRAMAIP_RUNTIME_VERSION,
      limitations: hostAvailable
        ? ["Host 能力需分别通过产品验收后才能标记 verified。"]
        : ["Headless/Server 模式不提供 Desktop Host。"],
    }),
    "host.files": defineCapabilityDescriptor({
      id: "host.files",
      state: hostState,
      version: DRAMAIP_RUNTIME_VERSION,
      requiredHostCapabilities: ["files"],
    }),
    "host.credentials": defineCapabilityDescriptor({
      id: "host.credentials",
      state: hostState,
      version: "2",
      limitations: hostAvailable
        ? ["保险库后端状态由 Desktop Host 单独报告。"]
        : ["Headless 模式没有明文凭据回退。"],
      requiredHostCapabilities: ["credentials"],
    }),
    "engines.local": defineCapabilityDescriptor({
      id: "engines.local",
      state: hostState,
      version: DRAMAIP_RUNTIME_VERSION,
      requiredHostCapabilities: ["engines"],
    }),
    "media.video-generation.seedance": defineCapabilityDescriptor({
      id: "media.video-generation.seedance",
      state: hostAvailable ? "experimental" : "unavailable",
      version: "ark-2024-01-01",
      limitations: [
        "使用火山方舟异步内容生成任务协议；仍需真实账号连续 smoke 与本地归档证据。",
        "未从模型能力响应确认的取消和原生音频能力不会被声明。",
      ],
      requiredHostCapabilities: ["provider-http", "media-library"],
      requiredProviderCapabilities: ["contents-generations-tasks"],
    }),
    "media.video-generation.minimax-h3-cloud": defineCapabilityDescriptor({
      id: "media.video-generation.minimax-h3-cloud",
      state: hostAvailable ? "experimental" : "unavailable",
      version: "v2",
      limitations: [
        "使用 MiniMax H3 v2 异步任务协议；远端成功不等于本地归档成功。",
        "运行中任务不能通过 queued-only 取消端点伪装取消。",
      ],
      requiredHostCapabilities: ["provider-http", "media-library"],
      requiredProviderCapabilities: ["video-generation-v2"],
    }),
    "media.archive": defineCapabilityDescriptor({
      id: "media.archive",
      state: "unavailable",
      version: "1",
      limitations: [
        "签名 ffprobe 能力和原子媒体归档尚未完成产品验收；远端 URL 不会写入 Runtime DB。",
      ],
      requiredHostCapabilities: ["media-library", "renderer.ffprobe"],
    }),
    "timeline.render": defineCapabilityDescriptor({
      id: "timeline.render",
      state: "unavailable",
      version: "1",
      limitations: ["签名 FFmpeg+x264 sidecar 尚未安装并通过发行验收。"],
      requiredHostCapabilities: ["renderer.ffmpeg-x264"],
    }),
    "production.screenplay-interchange": defineCapabilityDescriptor({
      id: "production.screenplay-interchange",
      state: hostAvailable ? "experimental" : "unavailable",
      version: "1",
      limitations: hostAvailable
        ? [
            "Fountain 与 FDX 已具备安全 Preview→Commit 和结构损失报告；仍需 Electron 产品验收后才能标记 verified。",
            "PDF 仅文本层解析尚未实现，扫描 PDF/OCR 明确不可用。",
          ]
        : ["Headless/Server 模式没有本地文件 grant，不能导入剧本文件。"],
      requiredHostCapabilities: ["files"],
    }),
  });
}
