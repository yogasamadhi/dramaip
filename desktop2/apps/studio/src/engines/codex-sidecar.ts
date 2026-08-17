import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  startCodexChatBridge,
  type CodexChatBridge,
} from "./codex-chat-bridge.ts";
import { normalizeCodexOutput } from "./codex-output.ts";

type StartCommand = {
  type: "start";
  binaryPath: string;
  codexHome: string;
  sessionRoot: string;
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
type RpcMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code?: number; message?: string };
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;
if (!parentPort)
  throw new Error("Codex 引擎必须作为 Electron utilityProcess 运行");

let startCommand: StartCommand | undefined;
let appServer: ChildProcessWithoutNullStreams | undefined;
let rpcSequence = 0;
let runtimeApiKey: string | undefined;
let runtimeProvider:
  | {
      providerId: string;
      providerName: string;
      baseUrl: string;
      model: string;
      protocol: "responses" | "chat_completions";
    }
  | undefined;
let chatBridge: CodexChatBridge | undefined;
const pendingRpc = new Map<
  number,
  {
    resolve(value: any): void;
    reject(error: Error): void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();
const activeRuns = new Map<
  string,
  {
    runId: string;
    turnId?: string;
    text: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
  }
>();
const runLocation = new Map<string, { threadId: string; turnId: string }>();
const loadedThreads = new Set<string>();
const threadResumes = new Map<string, Promise<void>>();

const BASE_INSTRUCTIONS =
  "你是 DramaIP 的中文创作助手。只能分析用户提供的创作上下文并返回结构化结果。禁止执行命令、修改文件、访问任意本地目录、使用网络搜索、安装扩展、创建子代理或直接修改 DramaIP 正式数据。";
const DEVELOPER_INSTRUCTIONS =
  "所有输出使用简体中文。只允许调用 DramaIP 只读 MCP。不得输出隐藏思维链，不得请求权限，不得尝试绕过沙箱。";

parentPort.on("message", (event) => {
  const command = event.data as Partial<Command>;
  if (command.type === "stop") return void stop();
  if (command.type === "start") return void start(command as StartCommand);
  if (command.type === "request")
    return void handleRequest(command as EngineRequest);
});

async function start(command: StartCommand): Promise<void> {
  try {
    if (!existsSync(command.binaryPath)) {
      parentPort!.postMessage({
        type: "unavailable",
        reason: "固定版本 Codex 运行文件不存在",
      });
      return;
    }
    startCommand = command;
    await mkdir(command.codexHome, { recursive: true, mode: 0o700 });
    await mkdir(command.sessionRoot, { recursive: true, mode: 0o700 });
    await launchAppServer();
    let authenticated = false;
    try {
      authenticated = (await authStatus()).authenticated;
    } catch (error) {
      parentPort!.postMessage({
        type: "diagnostic",
        level: "warn",
        message: `Codex 登录状态读取失败：${message(error)}`,
      });
    }
    parentPort!.postMessage({
      type: "ready",
      version: "0.147.0",
      authenticated,
    });
  } catch (error) {
    parentPort!.postMessage({ type: "unavailable", reason: message(error) });
  }
}

async function launchAppServer(): Promise<void> {
  if (!startCommand) throw new Error("Codex 启动参数不存在");
  if (chatBridge) {
    await chatBridge.close();
    chatBridge = undefined;
  }
  loadedThreads.clear();
  threadResumes.clear();
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
  env.CODEX_HOME = startCommand.codexHome;
  env.DRAMAIP_MCP_TOKEN = startCommand.mcp.token;
  let providerBaseUrl = runtimeProvider?.baseUrl;
  let providerEnvKey = "DRAMAIP_CODEX_PROVIDER_API_KEY";
  if (runtimeProvider?.protocol === "chat_completions") {
    if (!runtimeApiKey)
      throw new Error("Codex Chat Completions 适配器缺少 API 密钥");
    chatBridge = await startCodexChatBridge({
      targetBaseUrl: runtimeProvider.baseUrl,
      apiKey: runtimeApiKey,
    });
    providerBaseUrl = chatBridge.baseUrl;
    providerEnvKey = "DRAMAIP_CODEX_BRIDGE_TOKEN";
    env.DRAMAIP_CODEX_BRIDGE_TOKEN = chatBridge.token;
  } else if (runtimeProvider && runtimeApiKey) {
    env.DRAMAIP_CODEX_PROVIDER_API_KEY = runtimeApiKey;
  } else if (!runtimeProvider && runtimeApiKey) {
    env.OPENAI_API_KEY = runtimeApiKey;
  }
  const providerConfig = runtimeProvider
    ? [
        "-c",
        `model_provider=${tomlString("dramaip_custom")}`,
        "-c",
        `model=${tomlString(runtimeProvider.model)}`,
        "-c",
        `model_providers.dramaip_custom.name=${tomlString(runtimeProvider.providerName)}`,
        "-c",
        `model_providers.dramaip_custom.base_url=${tomlString(providerBaseUrl ?? runtimeProvider.baseUrl)}`,
        "-c",
        `model_providers.dramaip_custom.env_key=${tomlString(providerEnvKey)}`,
        "-c",
        'model_providers.dramaip_custom.wire_api="responses"',
        "-c",
        "model_providers.dramaip_custom.requires_openai_auth=false",
      ]
    : [];
  appServer = spawn(
    startCommand.binaryPath,
    [
      "app-server",
      "--listen",
      "stdio://",
      "-c",
      'cli_auth_credentials_store="file"',
      "-c",
      'mcp_oauth_credentials_store="file"',
      "-c",
      'web_search="disabled"',
      "-c",
      "hide_agent_reasoning=true",
      "-c",
      "features.shell_tool=false",
      "-c",
      "features.unified_exec=false",
      "-c",
      "features.multi_agent=false",
      "-c",
      "features.apps=false",
      "-c",
      "features.remote_plugin=false",
      "-c",
      "features.skill_mcp_dependency_install=false",
      ...providerConfig,
    ],
    {
      cwd: startCommand.sessionRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const lines = createInterface({ input: appServer.stdout });
  lines.on("line", (line) => onRpcLine(line));
  appServer.stderr.on("data", (chunk) => {
    const line = String(chunk).trim();
    if (line && !/token|api.?key|authorization/i.test(line))
      parentPort!.postMessage({
        type: "diagnostic",
        level: "warn",
        message: line.slice(0, 1_000),
      });
  });
  appServer.once("exit", (code) => {
    appServer = undefined;
    loadedThreads.clear();
    threadResumes.clear();
    failAll(new Error(`Codex App Server 已退出（${code ?? "未知状态"}）`));
  });
  await rpc("initialize", {
    clientInfo: {
      name: "dramaip_desktop",
      title: "DramaIP Desktop",
      version: "3.0.0",
    },
    capabilities: {
      optOutNotificationMethods: [
        "item/reasoning/delta",
        "item/reasoning/summaryTextDelta",
      ],
    },
  });
  notify("initialized", {});
}

function send(message: RpcMessage): void {
  if (!appServer?.stdin.writable) throw new Error("Codex App Server 未运行");
  appServer.stdin.write(`${JSON.stringify(message)}\n`);
}

function notify(method: string, params: Record<string, unknown>): void {
  send({ method, params });
}

function rpc(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 30_000,
): Promise<any> {
  const id = ++rpcSequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRpc.delete(id);
      reject(new Error(`Codex 请求超时：${method}`));
    }, timeoutMs);
    pendingRpc.set(id, { resolve, reject, timeout });
    send({ id, method, params });
  });
}

