import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createSeriesProject } from "./project-tools";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-04-e2e-"));
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

test("小说导入后可审阅五类候选并选择性采用", async () => {
  await createSeriesProject(page, "LM6 导入候选项目");

  await page.getByRole("link", { name: "项目工具", exact: true }).click();
  await page.getByRole("link", { name: "导入内容", exact: true }).click();
  await page.getByRole("button", { name: "选择文件并解析" }).click();
  await expect(
    page.getByText("source-import.md", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
    .check();
  await page.getByRole("button", { name: "确认导入" }).click();

  await expect(page.getByText("导入候选审阅", { exact: true })).toBeVisible();
  await expect(page.getByText("全部候选预览", { exact: true })).toBeVisible();
  for (const label of ["人物", "场景", "道具", "章节摘要", "改编建议"])
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/《第一章 雨夜来信》/).first()).toBeVisible();

  const choices = page.getByLabel(/选择候选 /);
  expect(await choices.count()).toBeGreaterThan(1);
  for (let index = 1; index < (await choices.count()); index += 1)
    await choices.nth(index).uncheck();
  await page.getByRole("button", { name: "采用已选项目" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect(
    page.getByText("已采用所选候选，并保留可撤销记录。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销采用" })).toBeVisible();
});
