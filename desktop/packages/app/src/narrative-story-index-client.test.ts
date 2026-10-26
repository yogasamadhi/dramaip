import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import type {
  NarrativeStoryIndex,
  NarrativeStoryIndexEntry,
} from "@dramaip/contracts/knowledge";
import {
  narrativeStoryScopeReasons,
  sameNarrativeStorySelection,
} from "./narrative-story-scope";

const projectId = crypto.randomUUID(),
  id = crypto.randomUUID(),
  chapterId = crypto.randomUUID();
const entry: NarrativeStoryIndexEntry = {
  selection: { kind: "assertion", id, version: 1 },
  projectId,
  title: "真实作者关系解释",
  statement: "声明不是原文语义认证",
  classification: "relationship",
  status: "adopted",
  sourceFingerprint: "a".repeat(64),
  sourceState: "current",
  record: { kind: "edge", id: crypto.randomUUID(), version: 0 },
  retirement: "active",
  interpretation: "author-inferred",
  eligibility: { state: "eligible", reasons: [] },
  sourceChapters: [{ id: chapterId, version: 3 }],
  sourceScripts: [],
  endpoints: [],
  relation: "reveals",
};
const catalog: NarrativeStoryIndex = {
  projectId,
  fingerprint: "b".repeat(64),
  evidencePolicy: "source-anchored-human-interpretations-not-semantic-proof",
  entries: [entry],
};
function client(reply: unknown) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: crypto.randomUUID(),
    runtimeGeneration: 1,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return Response.json(reply);
    },
    openEventStream: async () => new Response(),
  }).narrativeStoryIndex;
  return { calls, sdk };
}
test("story index SDK uses the public read-only project route and preserves exact frozen identities, not source bodies", async () => {
  const { calls, sdk } = client(catalog);
  expect(await sdk.catalog(projectId)).toEqual(catalog);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(new URL(calls[0]!.url).pathname).toBe(
    `/api/v2/projects/${projectId}/narrative-story-index`,
  );
  expect(calls[0]!.headers.has("Idempotency-Key")).toBe(false);
  expect(calls[0]!.body).toBeNull();
});
test("story index SDK refuses foreign project entries, duplicate owner IDs, unbounded catalogs and injected quote/endpoint summaries", async () => {
  for (const reply of [
    { ...catalog, projectId: crypto.randomUUID() },
    { ...catalog, entries: [{ ...entry, projectId: crypto.randomUUID() }] },
    { ...catalog, entries: [entry, entry] },
    { ...catalog, entries: [{ ...entry, quote: "PRIVATE source body" }] },
    {
      ...catalog,
      entries: [
        {
          ...entry,
          endpoints: [
            {
              id: crypto.randomUUID(),
              version: 0,
              kind: "character",
              title: "端点名",
              summary: "PRIVATE endpoint body",
            },
          ],
        },
      ],
    },
    { ...catalog, entries: [{ ...entry, status: "pending" }] },
    { ...catalog, entries: [{ ...entry, sourceState: "stale" }] },
    { ...catalog, entries: Array.from({ length: 20001 }, () => entry) },
  ])
    await expect(client(reply).sdk.catalog(projectId)).rejects.toThrow();
});
test("story scope permits only complete current chapter origins and keeps interpretation pointers distinct from original coverage", () => {
  const chapter = {
    id: chapterId,
    projectId,
    version: 3,
    content: "真实本项目当前正文",
  };
  expect(narrativeStoryScopeReasons(entry, projectId, [chapter])).toEqual([]);
  for (const source of [
    { ...chapter, version: 4 },
    { ...chapter, projectId: crypto.randomUUID() },
    { ...chapter, content: " " },
    { ...chapter, id: crypto.randomUUID() },
  ])
    expect(
      narrativeStoryScopeReasons(entry, projectId, [source]).length,
    ).toBeGreaterThan(0);
  expect(
    narrativeStoryScopeReasons({ ...entry, sourceChapters: [] }, projectId, [
      chapter,
    ]),
  ).toContain("没有本轮章节来源，不当作原著上下文。");
  expect(
    narrativeStoryScopeReasons(
      { ...entry, sourceScripts: [{ id: crypto.randomUUID(), version: 0 }] },
      projectId,
      [chapter],
    ),
  ).toContain("包含剧本来源，不能静默纳入本轮小说章节范围。");
  expect(
    narrativeStoryScopeReasons(
      {
        ...entry,
        sourceChapters: [
          ...entry.sourceChapters,
          { id: crypto.randomUUID(), version: 0 },
        ],
      },
      projectId,
      [chapter],
    ).length,
  ).toBeGreaterThan(0);
});
test("story scope preserves owner denial reasons and exact selection versions, including removed or replaced original selections", () => {
  expect(
    narrativeStoryScopeReasons(
      {
        ...entry,
        eligibility: { state: "ineligible", reasons: ["原来源撤回"] },
      },
      projectId,
      [],
    ).includes("原来源撤回"),
  ).toBe(true);
  expect(
    sameNarrativeStorySelection(entry.selection, { ...entry.selection }),
  ).toBe(true);
  expect(
    sameNarrativeStorySelection(entry.selection, {
      ...entry.selection,
      version: 2,
    }),
  ).toBe(false);
  expect(
    sameNarrativeStorySelection(entry.selection, {
      ...entry.selection,
      kind: "declaration",
    }),
  ).toBe(false);
});