function onRpcLine(line: string): void {
  let messageValue: RpcMessage;
  try {
    messageValue = JSON.parse(line) as RpcMessage;
  } catch {
    return;
  }
  if (messageValue.id !== undefined && !messageValue.method) {
    const id = Number(messageValue.id);
    const pending = pendingRpc.get(id);
    if (!pending) return;
    pendingRpc.delete(id);
    clearTimeout(pending.timeout);
    if (messageValue.error)
      pending.reject(new Error(messageValue.error.message ?? "Codex 请求失败"));
    else pending.resolve(messageValue.result);
    return;
  }
  if (messageValue.id !== undefined && messageValue.method) {
    denyServerRequest(messageValue);
    return;
  }
  if (!messageValue.method) return;
  onNotification(messageValue.method, messageValue.params ?? {});
}

function denyServerRequest(request: RpcMessage): void {
  const method = request.method ?? "";
  if (/Approval|approval|permissions\/request/i.test(method)) {
    send({ id: request.id, result: { decision: "decline" } });
    return;
  }
  send({
    id: request.id,
    error: {
      code: -32601,
      message: "DramaIP 安全策略拒绝 Codex 主动调用此能力",
    },
  });
}

function onNotification(method: string, params: Record<string, any>): void {
  if (method === "item/agentMessage/delta") {
    const threadId = String(params.threadId ?? "");
    const active = activeRuns.get(threadId);
    if (active && typeof params.delta === "string") {
      active.text += params.delta;
      parentPort!.postMessage({
        type: "event",
        runId: active.runId,
        event: { type: "content.delta", delta: params.delta },
      });
    }
    return;
  }
  if (method === "item/started" || method === "item/completed") {
    const threadId = String(params.threadId ?? "");
    const active = activeRuns.get(threadId);
    const item = params.item as Record<string, unknown> | undefined;
    if (active && item?.type === "mcpToolCall")
      parentPort!.postMessage({
        type: "event",
        runId: active.runId,
        event: {
          type: "tool",
          status: method === "item/started" ? "started" : "completed",
          tool: String(item.tool ?? "DramaIP 只读工具"),
          server: String(item.server ?? "dramaip"),
          itemId: String(item.id ?? ""),
          ...(item.arguments !== undefined
            ? { arguments: item.arguments }
            : item.input !== undefined
              ? { arguments: item.input }
              : {}),
          ...(item.result !== undefined
            ? { result: item.result }
            : item.output !== undefined
              ? { result: item.output }
              : {}),
          ...(item.error ? { error: extractText(item.error) } : {}),
        },
      });
  }
  if (method === "item/completed") {
    const threadId = String(params.threadId ?? "");
    const active = activeRuns.get(threadId);
    const item = params.item as Record<string, unknown> | undefined;
    if (active && item?.type === "agentMessage") {
      const itemText = extractText(item);
      if (itemText && !active.text.includes(itemText)) active.text += itemText;
    }
    return;
  }
  if (method === "turn/started") {
    const threadId = String(params.threadId ?? "");
    const active = activeRuns.get(threadId);
    const turnId = String(params.turn?.id ?? "");
    if (active && turnId) {
      active.turnId = turnId;
      runLocation.set(active.runId, { threadId, turnId });
    }
    return;
  }
  if (method === "thread/tokenUsage/updated") {
    const active = activeRuns.get(String(params.threadId ?? ""));
    const total = params.tokenUsage?.total as
      | Record<string, unknown>
      | undefined;
    if (active && total)
      parentPort!.postMessage({
        type: "event",
        runId: active.runId,
        event: {
          type: "usage",
          inputTokens: Number(total.inputTokens ?? 0),
          outputTokens: Number(total.outputTokens ?? 0),
          cachedTokens: Number(total.cachedInputTokens ?? 0),
        },
      });
    return;
  }
  if (method === "turn/completed") {
    const threadId = String(params.threadId ?? "");
    const active = activeRuns.get(threadId);
    if (!active) return;
    activeRuns.delete(threadId);
    const status = String(params.turn?.status ?? "completed");
    if (status === "failed") {
      active.reject(
        new Error(extractText(params.turn?.error) || "Codex 运行失败"),
      );
      return;
    }
    active.resolve(
      normalizeCodexOutput(active.text, {
        ...(active.turnId ? { turnId: active.turnId } : {}),
        status,
      }),
    );
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
      error: message(error),
    });
  }
}

