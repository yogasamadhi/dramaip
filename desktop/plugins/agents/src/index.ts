import {
  AGENT_TASK_RUNNER_SERVICE,
  CONFIGURED_PROVIDER_SERVICE,
  type AgentEngineKind,
  type AgentTaskRunnerService,
  type ConfiguredProvider,
  type ConfiguredProviderService,
} from "@dramaip/contracts";
import {
  AUTOMATION_PREVIEW_SERVICE,
  type AutomationPreviewService,
} from "@dramaip/contracts/automation";
import {
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import type {
  AgentProviderActivationInput,
  CodexAuthenticationLoginInput,
  DesktopHostClient,
} from "@dramaip/desktop-host";
import { createHostAgentRuntime } from "@dramaip/desktop-host";
import { streamSSE } from "hono/streaming";
import {
  defineFirstPartyPlugin,
  type PluginContext,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";
import { AGENT_TASK_CATALOG } from "./task-catalog.js";

export { AGENT_TASK_CATALOG };

type ProviderPayload = Record<string, unknown>;

interface ProviderRow {
  id: string;
  title: string;
  payload_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ProviderEntity {
  id: string;
  domain: "providers";
  title: string;
  payload: ProviderPayload;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface CodexCustomProviderSettingRow {
  provider_id: string;
  protocol: "responses" | "chat_completions";
}

const providerMigrations = [
  {
    id: "agents.0001.provider-configurations",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["foundation.0001.runtime-ledger"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_provider_configurations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_provider_configurations_updated_at
        ON agent_provider_configurations(updated_at DESC, id);
    `,
  },
  {
    id: "agents.0002.provider-settings",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["agents.0001.provider-configurations"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_provider_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        provider_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents.0003.engine-settings",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["agents.0002.provider-settings"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_global_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        default_engine_kind TEXT NOT NULL,
        default_model_json TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_project_settings (
        project_id TEXT PRIMARY KEY,
        default_engine_kind TEXT NOT NULL,
        default_model_json TEXT,
        assistant_mode TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents.0004.assistant-conversations",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["agents.0003.engine-settings"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_assistant_sessions (
        id TEXT PRIMARY KEY,
        engine_session_id TEXT NOT NULL,
        engine_kind TEXT NOT NULL,
        project_id TEXT,
        surface TEXT NOT NULL,
        chapter_id TEXT,
        task_type TEXT,
        title TEXT,
        model_json TEXT,
        status TEXT NOT NULL,
        archived_at TEXT,
        last_opened_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_assistant_sessions_opened_at
        ON agent_assistant_sessions(archived_at, last_opened_at DESC, id);
      CREATE INDEX IF NOT EXISTS agent_assistant_sessions_project_id
        ON agent_assistant_sessions(project_id, archived_at, last_opened_at DESC);

      CREATE TABLE IF NOT EXISTS agent_assistant_turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT,
        user_message TEXT NOT NULL,
        project_id TEXT,
        chapter_id TEXT,
        selection_json TEXT,
        route_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_assistant_turns_session_created_at
        ON agent_assistant_turns(session_id, created_at, id);

      CREATE TABLE IF NOT EXISTS agent_assistant_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        engine_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        model_json TEXT,
        turn_id TEXT,
        chapter_id TEXT,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_assistant_runs_session_created_at
        ON agent_assistant_runs(session_id, created_at, id);

      CREATE TABLE IF NOT EXISTS agent_assistant_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        content TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS agent_assistant_items_run_sequence
        ON agent_assistant_items(run_id, sequence);
    `,
  },
  {
    id: "agents.0005.codex-custom-provider-settings",
    pluginId: "agents",
    version: "3.0.0-alpha.2",
    dependsOn: ["agents.0004.assistant-conversations"],
    sql: `
      CREATE TABLE IF NOT EXISTS agent_codex_custom_provider_settings (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        provider_id TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK(protocol IN ('responses', 'chat_completions')),
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "agents.0006.alpha3-agent-runtime-reset",
    pluginId: "agents",
    version: "3.0.0-alpha.3",
    dependsOn: ["agents.0005.codex-custom-provider-settings"],
    // Alpha.3 deliberately preserves provider settings and opaque credentials,
    // while resetting only execution/evaluation state from alpha.2.
    sql: `
      DELETE FROM agent_assistant_items;
      DELETE FROM agent_assistant_runs;
      DELETE FROM agent_assistant_turns;
      DELETE FROM agent_assistant_sessions;
      UPDATE agent_global_settings SET default_engine_kind = 'pi';
      UPDATE agent_project_settings SET default_engine_kind = 'pi';
      DROP TABLE IF EXISTS agent_experiment_runs;
      DROP TABLE IF EXISTS agent_experiment_groups;
      DROP TABLE IF EXISTS agent_evaluation_reviews;
      DROP TABLE IF EXISTS agent_evaluation_candidates;
      DROP TABLE IF EXISTS agent_evaluations;
      CREATE TABLE IF NOT EXISTS agent_capability_grants (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        capabilities_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_capability_grants_run_id
        ON agent_capability_grants(run_id, expires_at);
      CREATE TABLE IF NOT EXISTS agent_evaluations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        context_snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL,
        revealed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_evaluation_candidates (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        candidate TEXT NOT NULL CHECK(candidate IN ('a', 'b', 'c')),
        engine_kind TEXT NOT NULL CHECK(engine_kind IN ('pi', 'codex', 'grok')),
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        output_json TEXT,
        metrics_json TEXT NOT NULL,
        UNIQUE(evaluation_id, candidate),
        UNIQUE(evaluation_id, engine_kind)
      );
      CREATE TABLE IF NOT EXISTS agent_evaluation_reviews (
        evaluation_id TEXT PRIMARY KEY,
        preferred_candidate TEXT NOT NULL CHECK(preferred_candidate IN ('a', 'b', 'c', 'tie')),
        accepted INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL
      );
    `,
  },
] as const;

const engineDefinitions = {
  pi: {
    name: "Pi",
    version: "0.84.2",
    isBeta: false,
    role: "embedded-default",
  },
  codex: {
    name: "Codex",
    version: "0.147.0",
    isBeta: false,
    role: "external-benchmark",
  },
  grok: {
    name: "Grok Build",
    version: "1.0.5",
    isBeta: false,
    role: "external-benchmark",
  },
} as const;

const agentEngineKinds = Object.keys(engineDefinitions) as AgentEngineKind[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasRawSecret(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || depth > 12) return false;
  for (const [key, child] of Object.entries(value)) {
    // A credential reference is deliberately allowed: it is an opaque Host
    // handle, whereas the secret itself must never enter the Runtime database.
    if (
      /(?:api[-_ ]?key|secret|token|password|接口密钥|api密钥)/iu.test(key) &&
      typeof child === "string" &&
      child.trim().length > 0
    )
      return true;
    if (hasRawSecret(child, depth + 1)) return true;
  }
  return false;
}

function parsePayload(value: unknown): ProviderPayload | undefined {
  if (!isRecord(value) || hasRawSecret(value)) return undefined;
  try {
    return JSON.stringify(value).length <= 64 * 1024 ? value : undefined;
  } catch {
    return undefined;
  }
}

function providerEntity(row: ProviderRow): ProviderEntity {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    throw new Error(`Invalid stored provider payload: ${row.id}`);
  }
  if (!isRecord(payload))
    throw new Error(`Invalid stored provider payload: ${row.id}`);
  return {
    id: row.id,
    domain: "providers",
    title: row.title,
    payload,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function agentProviderConfiguration(
  provider: ProviderEntity,
): AgentProviderActivationInput {
  const serviceType = text(provider.payload["服务类型"]);
  const credentialRef = text(provider.payload["凭据引用"]);
  const model = text(provider.payload["模型名称"]);
  const baseUrl = text(provider.payload["服务地址"]);
  const protocol = text(provider.payload["调用协议"])?.toLowerCase() ?? "";
  const presetProvider = text(provider.payload["预设服务商"])?.toLowerCase();
  if (serviceType !== "智能模型")
    throw new Error("仅“智能模型”类型的服务商可供智能助手使用。");
  if (!credentialRef || !model)
    throw new Error("智能助手模型需要模型名称和已保存的接口密钥。");
  if (baseUrl) {
    let address: URL;
    try {
      address = new URL(baseUrl);
    } catch {
      throw new Error("智能助手服务地址必须是 HTTP 或 HTTPS 地址。");
    }
    if (
      !["http:", "https:"].includes(address.protocol) ||
      address.username ||
      address.password
    )
      throw new Error("智能助手服务地址不能包含账号或密码。");
  }
  const providerKind = protocol.includes("anthropic")
    ? "anthropic"
    : protocol.includes("google") || protocol.includes("gemini")
      ? "google"
      : "openai";
  return {
    providerId: provider.id,
    // Keep the Runtime provider id stable while configuration is persisted.
    runtimeProviderId: "dramaip-agent",
    providerKind,
    providerAdapter:
      providerKind === "anthropic"
        ? "anthropic"
        : providerKind === "google"
          ? "google"
          : presetProvider === "openai"
            ? "openai"
            : "openai-compatible",
    model,
    ...(baseUrl ? { baseUrl } : {}),
    credentialRef,
    environmentName:
      providerKind === "anthropic"
        ? "ANTHROPIC_API_KEY"
        : providerKind === "google"
          ? "GOOGLE_GENERATIVE_AI_API_KEY"
          : "OPENAI_API_KEY",
  };
}

function configuredProvider(provider: ProviderEntity): ConfiguredProvider {
  const serviceType = text(provider.payload["服务类型"]) ?? "未分类服务";
  const credentialRef = text(provider.payload["凭据引用"]);
  const model = text(provider.payload["模型名称"]);
  const baseUrl = text(provider.payload["服务地址"]);
  if (!credentialRef || !model)
    throw new Error("服务商需要模型名称和已保存的接口密钥。");
  if (baseUrl) {
    const value = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(value.protocol) ||
      value.username ||
      value.password
    )
      throw new Error("服务商地址必须是无账号密码的 HTTP 或 HTTPS 地址。");
  }
  const concurrencyLimit = Number(provider.payload["并发上限"]);
  const estimatedUnitCost = Number(provider.payload["单次预估费用"]);
  return {
    id: provider.id,
    title: provider.title,
    serviceType,
    model,
    credentialRef,
    ...(baseUrl ? { baseUrl } : {}),
    ...(text(provider.payload["调用协议"])
      ? { protocol: text(provider.payload["调用协议"]) }
      : {}),
    ...(Number.isInteger(concurrencyLimit) && concurrencyLimit > 0
      ? { concurrencyLimit }
      : {}),
    ...(Number.isFinite(estimatedUnitCost) && estimatedUnitCost >= 0
      ? { estimatedUnitCost }
      : {}),
    ...(text(provider.payload["费用币种"])
      ? { currency: text(provider.payload["费用币种"]) }
      : {}),
  };
}

function codexCustomProviderLoginInput(
  provider: ProviderEntity,
  protocol: "responses" | "chat_completions",
): CodexAuthenticationLoginInput {
  const configuration = agentProviderConfiguration(provider);
  if (!configuration.baseUrl)
    throw new Error("Codex 自定义服务商必须配置 HTTP 或 HTTPS 服务地址。");
  return {
    mode: "custom_provider",
    credentialRef: configuration.credentialRef,
    provider: {
      id: provider.id,
      name: provider.title,
      baseUrl: configuration.baseUrl,
      model: configuration.model,
      protocol,
    },
  };
}

function codexCustomProviderSetting(
  pluginContext: PluginContext,
): CodexCustomProviderSettingRow | undefined {
  return pluginContext.uow.execute((transaction) =>
    transaction.get<CodexCustomProviderSettingRow>(
      `SELECT provider_id, protocol
       FROM agent_codex_custom_provider_settings
       WHERE singleton = 1`,
    ),
  );
}

type CodexLoginMode =
  "api_key" | "chatgpt_browser" | "chatgpt_device_code" | "custom_provider";

function codexLoginMode(value: unknown): CodexLoginMode | undefined {
  return [
    "api_key",
    "chatgpt_browser",
    "chatgpt_device_code",
    "custom_provider",
  ].includes(String(value))
    ? (value as CodexLoginMode)
    : undefined;
}

function findProvider(
  pluginContext: PluginContext,
  id: string,
): ProviderEntity | undefined {
  return pluginContext.uow.execute((transaction) => {
    const row = transaction.get<ProviderRow>(
      `SELECT id, title, payload_json, version, created_at, updated_at
       FROM agent_provider_configurations WHERE id = ?`,
      id,
    );
    return row ? providerEntity(row) : undefined;
  });
}

interface GlobalAgentSettingsRow {
  default_engine_kind: string;
  default_model_json: string | null;
  updated_at: string;
}

interface AgentModelSelection {
  providerId?: string;
  modelId?: string;
  profileId?: string;
}

function isAgentEngineKind(value: unknown): value is AgentEngineKind {
  return agentEngineKinds.includes(value as AgentEngineKind);
}

function modelSelection(value: unknown): AgentModelSelection | undefined {
  if (!isRecord(value)) return undefined;
  const result: AgentModelSelection = {};
  for (const key of ["providerId", "modelId", "profileId"] as const) {
    if (typeof value[key] !== "undefined" && typeof value[key] !== "string")
      return undefined;
    if (typeof value[key] === "string" && value[key].trim())
      result[key] = value[key].trim();
  }
  return Object.keys(result).length ? result : undefined;
}

function globalAgentSettings(pluginContext: PluginContext): {
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
  updatedAt: string;
} {
  return pluginContext.uow.execute((transaction) => {
    const row = transaction.get<GlobalAgentSettingsRow>(
      `SELECT default_engine_kind, default_model_json, updated_at
       FROM agent_global_settings WHERE singleton = 1`,
    );
    let defaultModel: AgentModelSelection | undefined;
    if (row?.default_model_json) {
      try {
        defaultModel = modelSelection(JSON.parse(row.default_model_json));
      } catch {
        defaultModel = undefined;
      }
    }
    return {
      defaultEngineKind: isAgentEngineKind(row?.default_engine_kind)
        ? row.default_engine_kind
        : "pi",
      ...(defaultModel ? { defaultModel } : {}),
      updatedAt: row?.updated_at ?? new Date().toISOString(),
    };
  });
}

function projectAgentSettings(
  pluginContext: PluginContext,
  projectId: string,
): Record<string, unknown> {
  const global = globalAgentSettings(pluginContext);
  return pluginContext.uow.execute((transaction) => {
    const row = transaction.get<{
      default_engine_kind: string;
      default_model_json: string | null;
      assistant_mode: string;
      updated_at: string;
    }>(
      `SELECT default_engine_kind, default_model_json, assistant_mode, updated_at
       FROM agent_project_settings WHERE project_id = ?`,
      projectId,
    );
    const parsedModel = row?.default_model_json
      ? modelSelection(JSON.parse(row.default_model_json))
      : undefined;
    return {
      projectId,
      defaultEngineKind: isAgentEngineKind(row?.default_engine_kind)
        ? row.default_engine_kind
        : global.defaultEngineKind,
      ...((parsedModel ?? global.defaultModel)
        ? { defaultModel: parsedModel ?? global.defaultModel }
        : {}),
      assistantMode: row?.assistant_mode === "advanced" ? "advanced" : "simple",
      updatedAt: row?.updated_at ?? new Date().toISOString(),
    };
  });
}

function activeAgentProviderId(
  pluginContext: PluginContext,
): string | undefined {
  return pluginContext.uow.execute((transaction) => {
    const setting = transaction.get<{ provider_id: string }>(
      "SELECT provider_id FROM agent_provider_settings WHERE singleton = 1",
    );
    if (!setting) return undefined;
    return transaction.get<{ id: string }>(
      "SELECT id FROM agent_provider_configurations WHERE id = ?",
      setting.provider_id,
    )?.id;
  });
}

function hostEngineHealth(value: unknown): {
  available: boolean;
  healthy: boolean;
  configured: boolean;
  authenticated: boolean;
  version?: string;
} {
  if (!isRecord(value))
    return {
      available: false,
      healthy: false,
      configured: false,
      authenticated: false,
    };
  const healthy = value.healthy === true;
  return {
    available: value.available === true,
    healthy,
    // Hosts before alpha.2 did not emit a separate configuration field.  For
    // them, preserve the old interpretation so remote/headless compatibility
    // does not incorrectly hide a healthy configured engine.
    configured: value.configured === false ? false : healthy,
    authenticated: value.authenticated === true,
    ...(typeof value.version === "string" ? { version: value.version } : {}),
  };
}

async function agentEngineDescriptors(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): Promise<readonly Record<string, unknown>[]> {
  const settings = globalAgentSettings(pluginContext);
  const providerConfigured = Boolean(activeAgentProviderId(pluginContext));
  return Promise.all(
    agentEngineKinds.map(async (kind) => {
      const definition = engineDefinitions[kind];
      const health = host
        ? hostEngineHealth(await host.engineHealth(kind).catch(() => undefined))
        : {
            available: false,
            healthy: false,
            configured: false,
            authenticated: false,
          };
      const running = health.available && health.healthy;
      const configured =
        kind === "codex"
          ? health.authenticated
          : providerConfigured && health.configured;
      const canRun = running && configured;
      const status = canRun ? "available" : "unavailable";
      return {
        kind,
        name: definition.name,
        role: definition.role,
        version: health.version ?? definition.version,
        status,
        runtimeStatus: running ? "running" : "stopped",
        configurationStatus: configured
          ? "configured"
          : kind === "codex"
            ? "login_required"
            : "missing_credentials",
        invocationStatus: "untested",
        canRun,
        isDefault: settings.defaultEngineKind === kind,
        isBeta: definition.isBeta,
        statusMessage: !running
          ? host
            ? "引擎进程未启动或未通过健康检查"
            : "当前 Runtime 未连接 Desktop Host，本地引擎不可用"
          : !configured
            ? kind === "codex"
              ? "尚未登录 Codex，请在设置中心完成认证"
              : providerConfigured
                ? "已保存智能助手模型，但尚未下发到此引擎"
                : "尚未设定智能助手模型"
            : "引擎已启动，尚未完成实际调用验证",
        capabilities: {
          streaming: true,
          interrupt: true,
          steer: kind === "pi",
          resume: true,
          fork: true,
          compaction: kind === "pi",
          readOnlyMcp: true,
          structuredOutput: true,
          chatGptLogin: kind === "codex",
          apiKeyLogin: true,
        },
      };
    }),
  );
}

/**
 * A provider setting holds only an opaque credential reference.  The Host
 * owns resolving it and must receive the configuration again after every
 * Electron restart; a utilityProcess cannot retain it across launches.
 */
async function restoreActiveAgentProvider(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): Promise<boolean> {
  if (!host) return true;
  const providerId = activeAgentProviderId(pluginContext);
  if (!providerId) return true;
  const provider = findProvider(pluginContext, providerId);
  if (!provider) return true;
  try {
    const result = await host.activateAgentProvider(
      agentProviderConfiguration(provider),
    );
    return result.available;
  } catch {
    return false;
  }
}

async function restoreCodexCustomProvider(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): Promise<boolean> {
  if (!host) return true;
  const setting = codexCustomProviderSetting(pluginContext);
  if (!setting) return true;
  const provider = findProvider(pluginContext, setting.provider_id);
  if (!provider) return true;
  try {
    const result = await host.loginCodex(
      codexCustomProviderLoginInput(provider, setting.protocol),
    );
    return result.status === "authenticated";
  } catch {
    return false;
  }
}

async function restoreSavedAgentConfiguration(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): Promise<void> {
  let providerPending = !(await restoreActiveAgentProvider(
    pluginContext,
    host,
  ));
  let codexPending = !(await restoreCodexCustomProvider(pluginContext, host));
  if (!providerPending && !codexPending) return;

  let restoring = false;
  let attempts = 0;
  const timer = setInterval(() => {
    if (restoring) return;
    restoring = true;
    void (async () => {
      if (providerPending)
        providerPending = !(await restoreActiveAgentProvider(
          pluginContext,
          host,
        ));
      if (codexPending)
        codexPending = !(await restoreCodexCustomProvider(pluginContext, host));
      attempts += 1;
      if ((!providerPending && !codexPending) || attempts >= 30)
        clearInterval(timer);
    })()
      .catch(() => undefined)
      .finally(() => {
        restoring = false;
      });
  }, 500);
  pluginContext.effect(
    () => clearInterval(timer),
    "restore saved agent provider configuration",
  );
}

function problem(
  context: { json(value: unknown, status: number): Response },
  status: number,
  code: string,
  message: string,
): Response {
  return context.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title: message,
      status,
      code,
    },
    status,
  );
}

function entityResponse(
  context: {
    header(name: string, value: string): void;
    json(value: unknown): Response;
  },
  provider: ProviderEntity,
): Response {
  context.header("ETag", `"${provider.version}"`);
  return context.json(provider);
}

function expectedVersion(value: string | undefined): number | undefined {
  if (!value || value.startsWith("W/")) return undefined;
  const normalized = value.trim().replace(/^"|"$/g, "");
  if (!/^\d+$/u.test(normalized)) return undefined;
  const version = Number(normalized);
  return Number.isSafeInteger(version) ? version : undefined;
}

interface AssistantSessionRow {
  id: string;
  engine_session_id: string;
  engine_kind: string;
  project_id: string | null;
  surface: string;
  chapter_id: string | null;
  task_type: string | null;
  title: string | null;
  model_json: string | null;
  status: string;
  archived_at: string | null;
  last_opened_at: string;
  created_at: string;
  updated_at: string;
}

interface AssistantTurnRow {
  id: string;
  session_id: string;
  run_id: string | null;
  user_message: string;
  project_id: string | null;
  chapter_id: string | null;
  selection_json: string | null;
  route_json: string | null;
  status: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface AssistantRunRow {
  id: string;
  session_id: string;
  task_id: string;
  task_type: string;
  engine_kind: string;
  status: string;
  model_json: string | null;
  turn_id: string | null;
  chapter_id: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AssistantItemRow {
  id: string;
  run_id: string;
  sequence: number;
  type: string;
  status: string;
  content: string | null;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}

function jsonValue(value: string | null): unknown | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function assistantSession(row: AssistantSessionRow): Record<string, unknown> {
  const model = modelSelection(jsonValue(row.model_json));
  return {
    id: row.id,
    engineSessionId: row.engine_session_id,
    engineKind: row.engine_kind,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    surface: row.surface,
    ...(row.chapter_id ? { chapterId: row.chapter_id } : {}),
    ...(row.task_type ? { taskType: row.task_type } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(model ? { model } : {}),
    status: row.status,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assistantTurn(row: AssistantTurnRow): Record<string, unknown> {
  const selection = jsonValue(row.selection_json);
  const route = jsonValue(row.route_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    userMessage: row.user_message,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.chapter_id ? { chapterId: row.chapter_id } : {}),
    ...(selection === undefined ? {} : { selection }),
    ...(isRecord(route) ? { route } : {}),
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assistantRun(row: AssistantRunRow): Record<string, unknown> {
  const model = modelSelection(jsonValue(row.model_json));
  return {
    id: row.id,
    sessionId: row.session_id,
    taskId: row.task_id,
    taskType: row.task_type,
    engineKind: row.engine_kind,
    status: row.status,
    ...(model ? { model } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    ...(row.chapter_id ? { chapterId: row.chapter_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assistantItem(row: AssistantItemRow): Record<string, unknown> {
  const payload = jsonValue(row.payload_json);
  return {
    id: row.id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    type: row.type,
    status: row.status,
    ...(row.content ? { content: row.content } : {}),
    ...(payload === undefined ? {} : { payload }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assistantSurface(
  value: unknown,
): "global" | "novel" | "legacy" | undefined {
  return ["global", "novel", "legacy"].includes(String(value))
    ? (value as "global" | "novel" | "legacy")
    : undefined;
}

function assistantTaskType(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-z0-9_]{1,100}$/u.test(value)
    ? value
    : undefined;
}

function assistantMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value.trim();
  return message && message.length <= 200_000 ? message : undefined;
}

function engineResponseText(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value === null || typeof value === "undefined")
    return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const fragments = value
      .map((item) => engineResponseText(item, depth + 1))
      .filter((item): item is string => Boolean(item));
    return fragments.length ? fragments.join("\n") : undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const field of ["text", "content", "output", "response"] as const) {
    const extracted = engineResponseText(value[field], depth + 1);
    if (extracted) return extracted;
  }
  const parts = engineResponseText(value.parts, depth + 1);
  if (parts) return parts;
  const message = isRecord(value.message)
    ? engineResponseText(value.message, depth + 1)
    : undefined;
  return message;
}

function createAgentTaskRunner(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): AgentTaskRunnerService {
  return {
    start: async (input) => {
      if (!host)
        throw new Error(
          "当前 Runtime 未连接 Desktop Host，无法调用本地智能引擎。",
        );
      const health = hostEngineHealth(
        await host.engineHealth(input.engineKind).catch(() => undefined),
      );
      if (!health.available || !health.healthy)
        throw new Error(
          `${engineDefinitions[input.engineKind].name} 引擎当前不可用。`,
        );
      const activeProvider = activeAgentProviderId(pluginContext);
      if (
        (input.engineKind === "codex" && !health.authenticated) ||
        (input.engineKind !== "codex" && !activeProvider)
      )
        throw new Error(
          input.engineKind === "codex"
            ? "请先完成 Codex 认证。"
            : "请先将一项模型服务设为智能助手模型。",
        );
      const model = input.model ? modelSelection(input.model) : undefined;
      if (input.model && !model) throw new Error("模型配置格式无效。");
      if (model?.providerId && model.providerId !== activeProvider)
        throw new Error("所选模型不属于当前启用的智能模型服务商。");
      const sessionId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const taskId = crypto.randomUUID();
      const turnId = crypto.randomUUID();
      const capabilityGrantId = crypto.randomUUID();
      const runtime = createHostAgentRuntime(host, input.engineKind);
      const engineSession = await runtime.createSession({
        sessionId,
        title: input.taskType,
        projectId: input.projectId,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        ...(model ? { model } : {}),
      });
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      pluginContext.uow.execute((transaction) => {
        transaction.run(
          `INSERT INTO agent_assistant_sessions(
            id, engine_session_id, engine_kind, project_id, surface, chapter_id,
            task_type, title, model_json, status, archived_at, last_opened_at,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'novel', ?, ?, ?, ?, 'running', NULL, ?, ?, ?)`,
          sessionId,
          engineSession.engineSessionId,
          input.engineKind,
          input.projectId,
          input.chapterId ?? null,
          input.taskType,
          input.taskType,
          model ? JSON.stringify(model) : null,
          now,
          now,
          now,
        );
        transaction.run(
          `INSERT INTO agent_assistant_turns(
            id, session_id, run_id, user_message, project_id, chapter_id,
            selection_json, route_json, status, error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
          turnId,
          sessionId,
          runId,
          input.prompt,
          input.projectId,
          input.chapterId ?? null,
          input.selection === undefined
            ? null
            : JSON.stringify(input.selection),
          JSON.stringify({
            kind: "task",
            taskType: input.taskType,
            source: "typed-service",
          }),
          now,
          now,
        );
        transaction.run(
          `INSERT INTO agent_assistant_runs(
            id, session_id, task_id, task_type, engine_kind, status, model_json,
            turn_id, chapter_id, error, started_at, completed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, NULL, ?, NULL, ?, ?)`,
          runId,
          sessionId,
          taskId,
          input.taskType,
          input.engineKind,
          model ? JSON.stringify(model) : null,
          turnId,
          input.chapterId ?? null,
          now,
          now,
          now,
        );
        transaction.run(
          `INSERT INTO agent_capability_grants(
            id, run_id, expires_at, consumed_at, capabilities_json, created_at
          ) VALUES (?, ?, ?, NULL, ?, ?)`,
          capabilityGrantId,
          runId,
          expiresAt,
          JSON.stringify(["mcp.readonly"]),
          now,
        );
        transaction.append({
          type: "agents.run-started.v1",
          pluginId: "agents",
          aggregateType: "agent-run",
          aggregateId: runId,
          aggregateVersion: 1,
          payload: { sessionId, runId, taskId, taskType: input.taskType },
        });
      });
      let engineRun;
      try {
        engineRun = await runtime.prompt(
          { sessionId, engineSessionId: engineSession.engineSessionId },
          {
            runId,
            prompt: input.prompt,
            capabilityGrant: {
              endpoint: "",
              token: capabilityGrantId,
              expiresAt,
            },
          },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "智能引擎拒绝了运行。";
        pluginContext.uow.execute((transaction) => {
          const failedAt = new Date().toISOString();
          transaction.run(
            "UPDATE agent_assistant_runs SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
            message,
            failedAt,
            failedAt,
            runId,
          );
          transaction.run(
            "UPDATE agent_assistant_turns SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
            message,
            failedAt,
            turnId,
          );
          transaction.run(
            "UPDATE agent_assistant_sessions SET status = 'failed', updated_at = ? WHERE id = ?",
            failedAt,
            sessionId,
          );
          transaction.run(
            "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
            failedAt,
            capabilityGrantId,
          );
        });
        throw error;
      }
      const finish = async () => {
        let content = "";
        let output: unknown;
        try {
          for await (const event of runtime.subscribe(engineRun)) {
            if (event.type === "content.delta") {
              content = `${content}${event.delta}`.slice(0, 500_000);
              pluginContext.events.publishLive({
                type: "agents.assistant-item-delta.v1",
                payload: { sessionId, runId, delta: event.delta },
              });
            }
            if (event.type === "result") output = event.result;
            if (event.type === "error") throw new Error(event.message);
          }
          const response = engineResponseText(output) ?? content.trim();
          if (!response) throw new Error("智能引擎未返回可验证的文本结果。");
          const itemId = crypto.randomUUID();
          const completedAt = new Date().toISOString();
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              `INSERT INTO agent_assistant_items(
                id, run_id, sequence, type, status, content, payload_json,
                created_at, updated_at
              ) VALUES (?, ?, 1, 'message', 'completed', ?, NULL, ?, ?)`,
              itemId,
              runId,
              response,
              completedAt,
              completedAt,
            );
            transaction.run(
              "UPDATE agent_assistant_runs SET status = 'succeeded', completed_at = ?, updated_at = ? WHERE id = ?",
              completedAt,
              completedAt,
              runId,
            );
            transaction.run(
              "UPDATE agent_assistant_turns SET status = 'succeeded', updated_at = ? WHERE id = ?",
              completedAt,
              turnId,
            );
            transaction.run(
              "UPDATE agent_assistant_sessions SET status = 'idle', updated_at = ?, last_opened_at = ? WHERE id = ?",
              completedAt,
              completedAt,
              sessionId,
            );
            transaction.run(
              "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
              completedAt,
              capabilityGrantId,
            );
            transaction.append({
              type: "agents.run-completed.v1",
              pluginId: "agents",
              aggregateType: "agent-run",
              aggregateId: runId,
              aggregateVersion: 1,
              payload: { sessionId, runId, itemId },
            });
          });
          const descriptor = AGENT_TASK_CATALOG.find(
            (candidate) => candidate.id === input.taskType,
          );
          if (
            descriptor?.writePolicy === "change-preview" &&
            input.chapterId &&
            input.baseVersion !== undefined
          )
            pluginContext.services
              .get<AutomationPreviewService>(AUTOMATION_PREVIEW_SERVICE)
              ?.createChange({
                projectId: input.projectId,
                sessionId,
                runId,
                taskId,
                engineKind: input.engineKind,
                taskType: input.taskType,
                targets: [
                  {
                    kind: "chapter",
                    id: input.chapterId,
                    baseVersion: input.baseVersion,
                    patch: { content: response },
                    displayDiff: { candidate: response },
                  },
                ],
                rationale: "Agent 输出已转换为待人工确认的章节变更预览。",
              });
          pluginContext.events.publishLive({
            type: "agents.run-completed.v1",
            payload: { sessionId, runId, itemId },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "智能引擎运行失败。";
          const failedAt = new Date().toISOString();
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              "UPDATE agent_assistant_runs SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?",
              message,
              failedAt,
              failedAt,
              runId,
            );
            transaction.run(
              "UPDATE agent_assistant_turns SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
              message,
              failedAt,
              turnId,
            );
            transaction.run(
              "UPDATE agent_assistant_sessions SET status = 'failed', updated_at = ? WHERE id = ?",
              failedAt,
              sessionId,
            );
            transaction.run(
              "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
              failedAt,
              capabilityGrantId,
            );
            transaction.append({
              type: "agents.run-failed.v1",
              pluginId: "agents",
              aggregateType: "agent-run",
              aggregateId: runId,
              aggregateVersion: 1,
              payload: { sessionId, runId, error: message },
            });
          });
          pluginContext.events.publishLive({
            type: "agents.run-failed.v1",
            payload: { sessionId, runId, error: message },
          });
        }
      };
      void finish().catch(() => undefined);
      return { taskId, sessionId, runId };
    },
  };
}

