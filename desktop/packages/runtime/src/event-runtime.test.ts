import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  foundationMigrations,
  openDatabase,
  type DatabaseHandle,
} from "@dramaip/database";
import {
  DomainEventSchemaRegistry,
  PersistentEventRuntime,
} from "@dramaip/events";

const databases: DatabaseHandle[] = [];
const runtimes: PersistentEventRuntime[] = [];

function fixture(): {
  database: DatabaseHandle;
  events: PersistentEventRuntime;
  schemas: DomainEventSchemaRegistry;
} {
  const database = openDatabase(":memory:");
  applyMigrations(database.sqlite, foundationMigrations);
  const schemas = new DomainEventSchemaRegistry({
    "workspace.project-created.v1": { owner: "workspace" },
    "workspace.project-created.v2": { owner: "workspace" },
  });
  database.uow.setEventValidator((event) => schemas.validate(event));
  const events = new PersistentEventRuntime(database.uow, schemas);
  databases.push(database);
  runtimes.push(events);
  return { database, events, schemas };
}

afterEach(() => {
  while (runtimes.length > 0) runtimes.pop()!.dispose();
  while (databases.length > 0) databases.pop()!.close();
});

function appendTestEvent(database: DatabaseHandle, aggregateId: string): void {
  database.uow.execute((transaction) => {
    transaction.append({
      type: "workspace.project-created.v1",
      pluginId: "workspace",
      aggregateType: "project",
      aggregateId,
      aggregateVersion: 1,
      payload: { aggregateId },
    });
  });
}

async function eventually(
  assertion: () => void,
  timeout = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

describe("persistent event runtime", () => {
  it("notifies domain subscribers only after a successful commit", () => {
    const { database, events } = fixture();
    const received: number[] = [];
    events.subscribeDomain((event) => received.push(event.cursor));

    appendTestEvent(database, "committed");
    expect(received).toEqual([1]);

    expect(() =>
      database.uow.execute((transaction) => {
        transaction.append({
          type: "workspace.project-created.v1",
          pluginId: "workspace",
          aggregateType: "project",
          aggregateId: "rolled-back",
          aggregateVersion: 1,
          payload: {},
        });
        throw new Error("rollback");
      }),
    ).toThrow("rollback");

    expect(received).toEqual([1]);
    expect(events.replay(0)).toHaveLength(1);
  });

  it("retries failed durable delivery without advancing its checkpoint", async () => {
    const { database, events } = fixture();
    let attempts = 0;
    events.registerConsumer({
      id: "test.workspace-projection",
      pluginId: "test",
      critical: false,
      eventTypes: ["workspace.project-created.v1"],
      handle: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
      },
    });

    appendTestEvent(database, "retry");
    await eventually(() => {
      expect(attempts).toBe(2);
      expect(events.diagnostics()[0]).toMatchObject({
        checkpoint: 1,
        consecutiveFailures: 0,
        status: "healthy",
      });
    });
    expect(
      database.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM event_consumer_failures WHERE consumer_id = ?",
        )
        .get("test.workspace-projection"),
    ).toMatchObject({ count: 0 });
  });

  it("rejects undeclared and cross-owner events before ledger insertion", () => {
    const { database, events } = fixture();
    expect(() =>
      database.uow.execute((transaction) =>
        transaction.append({
          type: "workspace.undeclared.v1",
          pluginId: "workspace",
          aggregateType: "project",
          aggregateId: "p1",
          aggregateVersion: 1,
          payload: {},
        }),
      ),
    ).toThrow("undeclared domain event type");
    expect(() =>
      database.uow.execute((transaction) =>
        transaction.append({
          type: "workspace.project-created.v1",
          pluginId: "agents",
          aggregateType: "project",
          aggregateId: "p1",
          aggregateVersion: 1,
          payload: {},
        }),
      ),
    ).toThrow("domain event owner mismatch");
    expect(events.replay(0)).toHaveLength(0);
  });

  it("accepts only events covered by an owner-bound template declaration", () => {
    const schemas = new DomainEventSchemaRegistry({}, [
      {
        pattern: "^workspace\\.project-[a-z0-9-]+\\.v1$",
        owner: "workspace",
      },
    ]);
    expect(() =>
      schemas.validate({
        type: "workspace.project-demo-created.v1",
        pluginId: "workspace",
        aggregateType: "project",
        aggregateId: "p1",
        aggregateVersion: 1,
        payload: {},
      }),
    ).not.toThrow();
    expect(() =>
      schemas.validate({
        type: "workspace.series-created.v1",
        pluginId: "workspace",
        aggregateType: "series",
        aggregateId: "s1",
        aggregateVersion: 1,
        payload: {},
      }),
    ).toThrow("undeclared domain event type");
    expect(() =>
      schemas.validate({
        type: "workspace.project-demo-created.v1",
        pluginId: "agents",
        aggregateType: "project",
        aggregateId: "p1",
        aggregateVersion: 1,
        payload: {},
      }),
    ).toThrow("domain event owner mismatch");
  });

  it("upcasts a persisted event before replay and consumer delivery", () => {
    const { database, events, schemas } = fixture();
    schemas.registerUpcaster({
      fromType: "workspace.project-created.v1",
      toType: "workspace.project-created.v2",
      upcast: (payload) => ({ payload, schemaVersion: 2 }),
    });
    appendTestEvent(database, "upcasted");
    expect(events.replay(0)[0]).toMatchObject({
      type: "workspace.project-created.v2",
      payload: { schemaVersion: 2 },
    });
  });
});
