import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createSeriesProject, openProjectTool } from "./project-tools";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-02-e2e-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("空项目驾驶舱只显示一个可信下一步，并将审核区绑定到当前项目", async () => {
  await createSeriesProject(page, "LM6 驾驶舱项目");
  await openProjectTool(page, "项目驾驶舱");
  await expect(page.getByLabel("项目驾驶舱")).toBeVisible();
  const actions = page.getByRole("link", { name: "继续 AI 创作" });
  await expect(actions).toBeVisible();
  await expect(actions).toHaveCount(1);

  const projectId = /\/projects\/([^/?]+)/.exec(page.url())?.[1];
  expect(projectId).toBeTruthy();
  await page.getByText("按需进入改编、制作或审片", { exact: true }).click();
  await page.getByRole("link", { name: "审核交付", exact: true }).click();
  await expect(page.getByRole("heading", { name: "审核交付" })).toBeVisible();
  await expect(page.locator("select").first()).toHaveValue(projectId!);

  const reviewStages = page.getByRole("navigation", {
    name: "审核交付阶段",
  });
  for (const label of [
    "问题与阻塞",
    "合规复检",
    "预览与修订",
    "字幕与本地化",
    "导出与发布",
  ])
    await expect(
      reviewStages.getByRole("button", { name: label }),
    ).toBeVisible();
  await reviewStages.getByRole("button", { name: "导出与发布" }).click();
  await expect(
    page.getByRole("link", { name: "去改编工作区补齐" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "改编", exact: true }).click();
  const adaptationStages = page.getByRole("navigation", { name: "改编阶段" });
  for (const label of ["改编项目", "分集", "剧本", "场景", "分镜"])
    await expect(
      adaptationStages.getByRole("button", { name: label }),
    ).toBeVisible();
  await adaptationStages.getByRole("button", { name: "剧本" }).click();
  await expect(page.getByText("请先创建或选择一个分集。")).toBeVisible();

  await page.getByRole("link", { name: "制作", exact: true }).click();
  const productionStages = page.getByRole("navigation", {
    name: "制作工作分组",
  });
  for (const label of ["导演看板", "素材与角色", "音视频", "时间线与输出"])
    await expect(
      productionStages.getByRole("button", { name: label }),
    ).toBeVisible();

  await createSeriesProject(page, "LM6 第二项目");
  await expect(
    page.getByRole("button", { name: "当前项目：LM6 第二项目" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "当前项目：LM6 第二项目" }).click();
  await page.getByRole("menuitem", { name: /LM6 驾驶舱项目/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/produce\\?projectId=${projectId}$`),
  );

  await page.getByRole("link", { name: "创作分析", exact: true }).click();
  await expect
    .poll(() =>
      new URL(page.url().replace("#/", "/")).searchParams.get("projectId"),
    )
    .toBe(projectId);

  for (const label of ["改编", "制作", "审核交付"] as const) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect
      .poll(() =>
        new URL(page.url().replace("#/", "/")).searchParams.get("projectId"),
      )
      .toBe(projectId);
  }
  await page.getByRole("link", { name: "任务", exact: true }).click();
  await expect(page.getByText("正在显示当前项目的任务。")).toBeVisible();

  await application.close();
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  page = await application.firstWindow();
  await expect(
    page.getByRole("button", { name: "当前项目：LM6 驾驶舱项目" }),
  ).toBeVisible({ timeout: 30_000 });
});
