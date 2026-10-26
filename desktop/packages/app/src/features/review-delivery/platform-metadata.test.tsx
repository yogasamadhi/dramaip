import { test, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createStudioClient } from "@dramaip/client";
import {
  PlatformMetadataPreflightSchema,
  PlatformMetadataArchiveSchema,
  PlatformMetadataReceiptSchema,
  type PlatformMetadataPreflight,
} from "@dramaip/contracts/delivery";
import { PlatformDeliveryPreflightView } from "./impl";
import {
  PlatformMetadataPendingSchema,
  readPlatformMetadataPending,
  platformMetadataPendingKey,
} from "./platform-metadata-pending";
const uuid = () => crypto.randomUUID(),
  digest = "a".repeat(64),
  date = "2026-10-07T00:00:00.000Z";
function preflight(): PlatformMetadataPreflight {
  const projectId = uuid(),
    adaptationId = uuid(),
    episodeId = uuid(),
    creativeVariantId = uuid(),
    profileId = uuid();
  const profile = {
    id: profileId,
    version: "internal-test",
    title: "内部档案",
    platform: "通用平台",
    region: "内部测试",
    sourceUrl: "dramaip://profiles/test",
    sourceStatus: "internal_master" as const,
    checkedAt: date,
    filenamePrefix: "dramaip",
    video: {
      width: 1080,
      height: 1920,
      videoCodec: "H.264",
      audioCodec: "AAC",
    },
    duration: { status: "manual" as const, note: "手工核对" },
    subtitleSafeZone: { bottomMarginPx: 240, note: "内部测试" },
    requiredListingFields: ["标题"],
    manualFields: ["地区"],
  };
  return {
    episodeId,
    input: {
      projectId,
      profileId,
      creativeVariantId,
      manualFieldsConfirmed: true,
    },
    ok: true,
    profile,
    blockers: [],
    warnings: ["不是发行批准"],
    expectedFiles: ["dramaip-test.json"],
    finalBaseName: "dramaip-test",
    sourceFingerprint: digest,
    scope: "submission-metadata-only",
    releaseReady: false,
    unknowns: [
      "CONTENT_QUALITY_UNVERIFIED",
      "LEGAL_RIGHTS_UNVERIFIED",
      "SETTLEMENT_UNKNOWN",
      "CURRENT_FILES_NOT_READ",
      "PLATFORM_RULES_NOT_VERIFIED",
    ],
    snapshot: {
      project: { id: projectId, version: 2, fingerprint: digest },
      adaptation: { id: adaptationId, version: 3, fingerprint: digest },
      episode: { id: episodeId, version: 4, fingerprint: digest },
      profile,
      variant: {
        id: creativeVariantId,
        projectId,
        adaptationId,
        label: "原候选",
        title: "原作者标题",
        description: "原简介",
        tags: ["原标签"],
        source: "manual",
        status: "adopted",
        version: 1,
        versionNumber: 2,
        createdAt: date,
        updatedAt: date,
        contentFingerprint: digest,
        projectVersion: 2,
        adaptationVersion: 3,
        headRevision: 1,
        adoptionVerified: true,
      },
    },
  };
}
const client = (respond: (r: Request) => Promise<Response>) =>
  createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: uuid(),
    runtimeGeneration: 1,
    fetch: (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });
