import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { foundationPlugin } from "@dramaip/foundation";
import { createAgentsPlugin } from "@dramaip/agents";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import type { PluginContext } from "@dramaip/plugin-api/internal";
import { agentMigrations } from "../../../plugins/agents/src/migrations/index.js";
import { createAgentContextStore } from "../../../plugins/agents/src/context/store.js";
import { processInspirationMemoryJob } from "../../../plugins/agents/src/inspiration/worker.js";
import { mountTestPlugin } from "./plugin-test-fixture.js";
import {
  registerAuxiliaryUsageRun,
  recordAuxiliaryUsage,
  readAuxiliaryUsagePage,
} from "../../../plugins/agents/src/runs/auxiliary-usage.js";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture(includeMigration = true) {
  const directory = mkdtempSync(join(tmpdir(), "dramaip-auxiliary-usage-"));
  directories.push(directory);
  const path = join(directory, "usage.sqlite");
  const database = openDatabase(path);
  applyMigrations(database.sqlite, [
    ...foundationPlugin.migrations!,
    ...agentMigrations.filter(
      (migration) => includeMigration || migration.id < "agents.0014.",
    ),
  ]);
  const at = "2026-10-04T00:00:00.000Z";
  database.uow.execute((tx) => {
    tx.run(
      `INSERT INTO agent_assistant_sessions(id, engine_session_id, engine_kind, surface, status, last_opened_at, created_at, updated_at)
      VALUES ('conversation', 'private-session', 'langgraph', 'inspiration', 'idle', ?, ?, ?)`,
      at,
      at,
      at,
    );
    tx.run(
      `INSERT INTO agent_assistant_runs(id, session_id, task_id, task_type, engine_kind, status, created_at, updated_at)
      VALUES ('original-chat-run', 'conversation', 'chat-task', 'chat', 'langgraph', 'completed', ?, ?)`,
      at,
      at,
    );
    tx.run(
      `INSERT INTO agent_assistant_turns(id, session_id, run_id, user_message, status, created_at, updated_at)
      VALUES ('original-turn', 'conversation', 'original-chat-run', '只谈旧书店的故事', 'succeeded', ?, ?)`,
      at,
      at,
    );
    tx.run(
      `INSERT INTO agent_assistant_items(id, run_id, sequence, type, status, content, created_at, updated_at)
      VALUES ('original-response', 'original-chat-run', 1, 'message', 'completed', '可以讨论人物冲突', ?, ?)`,
      at,
      at,
    );
    tx.run(
      `INSERT INTO agent_inspiration_memory_jobs(id, conversation_id, through_turn_count, status, reason, input_tokens, output_tokens, created_at, updated_at)
      VALUES ('job', 'conversation', 1, 'running', 'manual', 777, 888, ?, ?)`,
      at,
      at,
    );
  });
  return { database, path, at };
}
const contextFor = (database: ReturnType<typeof openDatabase>) =>
  ({ uow: database.uow, get: () => undefined }) as unknown as PluginContext;

