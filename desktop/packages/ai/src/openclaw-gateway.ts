import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type GatewayFrame = {
  type?: string;
  id?: string;
  method?: string;
  event?: string;
  ok?: boolean;
  payload?: unknown;
  error?: { message?: string };
};
type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

export type OpenClawNormalizedEvent = Record<string, unknown> & {
  type: string;
};
export type OpenClawGatewayOptions = {
  command: string;
  entryPath: string;
  cwd: string;
  stateDirectory: string;
  configPath: string;
  port: number;
  token: string;
  env: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function sanitizeOpenClawDiagnostic(
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

export function mapOpenClawAgentEvent(
  payload: unknown,
): OpenClawNormalizedEvent[] {
  const event = record(payload);
  const data = record(event?.data);
  if (!event || !data) return [];
  const normalized: OpenClawNormalizedEvent[] = [];
  const usage = record(data.usage);
  if (usage)
    normalized.push({
      type: "usage",
      inputTokens: Number(
        usage.inputTokens ?? usage.promptTokens ?? usage.input ?? 0,
      ),
      outputTokens: Number(
        usage.outputTokens ?? usage.completionTokens ?? usage.output ?? 0,
      ),
      cachedTokens: Number(
        usage.cachedTokens ?? usage.cacheReadTokens ?? usage.cacheRead ?? 0,
      ),
    });
  const stream = String(event.stream ?? "");
  if (stream === "assistant") {
    const delta =
      typeof data.delta === "string"
        ? data.delta
        : typeof data.deltaText === "string"
          ? data.deltaText
          : undefined;
    if (delta) normalized.unshift({ type: "content.delta", delta });
    return normalized;
  }
  if (stream === "tool") {
    const phase = String(data.phase ?? data.status ?? "");
    const completed = [
      "end",
      "complete",
      "completed",
      "result",
      "failed",
    ].includes(phase);
    normalized.unshift({
      type: "tool",
      status: completed ? "completed" : "started",
      tool: String(data.name ?? data.tool ?? "DramaIP 只读工具"),
      server: "dramaip",
      itemId: String(data.toolCallId ?? data.id ?? "tool"),
      ...(completed
        ? { result: data.result ?? data.output ?? {} }
        : { arguments: data.args ?? data.input ?? {} }),
      ...(phase === "failed" || data.error
        ? { error: "DramaIP 只读工具调用失败" }
        : {}),
    });
    return normalized;
  }
  return normalized;
}

export class OpenClawGatewayClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private socket: WebSocket | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<
    (event: string, payload: unknown) => void
  >();
  private sequence = 0;
  private closing = false;
  private stderrTail: string[] = [];
  private challengeNonce: string | undefined;

  constructor(private readonly options: OpenClawGatewayOptions) {}

  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(
      this.options.command,
      [
        this.options.entryPath,
        "gateway",
        "run",
        "--bind",
        "loopback",
        "--port",
        String(this.options.port),
      ],
      {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const collectDiagnostic = (chunk: string): void => {
      const diagnostic = this.sanitizeDiagnostic(chunk).trim();
      if (diagnostic)
        this.stderrTail = [...this.stderrTail, diagnostic].slice(-20);
    };
    child.stdout.on("data", collectDiagnostic);
    child.stderr.on("data", collectDiagnostic);
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code, signal) => {
      if (this.closing) return;
      this.fail(
        new Error(
          `OpenClaw Gateway 已退出（${code === null ? (signal ?? "unknown") : code}）${this.stderrTail.length ? `：${this.stderrTail.at(-1)}` : ""}`,
        ),
      );
    });
    const deadline = Date.now() + (this.options.startupTimeoutMs ?? 20_000);
    let lastError: unknown;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        await this.connect();
        return;
      } catch (error) {
        lastError = error;
        this.socket?.close();
        this.socket = undefined;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    await this.close();
    throw new Error(
      `OpenClaw Gateway 启动失败：${sanitizeOpenClawDiagnostic(
        lastError instanceof Error ? lastError.message : lastError,
        this.sensitiveValues(),
      )}`,
    );
  }

  async run(
    input: {
      runId: string;
      sessionKey: string;
      prompt: string;
      timeoutMs?: number;
    },
    onEvent: (event: OpenClawNormalizedEvent) => void,
  ): Promise<{ text: string }> {
    let text = "";
    const listener = (eventName: string, payload: unknown): void => {
      if (eventName !== "agent") return;
      const event = record(payload);
      if (event?.runId !== input.runId) return;
      const data = record(event.data);
      if (event.stream === "assistant" && typeof data?.text === "string") {
        const next = data.text;
        if (next.startsWith(text)) {
          const delta = next.slice(text.length);
          if (delta) onEvent({ type: "content.delta", delta });
          text = next;
        }
      }
      for (const normalized of mapOpenClawAgentEvent(payload)) {
        if (
          normalized.type === "content.delta" &&
          typeof data?.text !== "string"
        )
          text += String(normalized.delta ?? "");
        if (
          normalized.type !== "content.delta" ||
          typeof data?.text !== "string"
        )
          onEvent(normalized);
      }
    };
    this.eventListeners.add(listener);
    try {
      const accepted = record(
        await this.request("agent", {
          message: input.prompt,
          agentId: "main",
          sessionKey: input.sessionKey,
          deliver: false,
          timeout: Math.ceil((input.timeoutMs ?? 115_000) / 1_000),
          cleanupBundleMcpOnRunEnd: true,
          idempotencyKey: input.runId,
        }),
      );
      if (accepted?.status !== "accepted" && accepted?.status !== "in_flight")
        throw new Error("OpenClaw Gateway 未接收运行请求");
      const final = record(
        await this.request(
          "agent.wait",
          { runId: input.runId, timeoutMs: input.timeoutMs ?? 115_000 },
          (input.timeoutMs ?? 115_000) + 5_000,
        ),
      );
      const waitStatus = String(final?.status ?? "");
      if (waitStatus !== "ok")
        throw new Error(
          waitStatus === "timeout"
            ? "OpenClaw Gateway 运行超时"
            : `OpenClaw Gateway 运行失败${typeof final?.error === "string" ? `：${this.sanitizeDiagnostic(final.error)}` : ""}`,
        );
      const result = record(final?.result);
      const payloads = Array.isArray(result?.payloads) ? result.payloads : [];
      const finalText = payloads
        .map((item) => record(item)?.text)
        .filter((item): item is string => typeof item === "string")
        .join("\n")
        .trim();
      if (finalText) text = finalText;
      const meta = record(result?.meta ?? final?.meta);
      const usage = record(meta?.usage ?? final?.usage);
      if (usage)
        onEvent({
          type: "usage",
          inputTokens: Number(usage.inputTokens ?? usage.promptTokens ?? 0),
          outputTokens: Number(
            usage.outputTokens ?? usage.completionTokens ?? 0,
          ),
          cachedTokens: Number(
            usage.cachedTokens ?? usage.cacheReadTokens ?? 0,
          ),
        });
      if (!text.trim()) throw new Error("OpenClaw 未返回有效内容");
      return { text };
    } finally {
      this.eventListeners.delete(listener);
    }
  }

  async abort(sessionKey: string, runId: string): Promise<void> {
    await this.request("chat.abort", { sessionKey, runId }, 2_000);
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    this.fail(new Error("OpenClaw Gateway 运行已中断"));
    this.socket?.close(1000, "DramaIP shutdown");
    this.socket = undefined;
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const kill = setTimeout(() => child.kill("SIGKILL"), 8_000);
      child.once("exit", () => {
        clearTimeout(kill);
        resolve();
      });
    });
  }

  private async connect(): Promise<void> {
    const socket = new WebSocket(`ws://127.0.0.1:${this.options.port}`);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("OpenClaw Gateway 连接超时")),
        1_000,
      );
      socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error("OpenClaw Gateway 尚未就绪"));
      });
    });
    this.challengeNonce = undefined;
    this.socket = socket;
    socket.addEventListener("message", (event) =>
      this.onMessage(String(event.data)),
    );
    socket.addEventListener("close", () => {
      if (!this.closing) this.fail(new Error("OpenClaw Gateway 连接已关闭"));
    });
    await this.waitForChallenge();
    await this.request("connect", {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: "cli",
        displayName: "DramaIP Desktop",
        version: "3.0.0",
        platform: process.platform,
        mode: "cli",
        instanceId: `dramaip-${process.pid}`,
      },
      caps: ["tool-events"],
      role: "operator",
      scopes: ["operator.write"],
      auth: { token: this.options.token },
    });
  }

  private waitForChallenge(): Promise<void> {
    if (this.challengeNonce) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.eventListeners.delete(listener);
        reject(new Error("OpenClaw Gateway 未发送连接挑战"));
      }, 1_000);
      const listener = (event: string, payload: unknown): void => {
        if (event !== "connect.challenge") return;
        const nonce = record(payload)?.nonce;
        if (typeof nonce !== "string" || !nonce) return;
        this.challengeNonce = nonce;
        clearTimeout(timeout);
        this.eventListeners.delete(listener);
        resolve();
      };
      this.eventListeners.add(listener);
    });
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs = 20_000,
  ): Promise<unknown> {
    const id = `dramaip-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OpenClaw Gateway 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.send({ type: "req", id, method, params });
    });
  }

  private send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      throw new Error("OpenClaw Gateway 未连接");
    this.socket.send(JSON.stringify(message));
  }

  private onMessage(raw: string): void {
    let frame: GatewayFrame;
    try {
      frame = JSON.parse(raw) as GatewayFrame;
    } catch {
      return;
    }
    if (frame.type === "res" && frame.id) {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      clearTimeout(pending.timeout);
      if (frame.ok === false)
        pending.reject(
          new Error(frame.error?.message ?? "OpenClaw Gateway 请求失败"),
        );
      else pending.resolve(frame.payload);
      return;
    }
    if (frame.type === "event" && frame.event) {
      if (frame.event === "connect.challenge") {
        const nonce = record(frame.payload)?.nonce;
        if (typeof nonce === "string" && nonce) this.challengeNonce = nonce;
      }
      for (const listener of this.eventListeners)
        listener(frame.event, frame.payload);
    }
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private sensitiveValues(): string[] {
    return [
      this.options.token,
      this.options.env.DRAMAIP_OPENCLAW_API_KEY ?? "",
      this.options.env.DRAMAIP_MCP_TOKEN ?? "",
    ];
  }

  private sanitizeDiagnostic(value: unknown): string {
    return sanitizeOpenClawDiagnostic(value, this.sensitiveValues());
  }
}
