import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  findOwnershipViolations,
  readPluginSources,
} from "../check-ownership.mjs";

const bases = [];
after(() =>
  Promise.all(bases.map((base) => rm(base, { recursive: true, force: true }))),
);

async function workspace(files) {
  const base = await mkdtemp(join(tmpdir(), "dramaip-ownership-"));
  bases.push(base);
  for (const [path, source] of Object.entries(files)) {
    const target = join(base, "plugins", path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, source);
  }
  return base;
}

async function violations(files) {
  const base = await workspace(files);
  return findOwnershipViolations(
    await readPluginSources(join(base, "plugins")),
    base,
  );
}

const ownTables = {
  "review/src/migrations.ts":
    "export const sql = `CREATE TABLE IF NOT EXISTS review_records (id TEXT)`;",
  "media/src/migrations.ts":
    "export const sql = `CREATE TABLE media_assets (id TEXT)`;",
};

test("accepts plugins that stay inside their own tables, imports and events", async () => {
  assert.deepEqual(
    await violations({
      ...ownTables,
      "review/src/index.ts": [
        'import type { PluginContext } from "@dramaip/plugin-api/internal";',
        'import { local } from "./local.js";',
        "const read = `SELECT * FROM review_records`;",
        'const event = { type: "review.record-saved.v1" };',
      ].join("\n"),
    }),
    [],
  );
});

test("rejects a table declared by two plugins", async () => {
  assert.deepEqual(
    await violations({
      ...ownTables,
      "media/src/copy.ts":
        "const sql = `CREATE TABLE review_records (id TEXT)`;",
    }),
    ["table review_records has several owners: media, review"],
  );
});

test("rejects SQL against another plugin's table and dynamic write targets", async () => {
  assert.deepEqual(
    await violations({
      ...ownTables,
      "media/src/index.ts":
        "const a = `UPDATE review_records SET id = ?`;\nconst b = `DELETE FROM ${table}`;",
    }),
    [
      "plugins/media/src/index.ts: dynamic SQL write target",
      "plugins/media/src/index.ts: SQL touches review_records owned by review",
    ],
  );
});

test("rejects sibling imports by package name and by relative path", async () => {
  assert.deepEqual(
    await violations({
      ...ownTables,
      "media/src/index.ts": [
        'import { x } from "@dramaip/review";',
        'import { y } from "../../review/src/index.js";',
      ].join("\n"),
    }),
    [
      "plugins/media/src/index.ts: imports @dramaip/review across the ownership boundary",
      "plugins/media/src/index.ts: imports sibling plugin review by relative path",
    ],
  );
});

test("rejects a domain event that another plugin's id prefixes", async () => {
  assert.deepEqual(
    await violations({
      ...ownTables,
      "media/src/events.ts": 'const event = { type: "review.asset-added.v1" };',
    }),
    [
      "plugins/media/src/events.ts: domain event review.asset-added.v1 is not prefixed by media",
    ],
  );
});
