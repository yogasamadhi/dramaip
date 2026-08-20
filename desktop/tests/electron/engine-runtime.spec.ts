import { expect, test } from "@playwright/test";
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  await expect(page.getByRole("heading", { name: "选择开始方式" })).toBeVisible(
    { timeout: 30_000 },
  );
});

test.afterAll(async () => {
  await application?.close();
  if (userData) await rm(userData, { recursive: true, force: true });
});

test("Pi、Codex 与 Grok Build 三个受支持智能引擎均完成进程启动", async () => {
  const bootstrap = await page.evaluate(() => window.runtimeBootstrap);
  const response = await fetch(`${bootstrap.baseUrl}/api/v2/agent-engines`, {
    headers: { Authorization: `Bearer ${bootstrap.accessToken}` },
  });
  expect(response.ok).toBe(true);
  const engines = (await response.json()) as Array<{
    kind: string;
    runtimeStatus: string;
  }>;
  const statusByKind = new Map(
    engines.map((engine) => [engine.kind, engine.runtimeStatus]),
  );
  const supported = ["pi", "codex"];
  if (platform() === "darwin" && arch() === "arm64") supported.push("grok");
  for (const kind of supported)
    expect(statusByKind.get(kind), `${kind} should be running`).toBe("running");
});
