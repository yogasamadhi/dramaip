import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  OpenClawGatewayClient,
  sanitizeOpenClawDiagnostic,
} from "./openclaw-gateway";
import {
  restrictedOpenClawConfiguration,
  type OpenClawProviderConfiguration,
} from "./openclaw-config";

type ProviderConfiguration = OpenClawProviderConfiguration;
type StartCommand = {
  type: "start";
  runtimeEntry: string;
  stateRoot: string;
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
  activeRunId?: string;
  activeSessionKey?: string;
  generationId?: string;
};
type GatewayGeneration = {
  id: string;
  key: string;
  directory: string;
  client: OpenClawGatewayClient;
  activeRuns: number;
  stale: boolean;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("OpenClaw 引擎必须作为 Electron utilityProcess 运行");

let startCommand: StartCommand | undefined;
let provider: ProviderConfiguration | undefined;
let providerRevision = 0;
const sessions = new Map<string, SessionState>();
const generations = new Map<string, GatewayGeneration>();

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
    if (!existsSync(command.runtimeEntry))
      throw new Error("OpenClaw Runtime 入口不存在");
    await mkdir(command.stateRoot, { recursive: true, mode: 0o700 });
    startCommand = command;
    provider = command.provider;
    parentPort!.postMessage({
      type: "ready",
      version: "2026.7.1",
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
    providerRevision += 1;
    if (startCommand) startCommand.provider = command.provider;
    for (const generation of generations.values()) generation.stale = true;
    await reapGenerations();
    parentPort!.postMessage({
      type: "configured",
      requestId: command.requestId,
      available: true,
      version: "2026.7.1",
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
    return { available: Boolean(provider), version: "2026.7.1" };
  if (operation === "createSession") {
    if (!provider) throw new Error("OpenClaw 模型尚未配置");
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
    if (
      session?.activeRunId &&
      session.activeSessionKey &&
      session.generationId
    ) {
      const generation = generations.get(session.generationId);
      if (generation)
        await generation.client.abort(
          session.activeSessionKey,
          session.activeRunId,
        );
    }
    return { ok: true };
  }
  if (operation === "fork") {
    const source = sessions.get(String(payload.engineSessionId ?? ""));
    if (!source) throw new Error("OpenClaw 会话不存在");
    const id = randomUUID();
    sessions.set(id, {
      ...source,
      id,
      title: `${source.title}（分支）`,
      activeRunId: undefined,
      activeSessionKey: undefined,
      generationId: undefined,
    });
    return { id };
  }
  if (operation === "dispose") {
    const id = String(payload.engineSessionId ?? "");
    const session = sessions.get(id);
    if (
      session?.activeRunId &&
      session.activeSessionKey &&
      session.generationId
    ) {
      const generation = generations.get(session.generationId);
      if (generation)
        await generation.client.abort(
          session.activeSessionKey,
          session.activeRunId,
        );
    }
    sessions.delete(id);
    return { ok: true };
  }
  throw new Error(`OpenClaw 不支持操作：${operation}`);
}

async function run(payload: Record<string, unknown>): Promise<unknown> {
  const activeProvider = provider;
  if (!activeProvider) throw new Error("OpenClaw 模型尚未配置");
  const sessionId = String(payload.engineSessionId ?? "");
  const runId = String(payload.runId ?? "");
  const prompt = String(payload.prompt ?? "");
  if (!sessionId || !runId || !prompt)
    throw new Error("OpenClaw 运行参数不完整");
  let session = sessions.get(sessionId);
  if (!session) {
    const projectId = String(payload.projectId ?? "");
    if (!projectId) throw new Error("OpenClaw 恢复检查点缺少项目编号");
    session = { id: sessionId, title: "已恢复的智能任务", projectId };
    sessions.set(sessionId, session);
  }
  if (session.activeRunId) throw new Error("OpenClaw 会话正在执行另一项任务");
  const requestedModel = selectedModel(payload);
  const model = requestedModel ?? session.model ?? activeProvider.model;
  const generation = await ensureGeneration(activeProvider, model);
  const sessionKey = `agent:main:${session.id}`;
  if (requestedModel) session.model = requestedModel;
  session.activeRunId = runId;
  session.activeSessionKey = sessionKey;
  session.generationId = generation.id;
  generation.activeRuns += 1;
  try {
    return await generation.client.run({ runId, sessionKey, prompt }, (event) =>
      parentPort!.postMessage({ type: "event", runId, event }),
    );
  } catch (error) {
    generation.stale = true;
    throw error;
  } finally {
    generation.activeRuns -= 1;
    session.activeRunId = undefined;
    session.activeSessionKey = undefined;
    session.generationId = undefined;
    await reapGenerations();
  }
}

async function ensureGeneration(
  configuration: ProviderConfiguration,
  model: string,
): Promise<GatewayGeneration> {
  const command = startCommand;
  if (!command) throw new Error("OpenClaw 引擎尚未初始化");
  const key = JSON.stringify({
    revision: providerRevision,
    providerKind: configuration.providerKind,
    baseUrl: configuration.baseUrl ?? "",
    model,
  });
  const existing = [...generations.values()].find(
    (generation) => generation.key === key && !generation.stale,
  );
  if (existing) return existing;
  const id = randomUUID();
  const directory = join(command.stateRoot, id);
  const stateDirectory = join(directory, "state");
  const workspace = join(directory, "workspace");
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  const configPath = join(directory, "openclaw.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      restrictedOpenClawConfiguration(
        command.mcp,
        configuration,
        model,
        workspace,
      ),
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  const port = await reserveLoopbackPort();
  const token = randomUUID();
  const client = new OpenClawGatewayClient({
    command: process.execPath,
    entryPath: command.runtimeEntry,
    cwd: directory,
    stateDirectory,
    configPath,
    port,
    token,
    env: runtimeEnvironment(
      command,
      configuration,
      stateDirectory,
      configPath,
      token,
    ),
  });
  const generation: GatewayGeneration = {
    id,
    key,
    directory,
    client,
    activeRuns: 0,
    stale: false,
  };
  generations.set(id, generation);
  try {
    await client.start();
    return generation;
  } catch (error) {
    generations.delete(id);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function runtimeEnvironment(
  command: StartCommand,
  configuration: ProviderConfiguration,
  stateDirectory: string,
  configPath: string,
  gatewayToken: string,
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
    "NODE_EXTRA_CA_CERTS",
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.ELECTRON_RUN_AS_NODE = "1";
  env.OPENCLAW_STATE_DIR = stateDirectory;
  env.OPENCLAW_CONFIG_PATH = configPath;
  env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  env.OPENCLAW_LOG_LEVEL = "warn";
  env.DRAMAIP_OPENCLAW_API_KEY = configuration.secret;
  env.DRAMAIP_MCP_TOKEN = command.mcp.token;
  return env;
}

async function reapGenerations(): Promise<void> {
  await Promise.all(
    [...generations.values()]
      .filter((generation) => generation.stale && generation.activeRuns === 0)
      .map(async (generation) => {
        generations.delete(generation.id);
        await generation.client.close();
        await rm(generation.directory, { recursive: true, force: true });
      }),
  );
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("无法分配 OpenClaw Gateway 端口"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function stop(): Promise<void> {
  await Promise.all(
    [...sessions.values()]
      .filter(
        (session) =>
          session.activeRunId &&
          session.activeSessionKey &&
          session.generationId,
      )
      .map(async (session) => {
        const generation = generations.get(session.generationId!);
        if (generation)
          await generation.client
            .abort(session.activeSessionKey!, session.activeRunId!)
            .catch(() => {});
      }),
  );
  await Promise.all(
    [...generations.values()].map(async (generation) => {
      await generation.client.close();
      await rm(generation.directory, { recursive: true, force: true });
    }),
  );
  generations.clear();
  sessions.clear();
  if (startCommand)
    await rm(startCommand.stateRoot, { recursive: true, force: true });
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
    throw new Error("OpenClaw 服务商类型无效");
  if (!value.model.trim() || !value.secret.trim())
    throw new Error("OpenClaw 模型或凭据为空");
}

function publicMessage(error: unknown): string {
  return sanitizeOpenClawDiagnostic(
    error instanceof Error ? error.message : String(error),
    [provider?.secret ?? "", startCommand?.mcp.token ?? ""],
  );
}
