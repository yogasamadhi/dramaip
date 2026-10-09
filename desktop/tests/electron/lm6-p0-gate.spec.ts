import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { openProjectTool } from "./project-tools";

type EntryPath = "inspiration" | "source-import" | "script-paste";

type RunningApp = {
  application: ElectronApplication;
  page: Page;
};

const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
const sourceFixture = resolve("tests/fixtures/lm6/lm6-00/source-import.md");

async function launch(
  userData: string,
  sourceFile = sourceFixture,
): Promise<RunningApp> {
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: {
      ...process.env,
      DRAMAIP_E2E_USER_DATA: userData,
      DRAMAIP_E2E_SOURCE_IMPORT_FILE: sourceFile,
    },
  });
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1280, height: 720 });
  return { application, page };
}

async function selectByKeyboard(page: Page, name: string): Promise<void> {
  const entry = page.getByRole("button", { name });
  await entry.focus();
  await expect(entry).toBeFocused();
  await page.keyboard.press("Enter");
}

async function createPilotFromEntry(
  page: Page,
  entry: EntryPath,
  title: string,
): Promise<void> {
  if (entry === "inspiration") {
    await selectByKeyboard(page, "从创意开始");
    await selectByKeyboard(page, "写小说 · 系列长篇");
    await page.getByRole("textbox", { name: "项目名称" }).fill(title);
    await page.getByRole("button", { name: "创建系列长篇" }).click();
  } else if (entry === "source-import") {
    await selectByKeyboard(page, "导入小说或大纲");
    await selectByKeyboard(page, "开发剧本 · 单季短剧");
    await page.getByRole("textbox", { name: "项目名称" }).fill(title);
    await page.getByRole("button", { name: "选择文件" }).click();
    await page
      .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
      .check();
    await page.getByRole("button", { name: "创建单季短剧并导入" }).click();
  } else {
    await selectByKeyboard(page, "导入已有剧本");
    await selectByKeyboard(page, "开发剧本 · 单季短剧");
    await page.getByRole("textbox", { name: "项目名称" }).fill(title);
    await page
      .getByRole("textbox", { name: "已有剧本内容" })
      .fill("【雨夜·门口】\\n林晚：你终于来了。");
    await page
      .getByLabel("我确认拥有此剧本的使用权，或已经取得必要授权。")
      .check();
    await page.getByRole("button", { name: "创建单季短剧" }).click();
    await expect(
      page.getByRole("heading", { name: "剧本审查", exact: true }),
    ).toBeVisible();
    return;
  }

  await openProjectTool(page, "试制计划");
  const pilotWizard = page.getByLabel("试制向导");
  await expect(pilotWizard).toBeVisible();
  await expect(
    pilotWizard.locator('input[type="checkbox"]:checked'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "建立试制计划" }).click();
  await page.getByRole("button", { name: "确认来源并生成首集" }).click();
  await expect(
    page.getByText("当前阶段：采用试制剧本", { exact: true }),
  ).toBeVisible();
}

