import { expect, test } from "bun:test";
import { createStudioClient } from "@dramaip/client";
const projectId = "10000000-0000-4000-8000-000000000001";
const id = "10000000-0000-4000-8000-000000000002";
const workflowId = "10000000-0000-4000-8000-000000000003";
const cursor = "10000000-0000-4000-8000-000000000004";
const time = "2026-10-02T00:00:00.000Z";
const summary = {
  id,
  projectId,
  workflowId,
  version: 1,
  status: "adopted",
  target: { kind: "book", id: projectId, version: 0 },
  isHead: true,
  isCurrent: false,
  sourceState: "stale",
  staleReasonCount: 1,
  contextEligibility: { state: "eligible", reasonCount: 0 },
  coveredChapterCount: 2,
  createdAt: time,
  updatedAt: time,
  adoptedAt: time,
};
const episode = {
  id,
  projectId,
  origin: "human-script-revision",
  episodeId: "episode-original",
  operation: "episode-script",
  version: 2,
  adoptedAt: time,
  isCurrent: true,
  sourceState: "stale",
  staleReasonCount: 2,
};
const sdk = (respond: (request: Request) => Response) =>
  createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: id,
    runtimeGeneration: 1,
    fetch: async (input, init) => respond(new Request(input, init)),
    openEventStream: async () => new Response(),
  });
test("来源状态 SDK 只 GET 精确项目的真实游标，保留冻结可用和人工无工作流事实", async () => {
  const calls: Request[] = [];
  const client = sdk((request) => {
    calls.push(request);
    return Response.json({
      items: request.url.includes("narrative-summaries")
        ? [summary]
        : [episode],
      nextCursor: cursor,
    });
  });
  expect(
    (await client.narrativeSummaries.summaries(projectId, cursor, 1)).items[0]!
      .contextEligibility.state,
  ).toBe("eligible");
  const result = (
    await client.episodeDevelopments.summaries(projectId, cursor, 1)
  ).items[0]!;
  expect(result.origin).toBe("human-script-revision");
  expect(result.workflowId).toBeUndefined();
  expect(calls.map((request) => new URL(request.url).pathname)).toEqual([
    `/api/v2/projects/${projectId}/narrative-summaries/summaries`,
    `/api/v2/projects/${projectId}/episode-development-summaries`,
  ]);
  for (const request of calls) {
    expect(request.method).toBe("GET");
    expect(new URL(request.url).searchParams.get("cursor")).toBe(cursor);
    expect(new URL(request.url).searchParams.get("limit")).toBe("1");
    expect(request.body).toBeNull();
  }
});
test("状态 SDK 拒绝跨项目、重复身份、正文和嵌套私有字段，读取错误不伪造空列表", async () => {
  for (const [key, item] of [
    ["narrativeSummaries", summary],
    ["episodeDevelopments", episode],
  ] as const) {
    for (const items of [
      [{ ...item, projectId: cursor }],
      [item, item],
      [{ ...item, content: "PRIVATE" }],
    ])
      await expect(
        sdk(() => Response.json({ items }))[key].summaries(projectId),
      ).rejects.toThrow();
    await expect(
      sdk(() => Response.json({ items: [], privatePath: "/secret" }))[
        key
      ].summaries(projectId),
    ).rejects.toThrow();
    await expect(
      sdk(() =>
        Response.json({ title: "unavailable", status: 503 }, { status: 503 }),
      )[key].summaries(projectId),
    ).rejects.toThrow();
  }
  await expect(
    sdk(() =>
      Response.json({
        items: [
          {
            ...summary,
            contextEligibility: {
              ...summary.contextEligibility,
              quote: "PRIVATE",
            },
          },
        ],
      }),
    ).narrativeSummaries.summaries(projectId),
  ).rejects.toThrow();
});
