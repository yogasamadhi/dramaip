import { test, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStudioClient } from "@dramaip/client";
import {
  MediaReviewPreviewSchema,
  MediaReviewReceiptSchema,
  MediaReviewEvidenceSchema,
  MediaReviewExportSchema,
  MediaReviewOwnerEvidenceSchema,
  type MediaReviewEvidence,
} from "@dramaip/contracts/review";
import {
  MediaDeliveryEvidenceSchema,
  mediaDeclarationStatus,
} from "@dramaip/contracts/media";
import {
  MediaReviewPendingSchema,
  MediaReviewOwnerEvidenceView,
} from "./media-review-panel";
const uuid = () => crypto.randomUUID(),
  sha = "a".repeat(64),
  date = "2026-10-07T03:00:00.000Z";
function original() {
  const projectId = uuid(),
    adaptationId = uuid(),
    episodeId = uuid(),
    id = uuid();
  const timeline = {
    format: "dramaip-timeline",
    schemaVersion: 2,
    id: uuid(),
    projectId,
    adaptationId,
    episodeId,
    sourceFingerprint: "original-owner",
    profile: {
      width: 1920,
      height: 1080,
      frameRate: { numerator: 25, denominator: 1, dropFrame: false },
      audioSampleRate: 48000,
      channels: 2,
    },
    timebase: "frames",
    durationFrames: 50,
    migrationWarnings: [],
    tracks: [],
    version: 0,
    createdAt: date,
    updatedAt: date,
  };
  const p = MediaReviewPreviewSchema.parse({
    projectId,
    adaptationId,
    episodeId,
    scope: "original-nle-metadata-review",
    releaseReady: false,
    sourceFingerprint: sha,
    shotIds: [],
    snapshot: {
      episode: { id: episodeId, version: 0, fingerprint: sha },
      adaptation: { id: adaptationId, version: 0, fingerprint: sha },
      nodes: [],
      media: [],
      delivery: {
        format: "dramaip-timeline-delivery",
        schemaVersion: 3,
        timeline,
        media: [],
        sourceBlockers: [],
        sourceFingerprint: sha,
        unsupportedFeatures: [],
        warnings: [],
      },
    },
  });
  const receipt = MediaReviewReceiptSchema.parse({
    requestKey: uuid(),
    episodeId,
    projectId,
    requestHash: sha,
    input: { projectId, sourceFingerprint: sha },
    original: p,
    createdAt: date,
    package: {
      id,
      projectId,
      adaptationId,
      episodeId,
      kind: "offline",
      status: "exported",
      title: "原整包",
      createdAt: date,
      updatedAt: date,
      manifest: {
        format: "dramaip-editor-timeline",
        version: 1,
        projectId,
        adaptationId,
        episodeId,
        title: "原预览",
        frameRate: 25,
        width: 1920,
        height: 1080,
        clips: [],
        createdAt: date,
      },
    },
  });
  return receipt;
}
function boundOwnerEvidence() {
  const r = original(),
    id = uuid();
  r.original.snapshot.media.push({ id, version: 0, fingerprint: sha });
  r.original.snapshot.delivery.media.push({
    assetId: id,
    title: "原素材",
    clipIds: [],
    expectedVersions: [0],
    sourceVersion: 0,
    sourceStatus: "current",
    relativePath: `media/${id}.mp4`,
    mediaStatus: "unattached",
    rightsStatus: "restricted",
    rightsDeclaration: "user-reported-restricted",
    lineage: [],
  });
  const evidence = MediaDeliveryEvidenceSchema.parse({
    recordId: id,
    projectId: r.projectId,
    recordVersion: 0,
    kind: "video",
    scope: "exact-media-record-metadata",
    releaseReady: false,
    qualityState: "unverified",
    settlementState: "unknown",
    currentFileIntegrity: "not-read",
    declarations: mediaDeclarationStatus({
      rightsStatus: "revoked",
      providerStatus: "unavailable",
      费用状态: "已知",
    }),
    source: {
      recordId: id,
      recordVersion: 0,
      state: "unbound",
      verification: "actual-record-version-only",
      reasons: [],
    },
    blockers: [
      "DECLARED_RIGHTS_RESTRICTED",
      "DECLARED_PROVIDER_UNAVAILABLE",
      "ARCHIVE_UNAVAILABLE",
    ],
    unknowns: [
      "CONTENT_QUALITY_UNVERIFIED",
      "LEGAL_RIGHTS_UNVERIFIED",
      "SETTLEMENT_UNKNOWN",
      "CURRENT_FILE_NOT_READ",
    ],
  });
  return MediaReviewEvidenceSchema.parse({
    packageId: r.package.id,
    projectId: r.projectId,
    episodeId: r.episodeId,
    releaseReady: false,
    kind: "source-bound",
    scope: "original-nle-metadata-review",
    original: r.original,
    sourceState: "current",
    reviewState: "approved",
    decisionFingerprint: sha,
    decisions: [],
    comments: [],
    blockers: [],
    unknowns: [
      "CONTENT_QUALITY_UNVERIFIED",
      "LEGAL_RIGHTS_UNVERIFIED",
      "SETTLEMENT_UNKNOWN",
      "CURRENT_FILES_NOT_READ",
      "RENDER_AND_FONT_NOT_REVIEWED",
    ],
    mediaOwnerEvidence: {
      scope: "original-package-media-owner-metadata",
      state: "blocked",
      releaseReady: false,
      assets: [
        {
          ...r.original.snapshot.media[0]!,
          binding: "exact",
          archiveBinding: "not-originally-bound",
          evidence,
        },
      ],
      blockers: [
        ...evidence.blockers.map((code) => ({ recordId: id, code })),
        { recordId: id, code: "ORIGINAL_ARCHIVE_UNBOUND" },
      ],
    },
  }) as Extract<MediaReviewEvidence, { kind: "source-bound" }>;
}
const response = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const client = (respond: (r: Request) => Promise<Response>) =>
  createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: uuid(),
    runtimeGeneration: 1,
    fetch: (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });
