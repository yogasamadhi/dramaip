import { describe, expect, it } from "vitest";
import type { ConfiguredProvider } from "@dramaip/contracts";
import {
  videoProviderAdapter,
  videoProviderInputIssues,
} from "./video-provider-adapters.js";

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
  it("rejects unsupported declared durations and resolutions before making a request draft, never silently replacing a resolution", () => {
    const minimax = videoProviderAdapter(
      provider({ model: "MiniMax-H3", protocol: "minimax-h3-cloud" }),
    )!;
    const input = {
      providerId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      prompt: "受控参数",
    };
    for (const seconds of [1, 3, 16, 60]) {
      expect(
        videoProviderInputIssues(minimax.capabilities, { ...input, seconds }),
      ).toEqual([expect.stringContaining("声明能力")]);
      expect(() =>
        minimax.create(provider({ model: "MiniMax-H3" }), {
          ...input,
          seconds,
        }),
      ).toThrow("声明能力");
    }
    for (const seconds of [4, 5, 15])
      expect(
        videoProviderInputIssues(minimax.capabilities, { ...input, seconds }),
      ).toEqual([]);
    for (const size of ["", "4K", "720x1280", " 2K "]) {
      expect(
        videoProviderInputIssues(minimax.capabilities, { ...input, size }),
      ).toEqual([expect.stringContaining("默认分辨率")]);
      expect(() =>
        minimax.create(provider({ model: "MiniMax-H3" }), { ...input, size }),
      ).toThrow("声明能力");
    }
    expect(
      minimax.create(provider({ model: "MiniMax-H3" }), {
        ...input,
        size: "2k",
      }).body,
    ).toMatchObject({ resolution: "2K", duration: 5 });
    expect(
      minimax.create(provider({ model: "MiniMax-H3" }), input).body,
    ).toMatchObject({ resolution: "768P", duration: 5 });
  });

  it("enforces array capability selections as well as ranges; exact declared aliases normalize case only, not a different size or duration", () => {
    const adapter = videoProviderAdapter(
      provider({ model: "seedance-controlled", protocol: "seedance" }),
    )!;
    const input = {
      providerId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      prompt: "受控参数",
      seconds: 6,
    };
    expect(() =>
      adapter.create(provider({ model: "seedance-controlled" }), {
        ...input,
        size: "4K",
      }),
    ).toThrow("声明能力");
    expect(
      adapter.create(provider({ model: "seedance-controlled" }), {
        ...input,
        size: "1080P",
      }).body,
    ).toMatchObject({ resolution: "1080p", duration: 6 });
    const discrete = { ...adapter.capabilities, durationSeconds: [4, 8] };
    expect(videoProviderInputIssues(discrete, input)).toEqual([
      expect.stringContaining("时长"),
    ]);
    expect(
      videoProviderInputIssues(discrete, { ...input, seconds: 8 }),
    ).toEqual([]);
  });

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
