import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import {
  ProductionRecordMergeRequestSchema,
  type ProductionRecordMergeComparison,
} from "@dramaip/contracts/production";

const projectId = "90000000-0000-4000-8000-000000000001";
const id = "90000000-0000-4000-8000-000000000002";
const other = "90000000-0000-4000-8000-000000000003";
const chapter = {
  id,
  version: 0,
  title: "Contract-only fixture, not a real manuscript",
  orderIndex: 0,
  contentHash: "a".repeat(64),
  characters: 10,
};
const catalog = {
  projectId,
  seasonPlan: { id: other, version: 1 },
  narrativeSourceScope: [chapter],
  episodes: [],
  storyBibleCount: 1,
  currentResults: [],
};
function client(reply: unknown, fail = false) {
  const calls: {
    path: string;
    method: string;
    body?: unknown;
    match?: string | null;
    key?: string | null;
  }[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    openEventStream: async () => new Response(),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      calls.push({
        path: `${url.pathname}${url.search}`,
        method: request.method,
        ...(request.method === "POST"
          ? {
              body: await request.clone().json(),
              match: request.headers.get("If-Match"),
              key: request.headers.get("Idempotency-Key"),
            }
          : {}),
      });
      if (fail) throw new Error("actual owner read failed");
      return Response.json(reply);
    },
  });
  return { calls, sdk: sdk.episodeDevelopments };
}
test("actual-record comparison SDK strictly reads one frozen scope without a latest/cache fallback", async () => {
  const hash = "a".repeat(64),
    ref = { id, version: 1 };
  const shape = {
    frozenVersion: 0,
    currentVersion: 0,
    frozenHash: hash,
    currentHash: hash,
    orderIndex: 0,
    editable: true,
  };
  const reply: ProductionRecordMergeComparison = {
    format: "storyboard-record-field-comparison-v1",
    projectId,
    episodeId: "pilot",
    workflow: ref,
    base: ref,
    candidateHash: hash,
    frozenBasisHash: hash,
    contextHash: hash,
    comparisonHash: hash,
    semanticVerification: "unverified",
    automaticCommit: false,
    records: [
      { ...shape, id, kind: "scenes", stableId: "scene", parentId: projectId },
      { ...shape, id: other, kind: "shots", stableId: "shot", parentId: id },
    ],
    units: [
      {
        recordId: id,
        kind: "scenes" as const,
        fields: ["title", "场景动作"] as const,
      },
      {
        recordId: other,
        kind: "shots" as const,
        fields: [
          "title",
          "镜头描述",
          "构图",
          "机位",
          "运镜",
          "生成提示",
          "负面提示",
          "声音",
        ] as const,
      },
    ].flatMap((item) =>
      item.fields.map((field) => ({
        id: `${item.recordId}:${field}`,
        recordId: item.recordId,
        kind: item.kind,
        field,
        base: { state: "text" as const, text: "原实际值", hash },
        current: { state: "text" as const, text: "原实际值", hash },
        candidate: { state: "text" as const, text: "原实际值", hash },
        conflict: false,
        defaultChoice: "branch" as const,
      })),
    ),
  };
  const expected = {
    projectId,
    episodeId: "pilot",
    workflowVersion: 1,
    base: ref,
  };
  const good = client(reply);
  expect(await good.sdk.compareRecords(id, expected)).toEqual(reply);
  expect(good.calls).toEqual([
    { path: `/api/v2/workflows/creation/${id}/record-merge`, method: "GET" },
  ]);
  const first = "92000000-0000-4000-8000-000000000001",
    added = "92000000-0000-4000-8000-000000000002";
  const structure = {
    receipt: {
      base: ref,
      baseContentHash: hash,
      previousScript: ref,
      scope:
        "confirmed-block-structure-fixed-shots-duration-assets-v1" as const,
      semanticVerification: "unverified" as const,
      shots: [{ shotId: "shot", recordId: other, version: 0 }],
      sceneMappings: [
        {
          sceneId: "scene",
          previousBlockIds: [first],
          currentBlockIds: [first, added],
        },
      ],
    },
    script: { id: added, version: 2 },
    scriptRecordId: projectId,
    documentVersion: 1,
  };
  const mapped = {
    ...reply,
    format: "storyboard-record-field-comparison-v2" as const,
    structure,
    structureHash: hash,
  };
  const confirmedStructure = {
    receipt: structure.receipt,
    script: structure.script,
    documentVersion: structure.documentVersion,
  };
  await expect(client(mapped).sdk.compareRecords(id, expected)).rejects.toThrow(
    "实际字段比较",
  );
  expect(
    await client(mapped).sdk.compareRecords(id, {
      ...expected,
      confirmedStructure,
    }),
  ).toEqual(mapped);
  await expect(
    client(reply).sdk.compareRecords(id, { ...expected, confirmedStructure }),
  ).rejects.toThrow("实际字段比较");
  await expect(
    client(mapped).sdk.compareRecords(id, {
      ...expected,
      confirmedStructure: { ...confirmedStructure, documentVersion: 9 },
    }),
  ).rejects.toThrow("实际字段比较");
  const plannedStructure = {
    ...structure,
    receipt: {
      ...structure.receipt,
      scope: "author-frozen-scene-shot-plan-v1" as const,
      sceneMappings: [],
      scenePlans: [
        {
          sceneId: "scene",
          recordId: id,
          version: 0,
          shots: [
            {
              id: first,
              orderIndex: 0,
              durationSeconds: 30,
              assetIds: ["lin"],
            },
          ],
        },
      ],
    },
  };
  const planned = {
    ...reply,
    format: "storyboard-record-field-comparison-v3" as const,
    structure: plannedStructure,
    structureHash: hash,
    records: reply.records.map((record) => ({
      ...record,
      editable: record.kind === "scenes",
    })),
    units: reply.units.filter((unit) => unit.kind === "scenes"),
  };
  const confirmedShotPlan = {
    receipt: plannedStructure.receipt,
    script: plannedStructure.script,
    documentVersion: plannedStructure.documentVersion,
  };
  expect(
    await client(planned).sdk.compareRecords(id, {
      ...expected,
      confirmedShotPlan,
    }),
  ).toEqual(planned);
  for (const wrong of [
    expected,
    { ...expected, confirmedStructure },
    {
      ...expected,
      confirmedShotPlan: { ...confirmedShotPlan, documentVersion: 99 },
    },
    {
      ...expected,
      confirmedShotPlan: {
        ...confirmedShotPlan,
        receipt: {
          ...confirmedShotPlan.receipt,
          scenePlans: [
            { ...confirmedShotPlan.receipt.scenePlans[0]!, version: 9 },
          ],
        },
      },
    },
  ])
    await expect(client(planned).sdk.compareRecords(id, wrong)).rejects.toThrow(
      "实际字段比较",
    );
  await expect(
    client(reply).sdk.compareRecords(id, { ...expected, confirmedShotPlan }),
  ).rejects.toThrow("实际字段比较");
  await expect(
    client(mapped).sdk.compareRecords(id, {
      ...expected,
      confirmedStructure,
      confirmedShotPlan,
    }),
  ).rejects.toThrow("实际字段比较");
  const input = ProductionRecordMergeRequestSchema.parse({
    format: "storyboard-record-field-merge-request-v1",
    projectId,
    episodeId: id,
    workflow: ref,
    base: ref,
    comparisonHash: hash,
    choices: Object.fromEntries(reply.units.map((unit) => [unit.id, "main"])),
    reviewed: true,
    modelDisclosureConfirmed: true,
  });
  const direct = {
    entryPath: "inspiration",
    project: { id: projectId, version: 0 },
    authorIntent: ref,
    episode: { id, version: 0 },
    durationSeconds: 90,
  };
  const request = { direct, episodeId: id };
  const rawReceipt = {
    id: other,
    taskId: other,
    input: {
      projectId,
      operation: "storyboard-package",
      instruction: "Only a SDK contract fixture, not a model request",
      engineKind: "codex",
      episodeDevelopmentRequest: request,
    },
    stage: "awaiting-review",
    version: 5,
    sourceWorkflowId: id,
    recordMergeSource: {
      format: "storyboard-record-field-merge-v1",
      request: input,
      comparison: { ...reply, episodeId: id },
      outputHash: hash,
    },
    episodeDevelopmentBasis: {
      request,
      authorIntent: ref,
      episode: {
        sourcePath: "direct-script",
        id,
        version: 0,
        title: "Only a SDK contract fixture",
        orderIndex: 0,
        durationSeconds: 90,
      },
      chapters: [],
      references: [
        projectId,
        id,
        other,
        "90000000-0000-4000-8000-000000000004",
      ].map((sourceId) => ({
        sourceKind: "production",
        sourceId,
        sourceVersion: 0,
        fieldPath: `/production/${sourceId}`,
        contentHash: hash,
      })),
    },
    runIds: [],
    contextSnapshotIds: [],
    sources: [],
    preparedPrompt: "",
    issues: [],
    createdAt: "2026-10-03T00:00:00.000Z",
    updatedAt: "2026-10-03T00:00:00.000Z",
  };
  const mergedClient = client(rawReceipt),
    key = "original-key";
  expect((await mergedClient.sdk.mergeRecords(id, input, key)).id).toBe(other);
  expect(mergedClient.calls).toEqual([
    {
      path: `/api/v2/workflows/creation/${id}/record-rebase`,
      method: "POST",
      body: input,
      match: '"1"',
      key,
    },
  ]);
  for (const changed of [
    { ...rawReceipt, sourceWorkflowId: other },
    { ...rawReceipt, input: { ...rawReceipt.input, projectId: other } },
    { ...rawReceipt, recordMergeSource: undefined },
    {
      ...rawReceipt,
      recordMergeSource: {
        ...rawReceipt.recordMergeSource,
        request: {
          ...input,
          choices: Object.fromEntries(
            Object.keys(input.choices).map((unit) => [unit, "branch"]),
          ),
        },
      },
    },
  ])
    await expect(
      client(changed).sdk.mergeRecords(id, input, key),
    ).rejects.toThrow();
  await expect(
    client(rawReceipt, true).sdk.mergeRecords(id, input, key),
  ).rejects.toThrow();
  for (const bad of [
    { ...reply, projectId: other },
    { ...reply, episodeId: "other" },
    { ...reply, workflow: { ...ref, version: 2 } },
    { ...reply, workflow: { ...ref, id: other } },
    { ...reply, base: { ...ref, version: 2 } },
    { ...reply, units: [] },
    { ...reply, payload: { secret: "不能外发" } },
  ]) {
    const read = client(bad);
    await expect(read.sdk.compareRecords(id, expected)).rejects.toThrow();
    expect(read.calls).toHaveLength(1);
  }
  const broken = client(reply, true);
  await expect(broken.sdk.compareRecords(id, expected)).rejects.toThrow(
    "actual owner read failed",
  );
  expect(broken.calls).toHaveLength(1);
});
test("episode source SDK reads the exact project scope once and preserves legacy catalogs without an invented scope", async () => {
  const { sdk, calls } = client(catalog);
  expect(await sdk.sources(projectId)).toEqual(catalog);
  expect(calls).toEqual([
    {
      path: `/api/v2/projects/${projectId}/episode-development-sources`,
      method: "GET",
    },
  ]);
  const { narrativeSourceScope: _scope, ...legacy } = catalog;
  expect(await client(legacy).sdk.sources(projectId)).toEqual(legacy);
});
test("episode source SDK refuses foreign/duplicate/fabricated scope and propagates a real owner failure without cached or latest fallback", async () => {
  for (const reply of [
    { ...catalog, projectId: other },
    { ...catalog, narrativeSourceScope: [chapter, chapter] },
    { ...catalog, narrativeSourceScope: [{ ...chapter, version: -1 }] },
    {
      ...catalog,
      narrativeSources: {
        basis: {
          kind: "author-selected-narrative-sources",
          projectId: other,
          chapters: [],
          references: [],
          omitted: [],
        },
        chapters: [chapter],
      },
    },
    {
      ...catalog,
      narrativeSources: {
        basis: {
          kind: "author-selected-narrative-sources",
          projectId,
          chapters: [],
          references: [],
          omitted: [],
        },
        chapters: [{ ...chapter, version: 1 }],
      },
    },
    {
      ...catalog,
      direct: {
        entryPath: "inspiration",
        project: { id: other, version: 0 },
        episodes: [],
      },
    },
  ]) {
    const { sdk, calls } = client(reply);
    await expect(sdk.sources(projectId)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
  const { sdk, calls } = client(catalog, true);
  await expect(sdk.sources(projectId)).rejects.toThrow(
    "actual owner read failed",
  );
  expect(calls).toHaveLength(1);
});
test("episode history SDK refuses malformed results and an impossible cursor instead of returning an empty success", async () => {
  const { sdk, calls } = client({ items: [] });
  expect(await sdk.list(projectId, other, 20)).toEqual({ items: [] });
  expect(calls).toEqual([
    {
      path: `/api/v2/projects/${projectId}/episode-development?cursor=${other}&limit=20`,
      method: "GET",
    },
  ]);
  for (const reply of [
    { items: [], nextCursor: id },
    { items: [{ id, projectId: other }] },
    { items: "not-a-page" },
  ]) {
    const { sdk, calls } = client(reply);
    await expect(sdk.list(projectId)).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
  const exact = client({ id: other });
  await expect(exact.sdk.get(id)).rejects.toThrow();
  expect(exact.calls).toHaveLength(1);
  expect(exact.calls[0]!.path).toBe(`/api/v2/episode-development/${id}`);
});