function providerRoutes(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): readonly RouteContribution[] {
  const find = (id: string): ProviderEntity | undefined =>
    findProvider(pluginContext, id);
  return [
    {
      id: "agents:engine-list",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-engines", async (context) =>
          context.json(await agentEngineDescriptors(pluginContext, host)),
        ),
    },
    {
      id: "agents:task-catalog-list",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-tasks", (context) =>
          context.json(AGENT_TASK_CATALOG),
        ),
    },
    {
      // The Core Runtime starts before vendor sidecars. Electron invokes this
      // route after they are ready so a persisted provider is applied to the
      // current Host process without putting credential material in Runtime.
      id: "agents:engine-restore-configuration",
      pluginId: "agents",
      install: (app) =>
        app.post(
          "/api/v2/agent-engines/restore-configuration",
          async (context) => {
            await restoreActiveAgentProvider(pluginContext, host);
            return context.body(null, 204);
          },
        ),
    },
    {
      id: "agents:global-engine-settings-get",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-settings", (context) =>
          context.json(globalAgentSettings(pluginContext)),
        ),
    },
    {
      id: "agents:global-engine-settings-update",
      pluginId: "agents",
      install: (app) =>
        app.put("/api/v2/agent-settings", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          const defaultEngineKind =
            isRecord(body) && isAgentEngineKind(body.defaultEngineKind)
              ? body.defaultEngineKind
              : undefined;
          if (!defaultEngineKind)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "请选择有效的全局默认智能引擎。",
            );
          const defaultModel =
            typeof body.defaultModel === "undefined"
              ? undefined
              : modelSelection(body.defaultModel);
          if (typeof body.defaultModel !== "undefined" && !defaultModel)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "全局默认模型配置无效。",
            );
          const updatedAt = new Date().toISOString();
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              `INSERT INTO agent_global_settings(
                 singleton, default_engine_kind, default_model_json, updated_at
               ) VALUES (1, ?, ?, ?)
               ON CONFLICT(singleton) DO UPDATE SET
                 default_engine_kind = excluded.default_engine_kind,
                 default_model_json = excluded.default_model_json,
                 updated_at = excluded.updated_at`,
              defaultEngineKind,
              defaultModel ? JSON.stringify(defaultModel) : null,
              updatedAt,
            );
            transaction.append({
              type: "agents.engine-default-updated.v1",
              pluginId: "agents",
              aggregateType: "engine-settings",
              aggregateId: "global",
              aggregateVersion: 1,
              payload: {
                engineKind: defaultEngineKind,
                action: "global-default-updated",
              },
            });
          });
          return context.json(globalAgentSettings(pluginContext));
        }),
    },
    {
      id: "agents:project-engine-settings-get",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/projects/:id/agent-settings", (context) => {
          const projectId = context.req.param("id");
          const workspace = pluginContext.services.get<WorkspaceProjectService>(
            WORKSPACE_PROJECT_SERVICE,
          );
          return workspace?.get(projectId)
            ? context.json(projectAgentSettings(pluginContext, projectId))
            : problem(context, 404, "NOT_FOUND", "项目不存在。");
        }),
    },
    {
      id: "agents:project-engine-settings-update",
      pluginId: "agents",
      install: (app) =>
        app.put("/api/v2/projects/:id/agent-settings", async (context) => {
          const projectId = context.req.param("id");
          const workspace = pluginContext.services.get<WorkspaceProjectService>(
            WORKSPACE_PROJECT_SERVICE,
          );
          if (!workspace?.get(projectId))
            return problem(context, 404, "NOT_FOUND", "项目不存在。");
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body) || !isAgentEngineKind(body.defaultEngineKind))
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "请选择有效的项目默认智能引擎。",
            );
          const defaultEngineKind = body.defaultEngineKind;
          const defaultModel =
            typeof body.defaultModel === "undefined"
              ? undefined
              : modelSelection(body.defaultModel);
          if (typeof body.defaultModel !== "undefined" && !defaultModel)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "项目默认模型配置无效。",
            );
          if (
            body.assistantMode !== undefined &&
            body.assistantMode !== "simple" &&
            body.assistantMode !== "advanced"
          )
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "请选择有效的智能助手界面模式。",
            );
          const previous = projectAgentSettings(pluginContext, projectId);
          const updatedAt = new Date().toISOString();
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              `INSERT INTO agent_project_settings(
                   project_id, default_engine_kind, default_model_json,
                   assistant_mode, updated_at
                 ) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(project_id) DO UPDATE SET
                   default_engine_kind = excluded.default_engine_kind,
                   default_model_json = excluded.default_model_json,
                   assistant_mode = excluded.assistant_mode,
                   updated_at = excluded.updated_at`,
              projectId,
              defaultEngineKind,
              defaultModel ? JSON.stringify(defaultModel) : null,
              body.assistantMode ?? previous.assistantMode ?? "simple",
              updatedAt,
            );
            transaction.append({
              type: "agents.project-engine-default-updated.v1",
              pluginId: "agents",
              aggregateType: "project-agent-settings",
              aggregateId: projectId,
              aggregateVersion: 1,
              payload: {
                projectId,
                engineKind: defaultEngineKind,
              },
            });
          });
          return context.json(projectAgentSettings(pluginContext, projectId));
        }),
    },
    {
      id: "agents:codex-auth-status",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-engines/codex/auth", async (context) => {
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法读取 Codex 认证状态。",
            );
          try {
            return context.json(await host.codexAuthenticationStatus());
          } catch {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              "无法读取 Codex 认证状态，请重启应用后重试。",
            );
          }
        }),
    },
    {
      id: "agents:codex-login",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-engines/codex/login", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          const mode = isRecord(body) ? codexLoginMode(body.mode) : undefined;
          if (!mode)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "Codex 登录方式无效。",
            );
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法进行 Codex 认证。",
            );
          let input: CodexAuthenticationLoginInput | undefined;
          let customProvider: ProviderEntity | undefined;
          if (mode === "custom_provider") {
            const providerId = isRecord(body)
              ? text(body.providerId)
              : undefined;
            const provider = providerId
              ? findProvider(pluginContext, providerId)
              : undefined;
            if (!provider)
              return problem(
                context,
                404,
                "NOT_FOUND",
                "未找到要连接到 Codex 的模型服务商。",
              );
            try {
              const protocol =
                isRecord(body) && body.protocol === "responses"
                  ? "responses"
                  : "chat_completions";
              input = codexCustomProviderLoginInput(provider, protocol);
              customProvider = provider;
            } catch (error) {
              return problem(
                context,
                400,
                "VALIDATION_ERROR",
                error instanceof Error
                  ? error.message
                  : "Codex 服务商配置无效。",
              );
            }
          } else if (mode === "api_key") {
            const credentialRef = isRecord(body)
              ? text(body.credentialRef)
              : undefined;
            if (!credentialRef)
              return problem(
                context,
                400,
                "VALIDATION_ERROR",
                "Codex 接口密钥未保存到本地凭据库。",
              );
            input = { mode, credentialRef };
          } else input = { mode };
          try {
            const result = await host.loginCodex(input);
            const persistedProvider = input?.provider;
            if (
              result.status === "authenticated" &&
              customProvider &&
              persistedProvider
            ) {
              const providerId = customProvider.id;
              const protocol = persistedProvider.protocol;
              pluginContext.uow.execute((transaction) => {
                const now = new Date().toISOString();
                transaction.run(
                  `INSERT INTO agent_codex_custom_provider_settings(
                     singleton, provider_id, protocol, updated_at
                   ) VALUES (1, ?, ?, ?)
                   ON CONFLICT(singleton) DO UPDATE SET
                     provider_id = excluded.provider_id,
                     protocol = excluded.protocol,
                     updated_at = excluded.updated_at`,
                  providerId,
                  protocol,
                  now,
                );
                transaction.append({
                  type: "agents.codex-custom-provider-configured.v1",
                  pluginId: "agents",
                  aggregateType: "codex-auth-settings",
                  aggregateId: "global",
                  aggregateVersion: 1,
                  payload: {
                    providerId,
                    protocol,
                  },
                });
              });
              return context.json({
                ...result,
                message: "已连接兼容服务商；重启后会自动恢复此 Codex 配置。",
              });
            }
            return context.json(result);
          } catch {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              "Codex 登录未完成，请检查认证后重试。",
            );
          }
        }),
    },
    {
      id: "agents:codex-logout",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-engines/codex/logout", async (context) => {
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法退出 Codex。",
            );
          try {
            const result = await host.logoutCodex();
            pluginContext.uow.execute((transaction) => {
              transaction.run(
                "DELETE FROM agent_codex_custom_provider_settings WHERE singleton = 1",
              );
              transaction.append({
                type: "agents.codex-custom-provider-cleared.v1",
                pluginId: "agents",
                aggregateType: "codex-auth-settings",
                aggregateId: "global",
                aggregateVersion: 1,
                payload: { action: "logout" },
              });
            });
            return context.json(result);
          } catch {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              "Codex 退出失败，请重启应用后重试。",
            );
          }
        }),
    },
    {
      id: "agents:providers-list",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/providers", (context) => {
          if (context.req.query("projectId") || context.req.query("parentId"))
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "模型服务商不属于项目或父级资源。",
            );
          const providers = pluginContext.uow.execute((transaction) =>
            transaction
              .all<ProviderRow>(
                `SELECT id, title, payload_json, version, created_at, updated_at
                 FROM agent_provider_configurations
                 ORDER BY updated_at DESC, id`,
              )
              .map(providerEntity),
          );
          return context.json(providers);
        }),
    },
    {
      id: "agents:providers-create",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/providers", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body))
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "模型服务商配置无效。",
            );
          const title = typeof body.title === "string" ? body.title.trim() : "";
          const payload = parsePayload(body.payload ?? {});
          if (!title || title.length > 200 || !payload)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "请提供有效的服务商名称和配置；接口密钥只能保存在本地凭据库。",
            );
          const provider = pluginContext.uow.execute((transaction) => {
            const id = crypto.randomUUID();
            const now = new Date().toISOString();
            const created: ProviderEntity = {
              id,
              domain: "providers",
              title,
              payload,
              version: 0,
              createdAt: now,
              updatedAt: now,
            };
            transaction.run(
              `INSERT INTO agent_provider_configurations(
                id, title, payload_json, version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?)`,
              id,
              title,
              JSON.stringify(payload),
              0,
              now,
              now,
            );
            transaction.append({
              type: "agents.provider-configured.v1",
              pluginId: "agents",
              aggregateType: "provider",
              aggregateId: id,
              aggregateVersion: 0,
              payload: { providerId: id, action: "created" },
            });
            return created;
          });
          return entityResponse(context, provider);
        }),
    },
    {
      id: "agents:providers-get",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/providers/:id", (context) => {
          const provider = find(context.req.param("id"));
          return provider
            ? entityResponse(context, provider)
            : problem(context, 404, "NOT_FOUND", "未找到模型服务商。");
        }),
    },
    {
      id: "agents:providers-update",
      pluginId: "agents",
      install: (app) =>
        app.patch("/api/v2/providers/:id", async (context) => {
          const version = expectedVersion(context.req.header("If-Match"));
          if (version === undefined)
            return problem(
              context,
              428,
              "PRECONDITION_REQUIRED",
              "更新模型服务商必须提供 If-Match 版本。",
            );
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body))
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "模型服务商配置无效。",
            );
          if (typeof body.version !== "number" || body.version !== version)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "请求中的版本与 If-Match 不一致。",
            );
          const title =
            typeof body.title === "undefined"
              ? undefined
              : typeof body.title === "string" &&
                  body.title.trim().length <= 200
                ? body.title.trim()
                : undefined;
          const payload =
            typeof body.payload === "undefined"
              ? undefined
              : parsePayload(body.payload);
          if (
            (typeof body.title !== "undefined" && !title) ||
            (!payload && typeof body.payload !== "undefined")
          )
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "模型服务商配置无效；接口密钥只能保存在本地凭据库。",
            );
          const result = pluginContext.uow.execute((transaction) => {
            const row = transaction.get<ProviderRow>(
              `SELECT id, title, payload_json, version, created_at, updated_at
               FROM agent_provider_configurations WHERE id = ?`,
              context.req.param("id"),
            );
            if (!row) return { kind: "missing" as const };
            const current = providerEntity(row);
            if (current.version !== version)
              return { kind: "conflict" as const };
            const now = new Date().toISOString();
            const updated: ProviderEntity = {
              ...current,
              ...(title ? { title } : {}),
              ...(payload ? { payload } : {}),
              version: current.version + 1,
              updatedAt: now,
            };
            transaction.run(
              `UPDATE agent_provider_configurations
               SET title = ?, payload_json = ?, version = ?, updated_at = ?
               WHERE id = ?`,
              updated.title,
              JSON.stringify(updated.payload),
              updated.version,
              now,
              updated.id,
            );
            transaction.append({
              type: "agents.provider-configured.v1",
              pluginId: "agents",
              aggregateType: "provider",
              aggregateId: updated.id,
              aggregateVersion: updated.version,
              payload: { providerId: updated.id, action: "updated" },
            });
            return { kind: "updated" as const, provider: updated };
          });
          if (result.kind === "missing")
            return problem(context, 404, "NOT_FOUND", "未找到模型服务商。");
          if (result.kind === "conflict")
            return problem(
              context,
              412,
              "PRECONDITION_FAILED",
              "模型服务商已被其他操作修改，请刷新后重试。",
            );
          return entityResponse(context, result.provider);
        }),
    },
    {
      id: "agents:providers-delete",
      pluginId: "agents",
      install: (app) =>
        app.delete("/api/v2/providers/:id", (context) => {
          const result = pluginContext.uow.execute((transaction) => {
            const row = transaction.get<ProviderRow>(
              "SELECT id, version FROM agent_provider_configurations WHERE id = ?",
              context.req.param("id"),
            ) as Pick<ProviderRow, "id" | "version"> | undefined;
            if (!row) return false;
            transaction.run(
              "DELETE FROM agent_provider_settings WHERE provider_id = ?",
              row.id,
            );
            transaction.run(
              "DELETE FROM agent_codex_custom_provider_settings WHERE provider_id = ?",
              row.id,
            );
            transaction.run(
              "DELETE FROM agent_provider_configurations WHERE id = ?",
              row.id,
            );
            transaction.append({
              type: "agents.provider-deleted.v1",
              pluginId: "agents",
              aggregateType: "provider",
              aggregateId: row.id,
              aggregateVersion: Number(row.version) + 1,
              payload: { providerId: row.id, action: "deleted" },
            });
            return true;
          });
          return result
            ? context.body(null, 204)
            : problem(context, 404, "NOT_FOUND", "未找到模型服务商。");
        }),
    },
    {
      id: "agents:providers-activate-for-agent",
      pluginId: "agents",
      install: (app) =>
        app.post(
          "/api/v2/providers/:id/activate-for-agent",
          async (context) => {
            const provider = find(context.req.param("id"));
            if (!provider)
              return problem(context, 404, "NOT_FOUND", "未找到模型服务商。");
            let configuration: AgentProviderActivationInput;
            try {
              configuration = agentProviderConfiguration(provider);
            } catch (error) {
              return problem(
                context,
                400,
                "VALIDATION_ERROR",
                error instanceof Error ? error.message : "模型服务商配置无效。",
              );
            }
            if (!host)
              return problem(
                context,
                503,
                "CAPABILITY_UNAVAILABLE",
                "当前 Runtime 没有可用的 Desktop Host，无法配置本地智能助手引擎。",
              );
            let engine: { available: boolean; message?: string };
            try {
              engine = await host.activateAgentProvider(configuration);
            } catch {
              return problem(
                context,
                503,
                "ENGINE_UNAVAILABLE",
                "Desktop Host 无法配置智能助手引擎，请检查本地引擎状态后重试。",
              );
            }
            if (!engine.available)
              return problem(
                context,
                503,
                "ENGINE_UNAVAILABLE",
                engine.message ?? "智能助手引擎当前不可用。",
              );
            const activatedAt = new Date().toISOString();
            pluginContext.uow.execute((transaction) => {
              transaction.run(
                `INSERT INTO agent_provider_settings(singleton, provider_id, updated_at)
               VALUES (1, ?, ?)
               ON CONFLICT(singleton) DO UPDATE SET
                 provider_id = excluded.provider_id,
                 updated_at = excluded.updated_at`,
                provider.id,
                activatedAt,
              );
              transaction.append({
                type: "agents.provider-activated.v1",
                pluginId: "agents",
                aggregateType: "provider",
                aggregateId: provider.id,
                aggregateVersion: provider.version,
                payload: { providerId: provider.id, action: "activated" },
              });
            });
            return context.json({
              providerId: provider.id,
              engineAvailable: true,
              providerKind: configuration.providerKind,
              model: configuration.model,
              activatedAt,
              message: "已设为智能助手模型。",
            });
          },
        ),
    },
    {
      id: "agents:providers-test-connection",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/providers/:id/test-connection", async (context) => {
          const provider = find(context.req.param("id"));
          if (!provider)
            return problem(context, 404, "NOT_FOUND", "未找到模型服务商。");
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法安全解析凭据并测试连接。",
            );
          let configuration: AgentProviderActivationInput;
          try {
            configuration = agentProviderConfiguration(provider);
          } catch (error) {
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              error instanceof Error ? error.message : "模型服务商配置无效。",
            );
          }
          const checkedAt = new Date().toISOString();
          try {
            const result = await host.activateAgentProvider(configuration);
            return context.json({
              providerId: provider.id,
              ok: result.available,
              checkedAt,
              models: result.available ? [configuration.model] : [],
              message:
                result.message ??
                (result.available ? "连接测试成功。" : "连接测试未通过。"),
            });
          } catch {
            return context.json({
              providerId: provider.id,
              ok: false,
              checkedAt,
              models: [],
              message: "连接测试失败，请检查服务地址、模型和凭据。",
            });
          }
        }),
    },
  ];
}

