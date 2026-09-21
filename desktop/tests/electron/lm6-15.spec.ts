import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import {
  openProductionStage,
  openProjectTool,
  openStoryBible,
} from "./project-tools";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-15-e2e-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("三集试制在窄窗口贯通 Story Bible、分镜与静帧优先 Gate", async () => {
  const page = await application.firstWindow();
  let videoSubmissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v2/video-generation/runs")
    )
      videoSubmissions += 1;
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "先看看示例" }).click();
  await page.getByRole("link", { name: "雨夜归来" }).click();
  await openProjectTool(page, "试制计划");

  const pilot = page.getByLabel("试制向导");
  const sources = pilot.getByRole("checkbox");
  await expect(sources).toHaveCount(3);
  await expect(sources.nth(0)).toBeChecked();
  await sources.nth(1).check();
  await sources.nth(2).check();
  await pilot.getByRole("combobox", { name: "试制集数" }).selectOption("3");
  await pilot.getByRole("button", { name: "建立试制计划" }).click();
  await pilot.getByRole("button", { name: "确认来源并生成首集" }).click();
  await expect(pilot).toContainText("3 集试制");
  await expect(pilot.getByRole("link", { name: "前往唯一待办" })).toBeVisible();

  await page.getByRole("button", { name: "← 返回写作" }).click();
  await openStoryBible(page);
  const sidecar = page.getByLabel("Story Bible 侧栏");
  await sidecar.getByLabel("搜索 Story Bible").fill("林晚");
  await expect(sidecar).toContainText("林晚");
  const auxiliary = page.getByLabel("章节辅助栏", { exact: true });
  await auxiliary.getByRole("button", { name: "折叠" }).focus();
  await page.keyboard.press("Enter");
  await expect(sidecar).toBeHidden();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  await openStoryBible(page);
  await expect(sidecar).toBeVisible();

  await page.getByRole("link", { name: "制作", exact: true }).click();
  await page
    .getByRole("combobox", { name: "改编项目" })
    .selectOption({ label: "雨夜归来·第一季改编方案" });
  await page
    .getByRole("combobox", { name: "分集" })
    .selectOption({ label: "第 1 集：雨夜敲门" });
  await page
    .getByRole("combobox", { name: "剧本" })
    .selectOption({ label: "第 1 集剧本" });
  await page
    .getByRole("combobox", { name: "场景" })
    .selectOption({ label: "场景 1：雨夜门口" });
  await page
    .getByRole("combobox", { name: "分镜" })
    .selectOption({ label: "镜头 1：门缝中的雨夜" });
  await openProductionStage(page, "导演看板");
  await expect(page.getByLabel("导演分镜看板")).toBeVisible();
  await expect(page.getByLabel("静帧预览：静帧已采用")).toBeVisible();
  await openProductionStage(page, "视频制作");
  await expect(page.getByText("静帧优先预检")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "提交视频生成" }),
  ).toBeDisabled();
  expect(videoSubmissions).toBe(0);
});
