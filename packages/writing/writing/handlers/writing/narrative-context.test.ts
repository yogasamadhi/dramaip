import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  NarrativeContextBasisSchema,
  type NarrativeContextRequest,
} from "@dramaip/contracts/creation";
import type { Chapter } from "@dramaip/contracts/writing";
import type {
  NarrativeIndexDetail,
  NarrativeSummary,
} from "@dramaip/contracts/knowledge";
import {
  AUTO_NOVEL_CONTEXT_LIMITS,
  automaticNovelContextRequest,
  isEmptyNarrativeContextRequest,
  prepareNovelContext,
  prepareNarrativeSources,
} from "./narrative-context";
import { novelContextNote } from "./chapter-writing-method";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const chapter = (orderIndex: number, content = "🙂甲段原文。\n\n乙段原文。") =>
  ({
    id: crypto.randomUUID(),
    projectId: "project",
    version: 1,
    orderIndex,
    title: `章${orderIndex}`,
    content,
    summary: "不可信旧摘要",
  }) as Chapter;
const first = chapter(0),
  omitted = chapter(1),
  fourth = chapter(3),
  target = chapter(4),
  empty = chapter(2, "");
const summary = {
  id: crypto.randomUUID(),
  version: 0,
  sourceWorkflowId: crypto.randomUUID(),
  text: "已采用派生摘要",
  evidence: {
    quote: "🙂甲段原文。",
    matches: [{ start: 0, end: 8, paragraphIds: ["first-paragraph"] }],
  },
};
const index = (source: Chapter): NarrativeIndexDetail =>
  ({
    projectId: source.projectId,
    fingerprint: "0".repeat(64),
    chapter: { ...source, contentHash: hash(source.content) },
    summaries: [summary],
    facts: [],
    excluded: [],
    paragraphs: [
      {
        id: "first-paragraph",
        start: 0,
        end: 8,
        contentHash: hash(source.content.slice(0, 8)),
      },
    ],
  }) as unknown as NarrativeIndexDetail;
