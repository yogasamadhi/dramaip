import { observeFrozenEpisodeNarrativeSources } from "./episode-narrative-observation.js";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AgentContextEntry } from "@dramaip/contracts/agent-context";
import type {
  DiagnosisBasis,
  DiagnosisContent,
} from "@dramaip/contracts/production";
import {
  narrativeSourceIdentity,
  narrativeSourceSelection,
  narrativeChapterRepresentations,
} from "@dramaip/contracts/creation";
import {
  assertAdaptationSourceSnapshot,
  assertDiagnosisMixedEvidence,
  assertReviewedNarrativeSources,
  adaptationExpressionScope,
  episodeBibleReferences,
} from "./narrative-sources.js";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const projectId = crypto.randomUUID();
const chapters = [0, 1].map((orderIndex) => ({
  id: crypto.randomUUID(),
  version: orderIndex,
  title: `第${orderIndex + 1}章`,
  orderIndex,
  contentHash: "a".repeat(64),
  narrativeContentHash: "a".repeat(64),
  characters: 10,
}));
const summaryId = crypto.randomUUID();
const paragraphId = "实际段落/编号 1";
const entry = (
  sourceKind: "knowledge" | "chapter",
  sourceId: string,
  sourceVersion: number,
  fieldPath: string,
  value: AgentContextEntry["value"],
): AgentContextEntry & { sourceKind: "knowledge" | "chapter" } => ({
  sourceKind,
  sourceId,
  sourceVersion,
  fieldPath,
  value,
  mode: "auto",
  included: true,
  reason: "selected",
  estimatedTokens: 10,
  sensitivity: "project",
});
const entries = [
  entry("knowledge", summaryId, 1, `/narrative-summaries/${summaryId}`, {
    summary: "仅概括保管与归还旧书。",
  }),
  entry(
    "chapter",
    chapters[1]!.id,
    1,
    `/chapters/${chapters[1]!.id}/paragraphs/${encodeURIComponent(paragraphId)}`,
    { content: "实际归还段落。" },
  ),
];
const basis: DiagnosisBasis = {
  scope: "selected-chapters",
  chapters,
  omittedChapters: [],
  rightsDeclared: true,
  target: { format: "short-drama", episodeCount: 2, durationSeconds: 90 },
  sourceBasis: {
    kind: "author-selected-narrative-sources",
    projectId,
    chapters: [
      {
        id: chapters[1]!.id,
        version: 1,
        contentHash: chapters[1]!.contentHash,
        representation: "paragraphs",
        paragraphIds: [paragraphId],
      },
    ],
    summaries: [
      {
        id: summaryId,
        version: 1,
        target: { kind: "book", id: projectId, version: 0 },
        scopeTitle: "原两章范围",
        scopeFingerprint: "b".repeat(64),
        scopeState: "current",
        chapters: chapters.map(({ id, version, contentHash }) => ({
          id,
          version,
          contentHash,
        })),
      },
    ],
    omitted: [],
    references: entries.map(
      ({ sourceKind, sourceId, sourceVersion, fieldPath, value }) => ({
        sourceKind,
        sourceId,
        sourceVersion,
        fieldPath,
        contentHash: digest(value),
      }),
    ),
  },
};
const reviewed = entries.map(({ sourceId, sourceVersion, fieldPath }) => ({
  sourceId,
  sourceVersion,
  fieldPath,
}));
const content = (): DiagnosisContent => ({
  summary: "有限表达",
  theme: "求证",
  emotionalPromise: "信任",
  sellingPoints: ["旧书"],
  mainLine: "保管与归还",
  characterArcs: ["归还"],
  relationships: ["人物关系"],
  strategies: [],
  reviewedSources: structuredClone(reviewed),
  findings: [
    {
      id: "finding",
      kind: "conflict",
      claim: "需核对动机",
      suggestion: "核对原著",
      evidence: [0, 1].map((index) => ({
        chapterId: chapters[index]!.id,
        chapterVersion: chapters[index]!.version,
        quote: index === 0 ? "保管与归还" : "实际归还",
        source: {
          ...reviewed[index]!,
          valuePath:
            index === 0 ? ("/summary" as const) : ("/content" as const),
        },
      })),
    },
  ],
});

