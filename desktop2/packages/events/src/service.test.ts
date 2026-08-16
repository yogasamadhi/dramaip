import assert from "node:assert/strict";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";

import { DatabaseRuntime, UnitOfWorkService } from "@dramaip/database";

import { EventRuntimeService } from "./service.ts";

test("durable consumers process globally ordered events and advance checkpoints", async () => {
  const ctx = new Context();
  const fiber = ctx.plugin((pluginContext) => {
    const database = new DatabaseRuntime(pluginContext, {
      filename: ":memory:",
      migrations: [],
    });
    const uow = new UnitOfWorkService(pluginContext, database);
    new EventRuntimeService(pluginContext, uow, 60_000);
  });
  await fiber;
  for (const aggregateId of ["one", "two"]) {
    ctx.uow.execute((tx) => {
      tx.append({
        type: "test.record-created.v1",
        pluginId: "test",
        aggregateType: "record",
        aggregateId,
        aggregateVersion: 1,
        payload: { aggregateId },
      });
    });
  }

  const seen: string[] = [];
  const dispose = ctx.eventRuntime.registerConsumer({
    id: "test-consumer",
    pluginId: "test",
    critical: true,
    handle(event) {
      seen.push(event.aggregateId);
    },
  });
  await ctx.eventRuntime.drain();
  assert.deepEqual(seen, ["one", "two"]);
  assert.equal(ctx.eventRuntime.diagnostics()[0]?.checkpoint, 2);
  await dispose();
  await fiber.dispose();
});

test("live events are not written to durable storage", async () => {
  const ctx = new Context();
  const fiber = ctx.plugin((pluginContext) => {
    const database = new DatabaseRuntime(pluginContext, {
      filename: ":memory:",
      migrations: [],
    });
    const uow = new UnitOfWorkService(pluginContext, database);
    new EventRuntimeService(pluginContext, uow, 60_000);
  });
  await fiber;
  let count = 0;
  const unsubscribe = ctx.eventRuntime.subscribeLive(() => count++);
  ctx.eventRuntime.publishLive({
    type: "agent.token-delta",
    payload: { delta: "hello" },
  });
  assert.equal(count, 1);
  assert.equal(ctx.eventRuntime.replay(0).length, 0);
  unsubscribe();
  await fiber.dispose();
});
