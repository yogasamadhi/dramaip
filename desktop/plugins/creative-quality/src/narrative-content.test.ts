import { describe, expect, it } from "vitest";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import {
  NarrativeQualityRequestSchema,
  NarrativeQualityBasisSchema,
  type NarrativeQualityBasis,
  type NarrativeQualityReport,
  NarrativeLocalQualitySourceSchema,
  NarrativeLocalQualityReviewSchema,
} from "@dramaip/contracts/creative-quality";
import {
  inspectLocalHumanContent,
  inspectLocalLiteralRepetition,
  localQualityDigest,
} from "./narrative-local-content";
import { assessLocalNarrativeReviews } from "./narrative-local-assessment";
import { inspectNarrativeContent, narrativeValueAt } from "./narrative-content";
import {
  assessNarrativeReports,
  summarizeNarrativeReport,
} from "./narrative-assessment";

const id = "0f6ebd3c-f193-4ce2-8ac9-4571e46a2ec1";
const reference: AgentContextReference = {
  sourceKind: "chapter",
  sourceId: id,
  sourceVersion: 3,
  fieldPath: `/chapters/${id}`,
  value: { content: "小禾把铜钥匙交给阿桥。阿桥在雨停后归还。" },
  sensitivity: "project",
};
const basis: NarrativeQualityBasis = {
  request: {
    target: { kind: "chapter", id, version: 3 },
    dimensions: ["causality", "timeline"],
  },
  baseReportId: null,
  references: [
    {
      sourceKind: "chapter",
      sourceId: id,
      sourceVersion: 3,
      fieldPath: reference.fieldPath,
      contentHash: "a".repeat(64),
    },
  ],
};
const content = () => ({
  summary: "仅核对指定字段中的因果与时序；不是文学质量保证。",
  reviewedDimensions: ["causality", "timeline"],
  issues: [
    {
      id: "cause-1",
      category: "causality",
      severity: "warning",
      source: "model",
      message: "交还动机需要说明",
      suggestion: "由作者核对是否补充动机，不自动改正文。",
      evidence: [
        {
          sourceId: id,
          sourceVersion: 3,
          fieldPath: reference.fieldPath,
          valuePath: "/content",
          quote: "阿桥在雨停后归还。",
        },
      ],
    },
  ],
});
const fourthId = "5355d03e-8ed1-457a-9eac-c775f4f546ca";
describe("native exact literal rules", () => {
  const sourceFor = (text: string) =>
    NarrativeLocalQualitySourceSchema.parse({
      format: "narrative-local-review-source-v1",
      projectId: crypto.randomUUID(),
      sourceFingerprint: "c".repeat(64),
      baseReviewId: null,
      basis: { request: basis.request, references: basis.references },
      references: [{ ...reference, value: { content: text } }],
    });
  it("checks only exact complete bounded target paragraphs and never synthesizes semantic coverage", () => {
    const paragraph =
        "重复文字只提供逐字结构提示，不是因果、人物或节奏质量认证。".repeat(3),
      source = sourceFor(`${paragraph}\n\n${paragraph}`);
    const result = inspectLocalLiteralRepetition(source);
    expect(result.semanticCoverage).toBe("not-assessed");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      source: "rule",
      category: "repetition",
      severity: "suggestion",
      evidence: [
        { sourceId: id, valuePath: "/content", quote: paragraph },
        { sourceId: id, valuePath: "/content", quote: paragraph },
      ],
    });
    for (const text of [
      "短段\n\n短段",
      `${"长".repeat(2001)}\n\n${"长".repeat(2001)}`,
      `${paragraph}\n\n${paragraph}不同`,
    ])
      expect(inspectLocalLiteralRepetition(sourceFor(text)).findings).toEqual(
        [],
      );
    expect(localQualityDigest({ z: 1, a: { b: 2, a: 3 } })).toBe(
      localQualityDigest({ a: { a: 3, b: 2 }, z: 1 }),
    );
    expect(localQualityDigest([1, 2])).not.toBe(localQualityDigest([2, 1]));
  });
  it("retains explicit finding and evidence caps rather than making an unbounded or complete detection claim", () => {
    const paragraphs = Array.from(
      { length: 101 },
      (_, i) =>
        `第${i}段只作逐字重复规则范围的实际边界验证；程序不会认证文学或语义质量，也不会扩充检测规则。`,
    );
    const result = inspectLocalLiteralRepetition(
      sourceFor(
        paragraphs.flatMap((paragraph) => [paragraph, paragraph]).join("\n\n"),
      ),
    );
    expect(result.findings).toHaveLength(100);
    expect(result.summary).toContain("最多列100条提示");
    expect(
      inspectLocalLiteralRepetition(
        sourceFor(Array(20).fill(paragraphs[0]).join("\n\n")),
      ).findings[0]!.evidence,
    ).toHaveLength(12);
  });
});
describe("ordinary saved quality evidence", () => {
  function saved(kind: "script" | "scene") {
    const projectId = crypto.randomUUID(),
      documentId = crypto.randomUUID(),
      blockId = crypto.randomUUID();
    const fingerprint = "c".repeat(64);
    const target = { kind, id, version: 3, sourceFingerprint: fingerprint };
    const source = {
      ...reference,
      sourceKind: "production",
      fieldPath: `/production/${id}`,
      value: {
        id,
        version: 3,
        projectId,
        kind,
        sourceFingerprint: fingerprint,
        content:
          kind === "script"
            ? {
                id: documentId,
                version: 8,
                title: "原保存标题",
                sourceFormat: "native",
                blocks: [
                  { id: blockId, type: "action", text: "阿桥在雨停后归还。" },
                ],
                lossReport: {
                  unsupported: ["不是故事原文"],
                  warnings: [],
                  preserved: [],
                },
              }
            : {
                场景动作: "阿桥在雨停后归还。",
                对白与备注: "谢谢。",
                地点与时间: "书店／日",
              },
      },
    } as AgentContextReference;
    const selected: NarrativeQualityBasis = {
      ...basis,
      request: { ...basis.request, target },
      references: [
        {
          ...basis.references[0]!,
          sourceKind: "production",
          fieldPath: source.fieldPath,
        },
      ],
      productionSourceBasis: {
        projectId,
        id,
        version: 3,
        kind,
        contentHash: fingerprint,
        recordContentHash: "d".repeat(64),
        ancestors: [],
        ...(kind === "script"
          ? {
              document: {
                id: documentId,
                version: 8,
                contentHash: "e".repeat(64),
                blocks: [{ id: blockId, index: 0, type: "action" as const }],
              },
            }
          : {}),
      },
    };
    const output = {
      ...content(),
      reviewedSources: [
        { sourceId: id, sourceVersion: 3, fieldPath: source.fieldPath },
      ],
      issues: content().issues.map((issue) => ({
        ...issue,
        evidence: issue.evidence.map((entry) => ({
          ...entry,
          fieldPath: source.fieldPath,
          valuePath:
            kind === "script" ? "/content/blocks/0/text" : "/content/场景动作",
        })),
      })),
    };
    return { selected, source, output };
  }
  it("accepts only actual saved block or scene prose and exact explicit source coverage, never metadata or guessed positions", () => {
    for (const kind of ["script", "scene"] as const) {
      const { selected, source, output } = saved(kind);
      expect(NarrativeQualityBasisSchema.parse(selected)).toEqual(selected);
      expect(inspectNarrativeContent(output, selected, [source])).toEqual(
        output,
      );
      for (const reviewedSources of [
        undefined,
        [],
        [...output.reviewedSources, ...output.reviewedSources],
        [{ ...output.reviewedSources[0]!, sourceVersion: 4 }],
      ])
        expect(() =>
          inspectNarrativeContent({ ...output, reviewedSources }, selected, [
            source,
          ]),
        ).toThrow();
      for (const valuePath of [
        "/id",
        "/content/id",
        "/content/title",
        "/content/lossReport/unsupported/0",
        "/content/blocks/00/text",
        "/content/blocks/0/id",
        "/content/blocks/99/text",
        "/content/sourceWorkflowId",
      ])
        expect(() =>
          inspectNarrativeContent(
            {
              ...output,
              issues: output.issues.map((issue) => ({
                ...issue,
                evidence: [{ ...issue.evidence[0]!, valuePath }],
              })),
            },
            selected,
            [source],
          ),
        ).toThrow();
      expect(() =>
        inspectNarrativeContent(output, selected, [source, source]),
      ).toThrow();
    }
  });
  it("rejects changed frozen document identity, block ID or order and missing or substituted fingerprints without upgrading historical targets", () => {
    const { selected, source, output } = saved("script");
    for (const edit of [
      (value: NarrativeQualityBasis) => {
        value.productionSourceBasis!.document!.id = crypto.randomUUID();
      },
      (value: NarrativeQualityBasis) => {
        value.productionSourceBasis!.document!.version++;
      },
      (value: NarrativeQualityBasis) => {
        value.productionSourceBasis!.document!.blocks[0]!.id =
          crypto.randomUUID();
      },
      (value: NarrativeQualityBasis) => {
        value.productionSourceBasis!.document!.blocks[0]!.index = 2;
      },
      (value: NarrativeQualityBasis) => {
        value.request.target.sourceFingerprint = "f".repeat(64);
      },
      (value: NarrativeQualityBasis) => {
        delete value.productionSourceBasis;
      },
    ]) {
      const changed = structuredClone(selected);
      edit(changed);
      expect(() =>
        inspectNarrativeContent(output, changed, [source]),
      ).toThrow();
    }
    expect(
      NarrativeQualityRequestSchema.safeParse({
        ...selected.request,
        target: { ...selected.request.target, sourceFingerprint: undefined },
      }).success,
    ).toBe(false);
    expect(
      NarrativeQualityRequestSchema.safeParse({
        ...basis.request,
        target: { ...basis.request.target, sourceFingerprint: "a".repeat(64) },
      }).success,
    ).toBe(false);
    expect(NarrativeQualityRequestSchema.parse(basis.request)).toEqual(
      basis.request,
    );
  });
  it("an assessment cannot reuse a clean report from another actual fingerprint at the same record version", () => {
    const { selected, output } = saved("scene");
    const report = {
      id: crypto.randomUUID(),
      version: 1,
      status: "adopted",
      sourceState: "current",
      basis: selected,
      content: { ...output, issues: [] },
      dispositions: [],
      blockers: [],
    } as unknown as NarrativeQualityReport;
    expect(
      assessNarrativeReports(
        selected.request.target,
        selected.request.dimensions,
        [report],
      ).state,
    ).toBe("reviewed");
    expect(
      assessNarrativeReports(
        { ...selected.request.target, sourceFingerprint: "f".repeat(64) },
        selected.request.dimensions,
        [report],
      ),
    ).toMatchObject({ state: "unknown", reports: [] });
  });
});
const fourth: AgentContextReference = {
  ...reference,
  sourceId: fourthId,
  sourceVersion: 7,
  fieldPath: `/chapters/${fourthId}`,
  value: { content: "阿桥仍带着铜钥匙离开，尚未归还。" },
};
const crossBasis = (
  mode: "selection" | "full" = "selection",
): NarrativeQualityBasis => ({
  ...basis,
  request: {
    ...basis.request,
    target: { kind: "chapter-set", id: crypto.randomUUID(), version: 0 },
    chapterScope: {
      mode,
      chapters: [
        { id, version: 3 },
        { id: fourthId, version: 7 },
      ],
      ...(mode === "full" ? { directoryFingerprint: "a".repeat(64) } : {}),
    },
  },
  references: [
    ...basis.references,
    {
      ...basis.references[0]!,
      sourceId: fourthId,
      sourceVersion: 7,
      fieldPath: fourth.fieldPath,
    },
  ],
  chapterCoverage: {
    mode,
    included: [
      { id, version: 3, title: "第一章" },
      { id: fourthId, version: 7, title: "第四章" },
    ],
    excluded: [],
    totalChapterCount: 2,
    nonEmptyChapterCount: 2,
  },
});
const crossContent = () => ({
  ...content(),
  reviewedChapters: [
    { id, version: 3 },
    { id: fourthId, version: 7 },
  ],
  issues: content().issues.map((issue) => ({
    ...issue,
    evidence: [
      ...issue.evidence,
      {
        sourceId: fourthId,
        sourceVersion: 7,
        fieldPath: fourth.fieldPath,
        valuePath: "/content",
        quote: "尚未归还。",
      },
    ],
  })),
});