const request = (...chapters: NarrativeContextRequest["chapters"]) => ({
  format: "narrative-context-v1" as const,
  chapters,
});
const higher = (sources: Chapter[]): NarrativeSummary => ({
  id: crypto.randomUUID(),
  projectId: target.projectId,
  workflowId: crypto.randomUUID(),
  version: 1,
  status: "adopted",
  isHead: true,
  isCurrent: false,
  sourceState: "stale",
  staleReasons: ["完整目录新增目标章。"],
  contextEligibility: { state: "eligible", reasons: [] },
  basis: {
    request: {
      target: { kind: "book", id: crypto.randomUUID(), version: 0 },
      scopeFingerprint: "a".repeat(64),
      expectedHead: null,
      chapters: sources.map(({ id, version }) => ({
        id,
        version,
        representation: "original",
      })),
    },
    scopeTitle: "原冻结全书范围",
    directory: sources.map(({ id, version, orderIndex, content }) => ({
      id,
      version,
      orderIndex,
      contentHash: hash(content),
      hasContent: true,
    })),
    references: sources.map(({ id, version, title, orderIndex, content }) => ({
      chapter: { id, version },
      representation: "original",
      sourceKind: "chapter",
      sourceId: id,
      sourceVersion: version,
      fieldPath: `/chapters/${id}`,
      contentHash: hash({ id, version, title, orderIndex, content }),
    })),
  },
  content: {
    summary: "高层摘要只有派生概括，不夹带原文依据。",
    coveredChapters: sources.map(({ id, version }) => ({ id, version })),
    evidence: sources.map(({ id, version }) => ({
      chapter: { id, version },
      sourceId: id,
      sourceVersion: version,
      fieldPath: `/chapters/${id}`,
      quote: "甲段原文。",
    })),
  },
  sourceSnapshotId: crypto.randomUUID(),
  runIds: [],
  engineKind: "pi",
  contextBudget: {
    source: "estimate",
    tokenBudget: 64000,
    estimatedTokens: 300,
  },
  usage: { state: "unknown" },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
});
describe("explicit novel context compiler", () => {
  it("compiles a real confirmed quality range without a fake chapter target and never slices higher coverage outside that range", () => {
    const projectId = crypto.randomUUID();
    const a = { ...first, projectId },
      b = { ...fourth, projectId };
    const source = { ...higher([a, b]), projectId };
    const chosen: NarrativeContextRequest = {
      ...request({
        id: b.id,
        version: b.version,
        representation: "paragraphs",
        paragraphIds: ["first-paragraph"],
      }),
      summaries: [{ id: source.id, version: source.version }],
    };
    const prepared = prepareNarrativeSources(
      projectId,
      [a, b],
      chosen,
      () => index(b),
      () => source,
    );
    expect(prepared.basis).toMatchObject({
      kind: "author-selected-narrative-sources",
      projectId,
      omitted: [],
    });
    expect(prepared.basis).not.toHaveProperty("target");
    expect(prepared.references).toHaveLength(2);
    expect(
      prepared.references.some((ref) => ref.fieldPath === `/chapters/${a.id}`),
    ).toBe(false);
    expect(JSON.stringify(prepared.references[0]!.value)).not.toContain(
      "甲段原文",
    );
    expect(() =>
      prepareNarrativeSources(
        projectId,
        [b],
        chosen,
        () => index(b),
        () => source,
      ),
    ).toThrow(/范围外/u);
    expect(() =>
      prepareNarrativeSources(
        projectId,
        [a, b],
        {
          ...chosen,
          chapters: [
            { id: b.id, version: b.version + 1, representation: "original" },
          ],
        },
        () => index(b),
        () => source,
      ),
    ).toThrow(/旧版本/u);
  });
  it("mixes exact adopted higher range with actual original paragraphs, deduplicates coverage and inherits all original and intermediate privacy paths", () => {
    const source = higher([first, fourth]);
    source.basis.references[0] = {
      ...source.basis.references[0]!,
      sourceKind: "knowledge",
      sourceId: summary.id,
      sourceVersion: summary.version,
      fieldPath: `/knowledge/${summary.id}`,
    };
    const value = prepareNovelContext(
      target,
      [first, omitted, empty, fourth, target],
      {
        ...request({
          id: fourth.id,
          version: fourth.version,
          representation: "paragraphs",
          paragraphIds: ["first-paragraph"],
        }),
        summaries: [{ id: source.id, version: source.version }],
      },
      () => index(fourth),
      () => source,
    );
    expect(value.basis.omitted.map((item) => item.id)).toEqual([
      omitted.id,
      empty.id,
    ]);
    expect(value.basis.summaries?.[0]?.chapters.map((item) => item.id)).toEqual(
      [first.id, fourth.id],
    );
    expect(value.basis.summaries?.[0]?.scopeState).toBe("stale");
    expect(NarrativeContextBasisSchema.parse(value.basis)).toEqual(value.basis);
    expect(value.references).toHaveLength(3);
    expect(JSON.stringify(value.references[1]?.value)).toContain(
      source.content.summary,
    );
    expect(JSON.stringify(value.references[1]?.value)).not.toContain(
      "甲段原文",
    );
    expect(
      value.references[1]?.policyDependencies?.map((item) => item.fieldPath),
    ).toEqual([
      `/chapters/${first.id}`,
      `/chapters/${fourth.id}`,
      `/knowledge/${summary.id}`,
    ]);
  });
  it("rejects higher-summary candidates old heads versions foreign sources future coverage or stale lineage without silently trimming or selecting latest", () => {
    const source = higher([first, fourth]);
    const run = (summary: NarrativeSummary | undefined, version = 1) =>
      prepareNovelContext(
        target,
        [first, omitted, empty, fourth, target],
        { ...request(), summaries: [{ id: source.id, version }] },
        () => {
          throw new Error("no implicit chapter detail");
        },
        () => summary,
      );
    expect(run(source).references).toHaveLength(2);
    for (const value of [
      undefined,
      { ...source, projectId: "foreign" },
      { ...source, version: 2 },
      { ...source, status: "awaiting-review" as const },
      { ...source, isHead: false },
      {
        ...source,
        contextEligibility: { state: "ineligible" as const, reasons: ["源变"] },
      },
      {
        ...source,
        content: {
          ...source.content,
          coveredChapters: [{ id: target.id, version: target.version }],
        },
      },
    ])
      expect(() => run(value)).toThrow();
    expect(() => run(source, 0)).toThrow();
    expect(() =>
      prepareNovelContext(
        target,
        [first, fourth, target],
        {
          ...request(),
          summaries: [
            { id: source.id, version: 1 },
            { id: source.id, version: 1 },
          ],
        },
        () => index(first),
        () => source,
      ),
    ).toThrow();
    const changed = { ...first, content: "新原文", version: first.version + 1 };
    expect(() =>
      prepareNovelContext(
        target,
        [changed, fourth, target],
        {
          ...request(),
          summaries: [{ id: source.id, version: 1 }],
        },
        () => index(first),
        () => source,
      ),
    ).toThrow();
  });
  it("never invents implicit early/recent chapters or legacy summaries", () => {
    const result = prepareNovelContext(
      target,
      [first, omitted, empty, fourth, target],
      undefined,
      () => {
        throw new Error("no reads");
      },
    );
    expect(result.references).toHaveLength(1);
    expect(JSON.stringify(result.references)).not.toContain("不可信旧摘要");
    expect(result.basis.omitted.map((item) => item.reason)).toEqual([
      "not-selected",
      "not-selected",
      "empty",
      "not-selected",
    ]);
  });
  it("selects first-and-fourth with exact adopted summary or actual paragraph text and original policy ancestry", () => {
    const result = prepareNovelContext(
      target,
      [first, omitted, empty, fourth, target],
      request(
        {
          id: first.id,
          version: first.version,
          representation: "summary",
          record: { id: summary.id, version: summary.version },
        },
        {
          id: fourth.id,
          version: fourth.version,
          representation: "paragraphs",
          paragraphIds: ["first-paragraph"],
        },
      ),
      (id) => index(id === first.id ? first : fourth),
    );
    expect(result.references).toHaveLength(3);
    expect(JSON.stringify(result.references)).not.toContain(omitted.id);
    expect(JSON.stringify(result.references.slice(1))).not.toContain(
      "乙段原文",
    );
    expect(NarrativeContextBasisSchema.parse(result.basis)).toEqual(
      result.basis,
    );
    // The target itself contains both paragraphs; only selected previous values exclude it.
    expect(result.references[1]?.policyDependencies?.[0]?.fieldPath).toBe(
      `/chapters/${first.id}`,
    );
    expect(result.references[2]?.policyDependencies?.[0]?.fieldPath).toBe(
      `/chapters/${fourth.id}`,
    );
    expect((result.references[1]!.value as { summary: string }).summary).toBe(
      summary.text,
    );
  });
  it("rejects missing/old/foreign/future/duplicate/unordered sources and unverified summaries instead of rebinding", () => {
    for (const selection of [
      { id: first.id, version: 0, representation: "original" },
      { id: crypto.randomUUID(), version: 1, representation: "original" },
      { id: target.id, version: 1, representation: "original" },
      { id: empty.id, version: 1, representation: "original" },
      {
        id: first.id,
        version: 1,
        representation: "summary",
        record: { id: crypto.randomUUID(), version: 0 },
      },
      {
        id: first.id,
        version: 1,
        representation: "paragraphs",
        paragraphIds: ["old-paragraph"],
      },
    ] as NarrativeContextRequest["chapters"])
      expect(() =>
        prepareNovelContext(
          target,
          [first, empty, target],
          request(selection),
          () => index(first),
        ),
      ).toThrow();
    const original = {
      id: first.id,
      version: 1,
      representation: "original" as const,
    };
    expect(() =>
      prepareNovelContext(
        target,
        [first, fourth, target],
        request(original, original),
        () => index(first),
      ),
    ).toThrow();
    expect(() =>
      prepareNovelContext(
        target,
        [first, fourth, target],
        request({ ...original, id: fourth.id }, original),
        () => index(first),
      ),
    ).toThrow();
  });
});

