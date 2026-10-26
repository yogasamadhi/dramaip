import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import {
  NarrativeLocalQualitySourceSchema,
  NarrativeLocalQualityReviewSchema,
  NarrativeLocalQualitySummarySchema,
  type NarrativeLocalQualitySource,
  type NarrativeLocalQualityReview,
} from "@dramaip/contracts/creative-quality";
import {
  localEvidenceFields,
  localFieldKey,
  localHumanContent,
} from "./narrative-local-ui";
import { exactObjectReferenceKey } from "./exact-object-navigation";
const projectId = "61000000-0000-4000-8000-000000000001",
  id = "61000000-0000-4000-8000-000000000002",
  other = "61000000-0000-4000-8000-000000000003",
  at = "2026-10-05T00:00:00.000Z";
const source: NarrativeLocalQualitySource = {
  format: "narrative-local-review-source-v1",
  projectId,
  sourceFingerprint: "a".repeat(64),
  baseReviewId: null,
  basis: {
    request: {
      target: { kind: "chapter", id, version: 2 },
      dimensions: ["causality"],
    },
    references: [
      {
        sourceKind: "chapter",
        sourceId: id,
        sourceVersion: 2,
        fieldPath: `/chapters/${id}`,
        contentHash: "b".repeat(64),
      },
    ],
  },
  references: [
    {
      sourceKind: "chapter",
      sourceId: id,
      sourceVersion: 2,
      fieldPath: `/chapters/${id}`,
      sensitivity: "project",
      value: { title: "不是正文证据", content: "实际原文的逐字引文。" },
    },
  ],
};
const content = {
  summary: "作者评议声明，不是认证",
  reviewedDimensions: ["causality" as const],
  issues: [],
};
const value: NarrativeLocalQualityReview = {
  id: other,
  projectId,
  origin: "human-declared",
  version: 0,
  status: "awaiting-review",
  source,
  content,
  dispositions: [],
  qualityState: "unverified",
  isCurrent: false,
  sourceState: "current",
  sourceReasons: [],
  blockers: [],
  createdAt: at,
  updatedAt: at,
};
const input = {
  origin: "human-declared" as const,
  request: source.basis.request,
  sourceFingerprint: source.sourceFingerprint,
  baseReviewId: source.baseReviewId,
  confirmed: true as const,
  content,
};
function client(reply: unknown) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (raw, init) => {
      calls.push(new Request(raw, init));
      return Response.json(reply);
    },
    openEventStream: async () => new Response(),
  }).narrativeQuality;
  return { sdk, calls };
}
test("native SDK previews the exact original scope with no model/idempotency allocation and rejects foreign, changed or duplicated sources", async () => {
  const { sdk, calls } = client(source);
  expect(await sdk.localPreview(projectId, source.basis.request)).toEqual(
    source,
  );
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.headers.has("Idempotency-Key")).toBe(false);
  expect(await calls[0]!.clone().json()).toEqual(source.basis.request);
  for (const raw of [
    { ...source, projectId: other },
    {
      ...source,
      basis: {
        ...source.basis,
        request: {
          ...source.basis.request,
          target: { ...source.basis.request.target, version: 3 },
        },
      },
    },
    {
      ...source,
      references: [source.references[0], source.references[0]],
      basis: {
        ...source.basis,
        references: [source.basis.references[0], source.basis.references[0]],
      },
    },
  ]) {
    const check = client(raw);
    await expect(
      check.sdk.localPreview(projectId, source.basis.request),
    ).rejects.toThrow();
    expect(check.calls).toHaveLength(1);
  }
});
test("native record JSON is strict, retains full actual text and cannot certify quality or carry fake engine/model/run fields", async () => {
  expect(NarrativeLocalQualityReviewSchema.parse(value)).toEqual(value);
  for (const field of [
    "workflowId",
    "runIds",
    "engineKind",
    "model",
    "usage",
    "sourceSnapshotId",
  ]) {
    const bad = { ...value, [field]: field };
    expect(NarrativeLocalQualityReviewSchema.safeParse(bad).success).toBe(
      false,
    );
    await expect(client(bad).sdk.localGet(other)).rejects.toThrow();
  }
  expect(
    NarrativeLocalQualityReviewSchema.safeParse({
      ...value,
      qualityState: "verified",
    }).success,
  ).toBe(false);
  for (const raw of [undefined, NaN, Infinity, () => "not-json"]) {
    expect(
      NarrativeLocalQualitySourceSchema.safeParse({
        ...source,
        references: [{ ...source.references[0], value: raw }],
      }).success,
    ).toBe(false);
  }
  const full = "完整正文".repeat(20000);
  expect(
    NarrativeLocalQualitySourceSchema.parse({
      ...source,
      references: [{ ...source.references[0], value: { content: full } }],
    }).references[0]!.value,
  ).toEqual({ content: full });
});
test("native SDK rejects substituted original IDs and bad project pagination without latest fallback", async () => {
  const { sdk, calls } = client(value);
  expect(await sdk.localGet(other)).toEqual(value);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.body).toBeNull();
  await expect(client({ ...value, id }).sdk.localGet(other)).rejects.toThrow();
  for (const page of [
    {
      items: [
        { ...value, projectId: id, source: { ...source, projectId: id } },
      ],
    },
    { items: [value, value] },
    { items: [value], nextCursor: id },
    { items: [], nextCursor: other },
  ])
    await expect(client(page).sdk.localList(projectId)).rejects.toThrow();
});
test("native summaries are strict metadata with exact project, identity and cursor, never private text or fake model quality", async () => {
  const summary = {
    id: value.id,
    projectId,
    version: value.version,
    origin: value.origin,
    status: value.status,
    request: source.basis.request,
    sourceFingerprint: source.sourceFingerprint,
    qualityState: "unverified" as const,
    isCurrent: false,
    sourceState: "current" as const,
    sourceReasonCount: 0,
    issueCount: 0,
    openIssueCount: 0,
    blockerCount: 0,
    acceptedRiskCount: 0,
    resolvedIssueCount: 0,
    createdAt: at,
    updatedAt: at,
  };
  const page = { projectId, items: [summary], nextCursor: summary.id };
  const { sdk, calls } = client(page);
  expect(await sdk.localSummaries(projectId, id, 1)).toEqual(page);
  expect(calls[0]!.method).toBe("GET");
  expect(
    calls[0]!.url.endsWith(
      `/projects/${projectId}/narrative-local-review-summaries?cursor=${id}&limit=1`,
    ),
  ).toBe(true);
  expect(calls[0]!.body).toBeNull();
  for (const field of [
    "source",
    "content",
    "note",
    "dispositions",
    "references",
    "workflowId",
    "runIds",
    "model",
    "usage",
  ])
    expect(
      NarrativeLocalQualitySummarySchema.safeParse({
        ...summary,
        [field]: "PRIVATE",
      }).success,
    ).toBe(false);
  for (const bad of [
    { ...page, projectId: id },
    { ...page, items: [{ ...summary, projectId: id }] },
    { ...page, items: [summary, summary] },
    { ...page, nextCursor: id },
    { ...page, items: [] },
    { ...page, items: [{ ...summary, qualityState: "verified" }] },
    { ...page, items: [{ ...summary, issueCount: 1 }] },
    { ...page, items: [{ ...summary, blockerCount: 1 }] },
    { ...page, items: [{ ...summary, isCurrent: true }] },
  ])
    await expect(client(bad).sdk.localSummaries(projectId)).rejects.toThrow();
});

