import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runLangGraphWorkflow,
  type LangGraphProviderConfiguration,
} from "./langgraph-engine";

type StartCommand = {
  type: "start";
  sessionRoot: string;
  provider?: LangGraphProviderConfiguration;
};
type ConfigureCommand = {
  type: "configure";
  requestId: string;
  provider: LangGraphProviderConfiguration;
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
type HistoryItem = { role: "user" | "assistant"; content: string };
type SessionState = {
  id: string;
  title: string;
  projectId: string;
  chapterId?: string;
  model?: string;
  history: HistoryItem[];
  activeRunId?: string;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
const runtimeVersions = process.versions as Record<string, string | undefined>;
if (!parentPort || !runtimeVersions.electron || Boolean(runtimeVersions.bun))
  throw new Error("LangGraph 引擎必须作为 Electron utilityProcess 运行");

let startCommand: StartCommand | undefined;
let provider: LangGraphProviderConfiguration | undefined;
const sessions = new Map<string, SessionState>();
const activeRuns = new Map<
  string,
  { controller: AbortController; sessionId: string }
>();

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
    await mkdir(command.sessionRoot, { recursive: true, mode: 0o700 });
    await mkdir(join(command.sessionRoot, "run-results"), {
      recursive: true,
      mode: 0o700,
    });
    startCommand = command;
    provider = command.provider;
    if (provider) validateProvider(provider);
    parentPort!.postMessage({
      type: "ready",
      version: "1.4.9",
      configured: Boolean(provider),
      authenticated: Boolean(provider),
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
    parentPort!.postMessage({
      type: "configured",
      requestId: command.requestId,
      available: true,
      version: "1.4.9",
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
  if (operation === "health" || operation === "availability")
    return {
      available: Boolean(provider),
      healthy: true,
      configured: Boolean(provider),
      authenticated: Boolean(provider),
      version: "1.4.9",
    };
  if (operation === "createSession") {
    if (!provider) throw new Error("LangGraph 模型尚未配置");
    const id = randomUUID();
    const session: SessionState = {
      id,
      title: String(payload.title ?? "DramaIP 智能任务"),
      projectId: String(payload.projectId ?? ""),
      ...(typeof payload.chapterId === "string"
        ? { chapterId: payload.chapterId }
        : {}),
      ...(selectedModel(payload) ? { model: selectedModel(payload) } : {}),
      history: [],
    };
    sessions.set(id, session);
    await persistSession(session);
    return { id };
  }
  if (operation === "run") return run(payload);
  if (operation === "recoverRun") return recoverRun(payload);
  if (operation === "interrupt" || operation === "cancel") {
    const runId = String(payload.runId ?? "");
    if (runId) activeRuns.get(runId)?.controller.abort();
    else {
      const sessionId = String(payload.engineSessionId ?? "");
      for (const active of activeRuns.values())
        if (active.sessionId === sessionId) active.controller.abort();
    }
    return { ok: true };
  }
  if (operation === "resume") {
    const id = String(payload.engineSessionId ?? "");
    const session = await restoreSession(id);
    if (!session) throw new Error("LangGraph 会话检查点不存在");
    return { id: session.id };
  }
  if (operation === "fork") {
    const sourceId = String(payload.engineSessionId ?? "");
    const source = sessions.get(sourceId) ?? (await restoreSession(sourceId));
    if (!source) throw new Error("LangGraph 会话不存在");
    const id = randomUUID();
    const forked: SessionState = {
      id,
      title: `${source.title}（分支）`,
      projectId: source.projectId,
      ...(source.chapterId ? { chapterId: source.chapterId } : {}),
      ...(source.model ? { model: source.model } : {}),
      history: source.history.map((item) => ({ ...item })),
    };
    sessions.set(id, forked);
    await persistSession(forked);
    return { id };
  }
  if (operation === "dispose") {
    const id = String(payload.engineSessionId ?? "");
    for (const active of activeRuns.values())
      if (active.sessionId === id) active.controller.abort();
    sessions.delete(id);
    if (startCommand && safeId(id))
      await rm(join(startCommand.sessionRoot, `${id}.json`), { force: true });
    return { ok: true };
  }
  if (operation === "steer" || operation === "compact")
    throw new Error(`UnsupportedOperation: LangGraph 不支持 ${operation}`);
  throw new Error(`LangGraph 不支持操作：${operation}`);
}

async function run(payload: Record<string, unknown>): Promise<unknown> {
  const activeProvider = provider;
  if (!activeProvider) throw new Error("LangGraph 模型尚未配置");
  const sessionId = String(payload.engineSessionId ?? "");
  const runId = String(payload.runId ?? "");
  const prompt = String(payload.prompt ?? "");
  if (!safeId(sessionId) || !safeId(runId) || !prompt.trim())
    throw new Error("LangGraph 运行参数不完整");
  let session = sessions.get(sessionId) ?? (await restoreSession(sessionId));
  if (!session) {
    const projectId = String(payload.projectId ?? "");
    session = {
      id: sessionId,
      title: "已恢复的智能任务",
      projectId,
      ...(typeof payload.chapterId === "string"
        ? { chapterId: payload.chapterId }
        : {}),
      history: [],
    };
    sessions.set(sessionId, session);
  }
  if (session.activeRunId) throw new Error("LangGraph 会话正在执行另一项任务");
  const requestedModel = selectedModel(payload);
  if (requestedModel) session.model = requestedModel;
  const configuration = {
    ...activeProvider,
    model: session.model ?? activeProvider.model,
  };
  const controller = new AbortController();
  const usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
  session.activeRunId = runId;
  activeRuns.set(runId, { controller, sessionId });
  try {
    const result = await runLangGraphWorkflow(configuration, {
      prompt: conversationPrompt(session.history, prompt),
      responseMode: payload.responseMode === "text" ? "text" : "structured",
      signal: controller.signal,
      onTextDelta: (delta) =>
        parentPort!.postMessage({
          type: "event",
          runId,
          event: { type: "content.delta", delta },
        }),
      onUsage: (next) => {
        usage.inputTokens += next.inputTokens;
        usage.outputTokens += next.outputTokens;
        usage.cachedTokens += next.cachedTokens;
      },
    });
    parentPort!.postMessage({
      type: "event",
      runId,
      event: { type: "usage", ...usage },
    });
    session.history = trimHistory([
      ...session.history,
      { role: "user", content: prompt },
      { role: "assistant", content: result.content },
    ]);
    await persistSession(session);
    await persistRunResult(runId, result);
    return result;
  } finally {
    session.activeRunId = undefined;
    activeRuns.delete(runId);
  }
}

function conversationPrompt(
  history: readonly HistoryItem[],
  prompt: string,
): string {
  if (!history.length) return prompt;
  return [
    "以下是当前会话中已经完成的历史消息，仅用于保持上下文：",
    ...history.map(
      (item) => `${item.role === "user" ? "用户" : "助手"}：${item.content}`,
    ),
    `用户：${prompt}`,
  ].join("\n\n");
}

function trimHistory(history: HistoryItem[]): HistoryItem[] {
  const retained = history.slice(-100);
  while (
    retained.length > 2 &&
    retained.reduce((total, item) => total + item.content.length, 0) > 200_000
  )
    retained.shift();
  return retained;
}

async function persistSession(session: SessionState): Promise<void> {
  if (!startCommand) return;
  const snapshot = {
    id: session.id,
    title: session.title,
    projectId: session.projectId,
    ...(session.chapterId ? { chapterId: session.chapterId } : {}),
    ...(session.model ? { model: session.model } : {}),
    history: session.history,
  };
  await atomicJson(
    join(startCommand.sessionRoot, `${session.id}.json`),
    snapshot,
  );
}

async function restoreSession(id: string): Promise<SessionState | undefined> {
  if (!safeId(id) || !startCommand) return undefined;
  if (sessions.has(id)) return sessions.get(id);
  try {
    const value = JSON.parse(
      await readFile(join(startCommand.sessionRoot, `${id}.json`), "utf8"),
    ) as Record<string, unknown>;
    if (
      value.id !== id ||
      typeof value.title !== "string" ||
      typeof value.projectId !== "string" ||
      !Array.isArray(value.history)
    )
      return undefined;
    const history = value.history.flatMap((item): HistoryItem[] => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        !["user", "assistant"].includes(
          String((item as Record<string, unknown>).role),
        ) ||
        typeof (item as Record<string, unknown>).content !== "string"
      )
        return [];
      return [item as HistoryItem];
    });
    const session: SessionState = {
      id,
      title: value.title,
      projectId: value.projectId,
      ...(typeof value.chapterId === "string"
        ? { chapterId: value.chapterId }
        : {}),
      ...(typeof value.model === "string" ? { model: value.model } : {}),
      history: trimHistory(history),
    };
    sessions.set(id, session);
    return session;
  } catch {
    return undefined;
  }
}

async function persistRunResult(runId: string, result: unknown): Promise<void> {
  if (!startCommand || !safeId(runId)) return;
  await atomicJson(
    join(startCommand.sessionRoot, "run-results", `${runId}.json`),
    result,
  );
}

async function recoverRun(payload: Record<string, unknown>): Promise<unknown> {
  if (!startCommand) return { disposition: "missing" };
  const runId = String(payload.runId ?? "");
  if (!safeId(runId)) return { disposition: "missing" };
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

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function stop(): Promise<void> {
  for (const active of activeRuns.values()) active.controller.abort();
  activeRuns.clear();
  sessions.clear();
  provider = undefined;
  startCommand = undefined;
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

function validateProvider(value: LangGraphProviderConfiguration): void {
  if (!value || !["openai", "anthropic", "google"].includes(value.providerKind))
    throw new Error("LangGraph 服务商类型无效");
  if (
    !["openai", "openai-compatible", "anthropic", "google"].includes(
      value.providerAdapter,
    )
  )
    throw new Error("LangGraph 服务商适配器无效");
  if (!value.model.trim() || !value.secret.trim())
    throw new Error("LangGraph 模型或凭据为空");
  if (value.providerAdapter === "openai-compatible" && !value.baseUrl)
    throw new Error("OpenAI 兼容服务商缺少服务地址");
}

function safeId(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,200}$/u.test(value);
}

function publicMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  if (provider?.secret)
    message = message.split(provider.secret).join("[REDACTED]");
  if (/401|unauthorized|authentication|credential|api.?key/iu.test(message))
    return "LangGraph 模型调用失败：API Key 无效或已失效";
  if (/404|unknown model|model.*not found/iu.test(message))
    return "LangGraph 模型调用失败：服务地址或模型名称不匹配";
  if (/429|rate.?limit|quota|balance/iu.test(message))
    return "LangGraph 模型调用失败：调用频率受限或账户额度不足";
  return message || "LangGraph Runtime 调用失败";
}
