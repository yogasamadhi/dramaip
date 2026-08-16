import { randomUUID } from "node:crypto";

import type { UtilityProcess } from "electron";

import type {
  EngineCapabilities,
  EngineEvent,
  EngineHealth,
  EngineSession,
  RunInput,
  SessionInput,
} from "@dramaip/contracts";
import type { EngineKind } from "@dramaip/agents";

import type { EngineAdapter } from "./engine-supervisor.ts";

type ChildMessage =
  | {
      type: "ready";
      version?: string;
      configured?: boolean;
      authenticated?: boolean;
    }
  | { type: "unavailable"; reason: string }
  | { type: "response"; requestId: string; result?: unknown; error?: string }
  | {
      type: "configured";
      requestId: string;
      available: boolean;
      error?: string;
    }
  | {
      type: "event";
      runId: string;
      event: Record<string, unknown>;
    }
  | { type: "diagnostic"; level: string; message: string }
  | { type: "stopped" };

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

class EngineEventQueue implements AsyncIterable<EngineEvent> {
  private readonly values: EngineEvent[] = [];
  private readonly waiters: Array<{
    resolve(value: IteratorResult<EngineEvent>): void;
  }> = [];
  private ended = false;

  push(value: EngineEvent): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0))
      waiter.resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<EngineEvent> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.ended)
          return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.waiters.push({ resolve }));
      },
    };
  }
}

interface ActiveRun {
  input: RunInput;
  queue: EngineEventQueue;
  usage: { input: number; output: number };
}

const capabilities: EngineCapabilities = {
  streaming: true,
  interrupt: true,
  resume: true,
  fork: true,
  tools: ["dramaip-readonly-mcp"],
};

export interface LegacyProcessOptions {
  kind: Exclude<EngineKind, "opencode">;
  version: string;
  child: UtilityProcess;
  startCommand: Record<string, unknown>;
  initiallyConfigured?: boolean;
}

/**
 * Adapts the isolated engine-sidecar protocol to AgentEngineProvider without
 * allowing engine state or implementation types into the Server process.
 */
export class LegacyProcessEngineAdapter implements EngineAdapter {
  private readonly pending = new Map<string, PendingCall>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly sessionByRun = new Map<string, string>();
  private readonly resumableRuns = new Map<string, RunInput>();
  private started = false;
  private configured: boolean;
  private unavailableReason: string | undefined;
  private stopped = false;

  constructor(private readonly options: LegacyProcessOptions) {
    this.configured = options.initiallyConfigured ?? false;
    options.child.on("message", (raw) => this.onMessage(raw as ChildMessage));
    options.child.once("exit", (code) => {
      this.failAll(new Error(`${options.kind} sidecar exited (${code})`));
    });
    options.child.postMessage(options.startCommand);
  }

