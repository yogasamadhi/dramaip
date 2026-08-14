import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-12-e2e-"));
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

test("静帧 Gate 未通过时桌面端不会发出视频提交", async () => {
  const page = await application.firstWindow();
  let videoSubmissions = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith("/api/v1/video-generation/runs")
    )
      videoSubmissions += 1;
  });
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "创建示例项目" }).click();
  await page.getByRole("link", { name: "制作" }).click();
  await page
    .getByRole("combobox", { name: "分镜" })
    .selectOption({ label: "镜头 1：门缝中的雨夜" });
  await page.getByRole("button", { name: "视频制作" }).click();
  await expect(
    page.getByRole("heading", { name: "视频生成与候选采用" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "提交视频生成" }),
  ).toBeDisabled();
  await expect(page.getByText("静帧优先预检")).toBeVisible();
  expect(videoSubmissions).toBe(0);
});
