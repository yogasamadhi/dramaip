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
let projectPath: string;

async function openRoute(path: string): Promise<void> {
  await page.evaluate((nextPath) => {
    window.location.hash = nextPath;
  }, path);
  await page.waitForTimeout(80);
  await expect(page.locator("main")).toBeVisible();
}

async function useTheme(mode: "light" | "dark"): Promise<void> {
  await page.evaluate((nextMode) => {
    window.localStorage.setItem("dramaip-theme-v1", nextMode);
  }, mode);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
}

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm7-visual-"));
  application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: {
      ...process.env,
      DRAMAIP_E2E_USER_DATA: userData,
    },
  });
  page = await application.firstWindow();
  page.on("pageerror", (error) => {
    console.error("LM7 renderer error", error);
  });
  await page.setViewportSize({ width: 1440, height: 920 });
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 30_000,
  });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}",
  });
  await page.getByRole("button", { name: "先看看示例" }).click();
  await page
    .getByRole("link", { name: /示例短剧：雨夜归来/ })
    .first()
    .click();
  projectPath = await page.evaluate(() => window.location.hash.slice(1));
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("12 个标准界面具备稳定的明暗视觉基线", async () => {
  const routes = [
    ["projects", "/"],
    ["novel-home", "/write"],
    ["novel-editor", projectPath],
    ["project-tools", `${projectPath}/tools`],
    ["creative-analysis", "/create"],
    ["adaptation", "/adapt"],
    ["production", "/produce"],
    ["review", "/review"],
    ["insights", "/insights"],
    ["search", "/search"],
    ["tasks", "/tasks"],
    ["settings", "/settings"],
  ] as const;

  for (const theme of ["light", "dark"] as const) {
    await useTheme(theme);
    for (const [name, path] of routes) {
      await openRoute(path);
      await expect(page).toHaveScreenshot(`${theme}-${name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.015,
      });
    }
    await openRoute("/");
    await page.getByRole("button", { name: "打开智能助手" }).click();
    await expect(page.getByText("AI 办事助手", { exact: true })).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-global-assistant.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
    });
    await page.getByRole("button", { name: "关闭智能助手" }).click();
  }
});

test("1080×700 下应用栏、正文与制作工作台不横向溢出", async () => {
  await page.setViewportSize({ width: 1080, height: 700 });
  for (const path of ["/", projectPath, "/produce"]) {
    await openRoute(path);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("制作与审核交付工作台跟随全局明暗主题", async () => {
  await page.setViewportSize({ width: 1440, height: 920 });

  for (const theme of ["light", "dark"] as const) {
    await useTheme(theme);
    for (const path of ["/produce", "/review"]) {
      await openRoute(path);
      const appearance = await page
        .locator(".workbench")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          const channels = style.backgroundColor
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number);
          return {
            colorScheme: style.colorScheme,
            brightness: channels
              ? channels.reduce((sum, channel) => sum + channel, 0) /
                channels.length
              : 0,
          };
        });

      expect(appearance.colorScheme).toContain(theme);
      if (theme === "light") expect(appearance.brightness).toBeGreaterThan(220);
      else expect(appearance.brightness).toBeLessThan(80);
    }
  }
});

test("主题首次跟随系统并持久化手动选择", async () => {
  await page.evaluate(() => {
    window.localStorage.removeItem("dramaip-theme-v1");
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-mode",
    "system",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    /light|dark/,
  );

  await page.getByRole("button", { name: "切换外观主题" }).click();
  await page.getByRole("menuitem", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("dramaip-theme-v1")),
    )
    .toBe("dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
