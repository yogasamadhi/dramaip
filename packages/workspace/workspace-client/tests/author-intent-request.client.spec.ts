import { expect, test } from "vitest";
import type { AuthorIntentsSourcesResult } from "@dramaip/workspace-workspace/types";
import {
  ambiguousNavigation,
  confirmAuthorIntentCreationRequest,
  sameFrozenSnapshot,
  type NarrativeContextRequest,
} from "../src/client/intent/request.ts";

const catalog = (count = 2): AuthorIntentsSourcesResult => ({
  projectVersion: 4,
  baseAdoptedId: crypto.randomUUID(),
  chapterAvailable: true,
  scriptAvailable: false,
  items: Array.from({ length: count }, (_, i) => ({
    title: `仅元数据的来源 ${i + 1}`,
    source: {
      kind: "chapter",
      id: crypto.randomUUID(),
      version: i,
      contentHash: "a".repeat(64),
    },
  })),
});
test("AI 意图简报独立确认不补章节或未启用的剧本能力", () => {
  const data = catalog();
  expect(confirmAuthorIntentCreationRequest(data, [])).toEqual({
    request: {
      projectVersion: 4,
      baseAdoptedId: data.baseAdoptedId,
      sources: [],
    },
  });
});
test("AI 意图只绑定明确来源的真实版本和当时正式头，不改目录或原顺序", () => {
  const data = catalog();
  const before = structuredClone(data);
  expect(
    confirmAuthorIntentCreationRequest(data, [data.items[1]!.source.id]),
  ).toEqual({
    request: {
      projectVersion: 4,
      baseAdoptedId: data.baseAdoptedId,
      sources: [data.items[1]!.source],
    },
  });
  expect(data).toEqual(before);
});
test("AI 意图缺失、重复和超限选择必须可读拒绝，不忽略或截断", () => {
  const data = catalog(101);
  for (const ids of [
    [crypto.randomUUID()],
    [data.items[0]!.source.id, data.items[0]!.source.id],
    data.items.map((item) => item.source.id),
  ]) {
    expect(confirmAuthorIntentCreationRequest(data, ids)).toHaveProperty(
      "error",
    );
    expect(confirmAuthorIntentCreationRequest(data, ids)).not.toHaveProperty(
      "request",
    );
  }
  const valid = confirmAuthorIntentCreationRequest(
    data,
    data.items.slice(0, 100).map((item) => item.source.id),
  );
  expect("request" in valid && valid.request.sources.length).toBe(100);
});
test("AI 意图保存实际剧本的文档版本或 null，不伪造 AST 与采用基准", () => {
  const data = catalog(0);
  data.scriptAvailable = true;
  for (const documentVersion of [null, 7]) {
    const source = {
      kind: "script" as const,
      id: crypto.randomUUID(),
      version: 3,
      documentVersion,
      contentHash: "b".repeat(64),
    };
    data.items = [{ title: "已有剧本", source }];
    expect(confirmAuthorIntentCreationRequest(data, [source.id])).toEqual({
      request: {
        projectVersion: 4,
        baseAdoptedId: data.baseAdoptedId,
        sources: [source],
      },
    });
  }
});
const chapter = crypto.randomUUID(),
  script = crypto.randomUUID();
