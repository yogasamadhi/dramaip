import { expect, test } from "bun:test";
import type { ChangePreview, Project } from "@dramaip/contracts/product";
import { deriveCreativeIntent } from "./creative-intent";

const project = {
  id: crypto.randomUUID(),
  title: "从零故事",
  mode: "series_longform",
  modeConfig: { mode: "series_longform" },
  lifecycleStatus: "ready",
  synopsis:
    "【用户灵感】\n一座每天遗忘一件事的城市\n\n【预设展开方向】\n用三阶段逐步揭示代价",
  styleGuide: "【完整故事预设】悬疑成长\n\n【创作规则】\n线索必须可回看",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} satisfies Project;

test("创作意图明确区分用户灵感、预设骨架和 AI 差异", () => {
  const preview = {
    id: crypto.randomUUID(),
    projectId: project.id,
    targets: [
      {
        kind: "chapter",
        id: crypto.randomUUID(),
        baseVersion: 2,
        patch: { content: "候选正文" },
      },
    ],
    rationale: "加强第一章钩子",
    status: "pending",
    contentHash: "hash",
    createdAt: new Date().toISOString(),
  } satisfies ChangePreview;
  expect(deriveCreativeIntent(project, preview)).toMatchObject({
    userOriginalIdea: "一座每天遗忘一件事的城市",
    storyPreset: "悬疑成长",
    presetSkeleton: "用三阶段逐步揭示代价",
    aiRationale: "加强第一章钩子",
    formalContentState: "等待用户确认，正式内容未修改",
  });
});

test("没有来源记录时不推断预设或 AI 理由", () => {
  const plain = { ...project, synopsis: "普通简介", styleGuide: undefined };
  expect(deriveCreativeIntent(plain)).toMatchObject({
    userOriginalIdea: "未记录",
    storyPreset: "未记录",
    presetSkeleton: "未记录",
    aiRationale: "未记录",
  });
});
