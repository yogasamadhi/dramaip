import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";

let application: ElectronApplication;
let page: Page;
let userData: string;
let importFixtures: Array<{ name: string; path: string; script: boolean }>;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-electron-e2e-"));
  const fixtureDirectory = join(userData, "source-import-fixtures");
  await mkdir(fixtureDirectory);
  const fixtures = {
    "story.txt": strToU8("# 文本故事\n\n## 第一章\n\nTXT 正文"),
    "story.md": strToU8("# Markdown 故事\n\n## 第一章\n\nMarkdown 正文"),
    "story.docx": zipSync({
      "[Content_Types].xml": strToU8("<Types></Types>"),
      "word/document.xml": strToU8(
        '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Word 故事</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p><w:p><w:r><w:t>DOCX 正文</w:t></w:r></w:p></w:body></w:document>',
      ),
    }),
    "story.epub": zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>',
      ),
      "OPS/book.opf": strToU8(
        '<package><metadata><dc:title>EPUB 故事</dc:title></metadata><manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>',
      ),
      "OPS/chapter.xhtml": strToU8(
        "<html><body><h1>第一章</h1><p>EPUB 正文</p></body></html>",
      ),
    }),
    "script.json": strToU8(
      JSON.stringify({
        title: "结构化剧本",
        episodes: [
          {
            episodeNumber: 1,
            scenes: [{ title: "雨夜门口", content: "主角拆开信封。" }],
          },
        ],
      }),
    ),
  };
  importFixtures = [];
  for (const [name, content] of Object.entries(fixtures)) {
    const path = join(fixtureDirectory, name);
    await writeFile(path, content);
    importFixtures.push({ name, path, script: name.endsWith(".json") });
  }
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
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 30_000,
  });
});