function assistantConversationRoutes(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): readonly RouteContribution[] {
  const find = (id: string): AssistantSessionRow | undefined =>
    pluginContext.uow.execute((transaction) =>
      transaction.get<AssistantSessionRow>(
        `SELECT id, engine_session_id, engine_kind, project_id, surface,
                chapter_id, task_type, title, model_json, status, archived_at,
                last_opened_at, created_at, updated_at
         FROM agent_assistant_sessions WHERE id = ?`,
        id,
      ),
    );
  return [
    {
      id: "agents:assistant-conversations-list",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/assistant-conversations", (context) => {
          const surface = context.req.query("surface");
          const projectId = context.req.query("projectId");
          const archived = context.req.query("archived") === "true";
          const conversations = pluginContext.uow.execute((transaction) =>
            transaction
              .all<AssistantSessionRow>(
                `SELECT id, engine_session_id, engine_kind, project_id, surface,
                        chapter_id, task_type, title, model_json, status, archived_at,
                        last_opened_at, created_at, updated_at
                 FROM agent_assistant_sessions
                 WHERE (${archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"})
                   AND (? IS NULL OR surface = ?)
                   AND (? IS NULL OR project_id = ?)
                 ORDER BY last_opened_at DESC, id DESC`,
                surface ?? null,
                surface ?? null,
                projectId ?? null,
                projectId ?? null,
              )
              .map(assistantSession),
          );
          return context.json(conversations);
        }),
    },
    {
      id: "agents:assistant-conversations-create",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/assistant-conversations", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body))
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "智能会话配置无效。",
            );
          const surface = assistantSurface(body.surface) ?? "global";
          const projectId = text(body.projectId);
          const chapterId = text(body.chapterId);
          if (surface !== "global" && !projectId)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "此智能会话必须绑定项目。",
            );
          const kind = isAgentEngineKind(body.engineKind)
            ? body.engineKind
            : globalAgentSettings(pluginContext).defaultEngineKind;
          const model =
            typeof body.model === "undefined"
              ? undefined
              : modelSelection(body.model);
          if (typeof body.model !== "undefined" && !model)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "模型配置格式无效。",
            );
          const activeProvider = activeAgentProviderId(pluginContext);
          if (model?.providerId && model.providerId !== activeProvider)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "所选模型不属于当前启用的智能模型服务商。",
            );
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法创建本地智能会话。",
            );
          const health = hostEngineHealth(
            await host.engineHealth(kind).catch(() => undefined),
          );
          if (!health.available || !health.healthy)
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              `${engineDefinitions[kind].name} 引擎当前不可用。`,
            );
          if (
            (kind === "codex" && !health.authenticated) ||
            (kind !== "codex" && !activeProvider)
          )
            return problem(
              context,
              409,
              "CONFLICT",
              kind === "codex"
                ? "请先在设置中心完成 Codex 认证。"
                : "请先将一项智能模型设为智能助手模型。",
            );
          const title = text(body.title)?.slice(0, 200) ?? "新对话";
          const conversationId = crypto.randomUUID();
          let engineSession: { engineSessionId: string };
          try {
            engineSession = await createHostAgentRuntime(
              host,
              kind,
            ).createSession({
              sessionId: conversationId,
              title,
              ...(projectId ? { projectId } : {}),
              ...(chapterId ? { chapterId } : {}),
              ...(model ? { model } : {}),
            });
          } catch {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              "智能引擎无法创建会话，请检查引擎状态后重试。",
            );
          }
          const conversation = pluginContext.uow.execute((transaction) => {
            const id = conversationId;
            const now = new Date().toISOString();
            transaction.run(
              `INSERT INTO agent_assistant_sessions(
                id, engine_session_id, engine_kind, project_id, surface, chapter_id,
                task_type, title, model_json, status, archived_at, last_opened_at,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, ?, ?)`,
              id,
              engineSession.engineSessionId,
              kind,
              projectId ?? null,
              surface,
              chapterId ?? null,
              assistantTaskType(body.taskType) ?? null,
              title,
              model ? JSON.stringify(model) : null,
              now,
              now,
              now,
            );
            transaction.append({
              type: "agents.assistant-session-created.v1",
              pluginId: "agents",
              aggregateType: "assistant-session",
              aggregateId: id,
              aggregateVersion: 1,
              payload: { sessionId: id, engineKind: kind },
            });
            return assistantSession(
              transaction.get<AssistantSessionRow>(
                `SELECT id, engine_session_id, engine_kind, project_id, surface,
                        chapter_id, task_type, title, model_json, status, archived_at,
                        last_opened_at, created_at, updated_at
                 FROM agent_assistant_sessions WHERE id = ?`,
                id,
              )!,
            );
          });
          return context.json(conversation, 201);
        }),
    },
    {
      id: "agents:assistant-conversations-get",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/assistant-conversations/:id", (context) => {
          const session = find(context.req.param("id"));
          if (!session)
            return problem(context, 404, "NOT_FOUND", "未找到智能会话。");
          const detail = pluginContext.uow.execute((transaction) => ({
            conversation: assistantSession(session),
            turns: transaction
              .all<AssistantTurnRow>(
                `SELECT id, session_id, run_id, user_message, project_id, chapter_id,
                        selection_json, route_json, status, error, created_at, updated_at
                 FROM agent_assistant_turns WHERE session_id = ?
                 ORDER BY created_at, id`,
                session.id,
              )
              .map(assistantTurn),
            runs: transaction
              .all<AssistantRunRow>(
                `SELECT id, session_id, task_id, task_type, engine_kind, status,
                        model_json, turn_id, chapter_id, error, started_at, completed_at,
                        created_at, updated_at
                 FROM agent_assistant_runs WHERE session_id = ? ORDER BY created_at, id`,
                session.id,
              )
              .map(assistantRun),
            items: transaction
              .all<AssistantItemRow>(
                `SELECT item.id, item.run_id, item.sequence, item.type, item.status,
                        item.content, item.payload_json, item.created_at, item.updated_at
                 FROM agent_assistant_items item
                 JOIN agent_assistant_runs run ON run.id = item.run_id
                 WHERE run.session_id = ? ORDER BY run.created_at, item.sequence, item.id`,
                session.id,
              )
              .map(assistantItem),
            changePreviews: [],
            providerActionPreviews: [],
          }));
          return context.json(detail);
        }),
    },
    {
      id: "agents:assistant-conversations-update",
      pluginId: "agents",
      install: (app) =>
        app.patch("/api/v2/assistant-conversations/:id", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body))
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "智能会话更新无效。",
            );
          const session = find(context.req.param("id"));
          if (!session)
            return problem(context, 404, "NOT_FOUND", "未找到智能会话。");
          const title =
            typeof body.title === "string"
              ? text(body.title)?.slice(0, 200)
              : undefined;
          if (typeof body.title !== "undefined" && !title)
            return problem(context, 400, "VALIDATION_ERROR", "会话标题无效。");
          if (
            typeof body.archived !== "undefined" &&
            typeof body.archived !== "boolean"
          )
            return problem(context, 400, "VALIDATION_ERROR", "归档状态无效。");
          const updated = pluginContext.uow.execute((transaction) => {
            const now = new Date().toISOString();
            transaction.run(
              `UPDATE agent_assistant_sessions
               SET title = ?, archived_at = ?, updated_at = ? WHERE id = ?`,
              title ?? session.title,
              body.archived === true
                ? now
                : body.archived === false
                  ? null
                  : session.archived_at,
              now,
              session.id,
            );
            transaction.append({
              type: "agents.assistant-session-updated.v1",
              pluginId: "agents",
              aggregateType: "assistant-session",
              aggregateId: session.id,
              aggregateVersion: 1,
              payload: { sessionId: session.id },
            });
            return assistantSession(
              transaction.get<AssistantSessionRow>(
                `SELECT id, engine_session_id, engine_kind, project_id, surface,
                        chapter_id, task_type, title, model_json, status, archived_at,
                        last_opened_at, created_at, updated_at
                 FROM agent_assistant_sessions WHERE id = ?`,
                session.id,
              )!,
            );
          });
          return context.json(updated);
        }),
    },
    {
      id: "agents:assistant-conversations-bind-project",
      pluginId: "agents",
      install: (app) =>
        app.post(
          "/api/v2/assistant-conversations/:id/bind-project",
          async (context) => {
            const body = await context.req.json().catch(() => undefined);
            const projectId = isRecord(body) ? text(body.projectId) : undefined;
            if (!projectId)
              return problem(
                context,
                400,
                "VALIDATION_ERROR",
                "项目编号无效。",
              );
            const session = find(context.req.param("id"));
            if (!session)
              return problem(context, 404, "NOT_FOUND", "未找到智能会话。");
            const updated = pluginContext.uow.execute((transaction) => {
              const now = new Date().toISOString();
              transaction.run(
                `UPDATE agent_assistant_sessions
                 SET project_id = ?, updated_at = ?, last_opened_at = ? WHERE id = ?`,
                projectId,
                now,
                now,
                session.id,
              );
              transaction.append({
                type: "agents.assistant-session-project-bound.v1",
                pluginId: "agents",
                aggregateType: "assistant-session",
                aggregateId: session.id,
                aggregateVersion: 1,
                payload: { sessionId: session.id, projectId },
              });
              return assistantSession(
                transaction.get<AssistantSessionRow>(
                  `SELECT id, engine_session_id, engine_kind, project_id, surface,
                          chapter_id, task_type, title, model_json, status, archived_at,
                          last_opened_at, created_at, updated_at
                   FROM agent_assistant_sessions WHERE id = ?`,
                  session.id,
                )!,
              );
            });
            return context.json(updated);
          },
        ),
    },
    {
      id: "agents:assistant-conversations-send-message",
      pluginId: "agents",
      install: (app) =>
        app.post(
          "/api/v2/assistant-conversations/:id/messages",
          async (context) => {
            const body = await context.req.json().catch(() => undefined);
            const message = isRecord(body)
              ? assistantMessage(body.message)
              : undefined;
            if (!message)
              return problem(
                context,
                400,
                "VALIDATION_ERROR",
                "消息内容不能为空或过长。",
              );
            const session = find(context.req.param("id"));
            if (!session || session.archived_at)
              return problem(
                context,
                404,
                "NOT_FOUND",
                "未找到可用的智能会话。",
              );
            if (!host)
              return problem(
                context,
                503,
                "CAPABILITY_UNAVAILABLE",
                "当前 Runtime 未连接 Desktop Host，无法调用本地智能引擎。",
              );
            if (session.engine_kind === "codex") {
              const health = hostEngineHealth(
                await host.engineHealth("codex").catch(() => undefined),
              );
              if (!health.available || !health.healthy)
                return problem(
                  context,
                  503,
                  "ENGINE_UNAVAILABLE",
                  "Codex 引擎当前不可用。",
                );
              if (!health.authenticated)
                return problem(
                  context,
                  409,
                  "CONFLICT",
                  "请先在设置中心完成 Codex 认证。",
                );
            }
            const activeRun = pluginContext.uow.execute((transaction) =>
              transaction.get<{ id: string }>(
                `SELECT id FROM agent_assistant_runs
                 WHERE session_id = ? AND status IN ('queued', 'running')
                 LIMIT 1`,
                session.id,
              ),
            );
            if (activeRun)
              return problem(
                context,
                409,
                "CONFLICT",
                "当前对话已有正在执行的智能任务，请等待完成或先停止运行。",
              );
            const taskType =
              (isRecord(body) && assistantTaskType(body.taskType)) ??
              "chat_project";
            const route = {
              kind: "chat",
              taskType,
              confidence: 1,
              source: "deterministic",
              explanation: session.project_id
                ? "已将消息交由当前项目的智能会话处理。"
                : "未绑定项目，按通用聊天处理。",
            };
            const started = pluginContext.uow.execute((transaction) => {
              const now = new Date().toISOString();
              const turnId = crypto.randomUUID();
              const runId = crypto.randomUUID();
              const capabilityGrantId = crypto.randomUUID();
              const capabilityGrantExpiresAt = new Date(
                Date.now() + 5 * 60_000,
              ).toISOString();
              transaction.run(
                `INSERT INTO agent_assistant_turns(
                  id, session_id, run_id, user_message, project_id, chapter_id,
                  selection_json, route_json, status, error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
                turnId,
                session.id,
                runId,
                message,
                session.project_id,
                session.chapter_id,
                isRecord(body) && typeof body.selection !== "undefined"
                  ? JSON.stringify(body.selection)
                  : null,
                JSON.stringify(route),
                now,
                now,
              );
              transaction.run(
                `INSERT INTO agent_assistant_runs(
                  id, session_id, task_id, task_type, engine_kind, status, model_json,
                  turn_id, chapter_id, error, started_at, completed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, NULL, ?, NULL, ?, ?)`,
                runId,
                session.id,
                crypto.randomUUID(),
                taskType,
                session.engine_kind,
                session.model_json,
                turnId,
                session.chapter_id,
                now,
                now,
                now,
              );
              transaction.run(
                `INSERT INTO agent_capability_grants(
                  id, run_id, expires_at, consumed_at, capabilities_json, created_at
                ) VALUES (?, ?, ?, NULL, ?, ?)`,
                capabilityGrantId,
                runId,
                capabilityGrantExpiresAt,
                JSON.stringify(["mcp.readonly"]),
                now,
              );
              transaction.run(
                `UPDATE agent_assistant_sessions
                 SET status = 'running', last_opened_at = ?, updated_at = ? WHERE id = ?`,
                now,
                now,
                session.id,
              );
              transaction.append({
                type: "agents.assistant-turn-started.v1",
                pluginId: "agents",
                aggregateType: "assistant-turn",
                aggregateId: turnId,
                aggregateVersion: 1,
                payload: { sessionId: session.id, turnId, runId },
              });
              return {
                conversation: assistantSession(
                  transaction.get<AssistantSessionRow>(
                    `SELECT id, engine_session_id, engine_kind, project_id, surface,
                            chapter_id, task_type, title, model_json, status, archived_at,
                            last_opened_at, created_at, updated_at
                     FROM agent_assistant_sessions WHERE id = ?`,
                    session.id,
                  )!,
                ),
                turn: assistantTurn(
                  transaction.get<AssistantTurnRow>(
                    `SELECT id, session_id, run_id, user_message, project_id, chapter_id,
                            selection_json, route_json, status, error, created_at, updated_at
                     FROM agent_assistant_turns WHERE id = ?`,
                    turnId,
                  )!,
                ),
                run: assistantRun(
                  transaction.get<AssistantRunRow>(
                    `SELECT id, session_id, task_id, task_type, engine_kind, status,
                            model_json, turn_id, chapter_id, error, started_at, completed_at,
                            created_at, updated_at FROM agent_assistant_runs WHERE id = ?`,
                    runId,
                  )!,
                ),
                turnId,
                runId,
                capabilityGrant: {
                  // Pi resolves the private Runtime MCP endpoint retained by
                  // the Host; only this short-lived opaque token crosses the
                  // Host boundary.
                  endpoint: "",
                  token: capabilityGrantId,
                  expiresAt: capabilityGrantExpiresAt,
                },
              };
            });
            const completeRun = async () => {
              let streamedItemId: string | undefined;
              let streamedContent = "";
              const recordDelta = (delta: string) => {
                if (!delta) return;
                const emitted = pluginContext.uow.execute((transaction) => {
                  const now = new Date().toISOString();
                  if (!streamedItemId) {
                    streamedItemId = crypto.randomUUID();
                    streamedContent = delta.slice(0, 500_000);
                    transaction.run(
                      `INSERT INTO agent_assistant_items(
                        id, run_id, sequence, type, status, content, payload_json,
                        created_at, updated_at
                      ) VALUES (?, ?, 1, 'message', 'streaming', ?, NULL, ?, ?)`,
                      streamedItemId,
                      started.runId,
                      streamedContent,
                      now,
                      now,
                    );
                    return { itemId: streamedItemId, now, started: true };
                  }
                  streamedContent = `${streamedContent}${delta}`.slice(
                    0,
                    500_000,
                  );
                  transaction.run(
                    `UPDATE agent_assistant_items
                     SET content = ?, updated_at = ? WHERE id = ?`,
                    streamedContent,
                    now,
                    streamedItemId,
                  );
                  return { itemId: streamedItemId, now, started: false };
                });
                pluginContext.events.publishLive({
                  type: emitted.started
                    ? "agents.assistant-item-started.v1"
                    : "agents.assistant-item-delta.v1",
                  payload: {
                    sessionId: session.id,
                    runId: started.runId,
                    itemId: emitted.itemId,
                    ...(emitted.started ? { sequence: 1 } : {}),
                    ...(emitted.started
                      ? { content: streamedContent }
                      : { delta }),
                    status: "streaming",
                    occurredAt: emitted.now,
                  },
                });
              };
              try {
                const runtime = createHostAgentRuntime(
                  host,
                  session.engine_kind as AgentEngineKind,
                );
                const engineSession = {
                  sessionId: session.id,
                  engineSessionId: session.engine_session_id,
                };
                const engineRun = await runtime.prompt(engineSession, {
                  runId: started.runId,
                  prompt: session.project_id
                    ? message
                    : [
                        "你是 DramaIP 的中文创作智能助手。",
                        "当前未绑定项目，只能进行通用问答；不得声称读取了项目、文件或工具。",
                        "请使用简体中文直接回答，不要展示隐藏思维过程。",
                        `用户消息：${message}`,
                      ].join("\n"),
                  capabilityGrant: started.capabilityGrant,
                });
                let output: unknown;
                for await (const event of runtime.subscribe(engineRun)) {
                  if (event.type === "content.delta") recordDelta(event.delta);
                  if (event.type === "result") output = event.result;
                  if (event.type === "error") throw new Error(event.message);
                }
                const response =
                  engineResponseText(output) ?? streamedContent.trim();
                if (!response)
                  throw new Error("智能引擎未返回可显示的文本结果");
                const completed = pluginContext.uow.execute((transaction) => {
                  const now = new Date().toISOString();
                  transaction.run(
                    `UPDATE agent_assistant_turns SET status = 'succeeded', updated_at = ? WHERE id = ?`,
                    now,
                    started.turnId,
                  );
                  transaction.run(
                    `UPDATE agent_assistant_runs
                   SET status = 'succeeded', completed_at = ?, updated_at = ? WHERE id = ?`,
                    now,
                    now,
                    started.runId,
                  );
                  const itemId = streamedItemId ?? crypto.randomUUID();
                  if (streamedItemId)
                    transaction.run(
                      `UPDATE agent_assistant_items
                       SET status = 'completed', content = ?, updated_at = ?
                       WHERE id = ?`,
                      response.slice(0, 500_000),
                      now,
                      itemId,
                    );
                  else
                    transaction.run(
                      `INSERT INTO agent_assistant_items(
                        id, run_id, sequence, type, status, content, payload_json,
                        created_at, updated_at
                      ) VALUES (?, ?, 1, 'message', 'completed', ?, NULL, ?, ?)`,
                      itemId,
                      started.runId,
                      response.slice(0, 500_000),
                      now,
                      now,
                    );
                  transaction.run(
                    `UPDATE agent_assistant_sessions
                   SET status = 'idle', last_opened_at = ?, updated_at = ? WHERE id = ?`,
                    now,
                    now,
                    session.id,
                  );
                  transaction.run(
                    "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
                    now,
                    started.capabilityGrant.token,
                  );
                  transaction.append({
                    type: "agents.assistant-run-completed.v1",
                    pluginId: "agents",
                    aggregateType: "assistant-run",
                    aggregateId: started.runId,
                    aggregateVersion: 1,
                    payload: { sessionId: session.id, runId: started.runId },
                  });
                  return { itemId, now };
                });
                pluginContext.events.publishLive({
                  type: "agents.assistant-item-completed.v1",
                  payload: {
                    sessionId: session.id,
                    runId: started.runId,
                    itemId: completed.itemId,
                    content: response.slice(0, 500_000),
                    status: "completed",
                    occurredAt: completed.now,
                  },
                });
                pluginContext.events.publishLive({
                  type: "agents.assistant-run-completed.v1",
                  payload: { sessionId: session.id, runId: started.runId },
                });
              } catch {
                const failed = pluginContext.uow.execute((transaction) => {
                  const now = new Date().toISOString();
                  const error =
                    "智能引擎调用失败，请检查模型配置和引擎状态后重试。";
                  transaction.run(
                    `UPDATE agent_assistant_turns SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
                    error,
                    now,
                    started.turnId,
                  );
                  transaction.run(
                    `UPDATE agent_assistant_runs
                   SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
                    error,
                    now,
                    now,
                    started.runId,
                  );
                  transaction.run(
                    `UPDATE agent_assistant_sessions SET status = 'failed', updated_at = ? WHERE id = ?`,
                    now,
                    session.id,
                  );
                  if (streamedItemId)
                    transaction.run(
                      `UPDATE agent_assistant_items
                       SET status = 'failed', updated_at = ? WHERE id = ?`,
                      now,
                      streamedItemId,
                    );
                  transaction.run(
                    "UPDATE agent_capability_grants SET consumed_at = ? WHERE id = ?",
                    now,
                    started.capabilityGrant.token,
                  );
                  transaction.append({
                    type: "agents.assistant-run-failed.v1",
                    pluginId: "agents",
                    aggregateType: "assistant-run",
                    aggregateId: started.runId,
                    aggregateVersion: 1,
                    payload: { sessionId: session.id, runId: started.runId },
                  });
                  return { now };
                });
                if (streamedItemId)
                  pluginContext.events.publishLive({
                    type: "agents.assistant-item-failed.v1",
                    payload: {
                      sessionId: session.id,
                      runId: started.runId,
                      itemId: streamedItemId,
                      content: streamedContent,
                      status: "failed",
                      occurredAt: failed.now,
                    },
                  });
                pluginContext.events.publishLive({
                  type: "agents.assistant-run-failed.v1",
                  payload: { sessionId: session.id, runId: started.runId },
                });
              }
            };
            void completeRun().catch(() => undefined);
            return context.json({
              conversation: started.conversation,
              turn: started.turn,
              run: started.run,
            });
          },
        ),
    },
    {
      id: "agents:assistant-conversations-delete",
      pluginId: "agents",
      install: (app) =>
        app.delete("/api/v2/assistant-conversations/:id", (context) => {
          const session = find(context.req.param("id"));
          if (!session)
            return problem(context, 404, "NOT_FOUND", "未找到智能会话。");
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              `DELETE FROM agent_assistant_items WHERE run_id IN (
                 SELECT id FROM agent_assistant_runs WHERE session_id = ?
               )`,
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_runs WHERE session_id = ?",
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_turns WHERE session_id = ?",
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_sessions WHERE id = ?",
              session.id,
            );
            transaction.append({
              type: "agents.assistant-session-deleted.v1",
              pluginId: "agents",
              aggregateType: "assistant-session",
              aggregateId: session.id,
              aggregateVersion: 1,
              payload: { sessionId: session.id },
            });
          });
          return context.body(null, 204);
        }),
    },
  ];
}

function typedAgentSessionRoutes(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): readonly RouteContribution[] {
  const findSession = (id: string): AssistantSessionRow | undefined =>
    pluginContext.uow.execute((transaction) =>
      transaction.get<AssistantSessionRow>(
        `SELECT id, engine_session_id, engine_kind, project_id, surface,
                chapter_id, task_type, title, model_json, status, archived_at,
                last_opened_at, created_at, updated_at
         FROM agent_assistant_sessions WHERE id = ?`,
        id,
      ),
    );
  const findRun = (id: string): AssistantRunRow | undefined =>
    pluginContext.uow.execute((transaction) =>
      transaction.get<AssistantRunRow>(
        `SELECT id, session_id, task_id, task_type, engine_kind, status,
                model_json, turn_id, chapter_id, error, started_at, completed_at,
                created_at, updated_at
         FROM agent_assistant_runs WHERE id = ?`,
        id,
      ),
    );
  const forwardAssistant = async (
    app: { fetch(request: Request): Response | Promise<Response> },
    context: {
      req: { url: string; header(name: string): string | undefined };
    },
    path: string,
    body: unknown,
  ): Promise<Response> => {
    const url = new URL(context.req.url);
    url.pathname = path;
    url.search = "";
    const headers = new Headers({ "Content-Type": "application/json" });
    for (const name of ["Authorization", "Idempotency-Key"]) {
      const value = context.req.header(name);
      if (value) headers.set(name, value);
    }
    return app.fetch(
      new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  };
  const stopRun = async (
    run: AssistantRunRow,
    status: "interrupted" | "canceled",
  ): Promise<Record<string, unknown>> => {
    const session = findSession(run.session_id);
    if (!session)
      throw new Error("Agent session disappeared while stopping its run.");
    if (!host)
      throw new Error(
        "当前 Runtime 未连接 Desktop Host，无法停止本地智能引擎。",
      );
    const runtime = createHostAgentRuntime(
      host,
      session.engine_kind as AgentEngineKind,
    );
    await runtime.abort({ runId: run.id });
    return pluginContext.uow.execute((transaction) => {
      const now = new Date().toISOString();
      transaction.run(
        `UPDATE agent_assistant_runs
         SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
        status,
        now,
        now,
        run.id,
      );
      transaction.run(
        `UPDATE agent_assistant_turns SET status = ?, updated_at = ? WHERE run_id = ?`,
        status,
        now,
        run.id,
      );
      transaction.run(
        `UPDATE agent_assistant_sessions
         SET status = 'idle', updated_at = ?, last_opened_at = ? WHERE id = ?`,
        now,
        now,
        session.id,
      );
      transaction.run(
        "UPDATE agent_capability_grants SET consumed_at = COALESCE(consumed_at, ?) WHERE run_id = ?",
        now,
        run.id,
      );
      transaction.append({
        type: "agents.run-interrupted.v1",
        pluginId: "agents",
        aggregateType: "agent-run",
        aggregateId: run.id,
        aggregateVersion: 1,
        payload: { sessionId: session.id, runId: run.id, status },
      });
      return assistantRun(
        transaction.get<AssistantRunRow>(
          `SELECT id, session_id, task_id, task_type, engine_kind, status,
                  model_json, turn_id, chapter_id, error, started_at, completed_at,
                  created_at, updated_at
           FROM agent_assistant_runs WHERE id = ?`,
          run.id,
        )!,
      );
    });
  };
  return [
    {
      id: "agents:typed-sessions-create",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-sessions", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          if (!isRecord(body))
            return problem(context, 400, "VALIDATION_ERROR", "会话配置无效。");
          return forwardAssistant(
            app,
            context,
            "/api/v2/assistant-conversations",
            body,
          );
        }),
    },
    {
      id: "agents:typed-sessions-get",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-sessions/:id", (context) => {
          const session = findSession(context.req.param("id"));
          return session
            ? context.json(assistantSession(session))
            : problem(context, 404, "NOT_FOUND", "未找到 Agent 会话。");
        }),
    },
    {
      id: "agents:typed-sessions-run",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-sessions/:id/runs", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          const prompt = isRecord(body)
            ? assistantMessage(body.prompt)
            : undefined;
          if (!prompt)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "运行提示不能为空或过长。",
            );
          const response = await forwardAssistant(
            app,
            context,
            `/api/v2/assistant-conversations/${encodeURIComponent(context.req.param("id"))}/messages`,
            {
              message: prompt,
              ...(isRecord(body) && body.taskType
                ? { taskType: body.taskType }
                : {}),
            },
          );
          if (!response.ok) return response;
          const started = (await response.json()) as unknown;
          const run =
            isRecord(started) && isRecord(started.run)
              ? started.run
              : undefined;
          if (
            !run ||
            typeof run.taskId !== "string" ||
            typeof run.sessionId !== "string" ||
            typeof run.id !== "string"
          )
            return problem(
              context,
              500,
              "INTERNAL_ERROR",
              "Agent 运行未返回规范化标识。",
            );
          return context.json({
            taskId: run.taskId,
            sessionId: run.sessionId,
            runId: run.id,
          });
        }),
    },
    {
      id: "agents:typed-runs-get",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-runs/:id", (context) => {
          const run = findRun(context.req.param("id"));
          return run
            ? context.json(assistantRun(run))
            : problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
        }),
    },
    {
      id: "agents:typed-run-items-list",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-runs/:id/items", (context) => {
          if (!findRun(context.req.param("id")))
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
          const items = pluginContext.uow.execute((transaction) =>
            transaction
              .all<AssistantItemRow>(
                `SELECT id, run_id, sequence, type, status, content, payload_json,
                        created_at, updated_at
                 FROM agent_assistant_items WHERE run_id = ?
                 ORDER BY sequence, id`,
                context.req.param("id"),
              )
              .map(assistantItem),
          );
          return context.json(items);
        }),
    },
    {
      id: "agents:typed-run-events",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-runs/:id/events", async (context) => {
          const runId = context.req.param("id");
          if (!findRun(runId))
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
          const headerCursor = Number(
            context.req.header("Last-Event-ID") ?? "0",
          );
          const queryCursor = Number(context.req.query("cursor") ?? "0");
          const afterCursor =
            Number.isFinite(headerCursor) && headerCursor > 0
              ? headerCursor
              : Number.isFinite(queryCursor) && queryCursor > 0
                ? queryCursor
                : 0;
          const isForRun = (event: { payload: unknown }): boolean =>
            isRecord(event.payload) && event.payload.runId === runId;
          return streamSSE(context, async (stream) => {
            for (const event of pluginContext.events.replay(afterCursor)) {
              if (!isForRun(event)) continue;
              await stream.writeSSE({
                event: event.type,
                id: String(event.cursor),
                data: JSON.stringify(event),
              });
            }
            await new Promise<void>((resolve) => {
              const unsubscribe = pluginContext.events.subscribeLive(
                (event) => {
                  if (!isForRun(event)) return;
                  void stream.writeSSE({
                    event: event.type,
                    id: event.id,
                    data: JSON.stringify(event),
                  });
                },
              );
              stream.onAbort(() => {
                void unsubscribe();
                resolve();
              });
            });
          });
        }),
    },
    {
      id: "agents:typed-runs-steer",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-runs/:id/steer", async (context) => {
          const run = findRun(context.req.param("id"));
          const session = run ? findSession(run.session_id) : undefined;
          const body = await context.req.json().catch(() => undefined);
          const prompt = isRecord(body)
            ? assistantMessage(body.prompt)
            : undefined;
          if (!run || !session)
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
          if (!prompt)
            return problem(
              context,
              400,
              "VALIDATION_ERROR",
              "引导消息不能为空或过长。",
            );
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法引导本地智能引擎。",
            );
          try {
            await createHostAgentRuntime(
              host,
              session.engine_kind as AgentEngineKind,
            ).steer({ runId: run.id }, prompt);
            const now = new Date().toISOString();
            pluginContext.uow.execute((transaction) => {
              transaction.append({
                type: "agents.run-steered.v1",
                pluginId: "agents",
                aggregateType: "agent-run",
                aggregateId: run.id,
                aggregateVersion: 1,
                payload: { sessionId: session.id, runId: run.id },
              });
            });
            pluginContext.events.publishLive({
              type: "agents.run-steered.v1",
              payload: {
                sessionId: session.id,
                runId: run.id,
                occurredAt: now,
              },
            });
            return context.body(null, 204);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "无法引导 Agent 运行。";
            const unsupported = /does not support|unsupported/i.test(message);
            return problem(
              context,
              unsupported ? 422 : 503,
              unsupported ? "UNSUPPORTED_OPERATION" : "ENGINE_UNAVAILABLE",
              message,
            );
          }
        }),
    },
    {
      id: "agents:typed-runs-interrupt",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-runs/:id/interrupt", async (context) => {
          const run = findRun(context.req.param("id"));
          if (!run)
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 运行。");
          try {
            return context.json(await stopRun(run, "interrupted"));
          } catch (error) {
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              error instanceof Error ? error.message : "无法停止 Agent 运行。",
            );
          }
        }),
    },
    {
      id: "agents:typed-runs-resume",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-runs/:id/resume", async (context) => {
          const run = findRun(context.req.param("id"));
          const session = run ? findSession(run.session_id) : undefined;
          if (!run || !session)
            return problem(
              context,
              404,
              "NOT_FOUND",
              "未找到可恢复的 Agent 运行。",
            );
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法恢复本地智能引擎。",
            );
          try {
            const restored = await createHostAgentRuntime(
              host,
              session.engine_kind as AgentEngineKind,
            ).resume({
              sessionId: session.id,
              engineSessionId: session.engine_session_id,
            });
            const resumed = pluginContext.uow.execute((transaction) => {
              const now = new Date().toISOString();
              transaction.run(
                `UPDATE agent_assistant_sessions
                 SET engine_session_id = ?, status = 'idle', updated_at = ?, last_opened_at = ?
                 WHERE id = ?`,
                restored.engineSessionId,
                now,
                now,
                session.id,
              );
              transaction.append({
                type: "agents.run-resumed.v1",
                pluginId: "agents",
                aggregateType: "agent-run",
                aggregateId: run.id,
                aggregateVersion: 1,
                payload: { sessionId: session.id, runId: run.id },
              });
              return assistantRun(
                transaction.get<AssistantRunRow>(
                  `SELECT id, session_id, task_id, task_type, engine_kind, status,
                          model_json, turn_id, chapter_id, error, started_at, completed_at,
                          created_at, updated_at FROM agent_assistant_runs WHERE id = ?`,
                  run.id,
                )!,
              );
            });
            return context.json(resumed);
          } catch (error) {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              error instanceof Error ? error.message : "无法恢复 Agent 会话。",
            );
          }
        }),
    },
    {
      id: "agents:typed-sessions-fork",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-sessions/:id/fork", async (context) => {
          const source = findSession(context.req.param("id"));
          if (!source)
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 会话。");
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法复制本地智能会话。",
            );
          try {
            const id = crypto.randomUUID();
            const forkedEngineSession = await createHostAgentRuntime(
              host,
              source.engine_kind as AgentEngineKind,
            ).fork(
              {
                sessionId: source.id,
                engineSessionId: source.engine_session_id,
              },
              { sessionId: id },
            );
            const fork = pluginContext.uow.execute((transaction) => {
              const now = new Date().toISOString();
              transaction.run(
                `INSERT INTO agent_assistant_sessions(
                  id, engine_session_id, engine_kind, project_id, surface, chapter_id,
                  task_type, title, model_json, status, archived_at, last_opened_at,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', NULL, ?, ?, ?)`,
                id,
                forkedEngineSession.engineSessionId,
                source.engine_kind,
                source.project_id,
                source.surface,
                source.chapter_id,
                source.task_type,
                source.title,
                source.model_json,
                now,
                now,
                now,
              );
              transaction.append({
                type: "agents.session-forked.v1",
                pluginId: "agents",
                aggregateType: "agent-session",
                aggregateId: id,
                aggregateVersion: 1,
                payload: { sourceSessionId: source.id, sessionId: id },
              });
              return assistantSession(
                transaction.get<AssistantSessionRow>(
                  `SELECT id, engine_session_id, engine_kind, project_id, surface,
                          chapter_id, task_type, title, model_json, status, archived_at,
                          last_opened_at, created_at, updated_at
                   FROM agent_assistant_sessions WHERE id = ?`,
                  id,
                )!,
              );
            });
            return context.json(fork, 201);
          } catch (error) {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              error instanceof Error ? error.message : "无法复制 Agent 会话。",
            );
          }
        }),
    },
    {
      id: "agents:typed-sessions-dispose",
      pluginId: "agents",
      install: (app) =>
        app.delete("/api/v2/agent-sessions/:id", async (context) => {
          const session = findSession(context.req.param("id"));
          if (!session)
            return problem(context, 404, "NOT_FOUND", "未找到 Agent 会话。");
          if (!host)
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              "当前 Runtime 未连接 Desktop Host，无法释放本地智能会话。",
            );
          try {
            await createHostAgentRuntime(
              host,
              session.engine_kind as AgentEngineKind,
            ).dispose({
              sessionId: session.id,
              engineSessionId: session.engine_session_id,
            });
          } catch (error) {
            return problem(
              context,
              503,
              "ENGINE_UNAVAILABLE",
              error instanceof Error ? error.message : "无法释放 Agent 会话。",
            );
          }
          pluginContext.uow.execute((transaction) => {
            transaction.run(
              `DELETE FROM agent_assistant_items WHERE run_id IN (
                 SELECT id FROM agent_assistant_runs WHERE session_id = ?
               )`,
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_runs WHERE session_id = ?",
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_turns WHERE session_id = ?",
              session.id,
            );
            transaction.run(
              "DELETE FROM agent_assistant_sessions WHERE id = ?",
              session.id,
            );
            transaction.append({
              type: "agents.session-disposed.v1",
              pluginId: "agents",
              aggregateType: "agent-session",
              aggregateId: session.id,
              aggregateVersion: 1,
              payload: { sessionId: session.id },
            });
          });
          return context.body(null, 204);
        }),
    },
    {
      id: "agents:typed-sessions-abort",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-sessions/:id/abort", async (context) => {
          const run = pluginContext.uow.execute((transaction) =>
            transaction.get<AssistantRunRow>(
              `SELECT id, session_id, task_id, task_type, engine_kind, status,
                      model_json, turn_id, chapter_id, error, started_at, completed_at,
                      created_at, updated_at
               FROM agent_assistant_runs
               WHERE session_id = ? AND status IN ('queued', 'running')
               ORDER BY created_at DESC LIMIT 1`,
              context.req.param("id"),
            ),
          );
          if (!run) return context.json({ ok: true });
          try {
            await stopRun(run, "canceled");
            return context.json({ ok: true });
          } catch (error) {
            return problem(
              context,
              503,
              "CAPABILITY_UNAVAILABLE",
              error instanceof Error ? error.message : "无法停止 Agent 会话。",
            );
          }
        }),
    },
  ];
}