async function perform(
  operation: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  if (operation === "health")
    return { available: Boolean(appServer), version: "0.147.0" };
  if (operation === "authStatus") {
    return authStatus();
  }
  if (operation === "login") return login(payload);
  if (operation === "logout") {
    runtimeApiKey = undefined;
    runtimeProvider = undefined;
    if (appServer) {
      try {
        await rpc("account/logout", {});
      } catch {}
      await restartAppServer();
    }
    return { ok: true };
  }
  if (operation === "createSession") {
    if (!startCommand) throw new Error("Codex 引擎未初始化");
    const model =
      payload.model && typeof payload.model === "object"
        ? String(
            (payload.model as Record<string, unknown>).modelId ?? "",
          ).trim()
        : "";
    const cwd = join(startCommand.sessionRoot, crypto.randomUUID());
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    const result = await rpc("thread/start", {
      cwd,
      ...(model ? { model } : {}),
      ephemeral: false,
      serviceName: "dramaip_desktop",
      ...threadOverrides(),
    });
    const id = result?.thread?.id;
    if (!id) throw new Error("Codex 未返回 Thread 编号");
    loadedThreads.add(String(id));
    return { id };
  }
  if (operation === "run") return run(payload);
  if (operation === "interrupt") {
    const runId = String(payload.runId ?? "");
    const location = runLocation.get(runId);
    if (location)
      await rpc("turn/interrupt", {
        threadId: location.threadId,
        turnId: location.turnId,
      });
    return { ok: true };
  }
  if (operation === "fork") {
    const sourceId = String(payload.engineSessionId ?? "");
    await ensureThreadLoaded(sourceId);
    const result = await rpc("thread/fork", {
      threadId: sourceId,
    });
    const id = String(result?.thread?.id ?? "");
    if (id) loadedThreads.add(id);
    return { id };
  }
  if (operation === "dispose") {
    const threadId = String(payload.engineSessionId ?? "");
    await rpc("thread/delete", {
      threadId,
    });
    loadedThreads.delete(threadId);
    return { ok: true };
  }
  throw new Error(`Codex 不支持操作：${operation}`);
}

