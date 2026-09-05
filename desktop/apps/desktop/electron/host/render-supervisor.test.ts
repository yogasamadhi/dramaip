import { describe, expect, test } from "bun:test";
import type { HostTimelineRenderInput } from "@dramaip/desktop-host";
import { buildRenderArguments } from "./render-supervisor";

const input: HostTimelineRenderInput = {
  jobId: "00000000-0000-4000-8000-000000000001",
  timelineId: "00000000-0000-4000-8000-000000000002",
  durationFrames: 100,
  profile: {
    width: 1080,
    height: 1920,
    frameRate: { numerator: 25, denominator: 1, dropFrame: false },
    audioSampleRate: 48_000,
    channels: 2,
  },
  clips: [
    {
      mediaRef: "00000000-0000-4000-8000-000000000003",
      startFrame: 25,
      durationFrames: 50,
      sourceOffsetFrame: 5,
    },
  ],
};

describe("signed FFmpeg render argument builder", () => {
  test("uses argv-only local inputs, black gaps, x264 and AAC", () => {
    const args = buildRenderArguments(
      input,
      "/private/render/output.mp4",
      (mediaRef) => `/private/media/${mediaRef}.mp4`,
    );
    expect(args[0]).toBe("-nostdin");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args).toContain("+faststart");
    expect(args).toContain("anullsrc=channel_layout=stereo:sample_rate=48000");
    expect(args).toContain("color=c=black:s=1080x1920:r=25");
    expect(args.at(-1)).toBe("/private/render/output.mp4");
    expect(args.join(" ")).not.toContain("http://");
    expect(args.join(" ")).not.toContain("https://");
  });

  test("rejects overlapping video clips before starting a process", () => {
    expect(() =>
      buildRenderArguments(
        {
          ...input,
          clips: [
            input.clips[0]!,
            {
              ...input.clips[0]!,
              mediaRef: "00000000-0000-4000-8000-000000000004",
              startFrame: 50,
            },
          ],
        },
        "/private/render/output.mp4",
        (mediaRef) => `/private/media/${mediaRef}.mp4`,
      ),
    ).toThrow("Overlapping");
  });
});
