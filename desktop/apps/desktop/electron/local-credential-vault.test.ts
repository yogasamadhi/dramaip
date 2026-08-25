import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalCredentialVault } from "./local-credential-vault";

test("本地凭据库加密保存、读取并删除凭据", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-vault-"));
  try {
    const vault = new LocalCredentialVault(directory);
    expect(await vault.status()).toMatchObject({
      available: true,
      storage: "local_encrypted_file",
    });

    const secret = "dramaip-test-secret";
    const { credentialRef } = await vault.store(secret, {
      purpose: "provider-authentication",
      policyId: "provider.catalog.openai",
      allowedOrigin: "https://api.openai.com/v1",
    });
    expect(
      await vault.resolve(credentialRef, {
        purpose: "provider-authentication",
        origin: "https://api.openai.com",
      }),
    ).toBe(secret);
    expect(
      await vault.resolve(credentialRef, {
        purpose: "provider-authentication",
        origin: "https://example.invalid",
      }),
    ).toBeUndefined();

    const records = await readdir(directory);
    const encryptedRecord = records.find((entry) => entry.endsWith(".vault"));
    expect(encryptedRecord).toBeDefined();
    expect(
      await readFile(join(directory, encryptedRecord!), "utf8"),
    ).not.toContain(secret);
    expect(
      await readFile(join(directory, `${credentialRef}.policy.json`), "utf8"),
    ).not.toContain(secret);

    await vault.remove(credentialRef);
    expect(await vault.resolve(credentialRef)).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
