import type { Page } from "playwright";
import { expect } from "@playwright/test";

export async function selectWorkspaceObject(
  page: Page,
  name: "项目" | "改编项目" | "分集" | "剧本" | "场景" | "分镜",
  selection: string | { label: string },
): Promise<void> {
  const context = page.getByLabel("当前制作对象", { exact: true });
  await expect(context).toBeVisible();
  const details = context.locator("details");
  if (
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator("summary").click();
  await context
    .getByRole("combobox", { name, exact: true })
    .selectOption(selection);
}

/** Opens the step-by-step form used for file imports and other templates. */
export async function openProjectCreation(page: Page): Promise<void> {
  await openProjectQuickStart(page);
  await page.getByRole("button", { name: "用其他方式新建" }).click();
  await expect(
    page.getByRole("heading", { name: "你现在手中有什么素材？" }),
  ).toBeVisible();
}

export async function openProjectQuickStart(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible();
  const create = page.getByRole("button", {
    name: "新建项目",
    exact: true,
  });
  if (await create.isVisible().catch(() => false)) await create.click();
  await expect(
    page.getByRole("radiogroup", { name: "开始方式" }),
  ).toBeVisible();
}

/**
 * Specs that start from a material ("从创意开始", "导入小说或大纲", "导入已有剧本")
 * use the step-by-step form; new projects otherwise open on the quick start.
 */
export async function openCreationWizardIfQuick(page: Page): Promise<void> {
  const quick = page.getByRole("radiogroup", { name: "开始方式" });
  const wizard = page.getByRole("heading", { name: "你现在手中有什么素材？" });
  await expect(quick.or(wizard).first()).toBeVisible();
  if (await quick.isVisible())
    await page.getByRole("button", { name: "用其他方式新建" }).click();
  await expect(wizard).toBeVisible();
}

export async function quickCreateProject(
  page: Page,
  kind: "写小说" | "写剧本" | "小说改剧本",
  title = "",
): Promise<void> {
  await openProjectQuickStart(page);
  await page.getByRole("radio", { name: kind }).click();
  if (title)
    await page.getByRole("textbox", { name: "项目名称（可不填）" }).fill(title);
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
}

export async function createSeriesProject(
  page: Page,
  title: string,
): Promise<void> {
  await quickCreateProject(page, "写小说", title);
}

export async function openProjectTool(
  page: Page,
  tool:
    | "作者意图"
    | "改编诊断"
    | "独立策略"
    | "整季方案"
    | "单集开发"
    | "质量报告"
    | "导入内容"
    | "项目驾驶舱"
    | "试制计划"
    | "系列资料",
): Promise<void> {
  let navigation = page.getByRole("navigation", { name: "项目工具导航" });
  if ((await navigation.count()) === 0) {
    const tools = page.getByRole("link", { name: "项目工具", exact: true });
    if ((await tools.count()) > 0) await tools.click();
    else
      await page
        .getByRole("navigation", { name: "当前项目导航", exact: true })
        .getByRole("link", { name: "概览", exact: true })
        .click();
    navigation = page.getByRole("navigation", { name: "项目工具导航" });
  }
  await navigation.getByRole("link", { name: tool, exact: true }).click();
}

export async function openStoryBible(page: Page): Promise<void> {
  await expect(
    page.getByRole("button", { name: "章节目录", exact: true }),
  ).toBeVisible();
  const panel = page.getByLabel("章节辅助栏", { exact: true });
  if (
    !(await panel
      .getByRole("button", { name: "资料", exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name: "智能写作", exact: true }).click();
  await page
    .getByLabel("章节辅助栏", { exact: true })
    .getByRole("button", { name: "资料", exact: true })
    .click();
}

export async function openProductionStage(
  page: Page,
  stage:
    | "素材"
    | "资产中心"
    | "导演看板"
    | "版权声明"
    | "视觉资产"
    | "分镜静帧 AI 草稿"
    | "图片生成"
    | "音频制作"
    | "视频制作"
    | "动态分镜"
    | "多轨时间线"
    | "成片渲染",
): Promise<void> {
  const group =
    stage === "导演看板" || stage === "资产中心"
      ? "分镜与资产"
      : ["素材", "版权声明", "视觉资产", "分镜静帧 AI 草稿"].includes(stage)
        ? "素材与角色"
        : ["图片生成", "音频制作", "视频制作"].includes(stage)
          ? "音视频"
          : "时间线与输出";
  await page
    .getByRole("navigation", { name: "制作工作分组" })
    .getByRole("button", { name: group, exact: true })
    .click();
  await page
    .getByRole("navigation", { name: `${group}功能` })
    .getByRole("button", { name: stage, exact: true })
    .click();
}
