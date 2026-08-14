import { expect, test } from "bun:test";
import {
  defaultProductionBrief,
  productionBriefText,
  projectInputFromBrief,
} from "./project-intake";

test("生产简报保存创建路径、内容形态和试制默认值", () => {
  const draft = defaultProductionBrief("source-import");
  draft.title = "雨夜来信";
  draft.targetPlatform = "抖音";
  draft.targetEpisodeCount = "24";

  const brief = productionBriefText(draft);
  expect(brief).toContain("DramaIP 生产简报 v1");
  expect(brief).toContain("创建路径：导入原著");
  expect(brief).toContain("内容形态：已授权原著或 IP");
  expect(brief).toContain("目标平台：抖音");
  expect(brief).toContain("计划集数：24 集");
});

test("生产简报只将有效集数映射为项目字段，保留旧项目可选字段语义", () => {
  const draft = defaultProductionBrief("inspiration");
  draft.title = "灵感项目";
  draft.idea = "一封来自未来的信改变了女主的命运。";
  draft.targetEpisodeCount = "not-a-number";
  draft.targetAudience = "";

  const input = projectInputFromBrief(draft);
  expect(input).toMatchObject({
    title: "灵感项目",
    shortDramaType: "都市情感",
    synopsis: "一封来自未来的信改变了女主的命运。",
  });
  expect(input.targetEpisodeCount).toBeUndefined();
  expect(input.targetAudience).toBeUndefined();
  expect(input.productionBrief).toContain("目标受众：待补充");
  expect(input.styleGuide).toContain("【创作灵感】");
});