describe("Agents auxiliary reported observations", () => {
  it("waits for the already dispatched memory job and session release when stopping, without selecting another queued job", async () => {
    vi.useFakeTimers();
    const { database, at } = fixture();
    database.uow.execute((tx) => {
      tx.run(
        "UPDATE agent_inspiration_memory_jobs SET status = 'pending' WHERE id = 'job'",
      );
      tx.run(
        `INSERT INTO agent_inspiration_memory_jobs(id, conversation_id, through_turn_count, status, reason, created_at, updated_at)
         VALUES ('next-job', 'conversation', 2, 'pending', 'manual', ?, ?)`,
        at,
        at,
      );
    });
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let destroyed = 0;
    const host = {
      engineOperation: async (_kind: string, operation: string) => {
        if (operation === "create") {
          entered();
          await gate;
          return { id: "controlled-memory-session" };
        }
        if (operation === "destroy") {
          destroyed++;
          return { ok: true };
        }
        throw new Error(`Unexpected ${operation}`);
      },
      async *engineStream() {
        calls++;
        yield {
          type: "usage",
          inputTokens: 0,
          outputTokens: 12,
          measurementScope: "response-increment",
        };
        yield {
          type: "result",
          result: {
            text: JSON.stringify({ summary: "受控延迟摘要", memories: [] }),
          },
        };
      },
    } as unknown as DesktopHostClient;
    let stop = async () => undefined;
    const nativeContext = await mountTestPlugin(
      createAgentsPlugin(host),
      { uow: database.uow },
      Object.fromEntries(
        [
          "automation.previews.v1",
          "automation.resources.v1",
          "automation.creation.v1",
          "knowledge.creative-intelligence.v1",
          "writing.chapters.v1",
          "writing.resources.v1",
        ].map((id) => [id, Object.freeze({})]),
      ),
      (fiber) => {
        stop = async () => {
          await fiber.dispose();
        };
      },
    );
    let closed = false;
    let stopping: Promise<void> | undefined;
    try {
      await started;
      stopping = Promise.resolve(stop()).then(() => {
        closed = true;
      });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(closed).toBe(false);
      expect(calls).toBe(0);
      expect(destroyed).toBe(0);
      release();
      await stopping;
      expect(closed).toBe(true);
      expect(calls).toBe(1);
      expect(destroyed).toBe(1);
      expect(
        database.uow.execute((tx) =>
          tx.get<{ status: string }>(
            "SELECT status FROM agent_inspiration_memory_jobs WHERE id = 'job'",
          ),
        )?.status,
      ).toBe("completed");
      await vi.advanceTimersByTimeAsync(20_000);
      expect(calls).toBe(1);
      expect(
        database.uow.execute((tx) =>
          tx.get<{ status: string }>(
            "SELECT status FROM agent_inspiration_memory_jobs WHERE id = 'next-job'",
          ),
        )?.status,
      ).toBe("pending");
      expect(
        database.uow.execute((tx) =>
          tx.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM agent_auxiliary_usage_observations",
          ),
        )?.count,
      ).toBe(1);
    } finally {
      release();
      await vi.advanceTimersByTimeAsync(0);
      try {
        await stopping;
      } finally {
        await nativeContext.fiber.dispose();
        vi.useRealTimers();
        database.close();
      }
    }
  });

  it("keeps all memory response reports on failure and retry across SQLite restart, without replacing them with estimates", async () => {
    const { database, path } = fixture();
    let failing = true;
    let calls = 0;
    let destroyed = 0;
    const prompts: string[] = [];
    const host = {
      engineOperation: async (_kind: string, operation: string) => {
        if (operation === "create") return { id: "private-vendor-session" };
        if (operation === "destroy") {
          destroyed++;
          return { ok: true };
        }
        throw new Error(`Unexpected ${operation}`);
      },
      async *engineStream(_kind: string, input: { prompt: string }) {
        calls++;
        prompts.push(input.prompt);
        yield {
          type: "usage",
          inputTokens: 0,
          outputTokens: 12,
          measurementScope: "response-increment",
          inputAccounting: "includes-cache",
          prompt: "PRIVATE",
          credential: "SECRET",
        };
        if (failing) {
          yield {
            type: "error",
            code: "CONTROLLED_FAILURE",
            message: "controlled failure",
          };
          return;
        }
        yield {
          type: "usage",
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 0,
          measurementScope: "session-total",
        };
        yield {
          type: "result",
          result: {
            text: JSON.stringify({
              summary: "受控摘要，不是文学质量证据",
              memories: [],
            }),
          },
        };
      },
    } as unknown as DesktopHostClient;
    const firstContext = contextFor(database);
    await expect(
      processInspirationMemoryJob(
        firstContext,
        host,
        createAgentContextStore(firstContext),
        {
          id: "job",
          conversation_id: "conversation",
          through_turn_count: 1,
          engine_kind: "langgraph",
          model_json: null,
          context_snapshot_id: null,
        },
      ),
    ).rejects.toThrow("controlled failure");
    const originalRun = database.uow.execute((tx) =>
      tx.get<{ run_id: string; context_snapshot_id: string }>(
        "SELECT run_id, context_snapshot_id FROM agent_auxiliary_usage_runs WHERE memory_job_id = 'job'",
      ),
    )!;
    const original = database.uow.execute((tx) =>
      readAuxiliaryUsagePage(tx, originalRun.run_id, undefined, undefined, 25),
    );
    expect(original).toMatchObject({
      observationCount: 1,
      items: [
        {
          inputTokens: { status: "reported", value: 0 },
          cachedTokens: { status: "unreported" },
        },
      ],
    });
    expect(JSON.stringify(original)).not.toMatch(
      /PRIVATE|SECRET|credential|estimatedCost/u,
    );
    expect(
      database.uow.execute((tx) =>
        tx.get(
          "SELECT input_tokens, output_tokens FROM agent_inspiration_memory_jobs WHERE id = 'job'",
        ),
      ),
    ).toEqual({ input_tokens: 777, output_tokens: 888 });
    database.close();
    const restarted = openDatabase(path);
    try {
      failing = false;
      restarted.uow.execute((tx) =>
        tx.run(
          "UPDATE agent_assistant_turns SET user_message = '后来的文字不应进入原冻结重试' WHERE id = 'original-turn'",
        ),
      );
      const restartedContext = contextFor(restarted);
      await processInspirationMemoryJob(
        restartedContext,
        host,
        createAgentContextStore(restartedContext),
        {
          id: "job",
          conversation_id: "conversation",
          through_turn_count: 1,
          engine_kind: "langgraph",
          model_json: null,
          context_snapshot_id: originalRun.context_snapshot_id,
        },
      );
      expect(prompts).toHaveLength(2);
      expect(prompts[1]).toBe(prompts[0]);
      expect(prompts[1]).not.toContain("后来的文字");
      expect(calls).toBe(2);
      expect(destroyed).toBe(2);
      expect(
        restarted.uow.execute((tx) =>
          readAuxiliaryUsagePage(
            tx,
            originalRun.run_id,
            undefined,
            undefined,
            25,
          ),
        ),
      ).toEqual(original);
      const runs = restarted.uow.execute((tx) =>
        tx.all<{ run_id: string }>(
          "SELECT run_id FROM agent_auxiliary_usage_runs WHERE memory_job_id = 'job'",
        ),
      );
      expect(runs).toHaveLength(2);
      const retry = runs.find((run) => run.run_id !== originalRun.run_id)!;
      const page = restarted.uow.execute((tx) =>
        readAuxiliaryUsagePage(tx, retry.run_id, undefined, undefined, 1),
      )!;
      expect(page).toMatchObject({
        observationCount: 2,
        items: [{ measurementScope: "session-total" }],
      });
      expect(
        restarted.uow.execute((tx) =>
          tx.get(
            "SELECT input_tokens, output_tokens, status FROM agent_inspiration_memory_jobs WHERE id = 'job'",
          ),
        ),
      ).toEqual({ input_tokens: 777, output_tokens: 888, status: "completed" });
      expect(
        restarted.uow.execute((tx) =>
          tx.get(
            "SELECT summary FROM agent_inspiration_summaries WHERE conversation_id = 'conversation'",
          ),
        ),
      ).toEqual({ summary: "受控摘要，不是文学质量证据" });
      expect(
        restarted.sqlite.prepare("PRAGMA foreign_key_check").all(),
      ).toEqual([]);
    } finally {
      restarted.close();
    }
  });

  it("upgrades legacy rows without token backfill and keeps reports, cursor and durable events in one rollback boundary", () => {
    const { database, at } = fixture(false);
    try {
      const before = database.sqlite
        .prepare("SELECT * FROM agent_inspiration_memory_jobs")
        .all();
      applyMigrations(database.sqlite, [
        ...foundationPlugin.migrations!,
        ...agentMigrations,
      ]);
      expect(
        database.sqlite
          .prepare("SELECT * FROM agent_inspiration_memory_jobs")
          .all(),
      ).toEqual(before);
      expect(
        database.sqlite
          .prepare("SELECT COUNT(*) AS count FROM agent_auxiliary_usage_runs")
          .get(),
      ).toEqual({ count: 0 });
      const context = contextFor(database);
      const store = createAgentContextStore(context);
      const preview = store.createPreview({
        runIntent: "controlled ledger test",
        basePrompt: "test",
        tokenBudget: 1000,
        temporaryOverrides: [],
        destination: { kind: "local", provider: "controlled" },
      });
      const snapshot = store.freeze(preview.id, preview.version)!;
      database.uow.execute((tx) => {
        tx.run(
          "UPDATE agent_inspiration_memory_jobs SET context_snapshot_id = ? WHERE id = 'job'",
          snapshot.id,
        );
        registerAuxiliaryUsageRun(tx, {
          runId: "aux",
          sessionId: "aux-session",
          engineRunId: "private-engine-run",
          engineKind: "pi",
          contextSnapshotId: snapshot.id,
          createdAt: at,
          owner: { memoryJobId: "job" },
        });
      });
      const input = {
        runId: "aux",
        engineRunId: "private-engine-run",
        engineKind: "pi" as const,
        cursor: 2,
        usage: { inputTokens: 0, measurementScope: "response-increment" },
        recordedAt: at,
      };
      database.sqlite.exec(
        "CREATE TRIGGER reject_aux_usage_event BEFORE INSERT ON domain_events WHEN NEW.type = 'agents.auxiliary-usage-observed.v1' BEGIN SELECT RAISE(ABORT, 'controlled event refusal'); END;",
      );
      expect(() =>
        database.uow.execute((tx) => recordAuxiliaryUsage(tx, input)),
      ).toThrow("controlled event refusal");
      expect(
        database.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM agent_auxiliary_usage_observations",
          )
          .get(),
      ).toEqual({ count: 0 });
      expect(
        database.sqlite
          .prepare(
            "SELECT last_engine_cursor FROM agent_auxiliary_usage_runs WHERE run_id = 'aux'",
          )
          .get(),
      ).toEqual({ last_engine_cursor: 0 });
      database.sqlite.exec("DROP TRIGGER reject_aux_usage_event");
      database.uow.execute((tx) => recordAuxiliaryUsage(tx, input));
      database.uow.execute((tx) =>
        recordAuxiliaryUsage(tx, {
          ...input,
          recordedAt: "2026-10-04T01:00:00.000Z",
        }),
      );
      expect(
        database.sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM domain_events WHERE type = 'agents.auxiliary-usage-observed.v1'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(() =>
        database.uow.execute((tx) =>
          recordAuxiliaryUsage(tx, { ...input, usage: { inputTokens: 1 } }),
        ),
      ).toThrow();
      expect(() =>
        database.uow.execute((tx) =>
          recordAuxiliaryUsage(tx, { ...input, engineRunId: "replacement" }),
        ),
      ).toThrow();
      expect(
        database.uow.execute((tx) =>
          readAuxiliaryUsagePage(tx, "aux", "foreign", undefined, 25),
        ),
      ).toBeUndefined();
      database.uow.execute((tx) =>
        tx.run(
          "UPDATE agent_auxiliary_usage_runs SET session_id = 'changed' WHERE run_id = 'aux'",
        ),
      );
      expect(() =>
        database.uow.execute((tx) =>
          readAuxiliaryUsagePage(tx, "aux", undefined, undefined, 25),
        ),
      ).toThrow("指纹");
    } finally {
      database.close();
    }
  });
});
