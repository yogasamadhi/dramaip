import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { UtilityProcess } from "electron";

import type {
  EngineCapabilities,
  EngineEvent,
  EngineHealth,
  EngineSession,
  RunInput,
  SessionInput,
} from "@dramaip/contracts";

import type { EngineAdapter } from "./engine-supervisor.ts";

class EventQueue implements AsyncIterable<EngineEvent> {
  private readonly values: EngineEvent[] = [];
  private readonly waiters: Array<
    (value: IteratorResult<EngineEvent>) => void
  > = [];
  private closed = false;

  push(value: EngineEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0))
      waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<EngineEvent> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.closed)
          return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

const capabilities: EngineCapabilities = {
  streaming: true,
  interrupt: true,
  resume: true,
  fork: true,
  tools: ["dramaip-readonly-mcp"],
};

export interface OpenCodeEngineOptions {
  child: UtilityProcess;
  url: string;
  username: string;
  password: string;
  workspaceRoot: string;
  configured: boolean;
}

export class OpenCodeEngineAdapter implements EngineAdapter {
  private ready = false;
  private unavailableReason: string | undefined;
  private readonly sessionByRun = new Map<string, string>();
  private readonly resumableRuns = new Map<string, RunInput>();
  private stopped = false;

  constructor(private readonly options: OpenCodeEngineOptions) {
    options.child.on("message", (raw) => {
      const message = raw as { type?: string; reason?: string };
      if (message.type === "ready") this.ready = true;
      if (message.type === "unavailable")
        this.unavailableReason = String(
          message.reason ?? "OpenCode unavailable",
        );
    });
    options.child.once("exit", (code) => {
      this.ready = false;
      this.unavailableReason = `OpenCode sidecar exited (${code})`;
    });
  }

