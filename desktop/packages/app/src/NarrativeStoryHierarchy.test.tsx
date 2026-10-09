import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createStudioClient } from "@dramaip/client";
import {
  NarrativeStoryHierarchySchema,
  type NarrativeStoryHierarchy,
  type NarrativeStoryIndexEntry,
} from "@dramaip/contracts/knowledge";
import {
  narrativeStoryConnection,
  narrativeStoryDirectory,
  narrativeStoryOrigins,
  narrativeStoryVisibleEntries,
  storyGroupKey,
} from "./narrative-story-hierarchy";
import { narrativeStoryScopeReasons } from "./narrative-story-scope";
import {
  NarrativeStoryHierarchyView,
  NarrativeStoryOriginView,
  NarrativeStoryStructureView,
  NarrativeEventTimelineView,
} from "./features/creative/NarrativeStoryHierarchy";
import {
  emptyEventTimelineDraft,
  eventTimelineInput,
  StoryEventTimelineFields,
} from "./features/creative/StoryEventTimeline";
import { StoryDeclarationInputSchema } from "@dramaip/contracts/knowledge";

const projectId = crypto.randomUUID(),
  chapterA = crypto.randomUUID(),
  chapterB = crypto.randomUUID();
const base = { version: 0, state: "current" as const, reasons: [] };
function hierarchy() {
  return NarrativeStoryHierarchySchema.parse({
    state: "available",
    projectId,
    projectVersion: 0,
    fingerprint: "a".repeat(64),
    membershipPolicy:
      "current-directory-not-frozen-membership-or-read-coverage",
    chapters: [
      { id: chapterA, version: 3, title: "原始第一章", orderIndex: 0 },
      { id: chapterB, version: 4, title: "跨卷第二章", orderIndex: 1 },
    ],
    groups: [
      {
        ...base,
        kind: "book",
        id: projectId,
        title: "实际全书",
        chapterIds: [chapterA, chapterB],
      },
      {
        ...base,
        kind: "volume",
        id: crypto.randomUUID(),
        title: "第一卷",
        chapterIds: [chapterA],
      },
      {
        ...base,
        kind: "volume",
        id: crypto.randomUUID(),
        title: "第二卷",
        chapterIds: [chapterB],
      },
      {
        ...base,
        kind: "story-arc",
        id: crypto.randomUUID(),
        title: "明确跨卷弧",
        chapterIds: [chapterA, chapterB],
      },
      {
        ...base,
        kind: "story-arc",
        id: crypto.randomUUID(),
        title: "旧章号弧",
        chapterIds: [],
        state: "unbound",
        reasons: ["旧章号不猜测范围"],
      },
      {
        ...base,
        kind: "story-arc",
        id: crypto.randomUUID(),
        title: "失效弧",
        chapterIds: [chapterA],
        state: "stale",
        reasons: ["原范围失效，不换源"],
      },
    ],
  }) as Extract<NarrativeStoryHierarchy, { state: "available" }>;
}
const entry: NarrativeStoryIndexEntry = {
  selection: { kind: "assertion", id: crypto.randomUUID(), version: 1 },
  projectId,
  title: "跨章跨卷关系",
  statement: "人物的行动揭示秘密，是作者推断",
  classification: "relationship",
  status: "adopted",
  sourceFingerprint: "b".repeat(64),
  sourceState: "current",
  record: { kind: "edge", id: crypto.randomUUID(), version: 0 },
  retirement: "active",
  interpretation: "author-inferred",
  eligibility: { state: "eligible", reasons: [] },
  sourceChapters: [
    { id: chapterA, version: 3 },
    { id: chapterB, version: 4 },
  ],
  sourceScripts: [],
  endpoints: [
    { id: crypto.randomUUID(), version: 1, title: "人物甲", kind: "character" },
    { id: crypto.randomUUID(), version: 2, title: "秘密乙", kind: "secret" },
  ],
  relation: "reveals",
};
entry.relationshipEndpoints = {
  from: { id: entry.endpoints[0]!.id, version: entry.endpoints[0]!.version },
  to: { id: entry.endpoints[1]!.id, version: entry.endpoints[1]!.version },
};