const mixed: AuthorIntentsSourcesResult = {
  projectVersion: 3,
  chapterAvailable: true,
  scriptAvailable: true,
  items: [
    {
      title: "明确允许章",
      source: {
        kind: "chapter",
        id: chapter,
        version: 4,
        contentHash: "a".repeat(64),
      },
    },
    {
      title: "明确完整剧本",
      source: {
        kind: "script",
        id: script,
        version: 2,
        documentVersion: null,
        contentHash: "b".repeat(64),
      },
    },
  ],
};
const context: NarrativeContextRequest = {
  format: "narrative-context-v1",
  chapters: [
    {
      id: chapter,
      version: 4,
      representation: "paragraphs",
      paragraphIds: ["原明确段落"],
    },
  ],
};
test("AI intent explicit expression confirmation preserves original versions and selections without default original prose or dropping a chosen script", () => {
  const before = structuredClone(context);
  const value = confirmAuthorIntentCreationRequest(
    mixed,
    [script, chapter],
    context,
  );
  expect(value).toEqual({
    request: {
      projectVersion: 3,
      baseAdoptedId: undefined,
      sources: mixed.items.map((item) => item.source),
      context,
    },
  });
  expect(context).toEqual(before);
  expect(JSON.stringify(value)).not.toContain('"representation":"original"');
});
test("AI intent explicit expression confirmation refuses absent scope, foreign or old versions and duplicate paragraph identities rather than substituting current chapters", () => {
  const invalid: [string[], NarrativeContextRequest][] = [
    [[], context],
    [
      [chapter],
      {
        ...context,
        chapters: [{ ...context.chapters[0]!, id: crypto.randomUUID() }],
      },
    ],
    [
      [chapter],
      { ...context, chapters: [{ ...context.chapters[0]!, version: 5 }] },
    ],
    [
      [chapter],
      {
        ...context,
        chapters: [
          {
            id: chapter,
            version: 4,
            representation: "paragraphs",
            paragraphIds: ["same", "same"],
          },
        ],
      },
    ],
  ];
  for (const [ids, changed] of invalid)
    expect(
      confirmAuthorIntentCreationRequest(mixed, ids, changed),
    ).toHaveProperty("error");
});
test("AI intent long allowed metadata scope stays explicit while the old complete-source limit remains unchanged", () => {
  const large: AuthorIntentsSourcesResult = {
    ...mixed,
    items: Array.from({ length: 101 }, (_, index) => ({
      title: `原允许范围 ${index}`,
      source: {
        kind: "chapter" as const,
        id: crypto.randomUUID(),
        version: 0,
        contentHash: "c".repeat(64),
      },
    })),
  };
  const ids = large.items.map((item) => item.source.id);
  expect(confirmAuthorIntentCreationRequest(large, ids)).toHaveProperty(
    "error",
  );
  const actual: NarrativeContextRequest = {
    format: "narrative-context-v1",
    chapters: large.items.map(({ source }) => ({
      id: source.id,
      version: source.version,
      representation: "original",
    })),
  };
  const confirmed = confirmAuthorIntentCreationRequest(large, ids, actual);
  expect(confirmed).toHaveProperty("request");
  if ("request" in confirmed) {
    expect(confirmed.request.sources).toHaveLength(101);
    expect(confirmed.request.context).toEqual(actual);
  }
});

test("混合表达的重复摘要、重复叙事选择和空段落一律拒绝", () => {
  const summary = { id: crypto.randomUUID(), version: 1 };
  const story = {
    id: crypto.randomUUID(),
    version: 1,
    kind: "assertion" as const,
  };
  for (const changed of [
    { ...context, summaries: [summary, summary] },
    { ...context, story: [story, story] },
    {
      ...context,
      chapters: [
        {
          id: chapter,
          version: 4,
          representation: "paragraphs" as const,
          paragraphIds: [],
        },
      ],
    },
  ] satisfies NarrativeContextRequest[])
    expect(
      confirmAuthorIntentCreationRequest(mixed, [chapter], changed),
    ).toEqual({ error: "context" });
});
test("冻结快照比较忽略成员顺序与缺省字段，但不忽略数组顺序和取值", () => {
  expect(
    sameFrozenSnapshot({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1, c: undefined }),
  ).toBe(true);
  expect(sameFrozenSnapshot({ b: [1, 2] }, { b: [2, 1] })).toBe(false);
  expect(sameFrozenSnapshot({ a: 1 }, { a: 2 })).toBe(false);
  expect(sameFrozenSnapshot(undefined, undefined)).toBe(false);
});
test("链接中重复或空白的身份被视为不明确，不改用最近的", () => {
  const keys = ["intentId", "intentWorkflowId"];
  expect(ambiguousNavigation(new URLSearchParams("intentId=a"), keys)).toBe(
    false,
  );
  expect(
    ambiguousNavigation(new URLSearchParams("intentId=a&intentId=b"), keys),
  ).toBe(true);
  expect(
    ambiguousNavigation(new URLSearchParams("intentWorkflowId=%20"), keys),
  ).toBe(true);
});
