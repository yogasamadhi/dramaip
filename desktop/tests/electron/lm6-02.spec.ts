import { expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { createSeriesProject, openProjectTool } from "./project-tools";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-lm6-02-e2e-"));
  const executablePath = process.env.DRAMAIP_E2E_EXECUTABLE;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("空项目驾驶舱只显示一个可信下一步，并将审核区绑定到当前项目", async () => {
  await createSeriesProject(page, "LM6 驾驶舱项目");
  await openProjectTool(page, "项目驾驶舱");
  await expect(page.getByLabel("项目驾驶舱")).toBeVisible();
  await expect(page.getByText("准备改编", { exact: true })).toBeVisible();
  const actions = page.getByRole("link", { name: "创建改编方案" });
  await expect(actions).toHaveCount(1);

  const projectId = /\/projects\/([^/?]+)/.exec(page.url())?.[1];
  expect(projectId).toBeTruthy();
  await page.getByRole("link", { name: "审核交付", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "质量、审片与交付" }),
  ).toBeVisible();
  await expect(page.locator("select").first()).toHaveValue(projectId!);
});
