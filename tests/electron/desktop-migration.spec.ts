import { expect, test } from "@playwright/test";
import { type ElectronApplication, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  electron,
  hostAccess,
  hostFetch,
  hostRemoteValue,
  type HostAccess,
} from "./desktop-host";

/**
 * P3 acceptance 5 and the upgrade case of acceptance 6: the shell starts on
 * a copy of the P0 baseline userData (3.0.0-alpha.3), the Host migrates it,
 * the baseline project reads back unchanged, and the migrated fake
 * credential is resolved for the engines without its plaintext ever reaching
 * a Remote response, a stream frame or a log.
 */

const FIXTURE = resolve("tests/fixtures/baseline-userdata/3.0.0-alpha.3");

interface Baseline {
  project: { id: string };
  provider: { id: string; version: number; payload: Record<string, string> };
  model: { origin: string; name: string };
  credentials: { password: string; credentialRef: string; fakeSecret: string };
}

let application: ElectronApplication;
let page: Page;
let scratch: string;
let userData: string;
let legacy: string;
let baseline: Baseline;
let access: HostAccess;
let server: Server;
const modelRequests: string[] = [];
/** Every byte the test observed leave the Host or the shell. */
const observed: string[] = [];

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await hostFetch(`${access.baseUrl}${path}`, {
    ...init,
    headers: {
      Cookie: access.cookie,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.text();
  observed.push(body);
  expect(response.ok, `${path}: ${body}`).toBe(true);
  return (body ? JSON.parse(body) : undefined) as T;
}

test.beforeAll(async () => {
  baseline = JSON.parse(
    await readFile(join(FIXTURE, "baseline.json"), "utf8"),
  ) as Baseline;
  scratch = await mkdtemp(join(tmpdir(), "dramaip-migration-e2e-"));
  userData = join(scratch, "userData");
  legacy = join(scratch, "legacy");
  await cp(FIXTURE, legacy, { recursive: true });
  server = createServer(async (request, response) => {
    modelRequests.push(
      `${request.method} ${request.url} ${request.headers.authorization === `Bearer ${baseline.credentials.fakeSecret}` ? "fake-secret" : "other"}`,
    );
    for await (const _ of request);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: "baseline-model" }] }));
  });
  // The fixture's provider and credential policy name this origin.
  const origin = new URL(baseline.model.origin);
  await new Promise<void>((done) =>
    server.listen(Number(origin.port), origin.hostname, done),
  );
  application = await electron.launch({
    args: [resolve("apps/desktop/out/main/index.js")],
    env: {
      ...process.env,
      DRAMAIP_E2E_USER_DATA: userData,
      DRAMAIP_E2E_LEGACY_USER_DATA: legacy,
    },
  });
  application
    .process()
    .stdout?.on("data", (chunk) => observed.push(String(chunk)));
  application
    .process()
    .stderr?.on("data", (chunk) => observed.push(String(chunk)));
  page = await application.firstWindow();
  page.on("console", (message) => observed.push(message.text()));
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => observed.push(String(payload)));
    socket.on("framesent", ({ payload }) => observed.push(String(payload)));
  });
  await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible({
    timeout: 60_000,
  });
  access = await hostAccess(application);
});

