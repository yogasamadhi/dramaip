import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  applyMigrations,
  foundationMigrations,
  sortMigrations,
} from "./migrations.ts";

test("migrations sort by dependencies and reject cycles", () => {
  const migration = (id: string, dependsOn: string[]) => ({
    id,
    pluginId: "test",
    version: "1",
    dependsOn,
    sql: `CREATE TABLE ${id} (id TEXT);`,
  });
  assert.deepEqual(
    sortMigrations([
      migration("second", ["first"]),
      migration("first", []),
    ]).map((item) => item.id),
    ["first", "second"],
  );
  assert.throws(
    () => sortMigrations([migration("a", ["b"]), migration("b", ["a"])]),
    /cycle/,
  );
});

test("applied migration checksum cannot drift", () => {
  const database = new DatabaseSync(":memory:");
  applyMigrations(database, foundationMigrations);
  const changed = [
    {
      ...foundationMigrations[0]!,
      sql: `${foundationMigrations[0]!.sql}\nSELECT 1;`,
    },
  ];
  assert.throws(() => applyMigrations(database, changed), /checksum changed/);
  database.close();
});
