import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { HermesAcpClient, sanitizeHermesDiagnostic } from "./hermes-acp";

type ProviderConfiguration = {
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
};
type StartCommand = {
  type: "start";
  pythonPath: string;
  adapterPath: string;
  projectRoot: string;
  sitePackages: string;
  sessionRoot: string;
  mcp: { url: string; token: string };
  provider?: ProviderConfiguration;
};
type ConfigureCommand = {
  type: "configure";
  requestId: string;
  provider: ProviderConfiguration;
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
type SessionState = {
  id: string;
  title: string;
  projectId: string;
  chapterId?: string;
  model?: string;
  runtime?: HermesAcpClient;
  runtimeKey?: string;
  activeRunId?: string;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("Hermes 引擎必须作为 Electron utilityProcess 运行");

let startCommand: StartCommand | undefined;
let provider: ProviderConfiguration | undefined;
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
    for (const [path, label] of [
      [command.pythonPath, "Python Runtime"],
      [command.adapterPath, "Hermes ACP 适配器"],
      [command.projectRoot, "Hermes Runtime"],
      [command.sitePackages, "Hermes Python 依赖闭包"],
    ] as const)
      if (!existsSync(path)) throw new Error(`${label} 不存在`);
    await mkdir(command.sessionRoot, { recursive: true, mode: 0o700 });
    startCommand = command;
    provider = command.provider;
    parentPort!.postMessage({
      type: "ready",
      version: "0.20.1",
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
    if (startCommand) startCommand.provider = command.provider;
    await Promise.all(
      [...sessions.values()]
        .filter((session) => !session.activeRunId && session.runtime)
        .map(resetRuntime),
    );
    parentPort!.postMessage({
      type: "configured",
      requestId: command.requestId,
      available: true,
      version: "0.20.1",
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
    return { available: Boolean(provider), version: "0.20.1" };
  if (operation === "createSession") {
    if (!provider) throw new Error("Hermes 模型尚未配置");
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
    if (!source) throw new Error("Hermes 会话不存在");
    const id = randomUUID();
    sessions.set(id, {
      ...source,
      id,
      title: `${source.title}（分支）`,
      runtime: undefined,
      runtimeKey: undefined,
      activeRunId: undefined,
    });
    return { id };
  }
  if (operation === "dispose") {
    const id = String(payload.engineSessionId ?? "");
    const session = sessions.get(id);
    if (session) await resetRuntime(session);
    sessions.delete(id);
    if (startCommand)
      await rm(join(startCommand.sessionRoot, id), {
        recursive: true,
        force: true,
      });
    return { ok: true };
  }
  throw new Error(`Hermes 不支持操作：${operation}`);
}

async function run(payload: Record<string, unknown>): Promise<unknown> {
  const activeProvider = provider;
  if (!activeProvider) throw new Error("Hermes 模型尚未配置");
  const sessionId = String(payload.engineSessionId ?? "");
  const runId = String(payload.runId ?? "");
  const prompt = String(payload.prompt ?? "");
  if (!sessionId || !runId || !prompt) throw new Error("Hermes 运行参数不完整");
  let session = sessions.get(sessionId);
  if (!session) {
    const projectId = String(payload.projectId ?? "");
    if (!projectId) throw new Error("Hermes 恢复检查点缺少项目编号");
    session = { id: sessionId, title: "已恢复的智能任务", projectId };
    sessions.set(sessionId, session);
  }
  if (session.activeRunId) throw new Error("Hermes 会话正在执行另一项任务");
  const requestedModel = selectedModel(payload);
  const model = requestedModel ?? session.model ?? activeProvider.model;
  if (requestedModel) session.model = requestedModel;
  session.activeRunId = runId;
  try {
    const runtime = await ensureRuntime(session, activeProvider, model);
    return await runtime.run(prompt, (event) =>
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
  configuration: ProviderConfiguration,
  model: string,
): Promise<HermesAcpClient> {
  const command = startCommand;
  if (!command) throw new Error("Hermes 引擎尚未初始化");
  const runtimeKey = JSON.stringify({
    providerKind: configuration.providerKind,
    baseUrl: configuration.baseUrl ?? "",
    model,
  });
  if (session.runtime && session.runtimeKey === runtimeKey)
    return session.runtime;
  await resetRuntime(session);
  const cwd = join(command.sessionRoot, session.id);
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  const runtime = new HermesAcpClient({
    pythonPath: command.pythonPath,
    adapterPath: command.adapterPath,
    projectRoot: command.projectRoot,
    cwd,
    env: runtimeEnvironment(command, configuration, model, cwd),
    mcp: command.mcp,
  });
  session.runtime = runtime;
  session.runtimeKey = runtimeKey;
  await runtime.start();
  return runtime;
}

function runtimeEnvironment(
  command: StartCommand,
  configuration: ProviderConfiguration,
  model: string,
  cwd: string,
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
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.PYTHONPATH = [command.projectRoot, command.sitePackages].join(
    process.platform === "win32" ? ";" : ":",
  );
  env.PYTHONNOUSERSITE = "1";
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.HERMES_HOME = join(cwd, ".hermes");
  env.HERMES_ACP_SKIP_CONFIGURED_MCP = "1";
  env.HERMES_DISABLE_LAZY_INSTALLS = "1";
  env.DRAMAIP_HERMES_PROVIDER = configuration.providerKind;
  env.DRAMAIP_HERMES_MODEL = model;
  env.DRAMAIP_HERMES_API_KEY = configuration.secret;
  env.DRAMAIP_HERMES_BASE_URL = configuration.baseUrl ?? "";
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

async function stop(): Promise<void> {
  await Promise.all([...sessions.values()].map(resetRuntime));
  sessions.clear();
  if (startCommand)
    await rm(startCommand.sessionRoot, { recursive: true, force: true });
  parentPort!.postMessage({ type: "stopped" });
  process.exit(0);
}

function selectedModel(payload: Record<string, unknown>): string | undefined {
  const model = payload.model;
  if (model && typeof model === "object" && !Array.isArray(model)) {
    const id = (model as Record<string, unknown>).modelId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

function validateProvider(value: ProviderConfiguration): void {
  if (!value || !["openai", "anthropic", "google"].includes(value.providerKind))
    throw new Error("Hermes 服务商类型无效");
  if (!value.model.trim() || !value.secret.trim())
    throw new Error("Hermes 模型或凭据为空");
}

function publicMessage(error: unknown): string {
  return sanitizeHermesDiagnostic(
    error instanceof Error ? error.message : String(error),
    [provider?.secret ?? "", startCommand?.mcp.token ?? ""],
  );
}
