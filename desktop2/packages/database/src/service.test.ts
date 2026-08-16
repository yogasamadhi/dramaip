import assert from "node:assert/strict";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";

import { DatabaseRuntime, UnitOfWorkService } from "./service.ts";

test("UnitOfWork rolls back authoritative state and event together", async () => {
  const ctx = new Context();
  const fiber = ctx.plugin((pluginContext) => {
    const database = new DatabaseRuntime(pluginContext, {
      filename: ":memory:",
      migrations: [],
    });
    database.sqlite.exec("CREATE TABLE records (id TEXT PRIMARY KEY)");
    new UnitOfWorkService(pluginContext, database);
  });
  await fiber;

  assert.throws(() =>
    ctx.uow.execute((tx) => {
      tx.run("INSERT INTO records (id) VALUES (?)", "one");
      tx.append({
        type: "test.record-created.v1",
        pluginId: "test",
        aggregateType: "record",
        aggregateId: "one",
        aggregateVersion: 1,
        payload: { id: "one" },
      });
      throw new Error("rollback");
    }),
  );

  assert.equal(
    ctx.database.sqlite.prepare("SELECT count(*) AS count FROM records").get()!
      .count,
    0,
  );
  assert.equal(
    ctx.database.sqlite
      .prepare("SELECT count(*) AS count FROM domain_events")
      .get()!.count,
    0,
  );
  await fiber.dispose();
});
