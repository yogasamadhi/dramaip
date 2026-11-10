import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Chapter } from "@dramaip/contracts/writing";
import type { NarrativeIndexDetail } from "@dramaip/contracts/knowledge";
import {
  creationReference,
  narrativePlanningIdentity,
  type NarrativePlanningRequest,
  type NarrativePlanningBasis,
} from "@dramaip/contracts/creation";
import {
  prepareNarrativePlanning,
  planningDirectoryFingerprint,
} from "./narrative-planning.js";

const projectId = crypto.randomUUID();
const chapter = (
  orderIndex: number,
  content = "第一段。\n\nPRIVATE 未选择第二段。",
) =>
  ({
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    orderIndex,
    title: `第${orderIndex + 1}章`,
    content,
    summary: "PRIVATE 旧摘要不是实际采用证据",
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
  }) as Chapter;
const first = chapter(0),
  empty = chapter(1, ""),
  last = chapter(2);
const directory = [first, empty, last];
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ref = ({ id, version }: Chapter) => ({ id, version });
const original = (source: Chapter) => ({
  ...ref(source),
  representation: "original" as const,
});
const request = (chapters: Chapter[] = [first]): NarrativePlanningRequest => ({
  format: "narrative-planning-v1",
  chapterScope: { mode: "selection", chapters: chapters.map(ref) },
  context: { format: "narrative-context-v1", chapters: chapters.map(original) },
});
const detail = (sourceId: string): NarrativeIndexDetail | undefined => {
  const source = directory.find((chapter) => chapter.id === sourceId);
  return source
    ? ({
        projectId,
        fingerprint: hash(source.content),
        chapter: { ...source, contentHash: hash(source.content) },
        paragraphs: [
          {
            id: "actual-p-1",
            start: 0,
            end: 4,
            contentHash: hash(source.content.slice(0, 4)),
          },
        ],
        summaries: [],
        facts: [],
        excluded: [],
      } as unknown as NarrativeIndexDetail)
    : undefined;
};
const prepare = (input: NarrativePlanningRequest, chapters = directory) =>
  prepareNarrativePlanning(projectId, chapters, input, detail, () => undefined);

