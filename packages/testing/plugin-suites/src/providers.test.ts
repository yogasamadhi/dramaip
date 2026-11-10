import { mountTestPlugin, serveRoutes } from "./plugin-test-fixture.js";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { foundationPlugin } from "@dramaip/system-system/handlers/foundation";
import { createAgentsPlugin } from "@dramaip/agents-agents/handlers/agents";
import type { DesktopHost } from "@dramaip/host-contracts";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import type {
  PluginContext,
  RouteContribution,
  UnitOfWork,
} from "@dramaip/plugin-api/internal";
import { recoverAvailableAgentRuns } from "../../../agents/agents/handlers/agents/runs/recovery.js";
import {
  configuredProvider,
  modelSelection,
} from "../../../agents/agents/handlers/agents/providers/routes.js";
import { createAgentTaskRunner } from "../../../agents/agents/handlers/agents/runs/task-runner.js";

interface InstalledProviderRoutes {
  app: ReturnType<typeof serveRoutes>;
  uow: UnitOfWork;
  liveEvents: Array<{ type: string; payload: unknown }>;
  close(): void;
  eventCount(): number;
  disposePlugin(): Promise<void>;
}

// Provider-route unit tests isolate Agents from unrelated domain services.
// Empty service stubs keep dependency availability explicit; these tests only
// exercise provider routes, while workspace-writing covers the domain APIs.
const agentDependencies = Object.fromEntries(
  [
    "automation.previews.v1",
    "automation.resources.v1",
    "automation.creation.v1",
    "knowledge.creative-intelligence.v1",
    "writing.chapters.v1",
    "writing.resources.v1",
  ].map((id) => [id, Object.freeze({})]),
);

const installed: InstalledProviderRoutes[] = [];
const nativeContexts: Context[] = [];

async function installProviderRoutes(
  host?: DesktopHost,
  dependencies: Record<string, unknown> = {},
): Promise<InstalledProviderRoutes> {
  const database = openDatabase(":memory:");
  const plugin = createAgentsPlugin(host);
  applyMigrations(database.sqlite, [
    ...(foundationPlugin.migrations ?? []),
    ...(plugin.migrations ?? []),
  ]);
  const routes: RouteContribution[] = [];
  const liveEvents: Array<{ type: string; payload: unknown }> = [];
  let disposePlugin = async () => undefined;
  nativeContexts.push(
    await mountTestPlugin(
      plugin,
      {
        http: {
          routeIds: [],
          register(route: RouteContribution) {
            routes.push(route);
            return () => undefined;
          },
        },
        uow: database.uow,
        domainEvents: {
          publishLive(input: { type: string; payload: unknown }) {
            liveEvents.push(input);
          },
          subscribeLive: () => () => undefined,
          subscribeDomain: () => () => undefined,
          replay: () => [],
          registerConsumer: () => () => undefined,
          diagnostics: () => [],
          retryConsumer: () => false,
          dispose: () => undefined,
        },
      },
      { ...agentDependencies, ...dependencies },
      (fiber) => {
        disposePlugin = async () => {
          await fiber.dispose();
        };
      },
    ),
  );
  const app = serveRoutes(routes);
  const fixture = {
    app,
    uow: database.uow,
    liveEvents,
    disposePlugin,
    close: () => database.close(),
    eventCount: () => {
      const row = database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM domain_events")
        .get() as { count: number };
      return Number(row.count);
    },
  };
  installed.push(fixture);
  return fixture;
}

function configureTestProvider(fixture: InstalledProviderRoutes): void {
  fixture.uow.execute((tx) => {
    const now = new Date().toISOString();
    tx.run(
      `INSERT INTO agent_provider_configurations
       (id, title, payload_json, version, created_at, updated_at)
       VALUES ('test-provider', 'Test provider', ?, 0, ?, ?)`,
      JSON.stringify({
        服务类型: "智能模型",
        模型名称: "test-model",
        凭据引用: "test-credential",
      }),
      now,
      now,
    );
    tx.run(
      `INSERT INTO agent_provider_settings(singleton, provider_id, updated_at)
            VALUES (1, 'test-provider', ?)`,
      now,
    );
  });
}

afterEach(async () => {
  for (const ctx of nativeContexts.splice(0)) await ctx.fiber.dispose();
  while (installed.length > 0) installed.pop()!.close();
});

