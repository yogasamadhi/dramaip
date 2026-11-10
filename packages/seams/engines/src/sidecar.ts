/**
 * One engine sidecar under the Host's subprocess service: Electron's Node
 * (`ELECTRON_RUN_AS_NODE`) runs the sidecar module, and the two sides speak
 * newline-delimited JSON over the inherited control channel — the protocol
 * the sidecars spoke over Electron's utilityProcess port before (D5).
 *
 * The runner correlates requests, applies the control and run deadlines,
 * routes run events to their stream, restarts a crashed sidecar within its
 * budget, and drains everything in flight when it stops.
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { AgentEngineKind } from "@dramaip/contracts";
import type { HostEngineStreamEvent } from "@dramaip/host-contracts";
import type {
  SubprocessHandle,
  SubprocessRuntime,
} from "@dramaip/infra-subprocess";
import { EngineEventChannel } from "./engine-event-channel.ts";
import {
  EngineRequestDeadline,
  publicEngineErrorMessage,
} from "./engine-request-deadline.ts";
import { ManagedComponentState, RestartBudget } from "./managed-component.ts";
import { hostEngineStreamEvent } from "./stream-event.ts";

/** A sidecar must report `ready` within this long. */
const READY_TIMEOUT_MS = 20_000;

/** Bounded tail of the sidecar's own output, kept for start diagnostics. */
const OUTPUT_TAIL_BYTES = 8_192;

/** The provider configuration `configure` hands to a model-backed sidecar. */
export interface EngineProviderConfiguration {
  /** Native Pi provider id; custom endpoints leave this unset. */
  piProviderId?: string;
  providerKind: "openai" | "anthropic" | "google";
  providerAdapter: "openai" | "openai-compatible" | "anthropic" | "google";
  model: string;
  baseUrl?: string;
  secret: string;
}

/** How to launch one sidecar. */
export interface EngineSidecarOptions {
  /** Engine kind, as callers name it. */
  readonly kind: AgentEngineKind;
  /** Component name used in diagnostics, e.g. `pi-engine`. */
  readonly name: string;
  /** Interpreter argv: the executable and its arguments before the module. */
  readonly runtime: readonly string[];
  /** Absolute path of the sidecar module. */
  readonly entry: string;
  /** Working directory of the sidecar. */
  readonly cwd: string;
  /** The `start` command fields the sidecar receives once spawned. */
  readonly start: Record<string, unknown>;
  /** How long a stopping sidecar may take before it is killed. */
  readonly stopGraceMs: number;
}

type SidecarMessage =
  | {
      type: "ready";
      version?: string;
      configured?: boolean;
      authenticated?: boolean;
    }
  | {
      type: "configured";
      requestId: string;
      available: boolean;
      error?: string;
    }
  | { type: "response"; requestId: string; result?: unknown; error?: string }
  | { type: "event"; runId: string; event: Record<string, unknown> }
  | { type: "diagnostic"; message: string }
  | { type: "unavailable"; reason: string }
  | { type: "error"; error: { message: string } }
  | { type: "stopped" };

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  deadline: EngineRequestDeadline;
  runId?: string;
}

interface PendingConfiguration {
  resolve(value: { available: boolean; message?: string }): void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Credential-like values never leave the sidecar's diagnostics. */
function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/giu, "Bearer [REDACTED]")
    .replace(
      /((?:accessToken|apiKey|credential))\s*[:=]\s*[^\s,}]+/giu,
      "$1=[REDACTED]",
    )
    .trim();
}