describe("mixed quality expression evidence", () => {
  const mixed = () => {
    const selected = crossBasis("full");
    const summaryId = crypto.randomUUID();
    const summaryRef: AgentContextReference = {
      sourceKind: "knowledge",
      sourceId: summaryId,
      sourceVersion: 1,
      fieldPath: `/narrative-summaries/${summaryId}`,
      sensitivity: "project",
      value: {
        representation: "hierarchical-summary",
        summary: "归还钥匙后仍带走了它；这里只是派生概括。",
      },
    };
    const paragraphRef: AgentContextReference = {
      ...fourth,
      fieldPath: `/chapters/${fourthId}/paragraphs/actual-p`,
      value: { representation: "paragraphs", content: "尚未归还。" },
    };
    selected.request.context = {
      format: "narrative-context-v1",
      chapters: [
        {
          id: fourthId,
          version: 7,
          representation: "paragraphs",
          paragraphIds: ["actual-p"],
        },
      ],
      summaries: [{ id: summaryId, version: 1 }],
    };
    const refs = [summaryRef, paragraphRef];
    const sourceReferences = refs.map(
      ({ sourceKind, sourceId, sourceVersion, fieldPath }) => ({
        sourceKind: sourceKind as "chapter" | "knowledge",
        sourceId,
        sourceVersion,
        fieldPath,
        contentHash: "a".repeat(64),
      }),
    );
    selected.references = sourceReferences;
    selected.sourceBasis = {
      kind: "author-selected-narrative-sources",
      projectId: selected.request.target.id,
      chapters: [
        {
          ...selected.request.context.chapters[0]!,
          contentHash: "a".repeat(64),
        },
      ],
      summaries: [
        {
          id: summaryId,
          version: 1,
          target: { kind: "book", id: selected.request.target.id, version: 0 },
          scopeTitle: "全书",
          scopeFingerprint: "a".repeat(64),
          scopeState: "current",
          chapters: selected.request.chapterScope!.chapters.map((chapter) => ({
            ...chapter,
            contentHash: "a".repeat(64),
          })),
        },
      ],
      omitted: [],
      references: sourceReferences,
    };
    selected.chapterCoverage!.included[0]!.representations = [
      "hierarchical-summary",
    ];
    selected.chapterCoverage!.included[1]!.representations = [
      "paragraphs",
      "hierarchical-summary",
    ];
    const output = {
      ...crossContent(),
      reviewedSources: refs.map(({ sourceId, sourceVersion, fieldPath }) => ({
        sourceId,
        sourceVersion,
        fieldPath,
      })),
      issues: [
        {
          ...content().issues[0]!,
          evidence: [
            {
              sourceId: summaryId,
              sourceVersion: 1,
              fieldPath: summaryRef.fieldPath,
              valuePath: "/summary",
              quote: "归还钥匙后仍带走了它",
            },
            {
              sourceId: fourthId,
              sourceVersion: 7,
              fieldPath: paragraphRef.fieldPath,
              valuePath: "/content",
              quote: "尚未归还。",
            },
          ],
        },
      ],
    };
    return { selected, refs, output };
  };
  it("accepts exact high-summary and paragraph evidence but refuses absent/forged expression coverage or metadata and unread original quotes", () => {
    const { selected, refs, output } = mixed();
    expect(inspectNarrativeContent(output, selected, refs)).toEqual(output);
    const { baseReportId: _oldHead, ...localBasis } = selected;
    const localSource = NarrativeLocalQualitySourceSchema.parse({
      format: "narrative-local-review-source-v1",
      projectId: selected.request.target.id,
      sourceFingerprint: localQualityDigest({ localBasis, refs }),
      baseReviewId: null,
      basis: localBasis,
      references: refs,
    });
    const declared = {
      ...output,
      issues: output.issues.map((issue) => ({ ...issue, source: "human" })),
    };
    expect(inspectLocalHumanContent(declared, localSource)).toEqual(declared);
    expect(() =>
      inspectLocalHumanContent(
        { ...declared, reviewedSources: [] },
        localSource,
      ),
    ).toThrow();
    const localReview = NarrativeLocalQualityReviewSchema.parse({
      id: crypto.randomUUID(),
      projectId: localSource.projectId,
      origin: "human-declared",
      version: 1,
      status: "adopted",
      source: localSource,
      content: declared,
      dispositions: [],
      qualityState: "unverified",
      isCurrent: true,
      sourceState: "current",
      sourceReasons: [],
      blockers: [],
      createdAt: "2026-10-05T00:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00.000Z",
    });
    expect(
      assessLocalNarrativeReviews(
        selected.request.target,
        selected.request.dimensions,
        [localReview],
      ),
    ).toMatchObject({
      state: "unknown",
      reviewedDimensions: [],
      qualityState: "unverified",
    });
    for (const reviewedSources of [
      undefined,
      output.reviewedSources.slice(0, 1),
      [output.reviewedSources[0], output.reviewedSources[0]],
      [
        output.reviewedSources[0],
        { ...output.reviewedSources[1]!, sourceVersion: 8 },
      ],
    ])
      expect(() =>
        inspectNarrativeContent({ ...output, reviewedSources }, selected, refs),
      ).toThrow();
    const falseOriginal = structuredClone(selected);
    falseOriginal.chapterCoverage!.included[0]!.representations = ["original"];
    expect(() => inspectNarrativeContent(output, falseOriginal, refs)).toThrow(
      /混合评议/u,
    );
    for (const evidence of [
      { ...output.issues[0]!.evidence[0]!, valuePath: "/title", quote: "全书" },
      {
        sourceId: id,
        sourceVersion: 3,
        fieldPath: `/chapters/${id}`,
        valuePath: "/content",
        quote: "小禾把铜钥匙交给阿桥。",
      },
    ])
      expect(() =>
        inspectNarrativeContent(
          {
            ...output,
            issues: [{ ...output.issues[0]!, evidence: [evidence] }],
          },
          selected,
          refs,
        ),
      ).toThrow();
  });
  it("retains known mixed errors but cannot upgrade summary/paragraph coverage to a full-original quality gate", () => {
    const { selected, output } = mixed();
    const report = {
      id: crypto.randomUUID(),
      version: 1,
      status: "adopted",
      sourceState: "current",
      basis: selected,
      content: output,
      dispositions: [],
      blockers: [],
    } as unknown as NarrativeQualityReport;
    expect(
      assessNarrativeReports(
        selected.request.target,
        selected.request.dimensions,
        [report],
      ),
    ).toMatchObject({
      state: "unknown",
      reviewedDimensions: [],
      missingDimensions: selected.request.dimensions,
    });
    const blocked = {
      ...report,
      blockers: ["cause-1"],
      content: {
        ...report.content,
        issues: report.content.issues.map((issue) => ({
          ...issue,
          severity: "error" as const,
        })),
      },
    };
    expect(
      assessNarrativeReports(
        selected.request.target,
        selected.request.dimensions,
        [blocked],
      ),
    ).toMatchObject({ state: "blocked", blockers: [{ issueId: "cause-1" }] });
    expect(
      NarrativeQualityRequestSchema.safeParse({
        ...selected.request,
        target: basis.request.target,
        chapterScope: undefined,
      }).success,
    ).toBe(false);
  });
});