const response = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
test("platform metadata strict snapshots preserve original scope and unknowns without private fields or release approval", () => {
  const p = preflight();
  expect(PlatformMetadataPreflightSchema.parse(p)).toEqual(p);
  for (const bad of [
    { ...p, releaseReady: true },
    { ...p, unknowns: [] },
    { ...p, token: "PRIVATE" },
    { ...p, input: { ...p.input, manualFieldsConfirmed: false } },
    {
      ...p,
      snapshot: {
        ...p.snapshot!,
        variant: { ...p.snapshot!.variant, adoptionVerified: false },
      },
    },
    {
      ...p,
      snapshot: {
        ...p.snapshot!,
        episode: { ...p.snapshot!.episode, id: uuid() },
      },
    },
  ])
    expect(PlatformMetadataPreflightSchema.safeParse(bad).success).toBe(false);
  const archive = {
    scope: p.scope,
    releaseReady: false as const,
    unknowns: p.unknowns,
    id: uuid(),
    projectId: p.input.projectId,
    adaptationId: p.snapshot!.adaptation.id,
    episodeId: p.episodeId,
    profileId: p.input.profileId,
    profileVersion: p.profile!.version,
    creativeVariantId: p.input.creativeVariantId,
    deliveryVersion: 1,
    sourceFingerprint: p.sourceFingerprint,
    createdAt: date,
    preflight: p,
  };
  expect(PlatformMetadataArchiveSchema.parse(archive)).toEqual(archive);
  expect(
    PlatformMetadataArchiveSchema.safeParse({
      ...archive,
      sourceFingerprint: "b".repeat(64),
    }).success,
  ).toBe(false);
  expect(
    PlatformMetadataArchiveSchema.safeParse({ ...archive, episodeId: uuid() })
      .success,
  ).toBe(false);
  expect(
    PlatformMetadataArchiveSchema.safeParse({
      ...archive,
      absolutePath: "PRIVATE",
    }).success,
  ).toBe(false);
});
test("platform metadata SDK sends exactly original input and key with original If-Match and never substitutes a new archive", async () => {
  const p = preflight(),
    key = uuid(),
    input = { ...p.input, sourceFingerprint: p.sourceFingerprint },
    seen: Request[] = [];
  const archive = {
    scope: p.scope,
    releaseReady: false as const,
    unknowns: p.unknowns,
    id: uuid(),
    projectId: p.input.projectId,
    adaptationId: p.snapshot!.adaptation.id,
    episodeId: p.episodeId,
    profileId: p.input.profileId,
    profileVersion: p.profile!.version,
    creativeVariantId: p.input.creativeVariantId,
    deliveryVersion: 1,
    sourceFingerprint: p.sourceFingerprint,
    createdAt: date,
    preflight: p,
  };
  const original = {
    operation: "archive" as const,
    requestKey: key,
    projectId: p.input.projectId,
    aggregateId: p.episodeId,
    requestHash: digest,
    createdAt: date,
    input,
    result: archive,
  };
  const c = client(async (r) => {
    seen.push(r);
    return response(original);
  });
  expect(
    await c.platformDelivery.createArchive(p.episodeId, input, key),
  ).toEqual(PlatformMetadataReceiptSchema.parse(original));
  expect(seen).toHaveLength(1);
  expect(seen[0]!.method).toBe("POST");
  expect(seen[0]!.headers.get("If-Match")).toBe(`"${digest}"`);
  expect(seen[0]!.headers.get("Idempotency-Key")).toBe(key);
  expect(await seen[0]!.json()).toEqual(input);
  const wrong = client(async () =>
    response({ ...original, requestKey: uuid() }),
  );
  await expect(
    wrong.platformDelivery.createArchive(p.episodeId, input, key),
  ).rejects.toThrow("identity");
  const reads: Request[] = [];
  const recovery = client(async (r) => {
    reads.push(r);
    return response(original);
  });
  expect(
    await recovery.platformDelivery.recoverRequest(key, p.input.projectId),
  ).toEqual(original);
  expect(reads[0]!.method).toBe("GET");
  expect(reads[0]!.url).toContain(
    `/requests/${key}?projectId=${p.input.projectId}`,
  );
});
test("platform metadata SDK rejects late ignored-abort preflight, foreign variant scope and 412 without fallback requests", async () => {
  const p = preflight(),
    controller = new AbortController();
  let calls = 0;
  const c = client(async () => {
    ++calls;
    controller.abort();
    return response(p);
  });
  await expect(
    c.platformDelivery.preflight(p.episodeId, p.input, controller.signal),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  await expect(
    c.platformDelivery.preflight(p.episodeId, p.input, controller.signal),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  const foreign = client(async () =>
    response([{ ...p.snapshot!.variant, projectId: uuid() }]),
  );
  await expect(
    foreign.platformDelivery.listVariants(
      p.snapshot!.adaptation.id,
      p.input.projectId,
    ),
  ).rejects.toThrow("scope");
  const denied = client(async () => {
    ++calls;
    return new Response(
      JSON.stringify({
        code: "METADATA_PRECONDITION_CHANGED",
        status: 412,
        detail: "原版本变动",
      }),
      { status: 412, headers: { "Content-Type": "application/problem+json" } },
    );
  });
  await expect(
    denied.platformDelivery.createArchive(
      p.episodeId,
      { ...p.input, sourceFingerprint: p.sourceFingerprint },
      uuid(),
    ),
  ).rejects.toMatchObject({ status: 412 });
  expect(calls).toBe(2);
});
test("platform metadata pending originals are strict scope-bound opaque IDs and hashes, not author copy or restored consent", () => {
  const p = preflight(),
    original = {
      operation: "archive" as const,
      key: uuid(),
      projectId: p.input.projectId,
      adaptationId: p.snapshot!.adaptation.id,
      episodeId: p.episodeId,
      aggregateId: p.episodeId,
      input: { ...p.input, sourceFingerprint: p.sourceFingerprint },
    };
  const storage = {
    getItem: (key: string) =>
      key ===
      platformMetadataPendingKey(
        original.projectId,
        original.adaptationId,
        original.episodeId,
      )
        ? JSON.stringify(original)
        : null,
  };
  expect(
    readPlatformMetadataPending(
      storage,
      original.projectId,
      original.adaptationId,
      original.episodeId,
    ),
  ).toEqual(original);
  expect(
    readPlatformMetadataPending(
      storage,
      uuid(),
      original.adaptationId,
      original.episodeId,
    ),
  ).toBeUndefined();
  expect(
    PlatformMetadataPendingSchema.safeParse({ ...original, title: "PRIVATE" })
      .success,
  ).toBe(false);
  expect(
    PlatformMetadataPendingSchema.safeParse({
      ...original,
      input: { ...original.input, projectId: uuid() },
    }).success,
  ).toBe(false);
  expect(JSON.stringify(original)).not.toContain(p.snapshot!.variant.title);
  expect(() =>
    readPlatformMetadataPending(
      { getItem: () => JSON.stringify({ ...original, projectId: uuid() }) },
      original.projectId,
      original.adaptationId,
      original.episodeId,
    ),
  ).toThrow();
});
test("platform metadata view labels the original title, adopted revision, fingerprint and all approval boundaries", () => {
  const p = preflight(),
    html = renderToStaticMarkup(
      <PlatformDeliveryPreflightView preflight={p} />,
    );
  for (const expected of [
    "原作者标题",
    "采用修订1",
    digest,
    "仅提交资料元数据",
    "成片质量",
    "合法授权",
    "实际结算",
    "当前文件",
    "目标平台规格",
    "尚未生成／附加／读取",
  ])
    expect(html).toContain(expected);
});
test("platform metadata legacy export remains a scoped read-only unverified document, never a new preflight or release result", async () => {
  const projectId = uuid(),
    id = uuid(),
    legacy = {
      scope: "legacy-submission-metadata-unverified",
      releaseReady: false,
      id,
      projectId,
      episodeId: uuid(),
      createdAt: date,
      deliveryVersion: 1,
      profileId: uuid(),
    },
    seen: Request[] = [];
  const c = client(async (r) => {
    seen.push(r);
    return response({
      fileName: `platform-delivery-${id}.json`,
      mimeType: "application/json; charset=utf-8",
      content: JSON.stringify(legacy),
    });
  });
  const document = await c.platformDelivery.exportArchive(id, projectId);
  expect(JSON.parse(document.content)).toEqual(legacy);
  expect(seen).toHaveLength(1);
  expect(seen[0]!.method).toBe("GET");
  expect(document.content).not.toContain("preflight");
  await expect(c.platformDelivery.exportArchive(id, uuid())).rejects.toThrow(
    "scope",
  );
});