async function runtimeJson<T>(path: string, init?: RequestInit): Promise<T> {
  const bootstrap = await page.evaluate(() =>
    window.runtimeBootstrap.resolve(),
  );
  const response = await fetch(`${bootstrap.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${bootstrap.accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  expect(response.ok, await response.clone().text()).toBe(true);
  return (await response.json()) as T;
}

async function openProjectCreation(): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible();
  const create = page.getByRole("button", {
    name: "新建项目",
    exact: true,
  });
  if (await create.isVisible().catch(() => false)) await create.click();
  await expect(
    page.getByRole("heading", { name: "你现在手中有什么素材？" }),
  ).toBeVisible();
}

test.afterAll(async () => {
  await application?.close();
  if (userData)
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
});

test("桌面窗口默认尺寸为 1800×1000", async () => {
  const size = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getSize(),
  );
  expect(size).toEqual([1800, 1000]);
});

test("全中文项目壳与示例项目纵向链路可用", async () => {
  await expect(
    page.getByRole("link", { name: "项目库", exact: true }),
  ).toBeVisible();
  const buttonTexts = await page.getByRole("button").allTextContents();
  const englishOnly = buttonTexts
    .map((value) => value.trim())
    .filter(
      (value) => value && /[A-Za-z]/.test(value) && !/[㐀-鿿]/u.test(value),
    );
  expect(englishOnly).toEqual([]);

  await page.getByRole("button", { name: "先看看示例" }).click();
  await expect(
    page.getByRole("heading", { name: "示例短剧：雨夜归来" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "小说写作", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "设置", exact: true }).click();
  await expect(
    page.getByText("智能引擎", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Codex", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Pi", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("LangGraph.js", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("测试版", { exact: true })).toHaveCount(0);
  await expect(
    page.getByLabel("智能引擎状态").locator("article > div > p"),
  ).toHaveText(["Pi", "Codex", "LangGraph.js"]);
  await expect(page.getByLabel("全局默认引擎").locator("option")).toHaveText([
    "Pi",
    "Codex",
    "LangGraph.js",
  ]);
});

test("Renderer 只暴露一次性 Runtime bootstrap resolver", async () => {
  const keys = await page.evaluate(() =>
    Object.keys(window.runtimeBootstrap).sort(),
  );
  expect(keys).toEqual(["resolve"]);
});

test("Core Runtime 使用 Electron 内嵌 Node", async () => {
  const bootstrap = await page.evaluate(() =>
    window.runtimeBootstrap.resolve(),
  );
  const response = await fetch(`${bootstrap.baseUrl}/api/v2/runtime`, {
    headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
  });
  expect(response.ok).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    runtimeKind: "electron-node",
    mode: "desktop",
  });
  const diagnostics = await runtimeJson<{ hmr: { enabled: boolean } }>(
    "/api/v2/system/diagnostics",
  );
  const packaged = await application.evaluate(({ app }) => app.isPackaged);
  expect(diagnostics.hmr.enabled).toBe(!packaged);
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
    page.getByRole("button", { name: /当前项目：示例短剧：雨夜归来/ }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 920 });
});

test("灵感空间的输入框和发送按钮始终位于视口内", async () => {
  await page.setViewportSize({ width: 1080, height: 700 });
  await page.getByRole("link", { name: "灵感空间", exact: true }).click();
  const consentDialog = page
    .getByRole("dialog")
    .filter({ hasText: "是否允许灵感空间自动学习" });
  await expect(consentDialog).toBeVisible();
  await consentDialog.getByRole("button", { name: "取消" }).click();

  const webAccess = page.getByRole("switch", {
    name: "联网搜索 · 自动",
  });
  await expect(webAccess).toBeVisible();
  await webAccess.click();
  await expect(
    page.getByRole("switch", { name: "联网搜索 · 关闭" }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "联网搜索 · 关闭" }).click();
  const webConsent = page
    .getByRole("dialog", { name: "确认操作" })
    .filter({ hasText: "搜索词" });
  await expect(webConsent).toContainText("不会自动发送项目文件");
  await webConsent.getByRole("button", { name: "取消" }).click();
  await expect(
    page.getByRole("switch", { name: "联网搜索 · 关闭" }),
  ).toBeVisible();
  await page.getByRole("switch", { name: "联网搜索 · 关闭" }).click();
  await webConsent.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "联网搜索 · 自动" }),
  ).toBeVisible();
  await expect(
    runtimeJson<{ consented: boolean }>(
      "/api/v2/assistant-web-research-settings",
    ),
  ).resolves.toMatchObject({ consented: true });

  const composer = page.getByPlaceholder(
    "说出一个画面、人物、疑问，或任何还没成形的念头…",
  );
  const sendButton = page.getByRole("button", { name: "发送", exact: true });
  await expect(composer).toBeVisible();
  await expect(sendButton).toBeVisible();
  const privateAddButton = page.getByRole("button", { name: "私人添加" });
  const newExperimentButton = page.getByRole("button", { name: "新实验" });
  await expect(privateAddButton).toBeVisible();
  await expect(newExperimentButton).toBeVisible();
  for (const button of [privateAddButton, newExperimentButton]) {
    const metrics = await button.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      whiteSpace: getComputedStyle(element).whiteSpace,
    }));
    expect(metrics.height).toBeLessThanOrEqual(36);
    expect(metrics.whiteSpace).toBe("nowrap");
  }
  await expect(page.getByText("制作复杂度", { exact: true })).toHaveCount(1);
  const modeTabs = page.getByRole("tablist", { name: "灵感模式" });
  await expect(modeTabs).toBeVisible();
  const modeLayout = await modeTabs.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    tabTops: Array.from(element.querySelectorAll('[role="tab"]')).map((tab) =>
      Math.round(tab.getBoundingClientRect().top),
    ),
  }));
  expect(modeLayout.scrollWidth).toBeLessThanOrEqual(
    modeLayout.clientWidth + 1,
  );
  expect(new Set(modeLayout.tabTops).size).toBe(1);

  const layout = await page.evaluate(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="说出一个画面、人物、疑问，或任何还没成形的念头…"]',
    );
    const send = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "发送",
    );
    return {
      documentHeight: document.documentElement.scrollHeight,
      textareaBottom: textarea?.getBoundingClientRect().bottom ?? Infinity,
      sendBottom: send?.getBoundingClientRect().bottom ?? Infinity,
      viewportHeight: window.innerHeight,
    };
  });

  expect(layout.textareaBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.sendBottom).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
  await page.setViewportSize({ width: 1440, height: 920 });
});

test("智能助手只在用户打开弹窗后显示", async () => {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "尽意智能助手" })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "打开智能助手面板" }).click();
  const assistant = page.getByRole("complementary", {
    name: "尽意智能助手",
  });
  await expect(assistant).toBeVisible();
  await expect(
    assistant.getByText("AI 办事助手", { exact: true }),
  ).toBeVisible();
  await expect(assistant.getByLabel("智能助手引擎")).toBeVisible();
  await expect(
    assistant.getByLabel("智能助手引擎").locator("option"),
  ).toHaveText([/Pi/, /Codex/, /LangGraph\.js/]);
  await expect(
    assistant.getByRole("textbox", { name: "给 AI 办事助手发消息" }),
  ).toBeVisible();
  await expect(
    assistant.getByRole("switch", { name: "联网搜索 · 自动" }),
  ).toBeVisible();
  const assistantLayout = await assistant.evaluate((element) => {
    const messages = element.querySelector<HTMLElement>(
      '[aria-label="助手消息列表"]',
    );
    const composer = element.querySelector<HTMLElement>(
      '[aria-label="给 AI 办事助手发消息"]',
    );
    const dialogBounds = element.getBoundingClientRect();
    return {
      dialogHeight: dialogBounds.height,
      dialogBottom: dialogBounds.bottom,
      messagesHeight: messages?.getBoundingClientRect().height ?? 0,
      composerHeight: composer?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    };
  });
  expect(assistantLayout.dialogBottom).toBeLessThanOrEqual(
    assistantLayout.viewportHeight,
  );
  expect(assistantLayout.messagesHeight).toBeGreaterThanOrEqual(240);
  expect(assistantLayout.messagesHeight).toBeGreaterThan(
    assistantLayout.composerHeight * 2,
  );
  const messages = assistant.getByLabel("助手消息列表");
  await messages.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        element.scrollTop = element.scrollHeight;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await messages.evaluate((element) => {
    const streamed = document.createElement("div");
    streamed.dataset.assistantStreamTest = "true";
    streamed.style.height = "1600px";
    streamed.style.flex = "none";
    element.appendChild(streamed);
  });
  await expect
    .poll(() =>
      messages.evaluate(
        (element) =>
          element.scrollHeight - element.scrollTop - element.clientHeight,
      ),
    )
    .toBeLessThanOrEqual(2);
  await messages.evaluate((element) => {
    element
      .querySelector<HTMLElement>('[data-assistant-stream-test="true"]')
      ?.remove();
  });

  await assistant.getByRole("button", { name: "关闭智能助手" }).click();
  await expect(assistant).toHaveCount(0);
});

test("助手长对话独立滚动且输入框固定在右侧底部", async () => {
  await openProjectCreation();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1080, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "打开智能助手面板" }).click();
    const assistant = page.locator('[aria-label="尽意智能助手"]');
    const messages = assistant.getByLabel("助手消息列表");
    const composer = assistant.getByRole("textbox", {
      name: "给 AI 办事助手发消息",
    });
    await composer.fill("滚动时保留的输入草稿");
    const composerBefore = await composer.boundingBox();
    expect(composerBefore).not.toBeNull();

    await page.locator("main").evaluate((element) => {
      element.scrollTop = 120;
    });
    const mainScrollTop = await page
      .locator("main")
      .evaluate((element) => element.scrollTop);

    // Long rendered messages exercise layout without submitting an AI request.
    await messages.evaluate((element) => {
      const transcript = document.createElement("div");
      for (let index = 0; index < 40; index += 1) {
        const paragraph = document.createElement("p");
        paragraph.textContent = `第 ${index + 1} 段对话：给小说起名时，可以围绕人物的目标、故事发生的地点和核心冲突展开。`;
        transcript.appendChild(paragraph);
      }
      element.appendChild(transcript);
    });
    await expect
      .poll(() =>
        messages.evaluate(
          (element) => element.scrollHeight - element.clientHeight,
        ),
      )
      .toBeGreaterThan(500);

    for (const edge of ["top", "bottom"] as const) {
      await messages.evaluate((element, edge) => {
        element.scrollTop = edge === "top" ? 0 : element.scrollHeight;
      }, edge);
      await messages.hover();
      await page.mouse.wheel(0, edge === "top" ? -600 : 600);
      await page.waitForTimeout(150);

      expect(await composer.boundingBox()).toEqual(composerBefore);
      await expect(composer).toHaveValue("滚动时保留的输入草稿");
      expect(composerBefore!.y + composerBefore!.height).toBeLessThan(
        viewport.height,
      );
      expect(
        await assistant.evaluate(
          (element) => element.getBoundingClientRect().bottom,
        ),
      ).toBeLessThanOrEqual(viewport.height);
      expect(
        await page.evaluate(() => ({
          windowScrollY: window.scrollY,
          documentHeight: document.documentElement.scrollHeight,
          mainScrollTop: document.querySelector("main")?.scrollTop,
        })),
      ).toEqual({
        windowScrollY: 0,
        documentHeight: viewport.height,
        mainScrollTop,
      });
    }

    await messages.evaluate((element) => {
      element.scrollTop = 0;
    });
    await messages.hover();
    await page.mouse.wheel(0, 300);
    await expect
      .poll(() => messages.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect(await composer.boundingBox()).toEqual(composerBefore);
    if (viewport.width >= 1280) {
      await page.locator("main").hover();
      await page.mouse.wheel(0, 300);
      await expect
        .poll(() =>
          page.locator("main").evaluate((element) => element.scrollTop),
        )
        .toBeGreaterThan(mainScrollTop);
      expect(await composer.boundingBox()).toEqual(composerBefore);
    }
    await assistant.getByRole("button", { name: "关闭智能助手" }).click();
  }
  await page.setViewportSize({ width: 1440, height: 920 });
});

test("先选三种素材，再确认小说或剧本目标；其他模板默认折叠", async () => {
  await openProjectCreation();
  for (const name of ["导入小说或大纲", "从创意开始", "导入已有剧本"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /系列长篇/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /博主内容工作室/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "从创意开始", exact: true }).click();
  await expect(page.getByRole("button", { name: /系列长篇/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /单季短剧/ })).toContainText(
    "支持漫剧 / 真人短剧",
  );
  await expect(page.getByRole("button", { name: /我的AI小剧场/ })).toBeHidden();
  await expect(
    page.getByRole("button", { name: /博主内容工作室/ }),
  ).toBeHidden();
  await page.getByText("其他创作模板", { exact: true }).click();
  await expect(
    page.getByRole("button", { name: /我的AI小剧场/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /博主内容工作室/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /博主内容工作室/ }).click();
  await expect(
    page.getByRole("heading", { name: "填写名称并创建" }),
  ).toBeVisible();
  await expect(page.getByText(/还没有想好项目名称/)).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "灵感空间" }),
  ).toHaveAttribute("href", "#/inspiration");
  await page.getByRole("button", { name: "打开智能助手获取灵感" }).click();
  const assistant = page.getByRole("complementary", {
    name: "尽意智能助手",
  });
  await expect(
    assistant.getByText("AI 办事助手", { exact: true }),
  ).toBeVisible();
  await assistant.getByRole("button", { name: "关闭智能助手" }).click();
  await expect(
    page.getByRole("heading", { name: "你希望先完成什么？" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "更换素材" }).click();
});

test("系列长篇把用户修改后的章节、季和每季集数持久化", async () => {
  await openProjectCreation();
  await page.getByRole("button", { name: "从创意开始" }).click();
  await page.getByRole("button", { name: /系列长篇/ }).click();
  const titleInput = page.getByLabel("项目名称");
  const genreSelect = page.getByRole("combobox", {
    name: "题材方向（可选）",
  });
  const [titleTop, genreTop] = await Promise.all([
    titleInput.evaluate((element) => element.getBoundingClientRect().top),
    genreSelect.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  expect(Math.abs(titleTop - genreTop)).toBeLessThanOrEqual(1);
  await genreSelect.click();
  await expect(page.getByText("都市与现实", { exact: true })).toBeVisible();
  await expect(page.getByText("幻想与科幻", { exact: true })).toBeVisible();
  await page.getByRole("option", { name: "女频复仇" }).click();
  await titleInput.fill("六季长篇持久化验证");
  await page.getByRole("button", { name: /展开受众、平台与视觉设置/ }).click();
  await page.getByLabel("母本章节数").fill("360");
  await page.getByLabel("计划季数").fill("6");
  await page.getByLabel("每季集数").fill("72");
  await page.getByRole("button", { name: "创建系列长篇" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const projectId = page.url().split("/").at(-1)!;
  const project = await runtimeJson<{
    modeConfig: Record<string, unknown>;
    productionBrief?: string;
    shortDramaType?: string;
  }>(`/api/v2/projects/${projectId}`);
  expect(project.modeConfig).toEqual({
    mode: "series_longform",
    targetChapterCount: 360,
    targetSeasonCount: 6,
    targetEpisodesPerSeason: 72,
  });
  expect(project.shortDramaType).toBe("女频复仇");
  expect(project.productionBrief).toContain("母本章节：360 章");
  expect(project.productionBrief).not.toContain("计划集数：80 集");
});

test("单季短剧从创意直接进入空剧本创作，不制造母稿、人物或已采用季纲", async () => {
  await openProjectCreation();
  await page.getByRole("button", { name: "从创意开始" }).click();
  await page.getByRole("button", { name: /单季短剧/ }).click();
  await page.getByLabel("项目名称").fill("单季初始化验收");
  await page
    .getByLabel("故事构思（可选）")
    .fill("雨夜的一封匿名信牵出旧案。\n");
  await page.getByRole("button", { name: "创建单季短剧" }).click();

  await expect(page).toHaveURL(/\/adapt\?/);
  await expect(
    page.getByRole("heading", { name: "从创意到分集剧本", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成并检查本集剧本", exact: true }),
  ).toBeVisible();
  const params = new URLSearchParams(page.url().split("?")[1]);
  const projectId = params.get("projectId")!;
  const [project, chapters, characters, adaptations, episodes, scripts] =
    await Promise.all([
      runtimeJson<{
        currentAdaptationId?: string;
        modeConfig: { entryPath: string };
        synopsis: string;
      }>(`/api/v2/projects/${projectId}`),
      runtimeJson<Array<{ title: string }>>(
        `/api/v2/projects/${projectId}/chapters`,
      ),
      runtimeJson<Array<{ title: string }>>(
        `/api/v2/characters?projectId=${projectId}`,
      ),
      runtimeJson<Array<{ id: string; title: string }>>(
        `/api/v2/adaptations?projectId=${projectId}`,
      ),
      runtimeJson<Array<{ parentId?: string; title: string }>>(
        `/api/v2/episodes?projectId=${projectId}`,
      ),
      runtimeJson<
        Array<{ id: string; parentId: string; payload: { 剧本内容: string } }>
      >(`/api/v2/scripts?projectId=${projectId}`),
    ]);
  expect(chapters).toEqual([]);
  expect(characters).toEqual([]);
  expect(adaptations).toEqual([
    expect.objectContaining({ title: "原创剧本·分集目录" }),
  ]);
  expect(episodes).toEqual([
    expect.objectContaining({
      title: "第 1 集",
      parentId: adaptations[0]!.id,
    }),
  ]);
  expect(project.currentAdaptationId).toBe(adaptations[0]!.id);
  expect(project.modeConfig.entryPath).toBe("inspiration");
  expect(project.synopsis).toBe("雨夜的一封匿名信牵出旧案。");
  expect(scripts).toHaveLength(1);
  expect(scripts[0]!.payload.剧本内容).toBe("");
  expect(scripts[0]!.parentId).toBe(params.get("episodeId"));
  expect(scripts[0]!.id).toBe(params.get("scriptId"));
});

test("项目外导入预览不创建项目，确认后才创建并导入", async () => {
  await openProjectCreation();
  const before = await runtimeJson<Array<{ id: string }>>("/api/v2/projects");
  await page.getByRole("button", { name: "导入小说或大纲" }).click();
  await page.getByRole("button", { name: /单季短剧/ }).click();
  await page.getByRole("button", { name: "选择文件" }).click();
  await expect(
    page.getByText("source-import.md", { exact: true }),
  ).toBeVisible();
  const afterPreview =
    await runtimeJson<Array<{ id: string }>>("/api/v2/projects");
  expect(afterPreview).toHaveLength(before.length);
  await page
    .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
    .check();
  await page.getByRole("button", { name: "创建单季短剧" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const afterCommit =
    await runtimeJson<Array<{ id: string }>>("/api/v2/projects");
  expect(afterCommit).toHaveLength(before.length + 1);
  const projectId = page.url().split("/").at(-1)!;
  const chapters = await runtimeJson<Array<{ title: string }>>(
    `/api/v2/projects/${projectId}/chapters`,
  );
  expect(chapters.map((chapter) => chapter.title)).toEqual([
    "第一章 雨夜来信",
    "第二章 失联电话",
    "单季故事母稿",
  ]);
});

test("TXT、Markdown、DOCX、EPUB 和剧本 JSON 均可在项目外真实预览并取消", async () => {
  for (const fixture of importFixtures) {
    await application.evaluate((_, filePath) => {
      process.env.DRAMAIP_E2E_SOURCE_IMPORT_FILE = filePath;
    }, fixture.path);
    await page.reload();
    await openProjectCreation();
    const clearDraft = page.getByRole("button", {
      name: "清空",
      exact: true,
    });
    if (await clearDraft.isVisible().catch(() => false))
      await clearDraft.click();
    const before = await runtimeJson<Array<{ id: string }>>("/api/v2/projects");
    await page
      .getByRole("button", {
        name: fixture.script ? "导入已有剧本" : "导入小说或大纲",
      })
      .click();
    await page.getByRole("button", { name: /单季短剧/ }).click();
    await page.getByRole("button", { name: "选择文件" }).click();
    await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
    const afterPreview =
      await runtimeJson<Array<{ id: string }>>("/api/v2/projects");
    expect(afterPreview, fixture.name).toHaveLength(before.length);

    await page.getByRole("button", { name: "更换素材" }).click();
    await page.getByRole("button", { name: /从创意开始/ }).click();
    await page.getByRole("button", { name: /单季短剧/ }).click();
    await expect(page.getByText(fixture.name, { exact: true })).toHaveCount(0);
    const afterCancel =
      await runtimeJson<Array<{ id: string }>>("/api/v2/projects");
    expect(afterCancel, fixture.name).toHaveLength(before.length);
    await page.getByRole("button", { name: "清空", exact: true }).click();
  }
});

test("只填作品名即可创建小说、首章并进入写作", async () => {
  await page.evaluate(() => {
    window.location.hash = "#/write/new";
  });
  await expect(
    page.getByRole("heading", { name: "创建小说项目" }),
  ).toBeVisible();
  const startNewSeries = page.getByRole("button", {
    name: "开始新的系列长篇",
  });
  if (await startNewSeries.isVisible().catch(() => false))
    await startNewSeries.click();
  await page.getByRole("textbox", { name: "作品名称" }).fill("端到端空白小说");
  await page.getByRole("button", { name: "创建并进入 AI 工作台" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: "端到端空白小说" }),
  ).toBeVisible();
  const directory = page.getByRole("button", { name: "章节目录", exact: true });
  if ((await directory.getAttribute("aria-expanded")) !== "true")
    await directory.click();
  await expect(
    page.getByText("第 1 章", { exact: true }).first(),
  ).toBeVisible();
  const contextPanel = page.locator('aside[aria-label="章节辅助栏"]');
  await expect(contextPanel).toBeVisible();
  await expect(
    contextPanel.getByRole("button", { name: "生成并检查本章正文" }),
  ).toBeVisible();
  await expect(
    contextPanel.getByRole("button", { name: "续写本章" }),
  ).toBeDisabled();
  await expect(page.getByLabel("项目辅助区")).toHaveCount(0);
});

test("快捷入口选择末世囤货后初始化首章、人物、大纲和故事弧", async () => {
  await page.evaluate(() => {
    window.location.hash = "#/write/new";
  });
  await expect(
    page.getByRole("heading", { name: "创建小说项目" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "作品名称" }).fill("末日早餐店");
  await page
    .getByRole("textbox", { name: "一句话灵感" })
    .fill("主角必须先救下经营早餐店的邻居。");
  await page
    .getByLabel("完整故事预设")
    .getByRole("button", { name: /末世囤货/ })
    .click();
  await expect(page.getByText("将创建：末世囤货完整骨架")).toBeVisible();
  await page.getByRole("button", { name: "创建并进入 AI 工作台" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const guide = page.getByLabel("继续完善预设");
  await expect(guide.getByText("继续完善“末世囤货”预设")).toBeVisible();
  await page.getByRole("button", { name: "章节要点", exact: true }).click();
  const chapterDetails = page.getByRole("dialog", {
    name: "章节要点",
  });
  await expect(chapterDetails.getByLabel("章节摘要")).toHaveValue(/倒计时/);
  await expect(chapterDetails.getByLabel("核心冲突")).not.toHaveValue("");
  await expect(chapterDetails.getByLabel("开场钩子")).not.toHaveValue("");
  await expect(chapterDetails.getByLabel("结尾悬念")).not.toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(chapterDetails).toBeHidden();

  await guide.getByRole("button", { name: "人物", exact: true }).click();
  await expect(page.getByText("预警者槽位（待命名）")).toBeVisible();
  await guide.getByRole("button", { name: "全书大纲", exact: true }).click();
  await expect(page.getByText("末世囤货·全书骨架")).toBeVisible();
  await guide.getByRole("button", { name: "故事弧", exact: true }).click();
  await expect(page.getByText("第一阶段·灾前倒计时")).toBeVisible();
});

test("完整向导创建嘉豪预设并提供四个分区的可确认 AI 润色入口", async () => {
  await openProjectCreation();
  await page.getByRole("button", { name: "从创意开始" }).click();
  await page.getByRole("button", { name: /系列长篇/ }).click();
  await page.getByLabel("项目名称").fill("普通人的主角镜头");
  await page
    .getByLabel("完整故事预设")
    .getByRole("button", { name: /嘉豪/ })
    .click();
  await page.getByRole("button", { name: "创建系列长篇" }).click();

  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  const guide = page.getByLabel("继续完善预设");
  await expect(guide.getByText("继续完善“嘉豪”预设")).toBeVisible();

  await guide.getByRole("button", { name: "项目设定", exact: true }).click();
  const projectGenerator = page.getByRole("button", {
    name: /智能补全项目设定/,
  });
  await expect(projectGenerator).toBeVisible();
  await projectGenerator.click();
  await expect(
    page.getByPlaceholder("补充你的想法或要求；留空也可以直接生成。"),
  ).toHaveValue(/保留用户灵感和“嘉豪”预设/);

  await guide.getByRole("button", { name: "人物", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "生成并检查人物方案" }),
  ).toBeVisible();
  await guide.getByRole("button", { name: "全书大纲", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "生成并检查全书大纲" }),
  ).toBeVisible();
  await guide.getByRole("button", { name: "故事弧", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "生成并检查卷与单元方案" }),
  ).toBeVisible();
});

test("小说默认 AI 工作台且窄屏辅助栏无溢出", async () => {
  if (!(await page.getByLabel("小说创作入口").isVisible())) {
    await page.evaluate(() => {
      window.location.hash = "#/";
    });
    await page.getByRole("button", { name: "先看看示例" }).click();
    await page
      .getByRole("link", { name: /示例短剧：雨夜归来/ })
      .first()
      .click();
  }
  const novelNavigation = page.getByLabel("小说创作入口");
  for (const label of ["正文", "大纲", "人物", "设定", "故事圣经"])
    await expect(
      novelNavigation.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    novelNavigation.getByRole("button", {
      name: "长篇工具",
      exact: true,
    }),
  ).toBeVisible();
  await novelNavigation
    .getByRole("button", { name: "正文", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "章节正文编辑器" }),
  ).toBeVisible();
  const panel = page.locator('aside[aria-label="章节辅助栏"]');
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("AI 本章正文")).toBeVisible();
  await expect(panel.getByLabel("AI 创作要求")).toBeVisible();
  await panel.getByRole("button", { name: "资料", exact: true }).click();
  await expect(panel.getByLabel("Story Bible 侧栏")).toBeVisible();
  await panel.getByRole("button", { name: "AI 创作", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "章节正文编辑器" });
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await panel
    .getByLabel("AI 创作要求")
    .fill("承接上章结尾，突出林夏的动机，保持第三人称。");
  await expect(
    panel.getByRole("button", { name: "生成并检查本章正文" }),
  ).toBeVisible();
  const [editorBox, panelBox] = await Promise.all([
    editor.boundingBox(),
    panel.boundingBox(),
  ]);
  expect(panelBox!.width).toBeGreaterThanOrEqual(360);
  expect(editorBox!.x + editorBox!.width).toBeLessThanOrEqual(panelBox!.x);

  await page.setViewportSize({ width: 1080, height: 700 });
  await page.getByRole("button", { name: "智能写作", exact: true }).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "关闭章节辅助栏" }).click();
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

  await novelNavigation
    .getByRole("button", { name: "长篇工具", exact: true })
    .click();
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
    page.getByRole("button", { name: "本地规则检查", exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "项目工具", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目工具", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("推荐下一步", { exact: true })).toBeVisible();
  await expect(page.getByLabel("项目辅助区")).toHaveCount(0);
});

test("模型服务商置顶、模型级联并通过独立安全窗口采集密钥", async () => {
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
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "保存时在独立安全窗口输入密钥",
      exact: true,
    }),
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
  const captureWindowPromise = application.waitForEvent("window");
  await page.getByRole("button", { name: "添加模型服务商" }).click();
  const captureWindow = await captureWindowPromise;
  await captureWindow.waitForLoadState("domcontentloaded");
  await captureWindow
    .getByRole("textbox", { name: "安全凭据", exact: true })
    .fill("仅用于端到端测试的临时密钥");
  await Promise.all([
    captureWindow.waitForEvent("close"),
    captureWindow
      .getByRole("button", { name: "安全保存", exact: true })
      .click(),
  ]);
  await expect(
    page.getByText("已保存 DeepSeek", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("deepseek-v4-flash", { exact: true }),
  ).toBeVisible();

  const deepseekProvider = page.getByLabel("模型服务商 DeepSeek", {
    exact: true,
  });
  const savedProvider = (
    await runtimeJson<
      Array<{
        id: string;
        title: string;
        version: number;
        payload: Record<string, unknown>;
      }>
    >("/api/v2/providers")
  ).find((provider) => provider.title === "DeepSeek");
  expect(savedProvider).toBeDefined();
  expect(savedProvider!.payload["凭据引用"]).toEqual(expect.any(String));
  expect(savedProvider!.payload["凭据引用"]).not.toBe("");
  await deepseekProvider
    .getByRole("button", { name: "编辑配置", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "正在编辑 DeepSeek" }),
  ).toBeVisible();
  await expect(providerSelect).toBeFocused();
  await expect(providerSelect).toHaveValue("deepseek");
  await expect(modelSelect).toHaveValue("deepseek-v4-flash");
  await expect(
    page.getByRole("button", {
      name: "继续使用已保存密钥（点击以更换）",
      exact: true,
    }),
  ).toBeVisible();
  await modelSelect.selectOption("deepseek-v4-pro");
  await expect(providerSelect).toHaveValue("deepseek");
  await expect(modelSelect).toHaveValue("deepseek-v4-pro");
  await page
    .getByRole("button", { name: "保存服务商修改", exact: true })
    .click();
  await expect(
    deepseekProvider.getByText("deepseek-v4-pro", { exact: true }),
  ).toBeVisible();
  const updatedProvider = await runtimeJson<{
    version: number;
    payload: Record<string, unknown>;
  }>(`/api/v2/providers/${savedProvider!.id}`);
  expect(updatedProvider.version).toBe(savedProvider!.version + 1);
  expect(updatedProvider.payload["模型名称"]).toBe("deepseek-v4-pro");
  expect(updatedProvider.payload["凭据引用"]).toBe(
    savedProvider!.payload["凭据引用"],
  );

  const codexProviderSelect = page.getByRole("combobox", {
    name: "Codex 模型服务商",
    exact: true,
  });
  const deepseekCodexOption = codexProviderSelect
    .locator("option")
    .filter({ hasText: "DeepSeek" });
  const deepseekProviderId = await deepseekCodexOption.getAttribute("value");
  expect(deepseekProviderId).toBeTruthy();
  await codexProviderSelect.selectOption(deepseekProviderId!);

  const codexProtocolSelect = page.getByRole("combobox", {
    name: "Codex 连接协议",
    exact: true,
  });
  await expect(codexProtocolSelect).toHaveValue("chat_completions");
  await codexProtocolSelect.selectOption("responses");
  await page.waitForTimeout(100);
  await expect(codexProtocolSelect).toHaveValue("responses");
});