describe("mixed adaptation actual-expression foundation", () => {
  it("keeps chapter memories and higher summaries out of the adopted Bible and asset whitelist while preserving legacy Bible identities", () => {
    const higher = basis.sourceBasis!.references[0]!;
    const memory = {
      sourceKind: "knowledge" as const,
      sourceId: crypto.randomUUID(),
      sourceVersion: 2,
      fieldPath: "/knowledge/memory",
      contentHash: "c".repeat(64),
    };
    const bible = {
      ...memory,
      sourceId: crypto.randomUUID(),
      fieldPath: "/knowledge/bible",
    };
    const value = {
      references: [higher, memory, bible],
      sourceBasis: {
        ...basis.sourceBasis!,
        references: [...basis.sourceBasis!.references, memory],
      },
    };
    expect(episodeBibleReferences(value)).toEqual([bible]);
    expect(
      episodeBibleReferences({ ...value, sourceBasis: undefined }),
    ).toEqual([higher, memory, bible]);
    expect(
      episodeBibleReferences(value).map((item) => item.sourceId),
    ).not.toContain(summaryId);
  });
  it("requires complete exact frozen expression coverage and original chapter identities", () => {
    expect(() =>
      assertAdaptationSourceSnapshot(basis, projectId, entries),
    ).not.toThrow();
    for (const changed of [
      { ...basis, chapters: [chapters[0]!] },
      {
        ...basis,
        chapters: [...chapters, { ...chapters[0]!, id: crypto.randomUUID() }],
      },
      { ...basis, chapters: [{ ...chapters[0]!, version: 9 }, chapters[1]!] },
      {
        ...basis,
        chapters: [
          { ...chapters[0]!, narrativeContentHash: "e".repeat(64) },
          chapters[1]!,
        ],
      },
      {
        ...basis,
        sourceBasis: { ...basis.sourceBasis!, projectId: crypto.randomUUID() },
      },
      {
        ...basis,
        sourceBasis: {
          ...basis.sourceBasis!,
          omitted: [
            {
              id: chapters[0]!.id,
              version: 0,
              reason: "not-selected" as const,
            },
          ],
        },
      },
    ])
      expect(() =>
        assertAdaptationSourceSnapshot(changed, projectId, entries),
      ).toThrow();
    for (const changed of [
      entries.slice(0, 1),
      entries.map((item) => ({ ...item, included: false })),
      entries.map((item) => ({ ...item, sourceVersion: 7 })),
      entries.map((item) => ({ ...item, value: { summary: "裁剪" } })),
    ])
      expect(() =>
        assertAdaptationSourceSnapshot(basis, projectId, changed),
      ).toThrow();
  });
  it("requires exact complete reviewed ID/version/path, not aggregate coverage claims", () => {
    expect(() =>
      assertReviewedNarrativeSources(basis.sourceBasis, reviewed),
    ).not.toThrow();
    for (const changed of [
      undefined,
      reviewed.slice(0, 1),
      [reviewed[0]!, reviewed[0]!],
      reviewed.map((item) => ({ ...item, sourceVersion: 4 })),
      reviewed.map((item) => ({ ...item, fieldPath: "/invented" })),
    ])
      expect(() =>
        assertReviewedNarrativeSources(basis.sourceBasis, changed),
      ).toThrow();
    expect(() => assertReviewedNarrativeSources(undefined, reviewed)).toThrow();
    expect(() =>
      assertReviewedNarrativeSources(undefined, undefined),
    ).not.toThrow();
  });
  it("quotes only actual summary/body fields with exact chapter association and encoded paragraph path", () => {
    expect(() =>
      assertDiagnosisMixedEvidence(basis, content(), entries),
    ).not.toThrow();
    for (const mutate of [
      (value: DiagnosisContent) => {
        value.findings[0]!.evidence[0]!.quote = "未提供原文";
      },
      (value: DiagnosisContent) => {
        value.findings[0]!.evidence[0]!.source!.valuePath = "/content";
      },
      (value: DiagnosisContent) => {
        value.findings[0]!.evidence[0]!.source = undefined;
      },
      (value: DiagnosisContent) => {
        value.findings[0]!.evidence[1]!.chapterId = chapters[0]!.id;
        value.findings[0]!.evidence[1]!.chapterVersion = 0;
      },
      (value: DiagnosisContent) => {
        value.findings[0]!.evidence[1]!.source!.fieldPath = `/chapters/${chapters[1]!.id}/paragraphs/${paragraphId}`;
      },
      (value: DiagnosisContent) => {
        value.findings[0]!.evidence[0]!.chapterVersion = 9;
      },
    ]) {
      const value = content();
      mutate(value);
      expect(() =>
        assertDiagnosisMixedEvidence(basis, value, entries),
      ).toThrow();
    }
  });
  it("recognizes adopted chapter summaries and exact full-original fields without broadening their representations", () => {
    for (const representation of ["summary", "original"] as const) {
      const value = structuredClone(basis);
      const chapter = chapters[0]!;
      const record = { id: crypto.randomUUID(), version: 2 };
      const actual =
        representation === "summary"
          ? entry(
              "knowledge",
              record.id,
              record.version,
              `/knowledge/${record.id}`,
              { summary: "采用章节摘要。" },
            )
          : entry(
              "chapter",
              chapter.id,
              chapter.version,
              `/chapters/${chapter.id}`,
              { content: "实际完整正文。" },
            );
      value.chapters = [chapter];
      value.sourceBasis = {
        ...value.sourceBasis!,
        summaries: [],
        chapters: [
          representation === "summary"
            ? {
                id: chapter.id,
                version: chapter.version,
                contentHash: chapter.contentHash,
                representation,
                record,
              }
            : {
                id: chapter.id,
                version: chapter.version,
                contentHash: chapter.contentHash,
                representation,
              },
        ],
        references: [
          {
            sourceKind: actual.sourceKind as "chapter" | "knowledge",
            sourceId: actual.sourceId,
            sourceVersion: actual.sourceVersion,
            fieldPath: actual.fieldPath,
            contentHash: digest(actual.value),
          },
        ],
      };
      const output = content();
      output.reviewedSources = [
        {
          sourceId: actual.sourceId,
          sourceVersion: actual.sourceVersion,
          fieldPath: actual.fieldPath,
        },
      ];
      output.findings[0]!.evidence = [
        {
          chapterId: chapter.id,
          chapterVersion: chapter.version,
          quote: representation === "summary" ? "采用章节摘要" : "实际完整正文",
          source: {
            ...output.reviewedSources[0]!,
            valuePath: representation === "summary" ? "/summary" : "/content",
          },
        },
      ];
      expect(() =>
        assertAdaptationSourceSnapshot(value, projectId, [actual]),
      ).not.toThrow();
      expect(() =>
        assertDiagnosisMixedEvidence(value, output, [actual]),
      ).not.toThrow();
    }
  });
  it("reconstructs only safe selections and ignores changed directory scope state, never source substitutions", () => {
    const source = basis.sourceBasis!;
    expect(narrativeSourceSelection(source)).toEqual({
      format: "narrative-context-v1",
      chapters: [
        {
          id: chapters[1]!.id,
          version: 1,
          representation: "paragraphs",
          paragraphIds: [paragraphId],
        },
      ],
      summaries: [{ id: summaryId, version: 1 }],
    });
    expect(JSON.stringify(adaptationExpressionScope(source))).not.toMatch(
      /contentHash|scopeTitle|characters/u,
    );
    expect(narrativeChapterRepresentations(source, chapters[1]!.id)).toEqual([
      "paragraphs",
      "hierarchical-summary",
    ]);
    const changed = structuredClone(source);
    changed.summaries![0]!.scopeState = "stale";
    expect(narrativeSourceIdentity(changed)).toBe(
      narrativeSourceIdentity(source),
    );
    changed.summaries![0]!.version++;
    expect(narrativeSourceIdentity(changed)).not.toBe(
      narrativeSourceIdentity(source),
    );
    const reordered = {
      ...source,
      references: source.references.map((item) => ({
        contentHash: item.contentHash,
        fieldPath: item.fieldPath,
        sourceVersion: item.sourceVersion,
        sourceId: item.sourceId,
        sourceKind: item.sourceKind,
      })),
    };
    expect(narrativeSourceIdentity(reordered)).toBe(
      narrativeSourceIdentity(source),
    );
  });
});

