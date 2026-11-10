import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type ElectronApplication, type Page } from "playwright";
import { createSeriesProject } from "./project-tools";
import { electron } from "./desktop-host";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-workspace-search-e2e-"));
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

const go = (path: string) =>
  page.evaluate((hash) => {
    window.location.hash = hash;
  }, path);

test("搜索页经 workspace Remote 找到项目并打开它，项目工具页按模式列出工具并进入工具", async () => {
  await createSeriesProject(page, "工作区搜索验收项目");
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  const projectId = /\/projects\/([^/?]+)/.exec(page.url())![1]!;

  await go("/search");
  await expect(
    page.getByRole("heading", { name: "查找项目资料", level: 1 }),
  ).toBeVisible();
  const terms = page.getByRole("textbox", { name: "搜索关键词" });
  await expect(
    page.getByRole("main").getByRole("button", { name: "搜索", exact: true }),
  ).toBeDisabled();
  await terms.fill("  工作区搜索验收 ");
  await terms.press("Enter");
  await expect(
    page.getByText("“工作区搜索验收” 共找到", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("main")
    .getByRole("link", { name: /工作区搜索验收项目/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));

  await go("/search");
  await terms.fill("不存在的关键词-7f3a");
  await page
    .getByRole("main")
    .getByRole("button", { name: "搜索", exact: true })
    .click();
  await expect(
    page.getByText("没有找到相关资料。请更换关键词后重试。", { exact: true }),
  ).toBeVisible();

  await go(`/projects/${projectId}/tools`);
  await expect(
    page.getByRole("heading", { name: "项目工具", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("推荐下一步", { exact: true })).toBeVisible();
  const tools = page.getByRole("navigation", { name: "项目工具导航" });
  await expect(tools.getByRole("link", { name: "系列资料" })).toBeVisible();
  await expect(tools.getByRole("link", { name: "人物与授权" })).toHaveCount(0);
  await tools.getByRole("link", { name: "导入内容", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/tools/import$`),
  );
  await expect(
    page.getByRole("heading", { name: "导入内容", level: 1 }),
  ).toBeVisible();
  await tools.getByRole("link", { name: "总览", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目工具", level: 1 }),
  ).toBeVisible();
});
