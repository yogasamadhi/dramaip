import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("原生创建的非法名称只阻止提交，不使确认界面崩溃或清除原草稿（后台）", async () => {
  const userData = await mkdtemp(
    join(tmpdir(), "dramaip-create-invalid-input-"),
  );
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page
      .getByRole("button", { name: "导入已有剧本", exact: true })
      .click();
    await page
      .getByRole("button", { name: "开发剧本 · 单季短剧", exact: true })
      .click();
    const panel = page.getByLabel("创建前原生剧本导入", { exact: true });
    await expect(panel).toBeVisible();
    await page
      .getByRole("textbox", { name: "项目名称" })
      .fill("长".repeat(161));
    await expect(panel).toBeVisible();
    const draft = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("dramaip-creation-draft:v1")!),
    );
    expect(draft.brief.title).toHaveLength(161);
    expect(draft.goalConfirmation).toEqual({
      confirmed: true,
      goal: "screenplay-first",
      material: "script",
    });
    expect(draft.attemptId).toBeUndefined();
    await page
      .getByRole("textbox", { name: "项目名称" })
      .fill("修正后的原生项目名称");
    await expect(panel).toBeVisible();
    const windows = await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((window) => ({
        visible: window.isVisible(),
        focused: window.isFocused(),
      })),
    );
    expect(windows.every((window) => !window.visible && !window.focused)).toBe(
      true,
    );
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
