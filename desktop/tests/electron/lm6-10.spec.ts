import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import { openProductionStage } from "./project-tools";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-10-e2e-"));
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

test("示例项目在统一资产中心展示筛选、状态和版本比较入口", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "先看看示例" }).click();
  await expect(page.getByRole("link", { name: "雨夜归来" })).toBeVisible();
  await page.getByRole("link", { name: "制作" }).click();
  await openProductionStage(page, "资产中心");
  await expect(page.getByRole("region", { name: "资产中心" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "统一资产中心" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "资产类型筛选" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "角色", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "音色", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "加入比较" })).toBeVisible();
  // Assertions read the actual demo asset from its owner; no evidence response is mocked.
  const asset = page
    .locator("article")
    .filter({ hasText: "林晚·雨夜服装设定" });
  await expect(asset).toHaveCount(1);
  await expect(asset).toContainText("待核验");
  await expect(asset).toContainText("用户声明已核验，未提供核验凭证");
  await expect(asset).toContainText("结算费用未知");
  await expect(asset).toContainText("用户声明费用已知，未提供结算回执");
  await expect(asset).toContainText("服务可用性未核验");
  await expect(asset).toContainText("用户声明无需服务");
  await expect(asset).not.toContainText("可用或无需服务");
  await asset.scrollIntoViewIfNeeded();
  await asset.screenshot({
    path: "test-results/asset-declaration-status.png",
  });
});
