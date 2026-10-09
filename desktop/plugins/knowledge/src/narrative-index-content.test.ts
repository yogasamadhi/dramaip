import { describe, expect, it } from "vitest";
import {
  NarrativeArcScopeSchema,
  NarrativeIndexCatalogSchema,
  NarrativeIndexDetailSchema,
} from "@dramaip/contracts/knowledge";
import type {
  Chapter,
  WritingResource,
  WritingVolume,
} from "@dramaip/contracts/writing";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import {
  buildNarrativeIndex,
  indexParagraphs,
  type IndexRecord,
} from "./narrative-index-content";

const project = { id: crypto.randomUUID(), version: 0, title: "真实全书目录" };
const at = "2026-10-01T00:00:00.000Z";
const chapter = (
  orderIndex = 0,
  content = "小禾🙂保管铜钥匙。\n\n小禾🙂保管铜钥匙。",
): Chapter => ({
  id: crypto.randomUUID(),
  projectId: project.id,
  title: `第${orderIndex + 1}章`,
  orderIndex,
  summary: "此旧摘要字段不是有效事实",
  content,
  version: 0,
  createdAt: at,
  updatedAt: at,
});
function adopted(
  source: Chapter,
  kind = "chapter-memories",
  data: Record<string, unknown> = {
    evidence: "小禾🙂保管铜钥匙。",
    章节摘要: "小禾保管钥匙",
  },
) {
  const workflow: CreationWorkflow = {
    id: crypto.randomUUID(),
    taskId: crypto.randomUUID(),
    input: {
      operation: "chapter-memory",
      engineKind: "codex",
      projectId: project.id,
      targetId: source.id,
      baseVersion: source.version,
      instruction: "只提取当前正文事实",
      sourceIds: [],
    },
    stage: "applied",
    version: 1,
    runIds: [],
    contextSnapshotIds: [],
    referenceVersions: [],
    sources: [{ kind: "chapter", id: source.id, version: source.version }],
    preparedPrompt: "",
    contextEntries: [],
    issues: [],
    output: {
      title: "派生记忆",
      content: "小禾保管钥匙",
      items: [{ ref: "memory", kind, title: "钥匙", data }],
    },
    createdAt: at,
    updatedAt: at,
  };
  const record: IndexRecord = {
    id: crypto.randomUUID(),
    projectId: project.id,
    parentId: source.id,
    kind,
    title: "钥匙",
    payload: {
      ...data,
      sourceChapterId: source.id,
      sourceVersion: source.version,
      sourceWorkflowId: workflow.id,
    },
    version: 0,
    adopted: true,
  };
  return { workflow, record };
}
function build(
  chapters: Chapter[],
  records: IndexRecord[] = [],
  workflows: CreationWorkflow[] = [],
  volumes: WritingVolume[] = [],
  arcs: WritingResource[] = [],
) {
  return buildNarrativeIndex({
    project,
    chapters,
    records,
    workflows: new Map(workflows.map((workflow) => [workflow.id, workflow])),
    volumes,
    arcs,
    unavailable: [],
  });
}
const arc = (payload: Record<string, unknown>): WritingResource => ({
  id: crypto.randomUUID(),
  domain: "story-arcs",
  projectId: project.id,
  title: "钥匙故事弧",
  version: 0,
  payload,
  createdAt: at,
  updatedAt: at,
});

