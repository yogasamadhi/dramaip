import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { foundationMigrations } from "@dramaip/database";
import type { PluginMigration } from "@dramaip/plugin-api/internal";
import * as StorageRelational from "../src/index.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dramaip-relational-"));
  directories.push(directory);
  return join(directory, "relational.sqlite");
}

const notes: PluginMigration = {
  id: "notes.0001.notes",
  pluginId: "notes",
  version: "1.0.0",
  dependsOn: ["foundation.0001.runtime-ledger"],
  sql: "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL);",
};
const tags: PluginMigration = {
  id: "tags.0001.tags",
  pluginId: "tags",
  version: "1.0.0",
  dependsOn: ["notes.0001.notes"],
  sql: "CREATE TABLE tags (note_id TEXT NOT NULL REFERENCES notes(id), tag TEXT NOT NULL);",
};

async function mount(
  path: string,
): Promise<{ ctx: Context; storage: StorageRelational.RelationalStorage }> {
  const ctx = new Context();
  const fiber = ctx.plugin(StorageRelational, { path });
  await fiber.await();
  return { ctx, storage: ctx.get("relationalStorage")! };
}

describe("relational storage backend", () => {
  it("provides the unit of work and applies declared migrations in dependency order", async () => {
    const { ctx, storage } = await mount(":memory:");
    storage.declare("foundation", foundationMigrations);
    storage.declare("notes", [notes]);
    expect(storage.declare("tags", [tags]).appliedCount).toBe(1);
    ctx.get("uow")!.execute((transaction) => {
      transaction.run("INSERT INTO notes VALUES (?, ?)", "n1", "draft");
      transaction.run("INSERT INTO tags VALUES (?, ?)", "n1", "act-one");
    });
    expect(
      ctx
        .get("uow")!
        .execute((transaction) =>
          transaction.all<{ tag: string }>("SELECT tag FROM tags"),
        ),
    ).toEqual([{ tag: "act-one" }]);
    expect(storage.applied().map((entry) => entry.migrationId)).toEqual(
      expect.arrayContaining([notes.id, tags.id]),
    );
    expect(storage.declarations().map((entry) => entry.owner)).toEqual([
      "foundation",
      "notes",
      "tags",
    ]);
    await ctx.fiber.dispose();
  });

  it("rejects a migration that names another owner", async () => {
    const { ctx, storage } = await mount(":memory:");
    expect(() => storage.declare("tags", [notes])).toThrow(
      /declares notes, not tags/u,
    );
    await ctx.fiber.dispose();
  });

  it("rejects a dependency on a domain not declared yet", async () => {
    const { ctx, storage } = await mount(":memory:");
    storage.declare("foundation", foundationMigrations);
    expect(() => storage.declare("tags", [tags])).toThrow(
      /missing migration dependency: notes\.0001\.notes/u,
    );
    await ctx.fiber.dispose();
  });

  it("accepts a repeated identical declaration and rejects a changed one", async () => {
    const { ctx, storage } = await mount(":memory:");
    storage.declare("foundation", foundationMigrations);
    const first = storage.declare("notes", [notes]);
    expect(storage.declare("notes", [notes])).toBe(first);
    expect(() =>
      storage.declare("notes", [
        notes,
        { ...notes, id: "notes.0002.index", sql: "SELECT 1;" },
      ]),
    ).toThrow(/notes changed its migrations/u);
    await ctx.fiber.dispose();
  });

  it("backs up an existing database before applying pending migrations, and closes on disposal", async () => {
    const path = await databasePath();
    const first = await mount(path);
    first.storage.declare("foundation", foundationMigrations);
    // The file was created by this process: nothing earlier to protect.
    expect(first.storage.declare("notes", [notes])).toMatchObject({
      pendingCount: 1,
      dryRun: false,
    });
    expect(first.storage.declare("notes", [notes]).backup).toBeUndefined();
    await first.ctx.fiber.dispose();

    const second = await mount(path);
    expect(
      second.storage.declare("foundation", foundationMigrations).pendingCount,
    ).toBe(0);
    expect(second.storage.declare("notes", [notes]).pendingCount).toBe(0);
    const run = second.storage.declare("tags", [tags]);
    expect(run).toMatchObject({ pendingCount: 1, dryRun: true });
    expect(run.backup?.fileName).toBeDefined();
    expect(await readdir(join(path, "..", "backups"))).toContain(
      run.backup!.fileName,
    );
    await second.ctx.fiber.dispose();

    // Disposal closed the connection: an exclusive lock is available again.
    const probe = new DatabaseSync(path);
    probe.exec("BEGIN EXCLUSIVE; COMMIT;");
    probe.close();
  });
});
