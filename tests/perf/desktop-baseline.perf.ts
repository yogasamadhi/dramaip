// One run of the P0 performance baseline (REFACTOR_PLAN_DSH_LEVEL2 §7.4),
// driven by scripts/measure-performance.mjs. The window stays hidden
// (DRAMAIP_DEBUG_BACKGROUND=1 is set by run-electron-playwright.ts).
import { expect, test } from "@playwright/test";

import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { electron, hostAccess, hostPid } from "../electron/desktop-host";

const fixture = resolve("tests/fixtures/baseline-userdata/3.0.0-alpha.3");

test("desktop performance baseline run", async () => {
  test.setTimeout(180_000);
  const output = process.env.DRAMAIP_PERF_OUTPUT;
  if (!output) throw new Error("DRAMAIP_PERF_OUTPUT is required");
  const baseline = JSON.parse(
    await readFile(join(fixture, "baseline.json"), "utf8"),
  ) as { project: { id: string }; chapters: string[] };
  const scratch = await mkdtemp(join(tmpdir(), "dramaip-perf-"));
  const userData = join(scratch, "userData");
  const legacy = join(scratch, "legacy");
  await cp(fixture, legacy, { recursive: true });
  const launch = () =>
    electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        DRAMAIP_E2E_USER_DATA: userData,
        DRAMAIP_E2E_LEGACY_USER_DATA: legacy,
      },
    });
  // The first launch migrates the baseline user data (D9); the measured cold
  // start opens the migrated home, as the baseline opened its data in place.
  const migration = await launch();
  await expect(
    (await migration.firstWindow()).getByRole("heading", {
      name: "项目工作台",
    }),
  ).toBeVisible({ timeout: 60_000 });
  await migration.close();

  const launchedAt = performance.now();
  const application = await launch();
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible(
      { timeout: 60_000 },
    );
    const coldStartMs = performance.now() - launchedAt;

    const [chapterId] = baseline.chapters;
    const openedAt = performance.now();
    await page.evaluate((route) => {
      window.location.hash = route;
    }, `/projects/${baseline.project.id}?chapterId=${chapterId}`);
    await expect(
      page.getByRole("navigation", { name: "当前项目导航", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator("main").getByText("雨夜，她在门口拆开一封没有署名的信。"),
    ).toBeVisible({ timeout: 30_000 });
    const openProjectMs = performance.now() - openedAt;

    const runtime = await hostAccess(page);
    const call = (path: string, init: RequestInit = {}) =>
      fetch(`${runtime.baseUrl}${path}`, {
        ...init,
        headers: {
          Cookie: runtime.cookie,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    const current = (await (
      await call(`/api/v2/chapters/${chapterId}`)
    ).json()) as { version: number; content: string };
    const savedAt = performance.now();
    const saved = await call(`/api/v2/chapters/${chapterId}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        version: current.version,
        content: `${current.content}\n她把信折好，放进外套口袋。`,
      }),
    });
    expect(saved.ok, await saved.clone().text()).toBe(true);
    const saveChapterMs = performance.now() - savedAt;

    // Idle memory: let startup work settle, then sum every process the app owns.
    await page.waitForTimeout(5_000);
    const metrics = await application.evaluate(({ app }) =>
      app.getAppMetrics().map((metric) => ({
        type: metric.type,
        name: metric.name ?? null,
        workingSetKb: metric.memory.workingSetSize,
      })),
    );
    // The Host and its engines are Node children of Main, outside app metrics.
    const reported = new Set(
      (await application.evaluate(({ app }) =>
        app.getAppMetrics().map((metric) => metric.pid),
      )) as number[],
    );
    const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)/u.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(([, pid, ppid, rss]) => ({
        pid: Number(pid),
        ppid: Number(ppid),
        rssKb: Number(rss),
      }));
    const owned = new Set([application.process().pid!]);
    for (let grew = true; grew;) {
      grew = false;
      for (const row of rows)
        if (owned.has(row.ppid) && !owned.has(row.pid)) {
          owned.add(row.pid);
          grew = true;
        }
    }
    const children = rows.filter(
      (row) => owned.has(row.pid) && !reported.has(row.pid),
    );
    // "Main + Host" as in the P0 baseline: the Core Runtime it measured was a
    // utilityProcess inside app metrics, while the engine processes it started
    // were not. The Host replaces the Core Runtime, so it counts and the
    // engine processes (with their own children) are reported apart.
    const host = await hostPid(application);
    const hostMemoryMb =
      (rows.find((row) => row.pid === host)?.rssKb ?? Number.NaN) / 1024;
    const engineMemoryMb =
      children
        .filter((row) => row.pid !== host)
        .reduce((sum, row) => sum + row.rssKb, 0) / 1024;
    const idleMemoryMb =
      metrics.reduce((sum, metric) => sum + metric.workingSetKb, 0) / 1024 +
      hostMemoryMb;

    await writeFile(
      output,
      `${JSON.stringify(
        {
          coldStartMs,
          openProjectMs,
          saveChapterMs,
          idleMemoryMb,
          hostMemoryMb,
          engineMemoryMb,
          metrics,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await application.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