test("event timeline keeps explicit story-time order, ties, unmarked and stale history without using chapter or cognition order or mutating input", () => {
  const event = (order?: number): NarrativeStoryIndexEntry => ({
    ...entry,
    selection: { kind: "declaration", id: crypto.randomUUID(), version: 1 },
    classification: "event",
    endpoints: [],
    relation: undefined,
    relationshipEndpoints: undefined,
    eventTimeline:
      order === undefined
        ? undefined
        : {
            storyOrder: order,
            timeLabel: `作者时间 ${order}`,
            interpretation: "author-inferred",
          },
  });
  const later = event(20),
    first = event(0),
    tied = event(0),
    unmarked = event();
  first.sourceChapters = [{ id: chapterB, version: 4 }];
  later.sourceChapters = [{ id: chapterA, version: 3 }];
  tied.sourceState = "stale";
  tied.eligibility = { state: "ineligible", reasons: ["原来源变动"] };
  const input = [later, unmarked, entry, tied, first],
    before = structuredClone(input);
  const html = renderToStaticMarkup(
    <NarrativeEventTimelineView
      entries={input}
      directory={narrativeStoryDirectory(hierarchy())}
    />,
  );
  expect(input).toEqual(before);
  for (const value of [later, first, tied, unmarked])
    expect(html).toContain(`data-story-timeline-id="${value.selection.id}"`);
  expect(
    html.indexOf(`data-story-timeline-id="${first.selection.id}"`),
  ).toBeLessThan(
    html.indexOf(`data-story-timeline-id="${later.selection.id}"`),
  );
  expect(
    html.indexOf(`data-story-timeline-id="${tied.selection.id}"`),
  ).toBeLessThan(
    html.indexOf(`data-story-timeline-id="${later.selection.id}"`),
  );
  expect(
    html.indexOf(`data-story-timeline-id="${later.selection.id}"`),
  ).toBeLessThan(
    html.indexOf(`data-story-timeline-id="${unmarked.selection.id}"`),
  );
  expect(html).not.toContain(`data-story-timeline-id="${entry.selection.id}"`);
  for (const text of [
    "时间未标注",
    "相同顺序只并列",
    "作者推断",
    "不是语义认证",
  ]) {
    expect(html).toContain(text);
  }
  expect(html).toContain(chapterA);
  expect(html).toContain(chapterB);
});

test("event time form remains optional, rejects an empty order rather than silently using zero and never sends event time for other node kinds", () => {
  const empty = emptyEventTimelineDraft();
  expect(eventTimelineInput("event", empty)).toEqual({});
  const enabled = { ...empty, enabled: true, timeLabel: "开场前一日" };
  expect(eventTimelineInput("character", enabled)).toEqual({});
  const source = {
    kind: "paragraphs",
    chapterId: chapterA,
    chapterVersion: 3,
    chapterContentHash: "a".repeat(64),
    paragraphIds: ["actual-original-paragraph"],
  };
  const input = {
    kind: "event",
    title: "实际事件",
    statement: "作者解释",
    sources: [source],
  };
  expect(
    StoryDeclarationInputSchema.safeParse({
      ...input,
      ...eventTimelineInput("event", enabled),
    }).success,
  ).toBe(false);
  expect(
    StoryDeclarationInputSchema.parse({
      ...input,
      ...eventTimelineInput("event", { ...enabled, order: "0" }),
    }).eventTimeline?.storyOrder,
  ).toBe(0);
  const html = renderToStaticMarkup(
    <StoryEventTimelineFields value={empty} onChange={() => {}} />,
  );
  expect(html).toContain("明确标注此事件");
  expect(html).not.toContain('type="number"');
  expect(html).toContain("不是讲述顺序");
});

