import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import type { NarrativeQualityReport } from "@dramaip/contracts/creative-quality";
const projectId = "60000000-0000-4000-8000-000000000001",
  id = "60000000-0000-4000-8000-000000000002",
  other = "60000000-0000-4000-8000-000000000003";
const target = {
  kind: "scene" as const,
  id,
  version: 0,
  sourceFingerprint: "a".repeat(64),
};
const at = "2026-10-03T00:00:00.000Z";
const report: NarrativeQualityReport = {
  id,
  projectId,
  workflowId: other,
  version: 0,
  status: "awaiting-review",
  basis: {
    request: { target, dimensions: ["causality"] },
    baseReportId: null,
    references: [
      {
        sourceKind: "production",
        sourceId: id,
        sourceVersion: 0,
        fieldPath: `/production/${id}`,
        contentHash: "b".repeat(64),
      },
    ],
    productionSourceBasis: {
      projectId,
      id,
      kind: "scene",
      version: 0,
      contentHash: target.sourceFingerprint,
      recordContentHash: "c".repeat(64),
      ancestors: [],
    },
  },
  content: {
    summary: "实际冻结表达的受控模型声明，不是文学质量证明。",
    reviewedDimensions: ["causality"],
    reviewedSources: [
      { sourceId: id, sourceVersion: 0, fieldPath: `/production/${id}` },
    ],
    issues: [],
  },
  dispositions: [],
  sourceSnapshotId: other,
  runIds: [other],
  engineKind: "codex",
  usage: { state: "unknown" },
  isCurrent: false,
  sourceState: "current",
  staleReasons: [],
  blockers: [],
  createdAt: at,
  updatedAt: at,
};
function client(reply: unknown) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return Response.json(reply);
    },
    openEventStream: async () => new Response(),
  }).narrativeQuality;
  return { sdk, calls };
}
test("quality SDK reads exact source-fingerprinted reports and accepts the original five-kind historical basis without upgrading it", async () => {
  const { sdk, calls } = client(report);
  expect(await sdk.get(id)).toEqual(report);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.body).toBeNull();
  expect(calls[0]!.headers.has("Idempotency-Key")).toBe(false);
  const legacy = structuredClone(report);
  legacy.basis.request.target = { kind: "chapter", id, version: 0 };
  delete legacy.basis.productionSourceBasis;
  legacy.basis.references[0]!.sourceKind = "chapter";
  legacy.basis.references[0]!.fieldPath = `/chapters/${id}`;
  delete legacy.content.reviewedSources;
  expect(await client(legacy).sdk.get(id)).toEqual(legacy);
});
test("quality SDK rejects substituted report IDs, foreign source identity and same-version fingerprint mismatches in one read without latest fallback", async () => {
  for (const edit of [
    (value: NarrativeQualityReport) => {
      value.id = other;
    },
    (value: NarrativeQualityReport) => {
      value.basis.productionSourceBasis!.projectId = other;
    },
    (value: NarrativeQualityReport) => {
      value.basis.productionSourceBasis!.id = other;
    },
    (value: NarrativeQualityReport) => {
      value.basis.productionSourceBasis!.contentHash = "d".repeat(64);
    },
    (value: NarrativeQualityReport) => {
      delete value.basis.productionSourceBasis;
    },
    (value: NarrativeQualityReport) => {
      delete value.basis.request.target.sourceFingerprint;
    },
  ]) {
    const changed = structuredClone(report);
    edit(changed);
    const { sdk, calls } = client(changed);
    await expect(sdk.get(id)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
});
test("quality SDK keeps catalogs body-free, source-fingerprinted and unique and refuses foreign, duplicate or bad-cursor report pages", async () => {
  const catalog = {
    targets: [{ target, title: "独立保存场景" }],
    unavailable: [],
  };
  const { sdk, calls } = client(catalog);
  expect(await sdk.sources(projectId)).toEqual(catalog);
  expect(calls).toHaveLength(1);
  for (const value of [
    { ...catalog, payload: "PRIVATE" },
    { ...catalog, targets: [{ ...catalog.targets[0], content: "PRIVATE" }] },
    {
      ...catalog,
      targets: [
        {
          target: { ...target, payload: "PRIVATE" },
          title: "不能隐式外发正文",
        },
      ],
    },
    { ...catalog, targets: [catalog.targets[0], catalog.targets[0]] },
    {
      ...catalog,
      targets: [
        {
          target: { ...target, sourceFingerprint: undefined },
          title: "缺指纹",
        },
      ],
    },
  ])
    await expect(client(value).sdk.sources(projectId)).rejects.toThrow();
  expect(
    await client({ items: [report], nextCursor: id }).sdk.list(
      projectId,
      undefined,
      1,
    ),
  ).toEqual({ items: [report], nextCursor: id });
  for (const value of [
    { items: [{ ...report, projectId: other }] },
    { items: [report, report] },
    { items: [report], nextCursor: other },
    { items: [], nextCursor: id },
  ]) {
    const { sdk, calls } = client(value);
    await expect(sdk.list(projectId)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
  const failed = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async () =>
      Response.json(
        {
          status: 503,
          title: "source unavailable",
          code: "UNAVAILABLE",
          traceId: other,
        },
        { status: 503 },
      ),
    openEventStream: async () => new Response(),
  }).narrativeQuality;
  await expect(failed.sources(projectId)).rejects.toThrow();
});
