import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type RpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

export type GrokNormalizedEvent = Record<string, unknown> & { type: string };

export type GrokAcpOptions = {
  binaryPath: string;
  cwd: string;
  grokHome: string;
  env: NodeJS.ProcessEnv;
  mcp: { url: string; token: string };
  model: string;
  requestTimeoutMs?: number;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function contentText(value: unknown): string {
  const content = record(value);
  return content?.type === "text" && typeof content.text === "string"
    ? content.text
    : "";
}

function usageEvent(value: unknown): GrokNormalizedEvent | undefined {
  const usage = record(value);
  if (!usage) return undefined;
  const hasUsageField = [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "outputTokens",
    "output_tokens",
    "completionTokens",
    "cachedReadTokens",
    "cache_read_input_tokens",
    "cacheReadInputTokens",
  ].some((key) => usage[key] !== undefined);
  if (!hasUsageField) return undefined;
  const inputTokens = Number(
    usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? 0,
  );
  const outputTokens = Number(
    usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? 0,
  );
  const cachedTokens = Number(
    usage.cachedReadTokens ??
      usage.cache_read_input_tokens ??
      usage.cacheReadInputTokens ??
      0,
  );
  if (![inputTokens, outputTokens, cachedTokens].every(Number.isFinite))
    return undefined;
  return {
    type: "usage",
    inputTokens,
    outputTokens,
    cachedTokens,
  };
}

export function sanitizeGrokDiagnostic(
  value: unknown,
  sensitiveValues: readonly string[] = [],
): string {
  let diagnostic = String(value ?? "");
  for (const sensitive of sensitiveValues)
    if (sensitive.length >= 4)
      diagnostic = diagnostic.split(sensitive).join("***");
  return diagnostic
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\b(?:sk|dsk|xai)-[A-Za-z0-9_.-]{8,}\b/g, "***")
    .replace(
      /(?:\/[\w .-]+){3,}|[A-Za-z]:\\(?:[^\s\\]+\\){2,}[^\s]*/g,
      "[本地路径已隐藏]",
    )
    .slice(0, 2_000);
}

/**
 * The profile deliberately names an MCP namespace rather than a built-in
 * Grok tool. Grok's builder treats a fully-resolved allowlist as fail-closed
 * and retains only its MCP search/use meta tools.
 */
export const GROK_READ_ONLY_AGENT_PROFILE = {
  name: "dramaip-read-only",
  description: "DramaIP controlled read-only assistant",
  promptMode: "extend",
  permissionMode: "dontAsk",
  skills: [],
  discoverSkills: false,
  inheritSkills: false,
  agentsMd: false,
  injectDefaultTools: false,
  mcpInheritance: "none",
  // Grok exposes MCP through these two dispatch meta-tools. Direct MCP
  // tool names stay undisclosed until `search_tool` and are then invoked by
  // `use_tool`, so no local capability is included in the allowlist.
  tools: ["search_tool", "use_tool"],
  disallowedTools: ["Agent"],
  promptBody:
    "Only use the DramaIP MCP tools exposed for this session. Never access the local filesystem, terminal, git, network, plugins, skills, or subagents directly.",
} as const;

const GROK_ALLOWED_TOOL_NAMES = ["search_tool", "use_tool"] as const;

/**
 * Grok advertises its effective tool set in AvailableCommandsUpdate.meta.
 * Treat any missing, malformed, duplicated, or expanded set as unsafe: the
 * caller must never silently continue with Grok's full local tool registry.
 */
export function isGrokReadOnlyToolset(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== GROK_ALLOWED_TOOL_NAMES.length)
    return false;
  const names = new Set(value);
  return (
    names.size === GROK_ALLOWED_TOOL_NAMES.length &&
    GROK_ALLOWED_TOOL_NAMES.every((name) => names.has(name))
  );
}

function normalizedMcpToolName(value: unknown): string {
  const name = String(value ?? "");
  if (/dramaip_web_search|搜索公开网络|web.?search/iu.test(name))
    return "dramaip_web_search";
  if (/dramaip_read_web_page|读取公开网页|read.?web/iu.test(name))
    return "dramaip_read_web_page";
  return name || "DramaIP 只读工具";
}

export function mapGrokSessionUpdate(
  value: unknown,
  toolNames?: Map<string, string>,
): GrokNormalizedEvent[] {
  const params = record(value);
  const update = record(params?.update);
  if (!update) return [];
  const usage = usageEvent(
    record(params?._meta)?.usage ?? update.usage ?? update._meta,
  );
  const updateType = String(update.sessionUpdate ?? "");
  if (updateType === "agent_message_chunk") {
    const text = contentText(update.content);
    return [
      ...(text ? [{ type: "content.delta", delta: text }] : []),
      ...(usage ? [usage] : []),
    ];
  }
  if (updateType === "tool_call") {
    const itemId = String(update.toolCallId ?? update.id ?? "tool");
    const tool = normalizedMcpToolName(update.title ?? update.kind);
    toolNames?.set(itemId, tool);
    return [
      {
        type: "tool",
        status: "started",
        tool,
        server: "dramaip",
        itemId,
        arguments: update.rawInput ?? update.input ?? {},
      },
      ...(usage ? [usage] : []),
    ];
  }
  if (updateType === "tool_call_update") {
    const status = String(update.status ?? "in_progress");
    if (!["completed", "failed"].includes(status)) return [];
    const itemId = String(update.toolCallId ?? update.id ?? "tool");
    const tool = normalizedMcpToolName(
      update.title ?? update.kind ?? toolNames?.get(itemId),
    );
    toolNames?.delete(itemId);
    return [
      {
        type: "tool",
        status: "completed",
        tool,
        server: "dramaip",
        itemId,
        result: update.rawOutput ?? update.content ?? {},
        ...(status === "failed" ? { error: "DramaIP 只读工具调用失败" } : {}),
      },
      ...(usage ? [usage] : []),
    ];
  }
  return usage ? [usage] : [];
}

