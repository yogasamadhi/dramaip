import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import { SourceImportCommitRecoverySchema } from "@dramaip/contracts/workspace";
const projectId = "a47fa85e-0191-42fd-b89b-134cfbabbb09",
  importId = "b47fa85e-0191-42fd-b89b-134cfbabbb09",
  key = "c47fa85e-0191-42fd-b89b-134cfbabbb09";
const input = {
  projectId,
  strategy: "append" as const,
  rightsConfirmed: true,
  destructiveConfirmed: false,
  preview: {
    fileName: "私有.md",
    sourceType: "markdown" as const,
    contentKind: "novel" as const,
    title: "原稿",
    charCount: 2,
    chapters: [
      {
        key: "chapter",
        title: "第一章",
        content: "正文",
        orderIndex: 0,
        wordCount: 2,
      },
    ],
    episodes: [],
    warnings: [],
  },
};
const pending = {
  importId,
  projectId,
  input,
  state: "pending" as const,
  createdAt: "2026-10-04T00:00:00.000Z",
};
const client = (respond: (request: Request) => Response) =>
  createStudioClient({
    baseUrl: "http://runtime.local",
    runtimeId: projectId,
    runtimeGeneration: 1,
    fetch: async (url, init) => respond(new Request(url, init)),
    openEventStream: async () => new Response(),
  });
test("ordinary import SDK recovery is GET-only and rejects foreign original identities", async () => {
  const sdk = client((request) => {
    expect(request.method).toBe("GET");
    expect(request.body).toBeNull();
    const url = new URL(request.url);
    expect(url.pathname).toBe(`/api/v2/source-imports/${importId}/commit`);
    expect(url.searchParams.get("projectId")).toBe(projectId);
    expect(url.searchParams.get("requestKey")).toBe(key);
    return Response.json(pending);
  });
  expect(await sdk.sourceImports.getCommit(importId, projectId, key)).toEqual(
    pending,
  );
  await expect(
    client(() =>
      Response.json({ ...pending, importId: projectId }),
    ).sourceImports.getCommit(importId, projectId, key),
  ).rejects.toThrow();
  await expect(
    client(() =>
      Response.json({ ...pending, projectId: importId }),
    ).sourceImports.getCommit(importId, projectId, key),
  ).rejects.toThrow();
});
test("ordinary import SDK sends optional durable key while preserving unkeyed compatibility", async () => {
  let calls = 0;
  const result = {
    createdChapters: 1,
    updatedChapters: 0,
    createdEpisodes: 0,
    createdScripts: 0,
    updatedScripts: 0,
    createdScenes: 0,
    checkpointCount: 0,
  };
  const sdk = client((request) => {
    expect(request.method).toBe("POST");
    expect(request.headers.get("Idempotency-Key")).toBe(
      calls++ === 0 ? key : null,
    );
    return Response.json(result);
  });
  expect(await sdk.sourceImports.commit(importId, input, key)).toEqual(result);
  expect(await sdk.sourceImports.commit(importId, input)).toEqual(result);
});
test("recovery schema rejects incoherent completed scope/counts and pending results without original receipt", () => {
  expect(
    SourceImportCommitRecoverySchema.safeParse({ ...pending, result: {} })
      .success,
  ).toBe(false);
  expect(
    SourceImportCommitRecoverySchema.safeParse({
      ...pending,
      state: "committed",
      committedAt: pending.createdAt,
      result: {
        createdChapters: 2,
        updatedChapters: 0,
        createdEpisodes: 0,
        createdScripts: 0,
        updatedScripts: 0,
        createdScenes: 0,
        checkpointCount: 0,
      },
    }).success,
  ).toBe(false);
  expect(
    SourceImportCommitRecoverySchema.safeParse({ ...pending, grantId: key })
      .success,
  ).toBe(false);
});
