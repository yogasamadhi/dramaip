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
  if (["/adapt", "/produce", "/review"].includes(path)) {
    const context = page.getByLabel("当前制作对象", { exact: true });
    await expect(context).toBeVisible();
    if (path !== "/adapt")
      await expect(context.locator("select").nth(2)).not.toHaveValue("");
  }
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

test("10 个标准界面具备稳定的明暗视觉基线", async () => {
  const routes = [
    ["projects", "/"],
    ["novel-home", "/write"],
    ["project-tools", `${projectPath}/tools`],
    ["creative-analysis", "/create"],
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
      if (path === "/")
        await expect(
          page
            .getByLabel("继续当前项目", { exact: true })
            .getByRole("link", { name: "确认来源与作者意图", exact: true }),
        ).toBeVisible();
      const horizontalLayout = await page.evaluate(() => ({
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        scrollX: window.scrollX,
      }));
      expect(horizontalLayout, `${theme}-${name}`).toEqual({
        overflow: 0,
        scrollX: 0,
      });
      // Collect every changed view before the test fails; a first mismatch
      // must not conceal later regressions or authorize a bulk baseline reset.
      await expect.soft(page).toHaveScreenshot(`${theme}-${name}.png`, {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.015,
      });
    }
    await openRoute("/");
    await expect(
      page
        .getByLabel("继续当前项目", { exact: true })
        .getByRole("link", { name: "确认来源与作者意图", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "打开智能助手面板" }).click();
    await expect(page.getByText("AI 办事助手", { exact: true })).toBeVisible();
    await expect.soft(page).toHaveScreenshot(`${theme}-global-assistant.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
    });
    await page.getByRole("button", { name: "关闭智能助手面板" }).click();
  }
});

test("改编工作区保留显式诊断入口且明暗布局稳定", async () => {
  for (const theme of ["light", "dark"] as const) {
    await useTheme(theme);
    await openRoute("/adapt");
    const diagnosis = page.getByRole("link", {
      name: "先确认来源并进行改编诊断 →",
      exact: true,
    });
    await expect(diagnosis).toBeVisible();
    await expect(diagnosis).toHaveAttribute(
      "href",
      `#${projectPath}/tools/adaptation-diagnosis`,
    );
    await expect(
      page.getByRole("button", {
        name: "生成并检查本集剧本与分镜（旧 episode 兼容）",
        exact: true,
      }),
    ).not.toBeVisible();
    await expect(
      page.getByLabel("独立创作主流程", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("旧 episode 兼容路径", { exact: true }),
    ).not.toHaveAttribute("open");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBe(0);
    await expect.soft(page).toHaveScreenshot(`${theme}-adaptation.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
    });
  }
});

test("小说正文界面等待实际创作操作就绪后比较明暗视觉基线", async () => {
  for (const theme of ["light", "dark"] as const) {
    await useTheme(theme);
    await openRoute(projectPath);
    // Loading an empty operation list is not the settled authoring workspace.
    // Wait for the real project-bound controls instead of a fixed screenshot delay.
    await expect(
      page.getByRole("button", { name: "续写本章", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "生成并检查本章正文", exact: true }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
    await expect.soft(page).toHaveScreenshot(`${theme}-novel-editor.png`, {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.015,
    });
    await expect(
      page.getByRole("button", { name: "续写本章", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`${theme}-settled-novel-editor.png`),
    });
  }
});

test("macOS 系统按钮与品牌垂直居中且保留独立间距", async () => {
  test.skip(process.platform !== "darwin", "macOS 专属标题栏布局");

  await page.setViewportSize({ width: 1440, height: 920 });
  await openRoute("/");

  const brand = await page
    .getByRole("link", { name: "尽意项目首页" })
    .boundingBox();
  const collapse = await page
    .getByRole("button", { name: "收起导航" })
    .boundingBox();
  const windowButtons = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getWindowButtonPosition(),
  );

  expect(brand).not.toBeNull();
  expect(collapse).not.toBeNull();
  if (!brand || !collapse) throw new Error("标题栏控件未完成布局");

  expect(windowButtons).toBeTruthy();
  if (!windowButtons) throw new Error("未读取到 macOS 原生窗口按钮位置");
  expect(
    Math.abs(windowButtons.y + 7 - (brand.y + brand.height / 2)),
  ).toBeLessThanOrEqual(1);
  expect(brand.x).toBeGreaterThanOrEqual(88);
  expect(collapse.x).toBeGreaterThanOrEqual(224);
  expect(collapse.x).toBeGreaterThanOrEqual(brand.x + brand.width);

  await page.getByRole("button", { name: "收起导航" }).click();
  await expect(page.getByRole("link", { name: "尽意项目首页" })).toBeHidden();
  const expand = await page
    .getByRole("button", { name: "展开导航" })
    .boundingBox();
  expect(expand).not.toBeNull();
  if (!expand) throw new Error("折叠后的导航按钮未完成布局");
  expect(expand.x).toBeGreaterThanOrEqual(80);
  await page.getByRole("button", { name: "展开导航" }).click();
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

test("1079 px 窄窗口仍可打开完整导航", async () => {
  await page.setViewportSize({ width: 1079, height: 700 });
  await openRoute("/");

  const navigation = page.getByRole("button", { name: "打开导航" });
  if (process.platform === "darwin") {
    const bounds = await navigation.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(88);
  }
  await navigation.click();
  await expect(page.locator('[aria-label="尽意导航"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[aria-label="尽意导航"]')).toBeHidden();
});

test("1280×800 与 200% 缩放下保留主要操作和可恢复布局", async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openRoute(projectPath);
  await expect(
    page.getByRole("button", { name: "章节目录", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(2);
  });
  await openRoute("/");
  await expect(page.getByRole("button", { name: "新建项目" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1);
  });
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

test("AI 工作台在四种窗口尺寸保持独立滚动、底部输入和目录焦点", async () => {
  await useTheme("light");
  for (const size of [
    { width: 1800, height: 1000 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1080, height: 700 },
  ]) {
    await page.setViewportSize(size);
    await openRoute(projectPath);
    await page.getByRole("button", { name: "正文", exact: true }).click();
    const panel = page.getByLabel("章节辅助栏", { exact: true });
    if (
      !(await panel
        .getByRole("button", { name: "AI 创作", exact: true })
        .isVisible())
    )
      await page.getByRole("button", { name: "智能写作", exact: true }).click();
    await panel.getByRole("button", { name: "AI 创作", exact: true }).click();
    const input = panel.getByLabel("AI 创作要求");
    await expect(input).toBeVisible();
    const before = await input.boundingBox();
    expect(before!.y + before!.height).toBeLessThanOrEqual(size.height);
    await panel.hover();
    await page.mouse.wheel(0, 1200);
    const after = await input.boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(
      await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })),
    ).toEqual({ x: 0, y: 0 });
    const title = await page
      .getByLabel("章节标题", { exact: true })
      .boundingBox();
    const directory = page.getByRole("button", {
      name: "章节目录",
      exact: true,
    });
    const button = await directory.boundingBox();
    expect(button!.x + button!.width).toBeLessThanOrEqual(title!.x);
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+k" : "Control+k",
    );
    await expect(
      page.getByRole("textbox", { name: "搜索章节", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "收起章节目录", exact: true })
      .click();
    await expect(directory).toBeFocused();
    if (size.width === 1800)
      await expect(page).toHaveScreenshot("ai-workbench-1800.png", {
        animations: "disabled",
      });
  }
});
