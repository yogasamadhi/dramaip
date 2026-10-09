import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { normalizeAgentUsage } from "@dramaip/contracts";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { foundationPlugin } from "@dramaip/foundation";
import { agentMigrations } from "../../../plugins/agents/src/migrations/index.js";
import {
  recordAgentUsage,
  readAgentUsagePage,
  createAgentUsageObservation,
} from "../../../plugins/agents/src/runs/usage.js";
import { AgentUsageObservationSchema } from "@dramaip/contracts";
import { readAgentRunExecution } from "../../../plugins/agents/src/runs/execution.js";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function fixture(includeUsageMigration = true) {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-agent-usage-"));
  paths.push(directory);
  const path = join(directory, "usage.db");
  const database = openDatabase(path);
  applyMigrations(database.sqlite, [
    ...foundationPlugin.migrations!,
    ...agentMigrations.filter(
      (migration) => includeUsageMigration || migration.id < "agents.0013.",
    ),
  ]);
  const at = "2026-10-04T00:00:00.000Z";
  database.uow.execute((tx) => {
    for (const [session, run, project] of [
      ["session", "run", "project"],
      ["other-session", "other-run", "other-project"],
      ["global-session", "global-run", null],
    ]) {
      tx.run(
        "INSERT INTO agent_assistant_sessions(id, engine_session_id, engine_kind, project_id, surface, status, last_opened_at, created_at, updated_at) VALUES (?, ?, 'pi', ?, 'chat', 'idle', ?, ?, ?)",
        session,
        session,
        project,
        at,
        at,
        at,
      );
      tx.run(
        "INSERT INTO agent_assistant_runs(id, session_id, task_id, task_type, engine_kind, status, engine_run_id, created_at, updated_at) VALUES (?, ?, ?, 'chat', 'pi', 'completed', ?, ?, ?)",
        run,
        session,
        run,
        run,
        at,
        at,
      );
    }
  });
  return { database, path, at };
}

