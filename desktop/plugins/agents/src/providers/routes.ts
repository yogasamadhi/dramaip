import { optionalService } from "@dramaip/plugin-api/internal";
import {
  type AgentEngineKind,
  type ConfiguredProvider,
} from "@dramaip/contracts";
import {
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import type {
  AgentProviderActivationInput,
  CodexAuthenticationLoginInput,
  DesktopHostClient,
} from "@dramaip/desktop-host";
import { type PluginContext } from "@dramaip/plugin-api/internal";
import {
  AgentRouteDraft,
  ProviderPayload,
  entityResponse,
  expectedVersion,
  problem,
} from "../internal/shared.js";
import { AGENT_TASK_CATALOG } from "../task-catalog.js";
export interface ProviderRow {
  id: string;
  title: string;
  payload_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProviderEntity {
  id: string;
  domain: "providers";
  title: string;
  payload: ProviderPayload;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CodexCustomProviderSettingRow {
  provider_id: string;
  protocol: "responses" | "chat_completions";
}

export const engineDefinitions = {
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
  langgraph: {
    name: "LangGraph.js",
    version: "1.4.9",
    isBeta: false,
    role: "external-benchmark",
  },
} as const;

export const agentEngineKinds = Object.keys(
  engineDefinitions,
) as AgentEngineKind[];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasRawSecret(value: unknown, depth = 0): boolean {
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

export function parsePayload(value: unknown): ProviderPayload | undefined {
  if (!isRecord(value) || hasRawSecret(value)) return undefined;
  try {
    return JSON.stringify(value).length <= 64 * 1024 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function providerEntity(row: ProviderRow): ProviderEntity {
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

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function agentProviderConfiguration(
  provider: ProviderEntity,
): AgentProviderActivationInput {
  const serviceType = text(provider.payload["服务类型"]);
  const credentialRef = text(provider.payload["凭据引用"]);
  const model = text(provider.payload["模型名称"]);
  const baseUrl = text(provider.payload["服务地址"]);
  const authentication =
    text(provider.payload["认证方式"]) === "none" ? "none" : "apiKey";
  const localRuntimeKind = text(provider.payload["本地运行时"]);
  const protocol = text(provider.payload["调用协议"])?.toLowerCase() ?? "";
  const presetProvider = text(provider.payload["预设服务商"])?.toLowerCase();
  if (serviceType !== "智能模型")
    throw new Error("仅“智能模型”类型的服务商可供智能助手使用。");
  if (!model) throw new Error("智能助手模型需要模型名称。");
  if (
    authentication === "none" &&
    localRuntimeKind !== "ollama" &&
    localRuntimeKind !== "lm_studio"
  )
    throw new Error("无密钥认证只允许固定的 Ollama 或 LM Studio 本地运行时。");
  if (authentication === "apiKey" && !credentialRef)
    throw new Error("云端智能助手模型需要已保存的接口密钥。");
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
    authentication,
    ...(authentication === "none"
      ? {
          localRuntimeKind: localRuntimeKind as "ollama" | "lm_studio",
        }
      : {
          ...(baseUrl ? { baseUrl } : {}),
          credentialRef: credentialRef!,
          environmentName:
            providerKind === "anthropic"
              ? ("ANTHROPIC_API_KEY" as const)
              : providerKind === "google"
                ? ("GOOGLE_GENERATIVE_AI_API_KEY" as const)
                : ("OPENAI_API_KEY" as const),
        }),
  };
}

function configuredUnitEstimate(value: unknown): number | undefined {
  const decimal = typeof value === "string" ? value.trim() : undefined;
  const amount =
    typeof value === "number"
      ? value
      : decimal && /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(decimal)
        ? Number(decimal)
        : undefined;
  if (amount === 0 && decimal && /[1-9]/u.test(decimal.split(/e/iu)[0]!))
    return undefined;
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    ? amount
    : undefined;
}

export function configuredProvider(
  provider: ProviderEntity,
): ConfiguredProvider {
  const serviceType = text(provider.payload["服务类型"]) ?? "未分类服务";
  const credentialRef = text(provider.payload["凭据引用"]);
  const model = text(provider.payload["模型名称"]);
  const baseUrl = text(provider.payload["服务地址"]);
  const authentication =
    text(provider.payload["认证方式"]) === "none" ? "none" : "apiKey";
  const localRuntimeKind = text(provider.payload["本地运行时"]);
  if (!model) throw new Error("服务商需要模型名称。");
  if (authentication === "apiKey" && !credentialRef)
    throw new Error("云端服务商需要已保存的接口密钥。");
  if (
    authentication === "none" &&
    localRuntimeKind !== "ollama" &&
    localRuntimeKind !== "lm_studio"
  )
    throw new Error("无密钥认证只允许固定的 Ollama 或 LM Studio 本地运行时。");
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
  const estimatedUnitCost = configuredUnitEstimate(
    provider.payload["单次预估费用"],
  );
  return {
    id: provider.id,
    title: provider.title,
    serviceType,
    model,
    authentication,
    ...(authentication === "none"
      ? {
          localRuntimeKind: localRuntimeKind as "ollama" | "lm_studio",
        }
      : {
          credentialRef: credentialRef!,
          ...(baseUrl ? { baseUrl } : {}),
        }),
    ...(text(provider.payload["调用协议"])
      ? { protocol: text(provider.payload["调用协议"]) }
      : {}),
    ...(Number.isInteger(concurrencyLimit) && concurrencyLimit > 0
      ? { concurrencyLimit }
      : {}),
    ...(estimatedUnitCost !== undefined ? { estimatedUnitCost } : {}),
    ...(text(provider.payload["费用币种"])
      ? { currency: text(provider.payload["费用币种"]) }
      : {}),
  };
}

export function codexCustomProviderLoginInput(
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

export function codexCustomProviderSetting(
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

export type CodexLoginMode =
  "api_key" | "chatgpt_browser" | "chatgpt_device_code" | "custom_provider";

export function codexLoginMode(value: unknown): CodexLoginMode | undefined {
  return [
    "api_key",
    "chatgpt_browser",
    "chatgpt_device_code",
    "custom_provider",
  ].includes(String(value))
    ? (value as CodexLoginMode)
    : undefined;
}

export function findProvider(
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

export interface GlobalAgentSettingsRow {
  default_engine_kind: string;
  default_model_json: string | null;
  updated_at: string;
}

export interface AgentModelSelection {
  providerId?: string;
  modelId?: string;
  profileId?: string;
}

export function isAgentEngineKind(value: unknown): value is AgentEngineKind {
  return agentEngineKinds.includes(value as AgentEngineKind);
}

export function modelSelection(
  value: unknown,
): AgentModelSelection | undefined {
  if (!isRecord(value)) return undefined;
  // Unsupported sampling/reasoning options must not disappear while the
  // caller believes it is running a frozen evaluation configuration.
  const keys = ["providerId", "modelId", "profileId"] as const;
  if (
    Object.keys(value).some(
      (key) => !keys.includes(key as (typeof keys)[number]),
    )
  )
    return undefined;
  const result: AgentModelSelection = {};
  for (const key of keys) {
    if (typeof value[key] !== "undefined" && typeof value[key] !== "string")
      return undefined;
    if (typeof value[key] === "string" && value[key].trim().length > 200)
      return undefined;
    if (typeof value[key] === "string" && value[key].trim())
      result[key] = value[key].trim();
  }
  return Object.keys(result).length ? result : undefined;
}

export function globalAgentSettings(pluginContext: PluginContext): {
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

export function projectAgentSettings(
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

export function activeAgentProviderId(
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

export function hostEngineHealth(value: unknown): {
  available: boolean;
  healthy: boolean;
  configured: boolean;
  authenticated: boolean;
  generation?: number;
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
    ...(typeof value.generation === "number" &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 0
      ? { generation: value.generation }
      : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
  };
}

export async function agentEngineDescriptors(
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
          readOnlyMcp: kind !== "langgraph",
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
export async function restoreActiveAgentProvider(
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

export async function restoreCodexCustomProvider(
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

export async function restoreSavedAgentConfiguration(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
  onGeneration?: (isStopping: () => boolean) => void | Promise<void>,
): Promise<void> {
  if (!host) return;
  let disposed = false;
  let active: Promise<void> | undefined;
  let lastReconciledGeneration: string | undefined;
  const perform = async (): Promise<void> => {
    if (disposed) return;
    if (typeof host.engineHealth !== "function") {
      await Promise.all([
        restoreActiveAgentProvider(pluginContext, host),
        restoreCodexCustomProvider(pluginContext, host),
      ]);
      return;
    }
    const health = await Promise.all(
      agentEngineKinds.map(async (kind) => ({
        kind,
        health: hostEngineHealth(
          await host.engineHealth(kind).catch(() => undefined),
        ),
      })),
    );
    // A delayed health reply cannot start work in an inactive native fiber.
    if (disposed) return;
    const generations = health
      .filter((entry) => entry.health.generation !== undefined)
      .map((entry) => `${entry.kind}:${entry.health.generation}`)
      .join("|");
    if (!generations || generations === lastReconciledGeneration) return;
    const [providerRestored, codexRestored] = await Promise.all([
      restoreActiveAgentProvider(pluginContext, host),
      restoreCodexCustomProvider(pluginContext, host),
    ]);
    if (disposed) return;
    if (providerRestored && codexRestored)
      lastReconciledGeneration = generations;
    if (providerRestored && codexRestored) await onGeneration?.(() => disposed);
  };
  const reconcile = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (active) return active;
    const accepted = perform().finally(() => {
      if (active === accepted) active = undefined;
    });
    active = accepted;
    return accepted;
  };
  pluginContext.effect(() => {
    const timer =
      typeof host.engineHealth === "function"
        ? setInterval(() => void reconcile().catch(() => undefined), 2_000)
        : undefined;
    return async () => {
      disposed = true;
      if (timer !== undefined) clearInterval(timer);
      // Drain accepted local steps; this does not claim provider cancellation.
      await active?.catch(() => undefined);
    };
  }, "host-generation-configuration-reconciler");
  await reconcile();
}

export function providerRoutes(
  pluginContext: PluginContext,
  host: DesktopHostClient | undefined,
): readonly AgentRouteDraft[] {
  const find = (id: string): ProviderEntity | undefined =>
    findProvider(pluginContext, id);
  return [
    {
      id: "agents:engine-list",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/agent-engines", async (context) =>
          context.json(await agentEngineDescriptors(pluginContext, host)),
        ),
    },
    {
      id: "agents:task-catalog-list",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/agent-tasks", (context) =>
          context.json(AGENT_TASK_CATALOG),
        ),
    },
    {
      id: "agents:global-engine-settings-get",
      pluginId: "agents",
      bind: (routes) =>
        routes.get("/api/v2/agent-settings", (context) =>
          context.json(globalAgentSettings(pluginContext)),
        ),
    },
    {
      id: "agents:global-engine-settings-update",
      pluginId: "agents",
      bind: (routes) =>
        routes.put("/api/v2/agent-settings", async (context) => {
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
      bind: (routes) =>
        routes.get("/api/v2/projects/:id/agent-settings", (context) => {
          const projectId = context.req.param("id");
          const workspace = optionalService<WorkspaceProjectService>(
            pluginContext,
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
      bind: (routes) =>
        routes.put("/api/v2/projects/:id/agent-settings", async (context) => {
          const projectId = context.req.param("id");
          const workspace = optionalService<WorkspaceProjectService>(
            pluginContext,
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
      bind: (routes) =>
        routes.get("/api/v2/agent-engines/codex/auth", async (context) => {
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
      bind: (routes) =>
        routes.post("/api/v2/agent-engines/codex/login", async (context) => {
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
      bind: (routes) =>
        routes.post("/api/v2/agent-engines/codex/logout", async (context) => {
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
      bind: (routes) =>
        routes.get("/api/v2/providers", (context) => {
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
      bind: (routes) =>
        routes.post("/api/v2/providers", async (context) => {
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
      bind: (routes) =>
        routes.get("/api/v2/providers/:id", (context) => {
          const provider = find(context.req.param("id"));
          return provider
            ? entityResponse(context, provider)
            : problem(context, 404, "NOT_FOUND", "未找到模型服务商。");
        }),
    },
    {
      id: "agents:providers-update",
      pluginId: "agents",
      bind: (routes) =>
        routes.patch("/api/v2/providers/:id", async (context) => {
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
      bind: (routes) =>
        routes.delete("/api/v2/providers/:id", (context) => {
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
      bind: (routes) =>
        routes.post(
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
      bind: (routes) =>
        routes.post(
          "/api/v2/providers/:id/test-connection",
          async (context) => {
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
          },
        ),
    },
  ];
}
