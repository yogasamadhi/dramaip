import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { LocalCredentialVault } from "../../capabilities/src/local-credential-vault.ts";
import {
  MARKER,
  MigrationError,
  migrateLegacyUserData,
  type MigrationFileSystem,
} from "./index";

const FIXTURE = fileURLToPath(
  new URL(
    "../../../../tests/fixtures/baseline-userdata/3.0.0-alpha.3",
    import.meta.url,
  ),
);

/** Every file under a directory with its digest, for byte-for-byte comparison. */
async function tree(root: string): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else
        entries[relative(root, path)] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
    }
  }
  await walk(root);
  return entries;
}

let scratch: string;
let legacy: string;
let home: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "dramaip-migration-"));
  legacy = join(scratch, "userData");
  home = join(scratch, "home");
  await cp(FIXTURE, legacy, { recursive: true });
  // The pre-refactor app also kept media and engine state here.
  await mkdir(join(legacy, "media-library"), { recursive: true });
  await writeFile(join(legacy, "media-library", "clip.mp4"), "media bytes");
  await mkdir(join(legacy, "agent-sessions", "pi"), { recursive: true });
  await writeFile(join(legacy, "agent-sessions", "pi", "s.jsonl"), "{}\n");
  // Retired engine state stays in the old home and must not be carried over.
  for (const directory of ["codex-engine", "codex-sessions"]) {
    await mkdir(join(legacy, directory));
    await writeFile(join(legacy, directory, "legacy-state.json"), "{}\n");
  }
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("D9 user data migration", () => {
  test("a fresh install has nothing to copy and records that", async () => {
    const empty = join(scratch, "empty-userData");
    await mkdir(empty);
    const result = await migrateLegacyUserData({ source: empty, home });
    expect(result).toMatchObject({
      status: "migrated",
      marker: { outcome: "fresh", copied: [] },
    });
    expect(Object.keys(await tree(home))).toEqual([MARKER]);
  });

  test("an upgrade copies the database, vault, media and engine state", async () => {
    const before = await tree(legacy);
    const result = await migrateLegacyUserData({ source: legacy, home });
    expect(result.marker.outcome).toBe("copied");
    expect(result.marker.copied).toEqual([
      join("storage", "dramaip.sqlite"),
      join("desktop", "credentials"),
      join("desktop", "media-library"),
      join("desktop", "agent-sessions"),
    ]);
    const copied = await tree(home);
    expect(copied[join("storage", "dramaip.sqlite")]).toBe(
      before["dramaip.db"],
    );
    expect(copied[join("desktop", "media-library", "clip.mp4")]).toBe(
      before[join("media-library", "clip.mp4")],
    );
    // Extension packages are not carried over (D7).
    expect(
      Object.keys(copied).some((path) => path.includes("extensions")),
    ).toBe(false);
    const manifest = JSON.parse(
      await readFile(join(FIXTURE, "baseline.json"), "utf8"),
    ) as {
      credentials: {
        password: string;
        credentialRef: string;
        fakeSecret: string;
      };
    };
    const vault = new LocalCredentialVault(
      join(home, "desktop", "credentials"),
      { storage: "master_password" },
    );
    await vault.unlock(manifest.credentials.password);
    expect(await vault.resolve(manifest.credentials.credentialRef)).toBe(
      manifest.credentials.fakeSecret,
    );
    await vault.lock();
    // Copy only: the old location is byte-for-byte what it was.
    expect(await tree(legacy)).toEqual(before);
  });

  test("running it again changes nothing", async () => {
    await migrateLegacyUserData({ source: legacy, home });
    const once = await tree(home);
    await writeFile(
      join(legacy, "media-library", "later.mp4"),
      "new in old app",
    );
    const again = await migrateLegacyUserData({ source: legacy, home });
    expect(again.status).toBe("already-migrated");
    expect(await tree(home)).toEqual(once);
  });

  test("a failure midway is reported, leaves the old data untouched and no partial home", async () => {
    const before = await tree(legacy);
    let copies = 0;
    const failing: MigrationFileSystem = {
      async copy(from, to) {
        copies += 1;
        if (copies === 3) throw new Error("disk full");
        await cp(from, to, { recursive: true });
      },
    };
    const failure = await migrateLegacyUserData({
      source: legacy,
      home,
      fileSystem: failing,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MigrationError);
    expect((failure as Error).message).toMatch(/旧数据未被修改.*disk full/u);
    expect(await tree(legacy)).toEqual(before);
    expect(await tree(home).catch(() => ({}))).toEqual({});
    // Nothing was recorded, so the next launch tries again and succeeds.
    const retry = await migrateLegacyUserData({ source: legacy, home });
    expect(retry.marker.outcome).toBe("copied");
  });

  test("a home that already has a database keeps it", async () => {
    await mkdir(join(home, "storage"), { recursive: true });
    await writeFile(join(home, "storage", "dramaip.sqlite"), "newer install");
    const result = await migrateLegacyUserData({ source: legacy, home });
    expect(result.marker.outcome).toBe("kept");
    expect(
      await readFile(join(home, "storage", "dramaip.sqlite"), "utf8"),
    ).toBe("newer install");
    await expect(stat(join(home, "desktop", "credentials"))).rejects.toThrow();
  });
});
