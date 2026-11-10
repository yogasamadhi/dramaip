import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { electron } from "./desktop-host";

let application: ElectronApplication;
let page: Page;
let userData: string;

const rail = () => page.locator(".studio-shell-sidebar");
const width = () =>
  rail().evaluate((element) => element.getBoundingClientRect().width);

async function expectFullWidthTitlebar() {
  const header = await page.locator(".studio-shell-contextbar").boundingBox();
  expect(header!.x).toBe(0);
  expect(header!.y).toBe(0);
  expect(header!.width).toBe(page.viewportSize()!.width);
  const contentTop = header!.y + header!.height;
  for (const selector of [
    ".studio-shell-sidebar",
    ".studio-shell-main",
    ".studio-shell-assistant",
  ]) {
    const surface = page.locator(selector);
    if (await surface.isVisible()) {
      const bounds = await surface.boundingBox();
      expect(bounds!.y).toBe(contentTop);
    }
  }
  if (process.platform === "darwin") {
    const toggle = await page
      .getByRole("button", { name: /^(展开导航|收起导航|打开导航)$/ })
      .filter({ visible: true })
      .boundingBox();
    expect(toggle!.x).toBeGreaterThanOrEqual(88);
  }
}

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-sidebar-navigation-"));
  application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  page = await application.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "先看看示例", exact: true }).click();
  await page
    .getByRole("link", { name: /示例短剧：雨夜归来/ })
    .first()
    .click();
  await rail().getByRole("link", { name: "项目库", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible();
});

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

test("新用户默认显示 40px 图标栏，所有菜单保留可访问名称", async ({}, info) => {
  expect(await width()).toBe(40);
  await expectFullWidthTitlebar();
  await page.screenshot({
    path: info.outputPath("full-width-titlebar.png"),
    clip: { x: 0, y: 0, width: 1440, height: 220 },
  });
  await expect(page.getByRole("button", { name: "展开导航" })).toBeVisible();
  const links = rail().locator(".studio-shell-nav-link");
  expect(await links.count()).toBeGreaterThan(4);
  for (const link of await links.all()) {
    expect(await link.getAttribute("aria-label")).toBeTruthy();
    await expect(link).toHaveAttribute("href", /#/);
    await expect(link.locator(".studio-shell-nav-label")).toBeHidden();
  }
});

test("明暗主题中鼠标进入即显示完整菜单名，移出后立即隐藏", async () => {
  for (const theme of ["浅色", "深色"]) {
    await page.getByRole("button", { name: "切换外观主题" }).click();
    await page.getByRole("menuitem", { name: theme, exact: true }).click();
    for (const link of await rail().locator(".studio-shell-nav-link").all()) {
      const label = await link.getAttribute("aria-label");
      expect(await link.getAttribute("title")).toBeNull();
      await link.hover();
      const tooltip = page.getByRole("tooltip");
      await expect(tooltip).toHaveText(label!, { timeout: 200 });
      await expect(tooltip).toBeVisible({ timeout: 200 });
      const appearance = await tooltip.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          animation: style.animationName,
          color: style.color,
          background: style.backgroundColor,
        };
      });
      expect(appearance.animation).toBe("none");
      expect(appearance.color).not.toBe(appearance.background);
      const bounds = await tooltip.boundingBox();
      expect(bounds!.x).toBeGreaterThan(40);
      if (label === "设置") {
        await page.screenshot({
          path: resolve(
            "build/sidebar-navigation",
            theme === "浅色" ? "light-hover.png" : "dark-hover.png",
          ),
        });
      }
      await page.mouse.move(600, 80);
      await expect(tooltip).toBeHidden({ timeout: 200 });
    }
  }
  await rail().getByRole("link", { name: "设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "设置中心" })).toBeVisible();
  await expect(page.getByRole("tooltip")).toBeHidden();
});

test("展开为 200px，展开与折叠选择在刷新后保持", async () => {
  await page.getByRole("button", { name: "展开导航" }).click();
  expect(await width()).toBe(200);
  await expectFullWidthTitlebar();
  await expect(
    rail()
      .getByRole("link", { name: "设置", exact: true })
      .getByText("设置", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "设置中心" })).toBeVisible();
  expect(await width()).toBe(200);
  await page.getByRole("button", { name: "收起导航" }).click();
  expect(await width()).toBe(40);
  await expectFullWidthTitlebar();
  await page.reload();
  await expect(page.getByRole("button", { name: "展开导航" })).toBeVisible();
  expect(await width()).toBe(40);
});

test("旧布局迁入后默认折叠并保留助手偏好，窄窗口仍显示完整菜单", async () => {
  await page.evaluate(() => {
    localStorage.removeItem("dramaip-shell-layout:v2");
    localStorage.setItem(
      "dramaip-shell-layout:v1",
      JSON.stringify({ navigationCollapsed: false, assistantOpen: true }),
    );
  });
  await page.reload();
  await expect(page.locator(".studio-shell-assistant")).toBeVisible();
  expect(await width()).toBe(40);
  await expectFullWidthTitlebar();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("dramaip-shell-layout:v2")!),
    ),
  ).toMatchObject({ navigationCollapsed: true, assistantOpen: true });
  await page
    .getByRole("button", { name: "关闭智能助手面板", exact: true })
    .click();
  await page.setViewportSize({ width: 1079, height: 700 });
  await expect(rail()).toBeHidden();
  await expectFullWidthTitlebar();
  await page.getByRole("button", { name: "打开导航" }).click();
  const navigation = page.getByRole("dialog", {
    name: "应用导航",
    exact: true,
  });
  await expect(navigation).toBeVisible();
  await expect(
    navigation
      .getByRole("link", { name: "设置", exact: true })
      .getByText("设置", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigation).toBeHidden();
});
