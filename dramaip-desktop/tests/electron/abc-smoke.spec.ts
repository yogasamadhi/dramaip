import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-electron-e2e-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: {
      ...process.env,
      DRAMAIP_E2E_USER_DATA: userData,
    },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByText("从故事到可交付内容")).toBeVisible({
    timeout: 30_000,
  });
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("全中文项目壳与示例项目纵向链路可用", async () => {
  const buttonTexts = await page.getByRole("button").allTextContents();
  const englishOnly = buttonTexts
    .map((value) => value.trim())
    .filter(
      (value) => value && /[A-Za-z]/.test(value) && !/[㐀-鿿]/u.test(value),
    );
  expect(englishOnly).toEqual([]);

  await page.getByRole("button", { name: "创建示例项目" }).click();
  await expect(page.getByText("示例短剧：雨夜归来")).toBeVisible();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(
    page.getByText("智能引擎", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("OpenCode", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Codex", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("LangGraph.js", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("测试版", { exact: true })).toBeVisible();
});

test("Renderer 只暴露桌面原生白名单", async () => {
  const keys = await page.evaluate(() => Object.keys(window.desktop).sort());
  expect(keys).toEqual(
    [
      "awaitInitialization",
      "getCredentialStorageStatus",
      "openExternal",
      "pickFiles",
      "removeCredential",
      "retryInitialization",
      "revealPath",
      "saveTextFile",
      "storeCredential",
    ].sort(),
  );
  const credentialStorage = await page.evaluate(() =>
    window.desktop.getCredentialStorageStatus(),
  );
  expect(credentialStorage).toMatchObject({
    available: true,
    storage: "local_encrypted_file",
  });
});

test("智能助手只在用户打开弹窗后显示", async () => {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "DramaIP 智能助手" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "打开智能助手" }).click();
  const dialog = page.getByRole("dialog", { name: "DramaIP 智能助手" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "DramaIP 智能助手" }),
  ).toBeVisible();

  await dialog.getByRole("button", { name: "关闭智能助手" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("小说工作区保留旧版入口并按需打开智能写作抽屉", async () => {
  await page.getByRole("link", { name: "项目", exact: true }).click();
  if (!(await page.getByText("示例短剧：雨夜归来").count()))
    await page.getByRole("button", { name: "创建示例项目" }).click();
  await page
    .getByRole("link", { name: /示例短剧：雨夜归来/ })
    .first()
    .click();
  for (const label of ["设定", "人物", "大纲", "章节", "故事圣经"])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "更多创作工具", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "章节", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "章节正文编辑器" }),
  ).toBeVisible();
  await expect(page.locator('aside[aria-label="智能写作抽屉"]')).toHaveCount(0);
  await page.getByRole("button", { name: "智能写作", exact: true }).click();
  const drawer = page.locator('aside[aria-label="智能写作抽屉"]');
  await expect(drawer).toBeVisible();
  for (const label of [
    "智能生成正文",
    "续写本章",
    "改写本章",
    "润色本章",
    "扩写本章",
    "智能续写下一章",
  ])
    await expect(drawer.getByRole("button", { name: label })).toBeVisible();
  await expect(
    drawer.getByRole("textbox", { name: "本次写作要求（可选）" }),
  ).toBeVisible();
  await drawer.getByText("高级设置与强化方式", { exact: true }).click();
  await expect(
    drawer.getByRole("combobox", { name: /本次模型/ }),
  ).toBeVisible();
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toHaveCount(0);

  await page.getByRole("button", { name: "更多创作工具", exact: true }).click();
  for (const label of [
    "章节记忆",
    "人物状态",
    "时间线",
    "伏笔",
    "视觉档案",
    "一致性",
    "创作分析",
    "编剧室",
  ])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开始智能分析", exact: true }),
  ).toBeVisible();
});

test("模型服务商置顶并提供常用厂商与模型级联选择", async () => {
  await page.getByRole("link", { name: "设置", exact: true }).click();
  const providerHeading = page.getByText("模型服务商", { exact: true }).first();
  const engineHeading = page.getByText("智能引擎", { exact: true }).first();
  const [providerBox, engineBox] = await Promise.all([
    providerHeading.boundingBox(),
    engineHeading.boundingBox(),
  ]);
  expect(providerBox?.y).toBeLessThan(engineBox?.y ?? 0);

  const providerSelect = page.getByRole("combobox", {
    name: "服务商",
    exact: true,
  });
  await expect(providerSelect.locator("option")).toHaveCount(10);
  await providerSelect.selectOption("anthropic");
  const modelSelect = page.getByRole("combobox", {
    name: "模型",
    exact: true,
  });
  await expect(modelSelect).toHaveValue("claude-opus-5");
  await expect(
    page.getByRole("textbox", { name: "接口密钥（API Key）", exact: true }),
  ).toBeVisible();

  await providerSelect.selectOption("other");
  await expect(
    page.getByRole("textbox", { name: "服务商名称", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "服务地址", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "调用协议", exact: true }),
  ).toBeVisible();

  await providerSelect.selectOption("deepseek");
  await modelSelect.selectOption("deepseek-v4-flash");
  await page
    .getByRole("textbox", { name: "接口密钥（API Key）", exact: true })
    .fill("仅用于端到端测试的临时密钥");
  await page.getByRole("button", { name: "添加模型服务商" }).click();
  await expect(
    page.getByText("已保存 DeepSeek", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("deepseek-v4-flash", { exact: true }),
  ).toBeVisible();
});
