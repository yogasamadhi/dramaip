import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const appRoot = resolve(import.meta.dirname, "../..");

test("production profile supervises five independent engine processes", async () => {
  const testUserData = await mkdtemp(
    resolve(tmpdir(), "DramaIP Studio Next Engines-"),
  );
  const executablePath =
    process.env.DRAMAIP_ELECTRON_EXECUTABLE ?? (require("electron") as string);
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env))
    if (value !== undefined) environment[key] = value;
  delete environment.DRAMAIP_E2E;
  delete environment.DRAMAIP_E2E_USER_DATA;
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.DRAMAIP_NEXT_DEV_USER_DATA = testUserData;
  const application = await electron.launch({
    executablePath,
    args: [appRoot],
    env: environment,
  });
  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "更多" }).click();
    await page.getByRole("menuitem", { name: "设置" }).click();
    await page
      .getByRole("heading", { name: "智能引擎" })
      .scrollIntoViewIfNeeded();
    const engines = page.locator(".engine-status-list article");
    await expect(engines).toHaveCount(5);
    for (const kind of ["opencode", "codex", "dsh", "pi", "langgraph"])
      await expect(
        engines.filter({ hasText: kind }).getByText(kind, { exact: true }),
      ).toBeVisible();
    await expect(engines.getByText("unavailable", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    await application.close();
    await rm(testUserData, { recursive: true, force: true });
  }
});
