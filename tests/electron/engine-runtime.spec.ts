import { expect, test } from "@playwright/test";
import { type ElectronApplication, type Page } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { electron, hostAccess, hostFetch } from "./desktop-host";

let application: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-engine-e2e-"));
  application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  page = await application.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 30_000,
  });
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("Pi 智能引擎完成进程启动", async () => {
  const bootstrap = await hostAccess(page);
  // Engines start in the Host after the page is served; wait for each to run.
  await expect
    .poll(
      async () => {
        const response = await hostFetch(
          `${bootstrap.baseUrl}/api/v2/agent-engines`,
          { headers: { Cookie: bootstrap.cookie } },
        );
        expect(response.ok).toBe(true);
        const engines = (await response.json()) as Array<{
          kind: string;
          runtimeStatus: string;
        }>;
        return Object.fromEntries(
          engines.map((engine) => [engine.kind, engine.runtimeStatus]),
        );
      },
      { timeout: 30_000 },
    )
    .toEqual({ pi: "running" });
});
