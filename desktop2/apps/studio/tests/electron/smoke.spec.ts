import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const appRoot = resolve(import.meta.dirname, "../..");

test("fresh Next identity completes the novel writing and assistant core journey", async () => {
  test.setTimeout(90_000);
  const testUserData = await mkdtemp(
    resolve(tmpdir(), "DramaIP Studio Next E2E-"),
  );
  const executablePath =
    process.env.DRAMAIP_ELECTRON_EXECUTABLE ?? (require("electron") as string);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[key] = value;
  }
  environment.DRAMAIP_E2E = "1";
  environment.DRAMAIP_E2E_USER_DATA = testUserData;
  delete environment.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    executablePath,
    args: [appRoot],
    env: environment,
  });
  try {
    const userData = await application.evaluate(({ app }) =>
      app.getPath("userData"),
    );
    expect(userData).toContain("DramaIP Studio Next");
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("DramaIP Studio");
    await expect(
      page.getByRole("heading", { name: "项目工作台" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "从灵感开始" }).click();
    await page.getByLabel("项目名称").fill(`E2E 小说项目 ${Date.now()}`);
    await page.getByLabel("一句话创意").fill("雨夜车站中的身份谜团");
    await page
      .getByLabel("故事简介")
      .fill("林默在旧车站发现一封来自未来的信。 ");
    await page.getByRole("button", { name: "创建并进入项目" }).click();
    await expect(page.locator(".writing-studio")).toBeVisible();
    await page.getByTitle("新建章节").click();
    await page.getByLabel("章节标题").fill("第一章 雨夜来信");
    await page
      .locator(".ProseMirror")
      .fill("雨落在旧车站。林默打开了那封信。 ");
    await expect(page.getByText("已保存", { exact: true })).toBeVisible({
      timeout: 8_000,
    });
    await page.getByRole("button", { name: "版本记录" }).click();
    await expect(page.locator(".version-panel")).toBeVisible();

    await page.getByRole("link", { name: "人物", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "故事知识库" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "新建人物" }).click();
    await page.getByLabel("标题").fill("林默");
    await page
      .getByLabel("人物小传与当前状态")
      .fill("调查记者\n\n执着追查失踪案件\n\n收到未来来信");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("林默", { exact: true })).toBeVisible();

    await page.goBack();
    await page.getByRole("button", { name: "打开智能助手" }).click();
    await expect(page.locator(".assistant-drawer-content")).toBeVisible();
    await page
      .getByLabel("给 AI 办事助手发消息")
      .fill("请概括这个故事目前的信息");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText("E2E result", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "关闭智能助手" }).click();

    await page.getByRole("button", { name: "更多" }).click();
    await page.getByRole("menuitem", { name: "设置" }).click();
    await expect(page.getByRole("heading", { name: "设置中心" })).toBeVisible();
    await page
      .getByRole("heading", { name: "智能引擎" })
      .scrollIntoViewIfNeeded();
    const engineRows = page.locator(".engine-status-list article");
    await expect(engineRows).toHaveCount(5);
    for (const kind of ["opencode", "codex", "dsh", "pi", "langgraph"])
      await expect(
        engineRows.filter({ hasText: kind }).getByText(kind, { exact: true }),
      ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "改编", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "制作", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "审核交付", exact: true }),
    ).toBeVisible();
  } finally {
    await application.close();
    await rm(testUserData, { recursive: true, force: true });
  }
});
