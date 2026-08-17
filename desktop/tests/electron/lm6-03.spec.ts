import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-03-e2e-"));
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

test("默认上下文助手只展示推荐动作，高级模式保留完整控制", async () => {
  await page.getByRole("button", { name: "从灵感开始" }).click();
  await page
    .getByRole("textbox", { name: "项目名称" })
    .fill("LM6 上下文助手项目");
  await page.getByRole("button", { name: "创建项目并开始构思" }).click();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "任务", exact: true }).click();

  const config = page.getByLabel("智能任务配置");
  await expect(config.getByLabel("当前页面推荐动作")).toBeVisible();
  await expect(config.getByRole("button", { name: "高级模式" })).toBeVisible();
  await expect(config.getByLabel("智能引擎")).toHaveCount(0);
  await expect(config.getByLabel("智能任务")).toHaveCount(0);
  await expect(config.getByLabel("盲测比较方式")).toHaveCount(0);

  await config.getByRole("button", { name: "高级模式" }).click();
  await expect(config.getByLabel("智能引擎")).toBeVisible();
  await expect(config.getByLabel("智能任务")).toBeVisible();
  await expect(config.getByLabel("盲测比较方式")).toBeVisible();
  await expect(
    config.getByRole("button", { name: "启动六引擎盲测" }),
  ).toBeVisible();
  await expect(
    config.getByText("已恢复完整任务目录和高级参数。"),
  ).toBeVisible();

  await config.getByRole("button", { name: "简洁模式" }).click();
  await expect(config.getByLabel("当前页面推荐动作")).toBeVisible();
  await expect(config.getByLabel("智能引擎")).toHaveCount(0);
  await expect(config.getByText("已切换为当前页面的简洁助手。")).toBeVisible();
});
