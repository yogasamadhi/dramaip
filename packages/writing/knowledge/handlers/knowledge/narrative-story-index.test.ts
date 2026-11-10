import { describe, expect, it } from "vitest";
import {
  NarrativeStoryIndexEntrySchema,
  StoryDeclarationSchema,
  StoryAssertionSchema,
  NarrativeIndexCatalogSchema,
  type StoryDeclaration,
  type StoryAssertion,
} from "@dramaip/contracts/knowledge";
import {
  storyIndexEntry,
  storyIndexReference,
  storySourceCoverage,
  storyIndexHierarchy,
} from "./narrative-story-index.js";

const projectId = crypto.randomUUID(),
  chapterId = crypto.randomUUID(),
  endpointChapterId = crypto.randomUUID();
const at = "2026-10-06T02:00:00.000Z";
const selection = {
  kind: "paragraphs" as const,
  chapterId,
  chapterVersion: 3,
  chapterContentHash: "a".repeat(64),
  paragraphIds: ["exact-paragraph"],
};
const dependency = (id: string, version: number, path = "chapters") => ({
  sourceId: id,
  sourceVersion: version,
  fieldPath: `/${path}/${id}`,
});
const basis = {
  format: "source-anchored-story-declaration-v1" as const,
  projectId,
  fingerprint: "b".repeat(64),
  evidencePolicy: "exact-source-identity-not-semantic-verification" as const,
  sources: [
    {
      selection,
      text: "PRIVATE SOURCE BODY",
      quote: "PRIVATE SOURCE QUOTE",
      quoteHash: "c".repeat(64),
      anchors: [{ start: 0, end: 5, paragraphIds: selection.paragraphIds }],
    },
  ],
  policyDependencies: [
    dependency(chapterId, 3),
    {
      ...dependency(chapterId, 3),
      fieldPath: `/chapters/${chapterId}/paragraphs/exact-paragraph`,
    },
  ],
};
const declaration = (): StoryDeclaration => {
  const record = { kind: "node" as const, id: crypto.randomUUID(), version: 0 };
  return StoryDeclarationSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    status: "adopted",
    input: {
      kind: "character",
      title: "来源人物",
      statement: "作者明确的解释，不是原文语义证明",
      sources: [selection],
    },
    basis,
    adoptedNode: { id: record.id, version: record.version },
    lifecycle: { state: "active", version: 0, record, transitions: [] },
    sourceStatus: { state: "current", reasons: [] },
    etag: `"${"d".repeat(64)}"`,
    createdAt: at,
    updatedAt: at,
  });
};
const node = (kind: "character" | "secret") => ({
  id: crypto.randomUUID(),
  projectId,
  kind,
  title: `实际${kind}名称`,
  summary: "PRIVATE ENDPOINT SUMMARY",
  sourceType: "manual",
  sourceId: projectId,
  sourceVersion: 0,
  confirmed: true,
  version: 2,
  createdAt: at,
  updatedAt: at,
});
const assertion = (
  kind: "relationship" | "cognition" = "relationship",
): StoryAssertion => {
  const a = node("character"),
    b = node("secret");
  const record = {
    kind: kind === "relationship" ? "edge" : "cognition",
    id: crypto.randomUUID(),
    version: 0,
  };
  return StoryAssertionSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    status: "adopted",
    input: {
      kind,
      title: "作者来源解释",
      statement: "所选声明文本",
      interpretation: "author-inferred",
      sources: [selection],
      ...(kind === "relationship"
        ? {
            from: { id: a.id, version: a.version },
            to: { id: b.id, version: b.version },
            relation: "reveals",
            confidence: 0.7,
          }
        : {
            subject: {
              kind: "character",
              node: { id: a.id, version: a.version },
            },
            target: { id: b.id, version: b.version },
            storyOrder: 5,
            state: "suspects",
          }),
    },
    basis: {
      format: "source-anchored-story-assertion-v1",
      projectId,
      fingerprint: "e".repeat(64),
      interpretationPolicy: "human-reviewed-not-semantic-or-calibrated-proof",
      sourceBasis: basis,
      nodes: [a, b],
      policyDependencies: [
        ...basis.policyDependencies,
        dependency(endpointChapterId, 4),
        dependency(a.id, a.version, "story-declarations/nodes"),
        dependency(b.id, b.version, "story-declarations/nodes"),
      ],
    },
    adoptedRecord: record,
    lifecycle: { state: "active", version: 0, record, transitions: [] },
    sourceStatus: { state: "current", reasons: [] },
    etag: `"${"f".repeat(64)}"`,
    createdAt: at,
    updatedAt: at,
  });
};

