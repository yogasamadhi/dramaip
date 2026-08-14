import { randomUUID } from "node:crypto";
import type { AgentTaskType } from "@sdns/schema";
import {
  runLangGraphWorkflow,
  type LangGraphProviderConfiguration,
} from "./engine";

type StartCommand = {
  type: "start";
  provider?: LangGraphProviderConfiguration;
  mcp: { url: string; token: string };
};
type EngineRequest = {
  type: "request";
  requestId: string;
  operation: string;
  payload: Record<string, unknown>;
};
type Command = StartCommand | EngineRequest | { type: "stop" };
type ParentPort = {
  postMessage(message: unknown): void;
  on(event: "message", cb: (event: { data: unknown }) => void): void;
};
type SessionState = {
  id: string;
  title: string;
  projectId: string;
  chapterId?: string;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("LangGraph 引擎必须作为 Electron utilityProcess 运行");

let configuration: StartCommand | undefined;
const sessions = new Map<string, SessionState>();
const activeRuns = new Map<string, AbortController>();

parentPort.on("message", (event) => {
  const command = event.data as Partial<Command>;
  if (command.type === "start") return void start(command as StartCommand);
  if (command.type === "stop") return void stop();
  if (command.type === "request")
    return void handleRequest(command as EngineRequest);
});

function start(command: StartCommand): void {
  configuration = command;
  parentPort!.postMessage({
    type: "ready",
    version: "0.2.43",
    configured: Boolean(command.provider),
  });
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
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function perform(
  operation: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (operation === "health")
    return {
      available: Boolean(configuration?.provider),
      version: "0.2.43",
    };
  if (operation === "createSession") {
    if (!configuration?.provider) throw new Error("LangGraph 模型尚未配置");
    const id = randomUUID();
    sessions.set(id, {
      id,
      title: String(payload.title ?? "DramaIP 智能任务"),
      projectId: String(payload.projectId ?? ""),
      ...(typeof payload.chapterId === "string"
        ? { chapterId: payload.chapterId }
        : {}),
    });
    return { id };
  }
  if (operation === "run") {
    const provider = configuration?.provider;
    if (!provider) throw new Error("LangGraph 模型尚未配置");
    const sessionId = String(payload.engineSessionId ?? "");
    const runId = String(payload.runId ?? "");
    const prompt = String(payload.prompt ?? "");
    const model =
      payload.model && typeof payload.model === "object"
        ? String(
            (payload.model as Record<string, unknown>).modelId ?? "",
          ).trim()
        : "";
    if (!sessions.has(sessionId)) {
      const projectId = String(payload.projectId ?? "");
      if (!projectId) throw new Error("LangGraph 恢复检查点缺少项目编号");
      sessions.set(sessionId, {
        id: sessionId,
        title: "已恢复的智能任务",
        projectId,
        ...(typeof payload.chapterId === "string"
          ? { chapterId: payload.chapterId }
          : {}),
      });
    }
    if (!runId || !prompt) throw new Error("LangGraph 运行参数不完整");
    const controller = new AbortController();
    activeRuns.set(runId, controller);
    try {
      return await runLangGraphWorkflow(
        model ? { ...provider, model } : provider,
        {
          prompt,
          taskType: String(payload.taskType) as AgentTaskType,
          signal: controller.signal,
          onTextDelta: (delta) =>
            parentPort!.postMessage({
              type: "event",
              runId,
              event: { type: "content.delta", delta },
            }),
          onUsage: (usage) =>
            parentPort!.postMessage({
              type: "event",
              runId,
              event: { type: "usage", ...usage },
            }),
        },
      );
    } finally {
      activeRuns.delete(runId);
    }
  }
  if (operation === "interrupt") {
    activeRuns.get(String(payload.runId ?? ""))?.abort();
    return { ok: true };
  }
  if (operation === "fork") {
    const source = sessions.get(String(payload.engineSessionId ?? ""));
    if (!source) throw new Error("LangGraph 会话不存在");
    const id = randomUUID();
    sessions.set(id, { ...source, id, title: `${source.title}（分支）` });
    return { id };
  }
  if (operation === "dispose") {
    sessions.delete(String(payload.engineSessionId ?? ""));
    return { ok: true };
  }
  throw new Error(`LangGraph 不支持操作：${operation}`);
}

function stop(): void {
  for (const controller of activeRuns.values()) controller.abort();
  activeRuns.clear();
  sessions.clear();
  configuration = undefined;
  parentPort!.postMessage({ type: "stopped" });
  process.exit(0);
}
