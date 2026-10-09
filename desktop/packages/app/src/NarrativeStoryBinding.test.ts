import { expect, test } from "bun:test";
import { createStudioClient } from "@dramaip/client";
import {
  NarrativeSourceBasisSchema,
  NarrativeContextBasisSchema,
  NarrativePlanningSourceSchema,
  ProductionNarrativeSourceSchema,
} from "@dramaip/contracts/creation";
import {
  EpisodeDevelopmentBasisSchema,
  EpisodeDevelopmentResultSchema,
} from "@dramaip/contracts/production";

const chapter = { id: crypto.randomUUID(), version: 1 };
const projectId = crypto.randomUUID();
const selection = {
  kind: "declaration" as const,
  id: crypto.randomUUID(),
  version: 1,
};
const chapterReference = {
  sourceKind: "chapter" as const,
  sourceId: chapter.id,
  sourceVersion: chapter.version,
  fieldPath: `/chapters/${chapter.id}`,
  contentHash: "a".repeat(64),
};
const graphReference = {
  sourceKind: "knowledge" as const,
  sourceId: selection.id,
  sourceVersion: selection.version,
  fieldPath: `/narrative-story-index/declarations/${selection.id}`,
  contentHash: "b".repeat(64),
};
const chapterMeta = {
  ...chapter,
  title: "明确范围",
  orderIndex: 0,
  contentHash: "a".repeat(64),
  characters: 10,
};
const context = {
  format: "narrative-context-v1" as const,
  chapters: [{ ...chapter, representation: "original" as const }],
  story: [selection],
};
const basis = {
  request: {
    seasonPlan: { id: crypto.randomUUID(), version: 1 },
    episodeId: "episode",
    episodeNarrativeContext: context,
  },
  authorIntent: { id: crypto.randomUUID(), version: 1 },
  diagnosis: { id: crypto.randomUUID(), version: 1, strategyId: "strategy" },
  chapters: [chapterMeta],
  contextChapters: [chapterMeta],
  sourceBasis: {
    kind: "author-selected-narrative-sources" as const,
    projectId,
    chapters: [
      {
        ...chapter,
        representation: "original" as const,
        contentHash: "a".repeat(64),
      },
    ],
    omitted: [],
    references: [chapterReference, graphReference],
    story: [
      {
        selection,
        record: { kind: "node" as const, id: crypto.randomUUID(), version: 0 },
        sourceFingerprint: "c".repeat(64),
        sourceChapters: [chapter],
        sourceScripts: [],
        contentHash: graphReference.contentHash,
      },
    ],
  },
  references: [
    chapterReference,
    graphReference,
    ...Array.from({ length: 2 }, () => ({
      sourceKind: "production",
      sourceId: crypto.randomUUID(),
      sourceVersion: 1,
      fieldPath: "/production/formal",
      contentHash: "d".repeat(64),
    })),
  ],
  episode: {
    id: "episode",
    orderIndex: 0,
    title: "求证",
    logline: "求证",
    goal: "求证",
    mainConflict: "误会",
    turningPoint: "行动",
    endingHook: "未知",
    sourceChapters: [
      { ...chapter, adaptationAction: "preserve", rationale: "明确保留" },
    ],
    characterProgress: [
      {
        character: "林晚",
        before: "怀疑",
        after: "求证",
        relationshipChange: "信任",
      },
    ],
    plantedForeshadowing: [],
    paidOffForeshadowing: [],
    estimatedScenes: 1,
    estimatedCharacters: 1,
    durationSeconds: 30,
    productionRisk: "unknown",
    productionNotes: "尚未认证语义",
  },
};
// Break reused fixture aliases: mutating a frozen identity must not also mutate
// the independently confirmed author selection.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const mismatches: Array<(value: typeof basis) => void> = [
  (value) => {
    value.sourceBasis.story = [];
  },
  (value) => {
    value.sourceBasis.story[0]!.selection.id = crypto.randomUUID();
  },
  (value) => {
    value.sourceBasis.story[0]!.selection.version++;
  },
  (value) => {
    value.sourceBasis.references[1]!.contentHash = "e".repeat(64);
  },
  (value) => {
    value.sourceBasis.story.push(copy(value.sourceBasis.story[0]!));
  },
  (value) => {
    value.sourceBasis.references.push(copy(graphReference));
  },
];

test("frozen source and novel context require exact unique story/reference binding; legacy absence stays absence", () => {
  const source = NarrativeSourceBasisSchema.parse(basis.sourceBasis);
  const novel = {
    ...source,
    kind: "author-selected-novel-context",
    target: chapter,
  };
  expect(NarrativeContextBasisSchema.safeParse(novel).success).toBe(true);
  for (const mutate of mismatches) {
    const value = copy(basis);
    mutate(value);
    expect(
      NarrativeSourceBasisSchema.safeParse(value.sourceBasis).success,
    ).toBe(false);
    expect(
      NarrativeContextBasisSchema.safeParse({
        ...value.sourceBasis,
        kind: novel.kind,
        target: chapter,
      }).success,
    ).toBe(false);
  }
  const legacy = {
    ...source,
    story: undefined,
    references: [chapterReference],
  };
  expect(NarrativeSourceBasisSchema.parse(legacy).story).toBeUndefined();
  expect(
    NarrativeContextBasisSchema.parse({
      ...legacy,
      kind: novel.kind,
      target: chapter,
    }).story,
  ).toBeUndefined();
  expect(
    NarrativeSourceBasisSchema.safeParse({
      ...source,
      story: [
        {
          ...source.story![0]!,
          record: { ...source.story![0]!.record, kind: "edge" },
        },
      ],
    }).success,
  ).toBe(false);
});

