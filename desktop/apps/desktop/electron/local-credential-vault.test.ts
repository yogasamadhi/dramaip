import { expect, test } from "vitest";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalCredentialVault,
  type VaultKeyProtector,
} from "./local-credential-vault";

const TEST_MASK = 0xa5;
const testProtector: VaultKeyProtector = {
  async status() {
    return {
      available: true,
      secure: true,
      backend: "test-secret-service",
    };
  },
  async protect(value) {
    return Buffer.from(value.map((byte) => byte ^ TEST_MASK));
  },
  async unprotect(value) {
    return Buffer.from(value.map((byte) => byte ^ TEST_MASK));
  },
};

test("凭据库 v2 使用受保护 key envelope 加密、读取并删除凭据", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-vault-"));
  try {
    const vault = new LocalCredentialVault(directory, {
      keyProtector: testProtector,
    });
    expect(await vault.status()).toMatchObject({
      available: true,
      storage: "os_safe_storage",
      backend: "test-secret-service",
      locked: false,
      migrationState: "complete",
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
    expect(records).not.toContain("vault.key");
    const encryptedRecord = records.find((entry) => entry.endsWith(".vault"));
    expect(encryptedRecord).toBeDefined();
    expect(
      await readFile(join(directory, encryptedRecord!), "utf8"),
    ).not.toContain(secret);
    expect(
      await readFile(join(directory, "vault.key.json"), "utf8"),
    ).not.toContain(secret);

    await vault.remove(credentialRef);
    expect(await vault.resolve(credentialRef)).toBeUndefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("无安全系统后端时要求每次启动用主密码解锁", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-vault-master-"));
  try {
    const first = new LocalCredentialVault(directory);
    expect(await first.status()).toMatchObject({
      available: false,
      storage: "master_password",
      locked: true,
    });
    await first.unlock("correct horse battery staple");
    const stored = await first.store("master-protected-secret");
    await first.lock();
    expect(await first.status()).toMatchObject({
      available: false,
      locked: true,
    });

    const reopened = new LocalCredentialVault(directory);
    await expect(reopened.unlock("incorrect password")).rejects.toThrow();
    await reopened.unlock("correct horse battery staple");
    expect(await reopened.resolve(stored.credentialRef)).toBe(
      "master-protected-secret",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("旧裸 key 凭据库前向迁移、验证并保留恢复副本", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-vault-v1-"));
  try {
    const key = randomBytes(32);
    const credentialRef = randomUUID();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(credentialRef, "utf8"));
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from("legacy-secret", "utf8")),
      cipher.final(),
    ]);
    await writeFile(join(directory, "vault.key"), key, { mode: 0o600 });
    await writeFile(
      join(directory, `${credentialRef}.vault`),
      Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]),
      { mode: 0o600 },
    );

    const vault = new LocalCredentialVault(directory, {
      keyProtector: testProtector,
    });
    expect(await vault.resolve(credentialRef)).toBe("legacy-secret");
    expect((await readFile(join(directory, `${credentialRef}.vault`)))[0]).toBe(
      2,
    );
    expect(await readdir(directory)).not.toContain("vault.key");
    expect(await readdir(join(directory, "vault-v1-backup"))).toEqual(
      expect.arrayContaining(["vault.key", `${credentialRef}.vault`]),
    );
    expect(await vault.status()).toMatchObject({
      migrationState: "complete",
      available: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