test.afterAll(async () => {
  await application?.close();
  await new Promise((done) => server?.close(done));
  if (scratch)
    await rm(scratch, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
});

test("基准用户数据迁移后项目与设置可用", async () => {
  const marker = JSON.parse(
    await readFile(join(userData, "desktop", "migration.json"), "utf8"),
  ) as { outcome: string; copied: string[] };
  expect(marker.outcome).toBe("copied");
  expect(marker.copied).toContain(join("storage", "dramaip.sqlite"));
  expect(marker.copied).toContain(join("desktop", "credentials"));
  const expected = JSON.parse(
    await readFile(join(FIXTURE, "readback.json"), "utf8"),
  ) as Record<string, unknown>;
  for (const [path, value] of Object.entries(expected))
    expect(await api(path), path).toEqual(value);
  await expect(
    page.getByText("基准项目：雨夜来信", { exact: true }).first(),
  ).toBeVisible();
});

test("旧凭据保留，重新保存到本地文件后引擎可用且响应与日志不含明文", async () => {
  test.setTimeout(120_000);
  const { credentials, provider } = baseline;
  const status = await hostRemoteValue<{ storage?: string; locked?: boolean }>(
    access,
    "system/credentialStatus",
  );
  observed.push(JSON.stringify(status));
  expect(status.storage).toBe("local_file");
  expect(status.locked).toBe(false);
  const capture = application.waitForEvent("window");
  const session = await hostRemoteValue<{ captureSessionId: string }>(
    access,
    "system/createCredentialCaptureSession",
    {
      input: {
        purpose: "provider-authentication",
        allowedOrigin: baseline.model.origin,
        label: "重新保存测试接口密钥",
      },
    },
  );
  const unlock = await capture;
  await unlock.waitForLoadState("domcontentloaded");
  await unlock
    .getByRole("textbox", { name: "安全凭据", exact: true })
    .fill(credentials.fakeSecret);
  await Promise.all([
    unlock.waitForEvent("close"),
    unlock.getByRole("button", { name: "安全保存", exact: true }).click(),
  ]);
  const saved = await hostRemoteValue<{ credentialRef: string }>(
    access,
    "system/credentialSession",
    {
      captureSessionId: session.captureSessionId,
    },
  );
  const current = await api<{
    title: string;
    version: number;
    payload: Record<string, unknown>;
  }>(`/api/v2/providers/${provider.id}`);
  await hostRemoteValue(access, "agents/providersUpdate", {
    id: provider.id,
    input: {
      title: current.title,
      version: current.version,
      payload: { ...current.payload, 凭据引用: saved.credentialRef },
    },
    ifMatch: `"${current.version}"`,
    idempotencyKey: crypto.randomUUID(),
  });
  const tested = await api<{ ok: boolean; message: string }>(
    `/api/v2/providers/${provider.id}/test-connection`,
    { method: "POST" },
  );
  expect(tested.ok, tested.message).toBe(true);
  await api(`/api/v2/providers/${provider.id}/activate-for-agent`, {
    method: "POST",
  });
  // Each engine picks up the activated provider on its own schedule.
  for (const kind of ["pi"])
    await expect
      .poll(
        async () =>
          (
            await api<Array<{ kind: string; configurationStatus: string }>>(
              "/api/v2/agent-engines",
            )
          ).find((engine) => engine.kind === kind)?.configurationStatus,
        { message: kind, timeout: 30_000 },
      )
      .not.toBe("missing_credentials");
  // Every file the Host or shell wrote in its logs, too.
  const collectLogs = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(
      () => [],
    )) {
      if (entry.isDirectory()) await collectLogs(join(directory, entry.name));
      else if (entry.isFile())
        observed.push(await readFile(join(directory, entry.name), "utf8"));
    }
  };
  await collectLogs(join(userData, "logs"));
  // Whatever the engines sent the model carried the migrated credential.
  expect(modelRequests.filter((line) => !line.endsWith("fake-secret"))).toEqual(
    [],
  );
  const leaked = observed.filter((text) =>
    text.includes(credentials.fakeSecret),
  );
  expect(leaked).toEqual([]);
  expect(observed.length).toBeGreaterThan(5);
});

test("迁移不修改旧位置的数据", async () => {
  const listing = async (root: string): Promise<Record<string, string>> => {
    const files: Record<string, string> = {};
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else
          files[path.slice(root.length)] = (await readFile(path)).toString(
            "base64",
          );
      }
    };
    await walk(root);
    return files;
  };
  expect(await listing(legacy)).toEqual(await listing(FIXTURE));
});
