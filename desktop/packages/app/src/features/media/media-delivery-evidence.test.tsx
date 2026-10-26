import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createStudioClient, StudioClientError } from "@dramaip/client";
import {
  MediaDeliveryEvidenceSchema,
  mediaDeclarationStatus,
  type MediaDeliveryEvidence,
} from "@dramaip/contracts/media";
import { MediaDeliveryEvidenceView } from "./MediaDeliveryEvidencePanel";

const uuid = () => crypto.randomUUID();
function evidence(): MediaDeliveryEvidence {
  const recordId = uuid(),
    projectId = uuid();
  return {
    recordId,
    projectId,
    recordVersion: 2,
    kind: "renders",
    scope: "exact-media-record-metadata",
    releaseReady: false,
    qualityState: "unverified",
    settlementState: "unknown",
    currentFileIntegrity: "not-read",
    declarations: mediaDeclarationStatus({
      权利状态: "已核验",
      费用状态: "已知",
      服务状态: "可用",
    }),
    source: {
      recordId,
      recordVersion: 2,
      state: "unbound",
      verification: "actual-record-version-only",
      reasons: [],
    },
    archive: {
      artifactId: uuid(),
      mediaRef: uuid(),
      kind: "video",
      mimeType: "video/mp4",
      extension: ".mp4",
      sizeBytes: 4,
      sha256: "a".repeat(64),
      status: "archived",
    },
    blockers: [],
    unknowns: [
      "CONTENT_QUALITY_UNVERIFIED",
      "LEGAL_RIGHTS_UNVERIFIED",
      "SETTLEMENT_UNKNOWN",
      "CURRENT_FILE_NOT_READ",
    ],
  };
}
function withReceipt(value = evidence()): MediaDeliveryEvidence {
  return {
    ...value,
    latestByteRead: {
      id: uuid(),
      verifiedAt: "2026-10-07T00:00:00.000Z",
      evidence: "complete-byte-read-at-recorded-time",
      currentArchiveBinding: "matching-archive-metadata",
      descriptor: {
        recordId: value.recordId,
        projectId: value.projectId,
        recordVersion: value.recordVersion,
        kind: "video",
        mimeType: "video/mp4",
        sizeBytes: 4,
        sha256: "a".repeat(64),
        origin: "managed-archive",
        artifactRef: value.archive!.artifactId,
        verification: "owner-metadata-only",
      },
    },
  };
}
function client(respond: (request: Request) => Promise<Response>) {
  return createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: uuid(),
    runtimeGeneration: 1,
    fetch: (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });
}
test("negative rights aliases win conflicting cleared declarations; known cost and available provider remain declarations only", () => {
  for (const value of [
    "受限",
    "已撤回",
    "已过期",
    "restricted",
    " Revoked ",
    "EXPIRED",
  ]) {
    expect(
      mediaDeclarationStatus({ 权利状态: "已核验", rightsStatus: value }),
    ).toMatchObject({
      rightsStatus: "restricted",
      rightsDeclaration: "user-reported-restricted",
      costStatus: "unknown",
    });
    expect(
      mediaDeclarationStatus({ status: value }, "rights").rightsStatus,
    ).toBe("restricted");
    expect(
      mediaDeclarationStatus({ status: value }, "renders").rightsStatus,
    ).toBe("unknown");
  }
  expect(
    mediaDeclarationStatus({
      权利状态: "已核验",
      费用状态: "已知",
      服务状态: "可用",
      providerStatus: "unavailable",
    }),
  ).toEqual({
    rightsStatus: "unknown",
    rightsDeclaration: "user-reported-cleared",
    costStatus: "unknown",
    costDeclaration: "user-reported-known",
    providerStatus: "unavailable",
    providerDeclaration: "user-reported-unavailable",
  });
});
test("evidence contract refuses fabricated approval, removed negatives, contradictory declarations and foreign version/private fields", () => {
  const original = withReceipt();
  expect(MediaDeliveryEvidenceSchema.parse(original)).toEqual(original);
  for (const invalid of [
    { ...original, releaseReady: true },
    { ...original, qualityState: "verified" },
    { ...original, currentFileIntegrity: "verified" },
    { ...original, settlementState: "known" },
    { ...original, source: { ...original.source, recordVersion: 3 } },
    { ...original, archive: { ...original.archive, status: "removed" } },
    {
      ...original,
      declarations: { ...original.declarations, rightsStatus: "restricted" },
    },
    {
      ...original,
      declarations: {
        ...original.declarations,
        providerDeclaration: "user-reported-unavailable",
      },
    },
    { ...original, path: "/PRIVATE/file.mp4" },
    {
      ...original,
      latestByteRead: { ...original.latestByteRead, requestKey: uuid() },
    },
    {
      ...original,
      latestByteRead: {
        ...original.latestByteRead!,
        descriptor: {
          ...original.latestByteRead!.descriptor,
          artifactRef: undefined,
        },
      },
    },
    {
      ...original,
      latestByteRead: {
        ...original.latestByteRead!,
        descriptor: {
          ...original.latestByteRead!.descriptor,
          origin: "embedded",
        },
        currentArchiveBinding: "not-rechecked",
      },
    },
    {
      ...original,
      latestByteRead: {
        ...original.latestByteRead,
        descriptor: {
          ...original.latestByteRead!.descriptor,
          projectId: uuid(),
        },
      },
    },
  ])
    expect(MediaDeliveryEvidenceSchema.safeParse(invalid).success).toBe(false);
  const restricted = {
    ...original,
    declarations: mediaDeclarationStatus({
      rightsStatus: "revoked",
      providerStatus: "unavailable",
    }),
    blockers: ["DECLARED_RIGHTS_RESTRICTED", "DECLARED_PROVIDER_UNAVAILABLE"],
  };
  expect(MediaDeliveryEvidenceSchema.safeParse(restricted).success).toBe(true);
  expect(
    MediaDeliveryEvidenceSchema.safeParse({ ...restricted, blockers: [] })
      .success,
  ).toBe(false);
  expect(
    MediaDeliveryEvidenceSchema.safeParse({
      ...restricted,
      declarations: {
        ...restricted.declarations,
        rightsDeclaration: "user-reported-cleared",
      },
    }).success,
  ).toBe(false);
});
test("historical complete read cannot claim matching changed archive metadata or an embedded preview as an archived delivery", () => {
  const value = withReceipt();
  const changed = {
    ...value,
    archive: { ...value.archive!, sha256: "b".repeat(64) },
  };
  expect(MediaDeliveryEvidenceSchema.safeParse(changed).success).toBe(false);
  expect(
    MediaDeliveryEvidenceSchema.safeParse({
      ...changed,
      latestByteRead: {
        ...value.latestByteRead!,
        currentArchiveBinding: "changed-archive-metadata",
      },
    }).success,
  ).toBe(true);
  const { artifactRef: _artifact, ...embedded } =
    value.latestByteRead!.descriptor;
  const { archive: _archive, ...unarchived } = value;
  const preview = {
    ...unarchived,
    blockers: ["ARCHIVE_UNAVAILABLE"],
    latestByteRead: {
      ...value.latestByteRead!,
      descriptor: { ...embedded, origin: "embedded" },
      currentArchiveBinding: "not-rechecked",
    },
  };
  expect(MediaDeliveryEvidenceSchema.safeParse(preview).success).toBe(true);
  expect(
    MediaDeliveryEvidenceSchema.safeParse({ ...preview, blockers: [] }).success,
  ).toBe(false);
});
test("exact evidence SDK sends one scoped version GET, no byte read/write/latest fallback, and rejects wrong identity", async () => {
  const value = evidence(),
    calls: Request[] = [];
  const sdk = client(async (request) => {
    calls.push(request);
    return Response.json(value);
  });
  expect(
    await sdk.mediaPlayback.deliveryEvidence(
      value.recordId,
      value.projectId,
      2,
    ),
  ).toEqual(value);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  const url = new URL(calls[0]!.url);
  expect(url.pathname).toBe(
    `/api/v2/media-records/${value.recordId}/delivery-evidence`,
  );
  expect([...url.searchParams]).toEqual([
    ["projectId", value.projectId],
    ["recordVersion", "2"],
  ]);
  const foreignRecordId = uuid();
  for (const invalid of [
    {
      ...value,
      recordId: foreignRecordId,
      source: { ...value.source, recordId: foreignRecordId },
    },
    { ...value, projectId: uuid() },
    {
      ...value,
      recordVersion: 3,
      source: { ...value.source, recordVersion: 3 },
    },
  ]) {
    let count = 0;
    const wrong = client(async () => {
      count++;
      return Response.json(invalid);
    });
    await expect(
      wrong.mediaPlayback.deliveryEvidence(value.recordId, value.projectId, 2),
    ).rejects.toThrow();
    expect(count).toBe(1);
  }
});
test("evidence SDK aborts before fetch and after late ignored-abort responses, and propagates exact refusal without substitution", async () => {
  const value = evidence(),
    abort = new AbortController();
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    abort.abort();
    return Response.json(value);
  });
  await expect(
    sdk.mediaPlayback.deliveryEvidence(
      value.recordId,
      value.projectId,
      2,
      abort.signal,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  await expect(
    sdk.mediaPlayback.deliveryEvidence(
      value.recordId,
      value.projectId,
      2,
      abort.signal,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  for (const version of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      sdk.mediaPlayback.deliveryEvidence(
        value.recordId,
        value.projectId,
        version,
      ),
    ).rejects.toThrow();
  expect(calls).toBe(1);
  const refused = client(async () =>
    Response.json(
      {
        type: "about:blank",
        title: "Exact version unavailable",
        status: 412,
        code: "MEDIA_EVIDENCE_VERSION_CHANGED",
        traceId: "exact-evidence",
      },
      { status: 412, headers: { "Content-Type": "application/problem+json" } },
    ),
  );
  const error = await refused.mediaPlayback
    .deliveryEvidence(value.recordId, value.projectId, 2)
    .catch((error) => error);
  expect(error).toBeInstanceOf(StudioClientError);
  expect(error).toMatchObject({
    status: 412,
    body: { requestId: "exact-evidence" },
  });
});
test("ordinary evidence view keeps historical bytes, legal rights, costs, source and whole-delivery limits explicit", () => {
  const value = withReceipt();
  const html = renderToStaticMarkup(
    <MediaDeliveryEvidenceView value={value} />,
  );
  for (const text of [
    value.recordId,
    "v2",
    value.archive!.sha256,
    value.latestByteRead!.id,
    "只读元数据，不是整包交付验收",
    "内容质量未核验",
    "合法授权未核验",
    "实际结算未知",
    "当前文件未读取",
    "只证明记录时间",
    "未知项仍未通过",
  ])
    expect(html).toContain(text);
  const missing = renderToStaticMarkup(
    <MediaDeliveryEvidenceView
      value={{
        ...evidence(),
        archive: undefined,
        blockers: ["ARCHIVE_UNAVAILABLE"],
      }}
    />,
  );
  expect(missing).toContain("没有已记录的原版本完整读取凭证");
  expect(missing).toContain("ARCHIVE_UNAVAILABLE");
});
