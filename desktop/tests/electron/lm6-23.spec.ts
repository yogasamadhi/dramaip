import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import { openProjectTool } from "./project-tools";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-23-e2e-"));
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

test("项目工作台提供本地系列边界和版本化资产入口", async () => {
  const page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "创建示例项目" }).click();
  await page.getByRole("link", { name: "雨夜归来" }).click();
  await openProjectTool(page, "系列资料");

  const library = page.getByTestId("series-library");
  await expect(
    library.getByRole("heading", { name: "系列资产库" }),
  ).toBeVisible();
  await expect(library.getByText(/不会连接云端或复制媒体二进制/)).toBeVisible();
  await library.getByLabel("新系列名称").fill("雨夜系列");
  await library.getByRole("button", { name: "新建系列并加入" }).click();
  await expect(library.getByText(/当前系列：雨夜系列/)).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Link 固定版本" }),
  ).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Fork 可编辑" }),
  ).toBeVisible();
});