describe("M4 frozen episode input observation", () => {
  const refs = [0, 1, 2, 3].map((version) => ({
    id: crypto.randomUUID(),
    version,
  }));
  const basis =
    (): import("@dramaip/contracts/creation").NarrativeSourceBasis => ({
      kind: "author-selected-narrative-sources",
      projectId,
      chapters: [
        {
          ...refs[0]!,
          representation: "original",
          contentHash: "a".repeat(64),
        },
      ],
      omitted: refs.slice(1).map((ref) => ({ ...ref, reason: "not-selected" })),
      references: [
        {
          sourceKind: "chapter",
          sourceId: refs[0]!.id,
          sourceVersion: refs[0]!.version,
          fieldPath: `/chapters/${refs[0]!.id}`,
          contentHash: "b".repeat(64),
        },
      ],
    });
  const request = (value: ReturnType<typeof basis>) =>
    narrativeSourceSelection(value);
  it("compares only original selected inputs while retaining the complete original omitted receipt", () => {
    const original = basis(),
      before = structuredClone(original),
      calls: unknown[] = [];
    const result = observeFrozenEpisodeNarrativeSources(
      projectId,
      refs,
      original,
      request(original),
      (scope) => {
        calls.push(scope);
        return { basis: { ...original, omitted: [] } };
      },
    );
    expect(calls).toEqual([[refs[0]]]);
    expect(result.matches).toBe(true);
    expect([...result.covered]).toEqual([refs[0]!.id]);
    expect(original).toEqual(before);
  });
  it("preserves original expression identities and rejects changed values instead of adopting a newer representation", () => {
    const original = basis();
    const result = observeFrozenEpisodeNarrativeSources(
      projectId,
      refs,
      original,
      request(original),
      () => ({
        basis: {
          ...original,
          chapters: original.chapters.map((item) => ({
            ...item,
            contentHash: "c".repeat(64),
          })),
          omitted: [],
        },
      }),
    );
    expect(result.matches).toBe(false);
    expect(() =>
      observeFrozenEpisodeNarrativeSources(
        projectId,
        refs,
        original,
        {
          format: "narrative-context-v1",
          chapters: [{ ...refs[1]!, representation: "original" }],
        },
        () => {
          throw Error("must not call");
        },
      ),
    ).toThrow("selection");
  });
  it("checks every original high-summary chapter without reading omitted chapters or expanding the saved scope", () => {
    const original = basis();
    original.chapters = [];
    original.references = [];
    original.omitted = original.omitted.slice(1);
    original.summaries = [
      {
        id: crypto.randomUUID(),
        version: 0,
        target: { id: projectId, version: 0, kind: "book" },
        scopeTitle: "Original selected summary",
        scopeFingerprint: "d".repeat(64),
        scopeState: "current",
        chapters: refs
          .slice(0, 2)
          .map((ref) => ({ ...ref, contentHash: "e".repeat(64) })),
      },
    ];
    let read: unknown;
    const result = observeFrozenEpisodeNarrativeSources(
      projectId,
      refs,
      original,
      request(original),
      (scope) => {
        read = scope;
        return {
          basis: {
            ...original,
            summaries: original.summaries!.map((item) => ({
              ...item,
              scopeState: "stale",
            })),
            omitted: [],
          },
        };
      },
    );
    expect(read).toEqual(refs.slice(0, 2));
    expect(result.matches).toBe(true);
    expect([...result.covered]).toEqual(refs.slice(0, 2).map((ref) => ref.id));
  });
  it("retains the complete original story-source chapter closure but does not pretend that an interpretation is a whole chapter", () => {
    const original = basis(),
      id = crypto.randomUUID();
    original.story = [
      {
        selection: { kind: "declaration", id, version: 0 },
        record: { kind: "node", id: crypto.randomUUID(), version: 0 },
        sourceFingerprint: "d".repeat(64),
        sourceChapters: [refs[1]!],
        sourceScripts: [],
        contentHash: "e".repeat(64),
      },
    ];
    original.references.push({
      sourceKind: "knowledge",
      sourceId: id,
      sourceVersion: 0,
      fieldPath: `/narrative-story-index/declarations/${id}`,
      contentHash: "e".repeat(64),
    });
    let read: unknown;
    const result = observeFrozenEpisodeNarrativeSources(
      projectId,
      refs,
      original,
      request(original),
      (scope) => {
        read = scope;
        return { basis: { ...original, omitted: [original.omitted[0]!] } };
      },
    );
    expect(read).toEqual(refs.slice(0, 2));
    expect(result.matches).toBe(true);
    expect([...result.covered]).toEqual([refs[0]!.id]);
  });
  it("refuses incomplete repeated foreign or altered original parent membership before reading any current source", () => {
    const original = basis();
    let calls = 0;
    const compile = () => {
      calls++;
      return { basis: original };
    };
    for (const parent of [
      refs.slice(0, 3),
      [...refs, refs[0]!],
      refs.map((ref, index) =>
        index === 3 ? { ...ref, version: ref.version + 1 } : ref,
      ),
    ])
      expect(() =>
        observeFrozenEpisodeNarrativeSources(
          projectId,
          parent,
          original,
          request(original),
          compile,
        ),
      ).toThrow();
    expect(() =>
      observeFrozenEpisodeNarrativeSources(
        crypto.randomUUID(),
        refs,
        original,
        request(original),
        compile,
      ),
    ).toThrow();
    const missing = structuredClone(original);
    missing.omitted.pop();
    expect(() =>
      observeFrozenEpisodeNarrativeSources(
        projectId,
        refs,
        missing,
        request(missing),
        compile,
      ),
    ).toThrow();
    const duplicate = structuredClone(original);
    duplicate.omitted.push(duplicate.omitted[0]!);
    expect(() =>
      observeFrozenEpisodeNarrativeSources(
        projectId,
        refs,
        duplicate,
        request(duplicate),
        compile,
      ),
    ).toThrow();
    expect(calls).toBe(0);
  });
  it("propagates owner failures and foreign returns without a latest-source fallback", () => {
    const original = basis();
    expect(() =>
      observeFrozenEpisodeNarrativeSources(
        projectId,
        refs,
        original,
        request(original),
        () => {
          throw Error("controlled owner outage");
        },
      ),
    ).toThrow("owner outage");
    expect(() =>
      observeFrozenEpisodeNarrativeSources(
        projectId,
        refs,
        original,
        request(original),
        () => ({ basis: { ...original, projectId: crypto.randomUUID() } }),
      ),
    ).toThrow("another project");
  });
  it("does not read an empty actual input or manufacture coverage from its omitted directory", () => {
    const original = basis();
    original.chapters = [];
    original.references = [];
    original.omitted = refs.map((ref) => ({ ...ref, reason: "not-selected" }));
    const result = observeFrozenEpisodeNarrativeSources(
      projectId,
      refs,
      original,
      request(original),
      () => {
        throw Error("No provided expression must be read");
      },
    );
    expect(result.matches).toBe(true);
    expect([...result.covered]).toEqual([]);
  });
});
