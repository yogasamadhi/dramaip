import { randomUUID } from "node:crypto";

import type { Context, Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import {
  problemDetailsSchema,
  taskRefSchema,
  type EngineEvent,
  type TaskState,
} from "@dramaip/contracts";
import { ApiProblem, idempotentResponse, requireIfMatch } from "@dramaip/http";
import type {
  MigrationDefinition,
  PendingDomainEvent,
  RouteContribution,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api";

import {
  agentItemSchema,
  agentCheckpointSchema,
  agentRunSchema,
  agentSessionSchema,
  createAgentSessionSchema,
  createRunSchema,
  forkAgentSessionSchema,
  mcpClaimSchema,
  providerConfigurationInputSchema,
  providerConfigurationSchema,
  providerPageSchema,
} from "./contracts.ts";
import {
  AgentEngineRegistryService,
  type EngineControlBridge,
  type EngineKind,
  type EngineTokenMap,
} from "./engine-registry.ts";
import { completeAssistantRun, installAssistantRoutes } from "./assistant.ts";

export const migrations: readonly MigrationDefinition[] = [
  {
    id: "agents-0001",
    pluginId: "agents",
    version: "1.0.0",
    dependsOn: ["workspace-0001"],
    sql: `
      CREATE TABLE agents_provider_settings (
        kind TEXT PRIMARY KEY CHECK (kind IN ('opencode', 'codex', 'dsh', 'hermes', 'langgraph')),
        credential_ref TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agents_sessions (
        id TEXT PRIMARY KEY,
        engine_session_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        engine_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'disposed')),
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agents_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agents_sessions(id) ON DELETE CASCADE,
        engine_run_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'interrupted')),
        prompt TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_micros INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX agents_runs_session_idx ON agents_runs (session_id, created_at);
      CREATE TABLE agents_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agents_runs(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (run_id, sequence)
      );
      CREATE TABLE agents_checkpoints (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES agents_runs(id) ON DELETE CASCADE,
        engine_checkpoint_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE agents_mcp_claims (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES agents_sessions(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES agents_runs(id) ON DELETE CASCADE,
        read_only INTEGER NOT NULL CHECK (read_only = 1),
        max_results INTEGER NOT NULL CHECK (max_results BETWEEN 1 AND 200),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE agents_assistants (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        instructions TEXT NOT NULL,
        engine_kind TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agents_experiments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        config_json TEXT NOT NULL,
        result_json TEXT,
        state TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents-0002",
    pluginId: "agents",
    version: "2.0.0",
    dependsOn: [
      "agents-0001",
      "automation-0002",
      "writing-0002",
      "knowledge-0002",
    ],
    sql: `
      CREATE TABLE assistant_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES workspace_projects(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES agents_sessions(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        engine_kind TEXT NOT NULL CHECK (engine_kind IN ('opencode', 'codex', 'dsh', 'hermes', 'langgraph')),
        model TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX assistant_conversations_project_idx
        ON assistant_conversations (project_id, status, updated_at);
      CREATE TABLE assistant_turns (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES agents_runs(id) ON DELETE SET NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        task_type TEXT,
        context_snapshot_id TEXT,
        change_preview_id TEXT REFERENCES automation_change_previews(id) ON DELETE SET NULL,
        intent_confidence REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX assistant_turns_conversation_idx
        ON assistant_turns (conversation_id, created_at);
      CREATE TABLE agent_context_snapshots (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES agents_runs(id) ON DELETE SET NULL,
        project_id TEXT REFERENCES workspace_projects(id) ON DELETE SET NULL,
        request_json TEXT NOT NULL,
        total_tokens INTEGER NOT NULL,
        truncated_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE agent_context_fragments (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL REFERENCES agent_context_snapshots(id) ON DELETE CASCADE,
        fragment_id TEXT NOT NULL,
        plugin_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version INTEGER NOT NULL,
        priority INTEGER NOT NULL,
        token_estimate INTEGER NOT NULL,
        provenance TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        UNIQUE (snapshot_id, fragment_id)
      );
      CREATE TABLE agent_task_settings (
        scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'project')),
        scope_id TEXT NOT NULL,
        engine_kind TEXT NOT NULL CHECK (engine_kind IN ('opencode', 'codex', 'dsh', 'hermes', 'langgraph')),
        model TEXT,
        advanced_mode INTEGER NOT NULL CHECK (advanced_mode IN (0, 1)),
        version INTEGER NOT NULL CHECK (version > 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id)
      );
      CREATE TABLE agent_experiments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        chapter_id TEXT REFERENCES writing_chapters(id) ON DELETE SET NULL,
        prompt TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'ready', 'reviewed', 'failed')),
        selected_candidate_id TEXT,
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_experiment_candidates (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES agent_experiments(id) ON DELETE CASCADE,
        engine_kind TEXT NOT NULL CHECK (engine_kind IN ('opencode', 'codex', 'dsh', 'hermes', 'langgraph')),
        ordinal INTEGER NOT NULL,
        session_id TEXT REFERENCES agents_sessions(id) ON DELETE SET NULL,
        run_id TEXT REFERENCES agents_runs(id) ON DELETE SET NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'interrupted')),
        output TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (experiment_id, ordinal),
        UNIQUE (experiment_id, engine_kind)
      );
      CREATE TABLE agent_experiment_reviews (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL UNIQUE REFERENCES agent_experiments(id) ON DELETE CASCADE,
        selected_candidate_id TEXT NOT NULL REFERENCES agent_experiment_candidates(id) ON DELETE RESTRICT,
        scores_json TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents-0003",
    pluginId: "agents",
    version: "3.0.0",
    dependsOn: ["agents-0002"],
    foreignKeysOff: true,
    sql: `
      CREATE TABLE agents_provider_settings_next (
        kind TEXT PRIMARY KEY CHECK (kind IN ('opencode', 'codex', 'dsh', 'pi', 'langgraph')),
        credential_ref TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agents_provider_settings_next
      SELECT CASE kind WHEN 'hermes' THEN 'pi' ELSE kind END,
             credential_ref, config_json, enabled, version, updated_at
        FROM agents_provider_settings;
      DROP TABLE agents_provider_settings;
      ALTER TABLE agents_provider_settings_next RENAME TO agents_provider_settings;

      CREATE TABLE assistant_conversations_next (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES workspace_projects(id) ON DELETE SET NULL,
        session_id TEXT REFERENCES agents_sessions(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        engine_kind TEXT NOT NULL CHECK (engine_kind IN ('opencode', 'codex', 'dsh', 'pi', 'langgraph')),
        model TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO assistant_conversations_next
      SELECT id, project_id, session_id,
             title, CASE engine_kind WHEN 'hermes' THEN 'pi' ELSE engine_kind END,
             model, status, version, created_at, updated_at
        FROM assistant_conversations;
      DROP TABLE assistant_conversations;
      ALTER TABLE assistant_conversations_next RENAME TO assistant_conversations;
      CREATE INDEX assistant_conversations_project_idx
        ON assistant_conversations (project_id, status, updated_at);

      CREATE TABLE agent_task_settings_next (
        scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'project')),
        scope_id TEXT NOT NULL,
        engine_kind TEXT NOT NULL CHECK (engine_kind IN ('opencode', 'codex', 'dsh', 'pi', 'langgraph')),
        model TEXT,
        advanced_mode INTEGER NOT NULL CHECK (advanced_mode IN (0, 1)),
        version INTEGER NOT NULL CHECK (version > 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id)
      );
      INSERT INTO agent_task_settings_next
      SELECT scope_type, scope_id,
             CASE engine_kind WHEN 'hermes' THEN 'pi' ELSE engine_kind END,
             model, advanced_mode, version, updated_at
        FROM agent_task_settings;
      DROP TABLE agent_task_settings;
      ALTER TABLE agent_task_settings_next RENAME TO agent_task_settings;

      CREATE TABLE agent_experiment_candidates_next (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES agent_experiments(id) ON DELETE CASCADE,
        engine_kind TEXT NOT NULL CHECK (engine_kind IN ('opencode', 'codex', 'dsh', 'pi', 'langgraph')),
        ordinal INTEGER NOT NULL,
        session_id TEXT REFERENCES agents_sessions(id) ON DELETE SET NULL,
        run_id TEXT REFERENCES agents_runs(id) ON DELETE SET NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'interrupted')),
        output TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (experiment_id, ordinal),
        UNIQUE (experiment_id, engine_kind)
      );
      INSERT INTO agent_experiment_candidates_next
      SELECT id, experiment_id,
             CASE engine_kind WHEN 'hermes' THEN 'pi' ELSE engine_kind END,
             ordinal, session_id, run_id, state, output, created_at
        FROM agent_experiment_candidates;
      DROP TABLE agent_experiment_candidates;
      ALTER TABLE agent_experiment_candidates_next RENAME TO agent_experiment_candidates;

      UPDATE agents_sessions
         SET engine_kind = 'pi' WHERE engine_kind = 'hermes';
      UPDATE agents_assistants
         SET engine_kind = 'pi' WHERE engine_kind = 'hermes';
      UPDATE agents_experiments
         SET config_json = replace(config_json, '"hermes"', '"pi"')
       WHERE config_json LIKE '%"hermes"%';
    `,
  },
] as const;

interface SessionRow {
  id: string;
  engine_session_id: string;
  project_id: string;
  engine_kind: EngineKind;
  title: string;
  state: "active" | "disposed";
  version: number;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  session_id: string;
  engine_run_id: string;
  state: TaskState;
  prompt: string;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  error_code: string | null;
  error_message: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

const sessionJson = (row: SessionRow) => ({
  id: row.id,
  engineSessionId: row.engine_session_id,
  projectId: row.project_id,
  engineKind: row.engine_kind,
  title: row.title,
  state: row.state,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const runJson = (row: RunRow) => ({
  id: row.id,
  sessionId: row.session_id,
  engineRunId: row.engine_run_id,
  state: row.state,
  prompt: row.prompt,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  costMicros: row.cost_micros,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const response = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const errors = {
  400: response(problemDetailsSchema, "Invalid request"),
  401: response(problemDetailsSchema, "Authentication required"),
  403: response(problemDetailsSchema, "Forbidden"),
  404: response(problemDetailsSchema, "Not found"),
  409: response(problemDetailsSchema, "Conflict"),
  412: response(problemDetailsSchema, "Version conflict"),
  428: response(problemDetailsSchema, "If-Match required"),
  500: response(problemDetailsSchema, "Internal error"),
  503: response(problemDetailsSchema, "Service unavailable"),
} as const;

const mcpRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const mcpResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number().int(), message: z.string() }).optional(),
});

interface ProviderSettingRow {
  kind: EngineKind;
  credential_ref: string | null;
  config_json: string;
  enabled: number;
  version: number;
  updated_at: string;
}

interface CheckpointRow {
  id: string;
  run_id: string;
  engine_checkpoint_id: string;
  payload_json: string;
  created_at: string;
}

const checkpointJson = (row: CheckpointRow) => ({
  id: row.id,
  runId: row.run_id,
  engineCheckpointId: row.engine_checkpoint_id,
  payload: JSON.parse(row.payload_json),
  createdAt: row.created_at,
});

function transitionRun(
  ctx: Parameters<NonNullable<Plugin.Function>>[0],
  id: string,
  from: readonly TaskState[],
  to: TaskState,
  updateSql = "",
  parameters: readonly unknown[] = [],
  event?: (updated: RunRow) => PendingDomainEvent,
  withinTransaction?: (tx: UnitOfWorkTransaction, updated: RunRow) => void,
): RunRow {
  return ctx.uow.execute((tx) => {
    const current = tx.get<RunRow>(
      "SELECT * FROM agents_runs WHERE id = ?",
      id,
    );
    if (!current)
      throw new ApiProblem(
        404,
        "AGENT_RUN_NOT_FOUND",
        "agent run does not exist",
      );
    if (!from.includes(current.state))
      throw new ApiProblem(
        409,
        "ILLEGAL_TASK_TRANSITION",
        `agent run cannot transition from ${current.state} to ${to}`,
      );
    tx.run(
      `UPDATE agents_runs
          SET state = ?, version = version + 1, updated_at = ?${updateSql}
        WHERE id = ? AND state = ?`,
      to,
      new Date().toISOString(),
      ...parameters,
      id,
      current.state,
    );
    const updated = tx.get<RunRow>(
      "SELECT * FROM agents_runs WHERE id = ?",
      id,
    )!;
    if (updated.state !== to)
      throw new ApiProblem(
        409,
        "TASK_TRANSITION_RACE",
        "agent run changed concurrently",
      );
    if (event) tx.append(event(updated));
    withinTransaction?.(tx, updated);
    return updated;
  });
}

interface ProviderConfiguration {
  providerKind: "openai" | "anthropic" | "google";
  providerAdapter: "openai" | "openai-compatible" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
}

function settingJson(row: ProviderSettingRow) {
  const config = JSON.parse(row.config_json) as ProviderConfiguration;
  return {
    kind: row.kind,
    providerKind: config.providerKind,
    providerAdapter: config.providerAdapter,
    model: config.model,
    baseUrl: config.baseUrl ?? null,
    configured: Boolean(row.credential_ref && row.enabled),
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function getSession(
  ctx: Parameters<NonNullable<Plugin.Function>>[0],
  id: string,
): SessionRow {
  const row = ctx.uow.execute((tx) =>
    tx.get<SessionRow>("SELECT * FROM agents_sessions WHERE id = ?", id),
  );
  if (!row)
    throw new ApiProblem(
      404,
      "AGENT_SESSION_NOT_FOUND",
      "agent session does not exist",
    );
  return row;
}

function getRun(
  ctx: Parameters<NonNullable<Plugin.Function>>[0],
  id: string,
): RunRow {
  const row = ctx.uow.execute((tx) =>
    tx.get<RunRow>("SELECT * FROM agents_runs WHERE id = ?", id),
  );
  if (!row)
    throw new ApiProblem(
      404,
      "AGENT_RUN_NOT_FOUND",
      "agent run does not exist",
    );
  return row;
}

export interface EngineConsumptionHooks {
  onCompleted?: (output: string, run: RunRow) => void | Promise<void>;
  onFailed?: (error: unknown, run: RunRow) => void | Promise<void>;
}

const privateKeys = new Set([
  "reasoning",
  "thinking",
  "analysis",
  "internal",
  "rawLog",
  "stderr",
  "credential",
  "credentialRef",
]);

export function sanitizePublicOutput(value: unknown): unknown {
  if (typeof value === "string")
    return value
      .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[已隐藏凭据]")
      .replace(
        /(?:\/Users|\/Volumes|\/home|\/root|\/tmp)\/[^\s"'`]+/gu,
        "[本机路径]",
      )
      .replace(/[A-Za-z]:\\[^\s"'`]+/gu, "[本机路径]");
  if (Array.isArray(value)) return value.map(sanitizePublicOutput);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !privateKeys.has(key))
      .map(([key, item]) => [key, sanitizePublicOutput(item)]),
  );
}

export function extractPublicText(value: unknown): string {
  const sanitized = sanitizePublicOutput(value);
  if (typeof sanitized === "string") return sanitized;
  if (Array.isArray(sanitized))
    return sanitized.map(extractPublicText).filter(Boolean).join("\n");
  if (!sanitized || typeof sanitized !== "object") return "";
  const record = sanitized as Record<string, unknown>;
  for (const key of ["text", "content", "message", "output", "result"]) {
    const candidate = extractPublicText(record[key]);
    if (candidate) return candidate;
  }
  return "";
}

export async function consumeEngineEvents(
  ctx: Parameters<NonNullable<Plugin.Function>>[0],
  run: RunRow,
  events: AsyncIterable<EngineEvent>,
  hooks: EngineConsumptionHooks = {},
): Promise<void> {
  const deltaParts: string[] = [];
  const completedParts: string[] = [];
  let sequence = ctx.uow.execute(
    (tx) =>
      tx.get<{ sequence: number }>(
        "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM agents_items WHERE run_id = ?",
        run.id,
      )?.sequence ?? 0,
  );
  try {
    transitionRun(ctx, run.id, ["queued"], "running", "", [], (updated) => ({
      type: "agents.run-started.v1",
      pluginId: "agents",
      aggregateType: "agent-run",
      aggregateId: updated.id,
      aggregateVersion: updated.version,
      payload: { id: updated.id, state: updated.state },
    }));
  } catch (error) {
    if (error instanceof ApiProblem && error.code === "ILLEGAL_TASK_TRANSITION")
      return;
    throw error;
  }
  try {
    for await (const event of events) {
      if (event.type === "token.delta") {
        if (getRun(ctx, run.id).state !== "running") continue;
        const delta = sanitizePublicOutput(event.delta) as string;
        deltaParts.push(delta);
        ctx.eventRuntime.publishLive({
          type: "agents.token-delta",
          payload: { runId: run.id, delta },
        });
        continue;
      }
      if (getRun(ctx, run.id).state !== "running") continue;
      if (event.type === "item.completed") {
        const publicItem = sanitizePublicOutput(event.item);
        const publicText = extractPublicText(publicItem);
        if (publicText) completedParts.push(publicText);
        const itemId = randomUUID();
        const createdAt = new Date().toISOString();
        ctx.uow.execute((tx) => {
          const current = tx.get<{ state: TaskState }>(
            "SELECT state FROM agents_runs WHERE id = ?",
            run.id,
          );
          if (current?.state !== "running") return;
          tx.run(
            "INSERT INTO agents_items (id, run_id, sequence, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            itemId,
            run.id,
            sequence++,
            event.type,
            JSON.stringify(publicItem),
            createdAt,
          );
          tx.append({
            type: "agents.item-completed.v1",
            pluginId: "agents",
            aggregateType: "agent-item",
            aggregateId: itemId,
            aggregateVersion: 1,
            payload: { runId: run.id, item: publicItem },
          });
        });
      }
      if (event.type === "run.completed") {
        const current = getRun(ctx, run.id);
        if (current.state !== "running") continue;
        const completed = transitionRun(
          ctx,
          run.id,
          ["running"],
          "succeeded",
          ", input_tokens = ?, output_tokens = ?, error_code = NULL, error_message = NULL",
          [event.usage?.input ?? 0, event.usage?.output ?? 0],
          (updated) => ({
            type: "agents.run-completed.v1",
            pluginId: "agents",
            aggregateType: "agent-run",
            aggregateId: run.id,
            aggregateVersion: updated.version,
            payload: {
              id: run.id,
              state: "succeeded",
              usage: event.usage ?? null,
            },
          }),
        );
        const authoritative = completedParts.length
          ? completedParts
          : [deltaParts.join("")];
        const output = [
          ...new Set(authoritative.map((item) => item.trim()).filter(Boolean)),
        ].join("\n");
        await hooks.onCompleted?.(output, completed);
      }
      if (event.type === "run.failed")
        throw new ApiProblem(500, event.code, event.message);
    }
  } catch (error) {
    const current = getRun(ctx, run.id);
    if (current.state === "running")
      transitionRun(
        ctx,
        run.id,
        ["running"],
        "failed",
        ", error_code = ?, error_message = ?",
        [
          error instanceof ApiProblem ? error.code : "ENGINE_RUN_FAILED",
          error instanceof Error ? error.message : String(error),
        ],
        (updated) => ({
          type: "agents.run-failed.v1",
          pluginId: "agents",
          aggregateType: "agent-run",
          aggregateId: updated.id,
          aggregateVersion: updated.version,
          payload: {
            id: updated.id,
            state: updated.state,
            errorCode: updated.error_code,
          },
        }),
      );
    await hooks.onFailed?.(error, getRun(ctx, run.id));
  }
}

export async function restoreEngineConfigurations(
  ctx: Context,
  bridge: EngineControlBridge,
): Promise<void> {
  const settings = ctx.uow.execute((tx) =>
    tx.all<ProviderSettingRow>(
      "SELECT * FROM agents_provider_settings WHERE enabled = 1 AND credential_ref IS NOT NULL ORDER BY kind",
    ),
  );
  const results = await Promise.allSettled(
    settings.map((setting) => {
      const config = JSON.parse(setting.config_json) as ProviderConfiguration;
      return bridge.call(setting.kind, "configure", {
        ...config,
        credentialRef: setting.credential_ref,
      });
    }),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected")
      console.warn(
        `could not restore ${settings[index]?.kind ?? "engine"} configuration: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
  });
}

export function createAgentsServer(
  bridge: EngineControlBridge,
  engineTokens: EngineTokenMap,
): Plugin {
  const activeClaims = new Map<EngineKind, string>();
  return {
    name: "dramaip-agents",
    inject: ["eventRuntime", "http", "uow", "automationRuntime"],
    provide: "engineRegistry",
    apply(ctx) {
      new AgentEngineRegistryService(ctx);
      ctx.uow.execute((tx) => {
        const stale = tx.all<RunRow>(
          "SELECT * FROM agents_runs WHERE state IN ('queued', 'running')",
        );
        for (const run of stale) {
          tx.run(
            "UPDATE agents_runs SET state = 'interrupted', version = version + 1, updated_at = ? WHERE id = ? AND state IN ('queued', 'running')",
            new Date().toISOString(),
            run.id,
          );
          tx.append({
            type: "agents.run-interrupted-on-restart.v1",
            pluginId: "agents",
            aggregateType: "agent-run",
            aggregateId: run.id,
            aggregateVersion: run.version + 1,
            payload: { id: run.id, previousState: run.state },
          });
        }
      });
      const routes: RouteContribution = {
        id: "agents.http.v2",
        pluginId: "agents",
        install(app) {
          installAssistantRoutes(app, ctx, activeClaims, (run, events, hooks) =>
            consumeEngineEvents(ctx, run, events, hooks),
          );
          const mcpRoute = createRoute({
            method: "post",
            path: "/api/v2/agents/mcp",
            request: {
              body: {
                content: { "application/json": { schema: mcpRequestSchema } },
              },
            },
            responses: {
              200: response(mcpResponseSchema, "MCP JSON-RPC response"),
              ...errors,
            },
          });
          app.openapi(mcpRoute, (context) => {
            const authorization = context.req.header("authorization") ?? "";
            const token = authorization.startsWith("Bearer ")
              ? authorization.slice(7)
              : "";
            const kind = (
              Object.entries(engineTokens) as Array<[EngineKind, string]>
            ).find(([, candidate]) => candidate === token)?.[0];
            if (!kind)
              throw new ApiProblem(
                401,
                "MCP_AUTH_REQUIRED",
                "valid engine bearer token is required",
              );
            const rpc = context.req.valid("json");
            const id = rpc.id ?? null;
            const result = (value: unknown) =>
              context.json({ jsonrpc: "2.0" as const, id, result: value }, 200);
            const failure = (code: number, message: string) =>
              context.json(
                {
                  jsonrpc: "2.0" as const,
                  id,
                  error: { code, message },
                },
                200,
              );
            if (rpc.method === "initialize")
              return result({
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "dramaip-readonly", version: "2.0.0" },
              });
            if (rpc.method === "notifications/initialized") return result({});
            if (rpc.method === "tools/list")
              return result({
                tools: [
                  {
                    name: "dramaip.search",
                    description: "搜索当前项目内已索引的创作资源",
                    inputSchema: {
                      type: "object",
                      properties: {
                        query: { type: "string" },
                        limit: { type: "integer", minimum: 1, maximum: 200 },
                      },
                      required: ["query"],
                    },
                  },
                  {
                    name: "dramaip.project",
                    description: "读取当前获准项目的基本信息",
                    inputSchema: { type: "object", properties: {} },
                  },
                ],
              });
            if (rpc.method !== "tools/call")
              return failure(-32601, "method not found");
            const claimId = activeClaims.get(kind);
            if (!claimId) return failure(-32001, "no active run claim");
            const claim = ctx.uow.execute((tx) =>
              tx.get<{
                id: string;
                project_id: string;
                session_id: string;
                run_id: string | null;
                read_only: number;
                max_results: number;
                expires_at: string;
              }>("SELECT * FROM agents_mcp_claims WHERE id = ?", claimId),
            );
            if (
              !claim ||
              claim.read_only !== 1 ||
              Date.parse(claim.expires_at) <= Date.now()
            ) {
              activeClaims.delete(kind);
              return failure(-32002, "run claim expired or invalid");
            }
            const params = rpc.params ?? {};
            const toolName = String(params.name ?? "");
            const args =
              params.arguments && typeof params.arguments === "object"
                ? (params.arguments as Record<string, unknown>)
                : {};
            if (toolName === "dramaip.project") {
              const project = ctx.uow.execute((tx) =>
                tx.get<Record<string, unknown>>(
                  `SELECT id, name, description, version, created_at, updated_at
                     FROM workspace_projects WHERE id = ?`,
                  claim.project_id,
                ),
              );
              return result({
                content: [
                  { type: "text", text: JSON.stringify(project ?? null) },
                ],
              });
            }
            if (toolName === "dramaip.search") {
              const query = String(args.query ?? "").trim();
              if (!query) return failure(-32602, "query is required");
              const requestedLimit = Number(args.limit ?? claim.max_results);
              const limit = Math.max(
                1,
                Math.min(
                  claim.max_results,
                  Number.isInteger(requestedLimit) ? requestedLimit : 50,
                ),
              );
              const items = ctx.uow.execute((tx) =>
                tx.all<Record<string, unknown>>(
                  `SELECT plugin_id, aggregate_type, aggregate_id, title, updated_at
                     FROM system_search_index
                    WHERE (aggregate_id = ? OR searchable_text LIKE ?)
                      AND (title LIKE ? OR searchable_text LIKE ?)
                    ORDER BY updated_at DESC, aggregate_id ASC
                    LIMIT ?`,
                  claim.project_id,
                  `%${claim.project_id}%`,
                  `%${query}%`,
                  `%${query}%`,
                  limit,
                ),
              );
              return result({
                content: [{ type: "text", text: JSON.stringify(items) }],
              });
            }
            return failure(-32602, "unknown or non-read-only tool");
          });

          const providers = createRoute({
            method: "get",
            path: "/api/v2/agents/providers",
            responses: {
              200: response(providerPageSchema, "Engine providers"),
              ...errors,
            },
          });
          app.openapi(providers, async (context) => {
            const configured = new Set(
              ctx.uow.execute((tx) =>
                tx
                  .all<{
                    kind: EngineKind;
                  }>(
                    "SELECT kind FROM agents_provider_settings WHERE enabled = 1 AND credential_ref IS NOT NULL",
                  )
                  .map((row) => row.kind),
              ),
            );
            const items = await Promise.all(
              ctx.engineRegistry.list().map(async (provider) => {
                const [health, capabilities] = await Promise.all([
                  provider.health(),
                  provider.capabilities(),
                ]);
                return {
                  kind: provider.kind,
                  version: health.version,
                  status: health.status,
                  capabilities,
                  configured: configured.has(provider.kind),
                };
              }),
            );
            return context.json({ items });
          });

          const getProviderConfiguration = createRoute({
            method: "get",
            path: "/api/v2/agents/providers/{kind}/configuration",
            request: {
              params: z.object({
                kind: z.enum(["opencode", "codex", "dsh", "pi", "langgraph"]),
              }),
            },
            responses: {
              200: response(
                providerConfigurationSchema,
                "Provider configuration",
              ),
              ...errors,
            },
          });
          app.openapi(getProviderConfiguration, (context) => {
            const { kind } = context.req.valid("param");
            const row = ctx.uow.execute((tx) =>
              tx.get<ProviderSettingRow>(
                "SELECT * FROM agents_provider_settings WHERE kind = ?",
                kind,
              ),
            );
            if (!row)
              throw new ApiProblem(
                404,
                "PROVIDER_CONFIGURATION_NOT_FOUND",
                "engine provider is not configured",
              );
            context.header("etag", `"v${row.version}"`);
            return context.json(settingJson(row));
          });

          const updateProviderConfiguration = createRoute({
            method: "put",
            path: "/api/v2/agents/providers/{kind}/configuration",
            request: {
              params: z.object({
                kind: z.enum(["opencode", "codex", "dsh", "pi", "langgraph"]),
              }),
              body: {
                content: {
                  "application/json": {
                    schema: providerConfigurationInputSchema,
                  },
                },
              },
            },
            responses: {
              200: response(
                providerConfigurationSchema,
                "Provider configuration updated",
              ),
              201: response(
                providerConfigurationSchema,
                "Provider configuration created",
              ),
              ...errors,
            },
          });
          app.openapi(updateProviderConfiguration, (async (context: any) => {
            const { kind } = context.req.valid("param");
            const input = context.req.valid("json");
            const existing = ctx.uow.execute((tx) =>
              tx.get<ProviderSettingRow>(
                "SELECT * FROM agents_provider_settings WHERE kind = ?",
                kind,
              ),
            );
            if (existing) requireIfMatch(context.req.raw, existing.version);
            try {
              await bridge.call(kind, "configure", input);
            } catch (error) {
              throw new ApiProblem(
                503,
                "ENGINE_CONFIGURATION_FAILED",
                error instanceof Error ? error.message : String(error),
              );
            }
            const now = new Date().toISOString();
            const config: ProviderConfiguration = {
              providerKind: input.providerKind,
              providerAdapter: input.providerAdapter,
              model: input.model,
              ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
            };
            const row = ctx.uow.execute((tx) => {
              tx.run(
                `INSERT INTO agents_provider_settings
                 (kind, credential_ref, config_json, enabled, version, updated_at)
                 VALUES (?, ?, ?, 1, 1, ?)
                 ON CONFLICT(kind) DO UPDATE SET
                   credential_ref = excluded.credential_ref,
                   config_json = excluded.config_json,
                   enabled = 1,
                   version = agents_provider_settings.version + 1,
                   updated_at = excluded.updated_at`,
                kind,
                input.credentialRef,
                JSON.stringify(config),
                now,
              );
              const updated = tx.get<ProviderSettingRow>(
                "SELECT * FROM agents_provider_settings WHERE kind = ?",
                kind,
              )!;
              tx.append({
                type: "agents.provider-configured.v1",
                pluginId: "agents",
                aggregateType: "agent-provider",
                aggregateId: kind,
                aggregateVersion: updated.version,
                payload: settingJson(updated),
              });
              return updated;
            });
            if (
              existing?.credential_ref &&
              existing.credential_ref !== input.credentialRef
            )
              await bridge
                .call(kind, "credential.remove", {
                  credentialRef: existing.credential_ref,
                })
                .catch((error) =>
                  console.warn(
                    `could not remove superseded ${kind} credential: ${error instanceof Error ? error.message : String(error)}`,
                  ),
                );
            context.header("etag", `"v${row.version}"`);
            return context.json(settingJson(row), existing ? 200 : 201);
          }) as never);

          const codexAuthStatus = createRoute({
            method: "get",
            path: "/api/v2/agents/providers/codex/auth",
            responses: {
              200: response(
                z.object({
                  available: z.literal(true),
                  authenticated: z.boolean(),
                  mode: z.string().optional(),
                  accountLabel: z.string().optional(),
                }),
                "Codex authentication status",
              ),
              ...errors,
            },
          });
          app.openapi(codexAuthStatus, (async (context: any) => {
            try {
              return context.json(
                await bridge.call("codex", "authStatus", {}),
                200,
              );
            } catch (error) {
              throw new ApiProblem(
                503,
                "CODEX_AUTH_UNAVAILABLE",
                error instanceof Error ? error.message : String(error),
              );
            }
          }) as never);

          const codexLogin = createRoute({
            method: "post",
            path: "/api/v2/agents/providers/codex/actions/login",
            request: {
              body: {
                content: {
                  "application/json": {
                    schema: z.object({
                      mode: z.enum(["chatgpt_device_code", "chatgpt_browser"]),
                    }),
                  },
                },
              },
            },
            responses: {
              200: response(
                z.object({
                  status: z.enum(["pending", "authenticated"]),
                  verificationUrl: z.string().url().optional(),
                  userCode: z.string().optional(),
                  message: z.string(),
                }),
                "Codex login started",
              ),
              ...errors,
            },
          });
          app.openapi(codexLogin, (async (context: any) => {
            const input = context.req.valid("json");
            return idempotentResponse(
              ctx.uow,
              context.req.raw,
              "agents.codex.login",
              input,
              async () =>
                context.json(await bridge.call("codex", "login", input), 200),
            );
          }) as never);

          const codexLogout = createRoute({
            method: "post",
            path: "/api/v2/agents/providers/codex/actions/logout",
            responses: {
              200: response(
                z.object({ ok: z.boolean() }).passthrough(),
                "Codex logged out",
              ),
              ...errors,
            },
          });
          app.openapi(codexLogout, (async (context: any) =>
            idempotentResponse(
              ctx.uow,
              context.req.raw,
              "agents.codex.logout",
              {},
              async () =>
                context.json(await bridge.call("codex", "logout", {}), 200),
            )) as never);

          const testProvider = createRoute({
            method: "post",
            path: "/api/v2/agents/providers/{kind}/actions/test",
            request: {
              params: z.object({
                kind: z.enum(["opencode", "codex", "dsh", "pi", "langgraph"]),
              }),
            },
            responses: {
              200: response(
                z.object({
                  status: z.enum(["healthy", "degraded", "unavailable"]),
                  version: z.string(),
                }),
                "Provider connection test",
              ),
              ...errors,
            },
          });
          app.openapi(testProvider, (async (context: any) => {
            const { kind } = context.req.valid("param");
            return idempotentResponse(
              ctx.uow,
              context.req.raw,
              `agents.provider.${kind}.test`,
              {},
              async () =>
                context.json(await ctx.engineRegistry.get(kind).health(), 200),
            );
          }) as never);

          const createSession = createRoute({
            method: "post",
            path: "/api/v2/agents/sessions",
            request: {
              body: {
                content: {
                  "application/json": { schema: createAgentSessionSchema },
                },
              },
            },
            responses: {
              201: response(agentSessionSchema, "Session created"),
              ...errors,
            },
          });
          app.openapi(createSession, (async (context: any) => {
            const input = context.req.valid("json");
            return (await idempotentResponse(
              ctx.uow,
              context.req.raw,
              "agents.sessions.create",
              input,
              async () => {
                const provider = ctx.engineRegistry.get(input.engineKind);
                const engineSession = await provider.createSession(input);
                const now = new Date().toISOString();
                const session: SessionRow = {
                  id: randomUUID(),
                  engine_session_id: engineSession.sessionId,
                  project_id: input.projectId,
                  engine_kind: input.engineKind,
                  title: input.title,
                  state: "active",
                  version: 1,
                  created_at: now,
                  updated_at: now,
                };
                ctx.uow.execute((tx) => {
                  tx.run(
                    `INSERT INTO agents_sessions
                   (id, engine_session_id, project_id, engine_kind, title, state, version, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    session.id,
                    session.engine_session_id,
                    session.project_id,
                    session.engine_kind,
                    session.title,
                    session.state,
                    session.version,
                    session.created_at,
                    session.updated_at,
                  );
                  tx.append({
                    type: "agents.session-created.v1",
                    pluginId: "agents",
                    aggregateType: "agent-session",
                    aggregateId: session.id,
                    aggregateVersion: 1,
                    payload: sessionJson(session),
                  });
                });
                context.header("etag", '"v1"');
                context.header(
                  "location",
                  `/api/v2/agents/sessions/${session.id}`,
                );
                return context.json(sessionJson(session), 201);
              },
            )) as never;
          }) as never);

          const listSessions = createRoute({
            method: "get",
            path: "/api/v2/agents/sessions",
            request: {
              query: z.object({
                projectId: z.uuid().optional(),
                cursor: z.uuid().optional(),
                limit: z.coerce.number().int().min(1).max(200).default(50),
              }),
            },
            responses: {
              200: response(
                z.object({
                  items: z.array(agentSessionSchema),
                  nextCursor: z.uuid().optional(),
                }),
                "Agent sessions",
              ),
              ...errors,
            },
          });
          app.openapi(listSessions, (context) => {
            const query = context.req.valid("query");
            const cursor = query.cursor
              ? ctx.uow.execute((tx) =>
                  tx.get<{ created_at: string; id: string }>(
                    "SELECT created_at, id FROM agents_sessions WHERE id = ?",
                    query.cursor,
                  ),
                )
              : undefined;
            if (query.cursor && !cursor)
              throw new ApiProblem(
                400,
                "INVALID_CURSOR",
                "session cursor does not exist",
              );
            const clauses: string[] = [];
            const parameters: unknown[] = [];
            if (query.projectId) {
              clauses.push("project_id = ?");
              parameters.push(query.projectId);
            }
            if (cursor) {
              clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
              parameters.push(cursor.created_at, cursor.created_at, cursor.id);
            }
            const rows = ctx.uow.execute((tx) =>
              tx.all<SessionRow>(
                `SELECT * FROM agents_sessions
                  ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
                  ORDER BY created_at DESC, id DESC LIMIT ?`,
                ...parameters,
                query.limit + 1,
              ),
            );
            const hasMore = rows.length > query.limit;
            const items = rows.slice(0, query.limit);
            return context.json({
              items: items.map(sessionJson),
              ...(hasMore ? { nextCursor: items.at(-1)!.id } : {}),
            });
          });

          const getSessionRoute = createRoute({
            method: "get",
            path: "/api/v2/agents/sessions/{id}",
            request: { params: z.object({ id: z.uuid() }) },
            responses: {
              200: response(agentSessionSchema, "Session"),
              ...errors,
            },
          });
          app.openapi(getSessionRoute, (context) => {
            const session = getSession(ctx, context.req.valid("param").id);
            context.header("etag", `"v${session.version}"`);
            return context.json(sessionJson(session));
          });

          const forkSession = createRoute({
            method: "post",
            path: "/api/v2/agents/sessions/{id}/actions/fork",
            request: {
              params: z.object({ id: z.uuid() }),
              body: {
                content: {
                  "application/json": { schema: forkAgentSessionSchema },
                },
              },
            },
            responses: {
              201: response(agentSessionSchema, "Forked agent session"),
              ...errors,
            },
          });
          app.openapi(forkSession, (async (context: any) => {
            const source = getSession(ctx, context.req.valid("param").id);
            requireIfMatch(context.req.raw, source.version);
            if (source.state !== "active")
              throw new ApiProblem(
                409,
                "SESSION_DISPOSED",
                "disposed agent session cannot be forked",
              );
            const input = context.req.valid("json");
            return (await idempotentResponse(
              ctx.uow,
              context.req.raw,
              `agents.sessions.${source.id}.fork`,
              input,
              async () => {
                const engineSession = await ctx.engineRegistry
                  .get(source.engine_kind)
                  .fork(source.engine_session_id);
                const now = new Date().toISOString();
                const forked: SessionRow = {
                  id: randomUUID(),
                  engine_session_id: engineSession.sessionId,
                  project_id: source.project_id,
                  engine_kind: source.engine_kind,
                  title: input.title ?? `${source.title}（分支）`,
                  state: "active",
                  version: 1,
                  created_at: now,
                  updated_at: now,
                };
                ctx.uow.execute((tx) => {
                  tx.run(
                    `INSERT INTO agents_sessions
                     (id, engine_session_id, project_id, engine_kind, title, state, version, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
                    forked.id,
                    forked.engine_session_id,
                    forked.project_id,
                    forked.engine_kind,
                    forked.title,
                    now,
                    now,
                  );
                  tx.append({
                    type: "agents.session-forked.v1",
                    pluginId: "agents",
                    aggregateType: "agent-session",
                    aggregateId: forked.id,
                    aggregateVersion: 1,
                    payload: {
                      sourceSessionId: source.id,
                      ...sessionJson(forked),
                    },
                  });
                });
                context.header("etag", '"v1"');
                context.header(
                  "location",
                  `/api/v2/agents/sessions/${forked.id}`,
                );
                return context.json(sessionJson(forked), 201);
              },
            )) as never;
          }) as never);

          const disposeSession = createRoute({
            method: "delete",
            path: "/api/v2/agents/sessions/{id}",
            request: { params: z.object({ id: z.uuid() }) },
            responses: {
              204: { description: "Agent session disposed" },
              ...errors,
            },
          });
          app.openapi(disposeSession, async (context) => {
            const session = getSession(ctx, context.req.valid("param").id);
            requireIfMatch(context.req.raw, session.version);
            if (session.state === "disposed") return context.body(null, 204);
            const activeRun = ctx.uow.execute((tx) =>
              tx.get<{ id: string }>(
                "SELECT id FROM agents_runs WHERE session_id = ? AND state IN ('queued', 'running') LIMIT 1",
                session.id,
              ),
            );
            if (activeRun)
              throw new ApiProblem(
                409,
                "SESSION_HAS_ACTIVE_RUN",
                "interrupt or finish the active run before disposing the session",
              );
            await ctx.engineRegistry
              .get(session.engine_kind)
              .dispose(session.engine_session_id);
            ctx.uow.execute((tx) => {
              tx.run(
                "UPDATE agents_sessions SET state = 'disposed', version = version + 1, updated_at = ? WHERE id = ? AND state = 'active'",
                new Date().toISOString(),
                session.id,
              );
              tx.append({
                type: "agents.session-disposed.v1",
                pluginId: "agents",
                aggregateType: "agent-session",
                aggregateId: session.id,
                aggregateVersion: session.version + 1,
                payload: { id: session.id, state: "disposed" },
              });
            });
            return context.body(null, 204);
          });

          const createRun = createRoute({
            method: "post",
            path: "/api/v2/agents/sessions/{id}/runs",
            request: {
              params: z.object({ id: z.uuid() }),
              body: {
                content: { "application/json": { schema: createRunSchema } },
              },
            },
            responses: {
              202: response(taskRefSchema, "Run queued"),
              ...errors,
            },
          });
          app.openapi(createRun, (async (context: any) => {
            const session = getSession(ctx, context.req.valid("param").id);
            if (session.state !== "active")
              throw new ApiProblem(
                409,
                "SESSION_DISPOSED",
                "agent session is disposed",
              );
            const input = context.req.valid("json");
            return (await idempotentResponse(
              ctx.uow,
              context.req.raw,
              `agents.sessions.${session.id}.runs`,
              input,
              async () => {
                if (activeClaims.has(session.engine_kind))
                  throw new ApiProblem(
                    409,
                    "ENGINE_BUSY",
                    "this engine already has an active claimed run",
                  );
                const id = randomUUID();
                const engineRunId = randomUUID();
                const claimId = randomUUID();
                const now = new Date().toISOString();
                const claimExpiresAt = new Date(
                  Date.now() + 2 * 60 * 60_000,
                ).toISOString();
                const run: RunRow = {
                  id,
                  session_id: session.id,
                  engine_run_id: engineRunId,
                  state: "queued",
                  prompt: input.prompt,
                  input_tokens: 0,
                  output_tokens: 0,
                  cost_micros: 0,
                  error_code: null,
                  error_message: null,
                  version: 1,
                  created_at: now,
                  updated_at: now,
                };
                ctx.uow.execute((tx) => {
                  tx.run(
                    `INSERT INTO agents_runs
                   (id, session_id, engine_run_id, state, prompt, input_tokens, output_tokens, cost_micros,
                    error_code, error_message, version, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, 1, ?, ?)`,
                    id,
                    session.id,
                    engineRunId,
                    "queued",
                    input.prompt,
                    now,
                    now,
                  );
                  tx.append({
                    type: "agents.run-queued.v1",
                    pluginId: "agents",
                    aggregateType: "agent-run",
                    aggregateId: id,
                    aggregateVersion: 1,
                    payload: runJson(run),
                  });
                  tx.run(
                    `INSERT INTO agents_mcp_claims
                     (id, project_id, session_id, run_id, read_only, max_results, expires_at, created_at)
                     VALUES (?, ?, ?, ?, 1, 50, ?, ?)`,
                    claimId,
                    session.project_id,
                    session.id,
                    id,
                    claimExpiresAt,
                    now,
                  );
                });
                const provider = ctx.engineRegistry.get(session.engine_kind);
                activeClaims.set(session.engine_kind, claimId);
                void consumeEngineEvents(
                  ctx,
                  run,
                  provider.run({
                    runId: engineRunId,
                    sessionId: session.engine_session_id,
                    prompt: input.prompt,
                    checkpointId: input.checkpointId,
                  }),
                ).finally(() => {
                  if (activeClaims.get(session.engine_kind) === claimId)
                    activeClaims.delete(session.engine_kind);
                });
                return context.json(
                  {
                    taskId: id,
                    state: "queued" as const,
                    href: `/api/v2/agents/runs/${id}`,
                  },
                  202,
                );
              },
            )) as never;
          }) as never);

          const listRuns = createRoute({
            method: "get",
            path: "/api/v2/agents/sessions/{id}/runs",
            request: {
              params: z.object({ id: z.uuid() }),
              query: z.object({
                cursor: z.uuid().optional(),
                limit: z.coerce.number().int().min(1).max(200).default(50),
              }),
            },
            responses: {
              200: response(
                z.object({
                  items: z.array(agentRunSchema),
                  nextCursor: z.uuid().optional(),
                }),
                "Session runs",
              ),
              ...errors,
            },
          });
          app.openapi(listRuns, (context) => {
            const session = getSession(ctx, context.req.valid("param").id);
            const query = context.req.valid("query");
            const cursor = query.cursor
              ? ctx.uow.execute((tx) =>
                  tx.get<{ created_at: string; id: string }>(
                    "SELECT created_at, id FROM agents_runs WHERE id = ? AND session_id = ?",
                    query.cursor,
                    session.id,
                  ),
                )
              : undefined;
            if (query.cursor && !cursor)
              throw new ApiProblem(
                400,
                "INVALID_CURSOR",
                "run cursor does not exist in this session",
              );
            const rows = ctx.uow.execute((tx) =>
              tx.all<RunRow>(
                `SELECT * FROM agents_runs
                  WHERE session_id = ?
                    ${cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
                  ORDER BY created_at DESC, id DESC LIMIT ?`,
                session.id,
                ...(cursor
                  ? [cursor.created_at, cursor.created_at, cursor.id]
                  : []),
                query.limit + 1,
              ),
            );
            const hasMore = rows.length > query.limit;
            const items = rows.slice(0, query.limit);
            return context.json({
              items: items.map(runJson),
              ...(hasMore ? { nextCursor: items.at(-1)!.id } : {}),
            });
          });

          const getRunRoute = createRoute({
            method: "get",
            path: "/api/v2/agents/runs/{id}",
            request: { params: z.object({ id: z.uuid() }) },
            responses: { 200: response(agentRunSchema, "Run"), ...errors },
          });
          app.openapi(getRunRoute, (context) => {
            const run = getRun(ctx, context.req.valid("param").id);
            context.header("etag", `"v${run.version}"`);
            return context.json(runJson(run));
          });

          const resumeRun = createRoute({
            method: "post",
            path: "/api/v2/agents/runs/{id}/actions/resume",
            request: { params: z.object({ id: z.uuid() }) },
            responses: {
              202: response(taskRefSchema, "Run resumed"),
              ...errors,
            },
          });
          app.openapi(resumeRun, (async (context: any) => {
            const run = getRun(ctx, context.req.valid("param").id);
            requireIfMatch(context.req.raw, run.version);
            if (!(["failed", "interrupted"] as TaskState[]).includes(run.state))
              throw new ApiProblem(
                409,
                "RUN_NOT_RESUMABLE",
                `run in ${run.state} state cannot be resumed`,
              );
            const session = getSession(ctx, run.session_id);
            if (session.state !== "active")
              throw new ApiProblem(
                409,
                "SESSION_DISPOSED",
                "run session is disposed",
              );
            return (await idempotentResponse(
              ctx.uow,
              context.req.raw,
              `agents.runs.${run.id}.resume.v${run.version}`,
              { runId: run.id, version: run.version },
              async () => {
                if (activeClaims.has(session.engine_kind))
                  throw new ApiProblem(
                    409,
                    "ENGINE_BUSY",
                    "this engine already has an active claimed run",
                  );
                const claimId = randomUUID();
                const now = new Date().toISOString();
                const updated = transitionRun(
                  ctx,
                  run.id,
                  ["failed", "interrupted"],
                  "queued",
                  ", error_code = NULL, error_message = NULL",
                  [],
                  (next) => ({
                    type: "agents.run-resumed.v1",
                    pluginId: "agents",
                    aggregateType: "agent-run",
                    aggregateId: next.id,
                    aggregateVersion: next.version,
                    payload: { id: next.id, state: next.state },
                  }),
                  (tx) => {
                    tx.run(
                      `INSERT INTO agents_mcp_claims
                       (id, project_id, session_id, run_id, read_only, max_results, expires_at, created_at)
                       VALUES (?, ?, ?, ?, 1, 50, ?, ?)`,
                      claimId,
                      session.project_id,
                      session.id,
                      run.id,
                      new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
                      now,
                    );
                  },
                );
                const provider = ctx.engineRegistry.get(session.engine_kind);
                activeClaims.set(session.engine_kind, claimId);
                void consumeEngineEvents(
                  ctx,
                  updated,
                  provider.resume(run.engine_run_id),
                  {
                    onCompleted: (output, completed) =>
                      completeAssistantRun(ctx, output, completed),
                  },
                ).finally(() => {
                  if (activeClaims.get(session.engine_kind) === claimId)
                    activeClaims.delete(session.engine_kind);
                });
                return context.json(
                  {
                    taskId: run.id,
                    state: "queued" as const,
                    href: `/api/v2/agents/runs/${run.id}`,
                  },
                  202,
                );
              },
            )) as never;
          }) as never);

          const listItems = createRoute({
            method: "get",
            path: "/api/v2/agents/runs/{id}/items",
            request: { params: z.object({ id: z.uuid() }) },
            responses: {
              200: response(
                z.object({ items: z.array(agentItemSchema) }),
                "Run items",
              ),
              ...errors,
            },
          });
          app.openapi(listItems, (context) => {
            const run = getRun(ctx, context.req.valid("param").id);
            const items = ctx.uow.execute((tx) =>
              tx.all<{
                id: string;
                run_id: string;
                sequence: number;
                type: string;
                payload_json: string;
                created_at: string;
              }>(
                "SELECT * FROM agents_items WHERE run_id = ? ORDER BY sequence ASC LIMIT 200",
                run.id,
              ),
            );
            return context.json({
              items: items.map((item) => ({
                id: item.id,
                runId: item.run_id,
                sequence: item.sequence,
                type: item.type,
                payload: JSON.parse(item.payload_json),
                createdAt: item.created_at,
              })),
            });
          });

          const listCheckpoints = createRoute({
            method: "get",
            path: "/api/v2/agents/runs/{id}/checkpoints",
            request: { params: z.object({ id: z.uuid() }) },
            responses: {
              200: response(
                z.object({ items: z.array(agentCheckpointSchema) }),
                "Run checkpoints",
              ),
              ...errors,
            },
          });
          app.openapi(listCheckpoints, (context) => {
            const run = getRun(ctx, context.req.valid("param").id);
            const rows = ctx.uow.execute((tx) =>
              tx.all<CheckpointRow>(
                "SELECT * FROM agents_checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 200",
                run.id,
              ),
            );
            return context.json({ items: rows.map(checkpointJson) });
          });

          const interrupt = createRoute({
            method: "post",
            path: "/api/v2/agents/runs/{id}/actions/interrupt",
            request: { params: z.object({ id: z.uuid() }) },
            responses: {
              200: response(agentRunSchema, "Run interrupted"),
              ...errors,
            },
          });
          app.openapi(interrupt, async (context) => {
            const run = getRun(ctx, context.req.valid("param").id);
            requireIfMatch(context.req.raw, run.version);
            if (!(["queued", "running"] as TaskState[]).includes(run.state))
              throw new ApiProblem(
                409,
                "RUN_NOT_INTERRUPTIBLE",
                `run in ${run.state} state cannot be interrupted`,
              );
            const session = getSession(ctx, run.session_id);
            await ctx.engineRegistry
              .get(session.engine_kind)
              .interrupt(run.engine_run_id);
            const checkpointId = randomUUID();
            const checkpointCreatedAt = new Date().toISOString();
            const updated = transitionRun(
              ctx,
              run.id,
              ["queued", "running"],
              "interrupted",
              "",
              [],
              (next) => ({
                type: "agents.run-interrupted.v1",
                pluginId: "agents",
                aggregateType: "agent-run",
                aggregateId: next.id,
                aggregateVersion: next.version,
                payload: { id: next.id, checkpointId },
              }),
              (tx) => {
                tx.run(
                  `INSERT INTO agents_checkpoints
                   (id, run_id, engine_checkpoint_id, payload_json, created_at)
                   VALUES (?, ?, ?, ?, ?)`,
                  checkpointId,
                  run.id,
                  run.engine_run_id,
                  JSON.stringify({
                    sessionId: session.id,
                    engineKind: session.engine_kind,
                    prompt: run.prompt,
                  }),
                  checkpointCreatedAt,
                );
              },
            );
            context.header("etag", `"v${updated.version}"`);
            return context.json(runJson(updated));
          });

          const createClaim = createRoute({
            method: "post",
            path: "/api/v2/agents/mcp-claims",
            request: {
              body: {
                content: {
                  "application/json": {
                    schema: z.object({
                      projectId: z.uuid(),
                      sessionId: z.uuid(),
                      runId: z.uuid().nullable().default(null),
                      ttlSeconds: z.number().int().min(30).max(3600),
                      maxResults: z.number().int().min(1).max(200).default(50),
                    }),
                  },
                },
              },
            },
            responses: {
              201: response(mcpClaimSchema, "Read-only MCP claim"),
              ...errors,
            },
          });
          app.openapi(createClaim, (context) => {
            const input = context.req.valid("json");
            const session = getSession(ctx, input.sessionId);
            if (session.project_id !== input.projectId)
              throw new ApiProblem(
                403,
                "MCP_CLAIM_SCOPE_DENIED",
                "session is outside the project claim",
              );
            if (input.runId) {
              const run = getRun(ctx, input.runId);
              if (run.session_id !== input.sessionId)
                throw new ApiProblem(
                  403,
                  "MCP_CLAIM_SCOPE_DENIED",
                  "run is outside the session claim",
                );
            }
            const claim = {
              id: randomUUID(),
              projectId: input.projectId,
              sessionId: input.sessionId,
              runId: input.runId,
              readOnly: true as const,
              maxResults: input.maxResults,
              expiresAt: new Date(
                Date.now() + input.ttlSeconds * 1000,
              ).toISOString(),
            };
            ctx.uow.execute((tx) => {
              tx.run(
                `INSERT INTO agents_mcp_claims
                 (id, project_id, session_id, run_id, read_only, max_results, expires_at, created_at)
                 VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
                claim.id,
                claim.projectId,
                claim.sessionId,
                claim.runId,
                claim.maxResults,
                claim.expiresAt,
                new Date().toISOString(),
              );
            });
            return context.json(claim, 201);
          });
        },
      };
      ctx.http.register(routes);
      void bridge;
    },
  };
}
