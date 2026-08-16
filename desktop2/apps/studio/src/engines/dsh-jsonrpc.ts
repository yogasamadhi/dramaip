import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type DshNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type DshNormalizedEvent = Record<string, unknown> & { type: string };

export type DshRuntimeOptions = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
};

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
};

const MAX_STDOUT_BUFFER = 4 * 1024 * 1024;
const STDERR_TAIL_LIMIT = 100;

export function sanitizeDshDiagnostic(value: unknown): string {
  return String(value ?? "")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(/\b(?:sk|dsk)-[A-Za-z0-9_-]{8,}\b/g, "***")
    .replace(
      /(?:\/[\w .-]+){3,}|[A-Za-z]:\\(?:[^\s\\]+\\){2,}[^\s]*/g,
      "[本地路径已隐藏]",
    )
    .slice(0, 2_000);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textBlocks(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => record(block))
    .filter((block): block is Record<string, unknown> => Boolean(block))
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text))
    .join("");
}

function parsedArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function mapDshSessionEvent(
  event: unknown,
  toolNames: Map<string, string>,
): DshNormalizedEvent[] {
  const envelope = record(event);
  const data = record(envelope?.data);
  if (!envelope || !data || typeof envelope.type !== "string") return [];
  if (envelope.type === "assistant/chunk") {
    const chunk = record(data.chunk);
    return chunk?.type === "text-delta" && typeof chunk.text === "string"
      ? [{ type: "content.delta", delta: chunk.text }]
      : [];
  }
  if (envelope.type === "tool/call") {
    const callId = String(data.callId ?? "");
    const name = String(data.name ?? "DramaIP 只读工具");
    if (callId) toolNames.set(callId, name);
    return [
      {
        type: "tool",
        status: "started",
        tool: name,
        server: "dramaip",
        itemId: callId || name,
        arguments: parsedArguments(data.arguments),
      },
    ];
  }
  if (envelope.type === "tool/result") {
    const message = record(data.message);
    const callId = String(message?.toolCallId ?? data.callId ?? "");
    const content = message?.content;
    return [
      {
        type: "tool",
        status: "completed",
        tool: toolNames.get(callId) ?? "DramaIP 只读工具",
        server: "dramaip",
        itemId: callId || "tool",
        result: Array.isArray(content) ? content : data,
        ...(message?.isError === true || data.error
          ? { error: "DramaIP 只读工具调用失败" }
          : {}),
      },
    ];
  }
  if (envelope.type === "assistant/message") {
    const usage = record(data.usage);
    if (!usage) return [];
    return [
      {
        type: "usage",
        inputTokens: Number(usage.inputTokens ?? 0),
        outputTokens: Number(usage.outputTokens ?? 0),
        cachedTokens: Number(usage.cacheReadTokens ?? 0),
      },
    ];
  }
  return [];
}

function isInboxReceipt(event: unknown, messageId: string): boolean {
  const envelope = record(event);
  const data = record(envelope?.data);
  if (envelope?.type !== "agent/inbox/spliced" || !data) return false;
  return (
    Array.isArray(data.inserted) &&
    data.inserted.some((item) => record(item)?.id === messageId)
  );
}

function assistantText(event: unknown): string | undefined {
  const envelope = record(event);
  const data = record(envelope?.data);
  const message = record(data?.message);
  if (envelope?.type !== "assistant/message" || !message) return undefined;
  return textBlocks(message.content);
}

