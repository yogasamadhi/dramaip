import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import { openProductionStage } from "./project-tools";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-20-e2e-"));
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

test("多轨时间线可定位、编辑、撤销并在重开后保留编辑", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "先看看示例" }).click();
  await page.getByRole("link", { name: "制作", exact: true }).click();
  await page
    .getByRole("combobox", { name: "改编项目" })
    .selectOption({ label: "雨夜归来·第一季改编方案" });
  await page
    .getByRole("combobox", { name: "分集" })
    .selectOption({ label: "第 1 集：雨夜敲门" });
  await openProductionStage(page, "多轨时间线");

  const editor = page.getByLabel("多轨时间线编辑器");
  await expect(editor).toBeVisible();
  await expect(editor.getByText("视频", { exact: true })).toBeVisible();
  await expect(editor.getByText("对白", { exact: true })).toBeVisible();
  await expect(editor.getByText("字幕", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "播放", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "暂停", exact: true }).click();
  await editor.getByLabel("播放头定位").fill("1");
  await expect(editor.getByText("1.00 秒", { exact: true })).toBeVisible();

  await editor
    .getByRole("button", { name: /选择片段：镜头 1：门缝中的雨夜/ })
    .click();
  await editor.getByLabel("移动到秒").fill("1.2");
  await editor.getByRole("button", { name: "移动", exact: true }).click();
  await expect(
    editor.getByText("编辑已自动保存；源媒体没有被修改。", { exact: true }),
  ).toBeVisible();
  await expect(
    editor.getByRole("button", { name: "撤销", exact: true }),
  ).toBeEnabled();
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    editor.getByText("已撤销最近一次编辑。", { exact: true }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    editor.getByText("已重做最近一次编辑。", { exact: true }),
  ).toBeVisible();
  await editor.getByLabel("视频静音").click();
  await expect(editor.getByLabel("视频静音")).toContainText("静音");

  await page.reload();
  await page.getByRole("link", { name: "制作", exact: true }).click();
  await page
    .getByRole("combobox", { name: "改编项目" })
    .selectOption({ label: "雨夜归来·第一季改编方案" });
  await page
    .getByRole("combobox", { name: "分集" })
    .selectOption({ label: "第 1 集：雨夜敲门" });
  await openProductionStage(page, "多轨时间线");
  await expect(page.getByLabel("多轨时间线编辑器")).toBeVisible();
  await expect(page.getByText("v4", { exact: false })).toBeVisible();
});
