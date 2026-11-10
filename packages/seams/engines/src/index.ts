/**
 * The engine seam (D5): `ctx.engines` is the registry of agent engines the
 * Desktop Host runs. Each engine bundle registers a provider while its
 * plugin is active; business plugins reach engines only through this
 * registry, and an engine that is not registered answers with a structured
 * error instead of a fallback.
 * @module @dramaip/seams-engines
 */

import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { AgentEngineKind } from "@dramaip/contracts";
import type { HostEngineStreamEvent } from "@dramaip/host-contracts";
import type { EngineProviderConfiguration } from "./sidecar.ts";

export { EngineSidecar } from "./sidecar.ts";
export type {
  EngineProviderConfiguration,
  EngineSidecarOptions,
} from "./sidecar.ts";
export { SidecarEngine } from "./engine.ts";
export type { SidecarEngineOptions } from "./engine.ts";
export { applySidecarEngine, hostNodeRuntime } from "./bundle.ts";
export type { SidecarEngineBundle } from "./bundle.ts";

/** Cordis plugin name. */
export const name = "seams-engines";

/** Every engine kind the Host knows. */
export const ENGINE_KINDS: readonly AgentEngineKind[] = ["pi"];

/** The operations business plugins call on an engine. */
export type EngineOperation =
  | "availability"
  | "create"
  | "run"
  | "cancel"
  | "steer"
  | "resume"
  | "fork"
  | "recoverRun"
  | "destroy"
  | "health";

/** One registered engine. */
export interface EngineProvider {
  readonly kind: AgentEngineKind;
  health(): Promise<Record<string, unknown>>;
  operation(
    operation: EngineOperation,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
  stream(
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): AsyncIterable<HostEngineStreamEvent>;
  /**
   * Accept the agent provider; undefined when this engine does not use one.
   */
  configure?(
    provider: EngineProviderConfiguration,
  ): Promise<{ available: boolean; message?: string } | undefined>;
  /** Stop the engine: interrupt running work and reject pending requests. */
  dispose(): Promise<void>;
}

/** The answer of an engine kind no active plugin registered. */
export function engineNotRegistered(
  engine: AgentEngineKind,
  operation?: EngineOperation,
): Record<string, unknown> {
  return {
    available: false,
    code: "ENGINE_NOT_REGISTERED",
    engine,
    ...(operation ? { operation } : {}),
    message: `${engine} 引擎未注册`,
  };
}

/** The `engines` service. */
export class Engines {
  private readonly providers = new Map<AgentEngineKind, EngineProvider>();
  private readonly tokens = new Map(
    ENGINE_KINDS.map((kind) => [kind, randomUUID()] as const),
  );

  /**
   * Register an engine for the lifetime of the caller's fiber.
   * @param provider - the engine.
   * @returns a disposer that unregisters and stops it.
   */
  register(provider: EngineProvider): () => Promise<void> {
    if (this.providers.has(provider.kind))
      throw new Error(`${provider.kind} engine is already registered`);
    this.providers.set(provider.kind, provider);
    return async () => {
      if (this.providers.get(provider.kind) === provider)
        this.providers.delete(provider.kind);
      await provider.dispose();
    };
  }

  /** The registered engine of a kind, if any. */
  get(kind: AgentEngineKind): EngineProvider | undefined {
    return this.providers.get(kind);
  }

  /** The registered kinds. */
  kinds(): readonly AgentEngineKind[] {
    return [...this.providers.keys()];
  }

  /**
   * The token an engine presents to the private MCP boundary. One per kind,
   * fixed for the lifetime of this service.
   */
  mcpToken(kind: AgentEngineKind): string {
    return this.tokens.get(kind)!;
  }

  /** Every engine MCP token, for the MCP boundary's static allowlist. */
  mcpTokens(): readonly string[] {
    return [...this.tokens.values()];
  }

  async health(kind: AgentEngineKind): Promise<Record<string, unknown>> {
    const provider = this.providers.get(kind);
    return provider ? provider.health() : engineNotRegistered(kind);
  }

  async operation(
    kind: AgentEngineKind,
    operation: EngineOperation,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const provider = this.providers.get(kind);
    return provider
      ? provider.operation(operation, payload)
      : engineNotRegistered(kind, operation);
  }

  async *stream(
    kind: AgentEngineKind,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): AsyncIterable<HostEngineStreamEvent> {
    const provider = this.providers.get(kind);
    if (!provider) {
      yield { type: "error", message: `${kind} 引擎未注册` };
      return;
    }
    yield* provider.stream(payload, signal);
  }

  /**
   * Hand the agent provider to every engine that takes one.
   * @param provider - the resolved provider, secret included.
   * @returns each configurable engine's answer, by kind.
   */
  async configure(
    provider: EngineProviderConfiguration,
  ): Promise<
    Partial<Record<AgentEngineKind, { available: boolean; message?: string }>>
  > {
    const answers = await Promise.all(
      [...this.providers.values()].map(
        async (engine) =>
          [engine.kind, await engine.configure?.(provider)] as const,
      ),
    );
    return Object.fromEntries(
      answers.filter(([, answer]) => answer !== undefined),
    ) as Partial<
      Record<AgentEngineKind, { available: boolean; message?: string }>
    >;
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    engines: Engines;
  }
}

/**
 * Provide the registry.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.provide("engines", new Engines());
}