describe("automatic chapter context", () => {
  const book = (count: number, length = 2_000) =>
    Array.from({ length: count }, (_, position) =>
      chapter(position, `第${position}章正文。`.padEnd(length, "字")),
    );
  const detailOf = (list: Chapter[]) => (id: string) =>
    index(list.find((item) => item.id === id)!);

  it("treats only a request with no chapters, summaries or story as empty", () => {
    expect(isEmptyNarrativeContextRequest(undefined)).toBe(true);
    expect(isEmptyNarrativeContextRequest(request())).toBe(true);
    expect(
      isEmptyNarrativeContextRequest(
        request({ id: first.id, version: 1, representation: "original" }),
      ),
    ).toBe(false);
  });

  it("gives a first chapter no prior context", () => {
    const [only] = book(1);
    expect(automaticNovelContextRequest(only!, [only!], detailOf([only!])).chapters).toEqual(
      [],
    );
  });

  it("includes recent chapters in full and earlier ones by summary, in directory order", () => {
    const chapters = book(8);
    const next = chapters[7]!;
    const value = automaticNovelContextRequest(next, chapters, detailOf(chapters));
    const originals = value.chapters.filter(
      (item) => item.representation === "original",
    );
    expect(originals.map((item) => item.id)).toEqual(
      chapters.slice(4, 7).map((item) => item.id),
    );
    expect(
      value.chapters
        .filter((item) => item.representation === "summary")
        .map((item) => item.id),
    ).toEqual(chapters.slice(0, 4).map((item) => item.id));
    // The default request must pass the same validation as a manual one.
    const prepared = prepareNovelContext(next, chapters, value, detailOf(chapters));
    expect(prepared.basis.chapters).toHaveLength(7);
    expect(prepared.basis.omitted).toEqual([]);
  });

  it("keeps the latest chapter even when it alone exceeds the original budget", () => {
    const chapters = book(3, AUTO_NOVEL_CONTEXT_LIMITS.originalChars + 1);
    const value = automaticNovelContextRequest(chapters[2]!, chapters, detailOf(chapters));
    expect(value.chapters.map((item) => item.representation)).toEqual([
      "summary",
      "original",
    ]);
  });

  it("skips empty, later and stale-summary chapters and survives a missing index", () => {
    const chapters = book(6, 4_000);
    const blank = { ...chapters[1]!, content: "  " };
    const directory = [chapters[0]!, blank, ...chapters.slice(2)];
    const fresh = detailOf(directory);
    const stale = (id: string) =>
      id === chapters[0]!.id
        ? { ...fresh(id), chapter: { ...fresh(id).chapter, version: 9 } }
        : fresh(id);
    const value = automaticNovelContextRequest(chapters[4]!, directory, stale);
    expect(value.chapters.map((item) => item.id)).toEqual(
      chapters.slice(2, 4).map((item) => item.id),
    );
    const noIndex = automaticNovelContextRequest(chapters[5]!, directory, () => {
      throw new Error("index unavailable");
    });
    expect(noIndex.chapters.map((item) => item.representation)).toEqual([
      "original",
      "original",
    ]);
    expect(noIndex.chapters.map((item) => item.id)).toEqual(
      chapters.slice(3, 5).map((item) => item.id),
    );
  });

  it("skips sources the privacy policy denies and summarises an oversized latest chapter", () => {
    const chapters = book(5);
    const value = automaticNovelContextRequest(
      chapters[4]!,
      chapters,
      detailOf(chapters),
      (path) => path !== `/chapters/${chapters[3]!.id}`,
    );
    expect(value.chapters.map((item) => item.id)).toEqual(
      chapters.slice(0, 3).map((item) => item.id),
    );
    const huge = book(2, AUTO_NOVEL_CONTEXT_LIMITS.singleOriginalChars + 1);
    expect(
      automaticNovelContextRequest(huge[1]!, huge, detailOf(huge)).chapters.map(
        (item) => item.representation,
      ),
    ).toEqual(["summary"]);
    expect(
      automaticNovelContextRequest(
        huge[1]!,
        huge,
        detailOf(huge),
        (path) => !path.startsWith("/knowledge/"),
      ).chapters,
    ).toEqual([]);
  });

  it("tells the model what it was given and not to invent the rest", () => {
    const chapters = book(5);
    const manual = prepareNovelContext(
      chapters[4]!,
      chapters,
      request({ id: chapters[3]!.id, version: 1, representation: "original" }),
      detailOf(chapters),
    );
    const note = novelContextNote(manual.basis);
    expect(note).toContain("前文原文 1 章、章节摘要 0 章");
    expect(note).toContain("另有 3 章前文未提供");
    const opening = prepareNovelContext(chapters[0]!, chapters, request(), detailOf(chapters));
    expect(novelContextNote(opening.basis)).toContain("本次没有前文资料");
  });
});