test("native create and decisions send explicit source head, CAS and original key and reject rebinding receipts", async () => {
  const { sdk, calls } = client(value);
  expect(await sdk.localCreate(projectId, input, "same-original-key")).toEqual(
    value,
  );
  expect(calls[0]!.headers.get("If-Match")).toBe(
    `"${source.sourceFingerprint}"`,
  );
  expect(calls[0]!.headers.get("Idempotency-Key")).toBe("same-original-key");
  expect(await calls[0]!.clone().json()).toEqual(input);
  await expect(
    client({
      ...value,
      source: { ...source, baseReviewId: id },
    }).sdk.localCreate(projectId, input, "original-key"),
  ).rejects.toThrow();
  const invalid = client(value);
  await expect(
    invalid.sdk.localCreate(
      projectId,
      { ...input, workflowId: id } as typeof input,
      "invalid",
    ),
  ).rejects.toThrow();
  expect(invalid.calls).toHaveLength(0);
  const decision = client(value);
  await decision.sdk.localDecide(
    other,
    { action: "adopt", version: 0, confirmed: true },
    "adopt-key",
  );
  expect(decision.calls[0]!.headers.get("If-Match")).toBe('"0"');
  expect(
    decision.calls[0]!.url.endsWith(
      `/narrative-local-reviews/${other}/decision`,
    ),
  ).toBe(true);
});
test("human form exposes only real target text fields and produces literal human evidence without pretending to be a model", () => {
  const fields = localEvidenceFields(source);
  expect(fields).toHaveLength(1);
  expect(fields[0]!.valuePath).toBe("/content");
  const draft = {
    id: "author-1",
    category: "causality" as const,
    severity: "error" as const,
    message: "作者发现问题",
    suggestion: "作者核对",
    field: localFieldKey(fields[0]!),
    quote: "逐字引文",
  };
  const result = localHumanContent(source, "作者声明", [draft]);
  expect(result.issues[0]).toMatchObject({
    source: "human",
    evidence: [
      {
        sourceId: id,
        sourceVersion: 2,
        valuePath: "/content",
        quote: "逐字引文",
      },
    ],
  });
  expect(() =>
    localHumanContent(source, "作者声明", [{ ...draft, quote: "虚构的引文" }]),
  ).toThrow();
  expect(() =>
    localHumanContent(source, "作者声明", [{ ...draft, field: "/title" }]),
  ).toThrow();
  expect(exactObjectReferenceKey(`?localReviewId=${id}`)).not.toBe(
    exactObjectReferenceKey(`?localReviewId=${other}`),
  );
});
