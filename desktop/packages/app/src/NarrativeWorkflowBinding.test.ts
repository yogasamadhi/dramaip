import { expect, test } from "vitest";
import { createStudioClient } from "@dramaip/client";
import {
  CreationWorkflowSchema,
  NarrativeSourceBasisSchema,
} from "@dramaip/contracts/creation";
import {
  NarrativeQualityBasisSchema,
  NarrativeQualityReportSchema,
  NarrativeLocalQualityBasisSchema,
} from "@dramaip/contracts/creative-quality";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const identity = () => ({ id: crypto.randomUUID(), version: 1 });
const projectId = crypto.randomUUID(),
  chapter = identity(),
  target = identity();
const selection = { ...identity(), kind: "declaration" as const };
const chapterReference = {
  sourceKind: "chapter" as const,
  sourceId: chapter.id,
  sourceVersion: chapter.version,
  fieldPath: `/chapters/${chapter.id}`,
  contentHash: "a".repeat(64),
};
const storyReference = {
  sourceKind: "knowledge" as const,
  sourceId: selection.id,
  sourceVersion: selection.version,
  fieldPath: `/narrative-story-index/declarations/${selection.id}`,
  contentHash: "b".repeat(64),
};
const context = {
  format: "narrative-context-v1" as const,
  chapters: [{ ...chapter, representation: "original" as const }],
  story: [selection],
};
const source = NarrativeSourceBasisSchema.parse({
  kind: "author-selected-narrative-sources",
  projectId,
  chapters: [
    {
      ...chapter,
      representation: "original",
      contentHash: chapterReference.contentHash,
    },
  ],
  story: [
    {
      selection,
      record: { ...identity(), kind: "node" },
      sourceFingerprint: "c".repeat(64),
      sourceChapters: [chapter],
      sourceScripts: [],
      contentHash: storyReference.contentHash,
    },
  ],
  omitted: [],
  references: [chapterReference, storyReference],
});
const missingStory = NarrativeSourceBasisSchema.parse({
  ...source,
  story: [],
  references: [chapterReference],
});
const base = {
  id: crypto.randomUUID(),
  taskId: crypto.randomUUID(),
  stage: "awaiting-review",
  version: 1,
  runIds: [],
  contextSnapshotIds: [],
  sources: [],
  preparedPrompt: "",
  issues: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const input = { projectId, instruction: "明确原输入", engineKind: "pi" };
const novel = {
  ...base,
  input: {
    ...input,
    operation: "chapter",
    targetId: target.id,
    baseVersion: target.version + 1,
    narrativeContextRequest: context,
  },
  narrativeContextBasis: {
    ...source,
    kind: "author-selected-novel-context",
    target,
  },
};
const planningRequest = {
  format: "narrative-planning-v1",
  chapterScope: { mode: "selection", chapters: [chapter] },
  context,
};
const coverage = {
  included: [{ ...chapter, title: "原范围", representations: ["original"] }],
  excluded: [],
  totalChapterCount: 1,
  nonEmptyChapterCount: 1,
};
const planningBasis = {
  kind: "author-selected-narrative-planning",
  projectId,
  request: planningRequest,
  operation: "book-outline",
  sourceBasis: source,
  coverage,
  references: [chapterReference, storyReference],
};
const planning = {
  ...base,
  input: {
    ...input,
    operation: "book-outline",
    narrativePlanningRequest: planningRequest,
  },
  narrativePlanningBasis: planningBasis,
};
const productionRequest = {
  ...planningRequest,
  format: "production-narrative-v1",
};
const production = {
  ...base,
  input: {
    ...input,
    operation: "review-check",
    productionNarrativeRequest: productionRequest,
  },
  productionNarrativeBasis: {
    ...planningBasis,
    kind: "author-selected-production-narrative",
    operation: "review-check",
    request: productionRequest,
    coverage: { ...coverage, directoryState: "read" },
  },
};
const quality = {
  request: {
    target: { kind: "chapter-set", id: projectId, version: 0 },
    dimensions: ["causality"],
    chapterScope: { mode: "selection", chapters: [chapter] },
    context,
  },
  baseReportId: null,
  references: [chapterReference, storyReference],
  sourceBasis: source,
  chapterCoverage: { ...coverage, mode: "selection" },
};

test("novel frozen inputs retain the original confirmed story identity, not just internally coherent references", () => {
  expect(CreationWorkflowSchema.safeParse(novel).success).toBe(true);
  // A deliberate target-only rebase may retain an older context target version.
  expect(novel.input.baseVersion).not.toBe(
    novel.narrativeContextBasis.target.version,
  );
  expect(
    CreationWorkflowSchema.safeParse({
      ...novel,
      narrativeContextBasis: {
        ...missingStory,
        kind: "author-selected-novel-context",
        target,
      },
    }).success,
  ).toBe(false);
  for (const change of ["id", "version", "kind"]) {
    const changed = copy(source),
      story = changed.story![0]!;
    if (change === "id") story.selection.id = crypto.randomUUID();
    if (change === "version") story.selection.version++;
    if (change === "kind") {
      story.selection.kind = "assertion";
      story.record.kind = "edge";
    }
    changed.references[1] = {
      ...storyReference,
      sourceId: story.selection.id,
      sourceVersion: story.selection.version,
      fieldPath: `/narrative-story-index/${story.selection.kind}s/${story.selection.id}`,
    };
    expect(NarrativeSourceBasisSchema.safeParse(changed).success).toBe(true);
    expect(
      CreationWorkflowSchema.safeParse({
        ...novel,
        narrativeContextBasis: {
          ...changed,
          kind: "author-selected-novel-context",
          target,
        },
      }).success,
    ).toBe(false);
  }
});

test("planning and production workflow outer author requests cannot be replaced while frozen internal inputs stay coherent", () => {
  for (const value of [planning, production])
    expect(CreationWorkflowSchema.safeParse(value).success).toBe(true);
  for (const changed of [
    { story: [] },
    { chapters: [] },
    { summaries: [identity()] },
  ]) {
    expect(
      CreationWorkflowSchema.safeParse({
        ...planning,
        input: {
          ...planning.input,
          narrativePlanningRequest: {
            ...planningRequest,
            context: { ...context, ...changed },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      CreationWorkflowSchema.safeParse({
        ...production,
        input: {
          ...production.input,
          productionNarrativeRequest: {
            ...productionRequest,
            context: { ...context, ...changed },
          },
        },
      }).success,
    ).toBe(false);
  }
});

test("model and local quality bases bind their confirmed mixed expressions to original project and story inputs", () => {
  expect(NarrativeQualityBasisSchema.safeParse(quality).success).toBe(true);
  const { baseReportId: _head, ...local } = quality;
  expect(NarrativeLocalQualityBasisSchema.safeParse(local).success).toBe(true);
  for (const sourceBasis of [
    missingStory,
    { ...source, projectId: crypto.randomUUID() },
  ]) {
    expect(
      NarrativeQualityBasisSchema.safeParse({ ...quality, sourceBasis })
        .success,
    ).toBe(false);
    expect(
      NarrativeLocalQualityBasisSchema.safeParse({ ...local, sourceBasis })
        .success,
    ).toBe(false);
  }
});

test("legacy absence and explicit no-manuscript planning remain legitimate, while nested invalid sources do not make safeParse throw", () => {
  const legacy = {
    ...novel,
    input: { ...novel.input, narrativeContextRequest: undefined },
    narrativeContextBasis: {
      ...missingStory,
      kind: "author-selected-novel-context",
      target,
      story: undefined,
    },
  };
  expect(
    CreationWorkflowSchema.parse(legacy).narrativeContextBasis!.story,
  ).toBeUndefined();
  const none = {
    format: "narrative-planning-v1",
    chapterScope: { mode: "none", chapters: [] },
    context: { format: "narrative-context-v1", chapters: [] },
  };
  const emptySource = {
    kind: "author-selected-narrative-sources",
    projectId,
    chapters: [],
    omitted: [],
    references: [],
  };
  expect(
    CreationWorkflowSchema.safeParse({
      ...planning,
      input: { ...planning.input, narrativePlanningRequest: none },
      narrativePlanningBasis: {
        ...planningBasis,
        request: none,
        sourceBasis: emptySource,
        coverage: {
          included: [],
          excluded: [],
          totalChapterCount: 0,
          nonEmptyChapterCount: 0,
        },
        references: [chapterReference],
      },
    }).success,
  ).toBe(true);
  const legacyQuality = {
    ...quality,
    request: { ...quality.request, context: undefined },
    sourceBasis: undefined,
  };
  expect(
    NarrativeQualityBasisSchema.parse(legacyQuality).sourceBasis,
  ).toBeUndefined();
  for (const value of [novel, planning, production]) {
    const invalid = copy(value);
    if ("narrativeContextBasis" in invalid)
      invalid.narrativeContextBasis.references[1]!.contentHash = "invalid";
    if ("narrativePlanningBasis" in invalid)
      invalid.narrativePlanningBasis.sourceBasis.references[1]!.contentHash =
        "invalid";
    if ("productionNarrativeBasis" in invalid)
      invalid.productionNarrativeBasis.sourceBasis.references[1]!.contentHash =
        "invalid";
    expect(() => CreationWorkflowSchema.safeParse(invalid)).not.toThrow();
    expect(CreationWorkflowSchema.safeParse(invalid).success).toBe(false);
  }
});

test("actual SDK rejects coherent substituted frozen workflow inputs and quality report sources", async () => {
  let reply: unknown = novel;
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: crypto.randomUUID(),
    runtimeGeneration: 1,
    fetch: async () => Response.json(reply),
    openEventStream: async () => new Response(),
  });
  expect((await sdk.creation.get(novel.id)).id).toBe(novel.id);
  for (const value of [
    {
      ...novel,
      narrativeContextBasis: {
        ...missingStory,
        kind: "author-selected-novel-context",
        target,
      },
    },
    {
      ...planning,
      input: {
        ...planning.input,
        narrativePlanningRequest: {
          ...planningRequest,
          context: { ...context, story: [] },
        },
      },
    },
    {
      ...production,
      input: {
        ...production.input,
        productionNarrativeRequest: {
          ...productionRequest,
          context: { ...context, story: [] },
        },
      },
    },
  ]) {
    reply = value;
    await expect(sdk.creation.get(value.id)).rejects.toThrow();
  }
  // The reply may be internally coherent but still differ from the author's
  // independent start request. A server reply is not permission to rebind it.
  reply = {
    ...novel,
    input: {
      ...novel.input,
      narrativeContextRequest: { ...context, story: [] },
    },
    narrativeContextBasis: {
      ...missingStory,
      kind: "author-selected-novel-context",
      target,
    },
  };
  expect(CreationWorkflowSchema.safeParse(reply).success).toBe(true);
  await expect(
    sdk.creation.start(
      CreationWorkflowSchema.parse(novel).input,
      crypto.randomUUID(),
    ),
  ).rejects.toThrow();
  const report = NarrativeQualityReportSchema.parse({
    id: crypto.randomUUID(),
    projectId,
    workflowId: crypto.randomUUID(),
    version: 1,
    status: "adopted",
    basis: quality,
    content: {
      summary: "模型仅声明已提供的范围，不认证文学质量",
      reviewedDimensions: ["causality"],
      reviewedChapters: [chapter],
      issues: [],
    },
    dispositions: [],
    sourceSnapshotId: crypto.randomUUID(),
    runIds: [crypto.randomUUID()],
    engineKind: "pi",
    usage: { state: "unknown" },
    isCurrent: true,
    sourceState: "current",
    staleReasons: [],
    blockers: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  reply = report;
  expect((await sdk.narrativeQuality.get(report.id)).id).toBe(report.id);
  reply = { ...report, basis: { ...quality, sourceBasis: missingStory } };
  await expect(sdk.narrativeQuality.get(report.id)).rejects.toThrow();
});

test("explicit planning and production bases cannot invent confirmations when the original outer request is absent", async () => {
  let reply: unknown;
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: crypto.randomUUID(),
    runtimeGeneration: 1,
    fetch: async () => Response.json(reply),
    openEventStream: async () => new Response(),
  });
  for (const [value, field] of [
    [planning, "narrativePlanningRequest"],
    [production, "productionNarrativeRequest"],
  ] as const) {
    expect(CreationWorkflowSchema.safeParse(value).success).toBe(true);
    const invalid = copy(value);
    delete (invalid.input as Record<string, unknown>)[field];
    expect(() => CreationWorkflowSchema.safeParse(invalid)).not.toThrow();
    expect(CreationWorkflowSchema.safeParse(invalid).success).toBe(false);
    reply = invalid;
    await expect(sdk.creation.get(value.id)).rejects.toThrow();
  }
});

test("quality workflow basis stays bound to its original confirmed target, dimensions and context through the real SDK", async () => {
  const valid = {
    ...base,
    input: {
      ...input,
      operation: "quality-review",
      targetId: projectId,
      baseVersion: 0,
      qualityReviewRequest: quality.request,
    },
    narrativeQualityBasis: quality,
  };
  expect(CreationWorkflowSchema.safeParse(valid).success).toBe(true);
  let reply: unknown = valid;
  const sdk = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: crypto.randomUUID(),
    runtimeGeneration: 1,
    fetch: async () => Response.json(reply),
    openEventStream: async () => new Response(),
  });
  expect((await sdk.creation.get(valid.id)).id).toBe(valid.id);
  const changed = copy(valid);
  changed.narrativeQualityBasis.request.dimensions = ["pacing"];
  const absent = copy(valid);
  delete (absent.input as Record<string, unknown>).qualityReviewRequest;
  for (const invalid of [changed, absent]) {
    expect(
      NarrativeQualityBasisSchema.safeParse(invalid.narrativeQualityBasis)
        .success,
    ).toBe(true);
    expect(() => CreationWorkflowSchema.safeParse(invalid)).not.toThrow();
    expect(CreationWorkflowSchema.safeParse(invalid).success).toBe(false);
    reply = invalid;
    await expect(sdk.creation.get(valid.id)).rejects.toThrow();
  }
});
