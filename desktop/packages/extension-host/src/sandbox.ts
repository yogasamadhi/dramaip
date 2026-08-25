import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
} from "quickjs-emscripten";

export interface ExtensionCapabilityCall {
  readonly capability: string;
  readonly payload: unknown;
}

export type ExtensionCapabilityBridge = (
  call: ExtensionCapabilityCall,
) => Promise<unknown>;

export interface ExtensionSandboxLimits {
  readonly memoryBytes?: number;
  readonly stackBytes?: number;
  readonly synchronousTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maximumConcurrentRequests?: number;
  readonly requestsPerMinute?: number;
  readonly maximumPayloadBytes?: number;
}

export interface ExtensionSandboxDiagnostics {
  readonly state: "active" | "disposed" | "failed";
  readonly handlerIds: readonly string[];
  readonly activeRequests: number;
  readonly requestsInCurrentWindow: number;
  readonly lastError?: string;
}

const DEFAULT_LIMITS = Object.freeze({
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  synchronousTimeoutMs: 2_000,
  requestTimeoutMs: 30_000,
  maximumConcurrentRequests: 4,
  requestsPerMinute: 100,
  maximumPayloadBytes: 1024 * 1024,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class QuickJsExtensionSandbox {
  private readonly handlers = new Map<string, QuickJSHandle>();
  private readonly requestTimes: number[] = [];
  private activeRequests = 0;
  private state: ExtensionSandboxDiagnostics["state"] = "active";
  private deadline = Number.POSITIVE_INFINITY;
  private lastError: string | undefined;

  private constructor(
    private readonly runtime: QuickJSRuntime,
    private readonly context: QuickJSContext,
    private readonly bridge: ExtensionCapabilityBridge,
    private readonly limits: Required<ExtensionSandboxLimits>,
  ) {}

  static async create(input: {
    readonly bundle: string;
    readonly bridge: ExtensionCapabilityBridge;
    readonly limits?: ExtensionSandboxLimits;
  }): Promise<QuickJsExtensionSandbox> {
    const quickjs = await getQuickJS();
    const runtime = quickjs.newRuntime();
    const limits = { ...DEFAULT_LIMITS, ...input.limits };
    runtime.setMemoryLimit(limits.memoryBytes);
    runtime.setMaxStackSize(limits.stackBytes);
    const context = runtime.newContext();
    const sandbox = new QuickJsExtensionSandbox(
      runtime,
      context,
      input.bridge,
      limits,
    );
    runtime.setInterruptHandler(() => Date.now() > sandbox.deadline);
    try {
      sandbox.installBridge();
      sandbox.deadline = Date.now() + limits.synchronousTimeoutMs;
      const evaluated = context.evalCode(input.bundle, "extension.js");
      context.unwrapResult(evaluated).dispose();
      const activation = context.getProp(context.global, "__dramaipActivation");
      try {
        if (context.typeof(activation) !== "undefined") {
          sandbox.deadline = Date.now() + limits.requestTimeoutMs;
          let activationTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            const activated = await Promise.race([
              context.resolvePromise(activation),
              new Promise<never>((_resolve, reject) => {
                activationTimer = setTimeout(
                  () => reject(new Error("Extension activation timed out")),
                  limits.requestTimeoutMs,
                );
                activationTimer.unref?.();
              }),
            ]);
            context.unwrapResult(activated).dispose();
          } finally {
            if (activationTimer) clearTimeout(activationTimer);
          }
        }
      } finally {
        activation.dispose();
      }
      if (sandbox.handlers.size === 0)
        throw new Error("Extension did not register any handlers");
      sandbox.deadline = Number.POSITIVE_INFINITY;
      return sandbox;
    } catch (error) {
      sandbox.fail(error);
      throw error;
    }
  }

  async invoke(handlerId: string, payload: unknown): Promise<unknown> {
    this.assertActive();
    const handler = this.handlers.get(handlerId);
    if (!handler) throw new Error(`Unknown extension handler: ${handlerId}`);
    const serialized = JSON.stringify(payload ?? null);
    if (Buffer.byteLength(serialized) > this.limits.maximumPayloadBytes)
      throw new Error("Extension request exceeds the payload limit");
    this.enforceRateLimit();
    if (this.activeRequests >= this.limits.maximumConcurrentRequests)
      throw new Error("Extension concurrency limit exceeded");
    this.activeRequests += 1;
    this.deadline = Date.now() + this.limits.synchronousTimeoutMs;
    try {
      const argument = this.context.newString(serialized);
      let promise: QuickJSHandle;
      try {
        promise = this.context.unwrapResult(
          this.context.callFunction(handler, this.context.undefined, argument),
        );
      } finally {
        argument.dispose();
      }
      this.deadline = Date.now() + this.limits.requestTimeoutMs;
      try {
        let requestTimer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          this.context.resolvePromise(promise),
          new Promise<never>((_resolve, reject) => {
            requestTimer = setTimeout(
              () => reject(new Error("Extension request timed out")),
              this.limits.requestTimeoutMs,
            );
            requestTimer.unref?.();
          }),
        ]);
        try {
          const handle = this.context.unwrapResult(result);
          try {
            const dumped = this.context.dump(handle) as unknown;
            const value =
              typeof dumped === "string" ? JSON.parse(dumped) : dumped;
            if (
              Buffer.byteLength(JSON.stringify(value ?? null)) >
              this.limits.maximumPayloadBytes
            )
              throw new Error("Extension response exceeds the payload limit");
            return value;
          } finally {
            handle.dispose();
          }
        } finally {
          if (requestTimer) clearTimeout(requestTimer);
        }
      } finally {
        promise.dispose();
      }
    } catch (error) {
      this.lastError = errorMessage(error);
      if (/interrupted|memory|out of memory|timed out/iu.test(this.lastError))
        this.fail(error);
      throw error;
    } finally {
      this.deadline = Number.POSITIVE_INFINITY;
      this.activeRequests -= 1;
    }
  }

  diagnostics(): ExtensionSandboxDiagnostics {
    const cutoff = Date.now() - 60_000;
    return {
      state: this.state,
      handlerIds: [...this.handlers.keys()].sort(),
      activeRequests: this.activeRequests,
      requestsInCurrentWindow: this.requestTimes.filter(
        (time) => time >= cutoff,
      ).length,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  dispose(): void {
    if (this.state === "disposed") return;
    this.state = "disposed";
    const disposeFunction = this.context.getProp(
      this.context.global,
      "__dramaipDispose",
    );
    try {
      if (this.context.typeof(disposeFunction) === "function") {
        this.deadline = Date.now() + this.limits.synchronousTimeoutMs;
        const result = this.context.callFunction(
          disposeFunction,
          this.context.undefined,
        );
        if ("value" in result) result.value.dispose();
        else result.error.dispose();
      }
    } catch {
      // Cleanup is best-effort once the revision is already being disposed.
    } finally {
      disposeFunction.dispose();
      this.deadline = Number.POSITIVE_INFINITY;
    }
    for (const handler of this.handlers.values()) handler.dispose();
    this.handlers.clear();
    this.context.dispose();
    this.runtime.dispose();
  }

  private installBridge(): void {
    const register = this.context.newFunction(
      "__dramaipRegisterHandler",
      (idHandle, functionHandle) => {
        const id = this.context.getString(idHandle);
        if (!/^[a-z][a-zA-Z0-9._-]{1,100}$/u.test(id))
          throw new Error("Invalid extension handler id");
        if (this.handlers.has(id))
          throw new Error(`Duplicate extension handler: ${id}`);
        this.handlers.set(id, functionHandle.dup());
        return this.context.undefined;
      },
    );
    const capability = this.context.newFunction(
      "__dramaipCapability",
      (capabilityHandle, payloadHandle) => {
        const capabilityName = this.context.getString(capabilityHandle);
        const payloadJson = this.context.getString(payloadHandle);
        if (Buffer.byteLength(payloadJson) > this.limits.maximumPayloadBytes)
          throw new Error("Extension capability payload exceeds the limit");
        const deferred = this.context.newPromise();
        void this.bridge({
          capability: capabilityName,
          payload: JSON.parse(payloadJson),
        })
          .then(
            (value) => {
              const handle = this.context.newString(
                JSON.stringify(value ?? null),
              );
              deferred.resolve(handle);
              handle.dispose();
            },
            (error: unknown) => {
              const handle = this.context.newError(errorMessage(error));
              deferred.reject(handle);
              handle.dispose();
            },
          )
          .finally(() => {
            this.runtime.executePendingJobs();
            deferred.dispose();
          });
        return deferred.handle;
      },
    );
    this.context.setProp(
      this.context.global,
      "__dramaipRegisterHandler",
      register,
    );
    this.context.setProp(
      this.context.global,
      "__dramaipCapability",
      capability,
    );
    register.dispose();
    capability.dispose();
    const bootstrap = this.context.evalCode(`
      (() => {
        const register = globalThis.__dramaipRegisterHandler;
        const capability = globalThis.__dramaipCapability;
        delete globalThis.__dramaipRegisterHandler;
        delete globalThis.__dramaipCapability;
        globalThis.dramaip = Object.freeze({
          registerHandler(id, handler) {
            if (typeof handler !== "function") throw new TypeError("handler must be a function");
            register(id, async (payloadJson) => JSON.stringify(await handler(JSON.parse(payloadJson))));
          },
          async capability(name, payload) {
            return JSON.parse(await capability(name, JSON.stringify(payload ?? null)));
          },
        });
        Object.freeze(globalThis.dramaip);
      })();
    `);
    this.context.unwrapResult(bootstrap).dispose();
  }

  private enforceRateLimit(): void {
    const cutoff = Date.now() - 60_000;
    while (this.requestTimes[0] !== undefined && this.requestTimes[0] < cutoff)
      this.requestTimes.shift();
    if (this.requestTimes.length >= this.limits.requestsPerMinute)
      throw new Error("Extension rate limit exceeded");
    this.requestTimes.push(Date.now());
  }

  private assertActive(): void {
    if (this.state !== "active")
      throw new Error(`Extension sandbox is ${this.state}`);
  }

  private fail(error: unknown): void {
    this.state = "failed";
    this.lastError = errorMessage(error);
    try {
      this.dispose();
    } finally {
      this.state = "failed";
    }
  }
}
