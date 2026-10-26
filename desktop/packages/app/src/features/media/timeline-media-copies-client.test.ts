import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { createStudioClient } from "@dramaip/client";
import {
  TimelineMediaCopyInputSchema,
  TimelineMediaCopySchema,
  serializeTimelineMediaCopyReceipt,
  type TimelineMediaCopy,
} from "@dramaip/contracts/timeline-copy";

const id = () => crypto.randomUUID();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function fixture() {
  const projectId = id(),
    episodeId = id(),
    timelineId = id(),
    assetId = id(),
    artifactRef = id();
  const now = new Date().toISOString(),
    fingerprint = "a".repeat(64);
  const scope = {
    projectId,
    episodeId,
    timelineId,
    timelineVersion: 4,
    sourceFingerprint: fingerprint,
  };
  const input = TimelineMediaCopyInputSchema.parse({
    manifest: {
      format: "dramaip-timeline-delivery",
      schemaVersion: 3,
      timeline: {
        format: "dramaip-timeline",
        schemaVersion: 2,
        id: timelineId,
        projectId,
        episodeId,
        adaptationId: id(),
        version: 4,
        createdAt: now,
        updatedAt: now,
        sourceFingerprint: "original",
        profile: {
          width: 1080,
          height: 1920,
          frameRate: { numerator: 25, denominator: 1, dropFrame: false },
          audioSampleRate: 48000,
          channels: 2,
        },
        timebase: "frames",
        durationFrames: 25,
        migrationWarnings: [],
        tracks: [],
      },
      sourceFingerprint: fingerprint,
      sourceBlockers: [],
      unsupportedFeatures: [],
      warnings: [],
      media: [
        {
          assetId,
          title: "原素材",
          clipIds: [],
          expectedVersions: [2],
          sourceVersion: 2,
          sourceStatus: "current",
          relativePath: `media/${assetId}.mp4`,
          mediaStatus: "unattached",
          rightsStatus: "unknown",
          rightsDeclaration: "not-provided",
          lineage: [assetId],
          archive: {
            artifactRef,
            kind: "video",
            mimeType: "video/mp4",
            extension: ".mp4",
            sizeBytes: 3,
            sha256: sha("abc"),
            verification: "owner-metadata-only",
          },
        },
      ],
    },
    directory: {
      scope,
      grant: {
        grantId: id(),
        generation: 1,
        permission: "write-directory",
        displayName: "明确本地交接",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    },
    purpose: "local-nle-handoff",
    acknowledgedLimits: true,
  });
  const pending: TimelineMediaCopy = {
    id: id(),
    version: 0,
    scope,
    requestHash: sha(JSON.stringify(canonical(input))),
    status: "submission-unknown",
    currentBinding: "unchanged-metadata",
    createdAt: now,
    updatedAt: now,
  };
  const receipt = {
    format: "dramaip-nle-media-copy-receipt" as const,
    schemaVersion: 1 as const,
    packageRef: id(),
    ...scope,
    verifiedAt: now,
    evidence: "complete-copy-and-destination-re-read-at-recorded-time" as const,
    qualityState: "unverified" as const,
    rightsState: "unverified" as const,
    billingState: "unknown" as const,
    files: [
      {
        relativePath: `media/${assetId}.mp4`,
        kind: "media" as const,
        sizeBytes: 3,
        sha256: sha("abc"),
        source: { assetId, recordVersion: 2, artifactId: artifactRef },
      },
      ...[
        "timeline.fcpxml",
        "timeline.otio",
        "timeline.edl",
        "subtitles.srt",
        "subtitles.vtt",
        "relink.json",
        "timeline-manifest.json",
      ].map((relativePath) => ({
        relativePath,
        kind: "document" as const,
        sizeBytes: 0,
        sha256: sha(""),
      })),
    ],
  };
  const receiptBytes = serializeTimelineMediaCopyReceipt(
    receipt as Parameters<typeof serializeTimelineMediaCopyReceipt>[0],
  );
  const done = TimelineMediaCopySchema.parse({
    ...pending,
    version: 1,
    status: "completed",
    copy: {
      artifactRef: receipt.packageRef,
      receipt,
      receiptBytes: new TextEncoder().encode(receiptBytes).byteLength,
      receiptSha256: sha(receiptBytes),
    },
  });
  return { input, pending, done, scope };
}
function client(respond: (request: Request) => Promise<Response>) {
  return createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: id(),
    runtimeGeneration: 1,
    fetch: (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });
}

