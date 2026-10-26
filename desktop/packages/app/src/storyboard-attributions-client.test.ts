import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import type {
  StoryboardAttribution,
  StoryboardAttributionDecision,
  StoryboardAttributionSource,
} from "@dramaip/contracts/production";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = "a".repeat(64),
  at = "2026-10-05T01:00:00.000Z";
const source: StoryboardAttributionSource = {
  format: "exact-shot-attribution-source-v1",
  projectId: id(1),
  episodeId: "episode-1",
  storyboard: {
    id: id(2),
    version: 1,
    contentHash: sha,
    sourceSnapshotId: id(3),
  },
  outline: { id: id(4), version: 1, contentHash: sha, sourceSnapshotId: id(5) },
  script: { id: id(6), version: 1, contentHash: sha, sourceSnapshotId: id(7) },
  document: {
    id: id(8),
    version: 0,
    scriptId: id(9),
    scriptVersion: 0,
    contentHash: sha,
  },
  chapters: [],
  scriptBlocks: [
    { id: id(10), index: 0, type: "scene_heading" },
    { id: id(11), index: 1, type: "action" },
  ],
  shots: [
    {
      sceneId: "scene-1",
      shotId: "shot-1",
      sceneRecord: { id: id(12), version: 0, contentHash: sha },
      shotRecord: { id: id(13), version: 0, contentHash: sha },
      sourceBlockIds: [id(11)],
    },
  ],
  evidence: [
    {
      sceneId: "scene-1",
      evidenceId: "quote-1",
      source: {
        sourceKind: "project",
        sourceId: id(1),
        sourceVersion: 0,
        fieldPath: "/project",
        contentHash: sha,
      },
      valuePath: "/content/synopsis",
      quoteHash: sha,
      quoteCharacters: 4,
      offsetUnit: "utf16-code-unit",
      matches: [
        { start: 4, end: 8 },
        { start: 12, end: 16 },
      ],
      attribution: "model-declared",
      matchVerification: "rule",
      semanticVerification: "unverified",
    },
  ],
  sourceFingerprint: sha,
  baseAttributionId: null,
  semanticVerification: "unverified",
};
const { matches, ...evidenceIdentity } = source.evidence[0]!;
const original: StoryboardAttribution = {
  id: id(20),
  projectId: id(1),
  version: 0,
  status: "pending",
  origin: "human-declared",
  input: {
    storyboard: { id: id(2), version: 1 },
    sourceFingerprint: sha,
    baseAttributionId: null,
    selections: [
      {
        sceneId: "scene-1",
        shotId: "shot-1",
        blockIds: [id(11)],
        evidenceId: "quote-1",
        matchIndex: 1,
        rationale: "PRIVATE 原人工声明",
      },
    ],
  },
  source,
  links: [
    {
      sceneId: "scene-1",
      shotId: "shot-1",
      blockIds: [id(11)],
      evidenceId: "quote-1",
      matchIndex: 1,
      evidence: { ...evidenceIdentity, match: matches[1]! },
      attribution: "human-declared",
      matchVerification: "rule",
      semanticVerification: "unverified",
    },
  ],
  coverage: {
    totalShots: 1,
    associatedShots: 1,
    nodeAssociatedShots: 0,
    associatedBlockCount: 1,
    unassociatedShotIds: [],
  },
  associationFingerprint: sha,
  isCurrent: false,
  sourceState: "current",
  sourceReasons: [],
  createdAt: at,
  updatedAt: at,
};
const decision: StoryboardAttributionDecision = {
  version: 0,
  sourceFingerprint: sha,
  associationFingerprint: sha,
  action: "adopt",
  actualSourcesReviewed: true,
  exactShotLinksReviewed: true,
  unverifiedSemanticsAcknowledged: true,
};
function client(reply: (request: Request) => unknown) {
  const calls: Request[] = [];
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: id(1),
    runtimeGeneration: 1,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      const value = reply(request);
      return value instanceof Response ? value : Response.json(value);
    },
    openEventStream: async () => new Response(),
  }).storyboardAttributions;
  return { sdk, calls };
}
test("逐镜头 SDK 精确读取原正式版本，不创建工作流或替换最新", async () => {
  const { sdk, calls } = client(() => source);
  expect(await sdk.sources(id(1), { id: id(2), version: 1 })).toEqual(source);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.method).toBe("GET");
  expect(calls[0]!.url).toContain(
    `/storyboard-attribution-sources/${id(2)}?version=1`,
  );
});
test("逐镜头 SDK 拒绝错误项目／正式身份／版本及本次读取失败，不回填其他来源", async () => {
  for (const patch of [
    { projectId: id(99) },
    { storyboard: { ...source.storyboard, id: id(99) } },
    { storyboard: { ...source.storyboard, version: 2 } },
  ]) {
    const { sdk, calls } = client(() => ({ ...source, ...patch }));
    await expect(
      sdk.sources(id(1), { id: id(2), version: 1 }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
  const { sdk, calls } = client(() =>
    Response.json({ status: 503, title: "实际owner不可用" }, { status: 503 }),
  );
  await expect(sdk.get(id(1), id(20))).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
test("逐镜头 SDK 创建沿用原请求键、完整选择和精确来源 CAS，旧回执失效仍只读原候选", async () => {
  const { sdk, calls } = client(() => ({
    ...original,
    sourceState: "stale",
    sourceReasons: ["原源已变化"],
  }));
  const result = await sdk.create(id(1), original.input, "original-create-key");
  expect(result.id).toBe(original.id);
  expect(result.sourceState).toBe("stale");
  expect(calls[0]!.headers.get("Idempotency-Key")).toBe("original-create-key");
  expect(calls[0]!.headers.get("If-Match")).toBe(`"${sha}"`);
  expect(await calls[0]!.json()).toEqual(original.input);
});
test("逐镜头 SDK 明确独立采用，不伪造模型工作流或改写来源", async () => {
  const adopted: StoryboardAttribution = {
    ...original,
    version: 1,
    status: "adopted",
    isCurrent: true,
    adoptedAt: at,
  };
  const { sdk, calls } = client(() => adopted);
  expect(
    await sdk.decide(id(1), original, decision, "original-decision-key"),
  ).toEqual(adopted);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain(`/${original.id}/decision`);
  expect(calls[0]!.headers.get("If-Match")).toBe('"0"');
  expect(await calls[0]!.json()).toEqual(decision);
});
test("逐镜头 SDK 回执拒绝换具体匹配位置、假覆盖、错块或虚构节点", async () => {
  for (const corrupt of [
    { ...original, links: [{ ...original.links[0]!, matchIndex: 0 }] },
    { ...original, coverage: { ...original.coverage, associatedShots: 2 } },
    { ...original, links: [{ ...original.links[0]!, blockIds: [id(99)] }] },
    {
      ...original,
      links: [
        {
          ...original.links[0]!,
          evidence: {
            ...original.links[0]!.evidence,
            match: { start: 4, end: 8 },
          },
        },
      ],
    },
    { ...original, workflowId: id(99) },
  ]) {
    const { sdk } = client(() => corrupt);
    await expect(sdk.get(id(1), original.id)).rejects.toThrow();
  }
});
test("逐镜头 SDK 历史分页核实际项目、唯一身份和原游标，不默认选最近关联", async () => {
  const { sdk, calls } = client(() => ({
    projectId: id(1),
    items: [original],
    nextCursor: original.id,
  }));
  expect((await sdk.list(id(1), { cursor: id(30), limit: 1 })).items).toEqual([
    original,
  ]);
  expect(calls[0]!.url).toContain(`cursor=${id(30)}&limit=1`);
  for (const reply of [
    { projectId: id(99), items: [original] },
    { projectId: id(1), items: [original, original] },
    { projectId: id(1), items: [original], nextCursor: id(99) },
  ])
    await expect(client(() => reply).sdk.list(id(1))).rejects.toThrow();
});
test("逐镜头 SDK 拒绝空原键和错原决定版本，零请求", async () => {
  const { sdk, calls } = client(() => original);
  await expect(sdk.create(id(1), original.input, " ")).rejects.toThrow();
  await expect(
    sdk.decide(id(1), original, { ...decision, version: 1 }, "k"),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
test("逐镜头 SDK 脱敏目录拒绝私人正文和错误项目／游标，不自动读取详情", async () => {
  const summary = {
    id: original.id,
    projectId: original.projectId,
    episodeId: source.episodeId,
    version: original.version,
    status: original.status,
    storyboard: original.input.storyboard,
    outline: { id: source.outline.id, version: source.outline.version },
    script: { id: source.script.id, version: source.script.version },
    coverage: original.coverage,
    sourceFingerprint: source.sourceFingerprint,
    associationFingerprint: original.associationFingerprint,
    isCurrent: original.isCurrent,
    sourceState: original.sourceState,
    sourceReasons: original.sourceReasons,
    createdAt: original.createdAt,
    updatedAt: original.updatedAt,
  };
  const { sdk, calls } = client(() => ({ projectId: id(1), items: [summary] }));
  expect((await sdk.summaries(id(1), { limit: 100 })).items).toEqual([summary]);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain(
    "/storyboard-attributions/summaries?limit=100",
  );
  for (const reply of [
    { projectId: id(99), items: [summary] },
    { projectId: id(1), items: [{ ...summary, input: original.input }] },
    { projectId: id(1), items: [summary, summary] },
    { projectId: id(1), items: [summary], nextCursor: id(99) },
  ])
    await expect(client(() => reply).sdk.summaries(id(1))).rejects.toThrow();
});