type EvaluationCandidate = "a" | "b" | "c";
const evaluationCandidates: readonly EvaluationCandidate[] = ["a", "b", "c"];
const activeEvaluationEngines: readonly AgentEngineKind[] = [
  "pi",
  "codex",
  "grok",
];

interface EvaluationRow {
  id: string;
  project_id: string;
  task_type: string;
  prompt: string;
  context_snapshot_json: string;
  status: string;
  revealed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface EvaluationCandidateRow {
  id: string;
  evaluation_id: string;
  candidate: EvaluationCandidate;
  engine_kind: AgentEngineKind;
  run_id: string;
  status: string;
  output_json: string | null;
  metrics_json: string;
}

function evaluationMetrics(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function publicEvaluationMetrics(
  value: string,
  revealed: boolean,
): Record<string, unknown> {
  const metrics = evaluationMetrics(value);
  if (revealed) return metrics;
  const {
    engine: _engine,
    engineVersion: _engineVersion,
    model: _model,
    provider: _provider,
    ...redacted
  } = metrics;
  return redacted;
}

function evaluationPayload(
  pluginContext: PluginContext,
  id: string,
): Record<string, unknown> | undefined {
  return pluginContext.uow.execute((transaction) => {
    const evaluation = transaction.get<EvaluationRow>(
      `SELECT id, project_id, task_type, prompt, context_snapshot_json, status,
              revealed_at, created_at, updated_at
       FROM agent_evaluations WHERE id = ?`,
      id,
    );
    if (!evaluation) return undefined;
    const candidates = transaction
      .all<EvaluationCandidateRow>(
        `SELECT id, evaluation_id, candidate, engine_kind, run_id, status,
                output_json, metrics_json
         FROM agent_evaluation_candidates WHERE evaluation_id = ?
         ORDER BY candidate`,
        id,
      )
      .map((candidate) => {
        let output: unknown;
        if (candidate.output_json) {
          try {
            output = JSON.parse(candidate.output_json);
          } catch {
            output = undefined;
          }
        }
        return {
          candidate: candidate.candidate,
          runId: candidate.run_id,
          status: candidate.status,
          ...(output !== undefined ? { output } : {}),
          ...(evaluation.revealed_at
            ? { engineKind: candidate.engine_kind }
            : {}),
          metrics: publicEvaluationMetrics(
            candidate.metrics_json,
            Boolean(evaluation.revealed_at),
          ),
        };
      });
    let model: unknown;
    try {
      const snapshot = JSON.parse(evaluation.context_snapshot_json);
      model = isRecord(snapshot) ? snapshot.model : undefined;
    } catch {
      model = undefined;
    }
    return {
      id: evaluation.id,
      projectId: evaluation.project_id,
      taskType: evaluation.task_type,
      contextSnapshotId: evaluation.id,
      status: evaluation.status,
      comparisonMode: model ? "same_model" : "recommended",
      ...(isRecord(model) ? { model } : {}),
      revealed: Boolean(evaluation.revealed_at),
      candidates,
      createdAt: evaluation.created_at,
      updatedAt: evaluation.updated_at,
    };
  });
}

function shuffledEvaluationEngines(): readonly AgentEngineKind[] {
  const engines = [...activeEvaluationEngines];
  for (let index = engines.length - 1; index > 0; index -= 1) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const target = random % (index + 1);
    [engines[index], engines[target]] = [engines[target]!, engines[index]!];
  }
  return engines;
}

async function runEvaluationCandidate(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
  input: {
    evaluationId: string;
    candidate: EvaluationCandidate;
    engine: AgentEngineKind;
    runId: string;
    prompt: string;
    projectId: string;
    model?: AgentModelSelection;
  },
): Promise<void> {
  const startedAt = Date.now();
  let ttftMs: number | undefined;
  let output = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let estimatedCost: number | undefined;
  let toolCalls = 0;
  let toolErrors = 0;
  let failureCode: string | undefined;
  const capabilityGrant = {
    endpoint: "",
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  try {
    if (!host) throw new Error("CAPABILITY_UNAVAILABLE");
    pluginContext.uow.execute((transaction) => {
      transaction.run(
        `UPDATE agent_evaluation_candidates
         SET status = 'running' WHERE evaluation_id = ? AND candidate = ?`,
        input.evaluationId,
        input.candidate,
      );
      transaction.run(
        `INSERT INTO agent_capability_grants(
          id, run_id, expires_at, consumed_at, capabilities_json, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?)`,
        capabilityGrant.token,
        input.runId,
        capabilityGrant.expiresAt,
        JSON.stringify(["mcp.readonly"]),
        new Date().toISOString(),
      );
    });
    const runtime = createHostAgentRuntime(host, input.engine);
    const availability = await runtime.availability();
    if (!availability.available)
      throw new Error(
        availability.authenticated
          ? "ENGINE_UNAVAILABLE"
          : "ENGINE_AUTH_REQUIRED",
      );
    const session = await runtime.createSession({
      sessionId: `evaluation-${input.evaluationId}-${input.candidate}`,
      title: `盲测 ${input.candidate.toUpperCase()}`,
      projectId: input.projectId,
      ...(input.model ? { model: input.model } : {}),
      capabilityGrant,
    });
    const run = await runtime.prompt(session, {
      runId: input.runId,
      prompt: input.prompt,
      capabilityGrant,
    });
    for await (const event of runtime.subscribe(run)) {
      if (event.type === "content.delta") {
        ttftMs ??= Date.now() - startedAt;
        output = `${output}${event.delta}`.slice(0, 500_000);
      }
      if (event.type === "result") {
        const textOutput = engineResponseText(event.result);
        if (textOutput) output = textOutput;
      }
      if (event.type === "usage") {
        inputTokens = event.usage.inputTokens ?? inputTokens;
        outputTokens = event.usage.outputTokens ?? outputTokens;
        cachedTokens = event.usage.cachedTokens ?? cachedTokens;
        estimatedCost = event.usage.estimatedCost ?? estimatedCost;
      }
      if (event.type === "tool") {
        toolCalls += 1;
        if (event.status === "failed") toolErrors += 1;
      }
      if (event.type === "error") {
        failureCode = event.code;
        throw new Error(event.message);
      }
    }
    if (!output.trim()) throw new Error("EMPTY_RESULT");
    const now = new Date().toISOString();
    pluginContext.uow.execute((transaction) => {
      transaction.run(
        `UPDATE agent_evaluation_candidates
         SET status = 'succeeded', output_json = ?, metrics_json = ? WHERE evaluation_id = ? AND candidate = ?`,
        JSON.stringify({ text: output }),
        JSON.stringify({
          completed: true,
          formatError: false,
          toolViolation: false,
          latencyMs: Date.now() - startedAt,
          ttftMs,
          durationMs: Date.now() - startedAt,
          inputTokens,
          outputTokens,
          cachedTokens,
          engine: input.engine,
          engineVersion: runtime.descriptor.version,
          model: input.model?.modelId,
          provider: input.model?.providerId,
          success: true,
          ...(estimatedCost !== undefined ? { estimatedCost } : {}),
          toolCalls,
          toolErrors,
          contextTokens: input.prompt.length,
          retryCount: 0,
          adopted: false,
        }),
        input.evaluationId,
        input.candidate,
      );
      transaction.run(
        `UPDATE agent_evaluations SET updated_at = ? WHERE id = ?`,
        now,
        input.evaluationId,
      );
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "ENGINE_OPERATION_FAILED";
    failureCode ??= /^[A-Z_]+$/u.test(message)
      ? message
      : "ENGINE_OPERATION_FAILED";
    pluginContext.uow.execute((transaction) => {
      const now = new Date().toISOString();
      transaction.run(
        `UPDATE agent_evaluation_candidates
         SET status = 'failed', metrics_json = ? WHERE evaluation_id = ? AND candidate = ?`,
        JSON.stringify({
          completed: false,
          formatError: false,
          toolViolation: false,
          latencyMs: Date.now() - startedAt,
          durationMs: Date.now() - startedAt,
          inputTokens,
          outputTokens,
          cachedTokens,
          engine: input.engine,
          model: input.model?.modelId,
          provider: input.model?.providerId,
          success: false,
          toolCalls,
          toolErrors,
          contextTokens: input.prompt.length,
          retryCount: 0,
          failureCode,
          adopted: false,
        }),
        input.evaluationId,
        input.candidate,
      );
      transaction.run(
        `UPDATE agent_evaluations SET updated_at = ? WHERE id = ?`,
        now,
        input.evaluationId,
      );
    });
  } finally {
    pluginContext.uow.execute((transaction) => {
      transaction.run(
        "UPDATE agent_capability_grants SET consumed_at = COALESCE(consumed_at, ?) WHERE id = ?",
        new Date().toISOString(),
        capabilityGrant.token,
      );
      const remaining = transaction.get<{ count: number }>(
        `SELECT COUNT(*) AS count FROM agent_evaluation_candidates
         WHERE evaluation_id = ? AND status IN ('queued', 'running')`,
        input.evaluationId,
      )?.count;
      if (remaining === 0) {
        const now = new Date().toISOString();
        transaction.run(
          `UPDATE agent_evaluations SET status = 'ready_for_review', updated_at = ? WHERE id = ?`,
          now,
          input.evaluationId,
        );
        transaction.append({
          type: "agents.evaluation-ready.v1",
          pluginId: "agents",
          aggregateType: "agent-evaluation",
          aggregateId: input.evaluationId,
          aggregateVersion: 1,
          payload: { evaluationId: input.evaluationId },
        });
      }
    });
  }
}

function evaluationRoutes(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): readonly RouteContribution[] {
  return [
    {
      id: "agents:evaluations-create",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-experiments", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          if (
            !isRecord(body) ||
            !text(body.projectId) ||
            !assistantTaskType(body.taskType)
          )
            return problem(context, 400, "VALIDATION_ERROR", "盲测参数无效。");
          const evaluationId = crypto.randomUUID();
          const now = new Date().toISOString();
          const prompt =
            text(body.prompt) ?? "请基于已授权的项目上下文完成此项任务。";
          const model = modelSelection(body.model);
          const mapping = shuffledEvaluationEngines();
          const runInputs = pluginContext.uow.execute((transaction) => {
            transaction.run(
              `INSERT INTO agent_evaluations(
                id, project_id, task_type, prompt, context_snapshot_json, status,
                revealed_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 'running', NULL, ?, ?)`,
              evaluationId,
              text(body.projectId),
              assistantTaskType(body.taskType),
              prompt,
              JSON.stringify({ projectId: text(body.projectId), model }),
              now,
              now,
            );
            const inputs = evaluationCandidates.map((candidate, index) => {
              const runId = crypto.randomUUID();
              const engine = mapping[index]!;
              transaction.run(
                `INSERT INTO agent_evaluation_candidates(
                  id, evaluation_id, candidate, engine_kind, run_id, status,
                  output_json, metrics_json
                ) VALUES (?, ?, ?, ?, ?, 'queued', NULL, '{}')`,
                crypto.randomUUID(),
                evaluationId,
                candidate,
                engine,
                runId,
              );
              return { candidate, engine, runId };
            });
            transaction.append({
              type: "agents.evaluation-created.v1",
              pluginId: "agents",
              aggregateType: "agent-evaluation",
              aggregateId: evaluationId,
              aggregateVersion: 1,
              payload: { evaluationId, engines: 3 },
            });
            return inputs;
          });
          for (const candidate of runInputs)
            void runEvaluationCandidate(pluginContext, host, {
              evaluationId,
              ...candidate,
              prompt,
              projectId: text(body.projectId)!,
              ...(model ? { model } : {}),
            });
          return context.json(
            evaluationPayload(pluginContext, evaluationId),
            202,
          );
        }),
    },
    {
      id: "agents:evaluations-get",
      pluginId: "agents",
      install: (app) =>
        app.get("/api/v2/agent-experiments/:id", (context) => {
          const value = evaluationPayload(
            pluginContext,
            context.req.param("id"),
          );
          return value
            ? context.json(value)
            : problem(context, 404, "NOT_FOUND", "未找到盲测记录。");
        }),
    },
    {
      id: "agents:evaluations-review",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-experiments/:id/review", async (context) => {
          const body = await context.req.json().catch(() => undefined);
          const preferred = isRecord(body)
            ? text(body.preferredCandidate)
            : undefined;
          if (!preferred || !["a", "b", "c", "tie"].includes(preferred))
            return problem(context, 400, "VALIDATION_ERROR", "盲测评价无效。");
          const id = context.req.param("id");
          const saved = pluginContext.uow.execute((transaction) => {
            const evaluation = transaction.get<EvaluationRow>(
              "SELECT id, status FROM agent_evaluations WHERE id = ?",
              id,
            );
            if (!evaluation) return false;
            if (evaluation.status !== "ready_for_review")
              throw new Error("盲测尚未完成，暂不能评价。");
            const now = new Date().toISOString();
            transaction.run(
              `INSERT INTO agent_evaluation_reviews(
                evaluation_id, preferred_candidate, accepted, notes, created_at
              ) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(evaluation_id) DO UPDATE SET
                preferred_candidate = excluded.preferred_candidate,
                accepted = excluded.accepted, notes = excluded.notes,
                created_at = excluded.created_at`,
              id,
              preferred,
              body?.accepted === false ? 0 : 1,
              text(body?.notes) ?? null,
              now,
            );
            transaction.run(
              "UPDATE agent_evaluations SET status = 'completed', updated_at = ? WHERE id = ?",
              now,
              id,
            );
            return true;
          });
          if (!saved)
            return problem(context, 404, "NOT_FOUND", "未找到盲测记录。");
          return context.json(evaluationPayload(pluginContext, id));
        }),
    },
    {
      id: "agents:evaluations-reveal",
      pluginId: "agents",
      install: (app) =>
        app.post("/api/v2/agent-experiments/:id/reveal", (context) => {
          const id = context.req.param("id");
          const revealed = pluginContext.uow.execute((transaction) => {
            const evaluation = transaction.get<{ status: string }>(
              "SELECT status FROM agent_evaluations WHERE id = ?",
              id,
            );
            if (!evaluation) return false;
            if (evaluation.status !== "completed")
              throw new Error("请先提交盲测评价后再揭晓引擎。");
            transaction.run(
              "UPDATE agent_evaluations SET revealed_at = COALESCE(revealed_at, ?), updated_at = ? WHERE id = ?",
              new Date().toISOString(),
              new Date().toISOString(),
              id,
            );
            return true;
          });
          if (!revealed)
            return problem(context, 404, "NOT_FOUND", "未找到盲测记录。");
          return context.json(evaluationPayload(pluginContext, id));
        }),
    },
  ];
}

