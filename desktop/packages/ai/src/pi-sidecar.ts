import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type PiProviderConfiguration = {
  providerKind: "openai" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
};

type StartCommand = {
  type: "start";
  runtimeModule: string;
  sessionRoot: string;
  mcp: { url: string; token: string };
  provider?: PiProviderConfiguration;
};

type ConfigureCommand = {
  type: "configure";
  requestId: string;
  provider: PiProviderConfiguration;
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

type PiRuntimeEvent =
  | { type: "activity"; activity: "thinking" }
  | { type: "content.delta"; delta: string }
  | {
      type: "tool";
      status: "started" | "completed" | "failed";
      tool: string;
      itemId: string;
      arguments?: unknown;
      result?: unknown;
      error?: string;
    }
  | {
      type: "usage";
      measurementScope?: "response-increment";
      inputAccounting?: "excludes-cache";
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
    };

type PiRuntimeSession = {
  run(
    prompt: string,
    onEvent: (event: PiRuntimeEvent) => void,
  ): Promise<{ text: string }>;
  steer(prompt: string): Promise<void>;
  compact(): Promise<void>;
  abort(): Promise<void>;
  close(): Promise<void>;
};

type PiRuntimeModule = {
  createPiSession(options: {
    sessionId: string;
    provider: PiProviderConfiguration;
    mcp: { url: string; token: string };
  }): Promise<PiRuntimeSession>;
};

type SessionState = {
  id: string;
  title: string;
  projectId: string;
  chapterId?: string;
  model?: string;
  runtime?: PiRuntimeSession;
  runtimeKey?: string;
  activeRunId?: string;
  capabilityGrant?: { endpoint: string; token: string; expiresAt: string };
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
const runtimeVersions = process.versions as Record<string, string | undefined>;
if (!parentPort || !runtimeVersions.electron || Boolean(runtimeVersions.bun))
  throw new Error("Pi 引擎必须作为 Electron utilityProcess 运行");

let startCommand: StartCommand | undefined;
let provider: PiProviderConfiguration | undefined;
let providerGeneration = 0;
let runtimeModule: PiRuntimeModule | undefined;
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
    if (!existsSync(command.runtimeModule))
      throw new Error("Pi Runtime 入口不存在");
    await mkdir(command.sessionRoot, { recursive: true, mode: 0o700 });
    const imported = (await import(
      pathToFileURL(command.runtimeModule).href
    )) as Partial<PiRuntimeModule>;
    if (typeof imported.createPiSession !== "function")
      throw new Error("Pi Runtime 缺少 createPiSession 导出");
    startCommand = command;
    runtimeModule = imported as PiRuntimeModule;
    provider = command.provider;
    providerGeneration = provider ? 1 : 0;
    parentPort!.postMessage({
      type: "ready",
      version: "1.4.0",
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
        .map(resetRuntime),
    );
    parentPort!.postMessage({
      type: "configured",
      requestId: command.requestId,
      available: true,
      version: "1.4.0",
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
    return { available: Boolean(provider), version: "1.4.0" };
  if (operation === "createSession") {
    if (!provider) throw new Error("Pi 模型尚未配置");
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
    await persistSession(sessions.get(id)!);
    return { id };
  }
  if (operation === "run") return run(payload);
  if (operation === "recoverRun") return recoverRun(payload);
  if (operation === "interrupt" || operation === "cancel") {
    const session = sessionForPayload(payload);
    if (session?.runtime) await session.runtime.abort();
    return { ok: true };
  }
  if (operation === "steer") {
    const session = sessionForPayload(payload);
    const prompt = String(payload.prompt ?? "").trim();
    if (!session?.runtime) throw new Error("Pi 没有可引导的活动会话");
    if (!prompt) throw new Error("Pi 引导消息为空");
    await session.runtime.steer(prompt);
    return { ok: true };
  }
  if (operation === "compact") {
    const session = sessionForPayload(payload);
    if (!session?.runtime) throw new Error("Pi 没有可压缩的活动会话");
    await session.runtime.compact();
    return { ok: true };
  }
  if (operation === "resume") {
    const id = String(payload.engineSessionId ?? "");
    const session = await restoreSession(id);
    if (!session) throw new Error("Pi 会话检查点不存在");
    return { id: session.id };
  }
  if (operation === "fork") {
    const source = sessions.get(String(payload.engineSessionId ?? ""));
    if (!source) throw new Error("Pi 会话不存在");
    const id = randomUUID();
    sessions.set(id, {
      id,
      title: `${source.title}（分支）`,
      projectId: source.projectId,
      ...(source.chapterId ? { chapterId: source.chapterId } : {}),
      ...(source.model ? { model: source.model } : {}),
    });
    await persistSession(sessions.get(id)!);
    return { id };
  }
  if (operation === "dispose") {
    const id = String(payload.engineSessionId ?? "");
    const session = sessions.get(id);
    if (session) await resetRuntime(session);
    sessions.delete(id);
    await removeSessionCheckpoint(id);
    return { ok: true };
  }
  throw new Error(`Pi 不支持操作：${operation}`);
}

async function run(payload: Record<string, unknown>): Promise<unknown> {
  const activeProvider = provider;
  const activeProviderGeneration = providerGeneration;
  if (!activeProvider) throw new Error("Pi 模型尚未配置");
  const sessionId = String(payload.engineSessionId ?? "");
  const runId = String(payload.runId ?? "");
  const prompt = String(payload.prompt ?? "");
  if (!sessionId || !runId || !prompt) throw new Error("Pi 运行参数不完整");
  let session = sessions.get(sessionId) ?? (await restoreSession(sessionId));
  if (!session) {
    const projectId = String(payload.projectId ?? "");
    if (!projectId) throw new Error("Pi 恢复检查点缺少项目编号");
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
  if (session.activeRunId) throw new Error("Pi 会话正在执行另一项任务");
  const requestedModel = selectedModel(payload);
  const model = requestedModel ?? session.model ?? activeProvider.model;
  if (requestedModel) session.model = requestedModel;
  const capabilityGrant = capabilityGrantFrom(payload);
  if (capabilityGrant) session.capabilityGrant = capabilityGrant;
  await persistSession(session);
  session.activeRunId = runId;
  try {
    const runtime = await ensureRuntime(
      session,
      activeProvider,
      model,
      activeProviderGeneration,
    );
    const result = await runtime.run(prompt, (event) =>
      parentPort!.postMessage({ type: "event", runId, event }),
    );
    await persistRunResult(runId, result);
    return result;
  } catch (error) {
    await resetRuntime(session);
    throw error;
  } finally {
    session.activeRunId = undefined;
  }
}

async function persistRunResult(runId: string, result: unknown): Promise<void> {
  if (!startCommand || !/^[A-Za-z0-9._-]{1,200}$/u.test(runId)) return;
  const directory = join(startCommand.sessionRoot, "run-results");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, `${runId}.json`), JSON.stringify(result), {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function recoverRun(payload: Record<string, unknown>): Promise<unknown> {
  if (!startCommand) return { disposition: "missing" };
  const runId = String(payload.runId ?? "");
  if (!/^[A-Za-z0-9._-]{1,200}$/u.test(runId))
    return { disposition: "missing" };
  try {
    return {
      disposition: "completed",
      result: JSON.parse(
        await readFile(
          join(startCommand.sessionRoot, "run-results", `${runId}.json`),
          "utf8",
        ),
      ),
      finalCursor: Number(payload.afterCursor ?? 0) + 1,
    };
  } catch {
    return { disposition: "missing" };
  }
}

async function ensureRuntime(
  session: SessionState,
  configuration: PiProviderConfiguration,
  model: string,
  generation: number,
): Promise<PiRuntimeSession> {
  const command = startCommand;
  const module = runtimeModule;
  if (!command || !module) throw new Error("Pi 引擎尚未初始化");
  const runtimeKey = JSON.stringify({
    providerKind: configuration.providerKind,
    baseUrl: configuration.baseUrl ?? "",
    model,
    generation,
  });
  if (session.runtime && session.runtimeKey === runtimeKey)
    return session.runtime;
  await resetRuntime(session);
  const runtime = await module.createPiSession({
    sessionId: session.id,
    provider: { ...configuration, model },
    mcp: session.capabilityGrant
      ? {
          url: session.capabilityGrant.endpoint || command.mcp.url,
          token: session.capabilityGrant.token,
        }
      : command.mcp,
  });
  session.runtime = runtime;
  session.runtimeKey = runtimeKey;
  return runtime;
}

async function resetRuntime(session: SessionState): Promise<void> {
  const runtime = session.runtime;
  session.runtime = undefined;
  session.runtimeKey = undefined;
  if (runtime) await runtime.close();
}

async function stop(): Promise<void> {
  await Promise.allSettled([...sessions.values()].map(resetRuntime));
  sessions.clear();
  // Session metadata is intentionally retained so a Host-supervised Pi
  // process can reattach after restart. Individual sessions are removed only
  // through the explicit dispose operation.
  provider = undefined;
  providerGeneration = 0;
  runtimeModule = undefined;
  startCommand = undefined;
  parentPort!.postMessage({ type: "stopped" });
  process.exit(0);
}

function sessionForPayload(
  payload: Record<string, unknown>,
): SessionState | undefined {
  const sessionId = String(payload.engineSessionId ?? "");
  if (sessionId) return sessions.get(sessionId);
  const runId = String(payload.runId ?? "");
  return runId
    ? [...sessions.values()].find((session) => session.activeRunId === runId)
    : undefined;
}

function capabilityGrantFrom(
  payload: Record<string, unknown>,
): SessionState["capabilityGrant"] | undefined {
  const value = payload.capabilityGrant;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.endpoint !== "string" ||
    typeof record.token !== "string" ||
    typeof record.expiresAt !== "string"
  )
    return undefined;
  return {
    endpoint: record.endpoint,
    token: record.token,
    expiresAt: record.expiresAt,
  };
}

async function persistSession(session: SessionState): Promise<void> {
  if (!startCommand) return;
  // Provider secrets and per-run grants never enter this checkpoint.
  const checkpoint = {
    id: session.id,
    title: session.title,
    projectId: session.projectId,
    ...(session.chapterId ? { chapterId: session.chapterId } : {}),
    ...(session.model ? { model: session.model } : {}),
  };
  await writeFile(
    join(startCommand.sessionRoot, `${session.id}.json`),
    JSON.stringify(checkpoint),
    { encoding: "utf8", mode: 0o600 },
  );
}

async function restoreSession(id: string): Promise<SessionState | undefined> {
  if (!id || sessions.has(id) || !startCommand) return sessions.get(id);
  try {
    const value = JSON.parse(
      await readFile(join(startCommand.sessionRoot, `${id}.json`), "utf8"),
    ) as Record<string, unknown>;
    if (
      value.id !== id ||
      typeof value.title !== "string" ||
      typeof value.projectId !== "string"
    )
      return undefined;
    const session: SessionState = {
      id,
      title: value.title,
      projectId: value.projectId,
      ...(typeof value.chapterId === "string"
        ? { chapterId: value.chapterId }
        : {}),
      ...(typeof value.model === "string" ? { model: value.model } : {}),
    };
    sessions.set(id, session);
    return session;
  } catch {
    return undefined;
  }
}

async function removeSessionCheckpoint(id: string): Promise<void> {
  if (!startCommand || !id) return;
  await rm(join(startCommand.sessionRoot, `${id}.json`), { force: true });
}

function selectedModel(payload: Record<string, unknown>): string | undefined {
  const model = payload.model;
  if (model && typeof model === "object" && !Array.isArray(model)) {
    const id = (model as Record<string, unknown>).modelId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

function validateProvider(value: PiProviderConfiguration): void {
  if (!value || !["openai", "anthropic", "google"].includes(value.providerKind))
    throw new Error("Pi 服务商类型无效");
  if (!value.model.trim() || !value.secret.trim())
    throw new Error("Pi 模型或凭据为空");
}

function publicMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [provider?.secret ?? "", startCommand?.mcp.token ?? ""])
    if (secret) message = message.split(secret).join("[REDACTED]");
  if (/401|unauthorized|authentication|credential|api.?key/i.test(message))
    return "Pi 模型调用失败：API Key 无效或已失效";
  if (/404|unknown model|model.*not found/i.test(message))
    return "Pi 模型调用失败：服务地址或模型名称不匹配";
  if (/429|rate.?limit|quota|balance/i.test(message))
    return "Pi 模型调用失败：调用频率受限或账户额度不足";
  return message || "Pi Runtime 调用失败";
}