async function authStatus(): Promise<{
  available: true;
  authenticated: boolean;
  mode?: string;
  accountLabel?: string;
  provider?: {
    id: string;
    name: string;
    model: string;
    baseUrl: string;
    protocol: "responses" | "chat_completions";
  };
}> {
  if (runtimeApiKey)
    return {
      available: true,
      authenticated: true,
      ...(runtimeProvider
        ? {
            mode: "custom_provider",
            accountLabel: runtimeProvider.providerName,
            provider: {
              id: runtimeProvider.providerId,
              name: runtimeProvider.providerName,
              model: runtimeProvider.model,
              baseUrl: runtimeProvider.baseUrl,
              protocol: runtimeProvider.protocol,
            },
          }
        : { mode: "api_key", accountLabel: "OpenAI API 密钥" }),
    };
  const result = await rpc("account/read", { refreshToken: false });
  const account = result?.account as Record<string, unknown> | undefined;
  return {
    available: true,
    authenticated: Boolean(account) || result?.requiresOpenaiAuth === false,
    mode:
      account?.type === "chatgpt"
        ? "chatgpt"
        : account?.type === "apiKey"
          ? "api_key"
          : undefined,
    accountLabel:
      typeof account?.email === "string"
        ? account.email
        : account
          ? "Codex 账户"
          : undefined,
  };
}

