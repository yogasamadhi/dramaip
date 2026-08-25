import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-11-e2e-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
});

test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});

test("导演看板支持键盘、拖拽重排、撤销和资产上下文跳转", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "创建示例项目" }).click();
  await page.getByRole("link", { name: "制作" }).click();
  await page.getByRole("button", { name: "导演看板" }).click();
  await expect(page.getByLabel("导演分镜看板")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "卡片式导演分镜看板" }),
  ).toBeVisible();
  const first = page.getByRole("button", {
    name: "选择分镜：镜头 1：门缝中的雨夜",
  });
  const second = page.getByRole("button", {
    name: "选择分镜：镜头 2：雨中的来客",
  });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(page.getByLabel("镜头 1：门缝中的雨夜 资产覆盖")).toContainText(
    "缺资产引用",
  );
  await expect(page.getByLabel("静帧预览：静帧已采用")).toContainText(
    "不伪造缩略图",
  );
  await second.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(
    page.getByText("已保存分镜顺序；可在下一次调整前撤销这次重排。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤销上次重排" }).click();
  await expect(page.getByText("已恢复上一次分镜顺序。")).toBeVisible();
  const firstCard = page.locator("[data-shot-id]").filter({
    hasText: "镜头 1：门缝中的雨夜",
  });
  const secondCard = page.locator("[data-shot-id]").filter({
    hasText: "镜头 2：雨中的来客",
  });
  await expect(firstCard).toHaveAttribute("draggable", "true");
  await expect(secondCard).toHaveAttribute("draggable", "true");
  await firstCard.dragTo(secondCard);
  await expect(
    page.getByText("已保存分镜顺序；可在下一次调整前撤销这次重排。"),
  ).toBeVisible();
  await first.click();
  await expect(page.getByLabel("当前分镜上下文")).toContainText(
    "镜头 1：门缝中的雨夜",
  );
  await page
    .getByRole("checkbox", { name: "批量选择：镜头 1：门缝中的雨夜" })
    .check();
  await page.getByRole("button", { name: "查看选定镜头的资产用途" }).click();
  await expect(
    page.getByRole("heading", { name: "统一资产中心" }),
  ).toBeVisible();
  await expect(page.getByLabel("镜头用途")).not.toHaveValue("");
});