for (const [entry, title] of [
  ["inspiration", "P0 灵感重开项目"],
  ["source-import", "P0 原著重开项目"],
  ["script-paste", "P0 剧本重开项目"],
] as const satisfies ReadonlyArray<[EntryPath, string]>) {
  test(`${entry} 在 fresh profile ${entry === "script-paste" ? "直达剧本检查" : "建立试制计划"}并于重开后恢复`, async () => {
    const userData = await mkdtemp(join(tmpdir(), `dramaip-p0-${entry}-`));
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await createPilotFromEntry(running.page, entry, title);
      await running.application.close();

      running = await launch(userData);
      await expect(
        running.page.getByRole("button", { name: `当前项目：${title}` }),
      ).toBeVisible();
      await expect(
        running.page.getByRole("link", { name: title }),
      ).toBeVisible();
      await running.page.getByRole("link", { name: title }).click();
      if (entry === "script-paste") {
        await expect(
          running.page.getByRole("heading", { name: "剧本审查", exact: true }),
        ).toBeVisible();
        await expect(
          running.page.getByRole("button", { name: "章节目录", exact: true }),
        ).toHaveCount(0);
      } else {
        await openProjectTool(running.page, "试制计划");
        await expect(running.page.getByLabel("试制向导")).toBeVisible();
        await expect(
          running.page.getByText("当前阶段：采用试制剧本", { exact: true }),
        ).toBeVisible();
      }
    } finally {
      await running?.application.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

test("统一创作草稿经过灵感空间、设置页和应用重启后仍可恢复并明确清空", async () => {
  const userData = await mkdtemp(join(tmpdir(), "dramaip-p0-draft-"));
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await selectByKeyboard(running.page, "从创意开始");
    await selectByKeyboard(running.page, "写小说 · 系列长篇");
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("跨重启从零创作草稿");
    await running.page
      .getByRole("textbox", { name: "故事构思（可选）" })
      .fill("一座城市每天都会集体忘记一件小事。");

    await running.page.evaluate(() => {
      window.location.hash = "#/inspiration";
    });
    await running.page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await expect(
      running.page.getByRole("heading", { name: "灵感空间" }),
    ).toBeVisible();
    await running.page.evaluate(() => {
      window.location.hash = "#/settings";
    });
    await expect(
      running.page.getByRole("heading", { name: "设置中心" }),
    ).toBeVisible();
    await running.application.close();

    running = await launch(userData);
    await running.page.evaluate(() => {
      window.location.hash = "#/";
    });
    await expect(
      running.page.getByRole("textbox", { name: "项目名称" }),
    ).toHaveValue("跨重启从零创作草稿");
    await expect(
      running.page.getByRole("textbox", { name: "故事构思（可选）" }),
    ).toHaveValue("一座城市每天都会集体忘记一件小事。");
    await running.page
      .getByRole("button", { name: "清空", exact: true })
      .click();
    await expect(
      running.page.getByRole("heading", { name: "你现在手中有什么素材？" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        running!.page.evaluate(() =>
          window.localStorage.getItem("dramaip-creation-draft:v1"),
        ),
      )
      .toBeNull();
  } finally {
    await running?.application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("坏文件在本地预览阶段被拒绝，未伪造导入结果", async () => {
  const userData = await mkdtemp(join(tmpdir(), "dramaip-p0-bad-source-"));
  let running: RunningApp | undefined;
  try {
    running = await launch(
      userData,
      resolve("tests/fixtures/lm6/lm6-06/unsupported.source"),
    );
    await selectByKeyboard(running.page, "导入小说或大纲");
    await selectByKeyboard(running.page, "开发剧本 · 单季短剧");
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("P0 坏文件项目");
    await running.page.getByRole("button", { name: "选择文件" }).click();
    await expect(
      running.page.getByText("请求参数无效，请检查后重试"),
    ).toBeVisible();
    await expect(running.page.getByText("先选择文件并确认预览")).toBeVisible();
  } finally {
    await running?.application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

test("已有小说选择继续写作：保留两章原稿、末章位置，独立导出且不创建改编或媒体", async () => {
  const userData = await mkdtemp(join(tmpdir(), "dramaip-p0-novel-import-"));
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await selectByKeyboard(running.page, "导入小说或大纲");
    await selectByKeyboard(running.page, "写小说 · 系列长篇");
    await running.page
      .getByRole("textbox", { name: "项目名称" })
      .fill("继续写我的小说");
    await running.page.getByRole("button", { name: "选择文件" }).click();
    await running.page
      .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
      .check();
    await running.page
      .getByRole("button", { name: "创建系列长篇并导入", exact: true })
      .click();
    await expect(running.page).toHaveURL(/\/projects\/[^/]+$/);
    const projectId = running.page.url().split("/").at(-1)!;
    const bootstrap = await running.page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const get = async <T>(path: string): Promise<T> => {
      const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
        headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
      });
      expect(response.ok).toBe(true);
      return (await response.json()) as T;
    };
    expect(await get(`projects/${projectId}`)).toMatchObject({
      mode: "series_longform",
    });
    const chapters = await get<
      Array<{ id: string; title: string; content: string }>
    >(`projects/${projectId}/chapters`);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 雨夜来信",
      "第二章 失联电话",
    ]);
    await expect(
      running.page.getByRole("textbox", {
        name: "章节正文编辑器",
        exact: true,
      }),
    ).toContainText(chapters[1]!.content);
    for (const kind of [
      "adaptations",
      "episodes",
      "scripts",
      "scenes",
      "shots",
      "visual-assets",
    ])
      expect(await get(`${kind}?projectId=${projectId}`)).toEqual([]);

    await openProjectTool(running.page, "项目驾驶舱");
    const cockpit = running.page.getByLabel("项目驾驶舱", { exact: true });
    await expect(
      cockpit.getByRole("link", { name: "继续 AI 创作", exact: true }),
    ).toBeVisible();
    await expect(
      cockpit.getByLabel("正文与章节采用", { exact: true }),
    ).toContainText("作者稿已保存");
    await expect(cockpit.locator("dt")).toHaveText([
      "章节",
      "已保存正文",
      "当前版本 AI 采用",
      "当前版本事实记忆",
    ]);
    await expect(
      cockpit.getByLabel("稿件与投稿导出", { exact: true }),
    ).toHaveAttribute("data-gate-status", "unverified");
    await expect(
      cockpit.getByRole("link", { name: "制作", exact: true }),
    ).toBeHidden();
    await expect(cockpit).not.toContainText("0%");
    await cockpit
      .getByRole("link", { name: "继续 AI 创作", exact: true })
      .click();
    const savedPath = join(userData, "novel-export.md");
    // Only the native save-location picker is controlled. Export generation,
    // Runtime/Host requests and the actual file write remain real.
    await running.application.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, savedPath);
    await running.page
      .getByRole("button", { name: "输入输出", exact: true })
      .click();
    await running.page
      .getByRole("menuitem", { name: "导出完整小说文档", exact: true })
      .click();
    await expect(
      running.page.getByText("项目已导出。", { exact: true }),
    ).toBeVisible();
    const exported = await readFile(savedPath, "utf8");
    for (const chapter of chapters) expect(exported).toContain(chapter.content);
    expect(exported).not.toContain("单季故事母稿");
    await running.application.close();
    running = await launch(userData);
    await running.page.getByRole("link", { name: "继续写我的小说" }).click();
    await expect(
      running.page.getByRole("textbox", {
        name: "章节正文编辑器",
        exact: true,
      }),
    ).toContainText(chapters[1]!.content);
  } finally {
    await running?.application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

for (const [source, goal] of [
  ["从创意开始", "开发剧本 · 单季短剧"],
  ["导入小说或大纲", "写小说 · 系列长篇"],
  ["导入已有剧本", "开发剧本 · 单季短剧"],
] as const) {
  test(`${source} 重启后仍需确认目标，并保留明确选择的目标`, async () => {
    const userData = await mkdtemp(join(tmpdir(), "dramaip-p0-intake-goal-"));
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await selectByKeyboard(running.page, source);
      await expect(
        running.page.getByRole("heading", { name: "你希望先完成什么？" }),
      ).toBeVisible();
      await running.application.close();

      running = await launch(userData);
      await expect(
        running.page.getByText(source, { exact: true }),
      ).toBeVisible();
      await expect(
        running.page.getByRole("heading", { name: "你希望先完成什么？" }),
      ).toBeVisible();
      await expect(
        running.page.getByRole("textbox", { name: "项目名称" }),
      ).toHaveCount(0);
      if (source === "导入已有剧本") {
        await expect(
          running.page.getByRole("button", {
            name: "写小说 · 系列长篇",
            exact: true,
          }),
        ).toHaveCount(0);
      }
      await selectByKeyboard(running.page, goal);
      await running.page
        .getByRole("textbox", { name: "项目名称" })
        .fill("保留我的创作目标");
      await running.application.close();

      running = await launch(userData);
      await expect(running.page.getByText(goal, { exact: true })).toBeVisible();
      await expect(
        running.page.getByRole("textbox", { name: "项目名称" }),
      ).toHaveValue("保留我的创作目标");
      const create = running.page.getByRole("button", {
        name: `${goal.startsWith("写小说") ? "创建系列长篇" : "创建单季短剧"}${source === "导入小说或大纲" ? "并导入" : ""}`,
        exact: true,
      });
      await expect(create).toBeVisible();
      if (source === "导入小说或大纲") await expect(create).toBeDisabled();
    } finally {
      await running?.application.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

test("创意直接开发剧本：保存真实构思与空草稿、恢复创作要求，不要求小说或媒体", async () => {
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-original-script-entry-"),
  );
  const title = "创意直写末班渡船";
  const idea = "阿禾在末班渡船上等待失联的姐姐。";
  const instruction = "第一集只写渡口等待的冲突，不揭示姐姐下落。";
  let running: RunningApp | undefined;
  try {
    running = await launch(userData);
    await selectByKeyboard(running.page, "从创意开始");
    await selectByKeyboard(running.page, "开发剧本 · 单季短剧");
    await running.page.getByRole("textbox", { name: "项目名称" }).fill(title);
    await running.page.getByLabel("故事构思（可选）").fill(idea);
    await running.page
      .getByRole("button", { name: "创建单季短剧", exact: true })
      .click();
    await expect(
      running.page.getByRole("heading", {
        name: "从创意到分集剧本",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      running.page.getByRole("button", {
        name: "生成并检查本集剧本",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      running.page.getByText("剧本正文尚未创作。", { exact: false }),
    ).toBeVisible();
    await expect(
      running.page.getByRole("combobox", { name: "项目", exact: true }),
    ).toBeHidden();
    await expect(
      running.page.getByRole("button", { name: "章节目录", exact: true }),
    ).toHaveCount(0);
    const search = new URLSearchParams(running.page.url().split("?")[1]);
    const projectId = search.get("projectId")!;
    const scriptId = search.get("scriptId")!;
    const bootstrap = await running.page.evaluate(() =>
      window.runtimeBootstrap.resolve(),
    );
    const get = async (path: string) => {
      const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
        headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
      });
      expect(response.ok).toBe(true);
      return response.json();
    };
    const project = await get(`projects/${projectId}`);
    expect(project.modeConfig).toMatchObject({
      mode: "single_season",
      entryPath: "inspiration",
    });
    expect(project.synopsis).toBe(idea);
    for (const domain of [
      "characters",
      "outlines",
      "scenes",
      "shots",
      "visual-assets",
    ])
      expect(await get(`${domain}?projectId=${projectId}`)).toEqual([]);
    expect(await get(`projects/${projectId}/chapters`)).toEqual([]);
    const scripts = await get(`scripts?projectId=${projectId}`);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({
      id: scriptId,
      parentId: search.get("episodeId"),
      payload: { 剧本内容: "", 来源类型: "原创开发" },
    });
    expect(await get(`scripts/${scriptId}/screenplay`)).toMatchObject({
      blocks: [],
    });
    const originalAdaptation = await get(
      `adaptations/${search.get("adaptationId")}`,
    );
    expect(originalAdaptation.title).toBe("原创剧本·分集目录");
    expect(originalAdaptation.payload.季纲).toBeUndefined();
    const goals = running.page.getByRole("textbox", {
      name: "AI 创作要求",
      exact: true,
    });
    await goals.fill(instruction);
    // Fresh-profile intake must be recoverable with no external model call.
    await running.application.close();
    running = await launch(userData);
    await running.page.getByRole("link", { name: title }).click();
    await expect(
      running.page.getByRole("heading", {
        name: "从创意到分集剧本",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      running.page.getByRole("textbox", { name: "AI 创作要求", exact: true }),
    ).toHaveValue(instruction);
    const restoredSearch = new URLSearchParams(
      running.page.url().split("?")[1],
    );
    for (const key of ["projectId", "adaptationId", "episodeId", "scriptId"])
      expect(restoredSearch.get(key)).toBe(search.get(key));
    await running.page
      .getByRole("link", { name: "项目工具", exact: true })
      .click();
    await running.page
      .getByRole("navigation", { name: "项目工具导航" })
      .getByRole("link", { name: "项目驾驶舱", exact: true })
      .click();
    const next = running.page.getByRole("link", {
      name: "确认直写作者意图",
      exact: true,
    });
    await expect(next).toHaveAttribute(
      "href",
      `#/projects/${search.get("projectId")}/tools/author-intent`,
    );
    await running.page
      .getByRole("link", { name: "确认直写作者意图", exact: true })
      .click();
    await expect(
      running.page.getByLabel("正式作者意图工作台", { exact: true }),
    ).toBeVisible();
  } finally {
    await running?.application.close();
    await rm(userData, { recursive: true, force: true });
  }
});

for (const entry of ["paste", "json"] as const) {
  test(`已有剧本 ${entry}：直接检查、原文与稳定块恢复，不创建小说母稿或媒体`, async () => {
    const userData = await mkdtemp(
      join(tmpdir(), `dramaip-script-entry-${entry}-`),
    );
    const title = `直达剧本 ${entry}`;
    const screenplay =
      "EXT. 渡口 - NIGHT\n\n阿禾放下湿透的船票。\n\n@阿禾\n还要等一个人。";
    const sourceFile = resolve(
      "tests/fixtures/lm6/lm6-00/existing-script.json",
    );
    let running: RunningApp | undefined;
    try {
      running = await launch(userData, sourceFile);
      await selectByKeyboard(running.page, "导入已有剧本");
      await selectByKeyboard(running.page, "开发剧本 · 单季短剧");
      await running.page.getByRole("textbox", { name: "项目名称" }).fill(title);
      if (entry === "paste") {
        const input = running.page.getByRole("textbox", {
          name: "已有剧本内容",
        });
        await input.fill(screenplay);
        const create = running.page.getByRole("button", {
          name: "创建单季短剧",
          exact: true,
        });
        await expect(create).toBeDisabled();
        await running.page
          .getByLabel("我确认拥有此剧本的使用权，或已经取得必要授权。")
          .check();
        await running.page.reload();
        await expect(input).toHaveValue(screenplay);
        await expect(
          running.page.getByLabel(
            "我确认拥有此剧本的使用权，或已经取得必要授权。",
          ),
        ).not.toBeChecked();
        await expect(create).toBeDisabled();
        await running.page
          .getByLabel("我确认拥有此剧本的使用权，或已经取得必要授权。")
          .check();
        await create.click();
      } else {
        const intake = running.page.getByLabel("创建前原生剧本导入", {
          exact: true,
        });
        await running.page
          .getByRole("button", { name: "选择原生剧本文件", exact: true })
          .click();
        await expect(intake).toContainText("existing-script.json");
        await expect(
          intake.getByLabel("文件分集 1", { exact: true }),
        ).toBeVisible();
        await expect(
          intake.getByLabel("文件分集 2", { exact: true }),
        ).toBeVisible();
        const create = intake.getByRole("button", {
          name: "确认原生预览并创建剧本项目",
          exact: true,
        });
        await expect(create).toBeDisabled();
        await intake
          .getByLabel("我确认有权将此原稿导入新项目（声明不等于授权证明）。")
          .check();
        await intake
          .getByLabel("我已核对完整原稿块及格式损失，接受本次转换。")
          .check();
        await create.click();
      }
      await expect(
        running.page.getByRole("heading", { name: "剧本审查", exact: true }),
      ).toBeVisible();
      await expect(
        running.page.getByRole("combobox", { name: "项目", exact: true }),
      ).toBeHidden();
      await expect(
        running.page.getByRole("combobox", { name: "分集", exact: true }),
      ).toBeHidden();
      await expect(
        running.page.getByRole("button", { name: "章节目录", exact: true }),
      ).toHaveCount(0);
      const search = new URLSearchParams(running.page.url().split("?")[1]);
      const projectId = search.get("projectId")!;
      const scriptId = search.get("scriptId")!;
      expect(projectId).toBeTruthy();
      expect(scriptId).toBeTruthy();
      const bootstrap = await running.page.evaluate(() =>
        window.runtimeBootstrap.resolve(),
      );
      const get = async <T>(path: string): Promise<T> => {
        const response = await fetch(`${bootstrap.baseUrl}/api/v2/${path}`, {
          headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
        });
        expect(response.ok).toBe(true);
        return (await response.json()) as T;
      };
      for (const domain of ["characters", "outlines", "shots", "visual-assets"])
        expect(await get(`${domain}?projectId=${projectId}`)).toEqual([]);
      expect(await get(`projects/${projectId}/chapters`)).toEqual([]);
      const scripts = await get<
        Array<{ id: string; parentId: string; payload: { 剧本内容: string } }>
      >(`scripts?projectId=${projectId}`);
      expect(scripts).toHaveLength(entry === "paste" ? 1 : 2);
      const current = scripts.find((item) => item.id === scriptId)!;
      expect(current.parentId).toBe(search.get("episodeId"));
      expect(current.payload.剧本内容).toBe(
        entry === "paste"
          ? screenplay
          : JSON.parse(await readFile(sourceFile, "utf8")).episodes[0].content,
      );
      const document = await get<{
        blocks: Array<{ id: string; type: string; text?: string }>;
        version: number;
      }>(`scripts/${scriptId}/screenplay`);
      expect(document.blocks.map((block) => block.type)).toContain(
        "scene_heading",
      );
      expect(document.blocks.map((block) => block.type)).toContain("dialogue");
      expect(
        document.blocks.every((block) => /^[0-9a-f-]{36}$/.test(block.id)),
      ).toBe(true);
      const fountain = await get<{ content: string }>(
        `scripts/${scriptId}/screenplay/export/fountain`,
      );
      expect(fountain.content).toContain("阿禾");
      await running.page
        .getByRole("button", { name: "开始审查", exact: true })
        .click();
      await expect(
        running.page.getByText(
          "已完成本地规则审查。它仅依据已保存的剧本和场景，不会冒充模型结论。",
          { exact: true },
        ),
      ).toBeVisible();
      await running.page
        .getByRole("navigation", { name: "改编阶段" })
        .getByRole("button", { name: "场景", exact: true })
        .click();
      await expect(running.page).toHaveURL(/stage=scenes/);
      expect(
        new URLSearchParams(running.page.url().split("?")[1]).get("scriptId"),
      ).toBe(scriptId);
      await running.application.close();
      running = await launch(userData, sourceFile);
      await running.page.getByRole("link", { name: title }).click();
      await expect(
        running.page.getByRole("heading", { name: "剧本审查", exact: true }),
      ).toBeVisible();
      expect(
        new URLSearchParams(running.page.url().split("?")[1]).get("scriptId"),
      ).toBe(scriptId);
      const after = await running.page.evaluate(async (id) => {
        const b = await window.runtimeBootstrap.resolve();
        return { baseUrl: b.baseUrl, accessToken: b.accessToken, id };
      }, scriptId);
      const response = await fetch(
        `${after.baseUrl}/api/v2/scripts/${scriptId}/screenplay`,
        { headers: { Authorization: `Bearer ${after.accessToken}` } },
      );
      expect(response.ok).toBe(true);
      expect(await response.json()).toMatchObject(document);
      await expect(
        running.page.getByRole("button", { name: "重新审查", exact: true }),
      ).toBeVisible();
    } finally {
      await running?.application.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}
