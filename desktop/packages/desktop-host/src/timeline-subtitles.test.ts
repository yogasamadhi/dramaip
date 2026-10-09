import { describe, expect, it } from "vitest";
import {
  createDesktopHost,
  type DesktopHostActions,
  type HostTimelineRenderInput,
  validTimelineRenderSubtitlePlan,
} from "./index.js";
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
describe("versioned Host subtitle policy", () => {
  it("retains exact Unicode, original font identity and half-open adjacency without normalization", () => {
    const value = plan(),
      before = JSON.stringify(value);
    expect(validTimelineRenderSubtitlePlan(value, 25)).toBe(true);
    value.cues.push({
      ...value.cues[0]!,
      clipId: crypto.randomUUID(),
      startFrame: 7,
    });
    expect(validTimelineRenderSubtitlePlan(value, 25)).toBe(true);
    value.cues[1]!.startFrame = 6;
    expect(validTimelineRenderSubtitlePlan(value, 25)).toBe(false);
    expect(before).toContain("字幕 %{n}");
  });
  it("omit is exact and does not allow cues, a font or an unknown burn policy", () => {
    const omit = {
      format: "dramaip-render-subtitles",
      version: 1,
      mode: "omit",
    };
    expect(validTimelineRenderSubtitlePlan(omit, 25)).toBe(true);
    for (const patch of [
      { font: plan().font },
      { cues: [] },
      { mode: "sidecar" },
      { version: 2 },
      { path: "/private" },
    ])
      expect(validTimelineRenderSubtitlePlan({ ...omit, ...patch }, 25)).toBe(
        false,
      );
  });
  it("coercion, extra paths, unsafe text, malformed fonts and bounded inventory reject the whole input", () => {
    const value = plan();
    for (const patch of [
      { startFrame: "2" },
      { startFrame: -1 },
      { startFrame: 24 },
      { durationFrames: 0 },
      { durationFrames: 1.5 },
      { text: "" },
      { text: "A\tB" },
      { text: "A\ud800" },
      { text: "A".repeat(16385) },
      { fontfile: "/private" },
    ])
      expect(
        validTimelineRenderSubtitlePlan(
          { ...value, cues: [{ ...value.cues[0], ...patch }] },
          25,
        ),
      ).toBe(false);
    for (const patch of [
      { id: "../font" },
      { packVersion: "latest" },
      { sha256: "0" },
      { path: "/private/font.ttf" },
    ])
      expect(
        validTimelineRenderSubtitlePlan(
          { ...value, font: { ...value.font, ...patch } },
          25,
        ),
      ).toBe(false);
    expect(
      validTimelineRenderSubtitlePlan(
        { ...value, cues: [value.cues[0], value.cues[0]] },
        25,
      ),
    ).toBe(false);
    expect(
      validTimelineRenderSubtitlePlan(
        { ...value, cues: Array(257).fill(value.cues[0]) },
        25,
      ),
    ).toBe(false);
    expect(validTimelineRenderSubtitlePlan(value, 1_000_001)).toBe(false);
  });
  it("private HTTP preserves old absence and explicit modes; rejects unknown fields before dispatch", async () => {
    const accepted: HostTimelineRenderInput[] = [],
      body = input(),
      subtitlePlan = plan();
    const host = createDesktopHost({
      accessToken: "subtitle-test",
      capabilities: [{ id: "renderer.ffmpeg-subtitles-v1", available: false }],
      actions: {
        startTimelineRender: async (v: HostTimelineRenderInput) => {
          accepted.push(structuredClone(v));
          return { jobId: v.jobId, status: "queued" };
        },
      } as unknown as DesktopHostActions,
    });
    const server = await host.start({ hostname: "127.0.0.1", port: 0 });
    try {
      const request = (v: unknown, authenticated = true) =>
        fetch(
          `http://${server.hostname}:${server.port}/host/v1/timeline-renders`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(authenticated
                ? { Authorization: "Bearer subtitle-test" }
                : {}),
            },
            body: JSON.stringify(v),
          },
        );
      expect((await request({ ...body, subtitlePlan }, false)).status).toBe(
        401,
      );
      expect(accepted).toHaveLength(0);
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
    } finally {
      server.close();
    }
  });
});
