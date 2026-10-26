import { expect, test } from "vitest";
import type { StudioClient } from "@dramaip/client";
import type {
  StoryboardAttributionSource,
  StoryboardAttributionSummary,
} from "@dramaip/contracts/production";
import {
  readStoryboardAttributionDraft,
  writeStoryboardAttributionDraft,
  storyboardAttributionDraftKey,
  attributionSourceMatches,
  readShotAttributionSourceReview,
  readAllShotAttributionSummaries,
  type ShotAttributionDraft,
} from "./storyboard-attribution-draft";

const id = (n: number) =>
    `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  sha = "a".repeat(64);
const ref = (n: number) => ({ id: id(n), version: 1 });
const formal = (n: number) => ({
  ...ref(n),
  contentHash: sha,
  sourceSnapshotId: id(n + 100),
});
const scope = { projectId: id(1), storyboard: ref(2) };
const source: StoryboardAttributionSource = {
  format: "exact-shot-attribution-source-v1",
  ...scope,
  episodeId: "episode-1",
  storyboard: formal(2),
  outline: formal(3),
  script: formal(4),
  document: { ...ref(5), scriptId: id(6), scriptVersion: 1, contentHash: sha },
  chapters: [],
  scriptBlocks: [
    { id: id(7), index: 0, type: "scene_heading" },
    { id: id(8), index: 1, type: "action" },
  ],
  shots: [
    {
      sceneId: "scene-1",
      shotId: "shot-1",
      sceneRecord: { ...ref(9), contentHash: sha },
      shotRecord: { ...ref(10), contentHash: sha },
      sourceBlockIds: [id(8)],
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
const selection = {
  sceneId: "scene-1",
  shotId: "shot-1",
  blockIds: [id(8)],
  evidenceId: "quote-1",
  matchIndex: 1,
  rationale: "PRIVATE 原理由",
};
const input = {
  storyboard: scope.storyboard,
  sourceFingerprint: sha,
  baseAttributionId: null,
  selections: [selection],
};
const draft: ShotAttributionDraft = {
  scope,
  source,
  selections: [selection],
  pending: { kind: "create", key: id(20), input },
};
const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
test("人工关联回复未知的本机恢复保留原 key、具体第二处匹配与私人理由，不换来源", () => {
  const storage = memory();
  writeStoryboardAttributionDraft(storage, draft);
  const restored = readStoryboardAttributionDraft(
    storage.getItem(storyboardAttributionDraftKey(scope)),
    scope,
  );
  expect(restored).toEqual(draft);
  expect(restored.pending?.key).toBe(id(20));
  expect(restored.selections[0]!.matchIndex).toBe(1);
  expect(restored.selections[0]!.rationale).toBe("PRIVATE 原理由");
});
test("关联恢复拒绝坏JSON、错误项目／正式版本和被改的原请求，空存储不是旧数据通过", () => {
  expect(readStoryboardAttributionDraft(null, scope)).toEqual({
    scope,
    selections: [],
  });
  for (const raw of [
    "{",
    JSON.stringify({ ...draft, scope: { ...scope, projectId: id(99) } }),
    JSON.stringify({
      ...draft,
      scope: { ...scope, storyboard: { ...ref(2), version: 2 } },
    }),
    JSON.stringify({
      ...draft,
      pending: {
        ...draft.pending,
        input: { ...input, sourceFingerprint: "b".repeat(64) },
      },
    }),
    JSON.stringify({
      ...draft,
      pending: {
        ...draft.pending,
        input: { ...input, selections: [{ ...selection, matchIndex: 0 }] },
      },
    }),
  ])
    expect(() => readStoryboardAttributionDraft(raw, scope)).toThrow();
});
test("存储拒绝／静默未保存必须在HTTP前失败，不能凭未保存的新 key 提交", () => {
  let calls = 0;
  for (const storage of [
    {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    },
    { getItem: () => null, setItem: () => {} },
  ]) {
    expect(() => {
      writeStoryboardAttributionDraft(storage, draft);
      calls++;
    }).toThrow();
  }
  expect(calls).toBe(0);
});
test("实际来源与关联头都参与草稿核对，采用头变化不静默复用旧选择", () => {
  expect(attributionSourceMatches(source, structuredClone(source))).toBe(true);
  for (const other of [
    undefined,
    { ...source, sourceFingerprint: "b".repeat(64) },
    { ...source, baseAttributionId: id(99) },
    { ...source, storyboard: { ...source.storyboard, version: 2 } },
    { ...source, projectId: id(99) },
  ])
    expect(attributionSourceMatches(source, other)).toBe(false);
});
const actual = (operation: "episode-outline" | "episode-script") => {
  const expected =
    source[operation === "episode-outline" ? "outline" : "script"];
  return {
    ...expected,
    projectId: scope.projectId,
    episodeId: source.episodeId,
    operation,
    isCurrent: true,
    sourceState: "current",
    sourceEvidence: source.evidence,
    content:
      operation === "episode-outline"
        ? {
            kind: operation,
            value: {
              scenes: [
                {
                  id: "scene-1",
                  sourceEvidence: [{ id: "quote-1", quote: "原引文" }],
                },
              ],
            },
          }
        : {
            kind: operation,
            value: {
              blocks: source.scriptBlocks.map((value) => ({
                id: value.id,
                type: value.type,
                text: "实际块",
              })),
            },
          },
  };
};
test("来源审阅读取精确大纲／块并第二次核对原来源，不仅信任metadata缓存", async () => {
  const calls: string[] = [];
  const client = {
    storyboardAttributions: {
      sources: async () => {
        calls.push("source");
        return source;
      },
    },
    episodeDevelopments: {
      get: async (requested: string) => {
        calls.push(requested);
        return actual(
          requested === source.outline.id
            ? "episode-outline"
            : "episode-script",
        );
      },
    },
  } as unknown as StudioClient;
  const review = await readShotAttributionSourceReview(client, scope);
  expect(calls).toEqual([
    "source",
    source.outline.id,
    source.script.id,
    "source",
  ]);
  expect(review.script.blocks.map((value) => value.id)).toEqual(
    source.scriptBlocks.map((value) => value.id),
  );
});
test("原来源审阅读失败、错误项目／正式版本／场景证据／块顺序及中途漂移全部拒绝", async () => {
  for (const patch of [
    { projectId: id(99) },
    { version: 2 },
    { isCurrent: false },
    { sourceState: "stale" },
    { sourceEvidence: [] },
    { sourceSnapshotId: id(99) },
  ]) {
    const client = {
      storyboardAttributions: { sources: async () => source },
      episodeDevelopments: {
        get: async (requested: string) => ({
          ...actual(
            requested === source.outline.id
              ? "episode-outline"
              : "episode-script",
          ),
          ...patch,
        }),
      },
    } as unknown as StudioClient;
    await expect(
      readShotAttributionSourceReview(client, scope),
    ).rejects.toThrow();
  }
  let reads = 0;
  const client = {
    storyboardAttributions: {
      sources: async () =>
        ++reads === 1 ? source : { ...source, baseAttributionId: id(99) },
    },
    episodeDevelopments: {
      get: async (requested: string) =>
        actual(
          requested === source.outline.id
            ? "episode-outline"
            : "episode-script",
        ),
    },
  } as unknown as StudioClient;
  await expect(readShotAttributionSourceReview(client, scope)).rejects.toThrow(
    "审阅期间",
  );
});
test("脱敏目录完整遍历原游标，身份重复／空页／循环及读取失败不返回部分历史", async () => {
  const summaries = async (
    pages: Array<{
      items: StoryboardAttributionSummary[];
      nextCursor?: string;
    }>,
  ) => {
    const calls: Array<string | undefined> = [];
    const client = {
      storyboardAttributions: {
        summaries: async (_project: string, options: { cursor?: string }) => {
          calls.push(options.cursor);
          const page = pages[calls.length - 1];
          if (!page) throw new Error("owner unavailable");
          return page;
        },
      },
    } as unknown as StudioClient;
    return {
      result: readAllShotAttributionSummaries(client, scope.projectId),
      calls,
    };
  };
  const item = { id: id(30) } as StoryboardAttributionSummary,
    second = { id: id(31) } as StoryboardAttributionSummary;
  const good = await summaries([
    { items: [item], nextCursor: item.id },
    { items: [second] },
  ]);
  expect(await good.result).toEqual([item, second]);
  expect(good.calls).toEqual([undefined, item.id]);
  for (const pages of [
    [{ items: [item], nextCursor: item.id }, { items: [item] }],
    [{ items: [], nextCursor: item.id }],
    [
      { items: [item], nextCursor: item.id },
      { items: [second], nextCursor: item.id },
    ],
    [{ items: [item], nextCursor: item.id }],
  ]) {
    const bad = await summaries(pages);
    await expect(bad.result).rejects.toThrow();
  }
});
