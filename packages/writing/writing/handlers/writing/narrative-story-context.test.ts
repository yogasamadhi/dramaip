import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  NarrativeContextRequestSchema,
  NarrativeSourceBasisSchema,
  NarrativePlanningRequestSchema,
  narrativeSourceSelection,
  type NarrativeContextRequest,
} from "@dramaip/contracts/creation";
import type { Chapter } from "@dramaip/contracts/writing";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import type { NarrativeStorySourceBasis } from "@dramaip/contracts/knowledge";
import {
  prepareNarrativeSources,
  prepareNovelContext,
  type StorySourceCompiler,
} from "./narrative-context.js";
import {
  prepareNarrativePlanning,
  prepareProductionNarrative,
} from "./narrative-planning.js";

const projectId = crypto.randomUUID();
const chapter = (orderIndex: number, content = "PRIVATE 原文不默认进入声明") =>
  ({
    id: crypto.randomUUID(),
    projectId,
    version: 3,
    orderIndex,
    title: `章${orderIndex}`,
    content,
  }) as Chapter;
const first = chapter(0),
  second = chapter(1),
  target = chapter(2, ""),
  future = chapter(3);
const selection = {
  kind: "assertion" as const,
  id: crypto.randomUUID(),
  version: 1,
};
const record = { kind: "edge" as const, id: crypto.randomUUID(), version: 0 };
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fixture = () => {
  const value = {
    projectId,
    representation: "source-anchored-story-interpretation",
    sourceFingerprint: "a".repeat(64),
    record,
    sourceChapters: [{ id: first.id, version: first.version }],
    sourceScripts: [],
    statement: "明确选择的作者推断，不能当作原文事实",
    endpoints: [{ id: crypto.randomUUID(), version: 0, title: "实际端点名称" }],
  };
  const reference: AgentContextReference = {
    sourceKind: "knowledge",
    sourceId: selection.id,
    sourceVersion: selection.version,
    fieldPath: `/narrative-story-index/assertions/${selection.id}`,
    sensitivity: "project",
    value,
    policyDependencies: [
      {
        sourceId: selection.id,
        sourceVersion: selection.version,
        fieldPath: `/story-assertions/${selection.id}`,
      },
      {
        sourceId: record.id,
        sourceVersion: record.version,
        fieldPath: `/story-declarations/edges/${record.id}`,
      },
      {
        sourceId: first.id,
        sourceVersion: first.version,
        fieldPath: `/chapters/${first.id}`,
      },
    ],
  };
  const basis: NarrativeStorySourceBasis = {
    selection,
    sourceFingerprint: value.sourceFingerprint,
    record,
    sourceChapters: value.sourceChapters,
    sourceScripts: [],
    contentHash: hash(value),
  };
  return { basis: [basis], references: [reference] };
};
const request = (): NarrativeContextRequest => ({
  format: "narrative-context-v1",
  chapters: [],
  story: [selection],
});
const compile = (
  input: NarrativeContextRequest,
  source?: StorySourceCompiler,
) =>
  prepareNovelContext(
    target,
    [first, second, target, future],
    input,
    () => undefined,
    undefined,
    source,
  );