describe("owner narrative planning compilation", () => {
  it("permits explicit blank planning with actual existing directory metadata but no source text", () => {
    const input: NarrativePlanningRequest = {
      format: "narrative-planning-v1",
      chapterScope: { mode: "none", chapters: [] },
      context: { format: "narrative-context-v1", chapters: [] },
    };
    const result = prepare(input);
    expect(result.references).toEqual([]);
    expect(result.basis.coverage.included).toEqual([]);
    expect(result.basis.coverage.excluded).toEqual(
      directory.map((source) => ({
        ...ref(source),
        reason: source.content ? "not-selected" : "empty",
      })),
    );
    expect(result.basis.sourceBasis.references).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
  it("compiles actual original and ordered paragraph representations without unselected prose or old summary", () => {
    const input = request([first, last]);
    input.context.chapters[1] = {
      ...ref(last),
      representation: "paragraphs",
      paragraphIds: ["actual-p-1"],
    };
    const before = structuredClone(directory);
    const result = prepare(input);
    expect(result.references).toHaveLength(2);
    expect(
      result.basis.coverage.included.map((source) => source.representations),
    ).toEqual([["original"], ["paragraphs"]]);
    expect(result.references[1]?.value).toMatchObject({
      content: "第一段。",
      start: 0,
      end: 4,
    });
    expect(result.references[1]?.policyDependencies).toEqual([
      {
        sourceId: last.id,
        sourceVersion: last.version,
        fieldPath: `/chapters/${last.id}`,
      },
    ]);
    expect(JSON.stringify(result.references)).not.toContain("旧摘要");
    expect(directory).toEqual(before);
  });
  it("checks exact directory order, project ownership, source versions and actual nonempty chapters", () => {
    const reversed = request([last, first]);
    expect(() => prepare(reversed)).toThrow(/实际目录/);
    const stale = request();
    stale.chapterScope.chapters[0]!.version++;
    stale.context.chapters[0]!.version++;
    expect(() => prepare(stale)).toThrow(/实际目录/);
    expect(() => prepare(request([empty]))).toThrow(/非空/);
    expect(() =>
      prepare(request([{ ...first, id: crypto.randomUUID() }])),
    ).toThrow(/本项目/);
    expect(() =>
      prepare(request(), [{ ...first, projectId: crypto.randomUUID() }]),
    ).toThrow(/本项目/);
  });
  it("rejects a declared chapter with no actual expression, rather than supplementing original text", () => {
    const value = request([first, last]);
    value.context.chapters.pop();
    expect(() => prepare(value)).toThrow(/每个已确认/);
  });
  it("full scope binds the whole current directory and all nonempty sources; growth cannot silently expand it", () => {
    const value = request([first, last]);
    value.chapterScope = {
      mode: "full",
      chapters: [first, last].map(ref),
      directoryFingerprint: planningDirectoryFingerprint(directory),
    };
    expect(prepare(value).basis.coverage).toMatchObject({
      totalChapterCount: 3,
      nonEmptyChapterCount: 2,
    });
    expect(() => prepare(value, [...directory, chapter(3)])).toThrow(
      /目录指纹/,
    );
    const partial = request();
    partial.chapterScope = {
      mode: "full",
      chapters: [ref(first)],
      directoryFingerprint: planningDirectoryFingerprint(directory),
    };
    expect(() => prepare(partial)).toThrow(/全部非空/);
  });
  it("requires a verified exact adoption index for a selected summary; no legacy summary fallback", () => {
    const value = request();
    value.context.chapters[0] = {
      ...ref(first),
      representation: "summary",
      record: { id: crypto.randomUUID(), version: 0 },
    };
    expect(() => prepare(value)).toThrow(/精确采用来源/);
  });
  it("rejects unknown paragraphs and higher summary IDs rather than inventing offsets or coverage", () => {
    const value = request();
    value.context.chapters[0] = {
      ...ref(first),
      representation: "paragraphs",
      paragraphIds: ["guessed"],
    };
    expect(() => prepare(value)).toThrow(/段落已失效/);
    value.context = {
      format: "narrative-context-v1",
      chapters: [],
      summaries: [{ id: crypto.randomUUID(), version: 0 }],
    };
    expect(() => prepare(value)).toThrow(/精确采用头/);
  });
  it("adopted planning references inherit all original and intermediate policy dependencies", () => {
    const compiled = prepare(request());
    const source = compiled.references[0]!;
    const basis: NarrativePlanningBasis = {
      ...compiled.basis,
      operation: "characters",
      references: [
        {
          sourceKind: source.sourceKind,
          sourceId: source.sourceId,
          sourceVersion: source.sourceVersion,
          fieldPath: source.fieldPath,
          contentHash: hash(source.value),
          policyDependencies: [
            {
              sourceId: last.id,
              sourceVersion: 1,
              fieldPath: `/knowledge/${last.id}`,
            },
          ],
        },
      ],
    };
    const reference = creationReference("characters", {
      id: crypto.randomUUID(),
      version: 0,
      payload: { narrativePlanningBasis: basis },
    });
    expect(reference.policyDependencies).toEqual([
      {
        sourceId: first.id,
        sourceVersion: 1,
        fieldPath: `/chapters/${first.id}`,
      },
      {
        sourceId: last.id,
        sourceVersion: 1,
        fieldPath: `/knowledge/${last.id}`,
      },
    ]);
    expect(narrativePlanningIdentity(basis)).toBe(
      narrativePlanningIdentity({
        ...basis,
        coverage: { ...basis.coverage, totalChapterCount: 20 },
        contextBudget: {
          source: "estimate",
          tokenBudget: 64000,
          estimatedTokens: 800,
        },
      }),
    );
    expect(
      narrativePlanningIdentity({
        ...basis,
        references: [{ ...basis.references[0]!, contentHash: "a".repeat(64) }],
      }),
    ).not.toBe(narrativePlanningIdentity(basis));
  });
});
