import { expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShellBridge } from "@dramaip/host-shell-bridge";
import { HostCredentials } from "./credentials";

test("设置读取凭据状态及保存重开均不请求系统存储桥接", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "dramaip-host-file-credentials-"),
  );
  const request = vi.fn(() => {
    throw new Error("Unexpected shell request");
  });
  const shell = { request } as unknown as ShellBridge;
  try {
    const credentials = new HostCredentials(directory, shell);
    expect(await credentials.credentialStorageStatus()).toMatchObject({
      available: true,
      storage: "local_file",
      locked: false,
    });
    const stored = await credentials.vault.store("fake-provider-secret");
    await credentials.vault.lock();
    const reopened = new HostCredentials(directory, shell);
    expect(await reopened.resolve(stored.credentialRef)).toBe(
      "fake-provider-secret",
    );
    expect(request).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