describe("explicit source-anchored story context", () => {
  it("never reads or sends graph interpretations unless the author explicitly selects them", () => {
    const read = vi.fn(() => fixture());
    const result = compile(
      { format: "narrative-context-v1", chapters: [] },
      read,
    );
    expect(read).not.toHaveBeenCalled();
    expect(result.basis.story).toBeUndefined();
    expect(result.references).toHaveLength(1);
    expect(() => compile(request())).toThrow(/未启用/);
  });
  it("freezes exact selected interpretations and dependency hashes while leaving all chapter-read coverage omitted", () => {
    const original = fixture(),
      source = vi.fn(() => original);
    const result = compile(request(), source);
    expect(source).toHaveBeenCalledWith([selection]);
    expect(result.basis.story).toEqual(original.basis);
    expect(result.basis.chapters).toEqual([]);
    expect(result.basis.omitted.map((ref) => ref.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(result.references).toHaveLength(2);
    expect(JSON.stringify(result.references)).not.toContain("PRIVATE");
    expect(result.references[1]!.policyDependencies).toEqual(
      original.references[0]!.policyDependencies,
    );
    const common = prepareNarrativeSources(
      projectId,
      [first, second],
      request(),
      () => undefined,
      undefined,
      source,
    );
    expect(NarrativeSourceBasisSchema.parse(common.basis)).toEqual(
      common.basis,
    );
    expect(narrativeSourceSelection(common.basis)).toEqual(request());
    expect(
      JSON.stringify(narrativeSourceSelection(common.basis)),
    ).not.toContain("声明文本");
  });
  it("requires every original dependency to be in the actual prior-chapter range; target future foreign empty and old versions are not cropped", () => {
    for (const sources of [
      [{ id: target.id, version: target.version }],
      [{ id: future.id, version: future.version }],
      [{ id: crypto.randomUUID(), version: 0 }],
      [{ id: first.id, version: first.version + 1 }],
      [
        { id: first.id, version: first.version },
        { id: future.id, version: future.version },
      ],
      [],
    ]) {
      const actual = fixture();
      actual.basis[0]!.sourceChapters = sources;
      const value = actual.references[0]!.value as Record<string, unknown>;
      value.sourceChapters = sources;
      actual.basis[0]!.contentHash = hash(value);
      expect(() => compile(request(), () => actual)).toThrow(/完整来自/);
    }
    const emptyFirst = { ...first, content: "" };
    expect(() =>
      prepareNovelContext(
        target,
        [emptyFirst, target],
        request(),
        () => undefined,
        undefined,
        fixture,
      ),
    ).toThrow(/完整来自/);
  });
  it("rejects mixed script origins instead of silently admitting script text into a novel chapter scope", () => {
    const actual = fixture();
    const sources = [{ id: crypto.randomUUID(), version: 1 }];
    actual.basis[0]!.sourceScripts = sources;
    (actual.references[0]!.value as Record<string, unknown>).sourceScripts =
      sources;
    actual.basis[0]!.contentHash = hash(actual.references[0]!.value);
    expect(() => compile(request(), () => actual)).toThrow(/剧本/);
  });
  it("denies partial compiler reads, wrong owner identity/path/project, altered payload/hash and missing upstream privacy dependencies", () => {
    const variants = [
      (actual: ReturnType<typeof fixture>) => {
        actual.basis = [];
      },
      (actual: ReturnType<typeof fixture>) => {
        actual.references = [];
      },
      (actual: ReturnType<typeof fixture>) => {
        actual.basis[0]!.selection = { ...selection, version: 2 };
      },
      (actual: ReturnType<typeof fixture>) => {
        actual.references[0]!.sourceId = crypto.randomUUID();
      },
      (actual: ReturnType<typeof fixture>) => {
        actual.references[0]!.fieldPath = `/knowledge/${selection.id}`;
      },
      (actual: ReturnType<typeof fixture>) => {
        (actual.references[0]!.value as Record<string, unknown>).projectId =
          crypto.randomUUID();
        actual.basis[0]!.contentHash = hash(actual.references[0]!.value);
      },
      (actual: ReturnType<typeof fixture>) => {
        actual.basis[0]!.contentHash = "0".repeat(64);
      },
      (actual: ReturnType<typeof fixture>) => {
        actual.references[0]!.policyDependencies!.pop();
      },
      (actual: ReturnType<typeof fixture>) => {
        actual.references[0]!.policyDependencies!.shift();
      },
    ];
    for (const mutate of variants) {
      const actual = fixture();
      mutate(actual);
      expect(() => compile(request(), () => actual)).toThrow();
    }
  });
  it("does not let declarations substitute chapter expressions in planning or quality coverage", () => {
    const input = {
      format: "narrative-planning-v1" as const,
      chapterScope: {
        mode: "selection" as const,
        chapters: [{ id: first.id, version: first.version }],
      },
      context: request(),
    };
    expect(() =>
      prepareNarrativePlanning(
        projectId,
        [first],
        input,
        () => undefined,
        () => undefined,
        fixture,
      ),
    ).toThrow(/每个已确认/);
    const actual = prepareNarrativePlanning(
      projectId,
      [first],
      {
        ...input,
        context: {
          ...input.context,
          chapters: [
            {
              id: first.id,
              version: first.version,
              representation: "original",
            },
          ],
        },
      },
      () => undefined,
      () => undefined,
      fixture,
    );
    expect(actual.basis.coverage.included[0]!.representations).toEqual([
      "original",
    ]);
    expect(actual.basis.sourceBasis.story).toHaveLength(1);
    const production = prepareProductionNarrative(
      projectId,
      [first],
      {
        ...input,
        format: "production-narrative-v1",
        context: {
          ...input.context,
          chapters: [
            {
              id: first.id,
              version: first.version,
              representation: "original",
            },
          ],
        },
      },
      () => undefined,
      () => undefined,
      fixture,
    );
    expect(production.basis.coverage.included[0]!.representations).toEqual([
      "original",
    ]);
  });
  it("rejects duplicate or excessive selections, client-injected quote bodies and graph selection in blank planning", () => {
    for (const story of [
      [selection, selection],
      Array.from({ length: 201 }, () => ({
        ...selection,
        id: crypto.randomUUID(),
      })),
      [{ ...selection, quote: "PRIVATE injected body" }],
    ])
      expect(
        NarrativeContextRequestSchema.safeParse({ ...request(), story })
          .success,
      ).toBe(false);
    expect(
      NarrativePlanningRequestSchema.safeParse({
        format: "narrative-planning-v1",
        chapterScope: { mode: "none", chapters: [] },
        context: request(),
      }).success,
    ).toBe(false);
  });
});
