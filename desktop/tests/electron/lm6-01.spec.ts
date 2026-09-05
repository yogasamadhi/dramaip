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
  if (userData)
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
});

test("三种创建入口进入同一项目上下文，原著路径先展示权益预览", async () => {
  await expect(page.getByText("核心创作", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /系列长篇/ }).click();
  await page.getByRole("button", { name: /从灵感开始/ }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("LM6 灵感项目");
  await page.getByRole("button", { name: "创建系列长篇" }).click();
  await expect(
    page.getByRole("heading", { name: "LM6 灵感项目" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "尽意项目首页" }).click();
  await page.getByRole("button", { name: /单季短剧/ }).click();
  await page.getByRole("button", { name: /导入小说 \/ IP/ }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("LM6 原著项目");
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(
    page.getByText("source-import.md", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
    .check();
  await page.getByRole("button", { name: "创建单季短剧并导入" }).click();
  await expect(
    page.getByRole("heading", { name: "LM6 原著项目" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "尽意项目首页" }).click();
  await page.getByRole("button", { name: /单季短剧/ }).click();
  await page.getByRole("button", { name: /直接写剧本/ }).click();
  await page.getByRole("textbox", { name: "项目名称" }).fill("LM6 剧本项目");
  await page
    .getByRole("textbox", { name: "首集剧本" })
    .fill("【雨夜·门口】\n林晚：你终于来了。");
  await page.getByRole("button", { name: "创建单季短剧" }).click();
  await expect(
    page.getByRole("heading", { name: "LM6 剧本项目" }),
  ).toBeVisible();
  await expect(
    page.getByText("第 1 集剧本草稿", { exact: true }),
  ).toBeVisible();
});
