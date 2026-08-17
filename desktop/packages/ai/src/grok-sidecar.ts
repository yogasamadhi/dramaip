import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GrokAcpClient } from "./grok-acp";

type GrokProviderConfiguration = {
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
};

type StartCommand = {
  type: "start";
  binaryPath: string;
  sessionRoot: string;
  mcp: { url: string; token: string };
  provider?: GrokProviderConfiguration;
};

type ConfigureCommand = {
  type: "configure";
  requestId: string;
  provider: GrokProviderConfiguration;
};

type EngineRequest = {
  type: "request";
  requestId: string;
  operation: string;
  payload: Record<string, unknown>;
};

type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", cb: (event: { data: unknown }) => void): void;
};

type GrokRuntimeEvent = Record<string, unknown> & { type: string };

type SessionState = {
  id: string;
  title: string;
  projectId: string;
  chapterId?: string;
  model?: string;
  runtime?: GrokAcpClient;
  runtimeKey?: string;
  runtimeSessionId?: string;
  activeRunId?: string;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("Grok 引擎必须作为 Electron utilityProcess 运行");

let startCommand: StartCommand | undefined;
let provider: GrokProviderConfiguration | undefined;
let providerGeneration = 0;
const sessions = new Map<string, SessionState>();

parentPort.on("message", (event) => {
  const command = event.data as Partial<
    StartCommand | ConfigureCommand | EngineRequest | { type: "stop" }
  >;
  if (command.type === "start") return void start(command as StartCommand);
  if (command.type === "configure")
    return void configure(command as ConfigureCommand);
  if (command.type === "request")
    return void handleRequest(command as EngineRequest);
  if (command.type === "stop") return void stop();
});

async function start(command: StartCommand): Promise<void> {
  try {
    if (!existsSync(command.binaryPath))
      throw new Error("Grok Build Runtime 不存在");
    await mkdir(command.sessionRoot, { recursive: true, mode: 0o700 });
    startCommand = command;
    provider = command.provider;
    providerGeneration = provider ? 1 : 0;
    parentPort!.postMessage({
      type: "ready",
      version: "1.0.5",
      configured: Boolean(provider && provider.providerKind !== "google"),
    });
  } catch (error) {
    parentPort!.postMessage({
      type: "unavailable",
      reason: publicMessage(error),
    });
  }
}

async function configure(command: ConfigureCommand): Promise<void> {
  provider = command.provider;
  providerGeneration += 1;
  if (startCommand) startCommand.provider = command.provider;
  try {
    await Promise.all(
      [...sessions.values()]
        .filter((session) => !session.activeRunId && session.runtime)
        .map(resetRuntime),
    );
    validateProvider(command.provider);
    parentPort!.postMessage({
      type: "configured",
      requestId: command.requestId,
      available: true,
      version: "1.0.5",
    });
  } catch (error) {
    if (command.provider.providerKind !== "google") provider = undefined;
    parentPort!.postMessage({
      type: "configured",
      requestId: command.requestId,
      available: false,
      error: publicMessage(error),
    });
  }
}

async function handleRequest(request: EngineRequest): Promise<void> {
  try {
    const result = await perform(request.operation, request.payload);
    parentPort!.postMessage({
      type: "response",
      requestId: request.requestId,
      result,
    });
  } catch (error) {
    parentPort!.postMessage({
      type: "response",
      requestId: request.requestId,
      error: publicMessage(error),
    });
  }
}

async function perform(
  operation: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (operation === "health")
    return {
      available: Boolean(provider && provider.providerKind !== "google"),
      version: "1.0.5",
    };
  if (operation === "createSession") {
    if (!provider || provider.providerKind === "google")
      throw new Error("Grok 不支持当前 Google/Gemini 服务商");
    const id = randomUUID();
    sessions.set(id, {
      id,
      title: String(payload.title ?? "DramaIP 智能任务"),
      projectId: String(payload.projectId ?? ""),
      ...(typeof payload.chapterId === "string"
        ? { chapterId: payload.chapterId }
        : {}),
      ...(selectedModel(payload) ? { model: selectedModel(payload) } : {}),
    });
    return { id };
  }
  if (operation === "run") return run(payload);
  if (operation === "interrupt") {
    const session = sessions.get(String(payload.engineSessionId ?? ""));
    if (session?.runtime) {
      const runtimeSessionId =
        session.runtimeSessionId ?? session.runtime.sessionId;
      if (runtimeSessionId)
        await session.runtime.cancelSession(runtimeSessionId);
    }
    return { ok: true };
  }
  if (operation === "fork") {
    const source = sessions.get(String(payload.engineSessionId ?? ""));
    if (!source) throw new Error("Grok 会话不存在");
    const id = randomUUID();
    const sourceRuntimeSessionId = source.runtime
      ? (source.runtimeSessionId ?? source.runtime.sessionId)
      : undefined;
    if (source.runtime && !sourceRuntimeSessionId)
      throw new Error("Grok ACP 源会话编号缺失");
    const forkedRuntimeSessionId = source.runtime
      ? await source.runtime.forkSession(sourceRuntimeSessionId!)
      : undefined;
    sessions.set(id, {
      id,
      title: `${source.title}（分支）`,
      projectId: source.projectId,
      ...(source.chapterId ? { chapterId: source.chapterId } : {}),
      ...(source.model ? { model: source.model } : {}),
      ...(source.runtime ? { runtime: source.runtime } : {}),
      ...(source.runtimeKey ? { runtimeKey: source.runtimeKey } : {}),
      ...(forkedRuntimeSessionId
        ? { runtimeSessionId: forkedRuntimeSessionId }
        : {}),
    });
    return { id };
  }
  if (operation === "dispose") {
    const id = String(payload.engineSessionId ?? "");
    const session = sessions.get(id);
    if (session) await resetRuntime(session);
    sessions.delete(id);
    return { ok: true };
  }
  throw new Error(`Grok 不支持操作：${operation}`);
}

async function run(payload: Record<string, unknown>): Promise<unknown> {
  const activeProvider = provider;
  const activeProviderGeneration = providerGeneration;
  if (!activeProvider || activeProvider.providerKind === "google")
    throw new Error("Grok 不支持当前 Google/Gemini 服务商");
  const sessionId = String(payload.engineSessionId ?? "");
  const runId = String(payload.runId ?? "");
  const prompt = String(payload.prompt ?? "");
  if (!sessionId || !runId || !prompt) throw new Error("Grok 运行参数不完整");
  let session = sessions.get(sessionId);
  if (!session) {
    const projectId = String(payload.projectId ?? "");
    if (!projectId) throw new Error("Grok 恢复检查点缺少项目编号");
    session = {
      id: sessionId,
      title: "已恢复的智能任务",
      projectId,
      ...(typeof payload.chapterId === "string"
        ? { chapterId: payload.chapterId }
        : {}),
    };
    sessions.set(sessionId, session);
  }
  if (session.activeRunId) throw new Error("Grok 会话正在执行另一项任务");
  const requestedModel = selectedModel(payload);
  const model = requestedModel ?? session.model ?? activeProvider.model;
  if (requestedModel) session.model = requestedModel;
  session.activeRunId = runId;
  try {
    const runtime = await ensureRuntime(
      session,
      activeProvider,
      model,
      activeProviderGeneration,
    );
    const runtimeSessionId = session.runtimeSessionId ?? runtime.sessionId;
    if (!runtimeSessionId) throw new Error("Grok ACP 会话编号缺失");
    return await runtime.runSession(
      runtimeSessionId,
      prompt,
      (event: GrokRuntimeEvent) =>
        parentPort!.postMessage({ type: "event", runId, event }),
    );
  } catch (error) {
    await resetRuntime(session);
    throw error;
  } finally {
    session.activeRunId = undefined;
  }
}

async function ensureRuntime(
  session: SessionState,
  configuration: GrokProviderConfiguration,
  model: string,
  generation: number,
): Promise<GrokAcpClient> {
  const command = startCommand;
  if (!command) throw new Error("Grok 引擎尚未初始化");
  const runtimeKey = JSON.stringify({
    providerKind: configuration.providerKind,
    baseUrl: configuration.baseUrl ?? "",
    model,
    generation,
  });
  if (session.runtime && session.runtimeKey === runtimeKey)
    return session.runtime;
  await resetRuntime(session);
  const sessionRoot = join(command.sessionRoot, session.id);
  const grokHome = join(sessionRoot, "grok-home");
  await mkdir(grokHome, { recursive: true, mode: 0o700 });
  await writeFile(
    join(grokHome, "config.toml"),
    grokConfig(configuration, model),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  const cwd = join(sessionRoot, "workspace");
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const runtime = new GrokAcpClient({
    binaryPath: command.binaryPath,
    cwd,
    grokHome,
    env: runtimeEnvironment(configuration, command.mcp.token, grokHome),
    mcp: command.mcp,
    model: "dramaip",
  });
  session.runtime = runtime;
  session.runtimeKey = runtimeKey;
  await runtime.start();
  session.runtimeSessionId = runtime.sessionId;
  return runtime;
}

async function resetRuntime(session: SessionState): Promise<void> {
  const runtime = session.runtime;
  session.runtime = undefined;
  session.runtimeKey = undefined;
  session.runtimeSessionId = undefined;
  if (
    runtime &&
    ![...sessions.values()].some(
      (other) => other !== session && other.runtime === runtime,
    )
  )
    await runtime.close();
}

async function stop(): Promise<void> {
  const command = startCommand;
  await Promise.allSettled([...sessions.values()].map(resetRuntime));
  sessions.clear();
  if (command) await rm(command.sessionRoot, { recursive: true, force: true });
  provider = undefined;
  providerGeneration = 0;
  startCommand = undefined;
  parentPort!.postMessage({ type: "stopped" });
  process.exit(0);
}

function runtimeEnvironment(
  configuration: GrokProviderConfiguration,
  mcpToken: string,
  grokHome: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TZ",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.HOME = grokHome;
  env.USERPROFILE = grokHome;
  env.GROK_HOME = grokHome;
  env.GROK_TELEMETRY_ENABLED = "0";
  env.GROK_TELEMETRY_TRACE_UPLOAD = "0";
  env.GROK_DISABLE_AUTOUPDATER = "1";
  env.DRAMAIP_GROK_PROVIDER_KEY = configuration.secret;
  env.DRAMAIP_MCP_TOKEN = mcpToken;
  return env;
}

function grokConfig(
  configuration: GrokProviderConfiguration,
  model: string,
): string {
  const backend =
    configuration.providerKind === "anthropic"
      ? "messages"
      : "chat_completions";
  const baseUrl = configuration.baseUrl?.trim().replace(/\/+$/, "");
  return [
    "[models]",
    'default = "dramaip"',
    "",
    "[features]",
    "telemetry = false",
    "",
    "[telemetry]",
    "trace_upload = false",
    "",
    "[model.dramaip]",
    `model = ${tomlString(model)}`,
    ...(baseUrl ? [`base_url = ${tomlString(baseUrl)}`] : []),
    `api_backend = ${tomlString(backend)}`,
    'env_key = "DRAMAIP_GROK_PROVIDER_KEY"',
    ...(configuration.providerKind === "anthropic"
      ? [
          'env_http_headers = { "x-api-key" = "DRAMAIP_GROK_PROVIDER_KEY" }',
          'extra_headers = { "anthropic-version" = "2023-06-01" }',
        ]
      : []),
    'agent_type = "grok-build"',
    "context_window = 200000",
    "",
  ].join("\n");
}

function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

function selectedModel(payload: Record<string, unknown>): string | undefined {
  const model = payload.model;
  if (model && typeof model === "object" && !Array.isArray(model)) {
    const id = (model as Record<string, unknown>).modelId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

function validateProvider(value: GrokProviderConfiguration): void {
  if (!value || !["openai", "anthropic", "google"].includes(value.providerKind))
    throw new Error("Grok 服务商类型无效");
  if (value.providerKind === "google")
    throw new Error("Grok 暂不支持 Google/Gemini 服务商");
  if (!value.model.trim() || !value.secret.trim())
    throw new Error("Grok 模型或凭据为空");
}

function publicMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [provider?.secret ?? "", startCommand?.mcp.token ?? ""])
    if (secret) message = message.split(secret).join("[REDACTED]");
  if (
    /401|unauthorized|invalid api.?key|authentication|credential/i.test(message)
  )
    return "Grok 模型调用失败：API Key 无效或已失效";
  if (/404|unknown model|model.*not found/i.test(message))
    return "Grok 模型调用失败：服务地址或模型名称不匹配";
  if (/429|rate.?limit|quota|balance/i.test(message))
    return "Grok 模型调用失败：调用频率受限或账户额度不足";
  return message || "Grok Runtime 调用失败";
}