async function login(payload: Record<string, unknown>): Promise<unknown> {
  const mode = String(payload.mode ?? "");
  if (mode === "custom_provider") {
    const providerId = String(payload.providerId ?? "").trim();
    const providerName = String(payload.providerName ?? "").trim();
    const baseUrl = String(payload.baseUrl ?? "").trim();
    const model = String(payload.model ?? "").trim();
    if (!providerId || !providerName || !baseUrl || !model)
      throw new Error("Codex 自定义服务商配置不完整");
    if (!/^https?:\/\//iu.test(baseUrl))
      throw new Error("Codex 自定义服务商地址必须使用 HTTP 或 HTTPS");
    if (typeof payload.apiKey !== "string" || !payload.apiKey.trim())
      throw new Error("安全存储中的服务商 API 密钥不可用");
    runtimeApiKey = payload.apiKey;
    runtimeProvider = {
      providerId,
      providerName,
      baseUrl,
      model,
      protocol:
        payload.protocol === "chat_completions"
          ? "chat_completions"
          : "responses",
    };
    await restartAppServer();
    return {
      status: "authenticated",
      message:
        runtimeProvider.protocol === "chat_completions"
          ? `已连接 ${providerName}。已启用本地 Chat Completions → Responses 转换；Codex 部分高级能力可能受限。`
          : `已连接 ${providerName}（Responses API 直连）。`,
    };
  }
  if (mode === "api_key") {
    if (typeof payload.apiKey !== "string" || !payload.apiKey.trim())
      throw new Error("安全存储中的 API 密钥不可用");
    runtimeProvider = undefined;
    runtimeApiKey = payload.apiKey;
    await restartAppServer();
    return {
      status: "authenticated",
      message: "API 密钥仅注入当前 Codex 进程",
    };
  }
  const hadRuntimeProvider = Boolean(runtimeProvider || runtimeApiKey);
  runtimeProvider = undefined;
  runtimeApiKey = undefined;
  if (hadRuntimeProvider) await restartAppServer();
  const result = await rpc("account/login/start", {
    type: mode === "chatgpt_device_code" ? "chatgptDeviceCode" : "chatgpt",
    ...(mode === "chatgpt_browser"
      ? { useHostedLoginSuccessPage: true, appBrand: "chatgpt" }
      : {}),
  });
  return {
    status: "pending",
    verificationUrl: result?.verificationUrl ?? result?.authUrl,
    userCode: result?.userCode,
    message: "请完成 ChatGPT 登录，完成后状态会自动更新",
  };
}

async function restartAppServer(): Promise<void> {
  const previous = appServer;
  if (previous) {
    await new Promise<void>((resolve) => {
      previous.once("exit", () => resolve());
      previous.kill("SIGTERM");
      setTimeout(() => {
        if (previous.exitCode === null) previous.kill("SIGKILL");
      }, 2_000);
    });
  }
  await launchAppServer();
}

async function run(payload: Record<string, unknown>): Promise<unknown> {
  const threadId = String(payload.engineSessionId ?? "");
  const runId = String(payload.runId ?? "");
  const prompt = String(payload.prompt ?? "");
  const model =
    payload.model && typeof payload.model === "object"
      ? String((payload.model as Record<string, unknown>).modelId ?? "").trim()
      : "";
  if (!threadId || !runId || !prompt) throw new Error("Codex 运行参数不完整");
  await ensureThreadLoaded(threadId, model);
  if (activeRuns.has(threadId))
    throw new Error("Codex Thread 已有运行中的任务");
  const completed = new Promise<unknown>((resolve, reject) => {
    activeRuns.set(threadId, { runId, text: "", resolve, reject });
  });
  try {
    const response = await rpc(
      "turn/start",
      {
        threadId,
        ...(model ? { model } : {}),
        input: [{ type: "text", text: prompt }],
        approvalPolicy: "never",
        sandboxPolicy: {
          type: "readOnly",
          networkAccess: false,
        },
      },
      30_000,
    );
    const active = activeRuns.get(threadId);
    const turnId = String(response?.turn?.id ?? "");
    if (active && turnId) {
      active.turnId = turnId;
      runLocation.set(runId, { threadId, turnId });
    }
    return await completed;
  } catch (error) {
    activeRuns.delete(threadId);
    throw error;
  }
}

function threadOverrides(model = ""): Record<string, unknown> {
  if (!startCommand) throw new Error("Codex 引擎未初始化");
  return {
    ...(model ? { model } : {}),
    approvalPolicy: "never",
    sandbox: "read-only",
    baseInstructions: BASE_INSTRUCTIONS,
    developerInstructions: DEVELOPER_INSTRUCTIONS,
    config: {
      web_search: "disabled",
      hide_agent_reasoning: true,
      features: {
        shell_tool: false,
        unified_exec: false,
        multi_agent: false,
        apps: false,
        remote_plugin: false,
        skill_mcp_dependency_install: false,
      },
      mcp_servers: {
        dramaip: {
          url: startCommand.mcp.url,
          bearer_token_env_var: "DRAMAIP_MCP_TOKEN",
          required: true,
        },
      },
    },
  };
}

async function ensureThreadLoaded(threadId: string, model = ""): Promise<void> {
  if (!threadId) throw new Error("Codex Thread 编号不存在");
  if (loadedThreads.has(threadId)) return;
  const existing = threadResumes.get(threadId);
  if (existing) return existing;
  const pending = (async () => {
    await rpc("thread/resume", {
      threadId,
      ...threadOverrides(model),
    });
    loadedThreads.add(threadId);
  })();
  threadResumes.set(threadId, pending);
  try {
    await pending;
  } finally {
    threadResumes.delete(threadId);
  }
}

async function stop(): Promise<void> {
  failAll(new Error("Codex 引擎正在关闭"));
  if (chatBridge) await chatBridge.close().catch(() => undefined);
  if (appServer) {
    appServer.kill("SIGTERM");
    appServer = undefined;
  }
  parentPort!.postMessage({ type: "stopped" });
  process.exit(0);
}

function failAll(error: Error): void {
  for (const pending of pendingRpc.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingRpc.clear();
  for (const active of activeRuns.values()) active.reject(error);
  activeRuns.clear();
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value))
    return value.map(extractText).filter(Boolean).join("\n");
  const object = value as Record<string, unknown>;
  if (typeof object.text === "string") return object.text;
  return Object.values(object).map(extractText).filter(Boolean).join("\n");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
