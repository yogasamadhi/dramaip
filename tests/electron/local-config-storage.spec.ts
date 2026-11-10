import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { electron, hostAccess, hostRemoteValue } from "./desktop-host";

test("点击设置使用本地配置目录，凭据保存后重启可用且不访问系统钥匙串", async () => {
  test.setTimeout(120_000);
  const home = await mkdtemp(join(tmpdir(), "dramaip-local-config-e2e-"));
  const launch = () =>
    electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, DRAMAIP_E2E_USER_DATA: home },
    });
  let application = await launch();
  try {
    let page = await application.firstWindow();
    await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible(
      { timeout: 60_000 },
    );
    await application.evaluate(({ safeStorage }) => {
      // A regression fails the request instead of displaying an OS dialog.
      safeStorage.isEncryptionAvailable = () => {
        throw new Error("Forbidden OS keychain probe");
      };
      safeStorage.encryptString = () => {
        throw new Error("Forbidden OS keychain write");
      };
      safeStorage.decryptString = () => {
        throw new Error("Forbidden OS keychain read");
      };
    });
    await page.getByRole("link", { name: "设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "设置中心" })).toBeVisible();
    const access = await hostAccess(application);
    expect(
      await hostRemoteValue(access, "system/credentialStatus"),
    ).toMatchObject({
      available: true,
      storage: "local_file",
      backend: "local_file",
      locked: false,
    });
    const paths = await application.evaluate(({ app }) => ({
      data: app.getPath("userData"),
      session: app.getPath("sessionData"),
      logs: app.getPath("logs"),
    }));
    expect(paths).toEqual({
      data: home,
      session: home,
      logs: join(home, "logs", "electron"),
    });
    const opened = application.waitForEvent("window");
    const session = await hostRemoteValue<{ captureSessionId: string }>(
      access,
      "system/createCredentialCaptureSession",
      {
        input: {
          purpose: "local-storage-regression",
          label: "本地文件存储测试",
        },
      },
    );
    const capture = await opened;
    await capture.waitForLoadState("domcontentloaded");
    const fakeSecret = "fake-only-local-storage-check";
    await capture
      .getByRole("textbox", { name: "安全凭据", exact: true })
      .fill(fakeSecret);
    await Promise.all([
      capture.waitForEvent("close"),
      capture.getByRole("button", { name: "安全保存", exact: true }).click(),
    ]);
    const saved = await hostRemoteValue<{
      status: string;
      credentialRef: string;
    }>(access, "system/credentialSession", {
      captureSessionId: session.captureSessionId,
    });
    expect(saved.status).toBe("completed");
    const directory = join(home, "desktop", "credentials");
    const key = await readFile(join(directory, "vault.local.key"));
    const record = await readFile(
      join(directory, `${saved.credentialRef}.vault`),
    );
    expect(record.toString("utf8")).not.toContain(fakeSecret);
    if (process.platform !== "win32")
      expect(
        (await stat(join(directory, "vault.local.key"))).mode & 0o777,
      ).toBe(0o600);
    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await expect(page.getByRole("heading", { name: "项目工作台" })).toBeVisible(
      { timeout: 60_000 },
    );
    expect(
      await hostRemoteValue(
        await hostAccess(application),
        "system/credentialStatus",
      ),
    ).toMatchObject({ available: true, storage: "local_file", locked: false });
    expect(await readFile(join(directory, "vault.local.key"))).toEqual(key);
    expect(
      await readFile(join(directory, `${saved.credentialRef}.vault`)),
    ).toEqual(record);
  } finally {
    await application.close();
    await rm(home, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
});
