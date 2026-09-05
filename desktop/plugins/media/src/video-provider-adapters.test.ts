import { describe, expect, it } from "vitest";
import type { ConfiguredProvider } from "@dramaip/contracts";
import { videoProviderAdapter } from "./video-provider-adapters.js";

function provider(value: Partial<ConfiguredProvider>): ConfiguredProvider {
  return {
    id: "provider-id",
    title: "provider",
    serviceType: "视频生成",
    model: "model",
    authentication: "apiKey",
    credentialRef: "credential-ref",
    ...value,
  };
}

describe("media video provider adapters", () => {
  it("maps MiniMax H3 to the official v2 asynchronous task contract", () => {
    const adapter = videoProviderAdapter(
      provider({ model: "MiniMax-H3", protocol: "minimax-h3-cloud" }),
    )!;
    const request = adapter.create(provider({ model: "MiniMax-H3" }), {
      providerId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      prompt: "竖屏追逐镜头",
      seconds: 5,
      size: "2K",
    });
    expect(request).toMatchObject({
      method: "POST",
      suffix: "/v2/video_generation",
      body: {
        model: "MiniMax-H3",
        content: [{ type: "text", text: "竖屏追逐镜头" }],
        resolution: "2K",
        duration: 5,
        ratio: "9:16",
      },
    });
    expect(
      adapter.parsePoll({
        task: {
          id: "task-1",
          model: "MiniMax-H3",
          status: "succeeded",
          content: { url: "https://cdn.example/output.mp4" },
        },
      }),
    ).toEqual({
      remoteJobId: "task-1",
      status: "succeeded",
      outputUrl: "https://cdn.example/output.mp4",
      modelRevision: "MiniMax-H3",
    });
    expect(adapter.cancel("task-1")).toEqual({
      method: "DELETE",
      suffix: "/v2/video_generation/task-1",
    });
  });

  it("maps Seedance to Ark content-generation tasks and does not fake cancel", () => {
    const adapter = videoProviderAdapter(
      provider({
        model: "doubao-seedance-1-5-pro",
        protocol: "volcengine-ark-contents-generation",
      }),
    )!;
    expect(
      adapter.create(provider({ model: "doubao-seedance-1-5-pro" }), {
        providerId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        prompt: "雨夜冲突",
        seconds: 6,
        size: "1080p",
      }),
    ).toMatchObject({
      method: "POST",
      suffix: "/contents/generations/tasks",
      body: {
        model: "doubao-seedance-1-5-pro",
        content: [{ type: "text", text: "雨夜冲突" }],
        duration: 6,
        ratio: "9:16",
        resolution: "1080p",
      },
    });
    expect(adapter.cancel("task-1")).toBeUndefined();
    expect(
      adapter.parsePoll({
        id: "task-1",
        status: "succeeded",
        content: { video_url: "https://cdn.example/seedance.mp4" },
      }),
    ).toMatchObject({
      remoteJobId: "task-1",
      status: "succeeded",
      outputUrl: "https://cdn.example/seedance.mp4",
    });
  });

  it("does not silently route an unknown provider through a generic endpoint", () => {
    expect(
      videoProviderAdapter(
        provider({ model: "unknown-video", protocol: "OpenAI compatible" }),
      ),
    ).toBeUndefined();
  });
});
