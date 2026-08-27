import { expect, test } from "bun:test";
import type { StudioClient } from "@dramaip/client";
import { defaultProductionBrief } from "../../project-intake";
import {
  NOVEL_STORY_PRESETS,
  chapterInputFromStoryPreset,
  initializeSingleSeasonMaterials,
  initializeStoryPresetMaterials,
  novelStoryPreset,
  projectInputFromStoryPreset,
  resourceInputsFromStoryPreset,
} from "./story-presets";

test("四个完整故事预设的 ID、名称和资源数量唯一且完整", () => {
  expect(NOVEL_STORY_PRESETS.map((preset) => preset.id)).toEqual([
    "group-pet",
    "doomsday-hoarding",
    "beast-evolution",
    "jiahao",
  ]);
  expect(new Set(NOVEL_STORY_PRESETS.map((preset) => preset.id)).size).toBe(4);
  expect(new Set(NOVEL_STORY_PRESETS.map((preset) => preset.label)).size).toBe(
    4,
  );

  for (const preset of NOVEL_STORY_PRESETS) {
    expect(preset.characters).toHaveLength(4);
    expect(preset.storyArcs).toHaveLength(3);
    const resources = resourceInputsFromStoryPreset(
      "project-1",
      preset,
      "用户自己的前提",
    );
    expect(resources).toHaveLength(8);
    expect(
      resources.filter((resource) => resource.domain === "characters"),
    ).toHaveLength(4);
    expect(
      resources.filter((resource) => resource.domain === "outlines"),
    ).toHaveLength(1);
    expect(
      resources.filter((resource) => resource.domain === "story-arcs"),
    ).toHaveLength(3);
  }
});

test("预设合并保留用户标题与灵感，并填充全部项目创作字段", () => {
  const preset = novelStoryPreset("doomsday-hoarding")!;
  const draft = defaultProductionBrief("inspiration");
  draft.title = "我自己的末日计划";
  draft.idea = "主角必须先救下经营早餐店的邻居。";
  draft.targetAudience = "我定义的受众";

  const input = projectInputFromStoryPreset(draft, preset);
  expect(input.title).toBe("我自己的末日计划");
  expect(input.shortDramaType).toBe("末世囤货");
  expect(input.targetAudience).toBe("我定义的受众");
  expect(input.synopsis?.indexOf(draft.idea)).toBe(7);
  expect(input.styleGuide).toContain(draft.idea);
  expect(input.coreHook).toBe(preset.coreHook);
  expect(input.emotionalCore).toBe(preset.emotionalCore);
  expect(input.coreSellingPoint).toBe(preset.coreSellingPoint);
  expect(input.visualStyleDirection).toBeTruthy();
  expect(input.genreOpportunity).toBe(preset.genreOpportunity);
  expect(input.productionBrief).toContain("故事预设：末世囤货");
});

test("四套首章和资源载荷符合现有章节及写作资料结构", () => {
  for (const preset of NOVEL_STORY_PRESETS) {
    const chapter = chapterInputFromStoryPreset("project-1", preset);
    expect(chapter).toMatchObject({
      projectId: "project-1",
      title: "第 1 章",
      content: "",
    });
    expect(chapter.summary).toBeTruthy();
    expect(chapter.outline).toBeTruthy();
    expect(chapter.mainConflict).toBeTruthy();
    expect(chapter.hook).toBeTruthy();
    expect(chapter.cliffhanger).toBeTruthy();

    const resources = resourceInputsFromStoryPreset(
      "project-1",
      preset,
      "不可覆盖的用户灵感",
    );
    expect(
      resources.every((resource) => resource.input.projectId === "project-1"),
    ).toBeTrue();
    expect(
      resources.every((resource) => resource.input.title.trim()),
    ).toBeTrue();
    const outline = resources.find(
      (resource) => resource.domain === "outlines",
    );
    expect(outline?.input.payload).toMatchObject({ 大纲层级: "全书" });
    expect(JSON.stringify(outline?.input.payload)).toContain(
      "不可覆盖的用户灵感",
    );
  }
});

test("预设初始化等待全部并发写入结束后再报告失败", async () => {
  const finishedDomains: string[] = [];
  const client = {
    chapters: {
      create: async () => {
        throw new Error("chapter failed");
      },
    },
    resources: {
      create: async (domain: string) => {
        await Promise.resolve();
        finishedDomains.push(domain);
        return {};
      },
    },
  } as unknown as StudioClient;

  await expect(
    initializeStoryPresetMaterials(
      client,
      "project-1",
      novelStoryPreset("group-pet")!,
      "",
    ),
  ).rejects.toThrow("chapter failed");
  expect(finishedDomains).toHaveLength(8);
});

test("单季原创初始化母稿、四个人物槽位、季纲和首集", async () => {
  const created: Array<{ domain: string; input: Record<string, unknown> }> = [];
  const selected: Array<{ projectId: string; adaptationId: string }> = [];
  const client = {
    chapters: {
      create: async (input: Record<string, unknown>) => ({
        ...input,
        id: "chapter-1",
      }),
    },
    resources: {
      create: async (domain: string, input: Record<string, unknown>) => {
        created.push({ domain, input });
        return { id: `${domain}-${created.length}`, ...input };
      },
    },
    productionStructure: {
      selectCurrentAdaptation: async (
        projectId: string,
        input: { adaptationId: string },
      ) => {
        selected.push({ projectId, adaptationId: input.adaptationId });
        return {};
      },
    },
  } as unknown as StudioClient;

  const chapter = await initializeSingleSeasonMaterials(client, "project-1", {
    idea: "一个雨夜重逢的故事",
    targetEpisodeCount: 80,
  });

  expect(chapter.title).toBe("单季故事母稿");
  expect(created.filter((item) => item.domain === "characters")).toHaveLength(
    4,
  );
  expect(created.filter((item) => item.domain === "adaptations")).toHaveLength(
    1,
  );
  expect(created.filter((item) => item.domain === "episodes")).toHaveLength(1);
  expect(selected).toEqual([
    { projectId: "project-1", adaptationId: "adaptations-5" },
  ]);
});

test("嘉豪预设绑定嘉豪系统，并以轻松搞笑任务推动主角登顶", () => {
  const preset = novelStoryPreset("jiahao")!;
  const serialized = JSON.stringify(preset);

  expect(preset.coreHook).toContain("绑定嘉豪系统");
  expect(preset.summary).toContain("轻松搞笑");
  expect(preset.summary).toContain("巅峰");
  expect(preset.characters.map((character) => character.title)).toContain(
    "嘉豪系统槽位（待命名形态）",
  );
  expect(preset.storyArcs.map((arc) => arc.title)).toEqual([
    "第一阶段·系统绑定与爆笑新手任务",
    "第二阶段·任务升级与欢乐逆袭",
    "第三阶段·系统真相与巅峰登顶",
  ]);
  expect(preset.openingChapter.hook).toContain("嘉豪系统绑定成功");
  expect(preset.styleGuide).toContain(
    "不针对姓名、长相、地域、阶层或未成年人身份",
  );
  expect(preset.styleGuide).toContain(
    "不得复刻现实人物、账号、原视频、受保护音乐",
  );
  expect(preset.styleGuide).toContain("系统奖励必须有边界");
  expect(serialized).not.toContain("人设崩塌");
  expect(serialized).not.toContain("连续社交露馅");
  expect(serialized).not.toMatch(/@[a-z\d_]{3,}/i);
  expect(serialized).not.toContain("Alan Walker");
  expect(serialized).not.toContain("Faded");
  expect(serialized).not.toContain("真实姓名");
});