describe("source-anchored story index representations", () => {
  it("preserves explicitly authored event time coordinates in the exact selected interpretation, not cognition order or inferred chronology", () => {
    const original = declaration();
    const eventTimeline = {
      storyOrder: 0,
      timeLabel: "回忆：正文开场前三日",
      interpretation: "author-inferred" as const,
    };
    const source = StoryDeclarationSchema.parse({
      ...original,
      input: { ...original.input, kind: "event", eventTimeline },
    });
    const entry = storyIndexEntry(projectId, "declaration", source, () => true);
    expect(entry.eventTimeline).toEqual(eventTimeline);
    expect(entry.storyOrder).toBeUndefined();
    expect(storyIndexReference(entry, source).value).toMatchObject({
      eventTimeline,
    });
    expect(source.input).toEqual({
      ...original.input,
      kind: "event",
      eventTimeline,
    });
    expect(
      StoryDeclarationSchema.safeParse({
        ...source,
        input: { ...source.input, kind: "character" },
      }).success,
    ).toBe(false);
    expect(
      NarrativeStoryIndexEntrySchema.safeParse({
        ...entry,
        classification: "cognition",
        selection: { ...entry.selection, kind: "assertion" },
      }).success,
    ).toBe(false);
    for (const invalid of [
      { ...eventTimeline, storyOrder: -1 },
      { ...eventTimeline, storyOrder: 1.5 },
      { ...eventTimeline, timeLabel: " " },
      { ...eventTimeline, interpretation: "semantic-proof" },
    ])
      expect(
        StoryDeclarationSchema.safeParse({
          ...source,
          input: { ...source.input, eventTimeline: invalid },
        }).success,
      ).toBe(false);
    const stale = storyIndexEntry(
      projectId,
      "declaration",
      {
        ...source,
        sourceStatus: { state: "stale", reasons: ["原章节改字"] },
      },
      () => true,
    );
    expect(stale.eventTimeline).toEqual(eventTimeline);
    expect(stale.eligibility.state).toBe("ineligible");
    expect(() => storyIndexReference(stale, source)).toThrow();
  });
  it("includes only the exact active adopted binding and exposes interpretation rather than semantic certification", () => {
    const source = declaration(),
      entry = storyIndexEntry(projectId, "declaration", source, () => true);
    expect(entry).toMatchObject({
      selection: { kind: "declaration", id: source.id, version: 1 },
      classification: "character",
      interpretation: "author-declared",
      record: source.lifecycle!.record,
      eligibility: { state: "eligible", reasons: [] },
      sourceChapters: [{ id: chapterId, version: 3 }],
      sourceScripts: [],
    });
    expect(JSON.stringify(entry)).not.toContain("PRIVATE SOURCE");
    const reference = storyIndexReference(entry, source);
    expect(reference.value).toMatchObject({
      statement: source.input.statement,
      evidencePolicy:
        "source-anchored-human-interpretations-not-semantic-proof",
      representation: "source-anchored-story-interpretation",
    });
    expect(reference.policyDependencies).toContainEqual(
      dependency(source.id, source.version, "story-declarations"),
    );
    expect(reference.policyDependencies).toContainEqual(
      dependency(entry.record!.id, 0, "story-declarations/nodes"),
    );
  });
  it("retains candidates discarded stale unavailable and retired history as ineligible, never substitutes a latest binding", () => {
    const original = declaration();
    const variants: StoryDeclaration[] = [
      {
        ...original,
        status: "pending",
        adoptedNode: undefined,
        lifecycle: undefined,
      },
      {
        ...original,
        status: "discarded",
        adoptedNode: undefined,
        lifecycle: undefined,
      },
      { ...original, sourceStatus: { state: "stale", reasons: ["原文变更"] } },
      {
        ...original,
        sourceStatus: { state: "unavailable", reasons: ["来源不可读取"] },
      },
      {
        ...original,
        lifecycle: { ...original.lifecycle!, state: "withdrawn" },
      },
      {
        ...original,
        lifecycle: {
          ...original.lifecycle!,
          state: "replaced",
          replacementId: crypto.randomUUID(),
        },
      },
    ];
    for (const source of variants) {
      const entry = storyIndexEntry(projectId, "declaration", source, () => {
        throw new Error("must not upgrade history");
      });
      expect(entry.eligibility.state).toBe("ineligible");
      expect(entry.selection.version).toBe(original.version);
      expect(entry.eligibility.reasons.length).toBeGreaterThan(0);
      expect(() => storyIndexReference(entry, source)).toThrow(/精确/);
    }
  });
  it("denies an unverified actual record and owner-read exceptions rather than treating them as successful checks", () => {
    for (const read of [
      () => false,
      () => {
        throw new Error("PRIVATE owner error");
      },
    ]) {
      const entry = storyIndexEntry(
        projectId,
        "declaration",
        declaration(),
        read,
      );
      expect(entry.eligibility.state).toBe("ineligible");
      expect(JSON.stringify(entry)).not.toContain("PRIVATE owner error");
    }
  });
  it("keeps relation and cognition identities, endpoint names and all upstream dependency closure without endpoint summaries or original quotes", () => {
    for (const kind of ["relationship", "cognition"] as const) {
      const source = assertion(kind),
        entry = storyIndexEntry(projectId, "assertion", source, () => true);
      expect(entry.interpretation).toBe("author-inferred");
      expect(entry.classification).toBe(kind);
      expect(entry.sourceChapters).toEqual(
        [dependency(chapterId, 3), dependency(endpointChapterId, 4)]
          .map(({ sourceId: id, sourceVersion: version }) => ({ id, version }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
      if (kind === "cognition")
        expect(entry).toMatchObject({
          storyOrder: 5,
          knowledgeState: "suspects",
          cognitionSubject: { kind: "character" },
        });
      else expect(entry.relation).toBe("reveals");
      const ref = storyIndexReference(entry, source);
      expect(
        ref.policyDependencies?.slice(
          0,
          source.basis.policyDependencies.length,
        ),
      ).toEqual(source.basis.policyDependencies);
      expect(ref.value).toMatchObject({
        endpoints: source.basis.nodes.map(({ id, version, title, kind }) => ({
          id,
          version,
          title,
          kind,
        })),
      });
      expect(JSON.stringify(ref.value)).not.toContain("PRIVATE");
      expect(ref.value).not.toHaveProperty("sources");
    }
  });
  it("rejects cross-project records frozen sources and endpoints instead of returning foreign index entries", () => {
    const original = assertion();
    for (const source of [
      { ...original, projectId: crypto.randomUUID() },
      {
        ...original,
        basis: { ...original.basis, projectId: crypto.randomUUID() },
      },
      {
        ...original,
        basis: {
          ...original.basis,
          sourceBasis: {
            ...original.basis.sourceBasis,
            projectId: crypto.randomUUID(),
          },
        },
      },
      {
        ...original,
        basis: {
          ...original.basis,
          nodes: original.basis.nodes.map((n) => ({
            ...n,
            projectId: crypto.randomUUID(),
          })),
        },
      },
    ])
      expect(() =>
        storyIndexEntry(projectId, "assertion", source, () => true),
      ).toThrow(/跨项目/);
  });
  it("rejects missing original policy origins, mismatched dependency paths and conflicting source versions rather than reducing coverage", () => {
    const source = declaration();
    expect(() =>
      storySourceCoverage({
        ...source,
        basis: { ...source.basis, policyDependencies: [] },
      }),
    ).toThrow(/完整继承/);
    expect(() =>
      storySourceCoverage({
        ...source,
        basis: {
          ...source.basis,
          policyDependencies: [
            { ...dependency(chapterId, 3), sourceId: endpointChapterId },
          ],
        },
      }),
    ).toThrow(/身份/);
    expect(() =>
      storySourceCoverage({
        ...source,
        basis: {
          ...source.basis,
          policyDependencies: [
            ...basis.policyDependencies,
            dependency(chapterId, 4),
          ],
        },
      }),
    ).toThrow(/冲突/);
  });
  it("requires the exact selected declaration version and denies malformed eligible metadata", () => {
    const source = declaration(),
      entry = storyIndexEntry(projectId, "declaration", source, () => true);
    expect(() =>
      storyIndexReference(entry, { ...source, version: source.version + 1 }),
    ).toThrow(/精确/);
    expect(() =>
      storyIndexReference(entry, { ...source, id: crypto.randomUUID() }),
    ).toThrow(/精确/);
    for (const corrupt of [
      { ...entry, status: "pending" },
      { ...entry, retirement: "withdrawn" },
      { ...entry, record: undefined },
      {
        ...entry,
        sourceChapters: [...entry.sourceChapters, ...entry.sourceChapters],
      },
    ])
      expect(NarrativeStoryIndexEntrySchema.safeParse(corrupt).success).toBe(
        false,
      );
  });
});

describe("current read-only story hierarchy and original cognition identity", () => {
  function catalog() {
    const coverage = {
      chapterCount: 1,
      nonEmptyChapterCount: 1,
      currentSummaryChapterCount: 0,
      missingSummaryChapterIds: [chapterId],
    };
    return NarrativeIndexCatalogSchema.parse({
      projectId,
      projectVersion: 2,
      fingerprint: "a".repeat(64),
      chapters: [
        {
          id: chapterId,
          version: 3,
          title: "实际章节",
          orderIndex: 0,
          contentHash: "b".repeat(64),
          hasContent: true,
          paragraphCount: 1,
          summaryState: "missing",
          summaryCount: 0,
          factCount: 0,
          excludedRecordCount: 0,
          originalEstimatedTokens: 10,
          summaryEstimatedTokens: 0,
        },
      ],
      groups: [
        {
          id: projectId,
          version: 2,
          kind: "book",
          title: "实际全书",
          chapterIds: [chapterId],
          state: "current",
          reasons: [],
          coverage,
        },
      ],
      unavailable: [],
      unassignedRecords: [],
    });
  }
  it("projects only whitelisted structural metadata, keeps empty projects and excludes original body, estimates and semantic coverage", () => {
    const base = catalog(),
      h = storyIndexHierarchy(projectId, () => base);
    expect(h).toMatchObject({
      state: "available",
      projectVersion: 2,
      chapters: [
        { id: chapterId, version: 3, title: "实际章节", orderIndex: 0 },
      ],
    });
    expect(JSON.stringify(h)).not.toContain("EstimatedTokens");
    if (h.state !== "available") throw new Error("本次结构目录未核全");
    expect(h.groups[0]).not.toHaveProperty("coverage");
    const empty = storyIndexHierarchy(projectId, () => ({
      ...base,
      chapters: [],
      groups: [{ ...base.groups[0]!, chapterIds: [] }],
    }));
    expect(empty).toMatchObject({ state: "available", chapters: [] });
  });
  it("marks foreign, incomplete, malformed and failed structural reads unavailable without leaking diagnostics or returning an empty verified range", () => {
    const base = catalog();
    for (const read of [
      () => ({ ...base, projectId: crypto.randomUUID() }),
      () => ({ ...base, unavailable: ["PRIVATE credential diagnostic"] }),
      () => ({ ...base, groups: [] }),
      () => ({ ...base, chapters: [base.chapters[0]!, base.chapters[0]!] }),
      () => {
        throw new Error("PRIVATE upstream body");
      },
    ]) {
      const result = storyIndexHierarchy(projectId, read);
      expect(result).toEqual({
        state: "unavailable",
        projectId,
        reason: "基础叙事目录归属暂不可完整核对，未换源或认定为空范围。",
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    }
  });
  it("preserves actual audience subject and target while advisory metadata never changes an immutable compiled reference", () => {
    const original = assertion("cognition");
    if (original.input.kind !== "cognition") throw new Error("原认知输入缺失");
    const source = StoryAssertionSchema.parse({
      ...original,
      input: {
        ...original.input,
        subject: { kind: "audience", id: "首集观众" },
      },
      basis: { ...original.basis, nodes: [original.basis.nodes[1]!] },
    });
    const entry = storyIndexEntry(projectId, "assertion", source, () => true);
    expect(entry.cognitionSubject).toEqual({
      kind: "audience",
      id: "首集观众",
    });
    expect(entry.endpoints).toHaveLength(1);
    expect(entry.endpoints[0]!.id).toBe(source.basis.nodes[0]!.id);
    const legacy = { ...entry, cognitionSubject: undefined };
    expect(storyIndexReference(entry, source)).toEqual(
      storyIndexReference(legacy, source),
    );
    expect(storyIndexReference(entry, source).value).not.toHaveProperty(
      "cognitionSubject",
    );
  });
  it("uses original input identity, not incidental frozen node array order, and rejects missing or mismatched versions instead of inventing a subject", () => {
    for (const kind of ["relationship", "cognition"] as const) {
      const source = assertion(kind);
      const reversed = storyIndexEntry(
        projectId,
        "assertion",
        {
          ...source,
          basis: { ...source.basis, nodes: [...source.basis.nodes].reverse() },
        },
        () => true,
      );
      const actual = storyIndexEntry(
        projectId,
        "assertion",
        source,
        () => true,
      );
      expect(reversed.cognitionSubject).toEqual(actual.cognitionSubject);
      expect(reversed.relationshipEndpoints).toEqual(
        actual.relationshipEndpoints,
      );
      for (const nodes of [
        source.basis.nodes.slice(0, 1),
        source.basis.nodes.map((n) => ({ ...n, version: n.version + 1 })),
      ])
        expect(() =>
          storyIndexEntry(
            projectId,
            "assertion",
            { ...source, basis: { ...source.basis, nodes } },
            () => true,
          ),
        ).toThrow(/端点身份／版本/);
    }
  });
});
