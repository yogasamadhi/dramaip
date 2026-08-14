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

export type HermesNormalizedEvent = Record<string, unknown> & { type: string };

export type HermesAcpOptions = {
  pythonPath: string;
  adapterPath: string;
  projectRoot: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  mcp: { url: string; token: string };
  requestTimeoutMs?: number;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function sanitizeHermesDiagnostic(
  value: unknown,
  sensitiveValues: readonly string[] = [],
): string {
  let diagnostic = String(value ?? "");
  for (const sensitive of sensitiveValues)
    if (sensitive.length >= 4)
      diagnostic = diagnostic.split(sensitive).join("***");
  return diagnostic
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\b(?:sk|dsk)-[A-Za-z0-9_-]{8,}\b/g, "***")
    .replace(
      /(?:\/[\w .-]+){3,}|[A-Za-z]:\\(?:[^\s\\]+\\){2,}[^\s]*/g,
      "[本地路径已隐藏]",
    )
    .slice(0, 2_000);
}

export function mapHermesSessionUpdate(
  value: unknown,
): HermesNormalizedEvent[] {
  const params = record(value);
  const update = record(params?.update);
  if (!update) return [];
  const updateType = String(update.sessionUpdate ?? "");
  if (updateType === "agent_message_chunk") {
    const content = record(update.content);
    return content?.type === "text" && typeof content.text === "string"
      ? [{ type: "content.delta", delta: content.text }]
      : [];
  }
  if (updateType === "tool_call") {
    return [
      {
        type: "tool",
        status: "started",
        tool: String(update.title ?? update.kind ?? "DramaIP 只读工具"),
        server: "dramaip",
        itemId: String(update.toolCallId ?? update.id ?? "tool"),
        arguments: update.rawInput ?? update.locations ?? {},
      },
    ];
  }
  if (updateType === "tool_call_update") {
    const status = String(update.status ?? "in_progress");
    if (!["completed", "failed"].includes(status)) return [];
    return [
      {
        type: "tool",
        status: "completed",
        tool: String(update.title ?? update.kind ?? "DramaIP 只读工具"),
        server: "dramaip",
        itemId: String(update.toolCallId ?? update.id ?? "tool"),
        result: update.rawOutput ?? update.content ?? {},
        ...(status === "failed" ? { error: "DramaIP 只读工具调用失败" } : {}),
      },
    ];
  }
  return [];
}

export class HermesAcpClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly updateListeners = new Set<(params: unknown) => void>();
  private readonly closeListeners = new Set<(error: Error) => void>();
  private sequence = 0;
  private sessionId: string | undefined;
  private stderrTail: string[] = [];
  private closing = false;

  constructor(private readonly options: HermesAcpOptions) {}

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.options.pythonPath, [this.options.adapterPath], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    createInterface({ input: child.stdout }).on("line", (line) =>
      this.onLine(line),
    );
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      const diagnostic = this.sanitizeDiagnostic(chunk).trim();
      if (diagnostic)
        this.stderrTail = [...this.stderrTail, diagnostic].slice(-20);
    });
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code, signal) => {
      if (this.closing) return;
      this.fail(
        new Error(
          `Hermes ACP 已退出（${code === null ? (signal ?? "unknown") : code}）${this.stderrTail.length ? `：${this.stderrTail.at(-1)}` : ""}`,
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
      }),
    );
    if (!session || typeof session.sessionId !== "string")
      throw new Error("Hermes ACP 未返回会话编号");
    this.sessionId = session.sessionId;
  }

  async run(
    prompt: string,
    onEvent: (event: HermesNormalizedEvent) => void,
    timeoutMs = 115_000,
  ): Promise<{ text: string }> {
    if (!this.sessionId) throw new Error("Hermes ACP 尚未创建会话");
    let text = "";
    const listener = (params: unknown): void => {
      const message = record(params);
      if (message?.sessionId !== this.sessionId) return;
      for (const event of mapHermesSessionUpdate(params)) {
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
            sessionId: this.sessionId,
            prompt: [{ type: "text", text: prompt }],
          },
          timeoutMs,
        ),
      );
      const usage = record(result?.usage);
      if (usage)
        onEvent({
          type: "usage",
          inputTokens: Number(usage.inputTokens ?? 0),
          outputTokens: Number(usage.outputTokens ?? 0),
          cachedTokens: Number(usage.cachedReadTokens ?? 0),
        });
      if (!text.trim()) throw new Error("Hermes 未返回有效内容");
      return { text };
    } finally {
      this.updateListeners.delete(listener);
    }
  }

  async cancel(): Promise<void> {
    if (!this.sessionId || !this.child) return;
    this.notify("session/cancel", { sessionId: this.sessionId });
  }

  async close(): Promise<void> {
    if (!this.child || this.closing) return;
    this.closing = true;
    const child = this.child;
    try {
      await this.cancel();
    } catch {}
    this.fail(new Error("Hermes ACP 运行已中断"));
    this.child = undefined;
    child.stdin.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const term = setTimeout(() => child.kill("SIGTERM"), 1_000);
      const kill = setTimeout(() => child.kill("SIGKILL"), 4_000);
      child.once("exit", () => {
        clearTimeout(term);
        clearTimeout(kill);
        resolve();
      });
    });
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
        reject(new Error(`Hermes ACP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: RpcMessage): void {
    if (!this.child?.stdin.writable) throw new Error("Hermes ACP 未运行");
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
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id));
      clearTimeout(pending.timeout);
      if (message.error)
        pending.reject(
          new Error(message.error.message ?? "Hermes ACP 请求失败"),
        );
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: "DramaIP 安全策略拒绝 Hermes 主动调用本地能力",
        },
      });
      return;
    }
    if (message.method === "session/update")
      for (const listener of this.updateListeners) listener(message.params);
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener(error);
  }

  private sanitizeDiagnostic(value: unknown): string {
    return sanitizeHermesDiagnostic(value, [
      this.options.mcp.token,
      this.options.env.DRAMAIP_HERMES_API_KEY ?? "",
      this.options.env.DRAMAIP_MCP_TOKEN ?? "",
    ]);
  }
}
