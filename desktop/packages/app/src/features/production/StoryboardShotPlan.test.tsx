import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EpisodeDevelopmentRequestSchema,
  StoryboardShotPlanRequestSchema,
  StoryboardShotPlanReceiptSchema,
  type EpisodeDevelopmentResult,
} from "@dramaip/contracts/production";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import { StoryboardShotPlanEditor } from "./StoryboardShotPlanEditor";
import { EpisodeCandidate } from "./EpisodeDevelopmentPanel";

const id = "99000000-0000-4000-8000-000000000001";
const other = "99000000-0000-4000-8000-000000000002";
const newId = "99000000-0000-4000-8000-000000000003";
const plan = {
  format: "author-scene-shot-plan-v1" as const,
  scenePlans: [
    {
      sceneId: "scene-1",
      recordId: id,
      version: 2,
      shots: [
        { id: newId, orderIndex: 0, durationSeconds: 10, assetIds: ["lin"] },
        {
          id: "old-shot",
          orderIndex: 1,
          durationSeconds: 10,
          assetIds: ["lin"],
          retains: { recordId: other, version: 3 },
        },
      ],
    },
  ],
};
const request = {
  seasonPlan: { id, version: 1 },
  episodeId: "episode-1",
  outline: { id, version: 1 },
  script: { id: other, version: 1 },
  baseStoryboardId: id,
  redoShots: [{ shotId: "old-shot", recordId: other, version: 3 }],
  redoMode: "scene-shot-plan",
  redoShotPlan: plan,
};
test("new shot-plan protocol requires explicit mode and exact complete metadata, never silently ignored by either old request", () => {
  expect(EpisodeDevelopmentRequestSchema.parse(request).redoShotPlan).toEqual(
    plan,
  );
  for (const invalid of [
    { ...request, redoMode: undefined },
    { ...request, redoShotPlan: undefined },
    { ...request, redoMode: "confirmed-block-structure" },
    { ...request, redoShots: undefined },
    { ...request, outline: undefined },
    { ...request, script: undefined },
  ])
    expect(EpisodeDevelopmentRequestSchema.safeParse(invalid).success).toBe(
      false,
    );
  for (const invalid of [
    { ...plan, scenePlans: [] },
    {
      ...plan,
      scenePlans: [
        {
          ...plan.scenePlans[0]!,
          shots: [
            { ...plan.scenePlans[0]!.shots[0]!, id: "invented-old-identity" },
          ],
        },
      ],
    },
    {
      ...plan,
      scenePlans: [
        {
          ...plan.scenePlans[0]!,
          shots: [{ ...plan.scenePlans[0]!.shots[0]!, orderIndex: 1 }],
        },
      ],
    },
  ])
    expect(StoryboardShotPlanRequestSchema.safeParse(invalid).success).toBe(
      false,
    );
});
const oldShot = {
  id: "old-shot",
  orderIndex: 0,
  durationSeconds: 20,
  assetIds: ["lin"],
  sourceBlockIds: [id],
  visualAction: "原场景动作",
  composition: "中景",
  camera: "平视",
  movement: "固定",
  sound: "环境声",
  prompt: "原镜头",
  negativePrompt: "无水印",
};
test("author editor presents complete scene selection, explicit identity, integer duration, order and asset controls without granting adoption or semantic claims", () => {
  const base = {
    content: {
      kind: "storyboard-package",
      value: {
        scenes: [
          { sceneId: "scene-1", scriptBlockIds: [id], shots: [oldShot] },
        ],
        assets: [{ id: "lin", title: "林晚" }],
      },
    },
    productionRecords: [
      { kind: "scenes", stableId: "scene-1", id, version: 2 },
      { kind: "shots", stableId: "old-shot", id: other, version: 3 },
    ],
  } as EpisodeDevelopmentResult;
  const html = renderToStaticMarkup(
    <StoryboardShotPlanEditor
      base={base}
      value={plan}
      onChange={() => {
        throw new Error("静态审阅不得改变计划");
      }}
    />,
  );
  for (const text of [
    "作者场景镜头计划",
    "纳入场景 1 的全部原镜头",
    "计划镜头 1 时长（秒）",
    "新增",
    "复用",
    newId,
    "v3",
    "既有资产引用",
    "上移计划镜头",
    "下移计划镜头",
    "移除计划镜头",
    "不能增删场景",
    "初始 1 秒",
    "退役只保留历史",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("私人旁注");
});
test("non-pending candidate retains readonly new and reused identities without a merge action or falsely stating fixed topology", () => {
  const receipt = StoryboardShotPlanReceiptSchema.parse({
    base: { id, version: 1 },
    baseContentHash: "a".repeat(64),
    shots: request.redoShots,
    previousScript: { id: other, version: 1 },
    scope: "author-frozen-scene-shot-plan-v1",
    semanticVerification: "unverified",
    sceneMappings: [],
    scenePlans: plan.scenePlans,
  });
  const workflow = {
    stage: "failed",
    output: {
      title: "计划候选",
      content: "不是实际采用",
      items: [
        {
          kind: "storyboard-package",
          data: {
            format: "selected-scene-shot-plan-v1",
            shots: plan.scenePlans[0]!.shots.map((shot) => ({
              ...oldShot,
              ...shot,
              retains: undefined,
            })).map(({ retains: _retains, ...shot }) => shot),
            subtitles: [],
            costRisks: [],
          },
        },
      ],
    },
    episodeDevelopmentBasis: { storyboardRedo: receipt },
  } as unknown as CreationWorkflow;
  const html = renderToStaticMarkup(<EpisodeCandidate workflow={workflow} />);
  expect(html).toContain("冻结作者镜头计划");
  expect(html).toContain("复用 old-shot");
  expect(html).toContain(`新增 ${newId}`);
  expect(html).toContain("实际记录尚未采用创建");
  expect(html).toContain("旧快照和实际记录保留");
  expect(html).not.toContain("场景结构、时长、来源与既有资产不变");
  expect(html).not.toContain("比较实际场景／镜头字段");
  expect(html).toContain("机械范围不是语义安全证明");
});
