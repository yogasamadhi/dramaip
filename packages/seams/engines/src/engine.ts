/** A provider-configured engine served by a supervised sidecar. */

import type { AgentEngineKind } from "@dramaip/contracts";
import type { HostEngineStreamEvent } from "@dramaip/host-contracts";
import type { EngineOperation, EngineProvider } from "./index.ts";
import type { EngineProviderConfiguration, EngineSidecar } from "./sidecar.ts";

/** The operations whose sidecar names differ from the Host vocabulary. */
const SIDECAR_OPERATIONS: Partial<Record<EngineOperation, string>> = {
  create: "createSession",
  cancel: "interrupt",
  destroy: "dispose",
};

/** What one sidecar engine needs besides its sidecar. */
export interface SidecarEngineOptions {
  readonly kind: AgentEngineKind;
  /** Name used in configuration messages. */
  readonly displayName: string;
  /** Whether `configure` hands this engine the agent provider. */
  readonly configurable: boolean;
  /** Whether an accepted provider is what signs this engine in. */
  readonly providerAuthenticates?: boolean;
}

/** One engine served by a sidecar. */
export class SidecarEngine implements EngineProvider {
  readonly kind: AgentEngineKind;

  /**
   * @param sidecar - the supervised sidecar.
   * @param options - the engine's identity and gates.
   */
  constructor(
    readonly sidecar: EngineSidecar,
    private readonly options: SidecarEngineOptions,
  ) {
    this.kind = options.kind;
  }

  /** The engine-health answer: the operation answer plus supervision facts. */
  async health(): Promise<Record<string, unknown>> {
    const { pendingRequestCount: _pending, ...health } =
      await this.operationHealth();
    return {
      ...health,
      supervisor: this.sidecar.state.snapshot(this.sidecar.pendingRequestCount),
      restartBudget: this.sidecar.restartBudget,
    };
  }

  private async operationHealth(): Promise<Record<string, unknown>> {
    const sidecar = this.sidecar;
    return {
      available: true,
      healthy: sidecar.isHealthy,
      configured: sidecar.configured,
      version: sidecar.version,
      authenticated: sidecar.authenticated,
      generation: sidecar.generation,
      pendingRequestCount: sidecar.pendingRequestCount,
    };
  }

  async operation(
    operation: EngineOperation,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const engine = this.kind;
    if (operation === "availability" || operation === "health")
      return this.operationHealth();
    if (!this.sidecar.isHealthy)
      return {
        available: false,
        code: "ENGINE_UNAVAILABLE",
        engine,
        operation,
        message: "引擎进程未启动或未通过健康检查",
      };
    try {
      return await this.sidecar.request(
        SIDECAR_OPERATIONS[operation] ?? operation,
        payload,
      );
    } catch {
      return {
        available: false,
        code: "ENGINE_OPERATION_FAILED",
        engine,
        operation,
        message: "智能引擎拒绝了此操作，请检查认证、模型和引擎状态。",
      };
    }
  }

  async *stream(
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): AsyncIterable<HostEngineStreamEvent> {
    if (!this.sidecar.isHealthy) {
      yield { type: "error", message: "智能引擎未启动或未通过健康检查。" };
      return;
    }
    const runId = payload.runId;
    if (typeof runId !== "string" || !runId.trim() || runId.length > 300)
      throw new Error("运行编号 长度无效");
    yield* this.sidecar.stream({ ...payload, runId: runId.trim() }, signal);
  }

  async configure(
    provider: EngineProviderConfiguration,
  ): Promise<{ available: boolean; message?: string } | undefined> {
    if (!this.options.configurable) return undefined;
    const result = await this.sidecar.configure(
      this.options.displayName,
      provider,
    );
    this.sidecar.configured = result.available;
    if (this.options.providerAuthenticates)
      this.sidecar.authenticated = result.available;
    return result;
  }

  dispose(): Promise<void> {
    return this.sidecar.stop();
  }
}
