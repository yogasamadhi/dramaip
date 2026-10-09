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
  prepareNovelContext,
  prepareNarrativeSources,
} from "./narrative-context";

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
  engineKind: "codex",
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