test("hierarchy display associates only exact current source versions and preserves full cross-volume closure under group/chapter filters", () => {
  const h = hierarchy(),
    d = narrativeStoryDirectory(h),
    group = h.groups[1]!;
  const original = structuredClone(entry);
  expect(
    narrativeStoryVisibleEntries([entry], d, {
      groupKey: storyGroupKey(group),
    }),
  ).toEqual([entry]);
  expect(
    narrativeStoryVisibleEntries([entry], d, { chapterId: chapterA }),
  ).toEqual([entry]);
  const origins = narrativeStoryOrigins(entry, d);
  expect(origins).toHaveLength(2);
  expect(origins[0]!.groups.map((g) => g.title)).toEqual([
    "实际全书",
    "第一卷",
    "明确跨卷弧",
  ]);
  expect(origins[1]!.groups.map((g) => g.title)).toEqual([
    "实际全书",
    "第二卷",
    "明确跨卷弧",
  ]);
  expect(
    narrativeStoryVisibleEntries([entry], d, {
      groupKey: storyGroupKey(h.groups[4]!),
    }),
  ).toEqual([]);
  expect(
    narrativeStoryVisibleEntries([entry], d, {
      groupKey: storyGroupKey(h.groups[5]!),
    }),
  ).toEqual([]);
  expect(
    narrativeStoryScopeReasons(entry, projectId, [
      { id: chapterA, projectId, version: 3, content: "正文" },
    ]),
  ).toContain(
    "包含未确认范围、当前章／后文或旧章节版本；不能截掉部分来源使用。",
  );
  expect(entry).toEqual(original);
  const text = renderToStaticMarkup(
    <NarrativeStoryStructureView entries={[entry]} directory={d} />,
  );
  for (const expected of [
    chapterA,
    chapterB,
    "第一卷",
    "第二卷",
    "明确跨卷弧",
    "人物甲",
    "秘密乙",
    "揭示",
    "不是正文时间线",
    "全部跨章／跨卷来源",
  ])
    expect(text).toContain(expected);
});

test("chapter edits, missing chapters and unavailable owner metadata never rebind old sources to current groups or imply empty coverage", () => {
  const h = hierarchy();
  h.chapters[0]!.version = 4;
  const d = narrativeStoryDirectory(h);
  expect(narrativeStoryOrigins(entry, d)[0]).toMatchObject({
    state: "stale",
    source: { id: chapterA, version: 3 },
    groups: [],
  });
  expect(
    narrativeStoryVisibleEntries([entry], d, {
      groupKey: storyGroupKey(h.groups[1]!),
    }),
  ).toEqual([]);
  expect(
    renderToStaticMarkup(
      <NarrativeStoryOriginView entry={entry} directory={d} />,
    ),
  ).toContain("未把旧源重绑当前卷／故事弧");
  d.chapters.delete(chapterA);
  expect(narrativeStoryOrigins(entry, d)[0]).toMatchObject({
    state: "missing",
    groups: [],
  });
  for (const unavailable of [
    undefined,
    {
      state: "unavailable",
      projectId,
      reason: "基础叙事目录归属暂不可完整核对，未换源或认定为空范围。",
    } as const,
  ]) {
    const current = narrativeStoryDirectory(unavailable);
    expect(
      narrativeStoryOrigins(entry, current).every(
        (origin) => origin.state === "unavailable" && !origin.groups.length,
      ),
    ).toBe(true);
    expect(
      narrativeStoryVisibleEntries([entry], current, {
        groupKey: storyGroupKey(h.groups[1]!),
      }),
    ).toEqual([]);
    expect(narrativeStoryVisibleEntries([entry], current, {})).toEqual([entry]);
    expect(
      renderToStaticMarkup(<NarrativeStoryHierarchyView directory={current} />),
    ).toContain("不认定为空范围");
  }
});

test("script-only and empty-chapter projects remain independent; stale and unbound arcs remain visible without guessed chapter membership", () => {
  const h = hierarchy(),
    d = narrativeStoryDirectory(h);
  const script = {
    ...entry,
    sourceChapters: [],
    sourceScripts: [{ id: crypto.randomUUID(), version: 2 }],
  };
  expect(narrativeStoryVisibleEntries([script], d, {})).toEqual([script]);
  expect(
    narrativeStoryVisibleEntries([script], d, {
      groupKey: storyGroupKey(h.groups[0]!),
    }),
  ).toEqual([]);
  expect(
    renderToStaticMarkup(
      <NarrativeStoryOriginView entry={script} directory={d} />,
    ),
  ).toContain("不强制转换为小说章节");
  const html = renderToStaticMarkup(
    <NarrativeStoryHierarchyView directory={d} />,
  );
  for (const expected of [
    "旧章号弧",
    "未绑定实际章节",
    "失效弧",
    "原范围失效",
    "旧弧不绑定此当前版本",
    "不是原声明冻结时的归属",
  ])
    expect(html).toContain(expected);
  const empty = NarrativeStoryHierarchySchema.parse({
    ...h,
    chapters: [],
    groups: [{ ...h.groups[0], chapterIds: [] }],
  });
  expect(
    renderToStaticMarkup(
      <NarrativeStoryHierarchyView
        directory={narrativeStoryDirectory(empty)}
      />,
    ),
  ).toContain("不推断不存在故事内容");
});

