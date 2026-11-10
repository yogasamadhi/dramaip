import { describe, expect, it, vi } from "vitest";
import type {
  AgentProviderActivationInput,
  HostTimelineRenderInput,
} from "@dramaip/host-contracts";
import type { Engines } from "@dramaip/seams-engines";
import type { HostCredentials } from "./credentials.ts";
import type { HostFiles } from "./files.ts";
import type { HostMedia } from "./media.ts";
import { DesktopHostService, HostRequestError } from "./service.ts";
import type { ShellBridge } from "@dramaip/host-shell-bridge";

const plan = () => ({
  format: "dramaip-render-subtitles" as const,
  version: 1 as const,
  mode: "burn-in" as const,
  font: {
    id: crypto.randomUUID(),
    packVersion: "0.0.0-controlled-local",
    sha256: "a".repeat(64),
  },
  cues: [
    {
      clipId: crypto.randomUUID(),
      startFrame: 2,
      durationFrames: 5,
      text: "字幕 %{n}\n{\\an8}",
    },
  ],
});
const input = (): HostTimelineRenderInput => ({
  jobId: crypto.randomUUID(),
  timelineId: crypto.randomUUID(),
  durationFrames: 25,
  profile: {
    width: 1080,
    height: 1920,
    frameRate: { numerator: 25, denominator: 1, dropFrame: false },
    audioSampleRate: 48000,
    channels: 2,
  },
  clips: [
    {
      mediaRef: crypto.randomUUID(),
      sha256: "b".repeat(64),
      sizeBytes: 10,
      mimeType: "video/mp4",
      startFrame: 0,
      durationFrames: 25,
      sourceOffsetFrame: 0,
    },
  ],
  audioPlan: {
    format: "dramaip-render-audio",
    version: 1,
    policy: "saved-gains-reject-over-unity",
    videoEmbeddedAudio: "mix-if-present",
    clips: [],
  },
});

it("binds native Pi activation to the authorized origin and preserves its provider identity", async () => {
  const resolve = vi.fn(async () => "test-secret");
  const configure = vi.fn(async () => ({ pi: { available: true } }));
  const host = new DesktopHostService({
    shell: {} as ShellBridge,
    files: {} as HostFiles,
    media: {} as HostMedia,
    credentials: { resolve } as unknown as HostCredentials,
    engines: () => ({ configure }) as unknown as Engines,
  });
  const configuration: AgentProviderActivationInput = {
    providerId: "saved-minimax",
    runtimeProviderId: "dramaip-agent",
    piProviderId: "minimax",
    providerKind: "openai",
    providerAdapter: "openai-compatible",
    model: "MiniMax-M2.7",
    authentication: "apiKey",
    credentialRef: "opaque-key-ref",
    environmentName: "OPENAI_API_KEY",
    baseUrl: "https://api.minimax.io/anthropic",
  };
  await expect(host.activateAgentProvider(configuration)).resolves.toEqual({
    available: true,
  });
  expect(resolve).toHaveBeenCalledWith("opaque-key-ref", {
    purpose: "provider-authentication",
    origin: "https://api.minimax.io/anthropic",
  });
  expect(configure).toHaveBeenCalledWith(
    expect.objectContaining({
      piProviderId: "minimax",
      model: "MiniMax-M2.7",
      baseUrl: "https://api.minimax.io/anthropic",
      secret: "test-secret",
    }),
  );
  const withoutEndpoint = { ...configuration };
  delete withoutEndpoint.baseUrl;
  await expect(
    host.activateAgentProvider(withoutEndpoint),
  ).rejects.toMatchObject({
    status: 400,
  });
  expect(configure).toHaveBeenCalledTimes(1);
});
describe("DesktopHostService timeline render input", () => {
  it("preserves old absence and explicit modes; rejects unknown fields before dispatch", async () => {
    const accepted: HostTimelineRenderInput[] = [],
      body = input(),
      subtitlePlan = plan();
    const host = new DesktopHostService({
      shell: {} as ShellBridge,
      files: {} as HostFiles,
      credentials: {} as HostCredentials,
      media: {
        rendering: true,
        capabilities: () => [],
        startTimelineRender: async (v: HostTimelineRenderInput) => {
          accepted.push(structuredClone(v));
          return { jobId: v.jobId, status: "queued" };
        },
      } as unknown as HostMedia,
      engines: () => undefined,
    });
    const request = (v: unknown) =>
      host.startTimelineRender(v as HostTimelineRenderInput).then(
        () => ({ status: 202 }),
        (error: unknown) => ({
          status: error instanceof HostRequestError ? error.status : 500,
        }),
      );
    {
      expect((await request(body)).status).toBe(202);
      expect(
        (
          await request({
            ...body,
            subtitlePlan: {
              format: "dramaip-render-subtitles",
              version: 1,
              mode: "omit",
            },
          })
        ).status,
      ).toBe(202);
      expect((await request({ ...body, subtitlePlan })).status).toBe(202);
      expect(accepted[0]).not.toHaveProperty("subtitlePlan");
      expect(accepted[2]!.subtitlePlan).toEqual(subtitlePlan);
      for (const bad of [
        null,
        {},
        { ...subtitlePlan, path: "/private" },
        {
          ...subtitlePlan,
          cues: [{ ...subtitlePlan.cues[0], startFrame: "2" }],
        },
      ])
        expect((await request({ ...body, subtitlePlan: bad })).status).toBe(
          400,
        );
      const { audioPlan: _audio, ...legacy } = body;
      expect((await request({ ...legacy, subtitlePlan })).status).toBe(400);
      expect(accepted).toHaveLength(3);
    }
  });
});
