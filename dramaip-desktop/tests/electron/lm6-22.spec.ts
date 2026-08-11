import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-22-e2e-"));
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

test("canonical timeline 提供已验证 NLE 交付及受控的媒体重链接出口", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "创建示例项目" }).click();
  await page.getByRole("link", { name: "制作", exact: true }).click();
  await page
    .getByRole("combobox", { name: "改编项目" })
    .selectOption({ label: "雨夜归来·第一季改编方案" });
  await page
    .getByRole("combobox", { name: "分集" })
    .selectOption({ label: "第 1 集：雨夜敲门" });
  await page
    .getByRole("combobox", { name: "剧本" })
    .selectOption({ label: "第 1 集剧本" });
  await page
    .getByRole("combobox", { name: "场景" })
    .selectOption({ label: "场景 1：雨夜门口" });
  await page
    .getByRole("combobox", { name: "分镜" })
    .selectOption({ label: "镜头 1：门缝中的雨夜" });
  await page.getByRole("button", { name: "多轨时间线" }).click();

  const editor = page.getByLabel("多轨时间线编辑器");
  const delivery = editor.getByLabel("已验证 NLE 交付");
  await expect(delivery).toBeVisible();
  await expect(
    delivery.getByRole("button", { name: "导出 FCPXML" }),
  ).toBeVisible();
  await expect(
    delivery.getByRole("button", { name: "导出 OTIO" }),
  ).toBeVisible();
  await expect(
    delivery.getByRole("button", { name: "导出 EDL" }),
  ).toBeVisible();
  await expect(
    delivery.getByRole("button", { name: "导出重链接清单" }),
  ).toBeVisible();
  await expect(
    delivery.getByText(/MP4 仅在 Provider 显式声明 timeline_render/),
  ).toBeVisible();
});