describe("agents provider configurations", () => {
  it("retires experiment creation without context writes or model dispatch", async () => {
    const fixture = await installProviderRoutes();
    const response = await fixture.app.request(
      "http://runtime.test/api/v2/agent-experiments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "project", taskType: "outline" }),
      },
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: "EXPERIMENTS_RETIRED",
    });
    for (const table of [
      "agent_evaluations",
      "agent_evaluation_candidates",
      "agent_context_snapshots",
    ])
      expect(
        fixture.uow.execute((tx) =>
          tx.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`),
        )?.count,
      ).toBe(0);
  });

  it("upgrades to Pi without rewriting history, losing model settings or changing applied migration checksums", () => {
    const database = openDatabase(":memory:");
    const migrations = createAgentsPlugin().migrations ?? [];
    const before = migrations.slice(
      0,
      migrations.findIndex(
        (migration) => migration.id === "agents.0017.pi-only-runtime",
      ),
    );
    const foundation = foundationPlugin.migrations ?? [];
    try {
      applyMigrations(database.sqlite, [...foundation, ...before]);
      const now = new Date().toISOString();
      const model = JSON.stringify({ modelId: "author-model" });
      database.sqlite
        .prepare("INSERT INTO agent_global_settings VALUES (1, ?, ?, ?)")
        .run("retired-engine", model, now);
      database.sqlite
        .prepare("INSERT INTO agent_project_settings VALUES (?, ?, ?, ?, ?)")
        .run("project", "retired-engine", model, "advanced", now);
      for (const engine of ["pi", "retired-engine"]) {
        database.sqlite
          .prepare(
            `INSERT INTO agent_assistant_sessions
          (id, engine_session_id, engine_kind, surface, status, last_opened_at, created_at, updated_at)
          VALUES (?, ?, ?, 'global', 'idle', ?, ?, ?)`,
          )
          .run(engine, `session-${engine}`, engine, now, now, now);
        database.sqlite
          .prepare(
            `INSERT INTO agent_assistant_runs
          (id, session_id, task_id, task_type, engine_kind, status, created_at, updated_at)
          VALUES (?, ?, ?, 'chat', ?, 'recoverable', ?, ?)`,
          )
          .run(`run-${engine}`, engine, `task-${engine}`, engine, now, now);
      }
      // Re-applying the entire chain checks every previously stored checksum.
      applyMigrations(database.sqlite, [...foundation, ...migrations]);
      applyMigrations(database.sqlite, [...foundation, ...migrations]);
      for (const table of ["agent_global_settings", "agent_project_settings"])
        expect(
          database.sqlite
            .prepare(
              `SELECT default_engine_kind, default_model_json FROM ${table}`,
            )
            .get(),
        ).toMatchObject({
          default_engine_kind: "pi",
          default_model_json: model,
        });
      expect(
        database.sqlite
          .prepare(
            "SELECT engine_kind, status, archived_at FROM agent_assistant_sessions WHERE id = 'retired-engine'",
          )
          .get(),
      ).toMatchObject({
        engine_kind: "retired-engine",
        status: "interrupted",
        archived_at: expect.any(String),
      });
      expect(
        database.sqlite
          .prepare(
            "SELECT engine_kind, status FROM agent_assistant_runs WHERE id = 'run-retired-engine'",
          )
          .get(),
      ).toMatchObject({ engine_kind: "retired-engine", status: "interrupted" });
      expect(
        database.sqlite
          .prepare(
            "SELECT status, archived_at FROM agent_assistant_sessions WHERE id = 'pi'",
          )
          .get(),
      ).toMatchObject({ status: "idle", archived_at: null });
      expect(
        database.sqlite
          .prepare(
            "SELECT status FROM agent_assistant_runs WHERE id = 'run-pi'",
          )
          .get(),
      ).toMatchObject({ status: "recoverable" });
    } finally {
      database.close();
    }
  });

  it("lists only supported engines and rejects the retired engine and sign-in endpoints", async () => {
    const fixture = await installProviderRoutes({
      engineHealth: async () => ({ available: true, healthy: true }),
    } as unknown as DesktopHost);
    const engines = await fixture.app.request(
      "http://runtime.test/api/v2/agent-engines",
    );
    expect(
      (await engines.json()).map((engine: { kind: string }) => engine.kind),
    ).toEqual(["pi"]);
    const rejected = await fixture.app.request(
      "http://runtime.test/api/v2/agent-sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "global", engineKind: "codex" }),
      },
    );
    expect(rejected.status).toBe(400);
    for (const [method, action] of [
      ["GET", "auth"],
      ["POST", "login"],
      ["POST", "logout"],
    ]) {
      expect(
        (
          await fixture.app.request(
            `http://runtime.test/api/v2/agent-engines/codex/${action}`,
            { method },
          )
        ).status,
      ).toBe(404);
    }
  });

  it("migrates retired engine defaults and archives its sessions while preserving supported settings and history", () => {
    const database = openDatabase(":memory:");
    const migrations = createAgentsPlugin().migrations ?? [];
    const removalIndex = migrations.findIndex(
      (migration) => migration.id === "agents.0016.supported-engine-defaults",
    );
    const foundation = foundationPlugin.migrations ?? [];
    try {
      applyMigrations(database.sqlite, [
        ...foundation,
        ...migrations.slice(0, removalIndex),
      ]);
      const now = new Date().toISOString();
      database.uow.execute((tx) => {
        tx.run(
          `INSERT INTO agent_global_settings VALUES (1, 'codex', '{"modelId":"retired"}', ?)`,
          now,
        );
        for (const [project, engine] of [
          ["retired", "codex"],
          ["retained", "pi"],
        ])
          tx.run(
            `INSERT INTO agent_project_settings VALUES (?, ?, '{"modelId":"saved"}', 'simple', ?)`,
            project,
            engine,
            now,
          );
        tx.run(
          `INSERT INTO agent_assistant_sessions
          (id, engine_session_id, engine_kind, surface, status, last_opened_at, created_at, updated_at)
          VALUES ('retired-session', 'vendor-session', 'codex', 'global', 'idle', ?, ?, ?)`,
          now,
          now,
          now,
        );
        tx.run(
          `INSERT INTO agent_assistant_runs
          (id, session_id, task_id, task_type, engine_kind, status, created_at, updated_at)
          VALUES ('retired-run', 'retired-session', 'task', 'outline', 'codex', 'running', ?, ?)`,
          now,
          now,
        );
        tx.run(
          `INSERT INTO agent_assistant_turns
          (id, session_id, run_id, user_message, status, created_at, updated_at)
          VALUES ('retired-turn', 'retired-session', 'retired-run', 'Preserved message', 'running', ?, ?)`,
          now,
          now,
        );
      });
      applyMigrations(database.sqlite, [...foundation, ...migrations]);
      const get = (sql: string) => database.sqlite.prepare(sql).get();
      expect(
        get(
          "SELECT default_engine_kind, default_model_json FROM agent_global_settings",
        ),
      ).toEqual({ default_engine_kind: "pi", default_model_json: null });
      expect(
        get(
          "SELECT default_engine_kind, default_model_json FROM agent_project_settings WHERE project_id = 'retired'",
        ),
      ).toEqual({ default_engine_kind: "pi", default_model_json: null });
      expect(
        get(
          "SELECT default_engine_kind, default_model_json FROM agent_project_settings WHERE project_id = 'retained'",
        ),
      ).toEqual({
        default_engine_kind: "pi",
        default_model_json: '{"modelId":"saved"}',
      });
      expect(
        get("SELECT status, archived_at FROM agent_assistant_sessions"),
      ).toMatchObject({
        status: "interrupted",
        archived_at: expect.any(String),
      });
      expect(get("SELECT status FROM agent_assistant_runs")).toEqual({
        status: "interrupted",
      });
      expect(
        get("SELECT status, user_message FROM agent_assistant_turns"),
      ).toEqual({ status: "failed", user_message: "Preserved message" });
      expect(
        get(
          "SELECT name FROM sqlite_master WHERE name = 'agent_codex_custom_provider_settings'",
        ),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("rejects unsupported evaluation model options instead of silently trimming them from the request", () => {
    expect(
      modelSelection({
        modelId: " original-model ",
        providerId: " original-provider ",
        profileId: " original-profile ",
      }),
    ).toEqual({
      modelId: "original-model",
      providerId: "original-provider",
      profileId: "original-profile",
    });
    expect(
      modelSelection({ modelId: "original-model", profileId: "" }),
    ).toEqual({ modelId: "original-model" });
    for (const value of [
      { modelId: "original-model", temperature: 0 },
      { modelId: "original-model", maxTokens: 1000 },
      { modelId: "original-model", reasoningEffort: "high" },
      { modelId: "original-model", seed: 42 },
      { modelId: "original-model", apiKey: "PRIVATE" },
      { modelId: "original-model", endpoint: "PRIVATE" },
      { modelId: "original-model", typo: undefined },
      { modelId: "x".repeat(201) },
      { modelId: 1 },
      null,
      [],
      {},
    ])
      expect(modelSelection(value)).toBeUndefined();
  });

  it("rejects unsupported evaluation model options before context preparation, defaults, persistence or Host dispatch", async () => {
    const execute = vi.fn(() => {
      throw new Error("must not read defaults or allocate rows");
    });
    const createPreview = vi.fn();
    const previewCreation = vi.fn();
    const prepareCreation = vi.fn();
    const engineHealth = vi.fn();
    const engineOperation = vi.fn();
    const runner = createAgentTaskRunner(
      { effect: () => undefined, uow: { execute } } as unknown as PluginContext,
      { engineHealth, engineOperation } as unknown as DesktopHost,
      {
        createPreview,
        previewCreation,
        prepareCreation,
      } as unknown as Parameters<typeof createAgentTaskRunner>[2],
    );
    const input = {
      projectId: crypto.randomUUID(),
      engineKind: "pi" as const,
      prompt: "controlled evaluation instruction",
      model: { modelId: "original-model", temperature: 0 },
    };
    expect(() => runner.previewCreation!({ ...input, references: [] })).toThrow(
      "不会忽略其他参数",
    );
    expect(() => runner.prepareCreation!({ ...input, references: [] })).toThrow(
      "不会忽略其他参数",
    );
    await expect(
      runner.start({ ...input, taskType: "creation_generating" }),
    ).rejects.toThrow("不会忽略其他参数");
    expect(() =>
      runner.previewCreation!({ ...input, model: {}, references: [] }),
    ).toThrow("选择本次使用的模型");
    expect(() =>
      runner.prepareCreation!({ ...input, model: {}, references: [] }),
    ).toThrow("选择本次使用的模型");
    for (const call of [
      execute,
      createPreview,
      previewCreation,
      prepareCreation,
      engineHealth,
      engineOperation,
    ])
      expect(call).not.toHaveBeenCalled();
  });

  it("rejects unsupported evaluation model options through settings, sessions and blind evaluation HTTP without side effects", async () => {
    const projectId = crypto.randomUUID();
    const engineHealth = vi.fn(async () => ({
      available: true,
      healthy: true,
      configured: true,
      authenticated: true,
    }));
    const engineOperation = vi.fn();
    const fixture = await installProviderRoutes(
      { engineHealth, engineOperation } as unknown as DesktopHost,
      {
        [WORKSPACE_PROJECT_SERVICE.id]: {
          get: (id: string) =>
            id === projectId
              ? { id, title: "受控配置校验", version: 0 }
              : undefined,
        },
      },
    );
    const before = fixture.uow.execute((tx) =>
      tx.all("SELECT * FROM domain_events"),
    );
    const callsBefore = engineHealth.mock.calls.length;
    for (const extra of [
      { temperature: 0 },
      { reasoningEffort: "high" },
      { apiKey: "PRIVATE" },
    ]) {
      const model = { modelId: "original-model", ...extra };
      for (const request of [
        {
          path: "/api/v2/agent-settings",
          method: "PUT",
          body: { defaultEngineKind: "pi", defaultModel: model },
        },
        {
          path: `/api/v2/projects/${projectId}/agent-settings`,
          method: "PUT",
          body: { defaultEngineKind: "pi", defaultModel: model },
        },
        {
          path: "/api/v2/assistant-conversations",
          method: "POST",
          body: { engineKind: "pi", surface: "global", model },
        },
        {
          path: "/api/v2/agent-experiments",
          method: "POST",
          body: { projectId, taskType: "diagnosis", model },
        },
      ]) {
        const response = await fixture.app.request(
          `http://runtime.test${request.path}`,
          {
            method: request.method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.body),
          },
        );
        expect(response.status).toBe(
          request.path === "/api/v2/agent-experiments" ? 410 : 400,
        );
        const text = await response.text();
        expect(text).toContain(
          request.path === "/api/v2/agent-experiments"
            ? "EXPERIMENTS_RETIRED"
            : "VALIDATION_ERROR",
        );
        expect(text).not.toContain("PRIVATE");
      }
    }
    expect(engineOperation).not.toHaveBeenCalled();
    expect(engineHealth.mock.calls.length).toBe(callsBefore);
    expect(
      fixture.uow.execute((tx) => tx.all("SELECT * FROM domain_events")),
    ).toEqual(before);
    for (const table of [
      "agent_assistant_sessions",
      "agent_assistant_runs",
      "agent_evaluations",
      "agent_context_previews",
      "agent_context_snapshots",
      "agent_project_settings",
    ])
      expect(
        fixture.uow.execute((tx) => tx.all(`SELECT * FROM ${table}`)),
      ).toEqual([]);
  });

  it("native stop drains delayed generation health without starting configuration or run recovery", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let announce: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    let delayed = false;
    let healthCalls = 0;
    let activations = 0;
    let recoveries = 0;
    const host = {
      engineHealth: async () => {
        healthCalls++;
        if (delayed) {
          announce();
          await gate;
        }
        return {
          available: true,
          healthy: true,
          configured: true,
          generation: delayed ? 2 : 1,
        };
      },
      activateAgentProvider: async () => {
        activations++;
        return { available: true };
      },
      engineOperation: async () => {
        recoveries++;
        return { disposition: "missing" };
      },
    } as unknown as DesktopHost;
    let stopping: Promise<void> | undefined;
    try {
      const fixture = await installProviderRoutes(host);
      seedGenerationRecovery(fixture);
      delayed = true;
      await vi.advanceTimersByTimeAsync(2_000);
      await entered;
      let closed = false;
      stopping = fixture.disposePlugin().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      const before = healthCalls;
      release();
      await stopping;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(healthCalls).toBe(before);
      expect(activations).toBe(0);
      expect(recoveries).toBe(0);
      expect(recoveryRows(fixture).map((row) => row.status)).toEqual([
        "recoverable",
        "recoverable",
      ]);
    } finally {
      release();
      await stopping;
      vi.useRealTimers();
    }
  });

  it("native stop rejects a late per-run health reply before any recovery call or bookkeeping change", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let announce: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    let generation = 1;
    let piHealthCalls = 0;
    let recoveries = 0;
    const host = {
      engineHealth: async (kind: string) => {
        if (kind === "pi" && ++piHealthCalls === 3) {
          announce();
          await gate;
          throw new Error("controlled late health failure");
        }
        return { available: true, healthy: true, configured: true, generation };
      },
      activateAgentProvider: async () => ({ available: true }),
      engineOperation: async () => {
        recoveries++;
        return { disposition: "missing" };
      },
    } as unknown as DesktopHost;
    let stopping: Promise<void> | undefined;
    try {
      const fixture = await installProviderRoutes(host);
      seedGenerationRecovery(fixture);
      const original = recoveryRows(fixture);
      generation = 2;
      await vi.advanceTimersByTimeAsync(2_000);
      await entered;
      let closed = false;
      stopping = fixture.disposePlugin().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      release();
      await stopping;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(recoveries).toBe(0);
      expect(recoveryRows(fixture)).toEqual(original);
    } finally {
      release();
      await stopping;
      vi.useRealTimers();
    }
  });

  it("native stop waits for accepted provider activation and does not begin run recovery afterwards", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let announce: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    let generation = 1;
    let activations = 0;
    let recoveries = 0;
    const host = {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
        generation,
      }),
      activateAgentProvider: async () => {
        activations++;
        announce();
        await gate;
        return { available: true };
      },
      engineOperation: async () => {
        recoveries++;
        return { disposition: "missing" };
      },
    } as unknown as DesktopHost;
    let stopping: Promise<void> | undefined;
    try {
      const fixture = await installProviderRoutes(host);
      seedGenerationRecovery(fixture);
      generation = 2;
      await vi.advanceTimersByTimeAsync(2_000);
      await entered;
      let closed = false;
      stopping = fixture.disposePlugin().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      release();
      await stopping;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(activations).toBe(1);
      expect(recoveries).toBe(0);
      expect(recoveryRows(fixture).map((row) => row.status)).toEqual([
        "recoverable",
        "recoverable",
      ]);
    } finally {
      release();
      await stopping;
      vi.useRealTimers();
    }
  });

  it("native stop lets an accepted recovery persist on its original unit of work but never starts the next run", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let announce: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    let generation = 1;
    let recoveries = 0;
    const host = {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
        generation,
      }),
      activateAgentProvider: async () => ({ available: true }),
      engineOperation: async () => {
        recoveries++;
        announce();
        await gate;
        return { disposition: "missing" };
      },
    } as unknown as DesktopHost;
    let stopping: Promise<void> | undefined;
    try {
      const fixture = await installProviderRoutes(host);
      seedGenerationRecovery(fixture);
      generation = 2;
      await vi.advanceTimersByTimeAsync(2_000);
      await entered;
      let closed = false;
      stopping = fixture.disposePlugin().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      release();
      await stopping;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(recoveries).toBe(1);
      expect(recoveryRows(fixture)).toEqual([
        { id: "generation-run-1", status: "orphaned", recovery_attempts: 1 },
        { id: "generation-run-2", status: "recoverable", recovery_attempts: 0 },
      ]);
    } finally {
      release();
      await stopping;
      vi.useRealTimers();
    }
  });

  it("never promotes missing, blank or nonnumeric configured estimates to a reported zero", () => {
    const entity = {
      id: crypto.randomUUID(),
      domain: "providers" as const,
      title: "受控费用配置，不是结算凭证",
      version: 0,
      createdAt: "2026-10-04T00:00:00.000Z",
      updatedAt: "2026-10-04T00:00:00.000Z",
      payload: {
        模型名称: "controlled-model",
        凭据引用: "controlled-opaque-reference",
      },
    };
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      false,
      true,
      [],
      [0],
      {},
      -1,
      NaN,
      Infinity,
      "unknown",
      "0x10",
      "1e-1000",
    ])
      expect(
        configuredProvider({
          ...entity,
          payload: { ...entity.payload, 单次预估费用: value },
        }),
      ).not.toHaveProperty("estimatedUnitCost");
    for (const [value, expected] of [
      [0, 0],
      ["0", 0],
      [" 0.00 ", 0],
      [0.125, 0.125],
      ["0.125", 0.125],
      ["1e-3", 0.001],
    ])
      expect(
        configuredProvider({
          ...entity,
          payload: { ...entity.payload, 单次预估费用: value },
        }).estimatedUnitCost,
      ).toBe(expected);
  });

  it("does not recover a live run when another engine becomes ready, but recovers a restarted generation", async () => {
    const fixture = await installProviderRoutes();
    const now = new Date().toISOString();
    fixture.uow.execute((tx) => {
      tx.run(
        `INSERT INTO agent_assistant_sessions(id, engine_session_id, engine_kind, surface, status, last_opened_at, created_at, updated_at)
        VALUES ('live-session', 'pi-session', 'pi', 'chapter', 'running', ?, ?, ?)`,
        now,
        now,
        now,
      );
      tx.run(
        `INSERT INTO agent_assistant_runs(id, session_id, task_id, task_type, engine_kind, status, engine_run_id, engine_generation, created_at, updated_at)
        VALUES ('live-run', 'live-session', 'task', 'expand', 'pi', 'running', 'pi-run', 7, ?, ?)`,
        now,
        now,
      );
    });
    let generation = 7;
    let recoveries = 0;
    const host = {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
        generation,
      }),
      engineOperation: async () => {
        recoveries++;
        return { disposition: "missing" };
      },
    } as unknown as DesktopHost;
    const context = { uow: fixture.uow } as PluginContext;
    await recoverAvailableAgentRuns(context, host);
    expect(recoveries).toBe(0);
    expect(
      fixture.uow.execute((tx) =>
        tx.get<{ status: string }>(
          "SELECT status FROM agent_assistant_runs WHERE id = 'live-run'",
        ),
      )?.status,
    ).toBe("running");
    generation = 8;
    await recoverAvailableAgentRuns(context, host);
    expect(recoveries).toBe(1);
    expect(
      fixture.uow.execute((tx) =>
        tx.get<{ status: string }>(
          "SELECT status FROM agent_assistant_runs WHERE id = 'live-run'",
        ),
      )?.status,
    ).toBe("orphaned");
    fixture.uow.execute((tx) =>
      tx.run(
        "UPDATE agent_assistant_runs SET status = 'recoverable', engine_generation = 8 WHERE id = 'live-run'",
      ),
    );
    await recoverAvailableAgentRuns(context, host);
    expect(recoveries).toBe(2);
  });
  it("removes Grok Build from historical evaluations and compacts retained candidates", async () => {
    const database = openDatabase(":memory:");
    const plugin = createAgentsPlugin();
    const migrations = plugin.migrations ?? [];
    const removalIndex = migrations.findIndex(
      (migration) => migration.id === "agents.0011.remove-grok-build",
    );
    const beforeGrokRemoval = migrations.slice(0, removalIndex);
    applyMigrations(database.sqlite, [
      ...(foundationPlugin.migrations ?? []),
      ...beforeGrokRemoval,
    ]);
    const now = new Date().toISOString();
    database.uow.execute((transaction) => {
      transaction.run(
        `INSERT INTO agent_evaluations(
          id, project_id, task_type, prompt, context_snapshot_json, status,
          revealed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '{}', 'completed', ?, ?, ?)`,
        "four-engine-evaluation",
        "project-four-engine-history",
        "outline",
        "历史四引擎实验",
        now,
        now,
        now,
      );
      transaction.run(
        `INSERT INTO agent_evaluation_candidates(
          id, evaluation_id, candidate, engine_kind, run_id, status,
          output_json, metrics_json
        ) VALUES
          ('candidate-pi', ?, 'a', 'pi', 'run-pi', 'succeeded', '{}', '{}'),
          ('candidate-grok', ?, 'b', 'grok', 'run-grok', 'succeeded', '{}', '{}'),
          ('candidate-codex', ?, 'c', 'codex', 'run-codex', 'succeeded', '{}', '{}'),
          ('candidate-langgraph', ?, 'd', 'langgraph', 'run-langgraph', 'succeeded', '{}', '{}')`,
        "four-engine-evaluation",
        "four-engine-evaluation",
        "four-engine-evaluation",
        "four-engine-evaluation",
      );
      transaction.run(
        `INSERT INTO agent_evaluation_reviews(
          evaluation_id, preferred_candidate, accepted, notes, created_at
        ) VALUES (?, 'd', 1, NULL, ?)`,
        "four-engine-evaluation",
        now,
      );
    });

    applyMigrations(database.sqlite, [
      ...(foundationPlugin.migrations ?? []),
      ...migrations,
    ]);
    try {
      expect(
        database.sqlite
          .prepare(
            "SELECT candidate, engine_kind FROM agent_evaluation_candidates ORDER BY candidate",
          )
          .all(),
      ).toEqual([
        { candidate: "a", engine_kind: "pi" },
        { candidate: "b", engine_kind: "codex" },
        { candidate: "c", engine_kind: "langgraph" },
      ]);
      expect(
        database.sqlite
          .prepare(
            "SELECT preferred_candidate FROM agent_evaluation_reviews WHERE evaluation_id = ?",
          )
          .get("four-engine-evaluation"),
      ).toEqual({ preferred_candidate: "c" });
    } finally {
      for (const ctx of nativeContexts.splice(0)) await ctx.fiber.dispose();
      database.close();
    }
  });

  it("keeps both candidate engines, models and providers anonymous until review and reveal", async () => {
    const fixture = await installProviderRoutes();
    const evaluationId = "anonymous-two-engine";
    const now = new Date().toISOString();
    fixture.uow.execute((transaction) => {
      transaction.run(
        `INSERT INTO agent_evaluations(
          id, project_id, task_type, prompt, context_snapshot_json, status,
          revealed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'ready_for_review', NULL, ?, ?)`,
        evaluationId,
        "project-anonymous",
        "outline",
        "匿名比较",
        JSON.stringify({
          projectId: "project-anonymous",
          model: { providerId: "provider-secret", modelId: "model-secret" },
        }),
        now,
        now,
      );
      for (const [index, engine] of ["pi", "langgraph"].entries())
        transaction.run(
          `INSERT INTO agent_evaluation_candidates(
            id, evaluation_id, candidate, engine_kind, run_id, status,
            output_json, metrics_json
          ) VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?)`,
          `anonymous-candidate-${index}`,
          evaluationId,
          ["a", "b"][index],
          engine,
          `anonymous-run-${index}`,
          JSON.stringify({ text: `候选 ${index + 1}` }),
          JSON.stringify({
            engine,
            engineVersion: "hidden-version",
            model: "hidden-model",
            provider: "hidden-provider",
            latencyMs: index + 1,
            inputTokens: 0,
            outputTokens: 0,
            cachedTokens: 0,
            estimatedCost: 0,
            currency: "USD",
          }),
        );
    });

    const anonymousResponse = await fixture.app.request(
      `http://runtime.test/api/v2/agent-experiments/${evaluationId}`,
    );
    expect(anonymousResponse.status).toBe(200);
    const anonymous = (await anonymousResponse.json()) as Record<
      string,
      unknown
    >;
    expect(anonymous).not.toHaveProperty("model");
    expect(anonymous.candidates).toHaveLength(2);
    for (const candidate of anonymous.candidates as Array<
      Record<string, unknown>
    >) {
      expect(candidate).not.toHaveProperty("engineKind");
      expect(candidate.metrics).not.toHaveProperty("engine");
      expect(candidate.metrics).not.toHaveProperty("engineVersion");
      expect(candidate.metrics).not.toHaveProperty("model");
      expect(candidate.metrics).not.toHaveProperty("provider");
      expect(candidate.metrics).not.toHaveProperty("inputTokens");
      expect(candidate.metrics).not.toHaveProperty("outputTokens");
      expect(candidate.metrics).not.toHaveProperty("cachedTokens");
      expect(candidate.metrics).not.toHaveProperty("estimatedCost");
      expect(candidate.metrics).not.toHaveProperty("currency");
    }

    const review = await fixture.app.request(
      `http://runtime.test/api/v2/agent-experiments/${evaluationId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredCandidate: "b", accepted: true }),
      },
    );
    expect(review.status).toBe(200);
    expect(await review.json()).not.toHaveProperty("model");

    const reveal = await fixture.app.request(
      `http://runtime.test/api/v2/agent-experiments/${evaluationId}/reveal`,
      { method: "POST" },
    );
    expect(reveal.status).toBe(200);
    const revealed = (await reveal.json()) as Record<string, unknown>;
    expect(revealed).toHaveProperty("model", {
      providerId: "provider-secret",
      modelId: "model-secret",
    });
    expect(
      (revealed.candidates as Array<Record<string, unknown>>).map(
        (candidate) => candidate.engineKind,
      ),
    ).toEqual(["pi", "langgraph"]);
    for (const candidate of revealed.candidates as Array<
      Record<string, unknown>
    >) {
      expect(candidate.metrics).not.toHaveProperty("inputTokens");
      expect(candidate.metrics).not.toHaveProperty("estimatedCost");
    }
  });

  it("exposes the typed Agent session contract without a generic engine-operation API", async () => {
    const host = {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
        authenticated: true,
      }),
      engineOperation: async (_engine: string, operation: string) => {
        if (operation === "create") return { id: "pi-session-1" };
        if (operation === "steer") return { ok: true };
        throw new Error(`unexpected operation: ${operation}`);
      },
    } as unknown as DesktopHost;
    const fixture = await installProviderRoutes(host);
    configureTestProvider(fixture);
    const created = await fixture.app.request(
      "http://runtime.test/api/v2/agent-sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engineKind: "pi",
          surface: "global",
          title: "类型化 Agent 会话",
        }),
      },
    );
    expect(created.status).toBe(201);
    const session = (await created.json()) as {
      id: string;
      engineKind: string;
    };
    expect(session).toMatchObject({ engineKind: "pi" });

    const restored = await fixture.app.request(
      `http://runtime.test/api/v2/agent-sessions/${session.id}`,
    );
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({ id: session.id });
    const started = await fixture.app.request(
      `http://runtime.test/api/v2/agent-sessions/${session.id}/runs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "typed-session-run-1",
        },
        body: JSON.stringify({ prompt: "你好" }),
      },
    );
    expect(started.status).toBe(200);
    const start = (await started.json()) as Record<string, unknown>;
    expect(typeof start.taskId).toBe("string");
    expect(start.sessionId).toBe(session.id);
    expect(typeof start.runId).toBe("string");
    expect(start).not.toHaveProperty("capabilityGrant");
    const events = await fixture.app.request(
      `http://runtime.test/api/v2/agent-runs/${start.runId}/events`,
    );
    expect(events.status).toBe(200);
    expect(events.headers.get("Content-Type")).toContain("text/event-stream");
    await events.body?.cancel();
    const steered = await fixture.app.request(
      `http://runtime.test/api/v2/agent-runs/${start.runId}/steer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "请简短一些" }),
      },
    );
    expect(steered.status).toBe(204);
    expect(
      (
        await fixture.app.request(
          "http://runtime.test/api/v2/agents/engines/codex/run",
          { method: "POST" },
        )
      ).status,
    ).toBe(404);
  });

  it("restores the saved intelligent-assistant provider when Runtime starts", async () => {
    let receivedConfiguration: Record<string, unknown> | undefined;
    const host = {
      activateAgentProvider: async (configuration: Record<string, unknown>) => {
        receivedConfiguration = configuration;
        return { available: true };
      },
    } as unknown as DesktopHost;
    const database = openDatabase(":memory:");
    const plugin = createAgentsPlugin(host);
    applyMigrations(database.sqlite, [
      ...(foundationPlugin.migrations ?? []),
      ...(plugin.migrations ?? []),
    ]);
    const now = new Date().toISOString();
    database.uow.execute((transaction) => {
      transaction.run(
        `INSERT INTO agent_provider_configurations(
           id, title, payload_json, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        "saved-provider",
        "DeepSeek",
        JSON.stringify({
          服务类型: "智能模型",
          模型名称: "deepseek-v4-flash",
          服务地址: "https://api.deepseek.com",
          调用协议: "OpenAI 兼容文本",
          Pi服务商: "deepseek",
          凭据引用: "credential-ref-only",
        }),
        0,
        now,
        now,
      );
      transaction.run(
        `INSERT INTO agent_provider_settings(singleton, provider_id, updated_at)
         VALUES (1, ?, ?)`,
        "saved-provider",
        now,
      );
    });
    try {
      nativeContexts.push(
        await mountTestPlugin(
          plugin,
          {
            http: { routeIds: [], register: () => () => undefined },
            uow: database.uow,
          },
          agentDependencies,
        ),
      );
      expect(receivedConfiguration).toMatchObject({
        providerId: "saved-provider",
        piProviderId: "deepseek",
        model: "deepseek-v4-flash",
        credentialRef: "credential-ref-only",
      });
      expect(receivedConfiguration).not.toHaveProperty("secret");
    } finally {
      for (const ctx of nativeContexts.splice(0)) await ctx.fiber.dispose();
      database.close();
    }
  });

  it("persists only an opaque credential reference and honors optimistic locking", async () => {
    const fixture = await installProviderRoutes();
    const created = await fixture.app.request(
      "http://runtime.test/api/v2/providers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "DeepSeek",
          payload: {
            服务类型: "智能模型",
            模型名称: "deepseek-chat",
            服务地址: "https://api.deepseek.com",
            调用协议: "OpenAI 兼容文本",
            凭据引用: "credential-ref-only",
          },
        }),
      },
    );

    expect(created.status).toBe(200);
    expect(created.headers.get("ETag")).toBe('"0"');
    const provider = (await created.json()) as {
      id: string;
      payload: Record<string, unknown>;
      version: number;
    };
    expect(provider.payload).toMatchObject({ 凭据引用: "credential-ref-only" });

    const forbidden = await fixture.app.request(
      "http://runtime.test/api/v2/providers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "invalid",
          payload: { apiKey: "must-not-be-stored" },
        }),
      },
    );
    expect(forbidden.status).toBe(400);

    const missingPrecondition = await fixture.app.request(
      `http://runtime.test/api/v2/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 0, title: "DeepSeek API" }),
      },
    );
    expect(missingPrecondition.status).toBe(428);

    const updated = await fixture.app.request(
      `http://runtime.test/api/v2/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": '"0"' },
        body: JSON.stringify({ version: 0, title: "DeepSeek API" }),
      },
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      title: "DeepSeek API",
      version: 1,
    });

    const stale = await fixture.app.request(
      `http://runtime.test/api/v2/providers/${provider.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": '"0"' },
        body: JSON.stringify({ version: 0, title: "stale" }),
      },
    );
    expect(stale.status).toBe(412);
    expect(fixture.eventCount()).toBe(2);
  });

  it("activates an opaque provider reference through the Desktop Host", async () => {
    let receivedConfiguration: Record<string, unknown> | undefined;
    const host = {
      activateAgentProvider: async (configuration: Record<string, unknown>) => {
        receivedConfiguration = configuration;
        return { available: true };
      },
      engineHealth: async (kind: string) => ({
        available: true,
        healthy: true,
        version: `${kind}-test-version`,
      }),
    } as unknown as DesktopHost;
    const fixture = await installProviderRoutes(host);
    const initialEngines = await fixture.app.request(
      "http://runtime.test/api/v2/agent-engines",
    );
    expect(initialEngines.status).toBe(200);
    await expect(initialEngines.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pi", status: "unavailable" }),
        expect.objectContaining({ kind: "pi", status: "unavailable" }),
      ]),
    );
    const created = await fixture.app.request(
      "http://runtime.test/api/v2/providers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "DeepSeek",
          payload: {
            服务类型: "智能模型",
            模型名称: "deepseek-v4-flash",
            服务地址: "https://api.deepseek.com",
            调用协议: "OpenAI 兼容文本",
            预设服务商: "deepseek",
            凭据引用: "credential-ref-only",
          },
        }),
      },
    );
    const provider = (await created.json()) as { id: string };

    const activated = await fixture.app.request(
      `http://runtime.test/api/v2/providers/${provider.id}/activate-for-agent`,
      { method: "POST" },
    );

    expect(activated.status).toBe(200);
    await expect(activated.json()).resolves.toMatchObject({
      providerId: provider.id,
      engineAvailable: true,
      providerKind: "openai",
      model: "deepseek-v4-flash",
    });
    expect(receivedConfiguration).toMatchObject({
      providerId: provider.id,
      runtimeProviderId: "dramaip-agent",
      providerAdapter: "openai-compatible",
      credentialRef: "credential-ref-only",
    });
    expect(receivedConfiguration).not.toHaveProperty("secret");

    const configuredEngines = await fixture.app.request(
      "http://runtime.test/api/v2/agent-engines",
    );
    await expect(configuredEngines.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pi", status: "available" }),
        expect.objectContaining({ kind: "pi", status: "available" }),
      ]),
    );

    const globalSettings = await fixture.app.request(
      "http://runtime.test/api/v2/agent-settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultEngineKind: "pi",
          defaultModel: { modelId: "deepseek-v4-flash" },
        }),
      },
    );
    await expect(globalSettings.json()).resolves.toMatchObject({
      defaultEngineKind: "pi",
      defaultModel: { modelId: "deepseek-v4-flash" },
      activeProviderId: provider.id,
    });
    expect(fixture.eventCount()).toBe(3);
  });

  it("activates a fixed local runtime without persisting credentials or URLs", async () => {
    let receivedConfiguration: Record<string, unknown> | undefined;
    const host = {
      activateAgentProvider: async (configuration: Record<string, unknown>) => {
        receivedConfiguration = configuration;
        return { available: true };
      },
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
      }),
    } as unknown as DesktopHost;
    const fixture = await installProviderRoutes(host);
    const created = await fixture.app.request(
      "http://runtime.test/api/v2/providers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "本地 Ollama",
          payload: {
            服务类型: "智能模型",
            模型名称: "qwen3:8b",
            调用协议: "OpenAI 兼容文本",
            认证方式: "none",
            本地运行时: "ollama",
          },
        }),
      },
    );
    expect(created.status).toBe(200);
    const provider = (await created.json()) as {
      id: string;
      payload: Record<string, unknown>;
    };
    expect(provider.payload).not.toHaveProperty("凭据引用");
    expect(provider.payload).not.toHaveProperty("服务地址");

    const activated = await fixture.app.request(
      `http://runtime.test/api/v2/providers/${provider.id}/activate-for-agent`,
      { method: "POST" },
    );
    expect(activated.status, await activated.clone().text()).toBe(200);
    expect(receivedConfiguration).toMatchObject({
      authentication: "none",
      localRuntimeKind: "ollama",
      model: "qwen3:8b",
      providerAdapter: "openai-compatible",
    });
    expect(receivedConfiguration).not.toHaveProperty("credentialRef");
    expect(receivedConfiguration).not.toHaveProperty("baseUrl");
  });

  it.each(["global", "inspiration"])(
    "names a %s conversation from the first message once and keeps reply text separate",
    async (surface) => {
      const requests: Record<string, unknown>[] = [];
      const host = {
        engineHealth: async () => ({
          available: true,
          healthy: true,
          configured: true,
        }),
        engineOperation: async () => ({ id: crypto.randomUUID() }),
        async *engineStream(_kind: string, payload: Record<string, unknown>) {
          requests.push(payload);
          yield { type: "content.delta", delta: "这座城市的钟表都在倒走。" };
          yield {
            type: "result",
            result: {
              text: "这座城市的钟表都在倒走。",
              conversationTitle:
                requests.length === 1
                  ? "海底城市与失踪邮差"
                  : "不得覆盖的第二次标题",
            },
          };
        },
      } as unknown as DesktopHost;
      const fixture = await installProviderRoutes(host);
      configureTestProvider(fixture);
      const created = await fixture.app.request(
        "http://runtime.test/api/v2/assistant-conversations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surface, webAccessMode: "off" }),
        },
      );
      expect(created.status).toBe(201);
      const conversation = (await created.json()) as { id: string };
      const first = "我想写一座海底城市，主角是寻找失踪邮差的修表匠。";
      const send = (message: string) =>
        fixture.app.request(
          `http://runtime.test/api/v2/assistant-conversations/${conversation.id}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          },
        );
      const read = async () =>
        (
          await fixture.app.request(
            `http://runtime.test/api/v2/assistant-conversations/${conversation.id}`,
          )
        ).json() as Promise<{
          conversation: { title: string; status: string };
          items: Array<{ content: string }>;
          runs: Array<{ status: string }>;
        }>;
      expect((await send(first)).status).toBe(200);
      await vi.waitFor(async () =>
        expect((await read()).conversation).toMatchObject({
          title: "海底城市与失踪邮差",
          status: "idle",
        }),
      );
      expect(requests[0]?.conversationTitle).toEqual({ firstMessage: first });
      expect((await read()).items).toContainEqual(
        expect.objectContaining({ content: "这座城市的钟表都在倒走。" }),
      );
      expect((await send("接下来设计冲突。")).status).toBe(200);
      await vi.waitFor(async () =>
        expect(
          (await read()).runs.every((run) => run.status === "completed"),
        ).toBe(true),
      );
      expect(requests).toHaveLength(2);
      expect(requests[1]).not.toHaveProperty("conversationTitle");
      expect((await read()).conversation.title).toBe("海底城市与失踪邮差");
      expect(
        fixture.uow.execute((tx) =>
          tx.get<{ title_status: string }>(
            "SELECT title_status FROM agent_assistant_sessions WHERE id = ?",
            conversation.id,
          ),
        )?.title_status,
      ).toBe("generated");
    },
  );

  it.each(["我的手动标题", "新对话"])(
    "does not overwrite a manual rename to %s while the first reply is pending",
    async (title) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const host = {
        engineHealth: async () => ({
          available: true,
          healthy: true,
          configured: true,
        }),
        engineOperation: async () => ({ id: crypto.randomUUID() }),
        async *engineStream() {
          yield { type: "content.delta", delta: "正常回复" };
          await gate;
          yield {
            type: "result",
            result: {
              text: "正常回复",
              conversationTitle: "不得覆盖的模型标题",
            },
          };
        },
      } as unknown as DesktopHost;
      const fixture = await installProviderRoutes(host);
      configureTestProvider(fixture);
      const response = await fixture.app.request(
        "http://runtime.test/api/v2/assistant-conversations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ surface: "global", webAccessMode: "off" }),
        },
      );
      const conversation = (await response.json()) as { id: string };
      try {
        await fixture.app.request(
          `http://runtime.test/api/v2/assistant-conversations/${conversation.id}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "设计一个海底城市。" }),
          },
        );
        const renamed = await fixture.app.request(
          `http://runtime.test/api/v2/assistant-conversations/${conversation.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          },
        );
        expect(renamed.status).toBe(200);
        release();
        await vi.waitFor(async () => {
          const detail = (await (
            await fixture.app.request(
              `http://runtime.test/api/v2/assistant-conversations/${conversation.id}`,
            )
          ).json()) as { conversation: { title: string; status: string } };
          expect(detail.conversation).toMatchObject({ title, status: "idle" });
        });
      } finally {
        release();
      }
    },
  );

  it("retries a missing title using the original first message and never titles an explicitly named conversation", async () => {
    const requests: Record<string, unknown>[] = [];
    const host = {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
      }),
      engineOperation: async () => ({ id: crypto.randomUUID() }),
      async *engineStream(_kind: string, payload: Record<string, unknown>) {
        requests.push(payload);
        yield {
          type: "result",
          result: {
            text: "正常回复",
            ...(requests.length === 2
              ? { conversationTitle: "最初的海底城市构思" }
              : {}),
          },
        };
      },
    } as unknown as DesktopHost;
    const fixture = await installProviderRoutes(host);
    configureTestProvider(fixture);
    const create = async (title?: string) =>
      (await (
        await fixture.app.request(
          "http://runtime.test/api/v2/assistant-conversations",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              surface: "global",
              webAccessMode: "off",
              ...(title ? { title } : {}),
            }),
          },
        )
      ).json()) as { id: string };
    const send = async (id: string, message: string) => {
      expect(
        (
          await fixture.app.request(
            `http://runtime.test/api/v2/assistant-conversations/${id}/messages`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message }),
            },
          )
        ).status,
      ).toBe(200);
      await vi.waitFor(() =>
        expect(
          fixture.uow.execute((tx) =>
            tx.get<{ status: string }>(
              "SELECT status FROM agent_assistant_sessions WHERE id = ?",
              id,
            ),
          )?.status,
        ).toBe("idle"),
      );
    };
    const conversation = await create();
    await send(conversation.id, "最初的海底城市构思");
    await send(conversation.id, "完全不同的第二条消息");
    expect(
      requests.slice(0, 2).map((request) => request.conversationTitle),
    ).toEqual([
      { firstMessage: "最初的海底城市构思" },
      { firstMessage: "最初的海底城市构思" },
    ]);
    const named = await create("用户指定名称");
    await send(named.id, "这不是标题来源");
    expect(requests[2]).not.toHaveProperty("conversationTitle");
  });

  it("acknowledges an assistant turn and persists engine deltas before completion", async () => {
    const engineCalls: Array<{
      operation: string;
      payload: Record<string, unknown>;
    }> = [];
    let releaseStream: (() => void) | undefined;
    const host = {
      activateAgentProvider: async () => ({ available: true }),
      engineHealth: async () => ({
        available: true,
        healthy: true,
        authenticated: true,
      }),
      engineOperation: async (
        _engine: string,
        operation: string,
        payload: Record<string, unknown>,
      ) => {
        engineCalls.push({ operation, payload });
        if (operation === "create") return { id: "pi-session-1" };
        throw new Error(`unexpected operation: ${operation}`);
      },
      async *engineStream(_engine: string, payload: Record<string, unknown>) {
        engineCalls.push({ operation: "stream", payload });
        yield { type: "content.delta", delta: "你好，" };
        await new Promise<void>((resolvePromise) => {
          releaseStream = resolvePromise;
        });
        yield { type: "content.delta", delta: "DramaIP 已收到。" };
        yield {
          type: "usage",
          measurementScope: "response-increment",
          inputTokens: 0,
          outputTokens: 12,
        };
        yield {
          type: "usage",
          measurementScope: "session-total",
          inputTokens: 200,
          outputTokens: 50,
          cachedTokens: 0,
        };
        yield {
          type: "result",
          result: { parts: [{ type: "text", text: "你好，DramaIP 已收到。" }] },
        };
      },
    } as unknown as DesktopHost;
    const fixture = await installProviderRoutes(host);
    const configured = await fixture.app.request(
      "http://runtime.test/api/v2/providers",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "DeepSeek",
          payload: {
            服务类型: "智能模型",
            模型名称: "deepseek-v4-flash",
            服务地址: "https://api.deepseek.com",
            调用协议: "OpenAI 兼容文本",
            凭据引用: "credential-ref-only",
          },
        }),
      },
    );
    const provider = (await configured.json()) as { id: string };
    const activated = await fixture.app.request(
      `http://runtime.test/api/v2/providers/${provider.id}/activate-for-agent`,
      { method: "POST" },
    );
    expect(activated.status).toBe(200);

    const created = await fixture.app.request(
      "http://runtime.test/api/v2/assistant-conversations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "global",
          engineKind: "pi",
          model: { providerId: provider.id, modelId: "deepseek-v4-pro" },
        }),
      },
    );
    expect(created.status).toBe(201);
    const conversation = (await created.json()) as { id: string };
    expect(typeof conversation.id).toBe("string");
    expect(conversation).toMatchObject({
      engineSessionId: "pi-session-1",
      engineKind: "pi",
      surface: "global",
      status: "idle",
    });

    const sent = await fixture.app.request(
      `http://runtime.test/api/v2/assistant-conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      },
    );
    expect(sent.status).toBe(200);
    const sentBody = (await sent.json()) as {
      run: { id: string; engineKind: string; status: string };
    };
    expect(sentBody).toMatchObject({
      conversation: { id: conversation.id, status: "running" },
      turn: { userMessage: "hello", status: "running" },
      run: { engineKind: "pi", status: "preparing" },
    });
    const contextSnapshot = await fixture.app.request(
      `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}/context-snapshot`,
    );
    expect(contextSnapshot.status).toBe(200);
    await expect(contextSnapshot.json()).resolves.toMatchObject({
      destination: { kind: "cloud", provider: provider.id },
      manifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      finalPromptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(engineCalls).toEqual([
      expect.objectContaining({
        operation: "create",
        payload: expect.objectContaining({
          model: { providerId: provider.id, modelId: "deepseek-v4-pro" },
        }),
      }),
      expect.objectContaining({
        operation: "stream",
        payload: expect.objectContaining({
          engineSessionId: "pi-session-1",
          runId: expect.any(String),
        }),
      }),
    ]);
    for (let attempt = 0; !releaseStream && attempt < 50; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(releaseStream).toBeDefined();

    const runningDetail = await fixture.app.request(
      `http://runtime.test/api/v2/assistant-conversations/${conversation.id}`,
    );
    await expect(runningDetail.json()).resolves.toMatchObject({
      conversation: { id: conversation.id },
      turns: [expect.objectContaining({ userMessage: "hello" })],
      runs: [expect.objectContaining({ status: "running" })],
      items: [
        expect.objectContaining({ content: "你好，", status: "streaming" }),
      ],
    });
    expect(fixture.liveEvents).toContainEqual(
      expect.objectContaining({ type: "agents.assistant-item-started.v1" }),
    );

    const duplicate = await fixture.app.request(
      `http://runtime.test/api/v2/assistant-conversations/${conversation.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "second message" }),
      },
    );
    expect(duplicate.status).toBe(409);

    releaseStream!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const completedDetail = await fixture.app.request(
      `http://runtime.test/api/v2/assistant-conversations/${conversation.id}`,
    );
    await expect(completedDetail.json()).resolves.toMatchObject({
      conversation: { id: conversation.id, status: "idle" },
      turns: [
        expect.objectContaining({ userMessage: "hello", status: "succeeded" }),
      ],
      runs: [expect.objectContaining({ status: "completed" })],
      items: [expect.objectContaining({ content: "你好，DramaIP 已收到。" })],
    });
    const usage = await fixture.app.request(
      `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}/usage-observations?limit=1`,
    );
    expect(usage.status).toBe(200);
    await expect(usage.json()).resolves.toMatchObject({
      observationCount: 2,
      coverage: "partial-or-unknown",
      items: [
        {
          cursor: 4,
          measurementScope: "session-total",
          inputTokens: { status: "reported", value: 200 },
          cachedTokens: { status: "reported", value: 0 },
        },
      ],
      nextCursor: 4,
    });
    const priorUsage = await fixture.app.request(
      `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}/usage-observations?cursor=4`,
    );
    await expect(priorUsage.json()).resolves.toMatchObject({
      items: [
        {
          cursor: 3,
          inputTokens: { status: "reported", value: 0 },
          cachedTokens: { status: "unreported" },
        },
      ],
    });
    expect(
      (
        await fixture.app.request(
          `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}/usage-observations?projectId=wrong`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fixture.app.request(
          `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}/usage-observations?cursor=2`,
        )
      ).status,
    ).toBe(400);
    expect(
      fixture.uow.execute((tx) =>
        tx.get(
          "SELECT COUNT(*) AS count FROM agent_usage_observations WHERE run_id = ?",
          sentBody.run.id,
        ),
      ),
    ).toEqual({ count: 2 });
    const count = fixture.eventCount();
    fixture.uow.execute((tx) =>
      tx.run(
        "UPDATE agent_assistant_sessions SET project_id = 'later-project' WHERE id = ?",
        conversation.id,
      ),
    );
    const boundDetail = await fixture.app.request(
      `http://runtime.test/api/v2/assistant-conversations/${conversation.id}`,
    );
    await expect(boundDetail.json()).resolves.toMatchObject({
      conversation: { projectId: "later-project" },
      runs: [
        {
          usageScope: {
            runId: sentBody.run.id,
            sessionId: conversation.id,
            origin: "frozen-context",
          },
        },
      ],
    });
    const boundRun = await fixture.app.request(
      `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}`,
    );
    const runValue = (await boundRun.json()) as {
      lastEngineCursor: number;
      usageScope: { projectId?: string };
    };
    expect(runValue.lastEngineCursor).toBe(5);
    expect(runValue.usageScope).not.toHaveProperty("projectId");
    expect(
      (
        await fixture.app.request(
          `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}/usage-observations?projectId=later-project`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fixture.app.request(
          `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}/usage-observations`,
        )
      ).status,
    ).toBe(200);
    fixture.uow.execute((tx) =>
      tx.run(
        "UPDATE agent_usage_observations SET observation_json = json_set(observation_json, '$.inputTokens.value', 123456) WHERE run_id = ? AND engine_cursor = 4",
        sentBody.run.id,
      ),
    );
    const unverifiable = await fixture.app.request(
      `http://runtime.test/api/v2/agent-runs/${sentBody.run.id}/usage-observations`,
    );
    expect(unverifiable.status).toBe(503);
    expect(unverifiable.headers.get("Content-Type")).toContain(
      "application/problem+json",
    );
    await expect(unverifiable.json()).resolves.toMatchObject({
      code: "AGENT_USAGE_UNVERIFIABLE",
      status: 503,
    });
    expect(fixture.eventCount()).toBe(count);
  });

  it("keeps inspiration conversations projectless and persists their cards and consent", async () => {
    const engineCalls: Array<{
      operation: string;
      payload: Record<string, unknown>;
    }> = [];
    const host = {
      activateAgentProvider: async () => ({ available: true }),
      engineHealth: async () => ({
        available: true,
        healthy: true,
        authenticated: true,
      }),
      engineOperation: async (
        _engine: string,
        operation: string,
        payload: Record<string, unknown>,
      ) => {
        engineCalls.push({ operation, payload });
        if (operation === "create") return { id: "inspiration-engine-session" };
        if (operation === "fork") return { id: "inspiration-engine-fork" };
        if (operation === "dispose") return { ok: true };
        throw new Error(`unexpected operation: ${operation}`);
      },
      async *engineStream(_engine: string, payload: Record<string, unknown>) {
        engineCalls.push({ operation: "stream", payload });
        yield {
          type: "tool",
          status: "started",
          tool: "dramaip_curl",
          itemId: "read-1",
          detail: {
            arguments: { url: "https://example.com/source" },
          },
        };
        yield {
          type: "tool",
          status: "completed",
          tool: "dramaip_curl",
          itemId: "read-1",
          detail: {
            result: {
              title: "公开来源",
              url: "https://example.com/source",
              contentType: "text/html",
              retrievedAt: "2026-08-29T00:00:00.000Z",
              truncated: false,
              content: "UNPERSISTED_WEB_BODY",
              authorization: "Bearer UNPERSISTED_GRANT",
            },
          },
        };
        yield {
          type: "tool",
          status: "failed",
          tool: "dramaip_curl",
          itemId: "failed-read",
          detail: {
            error:
              "Public DNS resolution failed Bearer secret-run-token /Users/alice/private/story.txt",
          },
        };
        yield { type: "content.delta", delta: "我们先追问这个画面。" };
        yield {
          type: "result",
          result: { parts: [{ type: "text", text: "我们先追问这个画面。" }] },
        };
      },
    } as unknown as DesktopHost;
    const fixture = await installProviderRoutes(host);
    configureTestProvider(fixture);

    const forbidden = await fixture.app.request(
      "http://runtime.test/api/v2/assistant-conversations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "inspiration",
          projectId: crypto.randomUUID(),
          engineKind: "pi",
        }),
      },
    );
    expect(forbidden.status).toBe(400);

    const createdResponse = await fixture.app.request(
      "http://runtime.test/api/v2/assistant-conversations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "inspiration",
          creativeMode: "guided",
          engineKind: "pi",
        }),
      },
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string };
    const createdDetail = await fixture.app.request(
      `http://runtime.test/api/v2/assistant-conversations/${created.id}`,
    );
    await expect(createdDetail.json()).resolves.toMatchObject({
      conversation: {
        id: created.id,
        surface: "inspiration",
        creativeMode: "guided",
        promptPolicyVersion: "inspiration.v1",
      },
    });

    const settings = await fixture.app.request(
      "http://runtime.test/api/v2/inspiration-memory-settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      },
    );
    await expect(settings.json()).resolves.toMatchObject({ enabled: true });

    const webSettings = await fixture.app.request(
      "http://runtime.test/api/v2/assistant-web-research-settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consented: true }),
      },
    );
    await expect(webSettings.json()).resolves.toMatchObject({
      consented: true,
    });

    const card = await fixture.app.request(
      "http://runtime.test/api/v2/inspiration-cards",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: created.id,
          kind: "premise",
          title: "月球上的旧剧院",
          content: "停电后，所有观众都忘记了自己的身份。",
        }),
      },
    );
    expect(card.status).toBe(201);
    const cards = await fixture.app.request(
      `http://runtime.test/api/v2/inspiration-cards?conversationId=${created.id}`,
    );
    await expect(cards.json()).resolves.toEqual([
      expect.objectContaining({ kind: "premise", title: "月球上的旧剧院" }),
    ]);

    const sent = await fixture.app.request(
      `http://runtime.test/api/v2/assistant-conversations/${created.id}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "我只看见一排空座位。" }),
      },
    );
    expect(sent.status).toBe(200);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const detailResponse = await fixture.app.request(
        `http://runtime.test/api/v2/assistant-conversations/${created.id}`,
      );
      const detail = (await detailResponse.json()) as {
        conversation: { status: string };
      };
      if (detail.conversation.status === "idle") break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const stream = engineCalls.find((call) => call.operation === "stream");
    expect(stream).toBeDefined();
    expect(stream?.payload).toMatchObject({
      capabilityGrant: {
        token: expect.any(String),
        expiresAt: expect.any(String),
      },
    });
    expect(
      fixture.uow.execute(
        (transaction) =>
          transaction.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM agent_capability_grants",
          )?.count,
      ),
    ).toBe(1);
    const grant = fixture.uow.execute((transaction) =>
      transaction.get<{
        id: string;
        consumed_at: string | null;
        capabilities_json: string;
      }>(
        "SELECT id, consumed_at, capabilities_json FROM agent_capability_grants LIMIT 1",
      ),
    );
    expect(grant?.consumed_at).not.toBeNull();
    expect(JSON.parse(grant?.capabilities_json ?? "[]")).toEqual(["web.read"]);
    const persistedToolPayloads = fixture.uow.execute((transaction) =>
      transaction
        .all<{ payload_json: string }>(
          "SELECT payload_json FROM agent_assistant_items WHERE type IN ('tool_call', 'tool_result') ORDER BY sequence",
        )
        .map((item) => item.payload_json)
        .join("\n"),
    );
    expect(persistedToolPayloads).toContain("公开来源");
    expect(persistedToolPayloads).toContain(
      "域名解析失败，请检查代理或 DNS 设置。",
    );
    expect(persistedToolPayloads).not.toMatch(
      /secret-run-token|\/Users\/alice|UNPERSISTED_WEB_BODY|UNPERSISTED_GRANT/u,
    );
    expect(persistedToolPayloads).not.toContain(grant?.id ?? "missing-grant");

    const forkedResponse = await fixture.app.request(
      `http://runtime.test/api/v2/agent-sessions/${created.id}/fork`,
      { method: "POST" },
    );
    expect(forkedResponse.status).toBe(201);
    const forked = (await forkedResponse.json()) as {
      id: string;
      parentSessionId: string;
    };
    expect(forked.parentSessionId).toBe(created.id);
    const forkedDetailResponse = await fixture.app.request(
      `http://runtime.test/api/v2/assistant-conversations/${forked.id}`,
    );
    const forkedDetail = (await forkedDetailResponse.json()) as {
      turns: Array<{ userMessage: string }>;
      items: Array<{ content?: string }>;
    };
    expect(forkedDetail.turns).toEqual([
      expect.objectContaining({ userMessage: "我只看见一排空座位。" }),
    ]);
    expect(forkedDetail.items).toContainEqual(
      expect.objectContaining({ content: "我们先追问这个画面。" }),
    );
    const forkedCards = await fixture.app.request(
      `http://runtime.test/api/v2/inspiration-cards?conversationId=${forked.id}`,
    );
    await expect(forkedCards.json()).resolves.toEqual([
      expect.objectContaining({ kind: "premise", title: "月球上的旧剧院" }),
    ]);
  });
});