  waitUntilStarted(timeoutMs = 20_000): Promise<void> {
    if (this.ready || this.unavailableReason) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.options.child.removeListener("message", listener);
        reject(new Error("OpenCode did not start in time"));
      }, timeoutMs);
      const listener = (raw: unknown): void => {
        const message = raw as { type?: string };
        if (message.type !== "ready" && message.type !== "unavailable") return;
        clearTimeout(timeout);
        this.options.child.removeListener("message", listener);
        resolve();
      };
      this.options.child.on("message", listener);
    });
  }

  async health(): Promise<EngineHealth> {
    if (!this.ready || this.unavailableReason)
      return {
        status: "unavailable",
        version: "1.18.15",
        detail: this.unavailableReason ?? "OpenCode process is starting",
      };
    return {
      status: this.options.configured ? "healthy" : "degraded",
      version: "1.18.15",
      ...(!this.options.configured
        ? { detail: "OpenCode model is not configured" }
        : {}),
    };
  }

  async capabilities(): Promise<EngineCapabilities> {
    return capabilities;
  }

  async call(method: string, payload: any): Promise<unknown> {
    if (method === "health") return this.health();
    if (method === "capabilities") return this.capabilities();
    this.assertReady();
    if (method === "createSession") {
      const input = payload as SessionInput;
      const directory = join(this.options.workspaceRoot, crypto.randomUUID());
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const result = (await this.request(
        `/session?directory=${encodeURIComponent(directory)}`,
        { method: "POST", body: JSON.stringify({ title: input.title }) },
      )) as { id?: unknown };
      const sessionId = String(result.id ?? "");
      if (!sessionId) throw new Error("OpenCode returned no session id");
      return {
        sessionId,
        engineKind: "opencode",
        createdAt: new Date().toISOString(),
      } satisfies EngineSession;
    }
    if (method === "interrupt") {
      const runId = String(payload.runId ?? "");
      const sessionId = this.sessionByRun.get(runId);
      if (sessionId)
        await this.request(`/session/${encodeURIComponent(sessionId)}/abort`, {
          method: "POST",
        });
      return;
    }
    if (method === "fork") {
      const source = String(payload.sessionId ?? "");
      const result = (await this.request(
        `/session/${encodeURIComponent(source)}/fork`,
        { method: "POST" },
      )) as { id?: unknown };
      const sessionId = String(result.id ?? "");
      if (!sessionId) throw new Error("OpenCode returned no fork id");
      return {
        sessionId,
        engineKind: "opencode",
        createdAt: new Date().toISOString(),
      } satisfies EngineSession;
    }
    if (method === "dispose") {
      await this.request(
        `/session/${encodeURIComponent(String(payload.sessionId ?? ""))}`,
        { method: "DELETE" },
      );
      return;
    }
    throw new Error(`OpenCode does not support ${method}`);
  }

  stream(
    method: string,
    payload: any,
    signal: AbortSignal,
  ): AsyncIterable<EngineEvent> {
    if (method === "resume") {
      const input = this.resumableRuns.get(String(payload.runId ?? ""));
      if (!input)
        return this.failed(
          String(payload.runId ?? ""),
          "ENGINE_CHECKPOINT_NOT_FOUND",
          "OpenCode run cannot be resumed in this process",
        );
      return this.run(input, signal);
    }
    if (method === "run") return this.run(payload as RunInput, signal);
    return this.failed(
      String(payload.runId ?? ""),
      "ENGINE_METHOD_UNSUPPORTED",
      `OpenCode does not stream ${method}`,
    );
  }

  private run(
    input: RunInput,
    signal: AbortSignal,
  ): AsyncIterable<EngineEvent> {
    const queue = new EventQueue();
    try {
      this.assertReady();
    } catch (error) {
      queue.push({
        type: "run.failed",
        runId: input.runId,
        code: "ENGINE_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      });
      queue.end();
      return queue;
    }
    this.sessionByRun.set(input.runId, input.sessionId);
    this.resumableRuns.set(input.runId, input);
    queue.push({ type: "run.started", runId: input.runId });
    void this.executeRun(input, queue, signal);
    return queue;
  }

  private async executeRun(
    input: RunInput,
    queue: EventQueue,
    signal: AbortSignal,
  ): Promise<void> {
    const eventController = new AbortController();
    const abort = (): void => {
      eventController.abort();
      void this.call("interrupt", { runId: input.runId }).catch(
        () => undefined,
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    let usage = { input: 0, output: 0 };
    const events = this.consumeEvents(
      input,
      eventController.signal,
      queue,
      (value) => (usage = value),
    );
    await Promise.race([
      events.connected,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
    try {
      const result = await this.request(
        `/session/${encodeURIComponent(input.sessionId)}/message`,
        {
          method: "POST",
          body: JSON.stringify({
            agent: "build",
            parts: [{ type: "text", text: input.prompt }],
          }),
          signal,
        },
      );
      queue.push({ type: "item.completed", runId: input.runId, item: result });
      queue.push({ type: "run.completed", runId: input.runId, usage });
      this.resumableRuns.delete(input.runId);
    } catch (error) {
      queue.push({
        type: "run.failed",
        runId: input.runId,
        code: signal.aborted ? "ENGINE_RUN_INTERRUPTED" : "ENGINE_RUN_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      signal.removeEventListener("abort", abort);
      eventController.abort();
      await events.finished.catch(() => undefined);
      queue.end();
    }
  }

  private consumeEvents(
    input: RunInput,
    signal: AbortSignal,
    queue: EventQueue,
    setUsage: (usage: { input: number; output: number }) => void,
  ): { connected: Promise<void>; finished: Promise<void> } {
    let markConnected: (() => void) | undefined;
    const connected = new Promise<void>((resolve) => (markConnected = resolve));
    const finished = (async () => {
      const response = await fetch(new URL("/global/event", this.options.url), {
        headers: {
          authorization: this.authorization(),
          accept: "text/event-stream",
        },
        signal,
      });
      if (!response.ok || !response.body) return;
      markConnected?.();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame
            .split("\n")
            .find((line) => line.startsWith("data:"))
            ?.slice(5)
            .trim();
          if (!data) continue;
          let envelope: Record<string, any>;
          try {
            envelope = JSON.parse(data) as Record<string, any>;
          } catch {
            continue;
          }
          const payload = (envelope.payload ?? envelope) as Record<string, any>;
          const properties = (payload.properties ?? {}) as Record<string, any>;
          const part = properties.part as Record<string, any> | undefined;
          const sessionId = String(
            part?.sessionID ??
              properties.info?.sessionID ??
              properties.sessionID ??
              "",
          );
          if (sessionId !== input.sessionId) continue;
          if (
            payload.type === "message.part.updated" &&
            part?.type === "text" &&
            typeof properties.delta === "string"
          )
            queue.push({
              type: "token.delta",
              runId: input.runId,
              delta: properties.delta,
            });
          if (
            payload.type === "message.part.updated" &&
            part?.type === "tool" &&
            ["completed", "error"].includes(String(part.state?.status))
          )
            queue.push({
              type: "item.completed",
              runId: input.runId,
              item: {
                type: "tool",
                tool: part.tool,
                result: part.state?.output,
                error: part.state?.error,
              },
            });
          if (
            payload.type === "message.part.updated" &&
            part?.type === "step-finish"
          )
            setUsage({
              input: Math.max(0, Number(part.tokens?.input ?? 0)),
              output: Math.max(0, Number(part.tokens?.output ?? 0)),
            });
        }
      }
    })();
    return { connected, finished };
  }

  private async *failed(
    runId: string,
    code: string,
    message: string,
  ): AsyncIterable<EngineEvent> {
    yield { type: "run.failed", runId, code, message };
  }

  private assertReady(): void {
    if (!this.ready || this.unavailableReason)
      throw new Error(this.unavailableReason ?? "OpenCode has not started");
  }

  private authorization(): string {
    return `Basic ${Buffer.from(`${this.options.username}:${this.options.password}`).toString("base64")}`;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("authorization", this.authorization());
    if (init.body) headers.set("content-type", "application/json");
    const response = await fetch(new URL(path, this.options.url), {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(120_000),
    });
    const raw = await response.text();
    if (!response.ok)
      throw new Error(`OpenCode ${response.status}: ${raw.slice(0, 500)}`);
    return raw ? JSON.parse(raw) : undefined;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const child = this.options.child;
    if (child.pid === undefined) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 6_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.postMessage({ type: "stop" });
    });
  }
}
