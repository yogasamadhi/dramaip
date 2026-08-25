import { afterEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { applyMigrations, openDatabase } from "@dramaip/database";
import { foundationPlugin } from "@dramaip/foundation";
import { createAgentsPlugin } from "@dramaip/agents";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import { createRuntimeHttp } from "@dramaip/http";
import type {
  PluginContext,
  RouteContribution,
  UnitOfWork,
} from "@dramaip/plugin-api/internal";

interface InstalledProviderRoutes {
  app: OpenAPIHono;
  uow: UnitOfWork;
  liveEvents: Array<{ type: string; payload: unknown }>;
  close(): void;
  eventCount(): number;
}

const installed: InstalledProviderRoutes[] = [];

function installProviderRoutes(
  host?: DesktopHostClient,
): InstalledProviderRoutes {
  const database = openDatabase(":memory:");
  const plugin = createAgentsPlugin(host);
  applyMigrations(database.sqlite, [
    ...(foundationPlugin.migrations ?? []),
    ...(plugin.migrations ?? []),
  ]);
  const routes: RouteContribution[] = [];
  const liveEvents: Array<{ type: string; payload: unknown }> = [];
  plugin.activate({
    http: {
      register(route: RouteContribution) {
        routes.push(route);
        return () => undefined;
      },
    },
    uow: database.uow,
    events: {
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
    effect: ((_label, acquire) => void acquire()) as PluginContext["effect"],
  } as unknown as PluginContext);
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

afterEach(() => {
  while (installed.length > 0) installed.pop()!.close();
});

describe("agents provider configurations", () => {
  it("rejects a four-engine experiment before any write or model call when one engine is not ready", async () => {
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
    const fixture = installProviderRoutes(host);

    const response = await fixture.app.request(
      "http://runtime.test/api/v2/agent-experiments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "project-four-engine",
          taskType: "outline",
          prompt: "比较四个引擎的结果",
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

  it("upgrades historical three-engine evaluations and accepts candidate d with LangGraph.js", () => {
    const database = openDatabase(":memory:");
    const plugin = createAgentsPlugin();
    const migrations = plugin.migrations ?? [];
    const beforeLangGraph = migrations.filter(
      (migration) => migration.id !== "agents.0008.langgraph-four-engine",
    );
    applyMigrations(database.sqlite, [
      ...(foundationPlugin.migrations ?? []),
      ...beforeLangGraph,
    ]);
    const now = new Date().toISOString();
    database.uow.execute((transaction) => {
      transaction.run(
        `INSERT INTO agent_evaluations(
          id, project_id, task_type, prompt, context_snapshot_json, status,
          revealed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '{}', 'completed', ?, ?, ?)`,
        "historical-evaluation",
        "project-history",
        "outline",
        "历史三引擎实验",
        now,
        now,
        now,
      );
      transaction.run(
        `INSERT INTO agent_evaluation_candidates(
          id, evaluation_id, candidate, engine_kind, run_id, status,
          output_json, metrics_json
        ) VALUES (?, ?, 'a', 'pi', ?, 'succeeded', '{}', '{}')`,
        "historical-candidate-a",
        "historical-evaluation",
        "historical-run-a",
      );
      transaction.run(
        `INSERT INTO agent_evaluation_reviews(
          evaluation_id, preferred_candidate, accepted, notes, created_at
        ) VALUES (?, 'a', 1, NULL, ?)`,
        "historical-evaluation",
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
            "SELECT candidate, engine_kind FROM agent_evaluation_candidates WHERE id = ?",
          )
          .get("historical-candidate-a"),
      ).toEqual({ candidate: "a", engine_kind: "pi" });
      expect(
        database.sqlite
          .prepare(
            "SELECT preferred_candidate FROM agent_evaluation_reviews WHERE evaluation_id = ?",
          )
          .get("historical-evaluation"),
      ).toEqual({ preferred_candidate: "a" });

      database.uow.execute((transaction) => {
        transaction.run(
          `INSERT INTO agent_evaluation_candidates(
            id, evaluation_id, candidate, engine_kind, run_id, status,
            output_json, metrics_json
          ) VALUES (?, ?, 'd', 'langgraph', ?, 'succeeded', '{}', '{}')`,
          "langgraph-candidate-d",
          "historical-evaluation",
          "langgraph-run-d",
        );
        transaction.run(
          `UPDATE agent_evaluation_reviews
           SET preferred_candidate = 'd' WHERE evaluation_id = ?`,
          "historical-evaluation",
        );
      });
      expect(
        database.sqlite
          .prepare(
            "SELECT candidate, engine_kind FROM agent_evaluation_candidates WHERE id = ?",
          )
          .get("langgraph-candidate-d"),
      ).toEqual({ candidate: "d", engine_kind: "langgraph" });
      expect(
        database.sqlite
          .prepare(
            "SELECT preferred_candidate FROM agent_evaluation_reviews WHERE evaluation_id = ?",
          )
          .get("historical-evaluation"),
      ).toEqual({ preferred_candidate: "d" });
    } finally {
      database.close();
    }
  });

  it("keeps all four candidate engines, models and providers anonymous until review and reveal", async () => {
    const fixture = installProviderRoutes();
    const evaluationId = "anonymous-four-engine";
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
      for (const [index, engine] of [
        "pi",
        "codex",
        "grok",
        "langgraph",
      ].entries())
        transaction.run(
          `INSERT INTO agent_evaluation_candidates(
            id, evaluation_id, candidate, engine_kind, run_id, status,
            output_json, metrics_json
          ) VALUES (?, ?, ?, ?, ?, 'succeeded', ?, ?)`,
          `anonymous-candidate-${index}`,
          evaluationId,
          ["a", "b", "c", "d"][index],
          engine,
          `anonymous-run-${index}`,
          JSON.stringify({ text: `候选 ${index + 1}` }),
          JSON.stringify({
            engine,
            engineVersion: "hidden-version",
            model: "hidden-model",
            provider: "hidden-provider",
            latencyMs: index + 1,
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
    expect(anonymous.candidates).toHaveLength(4);
    for (const candidate of anonymous.candidates as Array<
      Record<string, unknown>
    >) {
      expect(candidate).not.toHaveProperty("engineKind");
      expect(candidate.metrics).not.toHaveProperty("engine");
      expect(candidate.metrics).not.toHaveProperty("engineVersion");
      expect(candidate.metrics).not.toHaveProperty("model");
      expect(candidate.metrics).not.toHaveProperty("provider");
    }

    const review = await fixture.app.request(
      `http://runtime.test/api/v2/agent-experiments/${evaluationId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredCandidate: "d", accepted: true }),
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
    ).toEqual(["pi", "codex", "grok", "langgraph"]);
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
    const fixture = installProviderRoutes(host);
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
    expect(
      (
        await request({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        })
      ).status,
    ).toBe(200);
    const rejected = await http.fetch(
      new Request("http://runtime.test/engine/v1/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      }),
    );
    expect(rejected.status).toBe(401);
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
      await plugin.activate({
        http: { register: () => () => undefined },
        uow: database.uow,
        effect: ((_label, acquire) =>
          void acquire()) as PluginContext["effect"],
      } as unknown as PluginContext);
      expect(receivedConfiguration).toMatchObject({
        providerId: "saved-provider",
        model: "deepseek-v4-flash",
        credentialRef: "credential-ref-only",
      });
      expect(receivedConfiguration).not.toHaveProperty("secret");
    } finally {
      database.close();
    }
  });

  it("persists only an opaque credential reference and honors optimistic locking", async () => {
    const fixture = installProviderRoutes();
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
    const fixture = installProviderRoutes(host);
    const initialEngines = await fixture.app.request(
      "http://runtime.test/api/v2/agent-engines",
    );
    expect(initialEngines.status).toBe(200);
    await expect(initialEngines.json()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "pi", status: "unavailable" }),
        expect.objectContaining({ kind: "codex", status: "unavailable" }),
        expect.objectContaining({ kind: "pi", status: "unavailable" }),
        expect.objectContaining({ kind: "pi", status: "unavailable" }),
        expect.objectContaining({ kind: "grok", status: "unavailable" }),
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
        expect.objectContaining({ kind: "pi", status: "available" }),
        expect.objectContaining({ kind: "grok", status: "available" }),
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
    });
    expect(fixture.eventCount()).toBe(3);
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
          type: "result",
          result: { parts: [{ type: "text", text: "你好，DramaIP 已收到。" }] },
        };
      },
    } as unknown as DesktopHostClient;
    const fixture = installProviderRoutes(host);
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
    await expect(sent.json()).resolves.toMatchObject({
      conversation: { id: conversation.id, status: "running" },
      turn: { userMessage: "hello", status: "running" },
      run: { engineKind: "pi", status: "preparing" },
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
    const fixture = installProviderRoutes(host);
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
    await restoredPlugin.activate({
      http: { register: () => () => undefined },
      uow: fixture.uow,
      effect: ((_label, acquire) => void acquire()) as PluginContext["effect"],
    } as unknown as PluginContext);
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
    const fixture = installProviderRoutes(host);

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
