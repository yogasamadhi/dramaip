import { expect, test } from "bun:test";
import { createStudioClient } from "@dramaip/client";
import type { StoryDeclaration } from "@dramaip/contracts/knowledge";

const projectId = "20000000-0000-4000-8000-000000000001",
  id = "20000000-0000-4000-8000-000000000002",
  chapterId = "20000000-0000-4000-8000-000000000003",
  other = "20000000-0000-4000-8000-000000000004",
  nodeId = "20000000-0000-4000-8000-000000000005";
const at = "2026-10-03T00:00:00.000Z";
const selection = {
  kind: "paragraphs" as const,
  chapterId,
  chapterVersion: 0,
  chapterContentHash: "a".repeat(64),
  paragraphIds: ["actual-position-id"],
};
const original: StoryDeclaration = {
  id,
  projectId,
  version: 0,
  status: "pending",
  input: {
    kind: "event",
    title: "人工解释",
    statement: "来源不是语义证明",
    sources: [selection],
  },
  basis: {
    format: "source-anchored-story-declaration-v1",
    projectId,
    fingerprint: "b".repeat(64),
    evidencePolicy: "exact-source-identity-not-semantic-verification",
    sources: [
      {
        selection,
        text: "实际所选原文。",
        quote: "实际所选原文。",
        quoteHash: "c".repeat(64),
        anchors: [{ start: 0, end: 8, paragraphIds: selection.paragraphIds }],
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
  sourceStatus: { state: "current", reasons: [] },
  etag: `"${"d".repeat(64)}"`,
  createdAt: at,
  updatedAt: at,
};
const adoption = {
  sourceFingerprint: original.basis.fingerprint,
  confirmedSourceReview: true as const,
  confirmedInterpretationReview: true as const,
};
const active: StoryDeclaration = {
  ...original,
  status: "adopted",
  version: 1,
  adoptedNode: { id: nodeId, version: 0 },
  lifecycle: {
    state: "active",
    version: 0,
    record: { kind: "node", id: nodeId, version: 0 },
    transitions: [],
  },
};
const retirement = {
  lifecycleVersion: 0,
  record: active.lifecycle!.record,
  reason: "明确退役保留历史",
  confirmedRetirementReview: true as const,
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
  }).storyDeclarations;
  return { calls, sdk };
}
test("source lifecycle SDK writes exact original CAS and explicit reviews, keeps historical adoptions distinct from live retired state", async () => {
  const withdrawn: StoryDeclaration = {
    ...active,
    lifecycle: {
      state: "withdrawn",
      version: 1,
      record: { ...retirement.record, version: 1 },
      transitions: [
        {
          version: 1,
          action: "withdraw",
          reason: retirement.reason,
          createdAt: at,
        },
      ],
    },
  };
  const { sdk, calls } = client(() => withdrawn);
  expect(
    await sdk.withdraw(projectId, active, retirement, "withdraw-key"),
  ).toEqual(withdrawn);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.url).toEndWith(`/story-declarations/${id}/withdraw`);
  expect(calls[0]!.headers.get("If-Match")).toBe(active.etag);
  expect(await calls[0]!.json()).toEqual(retirement);
  const next: StoryDeclaration = {
    ...original,
    id: other,
    input: { ...original.input, statement: "明确的新解释" },
  };
  const replaceInput = {
    ...retirement,
    replacement: {
      id: next.id,
      etag: next.etag,
      sourceFingerprint: next.basis.fingerprint,
      confirmedSourceReview: true as const,
      confirmedInterpretationReview: true as const,
    },
  };
  const replaced: StoryDeclaration = {
    ...active,
    lifecycle: {
      state: "replaced",
      version: 1,
      record: { ...retirement.record, version: 1 },
      replacementId: other,
      transitions: [
        {
          version: 1,
          action: "replace",
          replacementId: other,
          reason: retirement.reason,
          createdAt: at,
        },
      ],
    },
  };
  const replacing = client(() => replaced);
  expect(
    await replacing.sdk.replace(
      projectId,
      active,
      next,
      replaceInput,
      "replace-key",
    ),
  ).toEqual(replaced);
  expect(replacing.calls).toHaveLength(1);
  expect(await replacing.calls[0]!.json()).toEqual(replaceInput);
  // A replay can show a later explicit replacement while retaining this exact withdrawal receipt.
  const later: StoryDeclaration = {
    ...replaced,
    lifecycle: {
      ...replaced.lifecycle!,
      version: 2,
      transitions: [
        ...withdrawn.lifecycle!.transitions,
        {
          version: 2,
          action: "replace",
          replacementId: other,
          reason: "另一次明确决定",
          createdAt: at,
        },
      ],
    },
  };
  expect(
    await client(() => later).sdk.withdraw(
      projectId,
      active,
      retirement,
      "original-withdraw-key",
    ),
  ).toEqual(later);
});
test("source lifecycle SDK rejects foreign or unreviewed replacement, wrong actual binding/version and forged history without silent reads or writes", async () => {
  const { sdk, calls } = client(() => active);
  const next: StoryDeclaration = { ...original, id: other };
  const replaceInput = {
    ...retirement,
    replacement: {
      id: other,
      etag: next.etag,
      sourceFingerprint: next.basis.fingerprint,
      confirmedSourceReview: true as const,
      confirmedInterpretationReview: true as const,
    },
  };
  for (const [candidate, input] of [
    [{ ...next, projectId: chapterId }, replaceInput],
    [{ ...next, sourceStatus: { state: "stale", reasons: [] } }, replaceInput],
    [
      next,
      {
        ...replaceInput,
        replacement: {
          ...replaceInput.replacement,
          confirmedInterpretationReview: false,
        },
      },
    ],
    [
      next,
      {
        ...replaceInput,
        replacement: { ...replaceInput.replacement, id: chapterId },
      },
    ],
  ] as const)
    await expect(
      sdk.replace(
        projectId,
        active,
        candidate as StoryDeclaration,
        input as typeof replaceInput,
        "key",
      ),
    ).rejects.toThrow();
  await expect(
    sdk.withdraw(
      projectId,
      active,
      { ...retirement, record: { ...retirement.record, version: 1 } },
      "key",
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
  for (const lifecycle of [
    { ...active.lifecycle!, record: { ...retirement.record, id: other } },
    {
      ...active.lifecycle!,
      state: "withdrawn",
      version: 1,
      record: { ...retirement.record, version: 0 },
      transitions: [
        { version: 1, action: "withdraw", reason: "reason", createdAt: at },
      ],
    },
    {
      ...active.lifecycle!,
      state: "replaced",
      version: 1,
      record: { ...retirement.record, version: 1 },
      replacementId: id,
      transitions: [
        {
          version: 1,
          action: "replace",
          replacementId: id,
          reason: "reason",
          createdAt: at,
        },
      ],
    },
  ])
    await expect(
      client(() => ({ ...active, lifecycle })).sdk.get(projectId, id),
    ).rejects.toThrow();
  await expect(
    client(() => ({
      ...active,
      lifecycle: {
        state: "withdrawn",
        version: 1,
        record: { ...retirement.record, version: 1 },
        transitions: [
          {
            version: 1,
            action: "withdraw",
            reason: "篡改回执决定",
            createdAt: at,
          },
        ],
      },
    })).sdk.withdraw(projectId, active, retirement, "key"),
  ).rejects.toThrow();
});
test("declaration SDK preserves actual saved-script anchors and refuses paragraph substitution or reordered block identities", async () => {
  const documentId = nodeId,
    blockId = other;
  const scriptSelection = {
    kind: "screenplay-blocks" as const,
    scriptId: chapterId,
    scriptVersion: 2,
    documentId,
    documentVersion: 3,
    documentContentHash: "e".repeat(64),
    blockIds: [blockId],
  };
  const basisSource = {
    selection: scriptSelection,
    text: "真实剧本块",
    quote: "真实剧本块",
    quoteHash: "f".repeat(64),
    anchors: [{ blockId, blockIndex: 4, blockType: "action" as const }],
  };
  const script: StoryDeclaration = {
    ...original,
    input: { ...original.input, sources: [scriptSelection] },
    basis: { ...original.basis, sources: [basisSource] },
  };
  const { sdk, calls } = client(() => script);
  expect(
    await sdk.create(projectId, script.input, "exact-script-request"),
  ).toEqual(script);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.headers.get("Idempotency-Key")).toBe("exact-script-request");
  for (const anchors of [
    [{ start: 0, end: 3, paragraphIds: ["fake-paragraph"] }],
    [{ blockId: nodeId, blockIndex: 4, blockType: "action" }],
  ])
    await expect(
      client(() => ({
        ...script,
        basis: { ...script.basis, sources: [{ ...basisSource, anchors }] },
      })).sdk.get(projectId, id),
    ).rejects.toThrow();
});
test("declaration SDK restores exact original project/ID and rejects forged basis selections and foreign receipts", async () => {
  const { sdk, calls } = client(() => ({
    ...original,
    sourceStatus: { state: "stale", reasons: ["原正文变化"] },
  }));
  expect(await sdk.get(projectId, id)).toMatchObject({
    id,
    projectId,
    sourceStatus: { state: "stale" },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.url).toEndWith(
    `/projects/${projectId}/story-declarations/${id}`,
  );
  for (const changed of [
    { ...original, id: other },
    { ...original, projectId: other },
    { ...original, basis: { ...original.basis, projectId: other } },
    {
      ...original,
      basis: {
        ...original.basis,
        sources: [
          {
            ...original.basis.sources[0],
            selection: { ...selection, chapterVersion: 1 },
          },
        ],
      },
    },
    { ...original, status: "adopted" },
  ])
    await expect(
      client(() => changed).sdk.get(projectId, id),
    ).rejects.toThrow();
});
test("declaration SDK writes one candidate then explicitly adopts exact original ETag/fingerprint with no hidden snapshot/model/read substitution", async () => {
  const applied: StoryDeclaration = {
    ...original,
    status: "adopted",
    version: 1,
    adoptedNode: { id: nodeId, version: 0 },
  };
  const { calls, sdk } = client((request) =>
    request.url.endsWith("/adopt") ? applied : original,
  );
  expect(await sdk.create(projectId, original.input, "candidate-key")).toEqual(
    original,
  );
  expect(
    await sdk.adopt(projectId, original, adoption, "adoption-key"),
  ).toEqual(applied);
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => call.method)).toEqual(["POST", "POST"]);
  expect(calls[0]!.headers.get("Idempotency-Key")).toBe("candidate-key");
  expect(await calls[0]!.json()).toEqual(original.input);
  expect(calls[1]!.url).toEndWith(`/story-declarations/${id}/adopt`);
  expect(calls[1]!.headers.get("If-Match")).toBe(original.etag);
  expect(calls[1]!.headers.get("Idempotency-Key")).toBe("adoption-key");
  expect(await calls[1]!.json()).toEqual(adoption);
});
test("declaration SDK fails closed before writes for stale/wrong reviews and rejects substituted adoption and discard receipts", async () => {
  const { calls, sdk } = client(() => original);
  for (const candidate of [
    { ...original, sourceStatus: { state: "stale" as const, reasons: [] } },
    { ...original, status: "discarded" as const },
    { ...original, etag: '"1"' },
  ])
    await expect(
      sdk.adopt(projectId, candidate, adoption, "key"),
    ).rejects.toThrow();
  await expect(
    sdk.adopt(
      projectId,
      original,
      { ...adoption, sourceFingerprint: "f".repeat(64) },
      "key",
    ),
  ).rejects.toThrow();
  await expect(sdk.create(projectId, original.input, "")).rejects.toThrow();
  expect(calls).toHaveLength(0);
  await expect(
    client(() => ({
      ...original,
      id: other,
      status: "adopted",
      version: 1,
      adoptedNode: { id: nodeId, version: 0 },
    })).sdk.adopt(projectId, original, adoption, "key"),
  ).rejects.toThrow();
  await expect(
    client(() => ({
      ...original,
      status: "discarded",
      version: 1,
      input: { ...original.input, statement: "被换解释" },
    })).sdk.discard(projectId, original, "key"),
  ).rejects.toThrow();
});
test("declaration SDK validates scoped metadata pagination, rejects duplicated/foreign history and never reads latest", async () => {
  const {
    input: _input,
    basis: _basis,
    adoptedNode: _node,
    etag: _etag,
    ...metadata
  } = original;
  const item = {
    ...metadata,
    title: original.input.title,
    kind: original.input.kind,
    sourceFingerprint: original.basis.fingerprint,
  };
  const { calls, sdk } = client(() => ({
    projectId,
    items: [item],
    nextCursor: id,
  }));
  expect(await sdk.list(projectId, { limit: 1, cursor: other })).toMatchObject({
    items: [item],
    nextCursor: id,
  });
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.url).toContain(`cursor=${other}`);
  const adoptedItem = {
    ...item,
    status: "adopted",
    version: 1,
    adoptedNode: { id: nodeId, version: 0 },
  };
  expect(
    await client(() => ({ projectId, items: [adoptedItem] })).sdk.list(
      projectId,
    ),
  ).toMatchObject({ items: [adoptedItem] });
  for (const page of [
    { projectId: other, items: [item] },
    { projectId, items: [{ ...item, projectId: other }] },
    { projectId, items: [item, item] },
    { projectId, items: [item], nextCursor: other },
    { projectId, items: [{ ...item, status: "adopted" }] },
    { projectId, items: [{ ...item, adoptedNode: adoptedItem.adoptedNode }] },
  ])
    await expect(client(() => page).sdk.list(projectId)).rejects.toThrow();
});
