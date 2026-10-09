import { selectWorkspaceObject } from "./project-tools";
import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

let application: ElectronApplication;
let userData: string;
test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-13-e2e-"));
  application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
});
test.afterAll(async () => {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
});
test("改编区显示可访问的集级四轨节奏看板", async () => {
  const page = await application.firstWindow();
  await page.getByRole("button", { name: "先看看示例" }).click();
  await page.getByRole("link", { name: "改编" }).click();
  await selectWorkspaceObject(page, "改编项目", {
    label: "雨夜归来·第一季改编方案",
  });
  await selectWorkspaceObject(page, "分集", { label: "第 1 集：雨夜敲门" });
  await selectWorkspaceObject(page, "剧本", { label: "第 1 集剧本" });
  await selectWorkspaceObject(page, "场景", { label: "场景 1：雨夜门口" });
  await expect(page.getByLabel("集级节奏看板")).toBeVisible();
  await expect(page.getByLabel("节拍密度轨道")).toBeVisible();
  await expect(page.getByLabel("爽点轨道")).toBeVisible();
  await expect(page.getByLabel("反转轨道")).toBeVisible();
  await expect(page.getByLabel("结尾悬念轨道")).toBeVisible();
});