test("NLE SDK 构造无副作用，选择／创建／原键恢复／刷新／取消／历史／展示只用正式 Core API 和精确原身份", async () => {
  const f = fixture(),
    calls: Request[] = [];
  const sdk = client(async (request) => {
    calls.push(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/media-copy-directory"))
      return Response.json(f.input.directory);
    if (path.endsWith("/reveal")) return Response.json({ revealed: true });
    if (request.method === "GET" && path.endsWith("/media-copies"))
      return Response.json({
        projectId: f.scope.projectId,
        timelineId: f.scope.timelineId,
        items: [f.done],
      });
    return Response.json(
      request.method === "POST" && path.endsWith("/media-copies")
        ? f.pending
        : f.done,
    );
  });
  expect(calls).toHaveLength(0);
  expect(
    await sdk.timelineMediaCopies.chooseDirectory(f.input.manifest),
  ).toEqual(f.input.directory);
  expect(await sdk.timelineMediaCopies.create(f.input, f.pending.id)).toEqual(
    f.pending,
  );
  expect(await sdk.timelineMediaCopies.recover(f.input, f.pending.id)).toEqual(
    f.done,
  );
  expect(await sdk.timelineMediaCopies.get(f.pending.id, f.scope)).toEqual(
    f.done,
  );
  const refreshKey = id(),
    cancelKey = id();
  expect(await sdk.timelineMediaCopies.refresh(f.pending, refreshKey)).toEqual(
    f.done,
  );
  expect(await sdk.timelineMediaCopies.cancel(f.pending, cancelKey)).toEqual(
    f.done,
  );
  expect(
    (await sdk.timelineMediaCopies.list(f.scope.timelineId, f.scope.projectId))
      .items,
  ).toEqual([f.done]);
  expect(await sdk.timelineMediaCopies.reveal(f.done)).toEqual({
    revealed: true,
  });
  expect(calls).toHaveLength(8);
  expect(
    calls.every((request) =>
      new URL(request.url).pathname.startsWith("/api/v2/"),
    ),
  ).toBe(true);
  expect(calls[0]!.headers.get("Idempotency-Key")).toBeNull();
  expect(calls[1]!.headers.get("Idempotency-Key")).toBe(f.pending.id);
  expect(calls[1]!.headers.get("If-Match")).toBe(
    `"timeline:${f.scope.timelineId}:4"`,
  );
  expect(await calls[1]!.json()).toEqual(f.input);
  expect(calls[2]!.method).toBe("GET");
  expect(calls[3]!.method).toBe("GET");
  expect(calls[4]!.headers.get("Idempotency-Key")).toBe(refreshKey);
  expect(calls[5]!.headers.get("Idempotency-Key")).toBe(cancelKey);
  expect(calls[4]!.headers.get("If-Match")).toBe(
    `"media-copy:${f.pending.id}:0"`,
  );
  expect(calls[7]!.headers.get("Idempotency-Key")).toBeNull();
  expect(await calls[7]!.json()).toEqual({
    projectId: f.scope.projectId,
    artifactRef: f.done.copy!.artifactRef,
  });
});

test("NLE SDK 核完整整包凭证字节，运输键序变化不改变原 receipt SHA", async () => {
  const f = fixture();
  const value = {
    ...f.done,
    copy: {
      ...f.done.copy!,
      receipt: Object.fromEntries(
        Object.entries(f.done.copy!.receipt).reverse(),
      ),
    },
  };
  const sdk = client(async () => Response.json(value));
  expect(await sdk.timelineMediaCopies.recover(f.input, f.pending.id)).toEqual(
    f.done,
  );
});

test("NLE SDK 拒绝错误身份／版本／原请求哈希／未知路径／不完整证明，不自动 POST 或换键", async () => {
  const f = fixture();
  for (const value of [
    { ...f.done, id: id() },
    { ...f.done, scope: { ...f.scope, timelineVersion: 5 } },
    { ...f.done, requestHash: "b".repeat(64) },
    { ...f.done, path: "/private/foreign" },
    {
      ...f.done,
      copy: { ...f.done.copy!, receiptBytes: f.done.copy!.receiptBytes + 1 },
    },
    { ...f.done, copy: { ...f.done.copy!, receiptSha256: "b".repeat(64) } },
    {
      ...f.done,
      copy: {
        ...f.done.copy!,
        receipt: {
          ...f.done.copy!.receipt,
          files: f.done.copy!.receipt.files.slice(1),
        },
      },
    },
  ]) {
    const calls: Request[] = [];
    const sdk = client(async (request) => {
      calls.push(request);
      return Response.json(value);
    });
    await expect(
      sdk.timelineMediaCopies.recover(f.input, f.pending.id),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
  }
});

test("NLE SDK 原媒体文件 SHA 即使与整份凭证一起伪改，也不能匹配冻结原输入", async () => {
  const f = fixture(),
    value = structuredClone(f.done);
  value.copy!.receipt.files[0]!.sha256 = "b".repeat(64);
  const content = serializeTimelineMediaCopyReceipt(value.copy!.receipt);
  value.copy!.receiptSha256 = sha(content);
  value.copy!.receiptBytes = new TextEncoder().encode(content).byteLength;
  const sdk = client(async () => Response.json(value));
  await expect(
    sdk.timelineMediaCopies.recover(f.input, f.pending.id),
  ).rejects.toThrow("冻结输入");
});

test("NLE SDK 历史拒绝异项目、异时间线、重复项和错误游标，不隐式读取 Host 或原媒体", async () => {
  const f = fixture(),
    page = {
      projectId: f.scope.projectId,
      timelineId: f.scope.timelineId,
      items: [f.done],
    };
  for (const value of [
    { ...page, projectId: id() },
    { ...page, timelineId: id() },
    { ...page, items: [f.done, f.done] },
    { ...page, nextCursor: id() },
    { ...page, items: [{ ...f.done, scope: { ...f.scope, projectId: id() } }] },
  ]) {
    const calls: Request[] = [];
    const sdk = client(async (request) => {
      calls.push(request);
      return Response.json(value);
    });
    await expect(
      sdk.timelineMediaCopies.list(f.scope.timelineId, f.scope.projectId),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
  }
});

test("NLE SDK 输入不完整、范围不符或夹带目录路径时，在网络之前拒绝", async () => {
  const f = fixture();
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return Response.json(f.pending);
  });
  for (const value of [
    { ...f.input, directory: { ...f.input.directory, grant: null } },
    { ...f.input, acknowledgedLimits: false },
    {
      ...f.input,
      directory: {
        ...f.input.directory,
        scope: { ...f.scope, timelineId: id() },
      },
    },
    {
      ...f.input,
      directory: {
        ...f.input.directory,
        grant: { ...f.input.directory.grant!, path: "/private" },
      },
    },
  ])
    await expect(
      sdk.timelineMediaCopies.create(value as typeof f.input, f.pending.id),
    ).rejects.toThrow();
  expect(calls).toBe(0);
});

test("NLE SDK 目录取消可以返回 null；错误原 scope 不允许用于复制", async () => {
  const f = fixture();
  const canceled = client(async () =>
    Response.json({ scope: f.scope, grant: null }),
  );
  expect(
    (await canceled.timelineMediaCopies.chooseDirectory(f.input.manifest))
      .grant,
  ).toBeNull();
  const changed = client(async () =>
    Response.json({
      ...f.input.directory,
      scope: { ...f.scope, sourceFingerprint: "b".repeat(64) },
    }),
  );
  await expect(
    changed.timelineMediaCopies.chooseDirectory(f.input.manifest),
  ).rejects.toThrow();
});

test("NLE SDK 不确定回复保留为原请求未知；失败只返回错误，不重试复制或展示", async () => {
  const f = fixture();
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    throw Error("controlled lost reply");
  });
  await expect(
    sdk.timelineMediaCopies.create(f.input, f.pending.id),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  const pending = client(async () => Response.json(f.pending));
  await expect(pending.timelineMediaCopies.reveal(f.pending)).rejects.toThrow();
});

test("NLE SDK 取消观察隔离迟到结果，不偷偷发送 Host cancel；显式取消另用业务 API", async () => {
  const f = fixture(),
    abort = new AbortController();
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    abort.abort();
    return Response.json(f.done);
  });
  await expect(
    sdk.timelineMediaCopies.get(f.pending.id, f.scope, abort.signal),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

test("整包公开契约严格区分失败证据、成功原媒体／七文档和原时间范围", () => {
  const f = fixture();
  for (const value of [
    { ...f.pending, failureCode: "COPY_FAILED" },
    { ...f.pending, scratchState: "cleaned" },
    { ...f.done, failureCode: "COPY_FAILED" },
    {
      ...f.pending,
      status: "canceled",
      failureCode: "COPY_FAILED",
      scratchState: "cleaned",
    },
    { ...f.pending, updatedAt: "2020-01-01T00:00:00.000Z" },
  ])
    expect(TimelineMediaCopySchema.safeParse(value).success).toBe(false);
});
