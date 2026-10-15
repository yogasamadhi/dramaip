import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ProductionRecordMergeComparisonSchema,
  ProductionRecordMergeSourceSchema,
  type ProductionRecordMergeComparison,
} from "@dramaip/contracts/production";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import { ProductionRecordComparisonView } from "./ProductionRecordMergeReview";
import { currentProductionRecordComparison } from "../../production-record-merge-view";

const projectId = "91000000-0000-4000-8000-000000000001",
  sceneId = "91000000-0000-4000-8000-000000000002",
  shotId = "91000000-0000-4000-8000-000000000003";
const ref = { id: projectId, version: 1 };
const hash = "a".repeat(64);
const record = {
  frozenVersion: 0,
  currentVersion: 1,
  frozenHash: hash,
  currentHash: "b".repeat(64),
  orderIndex: 0,
  editable: true,
};
const report: ProductionRecordMergeComparison = {
  format: "storyboard-record-field-comparison-v1",
  projectId,
  episodeId: "pilot",
  workflow: ref,
  base: ref,
  candidateHash: hash,
  frozenBasisHash: hash,
  contextHash: hash,
  comparisonHash: hash,
  semanticVerification: "unverified",
  automaticCommit: false,
  records: [
    {
      ...record,
      id: sceneId,
      kind: "scenes",
      stableId: "scene",
      parentId: projectId,
    },
    {
      ...record,
      id: shotId,
      kind: "shots",
      stableId: "shot",
      parentId: sceneId,
    },
  ],
  units: [
    {
      recordId: sceneId,
      kind: "scenes" as const,
      fields: ["title", "场景动作"] as const,
    },
    {
      recordId: shotId,
      kind: "shots" as const,
      fields: [
        "title",
        "镜头描述",
        "构图",
        "机位",
        "运镜",
        "生成提示",
        "负面提示",
        "声音",
      ] as const,
    },
  ].flatMap((item) =>
    item.fields.map((field) => ({
      id: `${item.recordId}:${field}`,
      recordId: item.recordId,
      kind: item.kind,
      field,
      base: { state: "text" as const, text: "真实原字段 <旧>", hash },
      current: {
        state: "text" as const,
        text: "当前人工字段",
        hash: "b".repeat(64),
      },
      candidate: {
        state: "text" as const,
        text: "冻结候选字段",
        hash: "c".repeat(64),
      },
      conflict: true,
      defaultChoice: "main" as const,
    })),
  ),
};
test("author shot-plan comparison displays new and retiring identities readonly without inventing original fields or upgrading the old mode", () => {
  const newId = "91000000-0000-4000-8000-000000000004";
  const structure = {
    receipt: {
      base: ref,
      baseContentHash: hash,
      previousScript: ref,
      scope: "author-frozen-scene-shot-plan-v1" as const,
      semanticVerification: "unverified" as const,
      shots: [{ shotId: "shot", recordId: shotId, version: 0 }],
      sceneMappings: [],
      scenePlans: [
        {
          sceneId: "scene",
          recordId: sceneId,
          version: 0,
          shots: [
            {
              id: newId,
              orderIndex: 0,
              durationSeconds: 30,
              assetIds: ["lin"],
            },
          ],
        },
      ],
    },
    script: ref,
    scriptRecordId: projectId,
    documentVersion: 0,
  };
  const planned = ProductionRecordMergeComparisonSchema.parse({
    ...report,
    format: "storyboard-record-field-comparison-v3",
    structure,
    structureHash: hash,
    records: report.records.map((record) => ({
      ...record,
      editable: record.kind === "scenes",
    })),
    units: report.units.filter((unit) => unit.kind === "scenes"),
  });
  const html = renderToStaticMarkup(
    <ProductionRecordComparisonView
      report={planned}
      choices={{}}
      onChoice={() => {}}
    />,
  );
  expect(html).toContain("字段合并冻结镜头计划");
  expect(html).toContain(newId);
  expect(html).toContain("退役镜头 shot");
  expect(html).toContain("新增镜头没有旧实际字段");
  expect(html).toContain("资产方案引用");
  expect(html.match(/<select/gu)).toHaveLength(2);
  const workflow = {
    id: ref.id,
    version: ref.version,
    stage: "awaiting-review",
    input: { operation: "storyboard-package", projectId },
    episodeDevelopmentBasis: {
      episode: { id: "pilot" },
      storyboardRedo: structure.receipt,
      request: {
        redoMode: "scene-shot-plan",
        script: ref,
        baseScriptDocumentVersion: 0,
      },
    },
  } as unknown as CreationWorkflow;
  const input = {
    workflow,
    report: planned,
    opened: true,
    fetching: false,
    error: false,
  };
  expect(currentProductionRecordComparison(input)).toEqual(planned);
  expect(
    currentProductionRecordComparison({ ...input, report }),
  ).toBeUndefined();
  expect(
    currentProductionRecordComparison({
      ...input,
      workflow: {
        ...workflow,
        episodeDevelopmentBasis: {
          ...workflow.episodeDevelopmentBasis!,
          request: {
            ...workflow.episodeDevelopmentBasis!.request,
            redoMode: undefined,
          },
        },
      },
    }),
  ).toBeUndefined();
});
test("actual-field comparison view labels all three sides and conflicts without exposing arbitrary metadata or pretending to submit", () => {
  const html = renderToStaticMarkup(
    <ProductionRecordComparisonView report={report} />,
  );
  expect(html).toContain("10 个真实字段冲突");
  expect(html).toContain("真实原字段 &lt;旧&gt;");
  expect(html).toContain("当前人工字段");
  expect(html).toContain("冻结候选字段");
  expect(html).toContain("比较不写入");
  expect(html).toContain("原实际字段（非模型重建）");
  expect(html).toContain("语义质量尚未验证");
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<input");
});
test("actual-field selectors require an explicit side for true conflicts and display exact escaped values", () => {
  const html = renderToStaticMarkup(
    <ProductionRecordComparisonView
      report={report}
      choices={{}}
      onChoice={() => {}}
    />,
  );
  expect(html.match(/<select/gu)).toHaveLength(report.units.length);
  expect(html).toContain("请明确选择真实冲突");
  expect(html).toContain("保留当前人工值");
  expect(html).toContain("使用冻结草稿值");
  expect(html).toContain("真实原字段 &lt;旧&gt;");
  expect(html).not.toContain("<button");
});
test("strict actual-field comparison contract refuses incomplete units, foreign/private values, forged conflicts or parent scope", () => {
  expect(ProductionRecordMergeComparisonSchema.safeParse(report).success).toBe(
    true,
  );
  for (const altered of [
    { ...report, units: report.units.slice(1) },
    { ...report, records: [...report.records, report.records[0]!] },
    {
      ...report,
      units: [
        { ...report.units[0]!, conflict: false },
        ...report.units.slice(1),
      ],
    },
    {
      ...report,
      units: [
        {
          ...report.units[0]!,
          current: {
            state: "text",
            text: "值",
            hash,
            payload: { private: "不能外发" },
          },
        },
        ...report.units.slice(1),
      ],
    },
    {
      ...report,
      records: [
        report.records[0]!,
        { ...report.records[1]!, parentId: projectId },
      ],
    },
    {
      ...report,
      records: [{ ...report.records[0]!, editable: false }, report.records[1]!],
    },
    { ...report, automaticCommit: true },
  ])
    expect(
      ProductionRecordMergeComparisonSchema.safeParse(altered).success,
    ).toBe(false);
});
test("current comparison refuses failed/refetching/unopened caches and late foreign or handled workflows", () => {
  // Minimal pure identity fixture, not a generated/adopted Runtime workflow.
  const workflow = {
    id: ref.id,
    version: ref.version,
    stage: "awaiting-review",
    input: { operation: "storyboard-package", projectId },
    episodeDevelopmentBasis: {
      episode: { id: "pilot" },
      request: {},
      storyboardRedo: {
        base: ref,
        scope: "stable-mapping-fixed-duration-existing-assets-v1",
      },
    },
  } as CreationWorkflow;
  const input = {
    workflow,
    report,
    opened: true,
    fetching: false,
    error: false,
  };
  expect(currentProductionRecordComparison(input)).toBe(report);
  for (const change of [
    { opened: false },
    { fetching: true },
    { error: true },
    { workflow: { ...workflow, stage: "applied" as const } },
    { workflow: { ...workflow, version: 2 } },
    { report: { ...report, episodeId: "different" } },
    { report: { ...report, projectId: shotId } },
    { report: { ...report, base: { ...ref, version: 2 } } },
  ])
    expect(
      currentProductionRecordComparison({ ...input, ...change }),
    ).toBeUndefined();
});