test("cognition distinguishes actual character/audience subjects, sorts declared order and retains historical or incomplete identities without claiming semantic chronology", () => {
  const first = {
    ...entry,
    classification: "cognition" as const,
    cognitionSubject: {
      kind: "character" as const,
      node: {
        id: entry.endpoints[0]!.id,
        version: entry.endpoints[0]!.version,
      },
    },
    cognitionTarget: {
      id: entry.endpoints[1]!.id,
      version: entry.endpoints[1]!.version,
    },
    relationshipEndpoints: undefined,
    storyOrder: 2,
    knowledgeState: "suspects" as const,
  };
  const late = {
    ...first,
    selection: { ...first.selection, id: crypto.randomUUID() },
    storyOrder: 8,
    retirement: "withdrawn" as const,
    eligibility: { state: "ineligible" as const, reasons: ["已撤回"] },
  };
  const audience = {
    ...first,
    selection: { ...first.selection, id: crypto.randomUUID() },
    cognitionSubject: { kind: "audience" as const, id: "第一集观众" },
    endpoints: [entry.endpoints[1]!],
    storyOrder: 5,
  };
  const entries = narrativeStoryVisibleEntries(
    [late, entry, audience, first],
    narrativeStoryDirectory(hierarchy()),
    { view: "cognition" },
  );
  expect(entries).toEqual([first, audience, late]);
  expect(narrativeStoryConnection(first)).toContain("人物甲 v1");
  expect(narrativeStoryConnection(first)).toContain("秘密乙 v2");
  expect(narrativeStoryConnection(audience)).toContain("观众");
  expect(narrativeStoryConnection(audience)).toContain("第一集观众");
  expect(narrativeStoryConnection(audience)).not.toContain("人物甲");
  expect(
    narrativeStoryConnection({ ...first, cognitionSubject: undefined }),
  ).toContain("原认知主体类型未核全");
  expect(
    narrativeStoryVisibleEntries([entry, first], narrativeStoryDirectory(), {
      view: "relationship",
    }),
  ).toEqual([entry]);
});

test("strict hierarchy SDK rejects foreign scope, duplicate or overlapping identities, missing full-book membership and private injected fields", async () => {
  const h = hierarchy();
  const reply = {
    projectId,
    fingerprint: "c".repeat(64),
    evidencePolicy:
      "source-anchored-human-interpretations-not-semantic-proof" as const,
    entries: [entry],
    hierarchy: h,
  };
  let value: unknown = reply;
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: crypto.randomUUID(),
    runtimeGeneration: 1,
    fetch: async () => Response.json(value),
    openEventStream: async () => new Response(),
  }).narrativeStoryIndex;
  expect(await sdk.catalog(projectId)).toEqual(reply);
  for (const malformed of [
    { ...h, projectId: crypto.randomUUID() },
    { ...h, chapters: [...h.chapters, h.chapters[0]] },
    { ...h, groups: [...h.groups, h.groups[1]] },
    { ...h, groups: h.groups.slice(1) },
    {
      ...h,
      chapters: h.chapters.map((chapter) => ({
        ...chapter,
        quote: "私密原文",
      })),
    },
    {
      ...h,
      groups: h.groups.map((group, index) =>
        index === 2 ? { ...group, chapterIds: [chapterA] } : group,
      ),
    },
    {
      ...h,
      groups: h.groups.map((group, index) =>
        index === 4 ? { ...group, chapterIds: [chapterA] } : group,
      ),
    },
  ]) {
    value = { ...reply, hierarchy: malformed };
    await expect(sdk.catalog(projectId)).rejects.toThrow();
  }
});

test("relationship-classified declaration nodes are not confused with adopted assertion edges or omitted from node view", () => {
  const node = {
    ...entry,
    selection: {
      kind: "declaration" as const,
      id: crypto.randomUUID(),
      version: 1,
    },
    relationshipEndpoints: undefined,
    relation: undefined,
    endpoints: [],
  };
  const directory = narrativeStoryDirectory(hierarchy());
  expect(
    narrativeStoryVisibleEntries([node, entry], directory, { view: "nodes" }),
  ).toEqual([node]);
  expect(
    narrativeStoryVisibleEntries([node, entry], directory, {
      view: "relationship",
    }),
  ).toEqual([entry]);
  expect(
    renderToStaticMarkup(
      <NarrativeStoryStructureView entries={[node]} directory={directory} />,
    ),
  ).toBe("");
});
