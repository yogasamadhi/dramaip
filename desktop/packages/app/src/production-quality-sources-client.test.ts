import { expect, test } from "bun:test";
import { createStudioClient } from "@dramaip/client";
import type { ProductionQualitySource } from "@dramaip/contracts/production";
const projectId = "40000000-0000-4000-8000-000000000001",
  id = "40000000-0000-4000-8000-000000000002",
  other = "40000000-0000-4000-8000-000000000003";
const at = "2026-10-03T00:00:00.000Z";
const source: ProductionQualitySource = {
  id,
  projectId,
  kind: "scene",
  version: 0,
  title: "明确独立场景",
  source: {
    state: "available",
    contentHash: "a".repeat(64),
    recordContentHash: "b".repeat(64),
    record: {
      id,
      projectId,
      kind: "scenes",
      domain: "scenes",
      title: "明确独立场景",
      version: 0,
      orderIndex: 0,
      payload: { 场景动作: "实际场景正文。" },
      createdAt: at,
      updatedAt: at,
    },
    ancestors: [],
    policyDependencies: [
      { sourceId: id, sourceVersion: 0, fieldPath: `/production/${id}` },
    ],
  },
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
  }).productionQualitySources;
  return { calls, sdk };
}
test("production quality source SDK performs one exact read with real record binding and no editor or quality write", async () => {
  const { sdk, calls } = client(source);
  expect(await sdk.get(projectId, id)).toEqual(source);
  expect(calls).toHaveLength(1);
  expect(new URL(calls[0]!.url).pathname).toBe(
    `/api/v2/projects/${projectId}/production-quality-sources/${id}`,
  );
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.body).toBeNull();
  expect(calls[0]!.headers.has("Idempotency-Key")).toBe(false);
  const missing = client({
    ...source,
    source: { state: "unavailable", reason: "saved-document-missing" },
  });
  expect((await missing.sdk.get(projectId, id)).source.state).toBe(
    "unavailable",
  );
  expect(missing.calls).toHaveLength(1);
});
test("production quality source SDK rejects foreign or mismatched actual records and malformed saved script evidence without fallback reads", async () => {
  if (source.source.state !== "available") throw new Error("Source required");
  for (const reply of [
    { ...source, projectId: other },
    { ...source, id: other },
    {
      ...source,
      source: {
        ...source.source,
        record: { ...source.source.record, id: other },
      },
    },
    {
      ...source,
      source: {
        ...source.source,
        record: { ...source.source.record, version: 1 },
      },
    },
    {
      ...source,
      source: {
        ...source.source,
        record: { ...source.source.record, kind: "scripts", domain: "scripts" },
      },
    },
    {
      ...source,
      kind: "script",
      source: {
        ...source.source,
        record: { ...source.source.record, kind: "scripts", domain: "scripts" },
      },
    },
    {
      ...source,
      source: {
        ...source.source,
        ancestors: [
          {
            id: other,
            kind: "scripts",
            version: 0,
            contentHash: "c".repeat(64),
          },
        ],
      },
    },
  ]) {
    const checked = client(reply);
    await expect(checked.sdk.get(projectId, id)).rejects.toThrow();
    expect(checked.calls).toHaveLength(1);
  }
});
test("production quality source SDK reads metadata pages and rejects duplicate identities, foreign scope and false cursors", async () => {
  const { source: _body, ...identity } = source;
  const page = {
    projectId,
    items: [{ ...identity, state: "available" as const }],
    nextCursor: id,
  };
  const checked = client(page);
  expect(
    await checked.sdk.list(projectId, { cursor: other, limit: 1 }),
  ).toEqual(page);
  const url = new URL(checked.calls[0]!.url);
  expect(url.searchParams.get("cursor")).toBe(other);
  expect(url.searchParams.get("limit")).toBe("1");
  for (const reply of [
    { ...page, projectId: other },
    { ...page, items: [{ ...page.items[0], projectId: other }] },
    { ...page, items: [page.items[0], page.items[0]] },
    { ...page, nextCursor: other },
    {
      ...page,
      items: [{ ...page.items[0], payload: { PRIVATE: "not metadata" } }],
    },
  ]) {
    const failed = client(reply);
    await expect(failed.sdk.list(projectId)).rejects.toThrow();
    expect(failed.calls).toHaveLength(1);
  }
});