export function createAgentsPlugin(host?: DesktopHostClient) {
  return defineFirstPartyPlugin({
    descriptor: {
      id: "agents",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: ["foundation", "automation", "writing", "knowledge"],
      provides: ["agents.runtime", "agents.evaluation"],
      stability: "internal",
    },
    ui: [
      {
        id: "agents.slot.assistant",
        pluginId: "agents",
        kind: "slot",
        metadata: { slot: "shell.assistant", order: 10, title: "智能助手" },
      },
      {
        id: "agents.settings.engines",
        pluginId: "agents",
        kind: "settings",
        metadata: { section: "agent-engines", title: "智能引擎" },
      },
      {
        id: "agents.command.new-conversation",
        pluginId: "agents",
        kind: "command",
        metadata: { title: "新对话", command: "agents.new-conversation" },
      },
    ],
    migrations: providerMigrations,
    activate: async (context) => {
      const providerService: ConfiguredProviderService = {
        get: (id) => {
          const provider = findProvider(context, id);
          if (!provider) return undefined;
          try {
            return configuredProvider(provider);
          } catch {
            return undefined;
          }
        },
      };
      if (context.services)
        context.effect(
          context.services.provide(
            CONFIGURED_PROVIDER_SERVICE,
            providerService,
          ),
          `service:${CONFIGURED_PROVIDER_SERVICE}`,
        );
      if (context.services)
        context.effect(
          context.services.provide(
            AGENT_TASK_RUNNER_SERVICE,
            createAgentTaskRunner(context, host),
          ),
          `service:${AGENT_TASK_RUNNER_SERVICE}`,
        );
      for (const route of [
        ...providerRoutes(context, host),
        ...assistantConversationRoutes(context, host),
        ...typedAgentSessionRoutes(context, host),
        ...evaluationRoutes(context, host),
      ]) {
        const registered = { ...route, ...agentRouteMetadata[route.id] };
        context.effect(
          context.http.register(registered),
          `route:${registered.id}`,
        );
      }
      await restoreSavedAgentConfiguration(context, host);
    },
  });
}

