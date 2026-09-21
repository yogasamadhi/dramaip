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
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-05-e2e-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: {
      ...process.env,
      DRAMAIP_E2E_USER_DATA: userData,
      DRAMAIP_E2E_SOURCE_IMPORT_FILE: resolve(
        "tests/fixtures/lm6/lm6-00/source-import.md",
      ),
    },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("原著路径可建立并恢复一集试制计划", async () => {
  await createSeriesProject(page, "LM6 试制项目");
  await openProjectTool(page, "导入内容");
  await page.getByRole("button", { name: "选择文件并解析" }).click();
  await page
    .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
    .check();
  await page.getByRole("button", { name: "确认导入" }).click();
  await openProjectTool(page, "试制计划");
  await expect(page.getByLabel("试制向导")).toBeVisible();
  await page.getByRole("button", { name: "建立试制计划" }).click();
  await expect(
    page.getByRole("button", { name: "确认来源并生成首集" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认来源并生成首集" }).click();
  await expect(
    page.getByText("当前阶段：采用试制剧本", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "前往唯一待办" })).toBeVisible();
});
