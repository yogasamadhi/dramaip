import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
  type TimelineRenderPreflight,
  type TimelineRenderJob,
} from "@dramaip/contracts/timeline";
import {
  selectedRenderSubtitlePolicy,
  explicitRenderReady,
  exactRenderRetryReady,
} from "./timeline-render-subtitle-selection";
import {
  TimelineRenderSubtitleControls,
  TimelineRenderSubtitlePolicyView,
} from "./features/media/TimelineRenderSubtitleControls";
const id = "10000000-0000-4000-8000-000000000001";
const font = { id, packVersion: "1.0.0", sha256: "b".repeat(64) };
const metadata = {
  ...font,
  label: "原字体",
  sizeBytes: 100,
  license: "signed declaration only",
  sourceUrl: "https://example.invalid/font",
};
const policy = selectedRenderSubtitlePolicy("burn-in", font)!;
const preflight: TimelineRenderPreflight = {
  timelineId: id,
  timelineVersion: 3,
  timelineEtag: `"timeline:${id}:3"`,
  profileVersion: TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
  ready: true,
  blockers: [],
  warnings: [],
  rendererVersion: "original-v1",
  sidecarArtifactVersion: "original-v1",
  sourceFingerprint: "a".repeat(64),
  subtitlePolicy: policy,
  subtitleBurnInAvailable: true,
  subtitleFonts: [metadata],
};
const job: TimelineRenderJob = {
  jobId: id,
  timelineId: id,
  timelineVersion: 3,
  timelineProfileVersion: preflight.profileVersion,
  rendererVersion: "original-v1",
  sidecarArtifactVersion: "original-v1",
  sourceFingerprint: preflight.sourceFingerprint,
  subtitlePolicy: policy,
  status: "failed",
  progress: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
test("render subtitle UI unchosen is not omit; font tuple is original, complete and cloned without latest/default substitution", () => {
  expect(selectedRenderSubtitlePolicy()).toBeUndefined();
  expect(explicitRenderReady(preflight)).toBe(false);
  expect(selectedRenderSubtitlePolicy("omit")).toEqual({
    version: 1,
    mode: "omit",
  });
  expect(() => selectedRenderSubtitlePolicy("burn-in")).toThrow();
  const copy = { ...font },
    selected = selectedRenderSubtitlePolicy("burn-in", copy);
  copy.sha256 = "c".repeat(64);
  expect(selected).toEqual(policy);
});
test("render subtitle UI readiness requires explicit original policy, profile, complete proof and exact available font; omit independent of font capability", () => {
  expect(explicitRenderReady(preflight, "burn-in", font)).toBe(true);
  for (const patch of [
    { ready: false },
    { sourceFingerprint: undefined },
    { rendererVersion: undefined },
    { sidecarArtifactVersion: undefined },
    { profileVersion: "legacy" },
    { subtitlePolicy: undefined },
    { subtitleBurnInAvailable: false },
    { subtitleFonts: [] },
    { subtitleFonts: [{ ...metadata, sha256: "c".repeat(64) }] },
  ])
    expect(
      explicitRenderReady({ ...preflight, ...patch }, "burn-in", font),
    ).toBe(false);
  expect(explicitRenderReady(preflight, "omit")).toBe(false);
  expect(
    explicitRenderReady(
      {
        ...preflight,
        subtitlePolicy: { version: 1, mode: "omit" },
        subtitleFonts: [],
        subtitleBurnInAvailable: false,
      },
      "omit",
    ),
  ).toBe(true);
});
test("render subtitle UI retry rejects any changed source/policy/font/tool/version and non-retryable status rather than selecting latest", () => {
  expect(exactRenderRetryReady(job, preflight, "burn-in", font)).toBe(true);
  for (const patch of [
    { sourceFingerprint: undefined },
    { sourceFingerprint: "c".repeat(64) },
    { timelineVersion: 4 },
    { timelineId: crypto.randomUUID() },
    { timelineProfileVersion: "legacy" },
    { rendererVersion: "new-v2" },
    { sidecarArtifactVersion: "new-v2" },
    { subtitlePolicy: undefined },
    { subtitlePolicy: { version: 1 as const, mode: "omit" as const } },
    { status: "succeeded" as const },
  ])
    expect(
      exactRenderRetryReady({ ...job, ...patch }, preflight, "burn-in", font),
    ).toBe(false);
});
test("render subtitle controls do not auto-select first font, disclose declaration limits, and display unavailable original tuple without replacing it", () => {
  const html = renderToStaticMarkup(
    <TimelineRenderSubtitleControls
      mode="burn-in"
      fonts={[metadata]}
      available
      disabled={false}
      onMode={() => {}}
      onFont={() => {}}
    />,
  );
  expect(html).toContain("请选择原字体，不自动选第一项");
  expect(html).not.toContain("签名许可声明（不是授权核验）");
  const original = renderToStaticMarkup(
    <TimelineRenderSubtitleControls
      mode="burn-in"
      font={font}
      fonts={[{ ...metadata, packVersion: "2.0.0" }]}
      available
      disabled={false}
      onMode={() => {}}
      onFont={() => {}}
    />,
  );
  expect(original).toContain("原字体当前不可用");
  expect(original).toContain(font.sha256);
  const selected = renderToStaticMarkup(
    <TimelineRenderSubtitleControls
      mode="burn-in"
      font={font}
      fonts={[metadata]}
      available
      disabled={false}
      onMode={() => {}}
      onFont={() => {}}
    />,
  );
  expect(selected).toContain("不是授权核验");
  expect(selected).not.toContain("<a ");
});
test("render subtitle original request/job policy display distinguishes historical absence, explicit omit and exact burn font without claiming quality or rights", () => {
  expect(renderToStaticMarkup(<TimelineRenderSubtitlePolicyView />)).toContain(
    "历史未记录",
  );
  expect(
    renderToStaticMarkup(
      <TimelineRenderSubtitlePolicyView
        policy={{ version: 1, mode: "omit" }}
      />,
    ),
  ).toContain("明确不烧录字幕");
  const html = renderToStaticMarkup(
    <TimelineRenderSubtitlePolicyView policy={policy} />,
  );
  expect(html).toContain("烧录完整原字幕");
  expect(html).toContain(font.sha256);
  expect(html).toContain(font.packVersion);
});