const agentRouteMetadata: Record<
  string,
  Pick<RouteContribution, "method" | "path" | "operationId">
> = {
  "agents:engine-list": {
    method: "get",
    path: "/api/v2/agent-engines",
    operationId: "agent-engines.list",
  },
  "agents:task-catalog-list": {
    method: "get",
    path: "/api/v2/agent-tasks",
    operationId: "agent-engines.listTasks",
  },
  "agents:engine-restore-configuration": {
    method: "post",
    path: "/api/v2/agent-engines/restore-configuration",
    operationId: "agent-engines.restoreConfiguration",
  },
  "agents:global-engine-settings-get": {
    method: "get",
    path: "/api/v2/agent-settings",
    operationId: "agent-engines.getGlobalSettings",
  },
  "agents:global-engine-settings-update": {
    method: "put",
    path: "/api/v2/agent-settings",
    operationId: "agent-engines.updateGlobalSettings",
  },
  "agents:project-engine-settings-get": {
    method: "get",
    path: "/api/v2/projects/{id}/agent-settings",
    operationId: "agent-engines.getProjectSettings",
  },
  "agents:project-engine-settings-update": {
    method: "put",
    path: "/api/v2/projects/{id}/agent-settings",
    operationId: "agent-engines.updateProjectSettings",
  },
  "agents:codex-auth-status": {
    method: "get",
    path: "/api/v2/agent-engines/codex/auth",
    operationId: "codex-auth.status",
  },
  "agents:codex-login": {
    method: "post",
    path: "/api/v2/agent-engines/codex/login",
    operationId: "codex-auth.login",
  },
  "agents:codex-logout": {
    method: "post",
    path: "/api/v2/agent-engines/codex/logout",
    operationId: "codex-auth.logout",
  },
  "agents:providers-list": {
    method: "get",
    path: "/api/v2/providers",
    operationId: "providers.list",
  },
  "agents:providers-create": {
    method: "post",
    path: "/api/v2/providers",
    operationId: "providers.create",
  },
  "agents:providers-get": {
    method: "get",
    path: "/api/v2/providers/{id}",
    operationId: "providers.get",
  },
  "agents:providers-update": {
    method: "patch",
    path: "/api/v2/providers/{id}",
    operationId: "providers.update",
  },
  "agents:providers-delete": {
    method: "delete",
    path: "/api/v2/providers/{id}",
    operationId: "providers.delete",
  },
  "agents:providers-activate-for-agent": {
    method: "post",
    path: "/api/v2/providers/{id}/activate-for-agent",
    operationId: "providers.activateForAgent",
  },
  "agents:providers-test-connection": {
    method: "post",
    path: "/api/v2/providers/{id}/test-connection",
    operationId: "providers.testConnection",
  },
  "agents:assistant-conversations-list": {
    method: "get",
    path: "/api/v2/assistant-conversations",
    operationId: "assistant-conversations.list",
  },
  "agents:assistant-conversations-create": {
    method: "post",
    path: "/api/v2/assistant-conversations",
    operationId: "assistant-conversations.create",
  },
  "agents:assistant-conversations-get": {
    method: "get",
    path: "/api/v2/assistant-conversations/{id}",
    operationId: "assistant-conversations.get",
  },
  "agents:assistant-conversations-update": {
    method: "patch",
    path: "/api/v2/assistant-conversations/{id}",
    operationId: "assistant-conversations.update",
  },
  "agents:assistant-conversations-bind-project": {
    method: "post",
    path: "/api/v2/assistant-conversations/{id}/bind-project",
    operationId: "assistant-conversations.bindProject",
  },
  "agents:assistant-conversations-send-message": {
    method: "post",
    path: "/api/v2/assistant-conversations/{id}/messages",
    operationId: "assistant-conversations.sendMessage",
  },
  "agents:assistant-conversations-delete": {
    method: "delete",
    path: "/api/v2/assistant-conversations/{id}",
    operationId: "assistant-conversations.remove",
  },
  "agents:typed-sessions-create": {
    method: "post",
    path: "/api/v2/agent-sessions",
    operationId: "agent-sessions.create",
  },
  "agents:typed-sessions-get": {
    method: "get",
    path: "/api/v2/agent-sessions/{id}",
    operationId: "agent-sessions.get",
  },
  "agents:typed-sessions-run": {
    method: "post",
    path: "/api/v2/agent-sessions/{id}/runs",
    operationId: "agent-sessions.run",
  },
  "agents:typed-runs-get": {
    method: "get",
    path: "/api/v2/agent-runs/{id}",
    operationId: "agent-sessions.getRun",
  },
  "agents:typed-run-items-list": {
    method: "get",
    path: "/api/v2/agent-runs/{id}/items",
    operationId: "agent-sessions.listItems",
  },
  "agents:typed-run-events": {
    method: "get",
    path: "/api/v2/agent-runs/{id}/events",
    operationId: "agent-sessions.subscribe",
  },
  "agents:typed-runs-steer": {
    method: "post",
    path: "/api/v2/agent-runs/{id}/steer",
    operationId: "agent-sessions.steer",
  },
  "agents:typed-runs-interrupt": {
    method: "post",
    path: "/api/v2/agent-runs/{id}/interrupt",
    operationId: "agent-sessions.interrupt",
  },
  "agents:typed-runs-resume": {
    method: "post",
    path: "/api/v2/agent-runs/{id}/resume",
    operationId: "agent-sessions.resume",
  },
  "agents:typed-sessions-fork": {
    method: "post",
    path: "/api/v2/agent-sessions/{id}/fork",
    operationId: "agent-sessions.fork",
  },
  "agents:typed-sessions-dispose": {
    method: "delete",
    path: "/api/v2/agent-sessions/{id}",
    operationId: "agent-sessions.dispose",
  },
  "agents:typed-sessions-abort": {
    method: "post",
    path: "/api/v2/agent-sessions/{id}/abort",
    operationId: "agent-sessions.abort",
  },
  "agents:evaluations-create": {
    method: "post",
    path: "/api/v2/agent-experiments",
    operationId: "agent-experiments.create",
  },
  "agents:evaluations-get": {
    method: "get",
    path: "/api/v2/agent-experiments/{id}",
    operationId: "agent-experiments.get",
  },
  "agents:evaluations-review": {
    method: "post",
    path: "/api/v2/agent-experiments/{id}/review",
    operationId: "agent-experiments.review",
  },
  "agents:evaluations-reveal": {
    method: "post",
    path: "/api/v2/agent-experiments/{id}/reveal",
    operationId: "agent-experiments.reveal",
  },
};

export const agentsPlugin = createAgentsPlugin();