test("confirmed-structure comparison binds the exact original mode, map and document and never upgrades v1 recovery", () => {
  const first = "92000000-0000-4000-8000-000000000001",
    added = "92000000-0000-4000-8000-000000000002";
  const structure = {
    receipt: {
      base: ref,
      baseContentHash: hash,
      previousScript: ref,
      scope:
        "confirmed-block-structure-fixed-shots-duration-assets-v1" as const,
      semanticVerification: "unverified" as const,
      shots: [{ shotId: "shot", recordId: shotId, version: 0 }],
      sceneMappings: [
        {
          sceneId: "scene",
          previousBlockIds: [first],
          currentBlockIds: [first, added],
        },
      ],
    },
    script: { id: added, version: 2 },
    scriptRecordId: projectId,
    documentVersion: 1,
  };
  const mapped = ProductionRecordMergeComparisonSchema.parse({
    ...report,
    format: "storyboard-record-field-comparison-v2",
    structure,
    structureHash: hash,
  });
  if (mapped.format !== "storyboard-record-field-comparison-v2")
    throw new Error("须为明确的已确认结构比较");
  const workflow = {
    id: ref.id,
    version: ref.version,
    stage: "awaiting-review",
    input: { operation: "storyboard-package", projectId },
    episodeDevelopmentBasis: {
      episode: { id: "pilot" },
      storyboardRedo: structure.receipt,
      request: {
        redoMode: "confirmed-block-structure",
        script: structure.script,
        baseScriptDocumentVersion: structure.documentVersion,
      },
    },
  } as CreationWorkflow;
  const input = {
    workflow,
    report: mapped,
    opened: true,
    fetching: false,
    error: false,
  };
  expect(currentProductionRecordComparison(input)).toEqual(mapped);
  expect(
    currentProductionRecordComparison({ ...input, report }),
  ).toBeUndefined();
  expect(
    currentProductionRecordComparison({
      ...input,
      report: { ...mapped, structure: { ...structure, documentVersion: 2 } },
    }),
  ).toBeUndefined();
  expect(
    currentProductionRecordComparison({
      ...input,
      workflow: {
        ...workflow,
        episodeDevelopmentBasis: {
          ...workflow.episodeDevelopmentBasis!,
          request: {
            ...workflow.episodeDevelopmentBasis!.request,
            redoMode: undefined,
          },
        },
      },
    }),
  ).toBeUndefined();
  const html = renderToStaticMarkup(
    <ProductionRecordComparisonView report={mapped} />,
  );
  expect(html).toContain("已确认块结构专用协议");
  expect(html).toContain(first);
  expect(html).toContain(added);
  expect(html).toContain("不能用字段选择重写来源");
  const request = {
    format: "storyboard-record-field-merge-request-v2",
    projectId,
    episodeId: "pilot",
    workflow: ref,
    base: ref,
    comparisonHash: hash,
    structureHash: hash,
    choices: Object.fromEntries(mapped.units.map((unit) => [unit.id, "main"])),
    reviewed: true,
    modelDisclosureConfirmed: true,
  };
  const source = {
    format: "storyboard-record-field-merge-v2",
    request,
    comparison: mapped,
    outputHash: hash,
  };
  expect(ProductionRecordMergeSourceSchema.safeParse(source).success).toBe(
    true,
  );
  for (const altered of [
    { ...source, format: "storyboard-record-field-merge-v1" },
    {
      ...source,
      request: {
        ...request,
        format: "storyboard-record-field-merge-request-v1",
      },
    },
    { ...source, request: { ...request, structureHash: "b".repeat(64) } },
    {
      ...source,
      comparison: {
        ...mapped,
        structure: {
          ...structure,
          receipt: { ...structure.receipt, shots: [] },
        },
      },
    },
  ])
    expect(ProductionRecordMergeSourceSchema.safeParse(altered).success).toBe(
      false,
    );
});
