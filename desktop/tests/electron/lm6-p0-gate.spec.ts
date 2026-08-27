import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
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
    await selectByKeyboard(page, "系列长篇");
    await selectByKeyboard(page, "从灵感开始");
    await page.getByRole("textbox", { name: "项目名称" }).fill(title);
    await page.getByRole("button", { name: "创建系列长篇" }).click();
  } else if (entry === "source-import") {
    await selectByKeyboard(page, "单季短剧");
    await selectByKeyboard(page, "导入小说 / IP");
    await page.getByRole("textbox", { name: "项目名称" }).fill(title);
    await page.getByRole("button", { name: "选择文件" }).click();
    await page
      .getByLabel("我确认拥有此内容的使用权，或已经取得必要授权。")
      .check();
    await page.getByRole("button", { name: "创建单季短剧并导入" }).click();
  } else {
    await selectByKeyboard(page, "单季短剧");
    await selectByKeyboard(page, "直接写剧本");
    await page.getByRole("textbox", { name: "项目名称" }).fill(title);
    await page
      .getByRole("textbox", { name: "首集剧本" })
      .fill("【雨夜·门口】\\n林晚：你终于来了。");
    await page.getByRole("button", { name: "创建单季短剧" }).click();
  }

  await openProjectTool(page, "试制计划");
  await expect(page.getByLabel("试制向导")).toBeVisible();
  await expect(page.getByLabel(/来源章节：/).first()).toBeChecked();
  await page.getByRole("button", { name: "建立试制计划" }).click();
  await page.getByRole("button", { name: "确认来源并创建试制分集" }).click();
  await expect(
    page.getByText("当前阶段：采用试制剧本", { exact: true }),
  ).toBeVisible();
}

for (const [entry, title] of [
  ["inspiration", "P0 灵感重开项目"],
  ["source-import", "P0 原著重开项目"],
  ["script-paste", "P0 剧本重开项目"],
] as const satisfies ReadonlyArray<[EntryPath, string]>) {
  test(`${entry} 在 fresh profile 建立试制计划并于重开后恢复`, async () => {
    const userData = await mkdtemp(join(tmpdir(), `dramaip-p0-${entry}-`));
    let running: RunningApp | undefined;
    try {
      running = await launch(userData);
      await createPilotFromEntry(running.page, entry, title);
      await running.application.close();

      running = await launch(userData);
      await expect(
        running.page.getByRole("link", { name: title }),
      ).toBeVisible();
      await running.page.getByRole("link", { name: title }).click();
      await openProjectTool(running.page, "试制计划");
      await expect(running.page.getByLabel("试制向导")).toBeVisible();
      await expect(
        running.page.getByText("当前阶段：采用试制剧本", { exact: true }),
      ).toBeVisible();
    } finally {
      await running?.application.close();
      await rm(userData, { recursive: true, force: true });
    }
  });
}

test("坏文件在本地预览阶段被拒绝，未伪造导入结果", async () => {
  const userData = await mkdtemp(join(tmpdir(), "dramaip-p0-bad-source-"));
  let running: RunningApp | undefined;
  try {
    running = await launch(
      userData,
      resolve("tests/fixtures/lm6/lm6-06/unsupported.source"),
    );
    await selectByKeyboard(running.page, "单季短剧");
    await selectByKeyboard(running.page, "导入小说 / IP");
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