function seedGenerationRecovery(fixture: InstalledProviderRoutes): void {
  const now = new Date().toISOString();
  fixture.uow.execute((tx) => {
    tx.run(
      `INSERT INTO agent_provider_configurations(id, title, payload_json, version, created_at, updated_at)
      VALUES ('generation-provider', '受控恢复配置，无真实凭据', ?, 0, ?, ?)`,
      JSON.stringify({
        服务类型: "智能模型",
        模型名称: "controlled-model",
        凭据引用: "controlled-reference",
      }),
      now,
      now,
    );
    tx.run(
      "INSERT INTO agent_provider_settings(singleton, provider_id, updated_at) VALUES (1, 'generation-provider', ?)",
      now,
    );
    for (const ordinal of [1, 2]) {
      tx.run(
        `INSERT INTO agent_assistant_sessions(id, engine_session_id, engine_kind, surface, status, last_opened_at, created_at, updated_at)
        VALUES (?, ?, 'pi', 'chapter', 'running', ?, ?, ?)`,
        `generation-session-${ordinal}`,
        `controlled-session-${ordinal}`,
        now,
        now,
        now,
      );
      tx.run(
        `INSERT INTO agent_assistant_runs(id, session_id, task_id, task_type, engine_kind, status, engine_run_id, engine_generation, created_at, updated_at)
        VALUES (?, ?, 'task', 'expand', 'pi', 'recoverable', ?, 1, ?, ?)`,
        `generation-run-${ordinal}`,
        `generation-session-${ordinal}`,
        `controlled-run-${ordinal}`,
        now,
        now,
      );
    }
  });
}

function recoveryRows(fixture: InstalledProviderRoutes) {
  return fixture.uow.execute((tx) =>
    tx.all<{ id: string; status: string; recovery_attempts: number }>(
      "SELECT id, status, recovery_attempts FROM agent_assistant_runs WHERE id LIKE 'generation-run-%' ORDER BY id",
    ),
  );
}
