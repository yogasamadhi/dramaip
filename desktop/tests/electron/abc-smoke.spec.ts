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
  await expect(page.getByRole("heading", { name: "选择开始方式" })).toBeVisible(
    {
      timeout: 30_000,
    },
  );
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("桌面窗口使用更宽高的默认工作区", async () => {
  const size = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getSize(),
  );
  expect(size?.[0]).toBeGreaterThanOrEqual(1600);
  expect(size?.[1]).toBeGreaterThanOrEqual(1000);
});

test("全中文项目壳与示例项目纵向链路可用", async () => {
  await expect(
    page.getByRole("link", { name: "小说写作", exact: true }),
  ).toBeVisible();
  const buttonTexts = await page.getByRole("button").allTextContents();
  const englishOnly = buttonTexts
    .map((value) => value.trim())
    .filter(
      (value) => value && /[A-Za-z]/.test(value) && !/[㐀-鿿]/u.test(value),
    );
  expect(englishOnly).toEqual([]);

  await page.getByRole("button", { name: "创建示例项目" }).click();
  await expect(page.getByText("示例短剧：雨夜归来")).toBeVisible();
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(
    page.getByText("智能引擎", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("OpenCode", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Codex", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("DeepSeek Harness", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Hermes Agent", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("OpenClaw", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("LangGraph.js", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("测试版", { exact: true })).toHaveCount(4);
  await expect(
    page.getByLabel("智能引擎状态").locator("article > div > p"),
  ).toHaveText([
    "OpenCode",
    "Codex",
    "DeepSeek Harness",
    "Hermes Agent",
    "OpenClaw",
    "LangGraph.js",
  ]);
  await expect(page.getByLabel("全局默认引擎").locator("option")).toHaveText([
    "OpenCode",
    "Codex（测试版）",
    "DeepSeek Harness（测试版）",
    "Hermes Agent（测试版）",
    "OpenClaw（测试版）",
    "LangGraph.js",
  ]);
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
      "setWindowTheme",
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

test("主题跟随系统并持久化手动选择", async () => {
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-mode",
    "system",
  );
  await page.getByRole("button", { name: "切换外观主题" }).click();
  await page.getByRole("menuitem", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "切换外观主题" }).click();
  await page.getByRole("menuitem", { name: "浅色" }).click();
});

test("最小窗口下应用栏可用且页面无横向溢出", async () => {
  await page.setViewportSize({ width: 1080, height: 700 });
  await expect(
    page.getByRole("link", { name: "小说写作", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "更多", exact: true }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 920 });
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
    dialog.getByRole("heading", { name: "DramaIP 智能助手" }).first(),
  ).toBeVisible();
  await expect(dialog.getByText("AI 办事助手", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("textbox", { name: "给 AI 办事助手发消息" }),
  ).toBeVisible();

  await dialog.getByRole("button", { name: "关闭智能助手" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("只填作品名即可创建小说、首章并进入写作", async () => {
  await page.getByRole("link", { name: "小说写作", exact: true }).click();
  await page.getByRole("link", { name: "新建小说", exact: true }).click();
  await page.getByRole("textbox", { name: "作品名称" }).fill("端到端空白小说");
  await page.getByRole("button", { name: "创建并开始写作" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: "端到端空白小说" }),
  ).toBeVisible();
  await expect(
    page.getByText("第 1 章", { exact: true }).first(),
  ).toBeVisible();
  const contextPanel = page.locator('aside[aria-label="章节辅助栏"]');
  await expect(contextPanel).toBeVisible();
  await expect(
    contextPanel.getByRole("button", { name: "智能生成正文" }),
  ).toBeVisible();
  await expect(
    contextPanel.getByRole("button", { name: "续写本章" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("项目辅助区")).toHaveCount(0);
});

test("小说正文使用全高三栏，智能写作常驻且窄屏无溢出", async () => {
  for (const label of ["正文", "大纲", "人物", "设定", "故事圣经"])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "长篇工具", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "正文", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "章节正文编辑器" }),
  ).toBeVisible();
  const panel = page.locator('aside[aria-label="章节辅助栏"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("智能写作")).toBeVisible();
  await expect(panel.getByLabel("AI 写作消息时间线")).toBeVisible();
  await expect(
    panel.getByRole("textbox", { name: "给 AI 写作助手发消息" }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Story Bible", exact: true }).click();
  await expect(panel.getByLabel("Story Bible 侧栏")).toBeVisible();
  await panel.getByRole("button", { name: "智能写作", exact: true }).click();

  const editor = page.getByRole("textbox", { name: "章节正文编辑器" });
  await editor.fill("雨落在玻璃上，林夏推开了那扇三年未开的门。");
  for (const label of ["续写本章", "改写本章", "润色本章", "续写下一章"])
    await expect(panel.getByRole("button", { name: label })).toBeVisible();
  await expect(
    panel.getByRole("textbox", { name: "给 AI 写作助手发消息" }),
  ).toBeVisible();
  await panel.getByText("高级设置", { exact: true }).click();
  await expect(panel.getByRole("combobox", { name: /本次模型/ })).toBeVisible();

  const [editorBox, panelBox] = await Promise.all([
    editor.boundingBox(),
    panel.boundingBox(),
  ]);
  expect(panelBox!.width).toBeGreaterThanOrEqual(520);
  expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(panelBox!.x);

  await page.setViewportSize({ width: 1080, height: 700 });
  await expect(panel).toBeHidden();
  await page.getByRole("button", { name: "智能写作", exact: true }).click();
  await expect(panel).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await panel.getByRole("button", { name: "关闭章节辅助栏" }).click();
  await page.setViewportSize({ width: 1440, height: 920 });

  await page.getByRole("button", { name: "长篇工具", exact: true }).click();
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

  await page.getByRole("link", { name: "项目工具", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目工具", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("推荐下一步", { exact: true })).toBeVisible();
  await expect(page.getByLabel("项目辅助区")).toHaveCount(0);
});

test("模型服务商置顶并提供常用厂商与模型级联选择", async () => {
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
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

  const deepseekProvider = page.getByLabel("模型服务商 DeepSeek", {
    exact: true,
  });
  await deepseekProvider
    .getByRole("button", { name: "编辑配置", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "正在编辑 DeepSeek" }),
  ).toBeVisible();
  await expect(providerSelect).toBeFocused();
  await expect(modelSelect).toHaveValue("deepseek-v4-flash");
  await expect(
    page.getByRole("textbox", { name: "接口密钥（API Key）", exact: true }),
  ).toHaveAttribute("placeholder", "留空表示继续使用已保存密钥");
  await modelSelect.selectOption("deepseek-v4-pro");
  await page
    .getByRole("button", { name: "保存服务商修改", exact: true })
    .click();
  await expect(
    deepseekProvider.getByText("deepseek-v4-pro", { exact: true }),
  ).toBeVisible();
});
