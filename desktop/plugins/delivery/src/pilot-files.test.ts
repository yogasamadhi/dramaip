import { pilotWorkflowLineage } from "./pilot-workflow-lineage.js";
import { PilotPackagePreviewInputSchema } from "@dramaip/contracts/delivery";
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { PilotPackageManifestSchema } from "@dramaip/contracts/delivery";
import type { EpisodeDevelopmentResult } from "@dramaip/contracts/production";
import { EpisodeDevelopmentBasisSchema } from "@dramaip/contracts/production";
import {
  pilotArchive,
  pilotContentFiles,
  pilotCsvCell,
  pilotFile,
  pilotHash,
  pilotSourceContext,
} from "./pilot-files.js";

describe("pilot package files", () => {
  it("accepts only one real adopted source chain and the same direct author intent, without invented diagnosis or plan", () => {
    const ref = () => ({ id: crypto.randomUUID(), version: 1 });
    const authorIntent = ref();
    const common = {
      authorIntent,
      outline: ref(),
      script: ref(),
      storyboard: ref(),
    };
    const diagnosis = { ...ref(), strategyId: "actual-strategy" };
    const seasonPlan = ref();
    const directSource = {
      entryPath: "script",
      project: ref(),
      authorIntent,
      episode: ref(),
      sourceScript: { ...ref(), documentVersion: 0 },
      durationSeconds: 90,
    };
    const schema = PilotPackageManifestSchema.shape.adopted;
    expect(schema.safeParse({ ...common, diagnosis, seasonPlan }).success).toBe(
      true,
    );
    expect(schema.safeParse({ ...common, directSource }).success).toBe(true);
    for (const adopted of [
      common,
      { ...common, diagnosis },
      { ...common, seasonPlan },
      { ...common, diagnosis, seasonPlan, directSource },
      { ...common, directSource: { ...directSource, authorIntent: ref() } },
      { ...common, directSource: { ...directSource, sourceScript: undefined } },
    ])
      expect(schema.safeParse(adopted).success).toBe(false);
  });
  it("round trips exact UTF-8 bytes in deterministic ZIP and rejects metadata corruption, duplicates and unsafe paths", () => {
    const files = [
      pilotFile("README.md", "text/markdown", "# 中文\n\n作者原稿。"),
      pilotFile("nle/timeline.json", "application/json", "{}\n"),
    ];
    const archive = pilotArchive(files);
    expect(pilotArchive(files)).toEqual(archive);
    const bytes = Buffer.from(archive.base64, "base64");
    expect(pilotHash(bytes)).toBe(archive.sha256);
    expect(bytes.length).toBe(archive.byteSize);
    const unpacked = unzipSync(bytes);
    for (const file of files) {
      expect(strFromU8(unpacked[file.fileName]!)).toBe(file.content);
      expect(pilotHash(unpacked[file.fileName]!)).toBe(file.sha256);
      expect(unpacked[file.fileName]!.length).toBe(file.byteSize);
    }
    expect(() => pilotArchive([...files, files[0]!])).toThrow("重复");
    expect(() => pilotArchive([{ ...files[0]!, content: "changed" }])).toThrow(
      "完整性",
    );
    for (const name of [
      "../secret",
      "/absolute",
      "nle/../secret",
      "nle//file",
      "C:\\secret",
      "./file",
      "nle/.",
    ])
      expect(() => pilotFile(name, "text/plain", "x")).toThrow("相对引用");
  });
  it("neutralises spreadsheet formulas and quotes commas, newlines and quotes", () => {
    expect(pilotCsvCell("  =SUM(A1)")).toBe('"\'  =SUM(A1)"');
    expect(pilotCsvCell("@calc")).toBe('"\'@calc"');
    expect(pilotCsvCell('中文,"对白"\n')).toBe('"中文,""对白""\n"');
  });
  it("builds actual multi-format content, stable lineage, global subtitle times and a verifiable non-self-referential manifest", () => {
    const refs = () => ({ id: crypto.randomUUID(), version: 1 });
    const source = refs();
    const basis = EpisodeDevelopmentBasisSchema.parse({
      request: { seasonPlan: refs(), episodeId: "actual-episode" },
      authorIntent: refs(),
      diagnosis: { ...refs(), strategyId: "strategy" },
      chapters: [
        {
          ...source,
          title: "原章",
          orderIndex: 0,
          contentHash: "a".repeat(64),
          characters: 8,
        },
      ],
      references: Array.from({ length: 4 }, () => ({
        sourceKind: "chapter",
        sourceId: source.id,
        sourceVersion: source.version,
        fieldPath: `/chapters/${source.id}/content`,
        contentHash: "a".repeat(64),
      })),
      episode: {
        id: "actual-episode",
        orderIndex: 0,
        title: "首集",
        logline: "求证",
        goal: "找到线索",
        mainConflict: "线索冲突",
        turningPoint: "求证",
        endingHook: "出门",
        sourceChapters: [
          { ...source, adaptationAction: "preserve", rationale: "保留" },
        ],
        characterProgress: [
          {
            character: "林晚",
            before: "怀疑",
            after: "求证",
            relationshipChange: "信任变化",
          },
        ],
        plantedForeshadowing: [],
        paidOffForeshadowing: [],
        estimatedScenes: 1,
        estimatedCharacters: 1,
        durationSeconds: 30,
        productionRisk: "unknown",
        productionNotes: "未核验",
      },
    });
    const sceneId = "actual-scene";
    const blocks = [
      { id: crypto.randomUUID(), type: "action", text: "作者行动" },
    ];
    const result = (
      kind: EpisodeDevelopmentResult["operation"],
      value: unknown,
    ) =>
      ({
        ...refs(),
        operation: kind,
        basis,
        content: { kind, value },
        workflowId: crypto.randomUUID(),
        runIds: [crypto.randomUUID()],
        sourceSnapshotId: crypto.randomUUID(),
        adoptedAt: new Date().toISOString(),
      }) as EpisodeDevelopmentResult;
    const outline = result("episode-outline", {
      scenes: [{ id: sceneId, sourceChapters: [source] }],
    });
    const script = result("episode-script", {
      blocks,
      sceneLinks: [{ sceneId, blockIds: blocks.map((block) => block.id) }],
    });
    const shot = (id: string, orderIndex: number) => ({
      id,
      orderIndex,
      durationSeconds: 10,
      sourceBlockIds: blocks.map((block) => block.id),
      visualAction: "=危险公式",
      composition: "中景",
      camera: "平视",
      movement: "固定",
      sound: "对白",
      prompt: '中文,"对白"',
      negativePrompt: "无水印",
      assetIds: [],
    });
    const storyboard = result("storyboard-package", {
      scenes: [{ sceneId, shots: [shot("s1", 0), shot("s2", 1)] }],
      assets: [],
      subtitles: [
        {
          id: "cue",
          shotId: "s2",
          startSeconds: 1.5,
          endSeconds: 4,
          text: "作者对白",
        },
      ],
    });
    storyboard.productionRecords = [
      { ...refs(), stableId: sceneId, kind: "scenes" },
      { ...refs(), stableId: "s2", kind: "shots" },
    ];
    const manifest = PilotPackageManifestSchema.omit({ files: true }).parse({
      schemaVersion: 1,
      purpose: "internal-pilot",
      projectId: crypto.randomUUID(),
      projectVersion: 3,
      projectTitle: "真实项目",
      episodeId: "actual-episode",
      episodeTitle: "首集",
      durationSeconds: 20,
      adopted: {
        authorIntent: refs(),
        diagnosis: { ...refs(), strategyId: "actual-strategy" },
        seasonPlan: refs(),
        outline,
        script,
        storyboard,
      },
      scriptRecordId: crypto.randomUUID(),
      scriptDocumentVersion: 4,
      productionRecords: storyboard.productionRecords,
      lineage: [
        {
          sourceKind: "writing",
          sourceId: source.id,
          sourceVersion: source.version,
        },
      ],
      preflight: { checks: [], blockers: [], warnings: ["未核验质量"] },
      missingItems: ["媒体缺失"],
      externalDependencies: [],
      costs: { status: "unknown", explanation: "没有报价" },
      media: { binaryIncluded: false, generatedByExport: false },
      indexFile: "manifest.json",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    const built = pilotContentFiles({
      outline,
      script,
      storyboard,
      manifest,
      fountain: "实际 Fountain\n",
      nle: [
        {
          fileName: "real.otio",
          mimeType: "application/json",
          content: '{"actual":true}\n',
        },
      ],
    });
    expect(PilotPackageManifestSchema.parse(built.manifest)).toEqual(
      built.manifest,
    );
    const unpacked = unzipSync(Buffer.from(built.archive.base64, "base64"));
    expect(Object.keys(unpacked)).toHaveLength(14);
    const workflowLineage = pilotWorkflowLineage(
      { id: manifest.projectId, version: manifest.projectVersion },
      [outline, script, storyboard].map((result) => ({
        ...result,
        projectId: manifest.projectId,
      })),
    );
    const withWorkflow = pilotContentFiles({
      outline,
      script,
      storyboard,
      manifest,
      fountain: "actual",
      nle: [],
      workflowLineage,
    });
    const workflowFile = withWorkflow.files.find(
      (file) => file.fileName === "workflow-lineage.json",
    )!;
    expect(JSON.parse(workflowFile.content)).toEqual(workflowLineage);
    expect(withWorkflow.manifest.files).toContainEqual({
      fileName: workflowFile.fileName,
      mimeType: workflowFile.mimeType,
      sha256: workflowFile.sha256,
      byteSize: workflowFile.byteSize,
    });
    const scopedZip = unzipSync(
      Buffer.from(withWorkflow.archive.base64, "base64"),
    );
    expect(strFromU8(scopedZip[workflowFile.fileName]!)).toBe(
      workflowFile.content,
    );
    expect(() =>
      pilotContentFiles({
        outline,
        script,
        storyboard,
        manifest,
        fountain: "actual",
        nle: [],
        workflowLineage: {
          ...workflowLineage,
          sourceProject: {
            id: crypto.randomUUID(),
            version: manifest.projectVersion,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      pilotContentFiles({
        outline,
        script,
        storyboard,
        manifest,
        fountain: "actual",
        nle: [],
        workflowLineage: {
          ...workflowLineage,
          stages: [
            workflowLineage.stages[0]!,
            workflowLineage.stages[0]!,
            workflowLineage.stages[2]!,
          ],
        },
      }),
    ).toThrow();
    expect(strFromU8(unpacked["script.fountain"]!)).toBe("实际 Fountain\n");
    expect(strFromU8(unpacked["subtitles.srt"]!)).toContain(
      "00:00:11,500 --> 00:00:14,000\n作者对白",
    );
    expect(strFromU8(unpacked["storyboard.csv"]!)).toContain('"\'=危险公式"');
    expect(JSON.parse(strFromU8(unpacked["lineage.json"]!))[0]).toMatchObject({
      sourceChapters: [source],
      scriptBlockIds: [blocks[0]!.id],
      sceneRecord: storyboard.productionRecords[0],
      shots: [
        { shotId: "s1" },
        { shotId: "s2", record: storyboard.productionRecords[1] },
      ],
    });
    expect(
      built.manifest.files.some((file) => file.fileName === "manifest.json"),
    ).toBe(false);
    expect(JSON.parse(strFromU8(unpacked["manifest.json"]!))).toEqual(
      built.manifest,
    );
    for (const file of built.manifest.files)
      expect(pilotHash(unpacked[file.fileName]!)).toBe(file.sha256);
    expect(strFromU8(unpacked["nle/real.otio"]!)).toBe('{"actual":true}\n');
    expect(JSON.parse(strFromU8(unpacked["media.json"]!))).toMatchObject({
      binaryIncluded: false,
      generatedByExport: false,
      items: [],
    });
    expect(JSON.parse(strFromU8(unpacked["source-context.json"]!))).toEqual(
      pilotSourceContext([outline, script, storyboard]),
    );
    expect(strFromU8(unpacked["README.md"]!)).toContain(
      "不能由此推定段落到镜头的语义映射",
    );
    if (outline.content.kind !== "episode-outline")
      throw new Error("Actual outline expected");
    outline.content.value.scenes[0]!.sourceEvidence = [
      {
        id: "quote",
        source: {
          sourceKind: "chapter",
          sourceId: source.id,
          sourceVersion: source.version,
          fieldPath: `/chapters/${source.id}`,
        },
        valuePath: "/content",
        quote: "PRIVATE ACTUAL QUOTE",
        rationale: "PRIVATE MODEL REASON",
      },
    ];
    outline.sourceEvidence = [
      {
        sceneId,
        evidenceId: "quote",
        source: {
          ...outline.content.value.scenes[0]!.sourceEvidence[0]!.source,
          contentHash: "a".repeat(64),
        },
        valuePath: "/content",
        quoteHash: pilotHash("PRIVATE ACTUAL QUOTE"),
        quoteCharacters: 20,
        offsetUnit: "utf16-code-unit",
        matches: [{ start: 2, end: 22, chapterStart: 2, chapterEnd: 22 }],
        attribution: "model-declared",
        matchVerification: "rule",
        semanticVerification: "unverified",
      },
    ];
    const quotedPackage = pilotContentFiles({
      outline,
      script,
      storyboard,
      manifest,
      fountain: "Actual body",
      nle: [],
    });
    for (const file of quotedPackage.files)
      expect(file.content).not.toMatch(
        /PRIVATE ACTUAL QUOTE|PRIVATE MODEL REASON/u,
      );
    expect(
      quotedPackage.files.find((file) => file.fileName === "outline.json")!
        .content,
    ).not.toContain("sourceEvidence");
    const sceneLineage = JSON.parse(
      quotedPackage.files.find((file) => file.fileName === "lineage.json")!
        .content,
    );
    expect(sceneLineage[0]).toMatchObject({
      sourceEvidence: outline.sourceEvidence,
      downstreamAssociation: "via-declared-scene-not-shot-specific-attribution",
      shots: [
        { sceneEvidenceIds: ["quote"], associationScope: "scene" },
        { sceneEvidenceIds: ["quote"], associationScope: "scene" },
      ],
    });
  });
  it("exports exact mixed paragraph, chapter-summary and higher-summary identities without text or pretending episode mapping is the complete input", () => {
    const ref = () => ({ id: crypto.randomUUID(), version: 2 });
    const chapters = [0, 1, 2].map((orderIndex) => ({
      ...ref(),
      orderIndex,
      title: "PRIVATE chapter title",
      contentHash: "a".repeat(64),
      characters: 20,
    }));
    const memory = ref();
    const higher = ref();
    const references = [
      {
        sourceKind: "chapter" as const,
        sourceId: chapters[0]!.id,
        sourceVersion: chapters[0]!.version,
        fieldPath: `/chapters/${chapters[0]!.id}/paragraphs/p1`,
        contentHash: "b".repeat(64),
        value: "PRIVATE source text",
      },
      {
        sourceKind: "knowledge" as const,
        sourceId: memory.id,
        sourceVersion: memory.version,
        fieldPath: `/knowledge/${memory.id}/chapter-memory`,
        contentHash: "c".repeat(64),
        value: "PRIVATE memory",
      },
      {
        sourceKind: "knowledge" as const,
        sourceId: higher.id,
        sourceVersion: higher.version,
        fieldPath: `/knowledge/${higher.id}/narrative-summary`,
        contentHash: "d".repeat(64),
        value: "PRIVATE higher summary",
      },
    ];
    const result: Parameters<typeof pilotSourceContext>[0][number] = {
      ...ref(),
      operation: "episode-outline",
      workflowId: crypto.randomUUID(),
      sourceSnapshotId: crypto.randomUUID(),
      basis: {
        request: {
          seasonPlan: ref(),
          episodeId: "actual-episode",
          inheritSeasonNarrative: true,
        },
        chapters: [chapters[0]!],
        contextChapters: chapters,
        references,
        sourceBasis: {
          kind: "author-selected-narrative-sources",
          projectId: crypto.randomUUID(),
          chapters: [
            {
              ...chapters[0]!,
              representation: "paragraphs",
              paragraphIds: ["p1"],
            },
            { ...chapters[1]!, representation: "summary", record: memory },
            { ...chapters[2]!, representation: "original" },
          ],
          summaries: [
            {
              ...higher,
              target: { ...ref(), kind: "book" },
              scopeTitle: "PRIVATE summary title",
              scopeFingerprint: "e".repeat(64),
              scopeState: "current",
              chapters,
            },
          ],
          omitted: [],
          references: references.slice(0, 2),
        },
      },
    };
    const exported = pilotSourceContext([result]);
    expect(exported).toMatchObject({
      textIncluded: false,
      provesModelUnderstanding: false,
      provesParagraphToShotMapping: false,
    });
    const stage = exported.stages[0]!;
    expect(stage.episodeChapterMapping).toEqual([
      { id: chapters[0]!.id, version: chapters[0]!.version },
    ]);
    expect(stage.contextChapters).toHaveLength(3);
    expect(stage.selection!.chapters[0]).toMatchObject({
      representation: "paragraphs",
      paragraphIds: ["p1"],
      contentHash: "a".repeat(64),
    });
    expect(stage.selection!.chapters[1]).toMatchObject({
      representation: "summary",
      record: memory,
    });
    expect(stage.selection!.chapters[2]!.representation).toBe("original");
    expect(stage.selection!.higherSummaries[0]).toMatchObject({
      ...higher,
      scopeFingerprint: "e".repeat(64),
      frozenScopeState: "current",
    });
    expect(stage.references).toEqual(
      references.map(({ value: _value, ...value }) => value),
    );
    expect(JSON.stringify(exported)).not.toContain("PRIVATE");
    expect(JSON.stringify(exported)).not.toContain("sourceChapters");
    expect(JSON.stringify(exported)).not.toContain("shots");
  });
  it("keeps legacy episode originals and real direct source identity separate without upgrading or inventing novel context", () => {
    const ref = () => ({ id: crypto.randomUUID(), version: 1 });
    const chapter = {
      ...ref(),
      title: "原章",
      contentHash: "a".repeat(64),
      orderIndex: 0,
      characters: 8,
    };
    const common = {
      ...ref(),
      operation: "episode-script" as const,
      workflowId: crypto.randomUUID(),
      sourceSnapshotId: crypto.randomUUID(),
    };
    const direct = {
      entryPath: "script" as const,
      project: ref(),
      authorIntent: ref(),
      episode: ref(),
      sourceScript: { ...ref(), documentVersion: 3 },
      durationSeconds: 90,
    };
    const exported = pilotSourceContext([
      {
        ...common,
        basis: {
          request: { seasonPlan: ref(), episodeId: "episode" },
          chapters: [chapter],
          references: [],
        },
      },
      {
        ...common,
        basis: {
          request: { direct, episodeId: direct.episode.id },
          chapters: [],
          references: [],
        },
      },
    ]);
    expect(exported.stages[0]).toMatchObject({
      inputKind: "episode-originals",
      contextChapters: [{ id: chapter.id, version: chapter.version }],
    });
    expect(exported.stages[0]!.selection).toBeUndefined();
    expect(exported.stages[1]).toMatchObject({
      inputKind: "direct-source",
      episodeChapterMapping: [],
      contextChapters: [],
      directSource: { sourceScript: direct.sourceScript },
    });
    expect(exported.stages[1]!.selection).toBeUndefined();
    expect(exported.stages[1]!.directSource).not.toHaveProperty("seasonPlan");
  });
  it("rejects archive size beyond the structural export bound", () => {
    expect(() =>
      pilotArchive([
        pilotFile("large.txt", "text/plain", "x".repeat(30_000_001)),
      ]),
    ).toThrow("上限");
  });
});

it("exports only explicitly frozen story interpretation identities and provenance, with no source text or invented legacy selection", () => {
  const ref = () => ({ id: crypto.randomUUID(), version: 1 });
  const chapter = {
    ...ref(),
    title: "PRIVATE chapter title",
    orderIndex: 0,
    characters: 12,
    contentHash: "a".repeat(64),
  };
  const stories = (["node", "edge", "cognition"] as const).map(
    (kind, index) => ({
      selection: {
        ...ref(),
        kind: index === 0 ? ("declaration" as const) : ("assertion" as const),
        privateExplanation: "PRIVATE selected explanation",
      },
      record: { ...ref(), kind, privateStatement: "PRIVATE actual statement" },
      sourceFingerprint: String(index + 1).repeat(64),
      contentHash: String(index + 4).repeat(64),
      sourceChapters: [
        {
          id: chapter.id,
          version: chapter.version,
          privateQuote: "PRIVATE source quote",
        },
      ],
      sourceScripts: [],
      privateRationale: "PRIVATE author rationale",
    }),
  );
  const source = {
    kind: "author-selected-narrative-sources" as const,
    projectId: crypto.randomUUID(),
    chapters: [],
    omitted: [],
    references: [],
    story: stories,
  };
  const result: Parameters<typeof pilotSourceContext>[0][number] = {
    ...ref(),
    operation: "episode-outline",
    workflowId: crypto.randomUUID(),
    sourceSnapshotId: crypto.randomUUID(),
    basis: {
      request: {
        seasonPlan: ref(),
        episodeId: "original-episode",
        inheritSeasonNarrative: true,
      },
      chapters: [chapter],
      references: [],
      sourceBasis: source,
    },
  };
  const exported = pilotSourceContext([result]);
  expect(exported.stages[0]!.selection).toHaveProperty(
    "storyInterpretations",
    stories.map((story) => ({
      selection: {
        id: story.selection.id,
        version: story.selection.version,
        kind: story.selection.kind,
      },
      record: {
        id: story.record.id,
        version: story.record.version,
        kind: story.record.kind,
      },
      sourceFingerprint: story.sourceFingerprint,
      contentHash: story.contentHash,
      sourceChapters: [{ id: chapter.id, version: chapter.version }],
      sourceScripts: [],
      evidencePolicy:
        "frozen-selected-interpretation-not-semantic-proof-or-shot-attribution",
    })),
  );
  expect(JSON.stringify(exported)).not.toContain("PRIVATE");
  expect(exported.provesParagraphToShotMapping).toBe(false);
  expect(exported.provesModelUnderstanding).toBe(false);
  const empty = pilotSourceContext([
    {
      ...result,
      basis: { ...result.basis, sourceBasis: { ...source, story: [] } },
    },
  ]);
  expect(empty.stages[0]!.selection).toHaveProperty("storyInterpretations", []);
  const old = pilotSourceContext([
    {
      ...result,
      basis: { ...result.basis, sourceBasis: { ...source, story: undefined } },
    },
  ]);
  expect(old.stages[0]!.selection).not.toHaveProperty("storyInterpretations");
});

describe("M4 explicit internal pilot workflow lineage", () => {
  it("preserves absent historical opt-in and validates the explicit new preview choice", () => {
    const input = {
      projectVersion: 0,
      storyboard: { id: crypto.randomUUID(), version: 1 },
      includeNle: false,
    };
    expect(PilotPackagePreviewInputSchema.parse(input)).toEqual(input);
    expect(
      PilotPackagePreviewInputSchema.parse({
        ...input,
        includeWorkflowLineage: true,
      }),
    ).toEqual({ ...input, includeWorkflowLineage: true });
    expect(
      PilotPackagePreviewInputSchema.safeParse({
        ...input,
        includeWorkflowLineage: "yes",
      }).success,
    ).toBe(false);
  });
  const setup = () => {
    const project = { id: crypto.randomUUID(), version: 3 };
    const results = [
      "episode-outline",
      "episode-script",
      "storyboard-package",
    ].map((operation) => ({
      id: crypto.randomUUID(),
      version: 1,
      projectId: project.id,
      operation,
      origin: "model",
      workflowId: crypto.randomUUID(),
      sourceSnapshotId: crypto.randomUUID(),
      runIds: [crypto.randomUUID()],
    })) as Parameters<typeof pilotWorkflowLineage>[1];
    const receipts = results.map((result) => ({
      id: result.workflowId!,
      projectId: project.id,
      taskId: crypto.randomUUID(),
      version: 5,
      operation: result.operation,
      stage: "applied" as const,
      outputs: { episodeResultId: result.id },
      sourceSnapshotId: result.sourceSnapshotId,
      runIds: result.runIds,
      contextSnapshotIds: [],
      sourceVersions: [],
      referenceVersions: [],
      frozenReferences: [],
      narrativeSelections: [],
      chapterScopes: [],
      contextBudgets: [],
      upstream: [],
      createdAt: "2026-10-06T00:00:00.000Z",
      updatedAt: "2026-10-06T00:00:01.000Z",
    }));
    return { project, results, receipts };
  };
  it("exports only three exact original adopted stages after complete pagination, preserving identities and excluding unrelated workflows", () => {
    const { project, results, receipts } = setup();
    const unrelated = { ...receipts[0]!, id: crypto.randomUUID(), outputs: {} };
    const calls: (string | undefined)[] = [];
    const value = pilotWorkflowLineage(project, results, {
      list: (_project, options) => {
        expect(_project).toBe(project.id);
        expect(options.limit).toBe(25);
        calls.push(options.cursor);
        return options.cursor
          ? { items: receipts.slice(1) }
          : { items: [unrelated, receipts[0]!], nextCursor: "original-page-2" };
      },
    });
    expect(calls).toEqual([undefined, "original-page-2"]);
    expect(value).toMatchObject({
      textIncluded: false,
      semanticVerification: "unverified",
      coverage:
        "selected-adopted-production-workflows-only-not-project-history",
    });
    expect(
      value.stages.map((stage) =>
        stage.state === "available" ? stage.receipt : undefined,
      ),
    ).toEqual(receipts);
    expect(JSON.stringify(value)).not.toContain(unrelated.id);
  });
  it("rejects source, output, operation, run, project, duplicate and private-field receipt corruption without partial results", () => {
    const { project, results, receipts } = setup();
    for (const patch of [
      { sourceSnapshotId: crypto.randomUUID() },
      { outputs: { episodeResultId: crypto.randomUUID() } },
      { stage: "awaiting-review" },
      { operation: "chapter" },
      { runIds: [crypto.randomUUID()] },
      { projectId: crypto.randomUUID() },
      { preparedPrompt: "PRIVATE" },
    ])
      expect(() =>
        pilotWorkflowLineage(project, results, {
          list: () =>
            ({
              items: [{ ...receipts[0]!, ...patch }, ...receipts.slice(1)],
            }) as never,
        }),
      ).toThrow();
    expect(() =>
      pilotWorkflowLineage(project, results, {
        list: () => ({ items: [...receipts, receipts[0]!] }) as never,
      }),
    ).toThrow();
    expect(() =>
      pilotWorkflowLineage(project, results, {
        list: () => ({ items: [receipts[0]!], nextCursor: "loop" }) as never,
      }),
    ).toThrow();
    expect(() => pilotWorkflowLineage(project, results.slice(1))).toThrow();
  });
  it("keeps missing original receipts unavailable and human confirmation separate without borrowing a newer model workflow", () => {
    const { project, results, receipts } = setup();
    expect(
      pilotWorkflowLineage(project, results).stages.every(
        (stage) => stage.state === "unavailable",
      ),
    ).toBe(true);
    const human = results.map((result, index) =>
      index === 1
        ? { ...result, origin: "human-script-revision" as const }
        : result,
    );
    const value = pilotWorkflowLineage(project, human, {
      list: () => ({ items: receipts }) as never,
    });
    expect(value.stages[1]).toEqual({
      result: { id: results[1]!.id, version: 1 },
      operation: "episode-script",
      origin: "human-script-revision",
      state: "human-confirmation-not-new-model-input",
    });
    expect(value.stages[1]).not.toHaveProperty("receipt");
    const newer = { ...receipts[0]!, id: crypto.randomUUID() };
    expect(
      pilotWorkflowLineage(project, results, {
        list: () => ({ items: [newer] }) as never,
      }).stages.every((stage) => stage.state === "unavailable"),
    ).toBe(true);
  });
});
