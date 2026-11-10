/**
 * D9 user data migration. On the first launch of the new Desktop the Host
 * copies the pre-refactor Electron user data (database, credential vault,
 * media and engine state) into the DramaIP home and records a completion
 * marker. Nothing in the old location is moved, rewritten or deleted, so the
 * previous version still opens it. It runs before the Profile's Loader
 * starts, because the storage plugins open the migrated database.
 * @module @dramaip/host-migration
 */

import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/** Database file of the pre-refactor userData and its target in the home. */
const DATABASE = { from: "dramaip.db", to: join("storage", "dramaip.sqlite") };

/** SQLite companions that hold committed pages until a checkpoint. */
const DATABASE_COMPANIONS = ["-wal", "-shm"] as const;

/**
 * Directories of the pre-refactor userData that the Desktop Host keeps under
 * `<home>/desktop/` with the same names. Extension packages are not carried
 * over: the extension platform is gone (D7).
 */
export const MIGRATED_DIRECTORIES = [
  "credentials",
  "media-library",
  "nle-copy-jobs",
  "agent-sessions",
  "renderer-sidecars",
  "renderer-fonts",
  "backups",
] as const;

/** Where the completion marker lives in the home. */
export const MARKER = join("desktop", "migration.json");

/** The completion marker. */
export interface MigrationMarker {
  readonly schemaVersion: 1;
  /** `copied`: the old data was copied; `fresh`: there was none; `kept`: the home already had a database. */
  readonly outcome: "copied" | "fresh" | "kept";
  readonly source: string;
  /** Home-relative paths written by the migration. */
  readonly copied: readonly string[];
  readonly completedAt: string;
}

/** What one launch did. */
export type MigrationResult =
  | { readonly status: "already-migrated"; readonly marker: MigrationMarker }
  | { readonly status: "migrated"; readonly marker: MigrationMarker };

/** A failed migration: the old data is untouched and the home has no partial copy. */
export class MigrationError extends Error {
  override readonly name = "MigrationError";
  constructor(
    message: string,
    override readonly cause: unknown,
  ) {
    super(message);
  }
}

/** File operations the migration performs; tests replace them to inject failures. */
export interface MigrationFileSystem {
  copy(from: string, to: string): Promise<void>;
}

const NODE_FILE_SYSTEM: MigrationFileSystem = {
  copy: (from, to) =>
    cp(from, to, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    }),
};

/** How to migrate. */
export interface MigrationOptions {
  /** The pre-refactor Electron userData directory. */
  readonly source: string;
  /** The DramaIP home the Host runs in. */
  readonly home: string;
  readonly fileSystem?: MigrationFileSystem;
  readonly now?: () => Date;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readMarker(home: string): Promise<MigrationMarker | undefined> {
  try {
    return JSON.parse(
      await readFile(join(home, MARKER), "utf8"),
    ) as MigrationMarker;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new MigrationError(
      `用户数据迁移标记无法读取：${join(home, MARKER)}`,
      error,
    );
  }
}

/** The copy plan: home-relative target by absolute source, for what exists. */
async function plan(
  source: string,
): Promise<Array<{ from: string; to: string }>> {
  const items: Array<{ from: string; to: string }> = [];
  if (await exists(join(source, DATABASE.from))) {
    items.push({ from: join(source, DATABASE.from), to: DATABASE.to });
    for (const suffix of DATABASE_COMPANIONS)
      if (await exists(join(source, `${DATABASE.from}${suffix}`)))
        items.push({
          from: join(source, `${DATABASE.from}${suffix}`),
          to: `${DATABASE.to}${suffix}`,
        });
  }
  for (const directory of MIGRATED_DIRECTORIES)
    if (await exists(join(source, directory)))
      items.push({
        from: join(source, directory),
        to: join("desktop", directory),
      });
  return items;
}

async function complete(
  home: string,
  marker: MigrationMarker,
): Promise<MigrationResult> {
  await mkdir(join(home, "desktop"), { recursive: true });
  const path = join(home, MARKER);
  await writeFile(`${path}.tmp`, `${JSON.stringify(marker, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(`${path}.tmp`, path);
  return { status: "migrated", marker };
}

/**
 * Copy the old user data into the home once.
 * @param options - source, home and test seams.
 * @returns what this launch did.
 * @throws MigrationError when copying fails; the home then has none of it.
 */
export async function migrateLegacyUserData(
  options: MigrationOptions,
): Promise<MigrationResult> {
  const source = resolve(options.source);
  const home = resolve(options.home);
  const now = options.now ?? (() => new Date());
  const fileSystem = options.fileSystem ?? NODE_FILE_SYSTEM;
  const marker = await readMarker(home);
  if (marker) return { status: "already-migrated", marker };
  const base = { schemaVersion: 1 as const, source };
  if (source === home || relative(source, home) === "")
    return complete(home, {
      ...base,
      outcome: "fresh",
      copied: [],
      completedAt: now().toISOString(),
    });
  const items = await plan(source);
  if (items.length === 0)
    return complete(home, {
      ...base,
      outcome: "fresh",
      copied: [],
      completedAt: now().toISOString(),
    });
  // A home that already holds a database belongs to a newer install; never
  // mix the old data into it.
  if (await exists(join(home, DATABASE.to)))
    return complete(home, {
      ...base,
      outcome: "kept",
      copied: [],
      completedAt: now().toISOString(),
    });
  const blocked = [];
  for (const item of items)
    if (await exists(join(home, item.to))) blocked.push(item.to);
  if (blocked.length > 0)
    throw new MigrationError(
      `用户数据迁移的目标已存在，未覆盖：${blocked.join("、")}`,
      undefined,
    );
  // Everything lands in a staging directory first and moves into place only
  // once every copy succeeded, so a failure leaves no partial home.
  const staging = join(home, `.migration-${process.pid}-${now().getTime()}`);
  const moved: string[] = [];
  try {
    for (const item of items) {
      await mkdir(join(staging, item.to, ".."), { recursive: true });
      await fileSystem.copy(item.from, join(staging, item.to));
    }
    for (const item of items) {
      await mkdir(join(home, item.to, ".."), { recursive: true });
      await rename(join(staging, item.to), join(home, item.to));
      moved.push(item.to);
    }
  } catch (error) {
    // Whatever already moved into place goes back out: no partial home.
    for (const target of moved)
      await rm(join(home, target), { recursive: true, force: true });
    throw new MigrationError(
      `用户数据迁移失败，旧数据未被修改：${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return complete(home, {
    ...base,
    outcome: "copied",
    copied: items.map((item) => item.to),
    completedAt: now().toISOString(),
  });
}