/** One supervised engine sidecar. */
export class EngineSidecar {
  readonly state: ManagedComponentState;
  version: string | undefined;
  configured = false;
  authenticated: boolean | undefined;
  private readonly budget = new RestartBudget();
  private readonly command: Record<string, unknown>;
  private readonly requests = new Map<string, PendingRequest>();
  private readonly configurations = new Map<string, PendingConfiguration>();
  private readonly streams = new Map<string, EngineEventChannel>();
  private handle: SubprocessHandle | undefined;
  private healthy = false;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param subprocess - the Host's subprocess service.
   * @param options - how to launch the sidecar.
   */
  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly options: EngineSidecarOptions,
  ) {
    this.state = new ManagedComponentState(options.name);
    this.command = { type: "start", ...options.start };
  }

  /** Whether the sidecar reported ready and has not exited since. */
  get isHealthy(): boolean {
    return this.healthy;
  }

  /** Requests in flight. */
  get pendingRequestCount(): number {
    return this.requests.size;
  }

  /** The crash-restart budget's current window. */
  get restartBudget(): ReturnType<RestartBudget["snapshot"]> {
    return this.budget.snapshot();
  }

  /** The generation of the running sidecar. */
  get generation(): number {
    return this.state.snapshot().generation;
  }

  /**
   * Spawn the sidecar and wait for it to report ready.
   * @returns true when ready; false when it reported itself unavailable.
   * @throws when it exits or times out before reporting.
   */
  start(): Promise<boolean> {
    const restarting = this.state.snapshot().status === "degraded";
    const generation = this.state.beginStart(restarting);
    const handle = this.subprocess.spawn({
      argv: [...this.options.runtime, this.options.entry],
      cwd: this.options.cwd,
      stdio: {
        stdin: "ignore",
        stdout: { maxBytes: OUTPUT_TAIL_BYTES },
        stderr: { maxBytes: OUTPUT_TAIL_BYTES },
        control: "pipe",
      },
      graceMs: this.options.stopGraceMs,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    this.handle = handle;
    const control = handle.control;
    if (control === undefined) {
      handle.terminate();
      return Promise.reject(
        new Error(`${this.options.name} has no control channel`),
      );
    }
    const output = (): string =>
      redact(handle.collected.stderr?.readFrom(0).text ?? "");
    return new Promise<boolean>((resolvePromise, reject) => {
      let settled = false;
      // An unavailable sidecar exits on request; that exit is not a crash.
      let unavailable = false;
      const settle = (outcome: boolean | Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (outcome instanceof Error) {
          handle.terminate();
          reject(outcome);
        } else resolvePromise(outcome);
      };
      const timeout = setTimeout(
        () =>
          settle(
            new Error(
              `${this.options.name} did not become ready within 20 seconds`,
            ),
          ),
        READY_TIMEOUT_MS,
      );
      void handle.done
        .catch(() => ({ exitCode: null }))
        .then(({ exitCode }) => {
          if (this.handle !== handle) return;
          this.handle = undefined;
          this.healthy = false;
          this.state.exited(exitCode ?? undefined);
          if (!settled) {
            const diagnostic = output();
            settle(
              new Error(
                `${this.options.name} exited before ready (${String(exitCode)})${diagnostic ? `: ${diagnostic}` : ""}`,
              ),
            );
            return;
          }
          if (this.stopping || unavailable) return;
          this.failPending(
            `${this.options.name} exited during an active request`,
          );
          this.scheduleRestart();
        });
      const lines = createInterface({ input: control, crlfDelay: Infinity });
      lines.on("line", (line) => {
        if (this.handle !== handle || !line.trim()) return;
        let message: SidecarMessage;
        try {
          message = JSON.parse(line) as SidecarMessage;
        } catch {
          return;
        }
        if (message.type === "ready") {
          this.healthy = true;
          this.version = message.version;
          this.configured = message.configured ?? true;
          this.authenticated = message.authenticated;
          this.state.ready({
            configured: this.configured,
            ...(this.authenticated === undefined
              ? {}
              : { authenticated: this.authenticated }),
          });
          this.budget.markStable();
          settle(true);
          return;
        }
        if (message.type === "unavailable") {
          console.warn(
            `${this.options.name} is unavailable: ${message.reason}`,
          );
          unavailable = true;
          settle(false);
          handle.terminate();
          return;
        }
        if (message.type === "error") {
          settle(new Error(message.error.message));
          return;
        }
        this.receive(message);
      });
      control.on("error", () => undefined);
      this.post({ ...this.command, generation });
    });
  }

  private post(message: Record<string, unknown>): void {
    const control = this.handle?.control;
    if (control === undefined || control.destroyed)
      throw new Error(`${this.options.name} is not running`);
    control.write(`${JSON.stringify(message)}\n`);
  }

  private receive(message: SidecarMessage): void {
    if (message.type === "configured") {
      const pending = this.configurations.get(message.requestId);
      if (!pending) return;
      this.configurations.delete(message.requestId);
      clearTimeout(pending.timeout);
      pending.resolve({
        available: message.available,
        ...(message.error ? { message: message.error } : {}),
      });
      return;
    }
    if (message.type === "response") {
      const pending = this.requests.get(message.requestId);
      if (!pending) return;
      this.requests.delete(message.requestId);
      pending.deadline.dispose();
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
      return;
    }
    if (message.type === "event") {
      for (const request of this.requests.values())
        if (request.runId === message.runId) request.deadline.touch();
      const stream = this.streams.get(message.runId);
      const event = hostEngineStreamEvent(message.event);
      if (stream && event) stream.push(event);
      return;
    }
    if (message.type === "diagnostic")
      console.warn(`${this.options.name}: ${message.message}`);
  }

  private scheduleRestart(): void {
    const delay = this.budget.nextDelay();
    if (delay === undefined) {
      console.error(`${this.options.name} exceeded restart limit`);
      return;
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.stopping) return;
      this.start().catch((error: unknown) => {
        console.error(`Failed to restart ${this.options.name}`, error);
        if (!this.stopping) this.scheduleRestart();
      });
    }, delay);
  }

  /**
   * Send one request to the sidecar.
   * @param operation - the sidecar operation.
   * @param payload - its payload.
   * @returns the sidecar's result.
   */
  request(
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const requestId = randomUUID();
    return new Promise<unknown>((resolvePromise, reject) => {
      const running = ["run", "stream"].includes(operation);
      const deadline = new EngineRequestDeadline(running, (error) => {
        this.requests.delete(requestId);
        if (running)
          void this.request("interrupt", payload).catch(() => undefined);
        reject(error);
      });
      this.requests.set(requestId, {
        resolve: resolvePromise,
        reject,
        deadline,
        ...(running && typeof payload.runId === "string"
          ? { runId: payload.runId }
          : {}),
      });
      try {
        this.post({ type: "request", requestId, operation, payload });
      } catch (error) {
        this.requests.delete(requestId);
        deadline.dispose();
        reject(error as Error);
      }
    });
  }

  /**
   * Hand a model provider to the sidecar. The provider is kept in the start
   * command, so a restarted sidecar comes back configured.
   * @param displayName - the engine's name in messages.
   * @param provider - the resolved provider, secret included.
   * @returns whether the sidecar accepted it.
   */
  configure(
    displayName: string,
    provider: EngineProviderConfiguration,
  ): Promise<{ available: boolean; message?: string }> {
    if (!this.healthy)
      return Promise.resolve({
        available: false,
        message: `${displayName} Runtime 未启动`,
      });
    const requestId = randomUUID();
    const result = new Promise<{ available: boolean; message?: string }>(
      (resolvePromise) => {
        const timeout = setTimeout(() => {
          this.configurations.delete(requestId);
          resolvePromise({
            available: false,
            message: `${displayName} 配置响应超时`,
          });
        }, READY_TIMEOUT_MS);
        this.configurations.set(requestId, {
          resolve: resolvePromise,
          timeout,
        });
      },
    );
    this.command.provider = provider;
    this.post({
      type: "configure",
      requestId,
      engineKind: this.options.kind,
      provider,
    });
    return result;
  }

  /**
   * Run one streamed request, yielding its events and then its result.
   * @param payload - the run payload; `runId` names the stream.
   * @param signal - aborts the run.
   * @returns the stream events.
   */
  async *stream(
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): AsyncIterable<HostEngineStreamEvent> {
    const runId = payload.runId as string;
    if (this.streams.has(runId)) {
      yield { type: "error", message: "该智能任务已在流式执行。" };
      return;
    }
    const channel = new EngineEventChannel();
    this.streams.set(runId, channel);
    const interrupt = (): void => {
      if (this.streams.get(runId) !== channel) return;
      void this.request("interrupt", payload).catch(() => undefined);
      channel.finish({ type: "error", message: "流式连接已中断。" });
    };
    signal.addEventListener("abort", interrupt, { once: true });
    void this.request("run", payload)
      .then((result) => channel.finish({ type: "result", result }))
      .catch((error: unknown) =>
        channel.finish({
          type: "error",
          message: publicEngineErrorMessage(error),
        }),
      );
    try {
      for await (const event of channel) yield event;
    } finally {
      signal.removeEventListener("abort", interrupt);
      if (this.streams.get(runId) === channel) this.streams.delete(runId);
    }
  }

  private failPending(message: string): void {
    for (const [requestId, pending] of this.requests) {
      this.requests.delete(requestId);
      pending.deadline.dispose();
      pending.reject(new Error(message));
    }
    for (const [requestId, pending] of this.configurations) {
      this.configurations.delete(requestId);
      clearTimeout(pending.timeout);
      pending.resolve({ available: false, message });
    }
    for (const channel of this.streams.values())
      channel.finish({ type: "error", message: "智能引擎进程异常退出。" });
    this.streams.clear();
  }

  /**
   * Stop the sidecar: interrupt running work, reject what is pending, ask it
   * to stop, and kill it once its grace period is over.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    this.budget.dispose();
    const handle = this.handle;
    this.healthy = false;
    for (const runId of this.streams.keys())
      void this.request("interrupt", { runId }).catch(() => undefined);
    this.failPending(`${this.options.name} stopped`);
    if (handle === undefined) {
      this.state.stopped();
      return;
    }
    this.state.stopping();
    try {
      this.post({ type: "stop" });
    } catch {
      handle.terminate();
    }
    let grace: ReturnType<typeof setTimeout> | undefined;
    const graceful = await Promise.race([
      handle.done.then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolvePromise) => {
        grace = setTimeout(
          () => resolvePromise(false),
          this.options.stopGraceMs,
        );
      }),
    ]);
    // A sidecar that stopped in time must not leave the grace timer holding
    // the Host's event loop open after shutdown.
    clearTimeout(grace);
    if (!graceful) handle.terminate();
    await handle.waitForExit().catch(() => undefined);
    this.handle = undefined;
    this.state.stopped();
  }
}
