import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  DshRuntimeClient,
  sanitizeDshDiagnostic,
  type DshNormalizedEvent,
} from "./dsh-jsonrpc.ts";

type DshProviderConfiguration = {
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
};

type StartCommand = {
  type: "start";
  runtimeEntry: string;
  configDirectory: string;
  sessionRoot: string;
  mcp: { url: string; token: string };
  provider?: DshProviderConfiguration;
};

type ConfigureCommand = {
  type: "configure";
  requestId: string;
  provider: DshProviderConfiguration;
};

type EngineRequest = {
  type: "request";
  requestId: string;
  operation: string;
  payload: Record<string, unknown>;
};

type Command =
  | StartCommand
  | ConfigureCommand
  | EngineRequest
  | { type: "stop" };

type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", cb: (event: { data: unknown }) => void): void;
};

type SessionState = {
  id: string;
  title: string;
  projectId: string;
  chapterId?: string;
  model?: string;
  runtime?: DshRuntimeClient;
  runtimeKey?: string;
  activeRunId?: string;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("DSH 引擎必须作为 Electron utilityProcess 运行");

let startCommand: StartCommand | undefined;
let provider: DshProviderConfiguration | undefined;
let providerGeneration = 0;
const sessions = new Map<string, SessionState>();

parentPort.on("message", (event) => {
  const command = event.data as Partial<Command>;
  if (command.type === "start") return void start(command as StartCommand);
  if (command.type === "configure")
    return void configure(command as ConfigureCommand);
  if (command.type === "request")
    return void handleRequest(command as EngineRequest);
  if (command.type === "stop") return void stop();
});

async function start(command: StartCommand): Promise<void> {
  try {
    if (!existsSync(command.runtimeEntry))
      throw new Error("DSH Runtime 入口不存在");
    if (!existsSync(command.configDirectory))
      throw new Error("DSH 受控配置目录不存在");
    startCommand = command;
    provider = command.provider;
    providerGeneration = provider ? 1 : 0;
    await mkdir(command.sessionRoot, { recursive: true, mode: 0o700 });
    parentPort!.postMessage({
      type: "ready",
      version: "0.1.0-rc.5",
      configured: Boolean(provider),
    });
  } catch (error) {
    parentPort!.postMessage({
      type: "unavailable",
      reason: publicMessage(error),
    });
  }
}

async function configure(command: ConfigureCommand): Promise<void> {
  try {
    validateProvider(command.provider);
    provider = command.provider;
    providerGeneration += 1;
    if (startCommand) startCommand.provider = command.provider;
    await Promise.all(
      [...sessions.values()]
        .filter((session) => !session.activeRunId && session.runtime)
        .map((session) => resetRuntime(session)),
    );
    parentPort!.postMessage({
      type: "configured",
      requestId: command.requestId,
      available: true,
      version: "0.1.0-rc.5",
    });
  } catch (error) {
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
    return { available: Boolean(provider), version: "0.1.0-rc.5" };
  if (operation === "createSession") {
    if (!provider) throw new Error("DSH 模型尚未配置");
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
    if (session) await resetRuntime(session);
    return { ok: true };
  }
  if (operation === "fork") {
    const source = sessions.get(String(payload.engineSessionId ?? ""));
    if (!source) throw new Error("DSH 会话不存在");
    const id = randomUUID();
    sessions.set(id, {
      id,
      title: `${source.title}（分支）`,
      projectId: source.projectId,
      ...(source.chapterId ? { chapterId: source.chapterId } : {}),
      ...(source.model ? { model: source.model } : {}),
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
  throw new Error(`DSH 不支持操作：${operation}`);
}

async function run(payload: Record<string, unknown>): Promise<unknown> {
  const activeProvider = provider;
  const activeProviderGeneration = providerGeneration;
  if (!activeProvider) throw new Error("DSH 模型尚未配置");
  const sessionId = String(payload.engineSessionId ?? "");
  const runId = String(payload.runId ?? "");
  const prompt = String(payload.prompt ?? "");
  if (!sessionId || !runId || !prompt) throw new Error("DSH 运行参数不完整");
  let session = sessions.get(sessionId);
  if (!session) {
    const projectId = String(payload.projectId ?? "");
    if (!projectId) throw new Error("DSH 恢复检查点缺少项目编号");
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
  if (session.activeRunId) throw new Error("DSH 会话正在执行另一项任务");
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
    return await runtime.run(session.id, prompt, (event) =>
      emitRunEvent(runId, event),
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
  configuration: DshProviderConfiguration,
  model: string,
  generation: number,
): Promise<DshRuntimeClient> {
  const command = startCommand;
  if (!command) throw new Error("DSH 引擎尚未初始化");
  const runtimeKey = JSON.stringify({
    providerKind: configuration.providerKind,
    baseUrl: configuration.baseUrl ?? "",
    model,
    generation,
  });
  if (session.runtime && session.runtimeKey === runtimeKey)
    return session.runtime;
  await resetRuntime(session);
  const configPath = join(
    command.configDirectory,
    `${configuration.providerKind}.cordis.yml`,
  );
  if (!existsSync(configPath)) throw new Error("DSH 当前服务商配置不存在");
  const cwd = join(command.sessionRoot, session.id);
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const runtime = new DshRuntimeClient({
    command: process.execPath,
    args: [command.runtimeEntry, configPath],
    cwd,
    env: runtimeEnvironment(command, configuration, model),
  });
  session.runtime = runtime;
  session.runtimeKey = runtimeKey;
  await runtime.start({
    cwd,
    provider: configuration.providerKind,
    model,
  });
  return runtime;
}

function runtimeEnvironment(
  command: StartCommand,
  configuration: DshProviderConfiguration,
  model: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
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
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.ELECTRON_RUN_AS_NODE = "1";
  env.DRAMAIP_DSH_API_KEY = configuration.secret;
  env.DRAMAIP_DSH_MODEL = model;
  if (configuration.baseUrl) env.DRAMAIP_DSH_BASE_URL = configuration.baseUrl;
  env.DRAMAIP_MCP_URL = command.mcp.url;
  env.DRAMAIP_MCP_TOKEN = command.mcp.token;
  return env;
}

async function resetRuntime(session: SessionState): Promise<void> {
  const runtime = session.runtime;
  session.runtime = undefined;
  session.runtimeKey = undefined;
  if (runtime) await runtime.close();
}

function selectedModel(payload: Record<string, unknown>): string | undefined {
  const model =
    payload.model && typeof payload.model === "object"
      ? String((payload.model as Record<string, unknown>).modelId ?? "").trim()
      : "";
  return model || undefined;
}

function validateProvider(configuration: DshProviderConfiguration): void {
  if (!configuration.secret || !configuration.model)
    throw new Error("DSH 模型配置或安全凭据不可用");
  if (
    !(["openai", "anthropic", "google"] as const).includes(
      configuration.providerKind,
    )
  )
    throw new Error("DSH 不支持当前模型协议");
  if (configuration.baseUrl) {
    const url = new URL(configuration.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("DSH 服务地址必须是无账号密码的 HTTP 或 HTTPS 地址");
  }
}

function emitRunEvent(runId: string, event: DshNormalizedEvent): void {
  parentPort!.postMessage({ type: "event", runId, event });
}

function publicMessage(error: unknown): string {
  const message = sanitizeDshDiagnostic(
    error instanceof Error ? error.message : String(error),
  );
  if (/401|unauthorized|authentication|credential|api.?key/i.test(message))
    return "DSH 模型调用失败：API Key 无效或已失效";
  if (/404|unknown model|model.*not found/i.test(message))
    return "DSH 模型调用失败：服务地址或模型名称不匹配";
  if (/429|rate.?limit|quota|balance/i.test(message))
    return "DSH 模型调用失败：调用频率受限或账户额度不足";
  return message || "DSH Runtime 调用失败";
}

async function stop(): Promise<void> {
  await Promise.allSettled([...sessions.values()].map(resetRuntime));
  sessions.clear();
  provider = undefined;
  providerGeneration = 0;
  startCommand = undefined;
  parentPort!.postMessage({ type: "stopped" });
  process.exit(0);
}