describe("narrative assessment evidence gate", () => {
  const report = (
    patch: Partial<NarrativeQualityReport> = {},
  ): NarrativeQualityReport => ({
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowId: crypto.randomUUID(),
    version: 1,
    status: "adopted",
    basis,
    content: {
      ...content(),
      issues: content().issues.map((issue) => ({
        ...issue,
        category: "causality",
        severity: "error",
        source: "model",
      })),
      reviewedDimensions: ["causality", "timeline"],
    },
    dispositions: [],
    sourceSnapshotId: crypto.randomUUID(),
    runIds: [crypto.randomUUID()],
    engineKind: "codex",
    usage: { state: "unknown" },
    isCurrent: true,
    sourceState: "current",
    staleReasons: [],
    blockers: ["cause-1"],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  });
  it("never erases an unresolved earlier error by adopting a clean or narrower head", () => {
    const old = report({ isCurrent: false });
    const clean = report({
      content: { ...report().content, issues: [] },
      blockers: [],
    });
    expect(
      assessNarrativeReports(basis.request.target, basis.request.dimensions, [
        old,
        clean,
      ]),
    ).toMatchObject({
      state: "blocked",
      blockers: [{ reportId: old.id, issueId: "cause-1" }],
    });
  });
  it("excludes candidates, stale reports and other exact versions, retaining unknown coverage", () => {
    expect(
      assessNarrativeReports(basis.request.target, basis.request.dimensions, [
        report({ status: "awaiting-review" }),
        report({ sourceState: "stale" }),
        report({
          basis: {
            ...basis,
            request: {
              ...basis.request,
              target: { ...basis.request.target, version: 2 },
            },
          },
        }),
      ]),
    ).toMatchObject({
      state: "unknown",
      reports: [],
      missingDimensions: basis.request.dimensions,
    });
  });
  it("separates explicit accepted risk from resolution and keeps its historical report reference", () => {
    const value = report({
      isCurrent: false,
      blockers: [],
      dispositions: [
        {
          issueId: "cause-1",
          state: "accepted-risk",
          source: "human",
          note: "PRIVATE NOTE",
          decidedAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    });
    expect(
      assessNarrativeReports(basis.request.target, basis.request.dimensions, [
        value,
      ]),
    ).toMatchObject({
      state: "reviewed-with-risk",
      acceptedRiskCount: 1,
      reports: [{ id: value.id, version: 1 }],
    });
    expect(JSON.stringify(summarizeNarrativeReport(value))).not.toContain(
      "PRIVATE NOTE",
    );
    expect(JSON.stringify(summarizeNarrativeReport(value))).not.toContain(
      "交还动机",
    );
  });
  it("does not make a clean partial report cover missing dimensions", () => {
    const value = report({
      content: {
        ...report().content,
        reviewedDimensions: ["causality"],
        issues: [],
      },
      blockers: [],
    });
    expect(
      assessNarrativeReports(basis.request.target, basis.request.dimensions, [
        value,
      ]),
    ).toMatchObject({ state: "unknown", missingDimensions: ["timeline"] });
  });
  it("never makes a chapter selection prove full-book coverage or lets a clean full head erase its known errors", () => {
    const selected = crossBasis();
    const local = report({
      basis: selected,
      content: {
        ...report().content,
        reviewedChapters: selected.request.chapterScope!.chapters,
      },
      isCurrent: false,
    });
    expect(
      assessNarrativeReports(
        selected.request.target,
        selected.request.dimensions,
        [local],
      ),
    ).toMatchObject({
      state: "blocked",
      reviewedDimensions: [],
      missingDimensions: selected.request.dimensions,
      blockers: [{ reportId: local.id, issueId: "cause-1" }],
    });
    const fullBasis = crossBasis("full");
    fullBasis.request.target = selected.request.target;
    const full = report({
      basis: fullBasis,
      content: { ...local.content, issues: [] },
      blockers: [],
    });
    expect(
      assessNarrativeReports(
        selected.request.target,
        selected.request.dimensions,
        [local, full],
      ),
    ).toMatchObject({
      state: "blocked",
      missingDimensions: [],
      blockers: [{ reportId: local.id, issueId: "cause-1" }],
    });
    expect(
      assessNarrativeReports(
        selected.request.target,
        selected.request.dimensions,
        [{ ...local, blockers: [], content: { ...local.content, issues: [] } }],
      ),
    ).toMatchObject({ state: "unknown", reviewedDimensions: [] });
  });
});

describe("version-bound narrative evidence", () => {
  it("validates exact current-field evidence without producing a score or modifying text", () => {
    const before = JSON.stringify(reference);
    expect(
      inspectNarrativeContent(content(), basis, [reference]).issues,
    ).toHaveLength(1);
    expect(JSON.stringify(reference)).toBe(before);
  });
  it("rejects made-up quotes, missing fields, outside or old references", () => {
    for (const patch of [
      { quote: "阿桥读了小禾从未告诉他的秘密。" },
      { valuePath: "/missing" },
      { sourceVersion: 2 },
      { sourceId: crypto.randomUUID() },
      { fieldPath: "/outside" },
    ]) {
      const value = content();
      Object.assign(value.issues[0]!.evidence[0]!, patch);
      expect(() =>
        inspectNarrativeContent(value, basis, [reference]),
      ).toThrow();
    }
  });
  it("requires complete unique dimensions and stable unique issue ids", () => {
    const value = content();
    value.reviewedDimensions = ["causality"];
    expect(() => inspectNarrativeContent(value, basis, [reference])).toThrow(
      "覆盖",
    );
    value.reviewedDimensions = ["causality", "causality"];
    expect(() => inspectNarrativeContent(value, basis, [reference])).toThrow(
      "覆盖",
    );
    const duplicate = content();
    duplicate.issues.push(duplicate.issues[0]!);
    expect(() =>
      inspectNarrativeContent(duplicate, basis, [reference]),
    ).toThrow("标识重复");
  });
  it("does not accept matching metadata as narrative evidence", () => {
    const value = content();
    value.issues[0]!.evidence[0]!.valuePath = "/id";
    value.issues[0]!.evidence[0]!.quote = id;
    expect(() =>
      inspectNarrativeContent(value, basis, [
        { ...reference, value: { id, content: reference.value } },
      ]),
    ).toThrow("实际字段");
  });
  it("does not allow a model to impersonate rule/human evidence or review other dimensions", () => {
    for (const patch of [
      { source: "human" },
      { source: "rule" },
      { category: "dialogue" },
    ]) {
      const value = content();
      Object.assign(value.issues[0]!, patch);
      expect(() =>
        inspectNarrativeContent(value, basis, [reference]),
      ).toThrow();
    }
  });
  it("rejects a report which criticizes only supporting material", () => {
    const value = content();
    value.issues[0]!.evidence[0]!.sourceId = crypto.randomUUID();
    expect(() => inspectNarrativeContent(value, basis, [reference])).toThrow(
      "目标版本",
    );
  });
  it("resolves JSON Pointer escaping/array positions and refuses prototype or malformed escapes", () => {
    const value = { content: [{ "a/b": "实际剧本对白" }] };
    expect(narrativeValueAt(value, "/content/0/a~1b")).toBe("实际剧本对白");
    expect(narrativeValueAt(value, "/content/0/a~2b")).toBeUndefined();
    expect(narrativeValueAt(value, "/__proto__/constructor")).toBeUndefined();
  });
  it("requires explicit unique ordered chapter scope, and a fingerprint only for a full directory", () => {
    const request = crossBasis().request;
    expect(NarrativeQualityRequestSchema.safeParse(request).success).toBe(true);
    const scope = request.chapterScope!;
    const invalid: unknown[] = [
      { ...request, chapterScope: undefined },
      { ...request, chapterScope: { ...scope, chapters: [] } },
      {
        ...request,
        chapterScope: {
          ...scope,
          chapters: [scope.chapters[0], scope.chapters[0]],
        },
      },
      { ...request, chapterScope: { ...scope, mode: "full" } },
      {
        ...request,
        chapterScope: { ...scope, directoryFingerprint: "a".repeat(64) },
      },
      { ...request, target: { ...request.target, kind: "chapter" } },
    ];
    for (const value of invalid)
      expect(NarrativeQualityRequestSchema.safeParse(value).success).toBe(
        false,
      );
  });
  it("accepts evidence from actual selected first-and-fourth originals with an exact coverage declaration", () => {
    expect(
      inspectNarrativeContent(crossContent(), crossBasis(), [reference, fourth])
        .issues[0]!.evidence,
    ).toHaveLength(2);
    expect(
      inspectNarrativeContent(crossContent(), crossBasis("full"), [
        reference,
        fourth,
      ]).reviewedChapters,
    ).toHaveLength(2);
  });
  it("refuses missing, duplicated, old or foreign model chapter coverage instead of accepting a partial full-book report", () => {
    const value = crossContent();
    for (const reviewedChapters of [
      undefined,
      [value.reviewedChapters[0]],
      [value.reviewedChapters[0], value.reviewedChapters[0]],
      [value.reviewedChapters[0], { id: fourthId, version: 6 }],
      [value.reviewedChapters[0], { id: crypto.randomUUID(), version: 7 }],
    ]) {
      expect(() =>
        inspectNarrativeContent(
          { ...value, reviewedChapters },
          crossBasis("full"),
          [reference, fourth],
        ),
      ).toThrow("全部已读");
    }
    expect(() =>
      inspectNarrativeContent(value, basis, [reference, fourth]),
    ).toThrow("单对象");
  });
  it("requires actual complete frozen chapter values and truthful included/excluded directory counts", () => {
    const value = crossContent();
    expect(() =>
      inspectNarrativeContent(value, crossBasis(), [reference]),
    ).toThrow("实际完整冻结");
    const dishonest = crossBasis("full");
    dishonest.chapterCoverage!.excluded.push({
      id: crypto.randomUUID(),
      version: 0,
      reason: "not-selected",
    });
    dishonest.chapterCoverage!.totalChapterCount++;
    dishonest.chapterCoverage!.nonEmptyChapterCount++;
    expect(() =>
      inspectNarrativeContent(value, dishonest, [reference, fourth]),
    ).toThrow("实际完整冻结");
    const mismatch = crossBasis();
    mismatch.chapterCoverage!.included[1]!.version = 6;
    expect(() =>
      inspectNarrativeContent(value, mismatch, [reference, fourth]),
    ).toThrow("实际完整冻结");
  });
});
