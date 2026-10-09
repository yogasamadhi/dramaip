import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createStudioClient } from "@dramaip/client";
import {
  EpisodeDevelopmentRequestSchema,
  ProductionRecordMergeComparisonSchema,
  ProductionRecordMergeSourceSchema,
  type EpisodeDevelopmentResult,
} from "@dramaip/contracts/production";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import { ProductionRecordComparisonView } from "./ProductionRecordMergeReview";
import {
  StoryboardTopologyPlanEditor,
  StoryboardTopologyPlanView,
  topologySelectedOldShotIds,
} from "./StoryboardTopologyPlanEditor";
import { EpisodeCandidate } from "./EpisodeDevelopmentPanel";
import { currentAuthorTopologyRevision } from "./EpisodeTopologyRevisionPanel";
import { currentProductionRecordComparison } from "../../production-record-merge-view";
import {
  freezeProductionRecordMergeRequest,
  readProductionRecordMergeRequest,
} from "../../production-record-merge-recovery";

// Contract/UI-only fixtures. These do not certify actual ancestry or rows.
const ids = Array.from(
    { length: 12 },
    (_, index) =>
      `96000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ),
  project = ids[0]!,
  scene = ids[1]!,
  shot = ids[2]!,
  newScene = ids[3]!,
  newShot = ids[4]!,
  workflowId = ids[5]!,
  baseId = ids[6]!,
  refs = ids.slice(7, 11).map((id) => ({ id, version: 1 })),
  hash = "a".repeat(64);
const plan = {
  format: "author-scene-topology-plan-v1" as const,
  scenes: [
    {
      sceneId: newScene,
      orderIndex: 0,
      durationSeconds: 30,
      mode: "generate" as const,
      shots: [
        { id: newShot, orderIndex: 0, durationSeconds: 30, assetIds: ["lin"] },
      ],
    },
  ],
  retiredScenes: [{ sceneId: "old-scene", recordId: scene, version: 0 }],
  retiredShots: [{ shotId: "old-shot", recordId: shot, version: 0 }],
};
const receipt = {
  base: { id: baseId, version: 1 },
  baseContentHash: hash,
  previousScript: refs[0]!,
  previousOutline: refs[1]!,
  script: refs[2]!,
  outline: refs[3]!,
  shots: plan.retiredShots,
  selectedScenes: plan.retiredScenes,
  scope: "author-frozen-scene-topology-plan-v1" as const,
  semanticVerification: "unverified" as const,
  topologyPlan: plan,
  topologySteps: 1,
  ancestry: refs.map((ref) => ({
    sourceKind: "production" as const,
    sourceId: ref.id,
    sourceVersion: ref.version,
    fieldPath: `/production/${ref.id}`,
    contentHash: hash,
  })),
};
const parsedReport = ProductionRecordMergeComparisonSchema.parse({
  format: "storyboard-record-field-comparison-v4",
  projectId: project,
  episodeId: "pilot",
  workflow: { id: workflowId, version: 2 },
  base: receipt.base,
  candidateHash: hash,
  frozenBasisHash: hash,
  contextHash: hash,
  comparisonHash: hash,
  semanticVerification: "unverified",
  automaticCommit: false,
  structure: {
    receipt,
    script: receipt.script,
    scriptRecordId: project,
    documentVersion: 2,
  },
  structureHash: hash,
  units: [],
  records: [
    {
      id: scene,
      kind: "scenes",
      stableId: "old-scene",
      frozenVersion: 0,
      currentVersion: 1,
      frozenHash: hash,
      currentHash: hash,
      parentId: project,
      orderIndex: 0,
      editable: false,
    },
    {
      id: shot,
      kind: "shots",
      stableId: "old-shot",
      frozenVersion: 0,
      currentVersion: 1,
      frozenHash: hash,
      currentHash: hash,
      parentId: scene,
      orderIndex: 0,
      editable: false,
    },
  ],
});
if (parsedReport.format !== "storyboard-record-field-comparison-v4")
  throw new Error("需要 v4 纯契约测试夹具");
const report = parsedReport;
const request = {
  seasonPlan: { id: project, version: 1 },
  episodeId: "pilot",
  outline: receipt.outline,
  script: receipt.script,
  baseStoryboardId: baseId,
  baseScriptDocumentVersion: 2,
  redoShots: receipt.shots,
  redoMode: "scene-topology-plan" as const,
  redoTopologyPlan: plan,
};
const input = {
  format: "storyboard-record-field-merge-request-v4" as const,
  projectId: project,
  episodeId: "pilot",
  workflow: report.workflow,
  base: report.base,
  comparisonHash: report.comparisonHash,
  structureHash: hash,
  choices: {},
  reviewed: true as const,
  modelDisclosureConfirmed: true as const,
};
const workflow = {
  id: workflowId,
  version: 2,
  stage: "awaiting-review",
  input: {
    projectId: project,
    operation: "storyboard-package",
    episodeDevelopmentRequest: request,
  },
  episodeDevelopmentBasis: {
    episode: { id: "pilot" },
    request,
    storyboardRedo: receipt,
  },
} as unknown as CreationWorkflow;

test("exact dual-formal preview hides failed or pending cached reads and rejects every wrong original identity without taking another preview", () => {
  const expected = {
    id: workflowId,
    projectId: project,
    episodeId: "pilot",
    script: refs[0]!,
    outline: refs[1]!,
  };
  const value = {
    id: workflowId,
    projectId: project,
    episodeId: "pilot",
    sourceScript: refs[0]!,
    sourceOutline: refs[1]!,
  };
  const success = { data: value, status: "success", isFetching: false };
  expect(currentAuthorTopologyRevision(success, expected)).toBe(value);
  for (const query of [
    { ...success, isFetching: true },
    { ...success, status: "pending" },
    {
      ...success,
      status: "error",
      error: new Error("actual owner unavailable"),
    },
    { ...success, error: new Error("cached actual owner error") },
    { ...success, data: undefined },
  ])
    expect(currentAuthorTopologyRevision(query, expected)).toBeUndefined();
  for (const wrong of [
    { ...value, id: newShot },
    { ...value, projectId: newShot },
    { ...value, episodeId: "other" },
    { ...value, sourceScript: { ...value.sourceScript, id: newShot } },
    { ...value, sourceScript: { ...value.sourceScript, version: 2 } },
    { ...value, sourceOutline: { ...value.sourceOutline, id: newShot } },
    { ...value, sourceOutline: { ...value.sourceOutline, version: 2 } },
  ])
    expect(
      currentAuthorTopologyRevision({ ...success, data: wrong }, expected),
    ).toBeUndefined();
  expect(
    currentAuthorTopologyRevision(success, { ...expected, outline: undefined }),
  ).toBeUndefined();
});

test("scene topology protocol is explicit and rejects missing plans, old modes, private extras and forged v4 retirement scope", () => {
  expect(
    EpisodeDevelopmentRequestSchema.parse(request).redoTopologyPlan,
  ).toEqual(plan);
  for (const invalid of [
    { ...request, redoMode: undefined },
    { ...request, redoMode: "scene-shot-plan" },
    { ...request, redoTopologyPlan: undefined },
    { ...request, redoTopologyPlan: { ...plan, privateDraft: "not allowed" } },
  ])
    expect(EpisodeDevelopmentRequestSchema.safeParse(invalid).success).toBe(
      false,
    );
  for (const invalid of [
    { ...report, units: [{ private: "not fields" }] },
    {
      ...report,
      records: report.records.map((row) => ({ ...row, editable: true })),
    },
    {
      ...report,
      structure: {
        ...report.structure,
        receipt: { ...receipt, selectedScenes: [] },
      },
    },
    {
      ...report,
      structure: {
        ...report.structure,
        receipt: { ...receipt, topologyPlan: { ...plan, retiredShots: [] } },
      },
    },
  ])
    expect(
      ProductionRecordMergeComparisonSchema.safeParse(invalid).success,
    ).toBe(false);
});
test("v4 no-original-fields comparison is readonly, shows explicit new and retired metadata and matches only its exact original mode and formal versions", () => {
  const html = renderToStaticMarkup(
    <ProductionRecordComparisonView report={report} />,
  );
  expect(html).toContain("字段合并冻结场景拓扑计划");
  expect(html).toContain("此次没有复用可编辑旧字段");
  expect(html).toContain("明确退役场景");
  expect(html).toContain(newScene);
  expect(html).not.toContain("<select");
  const view = {
    workflow,
    report,
    opened: true,
    fetching: false,
    error: false,
  };
  expect(currentProductionRecordComparison(view)).toEqual(report);
  for (const wrong of [
    { ...workflow, stage: "applied" },
    { ...workflow, input: { ...workflow.input, projectId: baseId } },
    {
      ...workflow,
      episodeDevelopmentBasis: {
        ...workflow.episodeDevelopmentBasis!,
        request: { ...request, redoMode: "scene-shot-plan" },
      },
    },
    {
      ...workflow,
      episodeDevelopmentBasis: {
        ...workflow.episodeDevelopmentBasis!,
        request: { ...request, baseScriptDocumentVersion: 99 },
      },
    },
  ])
    expect(
      currentProductionRecordComparison({
        ...view,
        workflow: wrong as CreationWorkflow,
      }),
    ).toBeUndefined();
});
test("v4 SDK comparison refuses absent or different frozen topology and cannot bind an old field protocol to the new mode", async () => {
  const client = createStudioClient({
    baseUrl: "http://runtime.test",
    runtimeId: project,
    runtimeGeneration: 1,
    openEventStream: async () => new Response(),
    fetch: async () =>
      new Response(JSON.stringify(report), {
        headers: { "content-type": "application/json" },
      }),
  });
  const expected = {
      projectId: project,
      episodeId: "pilot",
      workflowVersion: 2,
      base: receipt.base,
    },
    confirmedTopologyPlan = {
      receipt,
      script: receipt.script,
      documentVersion: 2,
    };
  expect(
    await client.episodeDevelopments.compareRecords(workflowId, {
      ...expected,
      confirmedTopologyPlan,
    }),
  ).toEqual(report);
  for (const wrong of [
    expected,
    {
      ...expected,
      confirmedTopologyPlan: { ...confirmedTopologyPlan, documentVersion: 99 },
    },
    {
      ...expected,
      confirmedTopologyPlan: {
        ...confirmedTopologyPlan,
        receipt: { ...receipt, topologySteps: 2 },
      },
    },
  ])
    await expect(
      client.episodeDevelopments.compareRecords(workflowId, wrong),
    ).rejects.toThrow("实际字段比较");
});
test("v4 exact recovery stores only original choices and hashes and never upgrades old modes or reconstructs private fields", () => {
  const frozen = freezeProductionRecordMergeRequest(input),
    raw = JSON.stringify(frozen);
  expect(
    readProductionRecordMergeRequest(raw, project, workflowId, "pilot", baseId),
  ).toEqual(frozen);
  expect(raw).not.toContain("topologyPlan");
  expect(raw).not.toContain("records");
  const source = {
    format: "storyboard-record-field-merge-v4",
    request: input,
    comparison: report,
    outputHash: hash,
  };
  expect(ProductionRecordMergeSourceSchema.safeParse(source).success).toBe(
    true,
  );
  expect(
    ProductionRecordMergeSourceSchema.safeParse({
      ...source,
      format: "storyboard-record-field-merge-v3",
    }).success,
  ).toBe(false);
  expect(
    ProductionRecordMergeSourceSchema.safeParse({
      ...source,
      request: { ...input, format: "storyboard-record-field-merge-request-v3" },
    }).success,
  ).toBe(false);
});
test("topology editor and frozen view expose only metadata and explicit retirement controls, while selected old rows are complete and no private old body is displayed", () => {
  const base = {
    content: {
      kind: "storyboard-package",
      value: {
        assets: [{ id: "lin", title: "林晚" }],
        scenes: [
          {
            sceneId: "old-scene",
            scriptBlockIds: [ids[11]],
            shots: [
              {
                id: "old-shot",
                visualAction: "PRIVATE_REMOVED_SCENE_BODY",
                prompt: "PRIVATE_REMOVED_PROMPT",
              },
            ],
          },
        ],
      },
    },
    productionRecords: [
      { id: scene, kind: "scenes", stableId: "old-scene", version: 0 },
      { id: shot, kind: "shots", stableId: "old-shot", version: 0 },
    ],
  } as unknown as EpisodeDevelopmentResult;
  const html = renderToStaticMarkup(
    <StoryboardTopologyPlanEditor
      base={base}
      value={plan}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("明确退役旧场景");
  expect(html).toContain("明确退役旧镜头");
  expect(html).toContain("拓扑场景 1 镜头 1 秒数");
  expect(html).toContain("未选保留仅是机械原值相同");
  expect(html).not.toContain("PRIVATE_REMOVED");
  expect(topologySelectedOldShotIds(base, plan)).toEqual(["old-shot"]);
  expect(
    renderToStaticMarkup(<StoryboardTopologyPlanView value={plan} />),
  ).toContain("新增，无旧实际字段");
});
test("topology candidate labels the original and new double-formal identities instead of claiming old fixed structure remained unchanged", () => {
  const candidate = {
    ...workflow,
    stage: "failed",
    output: {
      title: "Contract-only topology",
      content: "No quality claim",
      items: [
        {
          kind: "storyboard-package",
          data: {
            format: "selected-scene-topology-plan-v1",
            shots: [
              {
                id: newShot,
                orderIndex: 0,
                durationSeconds: 30,
                sourceBlockIds: [ids[11]!],
                assetIds: ["lin"],
                visualAction: "合同展示动作",
                composition: "中景",
                camera: "平视",
                movement: "固定",
                sound: "环境音",
                prompt: "合同展示提示",
                negativePrompt: "无额外人物",
              },
            ],
            subtitles: [],
            costRisks: [],
          },
        },
      ],
    },
  } as unknown as CreationWorkflow;
  const html = renderToStaticMarkup(<EpisodeCandidate workflow={candidate} />);
  expect(html).toContain("冻结作者场景拓扑计划");
  expect(html).toContain("新正式大纲");
  expect(html).toContain("专用 v4 协议");
  expect(html).not.toContain("场景结构、时长、来源与既有资产不变");
});
