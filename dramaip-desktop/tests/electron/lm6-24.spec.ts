import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-24-e2e-"));
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

test("审核交付页明确展示可选云审片的最小上传与安全连接入口", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "创建示例项目" }).click();
  await page.getByRole("link", { name: "审核交付" }).click();
  await page
    .getByLabel("项目选择项目", { exact: true })
    .selectOption({ label: "雨夜归来" });
  await page
    .getByRole("combobox", { name: "改编项目" })
    .selectOption({ label: "雨夜归来·第一季改编方案" });
  await page
    .getByRole("combobox", { name: "分集" })
    .selectOption({ label: "第 1 集：雨夜敲门" });
  await page.getByRole("button", { name: "审片" }).click();

  await expect(page.getByRole("heading", { name: "可选云审片" })).toBeVisible();
  await expect(page.getByText(/仅上传下方明确选择的媒体/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存安全连接" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择要上传的媒体" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "按游标同步意见" }),
  ).toBeVisible();
});
