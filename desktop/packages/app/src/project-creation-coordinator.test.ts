import { expect, test } from "bun:test";
import type { DomainEntity, Project } from "@dramaip/contracts/product";
import type { StudioClient } from "@dramaip/client";
import {
  initializeProjectMaterials,
  existingScriptContext,
  projectInitializationPlan,
  ProjectInitializationError,
  scriptWorkspacePath,
} from "./project-creation-coordinator";
import { projectModeBrief } from "./project-intake";

function project(mode: Project["mode"]): Project {
  return {
    id: crypto.randomUUID(),
    title: mode,
    mode,
    modeConfig:
      mode === "series_longform"
        ? { mode }
        : mode === "single_season"
          ? { mode, entryPath: "novel" }
          : mode === "personal_theater"
            ? {
                mode,
                storyMethod: "freeform",
                episodeCount: 1,
                episodeDurationMinutes: 3,
              }
            : { mode, topic: "从零创作" },
    lifecycleStatus: "ready",
    synopsis: "",
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("所有创建入口共享四模式初始化计划", () => {
  expect(projectInitializationPlan(project("series_longform"))).toEqual([
    "series-materials",
  ]);
  expect(projectInitializationPlan(project("single_season"))).toEqual([
    "season-materials",
  ]);
  expect(projectInitializationPlan(project("personal_theater"))).toEqual([
    "theater-opening",
  ]);
  expect(projectInitializationPlan(project("creator_channel"))).toEqual([
    "creator-workspace",
  ]);
});

function screenplayFixture(failOnce?: "scripts" | "select") {
  const p = project("single_season");
  p.modeConfig = { mode: "single_season", entryPath: "script" };
  const records: DomainEntity[] = [];
  let failed = false;
  const client = {
    resources: {
      list: async (domain: string, projectId: string, parentId?: string) =>
        records.filter(
          (item) =>
            item.domain === domain &&
            item.projectId === projectId &&
            (!parentId || item.parentId === parentId),
        ),
      get: async (_domain: string, id: string) =>
        records.find((item) => item.id === id)!,
      create: async (
        domain: string,
        input: {
          projectId: string;
          parentId?: string;
          title: string;
          payload: Record<string, unknown>;
        },
      ) => {
        if (!failed && failOnce === domain) {
          failed = true;
          throw new Error("写入中断");
        }
        const value = {
          ...input,
          id: crypto.randomUUID(),
          domain,
          version: 0,
        } as DomainEntity;
        records.push(value);
        return value;
      },
    },
    productionStructure: {
      selectCurrentAdaptation: async (
        _id: string,
        input: { adaptationId: string },
      ) => {
        if (!failed && failOnce === "select") {
          failed = true;
          throw new Error("选择中断");
        }
        p.currentAdaptationId = input.adaptationId;
        return p;
      },
    },
    chapters: {
      list: async () => {
        throw new Error("已有剧本不应读写小说章节");
      },
    },
  } as unknown as StudioClient;
  return { p, records, client };
}

test("已有剧本直接初始化生产域剧本，不制造故事母稿、人物或空季纲", async () => {
  const { p, records, client } = screenplayFixture();
  expect(projectInitializationPlan(p)).toEqual(["script-materials"]);
  const result = await initializeProjectMaterials(client, {
    project: p,
    brief: projectModeBrief("single_season", "script"),
    scriptDraft: "INT. FERRY - NIGHT\n\n@阿禾\n不能再等了。",
    scriptRightsConfirmed: true,
  });
  expect(result.chapterId).toBeUndefined();
  expect(result.steps).toEqual([
    { key: "script-materials", status: "completed" },
  ]);
  expect(records.map((item) => item.domain)).toEqual([
    "adaptations",
    "episodes",
    "scripts",
  ]);
  expect(
    (records[0]!.payload as Record<string, unknown>)["季纲"],
  ).toBeUndefined();
  expect(
    (records[2]!.payload as Record<string, unknown>)["剧本内容"],
  ).toContain("不能再等了");
  expect(p.currentAdaptationId).toBe(result.scriptContext!.adaptationId);
  expect(
    new URLSearchParams(
      scriptWorkspacePath(result.scriptContext!).split("?")[1],
    ).get("scriptId"),
  ).toBe(records[2]!.id);
});

for (const interruptedStep of ["scripts", "select"] as const) {
  test(`已有剧本在 ${interruptedStep} 中断后复用已保存对象，重试不重复写入`, async () => {
    const { p, records, client } = screenplayFixture(interruptedStep);
    const input = {
      project: p,
      brief: projectModeBrief("single_season", "script"),
      scriptDraft: "作者原稿",
      scriptRightsConfirmed: true,
    };
    await expect(
      initializeProjectMaterials(client, input),
    ).rejects.toBeInstanceOf(ProjectInitializationError);
    const result = await initializeProjectMaterials(client, input);
    expect(records).toHaveLength(3);
    expect(result.scriptContext!.scriptId).toBe(records[2]!.id);
    await initializeProjectMaterials(client, input);
    expect(records).toHaveLength(3);
    await initializeProjectMaterials(client, {
      ...input,
      scriptRightsConfirmed: false,
    });
    expect(records).toHaveLength(3);
    await expect(
      initializeProjectMaterials(client, {
        ...input,
        scriptDraft: "不同的草稿",
        scriptRightsConfirmed: false,
      }),
    ).rejects.toThrow("不会自动覆盖");
    expect((records[2]!.payload as Record<string, unknown>)["剧本内容"]).toBe(
      "作者原稿",
    );
  });
}

test("文件导入完成后恢复实际剧本父级；没有成功导入时不伪造剧本", async () => {
  const { p, records, client } = screenplayFixture();
  const input = {
    project: p,
    brief: projectModeBrief("single_season", "script"),
  };
  await expect(initializeProjectMaterials(client, input)).rejects.toThrow(
    "尚未找到已导入",
  );
  expect(records).toHaveLength(0);
  const initialized = await initializeProjectMaterials(client, {
    ...input,
    scriptDraft: "文件原稿",
    scriptRightsConfirmed: true,
  });
  records[2]!.payload = { 剧本内容: "文件原稿", 导入来源: "script.json" };
  const restored = await initializeProjectMaterials(client, input);
  expect(restored.scriptContext).toEqual(initialized.scriptContext);
  expect(records).toHaveLength(3);
  records[1]!.parentId = "不存在的方案";
  expect(await existingScriptContext(client, p)).toBeUndefined();
});

test("多分集恢复遵循实际分集顺序，不把跨父级的剧本列表首项当成第一集", async () => {
  const { p, records, client } = screenplayFixture();
  const initial = await initializeProjectMaterials(client, {
    project: p,
    brief: projectModeBrief("single_season", "script"),
    scriptDraft: "第一集原稿",
    scriptRightsConfirmed: true,
  });
  const second = await client.resources.create("episodes", {
    projectId: p.id,
    parentId: initial.scriptContext!.adaptationId,
    title: "第 2 集",
    payload: { 集数: 2 },
  });
  const secondScript = await client.resources.create("scripts", {
    projectId: p.id,
    parentId: second.id,
    title: "第二集剧本",
    payload: { 剧本内容: "第二集原稿" },
  });
  records.splice(records.indexOf(secondScript), 1);
  records.unshift(secondScript);
  expect(await existingScriptContext(client, p)).toEqual(initial.scriptContext);
  // The owner's reordered episode list, not titles or insertion of scripts,
  // determines the fallback entry after a bare project navigation.
  records.splice(records.indexOf(second), 1);
  records.unshift(second);
  expect(await existingScriptContext(client, p)).toEqual({
    projectId: p.id,
    adaptationId: initial.scriptContext!.adaptationId,
    episodeId: second.id,
    scriptId: secondScript.id,
  });
});

test("分集顺序恢复仍拒绝断开的实际父级和不属于当前方案的剧本", async () => {
  const { p, records, client } = screenplayFixture();
  const initial = await initializeProjectMaterials(client, {
    project: p,
    brief: projectModeBrief("single_season", "script"),
    scriptDraft: "保留原稿",
    scriptRightsConfirmed: true,
  });
  const unrelated = await client.resources.create("adaptations", {
    projectId: p.id,
    title: "其他方案",
    payload: {},
  });
  p.currentAdaptationId = unrelated.id;
  expect(await existingScriptContext(client, p)).toBeUndefined();
  p.currentAdaptationId = initial.scriptContext!.adaptationId;
  records.find(
    (item) => item.id === initial.scriptContext!.scriptId,
  )!.parentId = unrelated.id;
  expect(await existingScriptContext(client, p)).toBeUndefined();
  expect(records).toHaveLength(4);
});

test("重启后的粘贴草稿未经重新确认不创建剧本或父级资料", async () => {
  const { p, records, client } = screenplayFixture();
  await expect(
    initializeProjectMaterials(client, {
      project: p,
      brief: projectModeBrief("single_season", "script"),
      scriptDraft: "尚未确认权利的草稿",
    }),
  ).rejects.toThrow("请先确认");
  expect(records).toHaveLength(0);
});

for (const interruption of [undefined, "scripts", "select"] as const) {
  test(`原创剧本只建立分集与空草稿，${interruption ?? "成功"} 后恢复不重建或覆盖内容`, async () => {
    const { p, records, client } = screenplayFixture(interruption);
    p.modeConfig = {
      mode: "single_season",
      entryPath: "inspiration",
      targetEpisodeCount: 12,
    };
    p.synopsis = "末班渡船上，阿禾必须等到失联的姐姐。";
    const input = {
      project: p,
      brief: {
        ...projectModeBrief("single_season", "inspiration"),
        idea: p.synopsis,
      },
    };
    expect(projectInitializationPlan(p)).toEqual(["original-script-materials"]);
    if (interruption)
      await expect(
        initializeProjectMaterials(client, input),
      ).rejects.toBeInstanceOf(ProjectInitializationError);
    const initialized = await initializeProjectMaterials(client, input);
    expect(initialized.chapterId).toBeUndefined();
    expect(initialized.steps).toEqual([
      { key: "original-script-materials", status: "completed" },
    ]);
    expect(records.map((item) => item.domain)).toEqual([
      "adaptations",
      "episodes",
      "scripts",
    ]);
    expect(records[0]!.title).toBe("原创剧本·分集目录");
    expect(
      (records[0]!.payload as Record<string, unknown>)["季纲"],
    ).toBeUndefined();
    expect((records[2]!.payload as Record<string, unknown>)["剧本内容"]).toBe(
      "",
    );
    expect(
      (records[2]!.payload as Record<string, unknown>)["权利确认"],
    ).toBeUndefined();
    records[2]!.payload = {
      ...(records[2]!.payload as object),
      剧本内容: "作者已保存的正文",
    };
    const restored = await initializeProjectMaterials(client, input);
    expect(restored.scriptContext).toEqual(initialized.scriptContext);
    expect(records).toHaveLength(3);
    expect((records[2]!.payload as Record<string, unknown>)["剧本内容"]).toBe(
      "作者已保存的正文",
    );
  });
}

test("已有小说继续写作沿用导入的末章，不新建第一章或改编对象", async () => {
  let created = 0;
  const imported = [
    { id: "chapter-1", title: "雨夜来信" },
    { id: "chapter-2", title: "失联电话" },
  ];
  const client = {
    chapters: {
      list: async () => imported,
      create: async () => {
        created++;
        throw new Error("不应重新创建章节");
      },
    },
  } as unknown as StudioClient;
  const result = await initializeProjectMaterials(client, {
    project: project("series_longform"),
    brief: projectModeBrief("series_longform", "source-import"),
  });
  expect(result.chapterId).toBe("chapter-2");
  expect(result.steps).toEqual([
    { key: "series-materials", status: "completed" },
  ]);
  expect(created).toBe(0);
});
