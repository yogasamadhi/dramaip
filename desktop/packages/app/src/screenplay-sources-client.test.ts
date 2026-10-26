import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import type { ScreenplaySource } from "@dramaip/contracts/production";

const projectId = "30000000-0000-4000-8000-000000000001",
  scriptId = "30000000-0000-4000-8000-000000000002",
  documentId = "30000000-0000-4000-8000-000000000003",
  blockId = "30000000-0000-4000-8000-000000000004",
  foreignId = "30000000-0000-4000-8000-000000000005";
const source: ScreenplaySource = {
  projectId,
  scriptId,
  scriptVersion: 2,
  title: "实际已保存剧本",
  source: {
    state: "available",
    contentHash: "a".repeat(64),
    document: {
      id: documentId,
      version: 3,
      title: "实际原稿",
      sourceFormat: "native",
      blocks: [
        {
          id: blockId,
          type: "action",
          text: "实际选择正文。",
          sourceLocation: { line: 3 },
        },
      ],
      lossReport: { unsupported: [], warnings: [], preserved: [] },
    },
    policyDependencies: [],
  },
};
function client(reply: unknown) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json(reply);
    },
    openEventStream: async () => new Response(),
  });
  return { sdk, calls };
}
test("saved screenplay source SDK uses only the readonly original project/script path and rejects foreign or duplicate sources", async () => {
  const { sdk, calls } = client(source);
  expect(await sdk.screenplaySources.get(projectId, scriptId)).toEqual(source);
  expect(
    calls.map((request) => [request.method, new URL(request.url).pathname]),
  ).toEqual([
    ["GET", `/api/v2/projects/${projectId}/screenplay-sources/${scriptId}`],
  ]);
  if (source.source.state !== "available")
    throw new Error("Invalid test fixture");
  for (const value of [
    { ...source, scriptId: foreignId },
    { ...source, projectId: foreignId },
    {
      ...source,
      source: {
        ...source.source,
        document: {
          ...source.source.document,
          blocks: [
            ...source.source.document.blocks,
            ...source.source.document.blocks,
          ],
        },
      },
    },
    {
      ...source,
      source: {
        ...source.source,
        document: {
          ...source.source.document,
          blocks: [
            {
              ...source.source.document.blocks[0],
              privatePath: "/PRIVATE_NOT_PUBLIC",
            },
          ],
        },
      },
    },
  ])
    await expect(
      client(value).sdk.screenplaySources.get(projectId, scriptId),
    ).rejects.toThrow();
});
test("missing saved screenplay source stays explicitly unavailable with no initializing GET, latest read or POST", async () => {
  const missing = {
    ...source,
    source: {
      state: "unavailable" as const,
      reason: "saved-document-missing" as const,
    },
  };
  const { sdk, calls } = client(missing);
  expect(await sdk.screenplaySources.get(projectId, scriptId)).toEqual(missing);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
});
test("saved screenplay source catalog is metadata only and validates actual project and keyset cursor identity", async () => {
  const summary = {
    projectId,
    scriptId,
    scriptVersion: 2,
    title: source.title,
    state: "available" as const,
  };
  const page = { projectId, items: [summary], nextCursor: scriptId };
  const { sdk, calls } = client(page);
  expect(
    await sdk.screenplaySources.list(projectId, {
      cursor: foreignId,
      limit: 1,
    }),
  ).toEqual(page);
  expect(
    calls[0]!.url.endsWith(`/screenplay-sources?cursor=${foreignId}&limit=1`),
  ).toBe(true);
  for (const value of [
    { ...page, projectId: foreignId },
    { ...page, items: [summary, summary] },
    { ...page, nextCursor: foreignId },
    { ...page, items: [{ ...summary, projectId: foreignId }] },
  ])
    await expect(
      client(value).sdk.screenplaySources.list(projectId),
    ).rejects.toThrow();
});
