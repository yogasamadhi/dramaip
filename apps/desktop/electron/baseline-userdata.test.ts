import { describe, expect, test } from "vitest";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalCredentialVault } from "../../../packages/host/capabilities/src/local-credential-vault.ts";

const fixture = fileURLToPath(
  new URL(
    "../../../tests/fixtures/baseline-userdata/3.0.0-alpha.3",
    import.meta.url,
  ),
);

interface BaselineManifest {
  version: string;
  project: { id: string };
  chapters: string[];
  provider: { payload: Record<string, string> };
  credentials: {
    storage: string;
    password: string;
    credentialRef: string;
    fakeSecret: string;
  };
}

describe("P0 baseline user data", () => {
  test("is the alpha.3 userData the migration tests start from", async () => {
    const manifest = JSON.parse(
      await readFile(join(fixture, "baseline.json"), "utf8"),
    ) as BaselineManifest;
    expect(manifest.version).toBe("3.0.0-alpha.3");
    expect(manifest.chapters).toHaveLength(3);
    expect(manifest.provider.payload["凭据引用"]).toBe(
      manifest.credentials.credentialRef,
    );
    const readback = JSON.parse(
      await readFile(join(fixture, "readback.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(readback)).toContain(
      `/api/v2/projects/${manifest.project.id}`,
    );
  });

  test("keeps a portable vault whose fake credential resolves", async () => {
    const manifest = JSON.parse(
      await readFile(join(fixture, "baseline.json"), "utf8"),
    ) as BaselineManifest;
    // The vault may rewrite its envelope on unlock; never touch the fixture.
    const copy = await mkdtemp(join(tmpdir(), "dramaip-baseline-vault-"));
    try {
      await cp(join(fixture, "credentials"), copy, { recursive: true });
      const vault = new LocalCredentialVault(copy, {
        storage: "master_password",
      });
      expect((await vault.status()).storage).toBe(manifest.credentials.storage);
      await vault.unlock(manifest.credentials.password);
      expect(await vault.resolve(manifest.credentials.credentialRef)).toBe(
        manifest.credentials.fakeSecret,
      );
      await vault.lock();
    } finally {
      await rm(copy, { recursive: true, force: true });
    }
  });
});
