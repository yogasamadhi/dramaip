import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { createStudioClient } from "@dramaip/client";
import {
  EpisodeSourceRevisionSchema,
  EpisodeSourceRevisionSummarySchema,
  EpisodeSourceRevisionContextSchema,
  type EpisodeSourceRevisionConfirmation,
} from "@dramaip/contracts/production";

// Contract-only shapes. These are not actual model, manuscript or quality evidence.
const uuid = (n: number) =>
  `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const id = uuid(1),
  projectId = uuid(6),
  sourceScript = { id: uuid(2), version: 1 },
  sourceOutline = { id: uuid(3), version: 1 },
  hash = "a".repeat(64);
const request = {
  direct: {
    entryPath: "inspiration" as const,
    project: { id: projectId, version: 1 },
    authorIntent: { id: uuid(8), version: 1 },
    episode: { id: uuid(9), version: 0 },
    durationSeconds: 90,
  },
  episodeId: uuid(9),
  baseOutlineId: sourceOutline.id,
};
const storyReference = {
  sourceKind: "project" as const,
  sourceId: projectId,
  sourceVersion: 1,
  fieldPath: "/project",
};
const outlineContent = {
  title: "契约测试大纲",
  logline: "测试",
  goal: "测试",
  mainConflict: "测试",
  turningPoint: "测试",
  endingHook: "测试",
  scenes: [
    {
      id: "scene",
      orderIndex: 0,
      location: "书房",
      timeOfDay: "夜",
      goal: "测试",
      conflict: "测试",
      outcome: "测试",
      characters: ["林晚"],
      durationSeconds: 90,
      sourceChapters: [],
      sourceReferences: [storyReference],
      beats: [{ id: "beat", action: "测试动作", causalLink: "测试因果" }],
    },
  ],
};
const sceneLinks = [{ sceneId: "scene", blockIds: [uuid(10), uuid(11)] }];
const input = {
  sourceVersion: 1,
  outline: sourceOutline,
  documentVersion: 0,
  request,
  tokenBudget: 60_000,
  outlineContent,
  sceneLinks,
};
const value = EpisodeSourceRevisionSchema.parse({
  id,
  projectId,
  episodeId: request.episodeId,
  sourceScript,
  sourceOutline,
  document: { id: uuid(4), scriptId: uuid(5), version: 0 },
  scriptRecordVersion: 0,
  scriptRecordHash: hash,
  title: "契约测试稿件",
  input,
  outlineContent,
  scriptContent: {
    blocks: [
      { id: uuid(10), type: "scene_heading", text: "INT. 书房 - NIGHT" },
      { id: uuid(11), type: "action", text: "测试动作" },
    ],
    sceneLinks,
  },
  outlineContentHash: hash,
  scriptContentHash: hash,
  sourceBasisHash: hash,
  outlineBasis: {
    request,
    authorIntent: request.direct.authorIntent,
    chapters: [],
    episode: {
      sourcePath: "direct-script",
      ...request.direct.episode,
      title: "契约测试",
      orderIndex: 0,
      durationSeconds: 90,
    },
    references: [
      storyReference,
      ...[8, 9, 14].map((n) => ({
        sourceKind: "production",
        sourceId: uuid(n),
        sourceVersion: 1,
        fieldPath: `/production/${uuid(n)}`,
      })),
    ].map((ref) => ({ ...ref, contentHash: hash })),
  },
  sourceSnapshotId: uuid(7),
  sourceManifestHash: hash,
  sourcePromptHash: hash,
  policyDependencies: [],
  status: "pending",
  stateVersion: 0,
  sourceState: "current",
  staleReasons: [],
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
});
const summary = EpisodeSourceRevisionSummarySchema.parse({
  id,
  projectId,
  episodeId: value.episodeId,
  sourceScript,
  sourceOutline,
  document: value.document,
  status: "pending",
  stateVersion: 0,
  sourceState: "current",
  staleReasons: [],
  createdAt: value.createdAt,
  updatedAt: value.updatedAt,
});
const confirmation: EpisodeSourceRevisionConfirmation = {
  currentSourcesReviewed: true,
  outlineReviewed: true,
  actualDocumentReviewed: true,
  sceneMappingReviewed: true,
  retainedManuscriptReviewed: true,
};
function client(reply: unknown, fail = false) {
  const calls: Array<{
    path: string;
    method: string;
    body?: unknown;
    match?: string | null;
    key?: string | null;
  }> = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    openEventStream: async () => new Response(),
    fetch: async (input, init) => {
      const req = new Request(input, init),
        url = new URL(req.url);
      calls.push({
        path: url.pathname + url.search,
        method: req.method,
        ...(req.method === "POST"
          ? {
              body: await req.clone().json(),
              match: req.headers.get("If-Match"),
              key: req.headers.get("Idempotency-Key"),
            }
          : {}),
      });
      if (fail) throw new Error("actual source owner unavailable");
      return Response.json(reply);
    },
  });
  return { sdk: sdk.episodeDevelopments, calls };
}
test("source revision SDK binds full original request budget actual document and exact original pair without fallback", async () => {
  const good = client(value);
  expect(
    await good.sdk.previewSourceRevision(
      sourceScript.id,
      input,
      "original-key",
    ),
  ).toEqual(value);
  expect(good.calls).toEqual([
    {
      path: `/api/v2/episode-development/${sourceScript.id}/source-revision-previews`,
      method: "POST",
      body: input,
      match: '"1"',
      key: "original-key",
    },
  ]);
  expect(await client(value).sdk.getSourceRevision(id)).toEqual(value);
  for (const reply of [
    { ...value, sourceScript: { ...sourceScript, id: uuid(20) } },
    { ...value, input: { ...input, tokenBudget: input.tokenBudget + 1 } },
    {
      ...value,
      document: { ...value.document, version: 1 },
      input: { ...input, documentVersion: 1 },
    },
    { ...value, sourcePromptHash: undefined },
    { ...value, workflowId: uuid(20) },
  ]) {
    const bad = client(reply);
    await expect(
      bad.sdk.previewSourceRevision(sourceScript.id, input, "original-key"),
    ).rejects.toThrow();
    expect(bad.calls).toHaveLength(1);
  }
  const wrong = client({ ...value, id: uuid(20) });
  await expect(wrong.sdk.getSourceRevision(id)).rejects.toThrow();
  expect(wrong.calls).toHaveLength(1);
});
test("source body SDK checks complete actual bytes and the exact original revision frame without extra sources or fallback", async () => {
  const expected = structuredClone(value);
  const entries = expected.outlineBasis.references.map((ref, index) => {
    const body = {
      selected: `实际表达 ${index}`,
      text: "契约夹具，不是实际文学质量证据",
    };
    const contentHash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("hex");
    ref.contentHash = contentHash;
    return { ...ref, value: body };
  });
  const context = EpisodeSourceRevisionContextSchema.parse({
    ...Object.fromEntries(
      [
        "id",
        "projectId",
        "episodeId",
        "sourceScript",
        "sourceOutline",
        "document",
        "stateVersion",
        "status",
        "sourceBasisHash",
        "sourceSnapshotId",
        "sourceManifestHash",
        "sourcePromptHash",
      ].map((key) => [key, expected[key as keyof typeof expected]]),
    ),
    tokenBudget: expected.input.tokenBudget,
    entries,
  });
  const good = client(context);
  expect(await good.sdk.getSourceRevisionContext(expected)).toEqual(context);
  expect(good.calls).toEqual([
    {
      path: `/api/v2/episode-source-revisions/${id}/source-context`,
      method: "GET",
    },
  ]);
  for (const raw of [
    { ...context, id: uuid(20) },
    { ...context, projectId: uuid(20) },
    { ...context, sourceScript: { ...sourceScript, version: 2 } },
    { ...context, document: { ...context.document, version: 1 } },
    { ...context, stateVersion: 1 },
    { ...context, status: "discarded" },
    { ...context, sourceBasisHash: "b".repeat(64) },
    { ...context, sourceSnapshotId: uuid(20) },
    { ...context, sourceManifestHash: "b".repeat(64) },
    { ...context, sourcePromptHash: "b".repeat(64) },
    { ...context, tokenBudget: context.tokenBudget + 1 },
    { ...context, entries: entries.slice(1) },
    { ...context, entries: [...entries].reverse() },
    { ...context, entries: [...entries, entries[0]] },
    {
      ...context,
      entries: entries.map((entry, index) =>
        index ? entry : { ...entry, value: "wrong actual body" },
      ),
    },
    {
      ...context,
      entries: entries.map((entry, index) =>
        index ? entry : { ...entry, policyDependencies: [] },
      ),
    },
    { ...context, finalPrompt: "PRIVATE old body" },
  ]) {
    const bad = client(raw);
    await expect(bad.sdk.getSourceRevisionContext(expected)).rejects.toThrow();
    expect(bad.calls).toHaveLength(1);
  }
  const stale = client(context);
  await expect(
    stale.sdk.getSourceRevisionContext({
      ...expected,
      sourceState: "stale",
      staleReasons: ["changed"],
    }),
  ).rejects.toThrow();
  expect(stale.calls).toEqual([]);
  const unavailable = client(context, true);
  await expect(
    unavailable.sdk.getSourceRevisionContext(expected),
  ).rejects.toThrow();
  expect(unavailable.calls).toHaveLength(1);
});
test("source revision summary SDK refuses private body foreign project duplicate cursor and invented decisions", async () => {
  const reply = { items: [summary], nextCursor: id },
    good = client(reply);
  expect(await good.sdk.sourceRevisionSummaries(projectId, id)).toEqual(reply);
  expect(good.calls).toEqual([
    {
      path: `/api/v2/projects/${projectId}/episode-source-revision-summaries?cursor=${id}`,
      method: "GET",
    },
  ]);
  for (const raw of [
    { items: [{ ...summary, projectId: uuid(20) }] },
    { items: [summary, summary] },
    { items: [summary], nextCursor: projectId },
    { items: [{ ...summary, outlineContent }] },
    {
      items: [
        { ...summary, sourceState: "current", staleReasons: ["unknown"] },
      ],
    },
    { items: [{ ...summary, status: "adopted" }] },
    {
      items: [
        {
          ...summary,
          status: "adopted",
          results: { outline: sourceOutline, script: sourceScript },
        },
      ],
    },
  ]) {
    const bad = client(raw);
    await expect(bad.sdk.sourceRevisionSummaries(projectId)).rejects.toThrow();
    expect(bad.calls).toHaveLength(1);
  }
  const missing = client(reply, true);
  await expect(
    missing.sdk.sourceRevisionSummaries(projectId),
  ).rejects.toThrow();
  expect(missing.calls).toHaveLength(1);
  expect(
    await client({ items: [value], nextCursor: id }).sdk.listSourceRevisions(
      projectId,
      id,
      1,
    ),
  ).toEqual({ items: [value], nextCursor: id });
  await expect(
    client({
      items: [{ ...value, projectId: uuid(20) }],
    }).sdk.listSourceRevisions(projectId),
  ).rejects.toThrow();
});
test("source revision adoption requires five literal reviews before network and exact human decision receipt", async () => {
  for (const field of Object.keys(confirmation)) {
    const bad = client({});
    await expect(
      bad.sdk.adoptSourceRevision(
        id,
        0,
        { ...confirmation, [field]: false },
        "original-key",
      ),
    ).rejects.toThrow();
    expect(bad.calls).toEqual([]);
  }
  const adopted = {
    ...value,
    status: "adopted" as const,
    stateVersion: 1,
    confirmation,
    results: {
      outline: { id: uuid(12), version: 2 },
      script: { id: uuid(13), version: 2 },
    },
  };
  const good = client(adopted);
  expect(
    await good.sdk.adoptSourceRevision(id, 0, confirmation, "original-key"),
  ).toEqual(adopted);
  expect(good.calls).toEqual([
    {
      path: `/api/v2/episode-source-revisions/${id}/adopt`,
      method: "POST",
      body: { stateVersion: 0, confirmation },
      match: '"0"',
      key: "original-key",
    },
  ]);
  await expect(
    client(value).sdk.adoptSourceRevision(id, 0, confirmation, "original-key"),
  ).rejects.toThrow();
  await expect(
    client({ ...adopted, stateVersion: 2 }).sdk.adoptSourceRevision(
      id,
      0,
      confirmation,
      "original-key",
    ),
  ).rejects.toThrow();
});
test("source revision discard preserves original key version and refuses a mismatched receipt", async () => {
  const discarded = { ...value, status: "discarded" as const, stateVersion: 1 },
    good = client(discarded);
  expect(await good.sdk.discardSourceRevision(id, 0, "original-key")).toEqual(
    discarded,
  );
  expect(good.calls).toEqual([
    {
      path: `/api/v2/episode-source-revisions/${id}/discard`,
      method: "POST",
      body: { stateVersion: 0 },
      match: '"0"',
      key: "original-key",
    },
  ]);
  await expect(
    client(value).sdk.discardSourceRevision(id, 0, "original-key"),
  ).rejects.toThrow();
});
