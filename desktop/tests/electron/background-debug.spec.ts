import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("后台调试保持窗口隐藏、不抢焦点且阻止未受控系统窗口", async ({}, testInfo) => {
  const userData = await mkdtemp(join(tmpdir(), "dramaip-background-debug-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible(
      {
        timeout: 30_000,
      },
    );
    const state = await application.evaluate(
      async ({ BrowserWindow, dialog, shell }) => {
        const blocked: string[] = [];
        for (const [label, action] of [
          ["open", () => dialog.showOpenDialog({})],
          ["save", () => dialog.showSaveDialog({})],
          ["external", () => shell.openExternal("https://example.com")],
          ["reveal", () => shell.showItemInFolder("/not-an-artifact")],
        ] as const) {
          try {
            await action();
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("后台调试禁止")
            )
              blocked.push(label);
            else throw error;
          }
        }
        return {
          windows: BrowserWindow.getAllWindows().map((window) => ({
            visible: window.isVisible(),
            focused: window.isFocused(),
            // Electron documents this query for macOS and Windows only.
            ...(process.platform === "linux"
              ? {}
              : { focusable: window.isFocusable() }),
          })),
          blocked,
        };
      },
    );
    expect(state.windows).toEqual([
      {
        visible: false,
        focused: false,
        ...(process.platform === "linux" ? {} : { focusable: false }),
      },
    ]);
    expect(state.blocked).toEqual(["open", "save", "external", "reveal"]);
    await page.screenshot({ path: testInfo.outputPath("hidden-window.png") });
  } finally {
    await application.close();
    await rm(userData, { recursive: true, force: true });
  }
});