describe("local hierarchical narrative source index", () => {
  it("indexes the actual full directory including the fourth and empty chapter; legacy summary text is not adopted fact", () => {
    const chapters = [chapter(3), chapter(2, ""), chapter(0), chapter(1)];
    const result = build(chapters);
    expect(
      NarrativeIndexCatalogSchema.parse(result.catalog).chapters.map(
        (entry) => entry.title,
      ),
    ).toEqual(["第1章", "第2章", "第3章", "第4章"]);
    expect(result.catalog.groups[0]!.coverage).toMatchObject({
      chapterCount: 4,
      nonEmptyChapterCount: 3,
      currentSummaryChapterCount: 0,
    });
    expect(
      result.catalog.groups[0]!.coverage.missingSummaryChapterIds,
    ).toHaveLength(3);
    expect(result.catalog.chapters[2]!.summaryState).toBe("empty");
    expect(JSON.stringify(result)).not.toContain("此旧摘要字段不是有效事实");
  });
  it("requires exact record adoption and workflow output, exposes all repeated original UTF-16 evidence positions", () => {
    const source = chapter(),
      { record, workflow } = adopted(source);
    const result = build([source], [record], [workflow]);
    const detail = NarrativeIndexDetailSchema.parse(result.details[0]);
    expect(detail.chapter.summaryState).toBe("current");
    expect(detail.paragraphs).toHaveLength(2);
    expect(detail.summaries[0]!.evidence.matches).toHaveLength(2);
    for (const match of detail.summaries[0]!.evidence.matches)
      expect(source.content.slice(match.start, match.end)).toBe(
        record.payload.evidence,
      );
    expect(
      detail.summaries[0]!.evidence.matches.map((match) => match.paragraphIds),
    ).toEqual(detail.paragraphs.map((paragraph) => [paragraph.id]));
    expect(
      indexParagraphs({ ...source, version: 1 }).map((entry) => entry.id),
    ).not.toEqual(detail.paragraphs.map((entry) => entry.id));
  });
  it("excludes copied receipts, edited records, pending workflows, missing fields and invented quotes, without revealing excluded payload", () => {
    const source = chapter(),
      { record, workflow } = adopted(source);
    const missing = adopted(source, "chapter-memories", {
      evidence: "小禾🙂保管铜钥匙。",
    });
    const invalid = adopted(source, "story-events", {
      evidence: "不存在的私密推测",
      事件描述: "不应纳入",
    });
    const pending = adopted(source);
    const records = [
      { ...record, adopted: false },
      { ...record, id: crypto.randomUUID(), version: 1 },
      {
        ...record,
        id: crypto.randomUUID(),
        payload: {
          ...record.payload,
          章节摘要: "复制标记不使私密推测变成事实",
        },
      },
      missing.record,
      invalid.record,
      pending.record,
    ];
    const result = build([source], records, [
      workflow,
      missing.workflow,
      invalid.workflow,
      { ...pending.workflow, stage: "awaiting-review" },
    ]);
    expect(
      result.details[0]!.excluded.map((entry) => entry.reason).sort(),
    ).toEqual(
      [
        "unverified-adoption",
        "modified-record",
        "modified-record",
        "missing-summary",
        "invalid-evidence",
        "unverified-adoption",
      ].sort(),
    );
    expect(result.details[0]!.summaries).toHaveLength(0);
    expect(result.details[0]!.facts).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("私密推测");
  });
  it("marks actual old adopted summaries stale and changes the index fingerprint when source or adoption validity changes", () => {
    const source = chapter(),
      { record, workflow } = adopted(source);
    const before = build([source], [record], [workflow]);
    const after = build([{ ...source, version: 1 }], [record], [workflow]);
    expect(after.details[0]!.chapter.summaryState).toBe("stale");
    expect(after.details[0]!.excluded[0]!.reason).toBe("source-stale");
    expect(after.catalog.fingerprint).not.toBe(before.catalog.fingerprint);
    expect(
      build([source], [record], [{ ...workflow, stage: "failed" }]).catalog
        .fingerprint,
    ).not.toBe(before.catalog.fingerprint);
    expect(build([source], [record], [workflow]).catalog.fingerprint).toBe(
      before.catalog.fingerprint,
    );
  });
  it("uses real volume membership and explicitly ordered versioned arc references, never numeric chapter ranges or parent title guesses", () => {
    const a = chapter(0),
      b = chapter(1);
    const volume: WritingVolume = {
      id: crypto.randomUUID(),
      projectId: project.id,
      title: "真实第一卷",
      outline: "不是卷事实摘要",
      orderIndex: 0,
      version: 0,
      createdAt: at,
      updatedAt: at,
    };
    a.volumeId = volume.id;
    const legacy = arc({ 起始章节: 1, 结束章节: 2 });
    const explicit = arc({
      narrativeChapterScope: {
        format: "chapter-refs-v1",
        chapters: [a, b].map(({ id, version }) => ({ id, version })),
      },
    });
    const result = build([b, a], [], [], [volume], [legacy, explicit]);
    expect(
      result.catalog.groups.find((group) => group.kind === "volume")
        ?.chapterIds,
    ).toEqual([a.id]);
    expect(
      result.catalog.groups.find((group) => group.id === legacy.id),
    ).toMatchObject({ chapterIds: [], state: "unbound" });
    expect(
      result.catalog.groups.find((group) => group.id === explicit.id),
    ).toMatchObject({ chapterIds: [a.id, b.id], state: "current" });
    const reordered = build(
      [
        { ...a, orderIndex: 1 },
        { ...b, orderIndex: 0 },
      ],
      [],
      [],
      [volume],
      [explicit],
    );
    expect(
      reordered.catalog.groups.find((group) => group.id === explicit.id),
    ).toMatchObject({ state: "stale", coverage: { chapterCount: 0 } });
    const foreign = { ...b, projectId: crypto.randomUUID() };
    expect(
      build([a, foreign], [], [], [volume], [explicit]).catalog.groups.find(
        (group) => group.id === explicit.id,
      )?.state,
    ).toBe("stale");
    expect(
      NarrativeArcScopeSchema.safeParse({
        format: "chapter-refs-v1",
        chapters: [
          { id: a.id, version: 0 },
          { id: a.id, version: 0 },
        ],
      }).success,
    ).toBe(false);
  });
  it("inventories orphaned records and missing volumes, with no silent 100-record truncation", () => {
    const source = chapter();
    source.volumeId = crypto.randomUUID();
    const records = Array.from({ length: 151 }, () => ({
      ...adopted(source).record,
      adopted: false,
    }));
    const orphan = {
      ...records[0]!,
      id: crypto.randomUUID(),
      parentId: undefined,
      payload: {},
    };
    const result = build([source], [...records, orphan]);
    expect(result.details[0]!.excluded).toHaveLength(151);
    expect(result.catalog.unassignedRecords).toEqual([
      { id: orphan.id, version: 0, reason: "chapter-unbound" },
    ]);
    expect(result.catalog.unavailable[0]).toContain("卷归属");
  });
  it("indexes only confirmed current derived event/state/foreshadowing facts, without synthesizing higher-level summaries", () => {
    const source = chapter();
    const entries = [
      adopted(source, "story-events", {
        evidence: "小禾🙂保管铜钥匙。",
        事件描述: "保管钥匙",
      }),
      adopted(source, "character-states", {
        evidence: "小禾🙂保管铜钥匙。",
        当前状态: "小禾持有钥匙",
      }),
      adopted(source, "foreshadowings", {
        evidence: "小禾🙂保管铜钥匙。",
        伏笔说明: "钥匙的保管",
      }),
    ];
    const result = build(
      [source],
      entries.map((entry) => entry.record),
      entries.map((entry) => entry.workflow),
    );
    expect(result.details[0]!.facts).toHaveLength(3);
    expect(result.details[0]!.chapter.summaryState).toBe("missing");
    expect(result.catalog.groups[0]!.coverage.currentSummaryChapterCount).toBe(
      0,
    );
  });
});
