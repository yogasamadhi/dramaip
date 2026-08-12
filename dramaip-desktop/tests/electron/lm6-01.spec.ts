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
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-01-e2e-"));
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

test("三种创建入口进入同一项目上下文，原著路径先展示权益预览", async () => {
  await expect(page.getByText("选择开始方式", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "从灵感开始" }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("LM6 灵感项目");
  await page.getByRole("button", { name: "创建项目并开始构思" }).click();
  await expect(
    page.getByRole("heading", { name: "LM6 灵感项目" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "← 返回项目" }).click();
  await page.getByRole("button", { name: "导入原著" }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("LM6 原著项目");
  await page.getByRole("button", { name: "创建项目并预览原著" }).click();
  await expect(
    page.getByRole("heading", { name: "LM6 原著项目" }),
  ).toBeVisible();
  await expect(page.getByText("选择拥有授权的内容文件")).toBeVisible();
  await expect(
    page.getByText(
      "不支持绕过数字版权保护、OCR 识别受限内容或从网络抓取付费内容。",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "← 返回项目" }).click();
  await page.getByRole("button", { name: "直接导入 / 粘贴剧本" }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("LM6 剧本项目");
  await page
    .getByRole("textbox", { name: "首集剧本" })
    .fill("【雨夜·门口】\n林晚：你终于来了。");
  await page.getByRole("button", { name: "保存剧本草稿并进入项目" }).click();
  await expect(
    page.getByRole("heading", { name: "LM6 剧本项目" }),
  ).toBeVisible();
  await expect(
    page.getByText("第 1 集剧本草稿", { exact: true }),
  ).toBeVisible();
});