describe("Agents immutable usage observations", () => {
  it("reads only persisted model and actual run clocks, preserves unknown or invalid values, and never reads credentials or present defaults", () => {
    const { database, path, at } = fixture();
    const read = () =>
      database.uow.execute((tx) => readAgentRunExecution(tx, "run", "project"));
    expect(read()).toMatchObject({
      model: { status: "unrecorded" },
      timing: { status: "unrecorded" },
    });
    database.uow.execute((tx) =>
      tx.run(
        "UPDATE agent_assistant_runs SET model_json=?, started_at=?, completed_at=? WHERE id='run'",
        JSON.stringify({
          modelId: "historical-model",
          providerId: "historical-provider",
          profileId: "historical-profile",
          apiKey: "PRIVATE-KEY",
          prompt: "PRIVATE-BODY",
        }),
        at,
        at,
      ),
    );
    const actual = read()!;
    expect(actual).toMatchObject({
      model: {
        status: "recorded",
        modelId: "historical-model",
        providerId: "historical-provider",
        profileId: "historical-profile",
      },
      timing: {
        status: "measured",
        durationMs: 0,
        startedAt: at,
        completedAt: at,
      },
    });
    expect(JSON.stringify(actual)).not.toContain("PRIVATE");
    expect(
      database.uow.execute((tx) =>
        readAgentRunExecution(tx, "run", "other-project"),
      ),
    ).toBeUndefined();
    database.close();
    const reopened = openDatabase(path);
    try {
      expect(
        reopened.uow.execute((tx) =>
          readAgentRunExecution(tx, "run", "project"),
        ),
      ).toEqual(actual);
      for (const [
        model,
        started,
        completed,
        status,
        expectedModel,
        expectedTiming,
      ] of [
        [
          "invalid-json",
          at,
          "2026-10-03T00:00:00.000Z",
          "completed",
          "invalid",
          "invalid",
        ],
        [
          JSON.stringify({ modelId: 42 }),
          "bad-clock",
          at,
          "completed",
          "invalid",
          "invalid",
        ],
        [
          JSON.stringify({ providerId: "not-a-model" }),
          at,
          null,
          "completed",
          "unrecorded",
          "unrecorded",
        ],
        [null, at, null, "running", "unrecorded", "in-progress"],
      ] as const) {
        reopened.uow.execute((tx) =>
          tx.run(
            "UPDATE agent_assistant_runs SET model_json=?, started_at=?, completed_at=?, status=? WHERE id='run'",
            model,
            started,
            completed,
            status,
          ),
        );
        const value = reopened.uow.execute((tx) =>
          readAgentRunExecution(tx, "run", "project"),
        )!;
        expect(value.model.status).toBe(expectedModel);
        expect(value.timing.status).toBe(expectedTiming);
      }
    } finally {
      reopened.close();
    }
  });
  it("keeps reported cost zero, missing amount/currency and invalid estimates distinct without a billing claim or private data", () => {
    const observation = (usage: unknown) =>
      createAgentUsageObservation({
        runId: "run",
        sessionId: "session",
        projectId: "project",
        engineKind: "pi",
        cursor: 1,
        usage,
        recordedAt: "2026-10-06T03:00:00.000Z",
      });
    expect(
      observation({ estimatedCost: 0, currency: "USD" }).costEstimate,
    ).toEqual({
      source: "engine-reported-estimate",
      amount: { status: "reported", value: 0 },
      currency: { status: "reported", value: "USD" },
      billingStatus: "unknown",
    });
    expect(observation({ estimatedCost: 0.125 }).costEstimate).toMatchObject({
      amount: { status: "reported", value: 0.125 },
      currency: { status: "unreported" },
    });
    expect(observation({ currency: "EUR" }).costEstimate).toMatchObject({
      amount: { status: "unreported" },
      currency: { status: "reported", value: "EUR" },
    });
    expect(observation({}).costEstimate).toMatchObject({
      amount: { status: "unreported" },
      currency: { status: "unreported" },
    });
    for (const invalid of [-1, Infinity, NaN, null, "0", {}]) {
      const raw = {
        estimatedCost: invalid,
        currency: "PRIVATE-CURRENCY",
        prompt: "PRIVATE-BODY",
      };
      const normalized = normalizeAgentUsage(raw);
      expect(normalizeAgentUsage(normalized)).toEqual(normalized);
      const value = observation(normalized);
      expect(value.costEstimate).toMatchObject({
        amount: { status: "invalid" },
        currency: { status: "invalid" },
        billingStatus: "unknown",
      });
      expect(JSON.stringify(value)).not.toContain("PRIVATE");
    }
    const value = observation({ estimatedCost: 1, currency: "USD" });
    for (const changed of [
      {
        ...value,
        costEstimate: { ...value.costEstimate, billingStatus: "settled" },
      },
      { ...value, costEstimate: { ...value.costEstimate, invoice: "PRIVATE" } },
      {
        ...value,
        costEstimate: {
          ...value.costEstimate,
          amount: { status: "unreported", value: 0 },
        },
      },
      {
        ...value,
        costEstimate: {
          ...value.costEstimate,
          currency: { status: "reported", value: "bad" },
        },
      },
    ])
      expect(AgentUsageObservationSchema.safeParse(changed).success).toBe(
        false,
      );
  });

  it("cost estimate reports persist and replay exactly across SQLite restart, changed money rejects atomically and legacy bytes are never enriched", () => {
    const { database, path, at } = fixture();
    const input = {
      runId: "run",
      engineRunId: "run",
      engineKind: "pi" as const,
      cursor: 2,
      usage: {
        inputTokens: 7,
        estimatedCost: 0,
        currency: "USD",
        measurementScope: "response-increment",
      },
      recordedAt: at,
    };
    database.uow.execute((tx) => recordAgentUsage(tx, input));
    const legacy = createAgentUsageObservation({
      runId: "run",
      sessionId: "session",
      projectId: "project",
      engineKind: "pi",
      cursor: 3,
      usage: { inputTokens: 9 },
      recordedAt: at,
    });
    delete legacy.costEstimate;
    const { recordedAt: _at, ...legacyContent } = legacy;
    const legacyBytes = JSON.stringify(legacy);
    database.uow.execute((tx) =>
      tx.run(
        "INSERT INTO agent_usage_observations(run_id, engine_cursor, observation_json, content_sha256) VALUES (?, ?, ?, ?)",
        "run",
        3,
        legacyBytes,
        createHash("sha256")
          .update(JSON.stringify(["run", legacyContent]))
          .digest("hex"),
      ),
    );
    database.close();
    const reopened = openDatabase(path);
    try {
      reopened.uow.execute((tx) =>
        recordAgentUsage(tx, {
          ...input,
          recordedAt: "2026-10-06T04:00:00.000Z",
        }),
      );
      const before = reopened.sqlite
        .prepare(
          "SELECT * FROM agent_usage_observations ORDER BY engine_cursor",
        )
        .all();
      for (const usage of [
        { ...input.usage, estimatedCost: 1 },
        { ...input.usage, currency: "EUR" },
        { inputTokens: 7 },
      ])
        expect(() =>
          reopened.uow.execute((tx) =>
            recordAgentUsage(tx, { ...input, usage }),
          ),
        ).toThrow("不能覆盖");
      reopened.uow.execute((tx) =>
        recordAgentUsage(tx, {
          ...input,
          cursor: 3,
          usage: { inputTokens: 9, estimatedCost: 25, currency: "EUR" },
        }),
      );
      expect(
        reopened.sqlite
          .prepare(
            "SELECT * FROM agent_usage_observations ORDER BY engine_cursor",
          )
          .all(),
      ).toEqual(before);
      const page = reopened.uow.execute((tx) =>
        readAgentUsagePage(tx, "run", "project", undefined, 25),
      )!;
      expect(page.items[0]!.costEstimate).toBeUndefined();
      expect(page.items[1]!.costEstimate).toMatchObject({
        amount: { status: "reported", value: 0 },
        currency: { status: "reported", value: "USD" },
        billingStatus: "unknown",
      });
      expect(page.billingStatus).toBe("unknown");
      expect(
        reopened.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM domain_events WHERE type = 'agents.usage-observed.v1'",
          )
          .get(),
      ).toEqual({ count: 1 });
      reopened.sqlite
        .prepare(
          "UPDATE agent_usage_observations SET observation_json = json_set(observation_json, '$.costEstimate.amount.value', 25) WHERE engine_cursor = 2",
        )
        .run();
      expect(() =>
        reopened.uow.execute((tx) =>
          readAgentUsagePage(tx, "run", "project", undefined, 25),
        ),
      ).toThrow("指纹");
    } finally {
      reopened.close();
    }
  });

  it("keeps reported zero, missing and invalid distinct and strips private data", () => {
    expect(
      normalizeAgentUsage({
        inputTokens: 0,
        outputTokens: "7",
        cachedTokens: undefined,
        prompt: "private",
        currency: "secret",
        measurementScope: "session-total",
      }),
    ).toEqual({
      inputTokens: 0,
      invalidFields: ["outputTokens"],
      invalidCostFields: ["currency"],
      measurementScope: "session-total",
    });
    for (const value of [
      -1,
      1.2,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      NaN,
      null,
      {},
      "0",
    ])
      expect(normalizeAgentUsage({ inputTokens: value })).toEqual({
        invalidFields: ["inputTokens"],
      });
  });
  it("persists exact reports and cursor atomically, replay is immutable across SQLite restart", () => {
    const { database, path, at } = fixture();
    const input = {
      runId: "run",
      engineRunId: "run",
      engineKind: "pi" as const,
      cursor: 2,
      usage: {
        inputTokens: 0,
        outputTokens: "secret",
        measurementScope: "response-increment",
        prompt: "private",
      },
      recordedAt: at,
    };
    database.uow.execute((tx) => recordAgentUsage(tx, input));
    database.close();
    const reopened = openDatabase(path);
    try {
      reopened.uow.execute((tx) =>
        recordAgentUsage(tx, {
          ...input,
          recordedAt: "2026-10-04T01:00:00.000Z",
        }),
      );
      const page = reopened.uow.execute((tx) =>
        readAgentUsagePage(tx, "run", "project", undefined, 25),
      );
      expect(page).toMatchObject({
        observationCount: 1,
        coverage: "partial-or-unknown",
        billingStatus: "unknown",
        items: [
          {
            cursor: 2,
            inputTokens: { status: "reported", value: 0 },
            outputTokens: { status: "invalid" },
            cachedTokens: { status: "unreported" },
            recordedAt: at,
            runClassification: "unknown",
          },
        ],
      });
      expect(JSON.stringify(page)).not.toContain("private");
      expect(JSON.stringify(page)).not.toContain("secret");
      expect(
        reopened.uow.execute((tx) =>
          tx.get(
            "SELECT last_engine_cursor FROM agent_assistant_runs WHERE id = 'run'",
          ),
        ),
      ).toEqual({ last_engine_cursor: 2 });
      const before = reopened.sqlite
        .prepare("SELECT * FROM agent_usage_observations")
        .all();
      expect(() =>
        reopened.uow.execute((tx) =>
          recordAgentUsage(tx, { ...input, usage: { inputTokens: 1 } }),
        ),
      ).toThrow();
      expect(() =>
        reopened.uow.execute((tx) =>
          recordAgentUsage(tx, { ...input, engineRunId: "other-run" }),
        ),
      ).toThrow();
      expect(
        reopened.sqlite.prepare("SELECT * FROM agent_usage_observations").all(),
      ).toEqual(before);
      expect(
        reopened.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM domain_events WHERE type = 'agents.usage-observed.v1'",
          )
          .get(),
      ).toEqual({ count: 1 });
      reopened.sqlite
        .prepare(
          "UPDATE agent_usage_observations SET observation_json = json_set(observation_json, '$.inputTokens.value', 999) WHERE run_id = 'run'",
        )
        .run();
      expect(() =>
        reopened.uow.execute((tx) =>
          readAgentUsagePage(tx, "run", "project", undefined, 25),
        ),
      ).toThrow("指纹");
      expect(() =>
        reopened.uow.execute((tx) => recordAgentUsage(tx, input)),
      ).toThrow();
    } finally {
      reopened.close();
    }
  });
  it("does not backfill historical empty usage during the new immutable migration", () => {
    const { database } = fixture(false);
    try {
      const prior = database.sqlite
        .prepare("SELECT * FROM agent_assistant_runs ORDER BY id")
        .all();
      applyMigrations(database.sqlite, [
        ...foundationPlugin.migrations!,
        ...agentMigrations,
      ]);
      expect(
        database.sqlite
          .prepare("SELECT * FROM agent_assistant_runs ORDER BY id")
          .all(),
      ).toEqual(prior);
      expect(
        database.sqlite
          .prepare("SELECT COUNT(*) AS count FROM agent_usage_observations")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database.uow.execute((tx) =>
          readAgentUsagePage(tx, "run", "project", undefined, 25),
        ),
      ).toMatchObject({
        observationCount: 0,
        items: [],
        coverage: "partial-or-unknown",
      });
      database.sqlite.exec(
        "CREATE TRIGGER reject_usage_event BEFORE INSERT ON domain_events WHEN NEW.type = 'agents.usage-observed.v1' BEGIN SELECT RAISE(ABORT, 'event fault'); END;",
      );
      expect(() =>
        database.uow.execute((tx) =>
          recordAgentUsage(tx, {
            runId: "run",
            engineRunId: "run",
            engineKind: "pi",
            cursor: 1,
            usage: { inputTokens: 0 },
            recordedAt: "2026-10-04T00:00:00.000Z",
          }),
        ),
      ).toThrow("event fault");
      expect(
        database.sqlite
          .prepare("SELECT COUNT(*) AS count FROM agent_usage_observations")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database.sqlite
          .prepare(
            "SELECT last_engine_cursor FROM agent_assistant_runs WHERE id = 'run'",
          )
          .get(),
      ).toEqual({ last_engine_cursor: 0 });
      expect(database.sqlite.prepare("PRAGMA integrity_check").get()).toEqual({
        integrity_check: "ok",
      });
      expect(database.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      database.close();
    }
  });
  it("refuses cross-project cursors, never sums cumulative reports, and rolls back failures", () => {
    const { database, at } = fixture();
    try {
      for (const cursor of [1, 3, 5])
        database.uow.execute((tx) =>
          recordAgentUsage(tx, {
            runId: "run",
            engineRunId: "run",
            engineKind: "pi",
            cursor,
            usage: {
              inputTokens: 100 + cursor,
              measurementScope: "session-total",
            },
            recordedAt: at,
          }),
        );
      database.uow.execute((tx) =>
        recordAgentUsage(tx, {
          runId: "other-run",
          engineRunId: "other-run",
          engineKind: "pi",
          cursor: 2,
          usage: {},
          recordedAt: at,
        }),
      );
      expect(
        database.uow.execute((tx) =>
          readAgentUsagePage(tx, "run", "other-project", undefined, 1),
        ),
      ).toBeUndefined();
      expect(
        database.uow.execute((tx) =>
          readAgentUsagePage(tx, "run", undefined, undefined, 1),
        ),
      ).toBeUndefined();
      expect(() =>
        database.uow.execute((tx) =>
          readAgentUsagePage(tx, "run", "project", 2, 1),
        ),
      ).toThrow();
      expect(
        database.uow.execute((tx) =>
          readAgentUsagePage(tx, "run", "project", undefined, 2),
        ),
      ).toMatchObject({
        observationCount: 3,
        items: [{ cursor: 5 }, { cursor: 3 }],
        nextCursor: 3,
      });
      expect(
        database.uow.execute((tx) =>
          readAgentUsagePage(tx, "run", "project", 3, 2),
        ),
      ).toMatchObject({ items: [{ cursor: 1 }] });
      expect(
        database.uow.execute((tx) =>
          readAgentUsagePage(tx, "global-run", undefined, undefined, 25),
        ),
      ).toMatchObject({
        observationCount: 0,
        items: [],
        coverage: "partial-or-unknown",
      });
      database.sqlite.exec(
        "CREATE TRIGGER reject_usage_cursor BEFORE UPDATE OF last_engine_cursor ON agent_assistant_runs BEGIN SELECT RAISE(ABORT, 'cursor fault'); END;",
      );
      expect(() =>
        database.uow.execute((tx) =>
          recordAgentUsage(tx, {
            runId: "run",
            engineRunId: "run",
            engineKind: "pi",
            cursor: 7,
            usage: { outputTokens: 12 },
            recordedAt: at,
          }),
        ),
      ).toThrow("cursor fault");
      expect(
        database.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM agent_usage_observations WHERE run_id = 'run'",
          )
          .get(),
      ).toEqual({ count: 3 });
      expect(
        database.sqlite
          .prepare(
            "SELECT last_engine_cursor FROM agent_assistant_runs WHERE id = 'run'",
          )
          .get(),
      ).toEqual({ last_engine_cursor: 5 });
      expect(
        database.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM domain_events WHERE type = 'agents.usage-observed.v1'",
          )
          .get(),
      ).toEqual({ count: 4 });
    } finally {
      database.close();
    }
  });
});
