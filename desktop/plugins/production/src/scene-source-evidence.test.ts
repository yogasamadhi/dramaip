import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EpisodeDevelopmentBasisSchema,
  EpisodeOutlineContentSchema,
} from "@dramaip/contracts/production";
import { inspectSceneSourceEvidence } from "./scene-source-evidence.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture() {
  const chapter = { id: crypto.randomUUID(), version: 2 };
  const value = {
    ...chapter,
    title: "PRIVATE TITLE",
    content: "😀先求证。先求证。",
  };
  const source = {
    sourceKind: "chapter" as const,
    sourceId: chapter.id,
    sourceVersion: chapter.version,
    fieldPath: `/chapters/${chapter.id}`,
  };
  const reference = { ...source, contentHash: hash(value) };
  const basis = EpisodeDevelopmentBasisSchema.parse({
    request: {
      seasonPlan: { id: crypto.randomUUID(), version: 1 },
      episodeId: "episode",
      sourceEvidenceFormat: "exact-expression-quotes-v1",
    },
    authorIntent: { id: crypto.randomUUID(), version: 1 },
    diagnosis: { id: crypto.randomUUID(), version: 1, strategyId: "strategy" },
    chapters: [
      {
        ...chapter,
        title: "章",
        orderIndex: 0,
        contentHash: "a".repeat(64),
        characters: value.content.length,
      },
    ],
    references: [
      reference,
      ...Array.from({ length: 3 }, () => ({
        sourceKind: "knowledge",
        sourceId: crypto.randomUUID(),
        sourceVersion: 1,
        fieldPath: "/knowledge/placeholder",
        contentHash: "a".repeat(64),
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
        { ...chapter, adaptationAction: "preserve", rationale: "保留" },
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
      productionNotes: "尚待核验",
    },
  });
  const outline = EpisodeOutlineContentSchema.parse({
    title: "求证",
    logline: "求证",
    goal: "求证",
    mainConflict: "误会",
    turningPoint: "行动",
    endingHook: "未知",
    scenes: [
      {
        id: "scene",
        orderIndex: 0,
        location: "房间",
        timeOfDay: "夜",
        goal: "求证",
        conflict: "误会",
        outcome: "行动",
        characters: ["林晚"],
        durationSeconds: 30,
        sourceChapters: [chapter],
        sourceEvidence: [
          {
            id: "evidence",
            source,
            valuePath: "/content",
            quote: "先求证",
            rationale: "PRIVATE MODEL RATIONALE",
          },
        ],
        beats: [{ id: "beat", action: "求证", causalLink: "来电" }],
      },
    ],
  });
  const entries = [{ ...source, included: true, value }];
  return { chapter, basis, outline, entries };
}
describe("scene source evidence", () => {
  it("labels actual author-confirmed quotes as human declarations without model attribution or changed exact match proof", () => {
    const { basis, outline, entries } = fixture();
    const model = inspectSceneSourceEvidence(outline, basis, entries)!;
    const human = inspectSceneSourceEvidence(
      outline,
      basis,
      entries,
      "human-declared",
    )!;
    expect(human).toEqual(
      model.map((item) => ({ ...item, attribution: "human-declared" })),
    );
    expect(human[0]?.semanticVerification).toBe("unverified");
    expect(JSON.stringify(human)).not.toMatch(/PRIVATE|先求证|model-declared/u);
    entries[0]!.value.content = "实际来源已经变化";
    expect(() =>
      inspectSceneSourceEvidence(outline, basis, entries, "human-declared"),
    ).toThrow();
  });
  it("keeps all UTF-16 matches and derives body-free metadata, not model semantic proof", () => {
    const { basis, outline, entries } = fixture();
    const evidence = inspectSceneSourceEvidence(outline, basis, entries)!;
    expect(evidence[0]).toMatchObject({
      sceneId: "scene",
      evidenceId: "evidence",
      offsetUnit: "utf16-code-unit",
      matches: [
        { start: 2, end: 5, chapterStart: 2, chapterEnd: 5 },
        { start: 6, end: 9, chapterStart: 6, chapterEnd: 9 },
      ],
      attribution: "model-declared",
      matchVerification: "rule",
      semanticVerification: "unverified",
    });
    expect(JSON.stringify(evidence)).not.toMatch(/PRIVATE|先求证/u);
    expect(evidence[0]!.quoteHash).toBe(
      createHash("sha256").update("先求证").digest("hex"),
    );
  });
  it.each([
    "missing",
    "not-included",
    "duplicate-entry",
    "hash",
    "version",
    "path",
    "title",
    "unselected-body",
    "blank",
    "missing-chapter",
    "duplicate-id",
  ])("rejects %s without inventing a source", (fault) => {
    const { basis, outline, entries } = fixture();
    const evidence = outline.scenes[0]!.sourceEvidence![0]!;
    if (fault === "missing") delete outline.scenes[0]!.sourceEvidence;
    if (fault === "not-included") entries[0]!.included = false;
    if (fault === "duplicate-entry") entries.push(entries[0]!);
    if (fault === "hash") entries[0]!.value.content = "变稿";
    if (fault === "version") evidence.source.sourceVersion++;
    if (fault === "path") evidence.source.fieldPath += "/content";
    if (fault === "title") {
      evidence.valuePath = "/title";
      evidence.quote = entries[0]!.value.title;
    }
    if (fault === "unselected-body") evidence.quote = "未选整章秘密";
    if (fault === "blank") evidence.quote = " ";
    if (fault === "missing-chapter")
      outline.scenes[0]!.sourceChapters.push({
        id: crypto.randomUUID(),
        version: 0,
      });
    if (fault === "duplicate-id")
      outline.scenes[0]!.sourceEvidence!.push(evidence);
    expect(() => inspectSceneSourceEvidence(outline, basis, entries)).toThrow();
  });
  it("preserves legacy absence and rejects unsolicited new claims", () => {
    const { basis, outline, entries } = fixture();
    delete basis.request.sourceEvidenceFormat;
    expect(() => inspectSceneSourceEvidence(outline, basis, entries)).toThrow(
      "历史基准",
    );
    delete outline.scenes[0]!.sourceEvidence;
    expect(inspectSceneSourceEvidence(outline, basis, entries)).toBeUndefined();
  });
  it("rejects too many repeated matches instead of truncating or choosing the first", () => {
    const { basis, outline, entries } = fixture();
    entries[0]!.value.content = "证".repeat(1001);
    basis.references[0]!.contentHash = hash(entries[0]!.value);
    outline.scenes[0]!.sourceEvidence![0]!.quote = "证";
    expect(() => inspectSceneSourceEvidence(outline, basis, entries)).toThrow(
      "不截断",
    );
  });
  it("binds paragraph ID and original chapter offsets, without reading the rest of the chapter", () => {
    const data = fixture();
    const paragraph = {
      ...data.entries[0]!.value,
      representation: "paragraphs",
      paragraphId: "p:stable",
      start: 100,
      end: 110,
    };
    const path = `/chapters/${data.chapter.id}/paragraphs/p%3Astable`;
    data.entries[0] = {
      ...data.entries[0]!,
      fieldPath: path,
      value: paragraph,
    };
    data.basis.references[0] = {
      ...data.basis.references[0]!,
      fieldPath: path,
      contentHash: hash(paragraph),
    };
    data.outline.scenes[0]!.sourceEvidence![0]!.source.fieldPath = path;
    const result = inspectSceneSourceEvidence(
      data.outline,
      data.basis,
      data.entries,
    )!;
    expect(result[0]).toMatchObject({
      paragraphId: "p:stable",
      matches: [
        { start: 2, end: 5, chapterStart: 102, chapterEnd: 105 },
        { start: 6, end: 9, chapterStart: 106, chapterEnd: 109 },
      ],
    });
    const invalidParagraph = { ...paragraph, end: 500 };
    data.entries[0]!.value = invalidParagraph;
    data.basis.references[0]!.contentHash = hash(data.entries[0]!.value);
    expect(() =>
      inspectSceneSourceEvidence(data.outline, data.basis, data.entries),
    ).toThrow("段落身份");
  });
  it.each(["chapter", "higher"])(
    "quotes actual %s summary without fabricating original paragraph positions or semantic coverage",
    (kind) => {
      const { chapter, basis, outline } = fixture();
      const summary = { id: crypto.randomUUID(), version: 1 };
      const value = { summary: "先求证，然后再出门。", title: "PRIVATE" };
      const source = {
        sourceKind: "knowledge" as const,
        sourceId: summary.id,
        sourceVersion: summary.version,
        fieldPath:
          kind === "higher"
            ? `/narrative-summaries/${summary.id}`
            : `/knowledge/${summary.id}`,
      };
      const ref = { ...source, contentHash: hash(value) };
      basis.references[0] = ref;
      basis.request.inheritSeasonNarrative = true;
      basis.contextChapters = basis.chapters;
      basis.sourceBasis = {
        kind: "author-selected-narrative-sources",
        projectId: crypto.randomUUID(),
        chapters:
          kind === "chapter"
            ? [
                {
                  ...chapter,
                  representation: "summary",
                  record: summary,
                  contentHash: "a".repeat(64),
                },
              ]
            : [],
        summaries:
          kind === "higher"
            ? [
                {
                  ...summary,
                  target: { id: crypto.randomUUID(), version: 1, kind: "book" },
                  scopeTitle: "PRIVATE",
                  scopeFingerprint: "a".repeat(64),
                  scopeState: "stale",
                  chapters: [{ ...chapter, contentHash: "a".repeat(64) }],
                },
              ]
            : [],
        omitted: [],
        references: [ref],
      };
      const quote = outline.scenes[0]!.sourceEvidence![0]!;
      quote.source = source;
      quote.valuePath = "/summary";
      const entries = [{ ...source, included: true, value }];
      const result = inspectSceneSourceEvidence(outline, basis, entries)!;
      expect(result[0]!.matches).toEqual([{ start: 0, end: 3 }]);
      expect(result[0]).not.toHaveProperty("paragraphId");
      outline.scenes[0]!.sourceChapters = [
        { id: crypto.randomUUID(), version: 0 },
      ];
      expect(() => inspectSceneSourceEvidence(outline, basis, entries)).toThrow(
        "没有交集",
      );
      // A real Bible in the same snapshot is still not a selected story expression.
      const bible = { ...source, sourceId: crypto.randomUUID() };
      basis.references.push({ ...bible, contentHash: hash(value) });
      quote.source = bible;
      expect(() =>
        inspectSceneSourceEvidence(outline, basis, [
          { ...bible, included: true, value },
        ]),
      ).toThrow("不是实际故事表达");
    },
  );
  it("uses actual direct brief or stable source AST action/dialogue, not directory/title/note", () => {
    const { basis, outline } = fixture();
    const project = { id: crypto.randomUUID(), version: 1 };
    const episode = { id: crypto.randomUUID(), version: 1 };
    const script = { id: crypto.randomUUID(), version: 1, documentVersion: 2 };
    basis.request = {
      direct: {
        entryPath: "inspiration",
        project,
        episode,
        authorIntent: basis.authorIntent,
        sourceScript: script,
        durationSeconds: 30,
      },
      episodeId: episode.id,
      sourceEvidenceFormat: "exact-expression-quotes-v1",
    };
    const sources = [
      {
        sourceKind: "project" as const,
        sourceId: project.id,
        sourceVersion: project.version,
        fieldPath: "/project",
      },
      {
        sourceKind: "production" as const,
        sourceId: script.id,
        sourceVersion: script.version,
        fieldPath: `/production/${script.id}`,
      },
    ];
    const blockId = crypto.randomUUID();
    const entries = [
      {
        ...sources[0]!,
        included: true,
        value: { content: { synopsis: "先求证", productionBrief: "求证计划" } },
      },
      {
        ...sources[1]!,
        included: true,
        value: {
          content: "作者原稿先求证",
          blocks: [{ id: blockId, type: "action", text: "先求证" }],
        },
      },
    ];
    basis.references = entries.map((entry) => ({
      ...entry,
      contentHash: hash(entry.value),
    }));
    outline.scenes[0]!.sourceChapters = [];
    outline.scenes[0]!.sourceReferences = sources;
    outline.scenes[0]!.sourceEvidence = sources.map((source, index) => ({
      id: `evidence-${index}`,
      source,
      valuePath: index ? "/blocks/0/text" : "/content/synopsis",
      quote: "先求证",
      rationale: "PRIVATE",
    }));
    const result = inspectSceneSourceEvidence(outline, basis, entries)!;
    expect(result[1]).toMatchObject({
      sourceBlockId: blockId,
      matches: [{ start: 0, end: 3 }],
    });
    expect(result[1]!.matches[0]).not.toHaveProperty("chapterStart");
    for (const type of ["note", "scene_heading", "character"]) {
      const changed = structuredClone(entries);
      changed[1]!.value.blocks![0]!.type = type;
      basis.references[1]!.contentHash = hash(changed[1]!.value);
      expect(() => inspectSceneSourceEvidence(outline, basis, changed)).toThrow(
        "只允许",
      );
    }
  });
});
