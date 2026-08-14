import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

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
      request.url().endsWith("/api/v1/video-generation/runs")
    )
      videoSubmissions += 1;
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "创建示例项目" }).click();
  await page.getByRole("link", { name: "雨夜归来" }).click();

  const pilot = page.getByLabel("试制向导");
  const sources = pilot.getByRole("checkbox");
  await expect(sources).toHaveCount(3);
  await sources.nth(0).check();
  await sources.nth(1).check();
  await sources.nth(2).check();
  await pilot.getByRole("combobox", { name: "试制集数" }).selectOption("3");
  await pilot.getByRole("button", { name: "建立试制计划" }).click();
  await pilot.getByRole("button", { name: "确认来源并创建试制分集" }).click();
  await expect(pilot).toContainText("3 集试制");
  await expect(pilot.getByRole("link", { name: "前往唯一待办" })).toBeVisible();

  const sidecar = page.getByLabel("Story Bible 侧栏");
  await sidecar.getByLabel("搜索 Story Bible").fill("林晚");
  await expect(sidecar).toContainText("林晚");
  await sidecar.getByRole("button", { name: "折叠" }).focus();
  await page.keyboard.press("Enter");
  await expect(sidecar.getByRole("button", { name: "展开" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();

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
  await page.getByRole("button", { name: "导演看板" }).click();
  await expect(page.getByLabel("导演分镜看板")).toBeVisible();
  await expect(page.getByLabel("静帧预览：静帧已采用")).toBeVisible();
  await page.getByRole("button", { name: "视频制作" }).click();
  await expect(page.getByText("静帧优先预检")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "提交视频生成" }),
  ).toBeDisabled();
  expect(videoSubmissions).toBe(0);
});
