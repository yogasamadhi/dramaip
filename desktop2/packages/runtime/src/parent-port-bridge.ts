import type { EngineEvent } from "@dramaip/contracts";
import type { EngineControlBridge, EngineKind } from "@dramaip/agents";
import type {
  FileCapabilityResolver,
  ResolvedFileCapability,
} from "@dramaip/workspace";

export interface ParentPortLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  off(event: "message", listener: (event: { data: unknown }) => void): void;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface StreamState {
  values: EngineEvent[];
  waiters: Array<(result: IteratorResult<EngineEvent>) => void>;
  error?: Error;
  done: boolean;
}

export class ParentPortEngineBridge implements EngineControlBridge {
  private readonly calls = new Map<string, PendingCall>();
  private readonly streams = new Map<string, StreamState>();

  constructor(
    private readonly port: ParentPortLike,
    private readonly timeoutMs = 30_000,
  ) {
    port.on("message", this.onMessage);
  }

  call<T>(kind: EngineKind, method: string, payload: unknown): Promise<T> {
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(requestId);
        reject(new Error(`engine ${kind}.${method} timed out`));
      }, this.timeoutMs);
      timer.unref();
      this.calls.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      this.port.postMessage({
        type: "engine-control:request",
        requestId,
        kind,
        method,
        payload,
        stream: false,
      });
    });
  }

  stream(
    kind: EngineKind,
    method: string,
    payload: unknown,
  ): AsyncIterable<EngineEvent> {
    const requestId = crypto.randomUUID();
    const state: StreamState = { values: [], waiters: [], done: false };
    this.streams.set(requestId, state);
    this.port.postMessage({
      type: "engine-control:request",
      requestId,
      kind,
      method,
      payload,
      stream: true,
    });
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => this.nextStreamValue(requestId, state),
        return: async () => {
          this.port.postMessage({ type: "engine-control:cancel", requestId });
          this.finishStream(requestId, state);
          return { value: undefined, done: true };
        },
      }),
    };
  }

  dispose(): void {
    this.port.off("message", this.onMessage);
    for (const [requestId, call] of this.calls) {
      clearTimeout(call.timer);
      call.reject(new Error("engine bridge disposed"));
      this.calls.delete(requestId);
    }
    for (const [requestId, state] of this.streams)
      this.finishStream(requestId, state, new Error("engine bridge disposed"));
  }

  private nextStreamValue(
    requestId: string,
    state: StreamState,
  ): Promise<IteratorResult<EngineEvent>> {
    const value = state.values.shift();
    if (value) return Promise.resolve({ value, done: false });
    if (state.error) return Promise.reject(state.error);
    if (state.done) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => state.waiters.push(resolve));
  }

  private finishStream(
    requestId: string,
    state: StreamState,
    error?: Error,
  ): void {
    this.streams.delete(requestId);
    state.done = true;
    state.error = error;
    for (const waiter of state.waiters.splice(0))
      waiter({ value: undefined, done: true });
  }

  private readonly onMessage = (event: { data: unknown }): void => {
    const raw = event.data;
    if (!raw || typeof raw !== "object") return;
    const message = raw as {
      type?: string;
      requestId?: string;
      result?: unknown;
      event?: EngineEvent;
      error?: string;
    };
    if (!message.requestId) return;
    if (message.type === "engine-control:response") {
      const call = this.calls.get(message.requestId);
      if (!call) return;
      clearTimeout(call.timer);
      this.calls.delete(message.requestId);
      if (message.error) call.reject(new Error(message.error));
      else call.resolve(message.result);
      return;
    }
    const stream = this.streams.get(message.requestId);
    if (!stream) return;
    if (message.type === "engine-control:event" && message.event) {
      const waiter = stream.waiters.shift();
      if (waiter) waiter({ value: message.event, done: false });
      else stream.values.push(message.event);
    }
    if (message.type === "engine-control:end") {
      this.finishStream(
        message.requestId,
        stream,
        message.error ? new Error(message.error) : undefined,
      );
    }
  };
}

export class ParentPortFileCapabilityResolver implements FileCapabilityResolver {
  private readonly pending = new Map<
    string,
    {
      resolve(value: ResolvedFileCapability | undefined): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly port: ParentPortLike,
    private readonly timeoutMs = 15_000,
  ) {
    port.on("message", this.onMessage);
  }

  resolve(token: string): Promise<ResolvedFileCapability | undefined> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(undefined);
      }, this.timeoutMs);
      timer.unref();
      this.pending.set(requestId, { resolve, timer });
      this.port.postMessage({ type: "capability:resolve", requestId, token });
    });
  }

  dispose(): void {
    this.port.off("message", this.onMessage);
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(undefined);
      this.pending.delete(requestId);
    }
  }

  private readonly onMessage = (event: { data: unknown }): void => {
    if (!event.data || typeof event.data !== "object") return;
    const message = event.data as {
      type?: string;
      requestId?: string;
      capability?: ResolvedFileCapability;
    };
    if (message.type !== "capability:resolved" || !message.requestId) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.requestId);
    pending.resolve(message.capability);
  };
}
