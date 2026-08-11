import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";

let application: ElectronApplication;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-14-e2e-"));
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

test("章节编辑器在窄窗口保留 Story Bible 侧栏、选择性采用与撤销", async () => {
  const page = await application.firstWindow();
  await page.setViewportSize({ width: 1280, height: 720 });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "创建示例项目" }).click();
  await page.getByRole("link", { name: "雨夜归来" }).click();

  const sidecar = page.getByLabel("Story Bible 侧栏");
  await expect(sidecar).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "修订预览", exact: true }),
  ).toBeVisible();
  await expect(sidecar.getByLabel("搜索 Story Bible")).toBeVisible();

  await sidecar.getByRole("button", { name: "折叠", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    sidecar.getByRole("button", { name: "展开", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  await sidecar.getByRole("button", { name: "展开", exact: true }).click();

  await sidecar.getByRole("button", { name: "生成变更草案" }).click();
  await expect(
    sidecar.getByText("当前章节变更集", { exact: true }),
  ).toBeVisible();
  await sidecar.getByText("查看字段差异并选择采用", { exact: true }).click();
  const fields = sidecar.getByRole("checkbox");
  await expect(fields.first()).toBeChecked();
  await fields.last().uncheck();
  await sidecar.getByRole("button", { name: "采用所选字段" }).click();
  await expect(
    sidecar.getByText("已采用所选字段，并保留可撤销记录。"),
  ).toBeVisible();
  await sidecar.getByRole("button", { name: "撤销采用" }).click();
  await expect(sidecar.getByText("已撤销此变更集创建的资料。")).toBeVisible();
});