export class DshRuntimeClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly stderrTail: string[] = [];
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<
    (notification: DshNotification) => void
  >();
  private readonly closeListeners = new Set<(error: Error) => void>();
  private sequence = 0;
  private closed = false;
  private closeTask: Promise<void> | undefined;
  private exitPromise: Promise<void> = Promise.resolve();

  constructor(private readonly options: DshRuntimeOptions) {}

  async start(input: {
    cwd: string;
    provider: string;
    model: string;
    maxTokens?: number;
  }): Promise<void> {
    if (this.child) return;
    if (this.closed) throw new Error("DSH Runtime 已关闭");
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.exitPromise = new Promise((resolve) => {
      child.once("exit", () => resolve());
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => this.consumeStderr(chunk));
    child.once("error", (error) => this.fail(error));
    child.once("exit", (code, signal) => {
      this.flushStderr();
      this.fail(
        new Error(
          `DSH Runtime 已退出（${code === null ? (signal ?? "unknown") : code}）${this.stderrTail.length ? `：${this.stderrTail.join(" | ")}` : ""}`,
        ),
      );
    });
    await this.request("initialize", input, 20_000);
  }

  async run(
    sessionId: string,
    prompt: string,
    onEvent: (event: DshNormalizedEvent) => void,
    timeoutMs = 115_000,
  ): Promise<{ text: string }> {
    const queue: DshNotification[] = [];
    const toolNames = new Map<string, string>();
    let cursor = 0;
    let messageId: string | undefined;
    let received = false;
    let finalText = "";
    let finished = false;
    let resolveRun!: (value: { text: string }) => void;
    let rejectRun!: (error: Error) => void;
    const completion = new Promise<{ text: string }>((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      this.notificationListeners.delete(listener);
      this.closeListeners.delete(onClose);
      if (error) rejectRun(error);
      else if (!finalText.trim()) rejectRun(new Error("DSH 未返回有效内容"));
      else resolveRun({ text: finalText });
    };
    const pump = (): void => {
      if (!messageId || finished) return;
      while (cursor < queue.length) {
        const notification = queue[cursor++];
        if (!notification) continue;
        if (!received) {
          if (
            notification.method !== "session.event" ||
            notification.params.sessionId !== sessionId ||
            !isInboxReceipt(notification.params.event, messageId)
          )
            continue;
          received = true;
        }
        if (
          notification.method === "session.event" &&
          notification.params.sessionId === sessionId
        ) {
          for (const event of mapDshSessionEvent(
            notification.params.event,
            toolNames,
          ))
            onEvent(event);
          const nextText = assistantText(notification.params.event);
          if (nextText !== undefined) finalText = nextText;
        }
        if (
          notification.method === "session.status" &&
          notification.params.sessionId === sessionId &&
          notification.params.status === "idle"
        ) {
          finish();
          return;
        }
      }
    };
    const listener = (notification: DshNotification): void => {
      queue.push(notification);
      pump();
    };
    const onClose = (error: Error): void => finish(error);
    const timeout = setTimeout(
      () => finish(new Error("DSH 模型调用超时，可从检查点恢复")),
      timeoutMs,
    );
    this.notificationListeners.add(listener);
    this.closeListeners.add(onClose);
    void this.request("session/prompt", {
      sessionId,
      contentBlocks: [{ type: "text", text: prompt }],
    }).then(
      (value) => {
        const result = record(value);
        if (typeof result?.messageId !== "string") {
          finish(new Error("DSH 未返回消息编号"));
          return;
        }
        messageId = result.messageId;
        pump();
      },
      (error: unknown) =>
        finish(error instanceof Error ? error : new Error(String(error))),
    );
    return completion;
  }

  request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = this.options.requestTimeoutMs ?? 20_000,
  ): Promise<unknown> {
    const child = this.child;
    if (!child || this.closed)
      return Promise.reject(new Error("DSH Runtime 未运行"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DSH JSON-RPC ${method} 响应超时`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  close(): Promise<void> {
    this.closeTask ??= this.performClose();
    return this.closeTask;
  }

  private async performClose(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.closed = true;
      return;
    }
    try {
      await this.request("shutdown", {}, 1_000);
    } catch {
      // EOF and process signals below are the authoritative cleanup path.
    }
    this.closed = true;
    child.stdin.end();
    if (await this.waitForExit(6_000)) return;
    child.kill("SIGTERM");
    if (await this.waitForExit(3_000)) return;
    child.kill("SIGKILL");
    await this.waitForExit(3_000);
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    });
    const exited = this.exitPromise.then(() => true);
    const result = await Promise.race([exited, timedOut]);
    if (timeout) clearTimeout(timeout);
    return result;
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    if (this.stdoutBuffer.length > MAX_STDOUT_BUFFER) {
      this.fail(new Error("DSH JSON-RPC 输出帧超过安全上限"));
      void this.close();
      return;
    }
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.handleMessage(JSON.parse(trimmed));
      } catch {
        this.fail(new Error("DSH JSON-RPC 返回了无效 JSON"));
        void this.close();
        return;
      }
    }
  }

  private handleMessage(value: unknown): void {
    const message = record(value);
    if (!message) return;
    if (typeof message.method === "string") {
      const notification = {
        method: message.method,
        params: record(message.params) ?? {},
      };
      for (const listener of this.notificationListeners) listener(notification);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    const error = record(message.error);
    if (error)
      pending.reject(
        new Error(
          typeof error.message === "string"
            ? sanitizeDshDiagnostic(error.message)
            : "DSH JSON-RPC 请求失败",
        ),
      );
    else pending.resolve(message.result);
  }

  private consumeStderr(chunk: string): void {
    this.stderrBuffer += chunk;
    const lines = this.stderrBuffer.split("\n");
    this.stderrBuffer = lines.pop() ?? "";
    this.appendStderr(lines);
  }

  private flushStderr(): void {
    if (this.stderrBuffer) this.appendStderr([this.stderrBuffer]);
    this.stderrBuffer = "";
  }

  private appendStderr(lines: string[]): void {
    this.stderrTail.push(
      ...lines.filter(Boolean).map((line) => sanitizeDshDiagnostic(line)),
    );
    if (this.stderrTail.length > STDERR_TAIL_LIMIT)
      this.stderrTail.splice(0, this.stderrTail.length - STDERR_TAIL_LIMIT);
  }

  private fail(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    for (const listener of this.closeListeners) listener(error);
  }
}
