import { mountTestPlugin } from "./plugin-test-fixture.js";
import type { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { foundationPlugin } from "@dramaip/foundation";
import { createAgentsPlugin } from "@dramaip/agents";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import { WRITING_RESOURCE_SERVICE } from "@dramaip/contracts/writing";
import { CREATIVE_KNOWLEDGE_SERVICE } from "@dramaip/contracts/creative-intelligence";
import { KNOWLEDGE_STORY_ASSERTION_SERVICE } from "@dramaip/contracts/knowledge";
import { createRuntimeHttp } from "@dramaip/http";
import type {
  PluginContext,
  RouteContribution,
  UnitOfWork,
} from "@dramaip/plugin-api/internal";
import { recoverAvailableAgentRuns } from "../../../plugins/agents/src/runs/recovery.js";
import { runEvaluationCandidate } from "../../../plugins/agents/src/experiments/routes.js";
import {
  configuredProvider,
  modelSelection,
} from "../../../plugins/agents/src/providers/routes.js";
import { createAgentTaskRunner } from "../../../plugins/agents/src/runs/task-runner.js";

interface InstalledProviderRoutes {
  app: OpenAPIHono;
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
  host?: DesktopHostClient,
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
  const app = new OpenAPIHono();
  for (const route of routes) {
    const register = app.openapi as unknown as (
      declaration: unknown,
      handler: (...args: never[]) => unknown,
    ) => void;
    register.call(app, route.declaration, route.handler);
  }
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

afterEach(async () => {
  for (const ctx of nativeContexts.splice(0)) await ctx.fiber.dispose();
  while (installed.length > 0) installed.pop()!.close();
});

describe("agents provider configurations", () => {
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
      { engineHealth, engineOperation } as unknown as DesktopHostClient,
      {
        createPreview,
        previewCreation,
        prepareCreation,
      } as unknown as Parameters<typeof createAgentTaskRunner>[2],
    );
    const input = {
      projectId: crypto.randomUUID(),
      engineKind: "codex" as const,
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
      { engineHealth, engineOperation } as unknown as DesktopHostClient,
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
          body: { defaultEngineKind: "codex", defaultModel: model },
        },
        {
          path: `/api/v2/projects/${projectId}/agent-settings`,
          method: "PUT",
          body: { defaultEngineKind: "codex", defaultModel: model },
        },
        {
          path: "/api/v2/assistant-conversations",
          method: "POST",
          body: { engineKind: "codex", surface: "global", model },
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
        expect(response.status).toBe(400);
        const text = await response.text();
        expect(text).toContain("VALIDATION_ERROR");
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
    } as unknown as DesktopHostClient;
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
    } as unknown as DesktopHostClient;
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
    } as unknown as DesktopHostClient;
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
    } as unknown as DesktopHostClient;
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

  it("does not allocate a blind experiment when engine readiness returns after the plugin has stopped", async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let delayReadiness = false;
    const host = {
      engineHealth: async () => {
        if (delayReadiness) {
          entered();
          await gate;
        }
        return {
          available: true,
          healthy: true,
          configured: true,
          authenticated: true,
        };
      },
      async *engineStream() {
        calls++;
        yield { type: "result", result: { text: "不得派发" } };
      },
    } as unknown as DesktopHostClient;
    const fixture = await installProviderRoutes(host);
    delayReadiness = true;
    const pending = fixture.app.request(
      "http://runtime.test/api/v2/agent-experiments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: crypto.randomUUID(),
          taskType: "outline",
          prompt: "只用于停止期间的健康检查延迟测试",
        }),
      },
    );
    try {
      await started;
      await fixture.disposePlugin();
      release();
      const response = await pending;
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      expect(await response.json()).toMatchObject({
        code: "AGENT_PLUGIN_STOPPING",
        status: 503,
      });
      expect(calls).toBe(0);
      for (const table of [
        "agent_evaluations",
        "agent_context_snapshots",
        "agent_evaluation_candidates",
        "agent_capability_grants",
        "agent_auxiliary_usage_runs",
      ])
        expect(
          fixture.uow.execute((tx) =>
            tx.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`),
          )?.count,
        ).toBe(0);
    } finally {
      release();
      await pending;
    }
  });

  it("drains all dispatched blind candidates before native plugin disposal completes and rejects a new request during stopping", async () => {
    const projectId = crypto.randomUUID();
    let release!: () => void;
    let releaseFirst!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const releasing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let calls = 0;
    let destroying = 0;
    let destroyed = 0;
    const host = {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
        authenticated: true,
      }),
      engineOperation: async (kind: string, operation: string) => {
        if (operation === "create") return { id: `controlled-${kind}` };
        if (operation === "destroy") {
          destroying++;
          if (destroying === 3) entered();
          await (destroying === 1 ? firstGate : gate);
          destroyed++;
          return { ok: true };
        }
        throw new Error(`Unexpected ${operation}`);
      },
      async *engineStream() {
        calls++;
        yield { type: "usage", inputTokens: 0, outputTokens: 12 };
        yield {
          type: "result",
          result: { text: "受控盲测候选，不是模型质量证据" },
        };
      },
    } as unknown as DesktopHostClient;
    const fixture = await installProviderRoutes(host, {
      [WORKSPACE_PROJECT_SERVICE.id]: {
        get: () => ({ id: projectId, title: "受控项目", version: 0 }),
      },
      [WRITING_RESOURCE_SERVICE.id]: { list: () => [] },
      [CREATIVE_KNOWLEDGE_SERVICE.id]: {
        listNodes: () => [],
        listEdges: () => [],
      },
      [KNOWLEDGE_STORY_ASSERTION_SERVICE.id]: {
        references: () => [],
        isSourceAnchored: () => false,
      },
    });
    fixture.uow.execute((tx) => {
      const now = new Date().toISOString();
      tx.run(
        `INSERT INTO agent_provider_configurations
         (id, title, payload_json, version, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
        "controlled-provider",
        "受控延迟测试服务商",
        JSON.stringify({ 凭据引用: "controlled-opaque-reference" }),
        now,
        now,
      );
      tx.run(
        `INSERT INTO agent_provider_settings(singleton, provider_id, updated_at)
         VALUES (1, ?, ?)`,
        "controlled-provider",
        now,
      );
    });
    const create = () =>
      fixture.app.request("http://runtime.test/api/v2/agent-experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          taskType: "outline",
          prompt: "只用于工程延迟验证",
        }),
      });
    let stopping: Promise<void> | undefined;
    try {
      const response = await create();
      expect(response.status, await response.clone().text()).toBe(202);
      await releasing;
      expect(calls).toBe(3);
      let closed = false;
      stopping = fixture.disposePlugin().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(destroyed).toBe(0);
      const rejected = await create();
      expect(rejected.status).toBe(503);
      expect(rejected.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      expect(await rejected.json()).toMatchObject({
        code: "AGENT_PLUGIN_STOPPING",
        status: 503,
      });
      expect(calls).toBe(3);
      releaseFirst();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(destroyed).toBe(1);
      expect(closed).toBe(false);
      expect(
        fixture.uow.execute((tx) =>
          tx.get<{ status: string }>(
            "SELECT status FROM agent_evaluations LIMIT 1",
          ),
        )?.status,
      ).toBe("running");
      expect(
        fixture.uow.execute((tx) =>
          tx.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM domain_events WHERE type = 'agents.evaluation-ready.v1'",
          ),
        )?.count,
      ).toBe(0);
      release();
      await stopping;
      expect(destroyed).toBe(3);
      expect(
        fixture.uow.execute((tx) =>
          tx.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM agent_auxiliary_usage_observations",
          ),
        )?.count,
      ).toBe(3);
      expect(
        fixture.uow.execute((tx) =>
          tx.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM agent_capability_grants WHERE consumed_at IS NOT NULL",
          ),
        )?.count,
      ).toBe(3);
      expect(
        fixture.uow.execute((tx) =>
          tx.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM domain_events WHERE type = 'agents.evaluation-ready.v1'",
          ),
        )?.count,
      ).toBe(1);
    } finally {
      releaseFirst();
      release();
      await new Promise<void>((resolve) => setImmediate(resolve));
      await stopping;
    }
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
    } as unknown as DesktopHostClient;
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
  it("rejects a three-engine experiment before any write or model call when one engine is not ready", async () => {
    let engineOperations = 0;
    const host = {
      engineHealth: async (engine: string) => ({
        available: engine !== "langgraph",
        healthy: engine !== "langgraph",
        configured: engine !== "langgraph",
        authenticated: true,
      }),
      engineOperation: async () => {
        engineOperations += 1;
        throw new Error("preflight must not invoke an engine");
      },
    } as unknown as DesktopHostClient;
    const fixture = await installProviderRoutes(host);

    const response = await fixture.app.request(
      "http://runtime.test/api/v2/agent-experiments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-three-engine",
          taskType: "outline",
          prompt: "比较三个引擎的结果",
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("ENGINE_NOT_READY");
    expect(engineOperations).toBe(0);
    expect(
      fixture.uow.execute(
        (transaction) =>
          transaction.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM agent_evaluations",
          )?.count,
      ),
    ).toBe(0);
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

  it("keeps all three candidate engines, models and providers anonymous until review and reveal", async () => {
    const fixture = await installProviderRoutes();
    const evaluationId = "anonymous-three-engine";
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
      for (const [index, engine] of ["pi", "codex", "langgraph"].entries())
        transaction.run(
          `INSERT INTO agent_evaluation_candidates(
            id, evaluation_id, candidate, engine_kind, run_id, status,
            output_json, metrics_json
          ) VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?)`,
          `anonymous-candidate-${index}`,
          evaluationId,
          ["a", "b", "c"][index],
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
    expect(anonymous.candidates).toHaveLength(3);
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
        body: JSON.stringify({ preferredCandidate: "c", accepted: true }),
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
    ).toEqual(["pi", "codex", "langgraph"]);
    for (const candidate of revealed.candidates as Array<
      Record<string, unknown>
    >) {
      expect(candidate.metrics).not.toHaveProperty("inputTokens");
      expect(candidate.metrics).not.toHaveProperty("estimatedCost");
    }
  });

  it("persists each evaluation report including failed and unreported runs, and rejects API reads until explicit reveal", async () => {
    let modelCalls = 0;
    let destroyed = 0;
    const host = {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        configured: true,
        authenticated: true,
      }),
      engineOperation: async (_kind: string, operation: string) => {
        if (operation === "create") return { id: "private-vendor-session" };
        if (operation === "destroy") {
          destroyed++;
          return { ok: true };
        }
        throw new Error(`Unexpected operation ${operation}`);
      },
      async *engineStream(kind: string) {
        modelCalls++;
        if (kind !== "langgraph")
          yield {
            type: "usage",
            inputTokens: 0,
            outputTokens: 12,
            measurementScope: "response-increment",
            inputAccounting: "includes-cache",
            prompt: "PRIVATE",
            estimatedCost: 999,
            credential: "SECRET",
          };
        if (kind === "codex") {
          yield {
            type: "error",
            code: "CONTROLLED_FAILURE",
            message: "controlled failure after report",
          };
          return;
        }
        if (kind === "pi")
          yield {
            type: "usage",
            inputTokens: 100,
            outputTokens: 50,
            cachedTokens: 0,
            measurementScope: "session-total",
            inputAccounting: "unspecified",
          };
        yield {
          type: "result",
          result: { text: "controlled candidate, not model quality" },
        };
      },
    } as unknown as DesktopHostClient;
    const fixture = await installProviderRoutes(host);
    const evaluationId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const snapshotId = crypto.randomUUID();
    const at = new Date().toISOString();
    const runs = ["pi", "codex", "langgraph"].map((engine, index) => ({
      engine: engine as "pi" | "codex" | "langgraph",
      candidate: ["a", "b", "c"][index] as "a" | "b" | "c",
      runId: crypto.randomUUID(),
    }));
    fixture.uow.execute((tx) => {
      tx.run(
        `INSERT INTO agent_context_previews(id, project_id, input_json, entries_json, token_budget,
        estimated_tokens, destination_json, final_prompt, manifest_sha256, status, expires_at, created_at, updated_at)
        VALUES (?, ?, '{}', '[]', 1000, 1, '{}', 'controlled', ?, 'frozen', ?, ?, ?)`,
        snapshotId,
        projectId,
        "a".repeat(64),
        at,
        at,
        at,
      );
      tx.run(
        `INSERT INTO agent_context_snapshots(id, preview_id, project_id, entries_json, token_budget,
        estimated_tokens, destination_json, final_prompt, manifest_sha256, final_prompt_sha256, created_at)
        VALUES (?, ?, ?, '[]', 1000, 1, '{}', 'controlled', ?, ?, ?)`,
        snapshotId,
        snapshotId,
        projectId,
        "a".repeat(64),
        "b".repeat(64),
        at,
      );
      tx.run(
        `INSERT INTO agent_evaluations(id, project_id, task_type, prompt, context_snapshot_json,
        context_snapshot_id, status, created_at, updated_at) VALUES (?, ?, 'outline', 'controlled', '{}', ?, 'running', ?, ?)`,
        evaluationId,
        projectId,
        snapshotId,
        at,
        at,
      );
      for (const run of runs)
        tx.run(
          `INSERT INTO agent_evaluation_candidates(id, evaluation_id, candidate,
        engine_kind, run_id, status, metrics_json) VALUES (?, ?, ?, ?, ?, 'queued', '{}')`,
          crypto.randomUUID(),
          evaluationId,
          run.candidate,
          run.engine,
          run.runId,
        );
    });
    for (const run of runs)
      await runEvaluationCandidate(
        { uow: fixture.uow } as PluginContext,
        host,
        {
          ...run,
          evaluationId,
          projectId,
          prompt: "controlled only",
        },
      );
    expect(modelCalls).toBe(3);
    expect(destroyed).toBe(3);
    const beforeRead = fixture.eventCount();
    const report = (runId: string, suffix = "") =>
      fixture.app.request(
        `http://runtime.test/api/v2/agent-runs/${runId}/usage-observations?projectId=${projectId}${suffix}`,
      );
    for (const run of runs) {
      const blocked = await report(run.runId);
      expect(blocked.status).toBe(409);
      expect(blocked.headers.get("content-type")).toContain(
        "application/problem+json",
      );
      expect(JSON.stringify(await blocked.json())).not.toContain(run.engine);
    }
    const anonymous = (await (
      await fixture.app.request(
        `http://runtime.test/api/v2/agent-experiments/${evaluationId}`,
      )
    ).json()) as {
      candidates: Array<{
        usageRunId?: string;
        metrics: Record<string, unknown>;
      }>;
    };
    for (const candidate of anonymous.candidates) {
      expect(candidate).not.toHaveProperty("usageRunId");
      expect(candidate.metrics).not.toHaveProperty("inputTokens");
      expect(candidate.metrics).not.toHaveProperty("estimatedCost");
    }
    expect(
      (
        await fixture.app.request(
          `http://runtime.test/api/v2/agent-experiments/${evaluationId}/review`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ preferredCandidate: "a", accepted: true }),
          },
        )
      ).status,
    ).toBe(200);
    expect((await report(runs[0]!.runId)).status).toBe(409);
    const revealed = (await (
      await fixture.app.request(
        `http://runtime.test/api/v2/agent-experiments/${evaluationId}/reveal`,
        { method: "POST" },
      )
    ).json()) as {
      candidates: Array<{ usageRunId?: string; status: string }>;
    };
    expect(revealed.candidates.map((item) => item.usageRunId)).toEqual(
      runs.map((item) => item.runId),
    );
    expect(revealed.candidates[1]!.status).toBe("failed");
    const a = await (await report(runs[0]!.runId, "&limit=1")).json();
    expect(a).toMatchObject({
      observationCount: 2,
      nextCursor: 2,
      items: [{ cursor: 2, measurementScope: "session-total" }],
    });
    const original = await (await report(runs[0]!.runId, "&cursor=2")).json();
    expect(original).toMatchObject({
      items: [
        {
          inputTokens: { status: "reported", value: 0 },
          cachedTokens: { status: "unreported" },
        },
      ],
    });
    expect(await (await report(runs[1]!.runId)).json()).toMatchObject({
      observationCount: 1,
    });
    expect(await (await report(runs[2]!.runId)).json()).toMatchObject({
      observationCount: 0,
      items: [],
      coverage: "partial-or-unknown",
    });
    expect(JSON.stringify(original)).not.toMatch(
      /PRIVATE|SECRET|estimatedCost|credential/u,
    );
    expect(modelCalls).toBe(3);
    // Review/reveal are explicit writes; report reads are not additional model calls or usage facts.
    expect(fixture.eventCount()).toBeGreaterThanOrEqual(beforeRead);
    const afterReveal = fixture.eventCount();
    await report(runs[0]!.runId);
    expect(fixture.eventCount()).toBe(afterReveal);
    expect((await report(runs[0]!.runId, "&cursor=99")).status).toBe(400);
    expect(
      (
        await fixture.app.request(
          `http://runtime.test/api/v2/agent-runs/${runs[0]!.runId}/usage-observations`,
        )
      ).status,
    ).toBe(404);
    fixture.uow.execute((tx) =>
      tx.run(
        "UPDATE agent_auxiliary_usage_observations SET observation_json = '{}' WHERE run_id = ? AND engine_cursor = 2",
        runs[0]!.runId,
      ),
    );
    const corrupt = await report(runs[0]!.runId);
    expect(corrupt.status).toBe(503);
    expect(await corrupt.text()).not.toMatch(
      /PRIVATE|SECRET|observation_json/u,
    );
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
        if (operation === "create") return { id: "codex-thread-1" };
        throw new Error(`unexpected operation: ${operation}`);
      },
    } as unknown as DesktopHostClient;
    const fixture = await installProviderRoutes(host);
    const created = await fixture.app.request(
      "http://runtime.test/api/v2/agent-sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engineKind: "codex",
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
    expect(session).toMatchObject({ engineKind: "codex" });

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
    const unsupportedSteer = await fixture.app.request(
      `http://runtime.test/api/v2/agent-runs/${start.runId}/steer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "请简短一些" }),
      },
    );
    expect(unsupportedSteer.status).toBe(422);
    await expect(unsupportedSteer.json()).resolves.toMatchObject({
      code: "UNSUPPORTED_OPERATION",
    });
    expect(
      (
        await fixture.app.request(
          "http://runtime.test/api/v2/agents/engines/codex/run",
          { method: "POST" },
        )
      ).status,
    ).toBe(404);
  });

  it("serves the authenticated, tool-free MCP handshake required by local engines", async () => {
    const http = createRuntimeHttp({
      accessToken: "runtime-token",
      allowedOrigins: [],
      engineMcpTokens: ["engine-token"],
      events: {
        publishLive: () => undefined,
        subscribeLive: () => () => undefined,
        subscribeDomain: () => () => undefined,
        replay: () => [],
        registerConsumer: () => () => undefined,
        diagnostics: () => [],
        retryConsumer: () => false,
        dispose: () => undefined,
      },
      version: "3.0.0-alpha.3",
      runtimeInfo: () => ({
        runtimeId: "3a4d5f92-3ea6-4a34-8a83-52b360cf3b99",
        runtimeGeneration: 1,
        graphRevision: "a".repeat(64),
        startedAt: "2026-08-23T00:00:00.000Z",
        runtimeVersion: "3.0.0-alpha.3",
        apiVersion: "2",
        pluginApiVersion: "1",
        runtimeKind: "electron-node",
        mode: "desktop",
        profile: "studio",
        bundles: [],
        plugins: [],
        capabilities: {},
        capabilityDescriptors: {},
        engineStatus: {},
        uiContributions: [],
      }),
      onDiagnostics: () => ({}),
    });
    const request = (body: Record<string, unknown>) =>
      http.fetch(
        new Request("http://runtime.test/engine/v1/mcp", {
          method: "POST",
          headers: {
            Authorization: "Bearer engine-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );

    const initialized = await request({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(initialized.status).toBe(200);
    await expect(initialized.json()).resolves.toMatchObject({
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
      },
    });
    const noSseStream = await http.fetch(
      new Request("http://runtime.test/engine/v1/mcp", {
        headers: { Authorization: "Bearer engine-token" },
      }),
    );
    expect(noSseStream.status).toBe(405);
    const staticTools = await request({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(staticTools.status).toBe(200);
    await expect(staticTools.json()).resolves.toMatchObject({
      result: { tools: [] },
    });
    const rejected = await http.fetch(
      new Request("http://runtime.test/engine/v1/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      }),
    );
    expect(rejected.status).toBe(401);
  });

  it("exposes and invokes web tools only for the run-scoped capabilities", async () => {
    const calls: Array<{
      runId: string;
      name: string;
      arguments: Record<string, unknown>;
    }> = [];
    const http = createRuntimeHttp({
      accessToken: "runtime-token",
      allowedOrigins: [],
      engineMcpTokens: ["engine-token"],
      capabilityGrantResolve: (authorization) =>
        authorization === "Bearer scoped-token"
          ? {
              grantId: "grant-1",
              runId: "run-1",
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              capabilities: ["web.search", "web.read"],
            }
          : authorization === "Bearer search-only-token"
            ? {
                grantId: "grant-2",
                runId: "run-2",
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                capabilities: ["web.search"],
              }
            : undefined,
      engineMcpToolCall: async (input) => {
        calls.push(input);
        return input.name === "dramaip_web_search"
          ? {
              query: String(input.arguments.query),
              providers: ["exa"],
              fallbackUsed: false,
              results: [],
            }
          : {
              title: "Example",
              url: String(input.arguments.url),
              content: "verified page",
              contentType: "text/html",
              retrievedAt: new Date().toISOString(),
              truncated: false,
            };
      },
      events: {
        publishLive: () => undefined,
        subscribeLive: () => () => undefined,
        subscribeDomain: () => () => undefined,
        replay: () => [],
        registerConsumer: () => () => undefined,
        diagnostics: () => [],
        retryConsumer: () => false,
        dispose: () => undefined,
      },
      version: "3.0.0-alpha.3",
      runtimeInfo: () => ({
        runtimeId: "3a4d5f92-3ea6-4a34-8a83-52b360cf3b99",
        runtimeGeneration: 1,
        graphRevision: "a".repeat(64),
        startedAt: "2026-08-23T00:00:00.000Z",
        runtimeVersion: "3.0.0-alpha.3",
        apiVersion: "2",
        pluginApiVersion: "1",
        runtimeKind: "electron-node",
        mode: "desktop",
        profile: "studio",
        bundles: [],
        plugins: [],
        capabilities: {},
        capabilityDescriptors: {},
        engineStatus: {},
        uiContributions: [],
      }),
      onDiagnostics: () => ({}),
    });
    const request = (token: string, body: Record<string, unknown>) =>
      http.fetch(
        new Request("http://runtime.test/engine/v1/mcp", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );

    for (const token of [
      "expired-token",
      "consumed-token",
      "wrong-run-token",
    ]) {
      const rejected = await request(token, {
        jsonrpc: "2.0",
        id: `reject-${token}`,
        method: "tools/list",
      });
      expect(rejected.status).toBe(401);
    }

    const listed = await request("scoped-token", {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const listedBody = (await listed.json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(listedBody.result.tools.map((tool) => tool.name)).toEqual([
      "dramaip_web_search",
      "dramaip_read_web_page",
    ]);

    const searchOnly = await request("search-only-token", {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    await expect(searchOnly.json()).resolves.toMatchObject({
      result: { tools: [{ name: "dramaip_web_search" }] },
    });
    const forbiddenRead = await request("search-only-token", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "dramaip_read_web_page",
        arguments: { url: "https://example.com" },
      },
    });
    await expect(forbiddenRead.json()).resolves.toMatchObject({
      error: { code: -32602 },
    });

    const called = await request("scoped-token", {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "dramaip_web_search",
        arguments: { query: "DramaIP" },
      },
    });
    await expect(called.json()).resolves.toMatchObject({
      result: { structuredContent: { query: "DramaIP" } },
    });
    expect(calls).toEqual([
      expect.objectContaining({
        runId: "run-1",
        name: "dramaip_web_search",
        arguments: { query: "DramaIP" },
      }),
    ]);
    for (let index = 0; index < 3; index += 1)
      await request("scoped-token", {
        jsonrpc: "2.0",
        id: 10 + index,
        method: "tools/call",
        params: {
          name: "dramaip_web_search",
          arguments: { query: `DramaIP ${index}` },
        },
      });
    const quotaExceeded = await request("scoped-token", {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "dramaip_web_search",
        arguments: { query: "fifth search" },
      },
    });
    await expect(quotaExceeded.json()).resolves.toMatchObject({
      result: {
        isError: true,
        content: [{ text: expect.stringContaining("最多允许四次") }],
      },
    });
    expect(calls).toHaveLength(4);
  });

  it("restores the saved intelligent-assistant provider when Runtime starts", async () => {
    let receivedConfiguration: Record<string, unknown> | undefined;
    const host = {
      activateAgentProvider: async (configuration: Record<string, unknown>) => {
        receivedConfiguration = configuration;
        return { available: true };
      },
    } as unknown as DesktopHostClient;
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
    } as unknown as DesktopHostClient;
    const fixture = await installProviderRoutes(host);
    const initialEngines = await fixture.app.request(
      "http://runtime.test/api/v2/agent-engines",
    );
    expect(initialEngines.status).toBe(200);
    await expect(initialEngines.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pi", status: "unavailable" }),
        expect.objectContaining({ kind: "codex", status: "unavailable" }),
        expect.objectContaining({ kind: "langgraph", status: "unavailable" }),
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
        expect.objectContaining({ kind: "langgraph", status: "available" }),
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
    } as unknown as DesktopHostClient;
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
    } as unknown as DesktopHostClient;
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
        body: JSON.stringify({ surface: "global", engineKind: "pi" }),
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
      expect.objectContaining({ operation: "create" }),
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
          tool: "dramaip_web_search",
          itemId: "search-1",
          detail: {
            arguments: {
              query:
                "公开资料 Bearer secret-run-token /Users/alice/private/story.txt",
            },
          },
        };
        yield {
          type: "tool",
          status: "completed",
          tool: "dramaip_web_search",
          itemId: "search-1",
          detail: {
            result: {
              query: "公开资料",
              providers: ["exa"],
              fallbackUsed: false,
              results: [
                {
                  title: "公开来源",
                  url: "https://example.com/source",
                  excerpt: "可保存摘要",
                  provider: "exa",
                  retrievedAt: "2026-08-29T00:00:00.000Z",
                  content: "UNPERSISTED_SEARCH_BODY",
                },
              ],
              rawResponse: "UNPERSISTED_PROVIDER_RESPONSE",
            },
          },
        };
        yield {
          type: "tool",
          status: "started",
          tool: "dramaip_read_web_page",
          itemId: "read-1",
          detail: {
            arguments: { url: "https://example.com/source" },
          },
        };
        yield {
          type: "tool",
          status: "completed",
          tool: "dramaip_read_web_page",
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
        yield { type: "content.delta", delta: "我们先追问这个画面。" };
        yield {
          type: "result",
          result: { parts: [{ type: "text", text: "我们先追问这个画面。" }] },
        };
      },
    } as unknown as DesktopHostClient;
    const fixture = await installProviderRoutes(host);

    const forbidden = await fixture.app.request(
      "http://runtime.test/api/v2/assistant-conversations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface: "inspiration",
          projectId: crypto.randomUUID(),
          engineKind: "codex",
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
          engineKind: "codex",
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
    expect(JSON.parse(grant?.capabilities_json ?? "[]")).toEqual([
      "web.search",
      "web.read",
    ]);
    const persistedToolPayloads = fixture.uow.execute((transaction) =>
      transaction
        .all<{ payload_json: string }>(
          "SELECT payload_json FROM agent_assistant_items WHERE type IN ('tool_call', 'tool_result') ORDER BY sequence",
        )
        .map((item) => item.payload_json)
        .join("\n"),
    );
    expect(persistedToolPayloads).toContain("公开来源");
    expect(persistedToolPayloads).toContain("可保存摘要");
    expect(persistedToolPayloads).not.toMatch(
      /secret-run-token|\/Users\/alice|UNPERSISTED_SEARCH_BODY|UNPERSISTED_PROVIDER_RESPONSE|UNPERSISTED_WEB_BODY|UNPERSISTED_GRANT/u,
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

  it("persists and restores a Host-owned Codex compatible provider", async () => {
    let receivedLogin: Record<string, unknown> | undefined;
    const host = {
      engineHealth: async (engine: string) => ({
        available: true,
        healthy: true,
        authenticated: engine === "codex",
      }),
      codexAuthenticationStatus: async () => ({
        available: true,
        authenticated: true,
        mode: "custom_provider",
        provider: {
          id: "provider-deepseek",
          name: "DeepSeek",
          baseUrl: "https://api.deepseek.com/v1",
          model: "deepseek-v4-flash",
          protocol: "chat_completions",
        },
      }),
      loginCodex: async (input: Record<string, unknown>) => {
        receivedLogin = input;
        return { status: "authenticated" };
      },
      logoutCodex: async () => ({ available: true, authenticated: false }),
      engineOperation: async (engine: string, operation: string) => {
        if (engine === "codex" && operation === "create")
          return { id: "codex-thread-1" };
        throw new Error("unexpected engine operation");
      },
    } as unknown as DesktopHostClient;
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
            服务地址: "https://api.deepseek.com/v1",
            调用协议: "OpenAI 兼容文本",
            凭据引用: "credential-ref-only",
          },
        }),
      },
    );
    const provider = (await configured.json()) as { id: string };

    const status = await fixture.app.request(
      "http://runtime.test/api/v2/agent-engines/codex/auth",
    );
    await expect(status.json()).resolves.toMatchObject({
      authenticated: true,
      provider: { name: "DeepSeek" },
    });
    const login = await fixture.app.request(
      "http://runtime.test/api/v2/agent-engines/codex/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "custom_provider",
          providerId: provider.id,
          protocol: "chat_completions",
        }),
      },
    );
    expect(login.status).toBe(200);
    expect(receivedLogin).toMatchObject({
      mode: "custom_provider",
      credentialRef: "credential-ref-only",
      provider: {
        id: provider.id,
        protocol: "chat_completions",
      },
    });
    expect(receivedLogin).not.toHaveProperty("apiKey");

    expect(
      fixture.uow.execute((transaction) =>
        transaction.get<{
          provider_id: string;
          protocol: string;
        }>(
          `SELECT provider_id, protocol
           FROM agent_codex_custom_provider_settings
           WHERE singleton = 1`,
        ),
      ),
    ).toEqual({
      provider_id: provider.id,
      protocol: "chat_completions",
    });

    const restoredLogins: Record<string, unknown>[] = [];
    const restoredPlugin = createAgentsPlugin({
      loginCodex: async (input: Record<string, unknown>) => {
        restoredLogins.push(input);
        return { status: "authenticated" };
      },
    } as unknown as DesktopHostClient);
    nativeContexts.push(
      await mountTestPlugin(
        restoredPlugin,
        {
          http: { routeIds: [], register: () => () => undefined },
          uow: fixture.uow,
        },
        agentDependencies,
      ),
    );
    expect(restoredLogins).toEqual([
      expect.objectContaining({
        mode: "custom_provider",
        credentialRef: "credential-ref-only",
        provider: expect.objectContaining({
          id: provider.id,
          protocol: "chat_completions",
        }),
      }),
    ]);
    expect(restoredLogins[0]).not.toHaveProperty("apiKey");

    const created = await fixture.app.request(
      "http://runtime.test/api/v2/assistant-conversations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "global", engineKind: "codex" }),
      },
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      engineKind: "codex",
      engineSessionId: "codex-thread-1",
    });
  });

  it("requires Codex authentication before creating a session", async () => {
    const host = {
      engineHealth: async () => ({
        available: true,
        healthy: true,
        authenticated: false,
      }),
      engineOperation: async () => {
        throw new Error("must not create an unauthenticated Codex session");
      },
    } as unknown as DesktopHostClient;
    const fixture = await installProviderRoutes(host);

    const response = await fixture.app.request(
      "http://runtime.test/api/v2/assistant-conversations",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "global", engineKind: "codex" }),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONFLICT",
      title: "请先在设置中心完成 Codex 认证。",
    });
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