test("planning and production bind the original confirmed chapter, summary, story and project selection", () => {
  const request = {
    chapterScope: { mode: "selection", chapters: [chapter] },
    context,
  };
  const coverage = {
    included: [
      { ...chapter, title: "明确范围", representations: ["original"] },
    ],
    excluded: [],
    totalChapterCount: 1,
    nonEmptyChapterCount: 1,
  };
  const planning = {
    kind: "author-selected-narrative-planning",
    projectId,
    request: { ...request, format: "narrative-planning-v1" },
    sourceBasis: basis.sourceBasis,
    coverage,
  };
  const production = {
    kind: "author-selected-production-narrative",
    projectId,
    request: { ...request, format: "production-narrative-v1" },
    sourceBasis: basis.sourceBasis,
    coverage: { ...coverage, directoryState: "read" },
  };
  expect(NarrativePlanningSourceSchema.safeParse(planning).success).toBe(true);
  expect(ProductionNarrativeSourceSchema.safeParse(production).success).toBe(
    true,
  );
  for (const changes of [
    { story: [] },
    { chapters: [] },
    { summaries: [{ id: crypto.randomUUID(), version: 1 }] },
  ]) {
    expect(
      NarrativePlanningSourceSchema.safeParse({
        ...planning,
        request: { ...planning.request, context: { ...context, ...changes } },
      }).success,
    ).toBe(false);
    expect(
      ProductionNarrativeSourceSchema.safeParse({
        ...production,
        request: { ...production.request, context: { ...context, ...changes } },
      }).success,
    ).toBe(false);
  }
  expect(
    NarrativePlanningSourceSchema.safeParse({
      ...planning,
      projectId: crypto.randomUUID(),
    }).success,
  ).toBe(false);
  expect(
    ProductionNarrativeSourceSchema.safeParse({
      ...production,
      projectId: crypto.randomUUID(),
    }).success,
  ).toBe(false);
});

test("episode SDK rejects omitted or substituted independently selected frozen story inputs", async () => {
  const result = EpisodeDevelopmentResultSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    workflowId: crypto.randomUUID(),
    episodeId: "episode",
    operation: "episode-outline",
    version: 1,
    basis,
    content: {
      kind: "episode-outline",
      value: {
        ...basis.episode,
        scenes: [
          {
            id: "scene",
            orderIndex: 0,
            location: "庭院",
            timeOfDay: "夜",
            goal: "求证",
            conflict: "误会",
            outcome: "线索",
            characters: ["林晚"],
            durationSeconds: 30,
            sourceChapters: [chapter],
            beats: [{ id: "beat", action: "求证", causalLink: "发现线索" }],
          },
        ],
      },
    },
    sourceSnapshotId: crypto.randomUUID(),
    runIds: [],
    adoptedAt: new Date().toISOString(),
    isCurrent: true,
    sourceState: "current",
    staleReasons: [],
  });
  let reply: unknown = result;
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: crypto.randomUUID(),
    runtimeGeneration: 1,
    fetch: async () => Response.json(reply),
    openEventStream: async () => new Response(),
  }).episodeDevelopments;
  expect(await sdk.get(result.id)).toEqual(result);
  for (const mutate of mismatches) {
    const value = copy(basis);
    mutate(value);
    expect(EpisodeDevelopmentBasisSchema.safeParse(value).success).toBe(false);
    reply = { ...result, basis: value };
    await expect(sdk.get(result.id)).rejects.toThrow();
  }
  // Even internally consistent input must match the independently chosen ID,
  // version and kind. Repairing its own reference does not authorize rebinding.
  for (const change of ["id", "version", "kind"]) {
    const value = {
      ...copy(basis),
      sourceBasis: copy(NarrativeSourceBasisSchema.parse(basis.sourceBasis)),
    };
    const story = value.sourceBasis.story![0]!;
    if (change === "id") story.selection.id = crypto.randomUUID();
    if (change === "version") story.selection.version++;
    if (change === "kind") {
      story.selection.kind = "assertion";
      story.record.kind = "edge";
    }
    value.sourceBasis.references[1] = {
      ...graphReference,
      sourceId: story.selection.id,
      sourceVersion: story.selection.version,
      fieldPath: `/narrative-story-index/${story.selection.kind}s/${story.selection.id}`,
    };
    expect(
      NarrativeSourceBasisSchema.safeParse(value.sourceBasis).success,
    ).toBe(true);
    expect(EpisodeDevelopmentBasisSchema.safeParse(value).success).toBe(false);
    reply = { ...result, basis: value };
    await expect(sdk.get(result.id)).rejects.toThrow();
  }
});