test("original package owner SDK uses one scoped GET and keeps manual approval distinct from restricted owner metadata", async () => {
  const value = boundOwnerEvidence(),
    seen: Request[] = [];
  const c = client(async (q) => {
    seen.push(q);
    return response(value);
  });
  expect(
    await c.mediaReview.evidence(value.packageId, {
      projectId: value.projectId,
      episodeId: value.episodeId,
    }),
  ).toEqual(value);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.method).toBe("GET");
  expect(new URL(seen[0]!.url).pathname).toBe(
    `/api/v2/review-packages/${value.packageId}/delivery-evidence`,
  );
  expect(value.reviewState).toBe("approved");
  expect(value.mediaOwnerEvidence.state).toBe("blocked");
  expect(value.unknowns).toContain("CURRENT_FILES_NOT_READ");
});
test("original package owner contracts reject erased negative facts, forged success, missing, duplicated, foreign and private anchors", () => {
  const value = boundOwnerEvidence(),
    asset = value.mediaOwnerEvidence.assets[0]!;
  if (asset.binding !== "exact") throw Error("exact");
  const owner = value.mediaOwnerEvidence;
  for (const bad of [
    { ...owner, blockers: [] },
    { ...owner, state: "approved" },
    { ...owner, releaseReady: true },
    { ...owner, assets: [asset, asset] },
    { ...owner, assets: [{ ...asset, privatePath: "PRIVATE" }] },
    {
      ...owner,
      assets: [{ ...asset, evidence: { ...asset.evidence, recordVersion: 1 } }],
    },
  ])
    expect(MediaReviewOwnerEvidenceSchema.safeParse(bad).success).toBe(false);
  for (const bad of [
    { ...owner, assets: [], blockers: [], state: "no-media" },
    { ...owner, assets: [{ ...asset, fingerprint: "b".repeat(64) }] },
    {
      ...owner,
      assets: [
        { ...asset, evidence: { ...asset.evidence, projectId: uuid() } },
      ],
    },
    {
      ...owner,
      assets: [{ ...asset, archiveBinding: "matching-original-archive" }],
      blockers: owner.blockers.slice(0, -1),
    },
  ])
    expect(
      MediaReviewEvidenceSchema.safeParse({ ...value, mediaOwnerEvidence: bad })
        .success,
    ).toBe(false);
});
test("original package owner changed, missing and unavailable bindings keep unknowns and cannot silently substitute new evidence", () => {
  const value = boundOwnerEvidence(),
    original = value.original.snapshot.media[0]!;
  for (const binding of ["changed", "missing", "owner-unavailable"] as const) {
    const code =
      binding === "changed"
        ? "MEDIA_RECORD_CHANGED"
        : binding === "missing"
          ? "MEDIA_RECORD_MISSING"
          : "MEDIA_OWNER_UNAVAILABLE";
    const asset = {
      ...original,
      binding,
      ...(binding === "changed"
        ? { current: { ...original, fingerprint: "b".repeat(64) } }
        : {}),
    };
    const owner = MediaReviewOwnerEvidenceSchema.parse({
      scope: "original-package-media-owner-metadata",
      state: "blocked",
      releaseReady: false,
      assets: [asset],
      blockers: [{ recordId: original.id, code }],
    });
    const parsed = MediaReviewEvidenceSchema.parse({
      ...value,
      sourceState: "changed",
      reviewState: "stale",
      mediaOwnerEvidence: owner,
    });
    if (parsed.kind !== "source-bound") throw Error("bound");
    expect(parsed.unknowns).toEqual(value.unknowns);
    expect(
      MediaReviewOwnerEvidenceSchema.safeParse({
        ...owner,
        assets: [{ ...asset, current: original }],
      }).success,
    ).toBe(false);
  }
});
test("original package owner view shows exact declarations and no-media boundaries without file, bill or rights approval", () => {
  const value = boundOwnerEvidence();
  const markup = renderToStaticMarkup(
    createElement(MediaReviewOwnerEvidenceView, {
      value: value.mediaOwnerEvidence,
    }),
  );
  for (const text of [
    "DECLARED_RIGHTS_RESTRICTED",
    "DECLARED_PROVIDER_UNAVAILABLE",
    "ORIGINAL_ARCHIVE_UNBOUND",
    "不是结算回执",
    "当前文件未读取",
    "人工审片决定与素材证据分别记录",
  ])
    expect(markup).toContain(text);
  const empty = MediaReviewOwnerEvidenceSchema.parse({
    scope: "original-package-media-owner-metadata",
    state: "no-media",
    assets: [],
    blockers: [],
    releaseReady: false,
  });
  expect(
    renderToStaticMarkup(
      createElement(MediaReviewOwnerEvidenceView, { value: empty }),
    ),
  ).toContain("不强制补媒体");
});
test("bound review SDK preserves original key, body, If-Match and readonly recovery without extra calls", async () => {
  const r = original(),
    seen: Request[] = [],
    c = client(async (q) => {
      seen.push(q);
      return response(r);
    });
  expect(
    await c.mediaReview.createPackage(r.episodeId, r.input, r.requestKey),
  ).toEqual(r);
  expect(seen[0]!.method).toBe("POST");
  expect(await seen[0]!.json()).toEqual(r.input);
  expect(seen[0]!.headers.get("If-Match")).toBe(`"${sha}"`);
  expect(seen[0]!.headers.get("Idempotency-Key")).toBe(r.requestKey);
  expect(await c.mediaReview.recoverRequest(r.requestKey, r.projectId)).toEqual(
    r,
  );
  expect(seen).toHaveLength(2);
  expect(seen[1]!.method).toBe("GET");
});
test("bound review SDK rejects foreign scope, ignored late abort and 412 without new key or fallback", async () => {
  const r = original(),
    abort = new AbortController();
  let calls = 0;
  const c = client(async () => {
    calls++;
    abort.abort();
    return response(r.original);
  });
  await expect(
    c.mediaReview.preview(r.episodeId, r.projectId, abort.signal),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  const foreign = client(async () => response({ ...r, requestKey: uuid() }));
  await expect(
    foreign.mediaReview.createPackage(r.episodeId, r.input, r.requestKey),
  ).rejects.toThrow("does not match");
  const bad = client(async () => {
    calls++;
    return response({ status: 412, code: "SOURCE_CHANGED" }, 412);
  });
  await expect(
    bad.mediaReview.createPackage(r.episodeId, r.input, r.requestKey),
  ).rejects.toThrow();
  expect(calls).toBe(2);
});
test("bound review strict contracts retain unknowns, original scope and pending opaque input without consent or private fields", () => {
  const r = original();
  expect(
    MediaReviewReceiptSchema.safeParse({
      ...r,
      package: { ...r.package, token: "PRIVATE" },
    }).success,
  ).toBe(false);
  expect(
    MediaReviewPreviewSchema.safeParse({ ...r.original, releaseReady: true })
      .success,
  ).toBe(false);
  expect(
    MediaReviewPreviewSchema.safeParse({ ...r.original, episodeId: uuid() })
      .success,
  ).toBe(false);
  const p = {
    requestKey: r.requestKey,
    episodeId: r.episodeId,
    input: r.input,
  };
  expect(MediaReviewPendingSchema.parse(p)).toEqual(p);
  for (const bad of [
    { ...p, approved: true },
    { ...p, input: { ...p.input, privatePath: "PRIVATE" } },
  ])
    expect(MediaReviewPendingSchema.safeParse(bad).success).toBe(false);
  const legacy = {
    packageId: r.package.id,
    projectId: r.projectId,
    episodeId: r.episodeId,
    kind: "legacy-unbound" as const,
    scope: "legacy-review-not-bound-to-nle" as const,
    releaseReady: false as const,
    reviewState: "unverified" as const,
  };
  expect(MediaReviewEvidenceSchema.parse(legacy)).toEqual(legacy);
  expect(
    MediaReviewEvidenceSchema.safeParse({ ...legacy, reviewState: "approved" })
      .success,
  ).toBe(false);
});
test("bound review original JSON export does not substitute current metadata or foreign packages", async () => {
  const r = original(),
    value = { package: r.package, original: r.original },
    doc = {
      fileName: `review-${r.package.id}-original-nle.json`,
      mimeType: "application/json; charset=utf-8" as const,
      content: JSON.stringify(value),
    };
  expect(MediaReviewExportSchema.parse(value)).toEqual(value);
  const c = client(async () => response(doc));
  expect(
    await c.mediaReview.exportOriginal(r.package.id, {
      projectId: r.projectId,
      episodeId: r.episodeId,
    }),
  ).toEqual(doc);
  await expect(
    c.mediaReview.exportOriginal(uuid(), {
      projectId: r.projectId,
      episodeId: r.episodeId,
    }),
  ).rejects.toThrow("does not match");
});
