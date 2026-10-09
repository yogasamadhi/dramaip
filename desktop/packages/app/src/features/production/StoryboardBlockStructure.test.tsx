import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EpisodeDevelopmentRequestSchema,
  StoryboardRedoReceiptSchema,
  StoryboardRedoPatchSchema,
} from "@dramaip/contracts/production";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import { EpisodeCandidate } from "./EpisodeDevelopmentPanel";

const id = "90000000-0000-4000-8000-000000000001";
const other = "90000000-0000-4000-8000-000000000002";
const selected = [{ shotId: "shot-1", recordId: id, version: 0 }];
const fixed = {
  base: { id, version: 1 },
  baseContentHash: "a".repeat(64),
  shots: selected,
  previousScript: { id: other, version: 1 },
  scope: "stable-mapping-fixed-duration-existing-assets-v1" as const,
  semanticVerification: "unverified" as const,
};
const structured = {
  ...fixed,
  scope: "confirmed-block-structure-fixed-shots-duration-assets-v1" as const,
  sceneMappings: [
    {
      sceneId: "scene-1",
      previousBlockIds: [id, other],
      currentBlockIds: [id],
    },
  ],
};
test("explicit structure request requires an exact base, actual formal sources and a selection; legacy absence stays absent", () => {
  const request = {
    seasonPlan: { id, version: 1 },
    episodeId: "episode-1",
    outline: { id, version: 1 },
    script: { id: other, version: 2 },
    baseStoryboardId: id,
    redoShots: selected,
  };
  expect(EpisodeDevelopmentRequestSchema.parse(request)).not.toHaveProperty(
    "redoMode",
  );
  expect(
    EpisodeDevelopmentRequestSchema.parse({
      ...request,
      redoMode: "confirmed-block-structure",
    }).redoMode,
  ).toBe("confirmed-block-structure");
  for (const field of [
    "outline",
    "script",
    "baseStoryboardId",
    "redoShots",
  ] as const)
    expect(
      EpisodeDevelopmentRequestSchema.safeParse({
        ...request,
        [field]: undefined,
        redoMode: "confirmed-block-structure",
      }).success,
    ).toBe(false);
  expect(
    EpisodeDevelopmentRequestSchema.safeParse({ ...request, redoMode: "auto" })
      .success,
  ).toBe(false);
});
test("receipts never upgrade legacy candidates or accept absent/duplicate protocol fields", () => {
  expect(StoryboardRedoReceiptSchema.parse(fixed)).not.toHaveProperty(
    "sceneMappings",
  );
  expect(StoryboardRedoReceiptSchema.parse(structured)).toEqual(structured);
  expect(
    StoryboardRedoReceiptSchema.safeParse({
      ...fixed,
      sceneMappings: structured.sceneMappings,
    }).success,
  ).toBe(false);
  expect(
    StoryboardRedoReceiptSchema.safeParse({
      ...structured,
      sceneMappings: undefined,
    }).success,
  ).toBe(false);
  expect(
    StoryboardRedoPatchSchema.safeParse({
      format: "selected-storyboard-block-structure-v1",
      shots: [],
      subtitles: [],
      costRisks: [],
      scenes: [],
    }).success,
  ).toBe(false);
});
test("candidate exposes frozen old/new block identities without claiming semantics or changing a legacy preview", () => {
  const shot = {
    id: "shot-1",
    orderIndex: 0,
    sourceBlockIds: [id],
    visualAction: "已确认新块接续",
    composition: "中景",
    camera: "平视",
    movement: "固定",
    durationSeconds: 20,
    sound: "环境声",
    prompt: "冻结范围候选",
    negativePrompt: "无水印",
    assetIds: ["asset-1"],
  };
  const workflow = {
    output: {
      title: "契约界面样例",
      content: "不是实际采用",
      items: [
        {
          kind: "storyboard-package",
          data: {
            format: "selected-storyboard-block-structure-v1",
            shots: [shot],
            subtitles: [],
            costRisks: [],
          },
        },
      ],
    },
    episodeDevelopmentBasis: { storyboardRedo: structured },
  } as unknown as CreationWorkflow;
  const html = renderToStaticMarkup(<EpisodeCandidate workflow={workflow} />);
  expect(html).toContain("冻结块结构映射");
  expect(html).toContain("原块：");
  expect(html).toContain(other);
  expect(html).toContain("新块：");
  expect(html).toContain("机械范围不是语义安全证明");
  workflow.output!.items[0]!.data.format = "selected-storyboard-shots-v1";
  workflow.episodeDevelopmentBasis!.storyboardRedo =
    StoryboardRedoReceiptSchema.parse(fixed);
  const old = renderToStaticMarkup(<EpisodeCandidate workflow={workflow} />);
  expect(old).not.toContain("冻结块结构映射");
  expect(old).toContain("场景结构、时长、来源与既有资产不变");
});
