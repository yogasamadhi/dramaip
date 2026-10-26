import { expect, test } from "vitest";
import type { StudioClient } from "@dramaip/client";
import type { TimelineRenderJob } from "@dramaip/contracts/timeline";
import { TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION } from "@dramaip/contracts/timeline";
import {
  findRenderReceipt,
  freezeRenderRequest,
  parseRenderRequest,
  readRenderHistory,
  renderRequestFingerprint,
} from "./timeline-render-recovery";
const id = "10000000-0000-4000-8000-000000000001";
const episodeId = "10000000-0000-4000-8000-000000000002";
const timelineId = "10000000-0000-4000-8000-000000000003";
const preflight = {
  timelineId,
  timelineVersion: 2,
  timelineEtag: `"timeline:${timelineId}:2"`,
  profileVersion: "p0",
  rendererVersion: "signed-local",
  sidecarArtifactVersion: "signed-local",
  sourceFingerprint: "a".repeat(64),
  ready: true,
  blockers: [],
  warnings: [],
};
const pending = freezeRenderRequest(id, episodeId, preflight);
const job: TimelineRenderJob = {
  jobId: crypto.randomUUID(),
  timelineId,
  timelineVersion: 2,
  timelineProfileVersion: "p0",
  rendererVersion: "signed-local",
  sidecarArtifactVersion: "signed-local",
  sourceFingerprint: "a".repeat(64),
  status: "interrupted",
  progress: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const catalog = {
  projectId: id,
  episodeId,
  timeline: { id: timelineId, version: 2, etag: preflight.timelineEtag },
  items: [job],
};
test("subtitle recovery persists only original explicit font policy and rejects strategy/version changes without replacing keys", async () => {
  const subtitlePolicy = {
    version: 1 as const,
    mode: "burn-in" as const,
    font: { id, packVersion: "1.0.0", sha256: "b".repeat(64) },
  };
  const native = {
    ...preflight,
    profileVersion: TIMELINE_RENDER_SUBTITLE_PROFILE_VERSION,
    subtitlePolicy,
  };
  const frozen = freezeRenderRequest(id, episodeId, native),
    raw = JSON.stringify(frozen);
  expect(parseRenderRequest(raw, id, episodeId)).toEqual(frozen);
  expect(raw).not.toContain("text");
  expect(raw).not.toContain("license");
  expect(raw).not.toContain("consent");
  const original = {
    ...job,
    timelineProfileVersion: native.profileVersion,
    subtitlePolicy,
  };
  expect(freezeRenderRequest(id, episodeId, native, original).retryJobId).toBe(
    job.jobId,
  );
  for (const altered of [
    { ...original, subtitlePolicy: undefined },
    {
      ...original,
      subtitlePolicy: { version: 1 as const, mode: "omit" as const },
    },
    {
      ...original,
      subtitlePolicy: {
        ...subtitlePolicy,
        font: { ...subtitlePolicy.font, sha256: "c".repeat(64) },
      },
    },
    { ...original, rendererVersion: "other" },
  ])
    expect(() => freezeRenderRequest(id, episodeId, native, altered)).toThrow();
  const hash = await renderRequestFingerprint(frozen.key);
  const receipt = { ...original, requestFingerprint: hash };
  const sdk = (value: TimelineRenderJob) =>
    ({
      list: async () => ({ ...catalog, items: [value] }),
    }) as unknown as StudioClient["timelineRenders"];
  expect((await findRenderReceipt(sdk(receipt), frozen))?.jobId).toBe(
    job.jobId,
  );
  await expect(
    findRenderReceipt(sdk({ ...receipt, subtitlePolicy: undefined }), frozen),
  ).rejects.toThrow();
  expect(() =>
    parseRenderRequest(
      JSON.stringify({
        ...frozen,
        input: { ...frozen.input, subtitlePolicy: undefined },
      }),
      id,
      episodeId,
    ),
  ).toThrow();
});
test("render recovery persists only exact IDs/fingerprint/input/key, rejects unknown fields and wrong project instead of replacing originals", () => {
  const raw = JSON.stringify(pending);
  expect(parseRenderRequest(raw, id, episodeId)).toEqual(pending);
  expect(raw).not.toContain("mediaRef");
  expect(raw).not.toContain("confirmed");
  expect(() => parseRenderRequest(raw, timelineId, episodeId)).toThrow();
  expect(() =>
    parseRenderRequest(
      JSON.stringify({ ...pending, path: "/private" }),
      id,
      episodeId,
    ),
  ).toThrow();
  expect(() =>
    parseRenderRequest(
      JSON.stringify({ ...pending, consent: true }),
      id,
      episodeId,
    ),
  ).toThrow();
  expect(() => parseRenderRequest("invalid", id, episodeId)).toThrow();
});
test("explicit retry refuses changed/legacy input; preflight cannot auto-generate a replacement", () => {
  expect(freezeRenderRequest(id, episodeId, preflight, job).retryJobId).toBe(
    job.jobId,
  );
  for (const altered of [
    { ...job, sourceFingerprint: undefined },
    { ...job, sourceFingerprint: "b".repeat(64) },
    { ...job, timelineVersion: 1 },
    { ...job, status: "succeeded" as const },
  ])
    expect(() =>
      freezeRenderRequest(id, episodeId, preflight, altered),
    ).toThrow();
  expect(() =>
    freezeRenderRequest(id, episodeId, { ...preflight, ready: false }),
  ).toThrow();
});
test("unknown result recovery reads only original request hash; absence/changed proof do not resend or select latest", async () => {
  const fingerprint = await renderRequestFingerprint(pending.key);
  let calls = 0;
  const sdk = {
    list: async (
      project: string,
      episode: string,
      options: { requestFingerprint: string },
    ) => {
      calls++;
      expect(project).toBe(id);
      expect(episode).toBe(episodeId);
      expect(options.requestFingerprint).toBe(fingerprint);
      return {
        ...catalog,
        items: [{ ...job, requestFingerprint: fingerprint }],
      };
    },
  } as unknown as StudioClient["timelineRenders"];
  expect((await findRenderReceipt(sdk, pending))?.jobId).toBe(job.jobId);
  expect(calls).toBe(1);
  const missing = {
    list: async () => ({ ...catalog, items: [] }),
  } as unknown as StudioClient["timelineRenders"];
  expect(await findRenderReceipt(missing, pending)).toBeUndefined();
  const wrong = {
    list: async () => ({
      ...catalog,
      items: [
        {
          ...job,
          requestFingerprint: fingerprint,
          sourceFingerprint: "b".repeat(64),
        },
      ],
    }),
  } as unknown as StudioClient["timelineRenders"];
  await expect(findRenderReceipt(wrong, pending)).rejects.toThrow();
});
test("render history reads all pages, refuses incomplete/cycling/duplicate or version drift, preserves abort", async () => {
  let calls = 0;
  const sdk = {
    list: async () =>
      ++calls === 1
        ? { ...catalog, nextCursor: "actual" }
        : { ...catalog, items: [{ ...job, jobId: crypto.randomUUID() }] },
  } as unknown as StudioClient["timelineRenders"];
  expect((await readRenderHistory(sdk, id, episodeId)).items).toHaveLength(2);
  expect(calls).toBe(2);
  for (const page of [
    { ...catalog, nextCursor: "loop" },
    { ...catalog, items: [job] },
    { ...catalog, items: [], timeline: { ...catalog.timeline, version: 3 } },
  ]) {
    let count = 0;
    await expect(
      readRenderHistory(
        {
          list: async () =>
            ++count === 1 ? { ...catalog, nextCursor: "loop" } : page,
        } as unknown as StudioClient["timelineRenders"],
        id,
        episodeId,
      ),
    ).rejects.toThrow();
  }
});