  waitUntilStarted(timeoutMs = 20_000): Promise<void> {
    if (this.started || this.unavailableReason) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const started = (): void => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.options.child.removeListener("message", listener);
        reject(new Error(`${this.options.kind} did not start in time`));
      }, timeoutMs);
      const listener = (raw: unknown): void => {
        const message = raw as ChildMessage;
        if (message.type === "ready" || message.type === "unavailable") {
          this.options.child.removeListener("message", listener);
          started();
        }
      };
      this.options.child.on("message", listener);
    });
  }

  async health(): Promise<EngineHealth> {
    if (this.unavailableReason)
      return {
        status: "unavailable",
        version: this.options.version,
        detail: this.unavailableReason,
      };
    if (!this.started)
      return {
        status: "unavailable",
        version: this.options.version,
        detail: "engine process is starting",
      };
    return {
      status: this.configured ? "healthy" : "degraded",
      version: this.options.version,
      ...(!this.configured ? { detail: "engine model is not configured" } : {}),
    };
  }

  async capabilities(): Promise<EngineCapabilities> {
    return capabilities;
  }

  async call(method: string, payload: any): Promise<unknown> {
    if (method === "health") return this.health();
    if (method === "capabilities") return this.capabilities();
    if (!this.started || this.unavailableReason)
      throw new Error(
        this.unavailableReason ?? `${this.options.kind} engine has not started`,
      );
    if (method === "configure") return this.configure(payload);
    const normalized = this.normalizePayload(method, payload);
    const result = await this.request(method, normalized);
    if (method === "createSession" || method === "fork") {
      const id = String((result as { id?: unknown } | undefined)?.id ?? "");
      if (!id) throw new Error(`${this.options.kind} returned no session id`);
      return {
        sessionId: id,
        engineKind: this.options.kind,
        createdAt: new Date().toISOString(),
      } satisfies EngineSession;
    }
    return result;
  }

  stream(
    method: string,
    payload: any,
    signal: AbortSignal,
  ): AsyncIterable<EngineEvent> {
    if (method === "resume") {
      const previous = this.resumableRuns.get(String(payload.runId ?? ""));
      if (!previous)
        return this.failedStream(
          String(payload.runId ?? ""),
          "ENGINE_CHECKPOINT_NOT_FOUND",
          "engine run cannot be resumed in this process",
        );
      return this.startRun(previous, signal);
    }
    if (method !== "run")
      return this.failedStream(
        String(payload.runId ?? ""),
        "ENGINE_METHOD_UNSUPPORTED",
        `${this.options.kind} does not stream ${method}`,
      );
    return this.startRun(payload as RunInput, signal);
  }

  private startRun(
    input: RunInput,
    signal: AbortSignal,
  ): AsyncIterable<EngineEvent> {
    const queue = new EngineEventQueue();
    if (!this.started || this.unavailableReason) {
      queue.push({
        type: "run.failed",
        runId: input.runId,
        code: "ENGINE_UNAVAILABLE",
        message: this.unavailableReason ?? "engine has not started",
      });
      queue.end();
      return queue;
    }
    const run: ActiveRun = {
      input,
      queue,
      usage: { input: 0, output: 0 },
    };
    this.activeRuns.set(input.runId, run);
    this.sessionByRun.set(input.runId, input.sessionId);
    this.resumableRuns.set(input.runId, input);
    queue.push({ type: "run.started", runId: input.runId });
    const abort = (): void => {
      void this.call("interrupt", { runId: input.runId }).catch(
        () => undefined,
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    const requestId = randomUUID();
    const timeout = setTimeout(() => {
      this.pending.delete(requestId);
      this.finishRun(input.runId, undefined, new Error("engine run timed out"));
    }, 120_000);
    this.pending.set(requestId, {
      resolve: (result) => {
        signal.removeEventListener("abort", abort);
        this.finishRun(input.runId, result);
      },
      reject: (error) => {
        signal.removeEventListener("abort", abort);
        this.finishRun(input.runId, undefined, error);
      },
      timeout,
    });
    this.options.child.postMessage({
      type: "request",
      requestId,
      operation: "run",
      payload: this.normalizePayload("run", input),
    });
    return queue;
  }

  private async *failedStream(
    runId: string,
    code: string,
    message: string,
  ): AsyncIterable<EngineEvent> {
    yield { type: "run.failed", runId, code, message };
  }

  private finishRun(runId: string, result?: unknown, error?: Error): void {
    const active = this.activeRuns.get(runId);
    if (!active) return;
    this.activeRuns.delete(runId);
    if (error) {
      active.queue.push({
        type: "run.failed",
        runId,
        code: "ENGINE_RUN_FAILED",
        message: error.message,
      });
    } else {
      active.queue.push({ type: "item.completed", runId, item: result });
      active.queue.push({
        type: "run.completed",
        runId,
        usage: active.usage,
      });
      this.resumableRuns.delete(runId);
    }
    active.queue.end();
  }

  private normalizePayload(
    method: string,
    payload: any,
  ): Record<string, unknown> {
    if (method === "createSession") {
      const input = payload as SessionInput;
      return {
        projectId: input.projectId,
        title: input.title,
        ...(input.model ? { model: { modelId: input.model } } : {}),
        ...input.metadata,
      };
    }
    if (method === "run") {
      const input = payload as RunInput;
      return {
        engineSessionId: input.sessionId,
        runId: input.runId,
        prompt: input.prompt,
        ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      };
    }
    if (method === "fork" || method === "dispose")
      return { engineSessionId: String(payload.sessionId ?? "") };
    if (method === "interrupt")
      return {
        runId: String(payload.runId ?? ""),
        engineSessionId: this.sessionByRun.get(String(payload.runId ?? "")),
      };
    return payload && typeof payload === "object" ? payload : {};
  }

  private request(
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(`${this.options.kind} request timed out: ${operation}`),
        );
      }, 120_000);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.options.child.postMessage({
        type: "request",
        requestId,
        operation,
        payload,
      });
    });
  }

  private configure(payload: Record<string, unknown>): Promise<unknown> {
    if (!(["dsh", "pi"] as const).includes(this.options.kind as never))
      return this.request("configure", payload);
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${this.options.kind} configuration timed out`));
      }, 20_000);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.options.child.postMessage({
        type: "configure",
        requestId,
        provider: payload,
      });
    });
  }

  private onMessage(message: ChildMessage): void {
    if (message.type === "ready") {
      this.started = true;
      this.configured =
        message.configured ?? message.authenticated ?? this.configured;
      return;
    }
    if (message.type === "unavailable") {
      this.unavailableReason = message.reason;
      this.failAll(new Error(message.reason));
      return;
    }
    if (message.type === "diagnostic") {
      console.warn(`${this.options.kind}: ${message.message}`);
      return;
    }
    if (message.type === "configured") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timeout);
      this.configured = message.available;
      if (message.available) pending.resolve({ available: true });
      else pending.reject(new Error(message.error ?? "configuration failed"));
      return;
    }
    if (message.type === "response") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timeout);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.type === "event")
      this.onEngineEvent(message.runId, message.event);
  }

  private onEngineEvent(runId: string, event: Record<string, unknown>): void {
    const active = this.activeRuns.get(runId);
    if (!active) return;
    if (event.type === "content.delta" && typeof event.delta === "string") {
      active.queue.push({ type: "token.delta", runId, delta: event.delta });
      return;
    }
    if (event.type === "usage") {
      active.usage = {
        input: Math.max(0, Number(event.inputTokens ?? 0)),
        output: Math.max(0, Number(event.outputTokens ?? 0)),
      };
      return;
    }
    if (event.type === "tool" && event.status === "completed")
      active.queue.push({ type: "item.completed", runId, item: event });
  }

  private failAll(error: Error): void {
    this.started = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const runId of this.activeRuns.keys())
      this.finishRun(runId, undefined, error);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.failAll(new Error(`${this.options.kind} engine stopped`));
    const child = this.options.child;
    if (child.pid === undefined) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 8_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.postMessage({ type: "stop" });
    });
  }
}
