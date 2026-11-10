import { describe, expect, it } from "vitest";
import { validTimelineRenderSubtitlePlan } from "./index.js";
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
});
