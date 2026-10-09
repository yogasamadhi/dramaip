import { expect, test } from "bun:test";
import { createStudioClient } from "@dramaip/client";
import type { StoryAssertion } from "@dramaip/contracts/knowledge";

const projectId = "30000000-0000-4000-8000-000000000001",
  id = "30000000-0000-4000-8000-000000000002",
  chapterId = "30000000-0000-4000-8000-000000000003",
  characterId = "30000000-0000-4000-8000-000000000004",
  targetId = "30000000-0000-4000-8000-000000000005",
  recordId = "30000000-0000-4000-8000-000000000006";
const at = "2026-10-03T00:00:00.000Z";
const selection = {
  kind: "paragraphs" as const,
  chapterId,
  chapterVersion: 0,
  chapterContentHash: "a".repeat(64),
  paragraphIds: ["actual-paragraph"],
};
const node = (id: string, kind: "character" | "secret") => ({
  id,
  projectId,
  kind,
  title: "实际节点",
  summary: "节点解释不是原文",
  sourceType: "manual",
  sourceId: projectId,
  sourceVersion: 0,
  confirmed: true,
  version: 0,
  createdAt: at,
  updatedAt: at,
});
const original: StoryAssertion = {
  id,
  projectId,
  version: 0,
  status: "pending",
  input: {
    kind: "relationship",
    title: "实际关系",
    statement: "作者关系解释",
    interpretation: "author-inferred",
    from: { id: characterId, version: 0 },
    to: { id: targetId, version: 0 },
    relation: "reveals",
    confidence: 0.7,
    sources: [selection],
  },
  basis: {
    format: "source-anchored-story-assertion-v1",
    projectId,
    fingerprint: "b".repeat(64),
    interpretationPolicy: "human-reviewed-not-semantic-or-calibrated-proof",
    sourceBasis: {
      format: "source-anchored-story-declaration-v1",
      projectId,
      fingerprint: "c".repeat(64),
      evidencePolicy: "exact-source-identity-not-semantic-verification",
      sources: [
        {
          selection,
          text: "实际原文",
          quote: "实际原文",
          quoteHash: "d".repeat(64),
          anchors: [{ start: 0, end: 4, paragraphIds: selection.paragraphIds }],
        },
      ],
      policyDependencies: [
        {
          sourceId: chapterId,
          sourceVersion: 0,
          fieldPath: `/chapters/${chapterId}`,
        },
      ],
    },
    nodes: [node(characterId, "character"), node(targetId, "secret")],
    policyDependencies: [
      {
        sourceId: chapterId,
        sourceVersion: 0,
        fieldPath: `/chapters/${chapterId}`,
      },
      {
        sourceId: characterId,
        sourceVersion: 0,
        fieldPath: `/story-declarations/nodes/${characterId}`,
      },
      {
        sourceId: targetId,
        sourceVersion: 0,
        fieldPath: `/story-declarations/nodes/${targetId}`,
      },
    ],
  },
  sourceStatus: { state: "current", reasons: [] },
  etag: `"${"e".repeat(64)}"`,
  createdAt: at,
  updatedAt: at,
};
const adoption = {
  sourceFingerprint: original.basis.fingerprint,
  confirmedSourceReview: true as const,
  confirmedInterpretationReview: true as const,
};
const applied: StoryAssertion = {
  ...original,
  version: 1,
  status: "adopted",
  adoptedRecord: { kind: "edge", id: recordId, version: 0 },
};
function client(reply: (request: Request) => unknown) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return Response.json(reply(request));
    },
    openEventStream: async () => new Response(),
  }).storyAssertions;
  return { sdk, calls };
}
test("assertion SDK preserves exact source/node versions, double review, original request keys and If-Match without creating a latest snapshot", async () => {
  const { sdk, calls } = client((request) =>
    new URL(request.url).pathname.endsWith("/adopt") ? applied : original,
  );
  expect(
    await sdk.create(projectId, original.input, "original-create-key"),
  ).toEqual(original);
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.headers.get("Idempotency-Key")).toBe("original-create-key");
  expect(
    await sdk.adopt(projectId, original, adoption, "original-adopt-key"),
  ).toEqual(applied);
  expect(calls[1]!.headers.get("If-Match")).toBe(original.etag);
  expect(calls[1]!.headers.get("Idempotency-Key")).toBe("original-adopt-key");
  expect(await calls[1]!.json()).toEqual(adoption);
  const read = client(() => original);
  expect(await read.sdk.get(projectId, id)).toEqual(original);
  expect(read.calls[0]!.method).toBe("GET");
  expect(read.calls[0]!.headers.has("Idempotency-Key")).toBe(false);
  const before = calls.length;
  await expect(
    sdk.adopt(
      projectId,
      { ...original, sourceStatus: { state: "stale", reasons: ["原文已变"] } },
      adoption,
      "cannot-adopt",
    ),
  ).rejects.toThrow();
  await expect(sdk.create(projectId, original.input, " ")).rejects.toThrow();
  expect(calls).toHaveLength(before);
});
test("assertion SDK rejects wrong projects, frozen selections, endpoint versions/confirmation/order and mismatched adopted record kind", async () => {
  for (const corrupt of [
    { ...original, projectId: chapterId },
    {
      ...original,
      basis: {
        ...original.basis,
        sourceBasis: { ...original.basis.sourceBasis, projectId: chapterId },
      },
    },
    {
      ...original,
      basis: {
        ...original.basis,
        sourceBasis: {
          ...original.basis.sourceBasis,
          sources: [
            {
              ...original.basis.sourceBasis.sources[0]!,
              selection: { ...selection, paragraphIds: ["substitute"] },
            },
          ],
        },
      },
    },
    {
      ...original,
      basis: { ...original.basis, nodes: [...original.basis.nodes].reverse() },
    },
    {
      ...original,
      basis: {
        ...original.basis,
        nodes: original.basis.nodes.map((node, index) =>
          index ? node : { ...node, version: 1 },
        ),
      },
    },
    {
      ...original,
      basis: {
        ...original.basis,
        nodes: original.basis.nodes.map((node, index) =>
          index ? node : { ...node, confirmed: false },
        ),
      },
    },
    {
      ...applied,
      adoptedRecord: { ...applied.adoptedRecord!, kind: "cognition" },
    },
    { ...original, adoptedRecord: applied.adoptedRecord },
    { ...original, basis: { ...original.basis, policyDependencies: [] } },
  ])
    await expect(
      client(() => corrupt).sdk.get(projectId, id),
    ).rejects.toThrow();
});
test("assertion SDK binds actual character or explicit audience cognition without treating arbitrary subjects as character nodes", async () => {
  const cognition: StoryAssertion = {
    ...original,
    input: {
      kind: "cognition",
      title: "角色怀疑",
      statement: "这是作者认知解释",
      interpretation: "source-stated",
      subject: { kind: "character", node: { id: characterId, version: 0 } },
      target: { id: targetId, version: 0 },
      storyOrder: 3,
      state: "suspects",
      sources: [selection],
    },
    basis: {
      ...original.basis,
      nodes: [node(targetId, "secret"), node(characterId, "character")],
    },
  };
  expect(
    await client(() => cognition).sdk.create(
      projectId,
      cognition.input,
      "cognition-key",
    ),
  ).toEqual(cognition);
  const wrong = {
    ...cognition,
    basis: {
      ...cognition.basis,
      nodes: cognition.basis.nodes.map((node) => ({ ...node, kind: "secret" })),
    },
  };
  await expect(client(() => wrong).sdk.get(projectId, id)).rejects.toThrow();
  const audience: StoryAssertion = {
    ...cognition,
    input: {
      ...cognition.input,
      kind: "cognition",
      subject: { kind: "audience", id: "观众A" },
      target: { id: targetId, version: 0 },
      storyOrder: 3,
      state: "knows",
    },
    basis: { ...original.basis, nodes: [node(targetId, "secret")] },
  };
  expect(await client(() => audience).sdk.get(projectId, id)).toEqual(audience);
});
test("assertion SDK keeps metadata cursor and exact discarded history; it rejects duplicate or foreign history without initializing sources", async () => {
  const { input, basis, etag: _etag, ...metadata } = original;
  const item = {
    ...metadata,
    title: input.title,
    kind: input.kind,
    sourceFingerprint: basis.fingerprint,
  };
  const page = { projectId, items: [item], nextCursor: id };
  const good = client(() => page);
  expect(
    await good.sdk.list(projectId, { limit: 1, cursor: recordId }),
  ).toEqual(page);
  expect(good.calls[0]!.method).toBe("GET");
  expect(good.calls[0]!.url).toContain(`cursor=${recordId}`);
  const adoptedItem = {
    ...item,
    status: "adopted",
    version: 1,
    adoptedRecord: applied.adoptedRecord,
  };
  expect(
    await client(() => ({ projectId, items: [adoptedItem] })).sdk.list(
      projectId,
    ),
  ).toMatchObject({ items: [adoptedItem] });
  for (const bad of [
    { ...page, items: [item, item] },
    { ...page, nextCursor: recordId },
    { ...page, items: [{ ...item, projectId: chapterId }] },
    { ...page, items: [{ ...item, status: "adopted" }] },
    { ...page, items: [{ ...item, adoptedRecord: applied.adoptedRecord }] },
    {
      ...page,
      items: [
        {
          ...adoptedItem,
          adoptedRecord: { ...applied.adoptedRecord!, kind: "cognition" },
        },
      ],
    },
  ])
    await expect(client(() => bad).sdk.list(projectId)).rejects.toThrow();
  const discarded: StoryAssertion = {
    ...original,
    version: 1,
    status: "discarded",
  };
  const discard = client(() => discarded);
  expect(
    await discard.sdk.discard(projectId, original, "original-discard-key"),
  ).toEqual(discarded);
  expect(discard.calls[0]!.headers.get("If-Match")).toBe(original.etag);
  await expect(
    discard.sdk.discard(projectId, applied, "not-pending"),
  ).rejects.toThrow();
});
