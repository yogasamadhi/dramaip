import { expect, test } from "@playwright/test";
import { type ElectronApplication, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  crashHost,
  electron,
  hostAccess,
  hostPid,
  hostRemoteValue,
} from "./desktop-host";

/**
 * The Electron shell of baseline §5: process shape, the Host listener, the
 * preload surface and native recovery. Every window stays hidden.
 */

let application: ElectronApplication;
let page: Page;
let userData: string;

interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string;
}

function processTable(): ProcessRow[] {
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], {
    encoding: "utf8",
  })
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, pid, ppid, command]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      command: command!,
    }));
}

function descendants(rows: ProcessRow[], root: number): ProcessRow[] {
  const found: ProcessRow[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const row of rows)
      if (row.ppid === parent) {
        found.push(row);
        queue.push(row.pid);
      }
  }
  return found;
}

const isChromiumHelper = (row: ProcessRow): boolean =>
  /\s--type=/u.test(row.command);

test.beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "dramaip-shell-e2e-"));
  application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, DRAMAIP_E2E_USER_DATA: userData },
  });
  page = await application.firstWindow();
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 60_000,
  });
});

test.afterAll(async () => {
  await application?.close();
  if (userData)
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
});

test("窗口从壳自有 origin 加载，页面不持有 Host 凭据", async () => {
  expect(page.url()).toBe("dramaip-app://app/");
  const cookie = await page.evaluate(() => document.cookie);
  expect(cookie).toBe("");
  const { cookie: hostCookie } = await hostAccess(application);
  expect(hostCookie).toMatch(/^dramaip-auth-/u);
});

test("Host 只监听 127.0.0.1 上由系统分配的端口", async () => {
  const { baseUrl } = await hostAccess(application);
  const url = new URL(baseUrl);
  expect(url.hostname).toBe("127.0.0.1");
  expect(Number(url.port)).toBeGreaterThan(1024);
  const pid = await hostPid(application);
  test.skip(process.platform === "win32", "lsof is not available");
  const listening = execFileSync(
    "lsof",
    ["-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"],
    { encoding: "utf8" },
  )
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/u).at(-2));
  expect(listening).toEqual([`127.0.0.1:${url.port}`]);
});

test("进程只有 Main、Chromium 辅助进程、一个 Host 与 Host 的引擎子进程", async () => {
  test.skip(process.platform === "win32", "ps is not available");
  const main = application.process().pid!;
  const host = await hostPid(application);
  const rows = processTable();
  const tree = descendants(rows, main);
  const direct = rows.filter((row) => row.ppid === main);
  expect(
    direct.filter((row) => !isChromiumHelper(row)).map((row) => row.pid),
  ).toEqual([host]);
  expect(
    tree.filter((row) => /\s--type=renderer/u.test(row.command)).length,
  ).toBeGreaterThanOrEqual(1);
  const hostTree = descendants(rows, host!);
  const outside = tree.filter(
    (row) =>
      row.pid !== host &&
      !isChromiumHelper(row) &&
      !hostTree.some((child) => child.pid === row.pid),
  );
  expect(outside).toEqual([]);
  // The Host starts engine sidecars only (possibly through the subprocess
  // spawn helper); whatever an engine runs below its sidecar is the engine's.
  const sidecar = /pi-sidecar/u;
  const engineRoots = hostTree.filter((row) => sidecar.test(row.command));
  expect(engineRoots.length).toBeGreaterThanOrEqual(1);
  const engineTree = new Set(
    engineRoots.flatMap((root) => [
      root.pid,
      ...descendants(rows, root.pid).map((row) => row.pid),
    ]),
  );
  const unexpected = hostTree.filter(
    (row) => !engineTree.has(row.pid) && !/spawn-helper/u.test(row.command),
  );
  expect(unexpected).toEqual([]);
});

test("Host 崩溃后先写崩溃报告，再显示恢复窗口；重启后恢复工作台", async () => {
  const before = await hostPid(application);
  const orphans =
    process.platform === "win32"
      ? []
      : descendants(processTable(), before!).map((row) => row.pid);
  await crashHost(application);
  const recovery = await application.waitForEvent("window", {
    predicate: (window) => window.url().startsWith("dramaip-app://shell/"),
    timeout: 30_000,
  });
  await expect(recovery.getByTestId("recovery-message")).toBeVisible();
  const reports = (await readdir(join(userData, "logs"))).filter((name) =>
    /^crash-.*\.log$/u.test(name),
  );
  expect(reports).toHaveLength(1);
  const report = await readFile(join(userData, "logs", reports[0]!), "utf8");
  expect(report).not.toMatch(/token=[^<\s]/u);
  expect(
    await recovery.evaluate(() =>
      [...document.querySelectorAll("button[data-choice]")].map(
        (button) => (button as HTMLButtonElement).dataset.choice,
      ),
    ),
  ).toEqual(["restart", "safe", "backup", "quit"]);
  expect(
    await recovery.evaluate(() =>
      Object.keys(window).filter((key) => /^dramaip/iu.test(key)),
    ),
  ).toEqual(["dramaipRecovery"]);
  await recovery.getByRole("button", { name: "重启", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 60_000,
  });
  const after = await hostPid(application);
  expect(after).toBeDefined();
  expect(after).not.toBe(before);
  // Whatever the crashed Host started exits with it.
  await expect
    .poll(
      () => {
        const alive = new Set(processTable().map((row) => row.pid));
        return orphans.filter((pid) => alive.has(pid));
      },
      { timeout: 15_000 },
    )
    .toEqual([]);
});

test("备份 Profile patch 并重启：旧 patch 留作备份，新 patch 为空", async () => {
  const profile = join(userData, "profiles", "desktop");
  await mkdir(profile, { recursive: true });
  const patch = join(profile, "cordis.patch.yml");
  await writeFile(patch, "- id: not-a-row\n  name: '@dramaip/missing'\n");
  await crashHost(application);
  const recovery = await application.waitForEvent("window", {
    predicate: (window) => window.url().startsWith("dramaip-app://shell/"),
    timeout: 30_000,
  });
  await recovery
    .getByRole("button", { name: "备份 Profile patch 并重启" })
    .click();
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 60_000,
  });
  const backups = (await readdir(profile)).filter((name) =>
    /^cordis\.patch\.yml\..*\.bak$/u.test(name),
  );
  expect(backups).toHaveLength(1);
  expect(await readFile(join(profile, backups[0]!), "utf8")).toContain(
    "not-a-row",
  );
  expect(await readFile(patch, "utf8")).toMatch(/^\[\]$/mu);
});

test("安全模式启动关闭业务与引擎插件", async () => {
  await crashHost(application);
  const recovery = await application.waitForEvent("window", {
    predicate: (window) => window.url().startsWith("dramaip-app://shell/"),
    timeout: 30_000,
  });
  await recovery.getByRole("button", { name: "以安全模式启动" }).click();
  const access = await hostAccess(application);
  const runtime = await hostRemoteValue<{
    engineStatus?: Record<string, { available?: boolean }>;
  }>(access, "system/runtime");
  const status = Object.values(runtime.engineStatus ?? {});
  expect(status.length).toBeGreaterThan(0);
  expect(status.every((engine) => engine.available === false)).toBe(true);
  const host = await hostPid(application);
  test.skip(process.platform === "win32", "ps is not available");
  expect(
    descendants(processTable(), host!).filter((row) =>
      /-sidecar/u.test(row.command),
    ),
  ).toEqual([]);
  expect(existsSync(join(userData, "logs"))).toBe(true);
});
