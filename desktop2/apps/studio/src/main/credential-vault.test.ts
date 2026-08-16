import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CredentialVault } from "./credential-vault.ts";

test("credential vault stores only AES-256-GCM ciphertext and removes records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-next-vault-"));
  try {
    const vault = new CredentialVault(directory);
    const secret = "sk-test-secret-must-never-be-plaintext";
    const { credentialRef } = await vault.store(secret);
    const recordPath = join(directory, "records", `${credentialRef}.json`);
    const record = await readFile(recordPath, "utf8");
    assert.equal(record.includes(secret), false);
    assert.equal(
      (await readFile(join(directory, "master-key.bin"))).length,
      32,
    );
    assert.equal(await vault.resolve(credentialRef), secret);
    await vault.remove(credentialRef);
    assert.equal(await vault.resolve(credentialRef), undefined);
    assert.deepEqual(await readdir(join(directory, "records")), []);
    await assert.rejects(() => vault.resolve("../../escape"), /credentialRef/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