export class GrokAcpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly updateListeners = new Set<(params: unknown) => void>();
  private sequence = 0;
  private currentSessionId: string | undefined;
  private stderrTail: string[] = [];
  private closing = false;
  private toolsetError: Error | undefined;
  private toolsetValidated = false;
  private readonly toolNames = new Map<string, string>();

  constructor(private readonly options: GrokAcpOptions) {}

  get sessionId(): string | undefined {
    return this.currentSessionId;
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.toolsetError = undefined;
    this.toolsetValidated = false;
    const child = spawn(
      this.options.binaryPath,
      ["agent", "--no-leader", "--model", this.options.model, "stdio"],
      {
        cwd: this.options.cwd,
        env: {
          ...this.options.env,
          GROK_HOME: this.options.grokHome,
          GROK_DISABLE_AUTOUPDATER: "1",
          GROK_TELEMETRY_ENABLED: "0",
          GROK_TELEMETRY_TRACE_UPLOAD: "0",
        },
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) =>
      this.onLine(line),
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const diagnostic = sanitizeGrokDiagnostic(chunk, [
        this.options.mcp.token,
        this.options.env.DRAMAIP_GROK_PROVIDER_KEY ?? "",
      ]).trim();
      if (diagnostic)
        this.stderrTail = [...this.stderrTail, diagnostic].slice(-20);
    });
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code, signal) => {
      if (this.closing) return;
      this.fail(
        new Error(
          `Grok ACP 已退出（${code === null ? (signal ?? "unknown") : code}）${this.stderrTail.length ? `：${this.stderrTail.at(-1)}` : ""}`,
        ),
      );
    });
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "dramaip-desktop", version: "3.0.0" },
      _meta: {
        startupHints: {
          nonInteractive: true,
          skipGitStatus: true,
          skipProjectLayout: true,
        },
        clientType: "dramaip",
        clientVersion: "3.0.0",
      },
    });
    const session = record(
      await this.request("session/new", {
        cwd: this.options.cwd,
        mcpServers: [
          {
            name: "dramaip",
            type: "http",
            url: this.options.mcp.url,
            headers: [
              {
                name: "Authorization",
                value: `Bearer ${this.options.mcp.token}`,
              },
            ],
          },
        ],
        _meta: {
          agentProfile: GROK_READ_ONLY_AGENT_PROFILE,
          pluginDirs: [],
          yoloMode: false,
          autoMode: false,
        },
      }),
    );
    const sessionMeta = record(session?._meta);
    const advertisedTools = sessionMeta?.tools;
    if (advertisedTools !== undefined) {
      if (Array.isArray(advertisedTools) && advertisedTools.length === 0) {
        // Grok can report an empty registry while MCP is still initializing.
        // It is safe to wait, but never safe to run before validation.
      } else if (!isGrokReadOnlyToolset(advertisedTools)) {
        throw new Error("Grok ACP 工具白名单校验失败，已拒绝启动会话");
      } else {
        this.toolsetValidated = true;
      }
    }
    if (!session || typeof session.sessionId !== "string")
      throw new Error("Grok ACP 未返回会话编号");
    this.currentSessionId = session.sessionId;
  }

  async run(
    prompt: string,
    onEvent: (event: GrokNormalizedEvent) => void,
    timeoutMs = 115_000,
  ): Promise<{ text: string }> {
    if (!this.currentSessionId) throw new Error("Grok ACP 尚未创建会话");
    return this.runSession(this.currentSessionId, prompt, onEvent, timeoutMs);
  }

  async runSession(
    sessionId: string,
    prompt: string,
    onEvent: (event: GrokNormalizedEvent) => void,
    timeoutMs = 115_000,
  ): Promise<{ text: string }> {
    if (this.toolsetError) throw this.toolsetError;
    if (!this.toolsetValidated)
      throw new Error("Grok ACP 工具白名单尚未完成校验，已拒绝继续运行");
    let text = "";
    const listener = (params: unknown): void => {
      const message = record(params);
      if (message?.sessionId !== sessionId) return;
      for (const event of mapGrokSessionUpdate(params, this.toolNames)) {
        if (event.type === "content.delta") text += String(event.delta ?? "");
        onEvent(event);
      }
    };
    this.updateListeners.add(listener);
    try {
      const result = record(
        await this.request(
          "session/prompt",
          {
            sessionId,
            prompt: [{ type: "text", text: prompt }],
          },
          timeoutMs,
        ),
      );
      const usage = usageEvent(result?.usage);
      if (usage) onEvent(usage);
      if (!text.trim()) throw new Error("Grok 未返回有效内容");
      return { text };
    } finally {
      this.updateListeners.delete(listener);
    }
  }

  async rebindSessionMcp(sessionId: string, token: string): Promise<string> {
    if (!sessionId || !token) throw new Error("Grok MCP 会话授权不完整");
    const result = record(
      await this.request("session/load", {
        sessionId,
        cwd: this.options.cwd,
        mcpServers: [
          {
            name: "dramaip",
            type: "http",
            url: this.options.mcp.url,
            headers: [{ name: "Authorization", value: `Bearer ${token}` }],
          },
        ],
        _meta: {
          agentProfile: GROK_READ_ONLY_AGENT_PROFILE,
          pluginDirs: [],
        },
      }),
    );
    const loadedId = result?.sessionId;
    if (typeof loadedId !== "string" || !loadedId)
      throw new Error("Grok MCP 会话重新授权失败");
    this.currentSessionId = loadedId;
    return loadedId;
  }

  async cancel(): Promise<void> {
    if (this.currentSessionId) await this.cancelSession(this.currentSessionId);
  }

  async cancelSession(sessionId: string): Promise<void> {
    if (!sessionId || !this.child) return;
    this.notify("session/cancel", { sessionId });
  }

  async fork(): Promise<string> {
    if (!this.currentSessionId) throw new Error("Grok ACP 尚未创建会话");
    return this.forkSession(this.currentSessionId);
  }

  async forkSession(sourceSessionId: string): Promise<string> {
    if (!sourceSessionId) throw new Error("Grok ACP 源会话编号缺失");
    const result = record(
      await this.request("x.ai/session/fork", {
        sourceSessionId,
        sourceCwd: this.options.cwd,
        newCwd: this.options.cwd,
        sessionKind: "fork",
      }),
    );
    const sessionId = result?.newSessionId ?? result?.sessionId ?? result?.id;
    if (typeof sessionId !== "string" || !sessionId)
      throw new Error("Grok ACP 分支会话创建失败");
    return sessionId;
  }

  async close(): Promise<void> {
    if (!this.child || this.closing) return;
    this.closing = true;
    const child = this.child;
    await this.cancel().catch(() => undefined);
    this.fail(new Error("Grok ACP 运行已中断"));
    this.child = undefined;
    child.stdin.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const term = setTimeout(() => killProcessTree(child, "SIGTERM"), 1_000);
      const kill = setTimeout(() => killProcessTree(child, "SIGKILL"), 4_000);
      child.once("exit", () => {
        clearTimeout(term);
        clearTimeout(kill);
        resolve();
      });
    });
  }

  async dispose(): Promise<void> {
    await this.close();
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = this.options.requestTimeoutMs ?? 20_000,
  ): Promise<unknown> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Grok ACP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: RpcMessage): void {
    if (!this.child?.stdin.writable) throw new Error("Grok ACP 未运行");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const id = Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      if (message.error)
        pending.reject(new Error(message.error.message ?? "Grok ACP 请求失败"));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: "DramaIP 安全策略拒绝 Grok 主动调用本地能力",
        },
      });
      return;
    }
    if (
      message.method === "session/update" ||
      message.method === "x.ai/session/update" ||
      message.method === "x.ai/session_notification"
    ) {
      const update = record(message.params)?.update;
      if (
        String(record(update)?.sessionUpdate ?? "") ===
        "available_commands_update"
      ) {
        const params = record(message.params);
        // ACP serializes the `Meta` field as `_meta` on the wire.  Some
        // older Grok builds used `meta` while a few adapters put it on the
        // notification params, so accept those equivalent locations but
        // still fail closed when a non-empty set contains anything beyond the
        // exact read-only dispatcher set.
        const updateRecord = record(update);
        const tools =
          record(updateRecord?._meta)?.tools ??
          record(updateRecord?.meta)?.tools ??
          record(params?._meta)?.tools ??
          record(params?.meta)?.tools;
        if (Array.isArray(tools) && tools.length === 0) {
          // MCP may briefly advertise no tools during reconnect. An empty
          // set cannot grant local capabilities; retain the last validated
          // dispatcher set and require validation before the next run.
        } else if (tools === undefined) {
          if (!this.toolsetValidated) {
            this.toolsetError = new Error(
              "Grok ACP 工具白名单校验失败，已拒绝继续运行",
            );
            this.fail(this.toolsetError);
            return;
          }
        } else if (!isGrokReadOnlyToolset(tools)) {
          this.toolsetError = new Error(
            "Grok ACP 工具白名单校验失败，已拒绝继续运行",
          );
          this.fail(this.toolsetError);
          return;
        } else {
          this.toolsetValidated = true;
        }
      }
      for (const listener of this.updateListeners) listener(message.params);
    }
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function killProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct child when a platform refuses process groups.
    }
  }
  child.kill(signal);
}
