import type { Page } from "playwright";
import { expect } from "@playwright/test";

export async function openProjectCreation(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible();
  const create = page.getByRole("button", {
    name: "新建项目",
    exact: true,
  });
  if (await create.isVisible().catch(() => false)) await create.click();
  await expect(page.getByText("核心创作", { exact: true })).toBeVisible();
}

export async function createSeriesProject(
  page: Page,
  title: string,
): Promise<void> {
  await openProjectCreation(page);
  await page.getByRole("button", { name: /系列长篇/ }).click();
  await page.getByRole("button", { name: /从灵感开始/ }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill(title);
  await page.getByRole("button", { name: "创建系列长篇" }).click();
}

export async function openProjectTool(
  page: Page,
  tool: "导入内容" | "项目驾驶舱" | "试制计划" | "系列资料",
): Promise<void> {
  let navigation = page.getByRole("navigation", { name: "项目工具导航" });
  if ((await navigation.count()) === 0) {
    await page.getByRole("link", { name: "项目工具", exact: true }).click();
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
    | "分镜静帧候选"
    | "图片生成"
    | "音频制作"
    | "视频制作"
    | "动态分镜"
    | "多轨时间线"
    | "成片渲染",
): Promise<void> {
  const group =
    stage === "导演看板" || stage === "资产中心"
      ? "导演看板"
      : ["素材", "版权声明", "视觉资产", "分镜静帧候选"].includes(stage)
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
