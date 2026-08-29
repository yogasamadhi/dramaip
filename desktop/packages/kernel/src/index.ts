import { Context } from "@deepseek-ai/cordis";
import { createHash } from "node:crypto";
import type { ServiceContract } from "@dramaip/contracts";
import type {
  Cleanup,
  FirstPartyPlugin,
  KernelDiagnostics,
  PluginContext,
  PluginProfile,
  TypedServiceRegistry,
  UiRegistry,
} from "@dramaip/plugin-api/internal";

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileValidationError";
  }
}

export function validatePluginGraph(
  plugins: ReadonlyMap<string, FirstPartyPlugin>,
  profile: PluginProfile,
): readonly string[] {
  const selected = new Set(profile.plugins.map((entry) => entry.id));
  if (selected.size !== profile.plugins.length)
    throw new ProfileValidationError("profile has duplicate plugin ids");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: string[] = [];
  const visit = (id: string, trail: readonly string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id))
      throw new ProfileValidationError(
        `plugin dependency cycle: ${[...trail, id].join(" -> ")}`,
      );
    const plugin = plugins.get(id);
    if (!plugin) throw new ProfileValidationError(`unknown plugin: ${id}`);
    if (plugin.descriptor.id !== id)
      throw new ProfileValidationError(`plugin registry key mismatch: ${id}`);
    visiting.add(id);
    for (const dependency of plugin.descriptor.requires) {
      if (!selected.has(dependency.id))
        throw new ProfileValidationError(
          `plugin ${id} requires ${dependency.id}`,
        );
      const target = plugins.get(dependency.id);
      if (
        !target ||
        !versionSatisfies(target.descriptor.version, dependency.range)
      )
        throw new ProfileValidationError(
          `plugin ${id} requires ${dependency.id}@${dependency.range}`,
        );
      visit(dependency.id, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
    result.push(id);
  };
  for (const entry of profile.plugins) visit(entry.id, []);
  return result;
}

function versionSatisfies(version: string, range: string): boolean {
  if (range === "*" || range === "") return true;
  const parsed = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!parsed) return false;
  const candidate = parsed.slice(1).map(Number);
  if (range.startsWith("^")) {
    const required = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(range.slice(1));
    if (!required) return false;
    return candidate[0] === Number(required[1]);
  }
  return version === range;
}

export class ContributionRegistry implements UiRegistry {
  private readonly entries = new Map<
    string,
    ReturnType<UiRegistry["contributions"]>[number]
  >();

  register(contributions: Parameters<UiRegistry["register"]>[0]): Cleanup {
    const ids: string[] = [];
    for (const contribution of contributions) {
      if (this.entries.has(contribution.id))
        throw new Error(`duplicate UI contribution: ${contribution.id}`);
      const metadataHash = createHash("sha256")
        .update(
          canonicalJson({
            id: contribution.id,
            pluginId: contribution.pluginId,
            kind: contribution.kind,
            metadata: contribution.metadata,
          }),
        )
        .digest("hex");
      this.entries.set(contribution.id, { ...contribution, metadataHash });
      ids.push(contribution.id);
    }
    return () => {
      for (const id of ids) this.entries.delete(id);
    };
  }

  contributions(): readonly ReturnType<UiRegistry["contributions"]>[number][] {
    return [...this.entries.values()];
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

class ServiceRegistry {
  private readonly values = new Map<
    string,
    {
      owner: string;
      major: number;
      capabilities: readonly string[];
      service: unknown;
    }
  >();

  resolve<T>(contract: ServiceContract<T>): T | undefined {
    const value = this.values.get(contract.id);
    if (value && value.major !== contract.major)
      throw new Error(`service major mismatch: ${contract.id}`);
    return value?.service as T | undefined;
  }

  forOwner(owner: string): TypedServiceRegistry {
    return {
      provide: <T>(contract: ServiceContract<T>, service: T): Cleanup => {
        if (contract.owner !== owner)
          throw new Error(
            `service ${contract.id} is owned by ${contract.owner}, not ${owner}`,
          );
        const existing = this.values.get(contract.id);
        if (existing)
          throw new Error(
            `duplicate typed service: ${contract.id} (${existing.owner}, ${owner})`,
          );
        this.values.set(contract.id, {
          owner,
          major: contract.major,
          capabilities: contract.capabilities,
          service,
        });
        return () => {
          if (this.values.get(contract.id)?.service === service)
            this.values.delete(contract.id);
        };
      },
      require: <T>(contract: ServiceContract<T>): T => {
        const value = this.values.get(contract.id);
        if (!value)
          throw new Error(`required service is unavailable: ${contract.id}`);
        if (value.major !== contract.major)
          throw new Error(`service major mismatch: ${contract.id}`);
        return value.service as T;
      },
      optional: <T>(contract: ServiceContract<T>): T | undefined => {
        if (!contract.degradable)
          throw new Error(
            `service contract is not declared degradable: ${contract.id}`,
          );
        const value = this.values.get(contract.id);
        if (value && value.major !== contract.major)
          throw new Error(`service major mismatch: ${contract.id}`);
        return value?.service as T | undefined;
      },
      entries: () =>
        [...this.values].map(([id, value]) => ({
          id,
          owner: value.owner,
          major: value.major,
          capabilities: value.capabilities,
        })),
    };
  }
}

export interface KernelOptions {
  graphRevision: string;
  profile: PluginProfile;
  plugins: ReadonlyMap<string, FirstPartyPlugin>;
  context: Omit<
    PluginContext,
    | "pluginId"
    | "profile"
    | "ui"
    | "services"
    | "diagnostics"
    | "capability"
    | "effect"
  >;
  capabilities?: ReadonlyMap<string, unknown>;
}

export interface RunningKernel {
  readonly pluginOrder: readonly string[];
  readonly ui: UiRegistry;
  service<T>(contract: ServiceContract<T>): T | undefined;
  diagnostics(): KernelDiagnostics;
  dispose(): Promise<void>;
}

interface TrackedEffect {
  owner: string;
  label: string;
  pluginVersion: string;
  graphRevision: string;
  acquiredAt: string;
  cleanup: Cleanup;
}

class EffectScope {
  private readonly entries: TrackedEffect[] = [];

  effect(
    owner: string,
    pluginVersion: string,
    graphRevision: string,
    cleanup: Cleanup,
    label: string,
  ): void {
    if (!label.trim()) throw new Error("effect label is required");
    this.entries.push({
      owner,
      pluginVersion,
      graphRevision,
      acquiredAt: new Date().toISOString(),
      cleanup,
      label,
    });
  }

  diagnostics(): readonly Omit<TrackedEffect, "cleanup">[] {
    return this.entries.map(
      ({ owner, pluginVersion, graphRevision, acquiredAt, label }) => ({
        owner,
        pluginVersion,
        graphRevision,
        acquiredAt,
        label,
      }),
    );
  }

  async disposeOwner(owner: string): Promise<void> {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const effect = this.entries[index]!;
      if (effect.owner !== owner) continue;
      this.entries.splice(index, 1);
      await effect.cleanup();
    }
  }

  async disposeAll(): Promise<void> {
    while (this.entries.length > 0) await this.entries.pop()!.cleanup();
  }
}

/** Cordis remains the composition root but is intentionally hidden from plugin APIs. */
export async function bootKernel(
  options: KernelOptions,
): Promise<RunningKernel> {
  const cordis = new Context();
  const order = validatePluginGraph(options.plugins, options.profile);
  const ui = new ContributionRegistry();
  const active: string[] = [];
  const failed: string[] = [];
  const effects = new EffectScope();
  const services = new ServiceRegistry();
  const capabilities = options.capabilities ?? new Map<string, unknown>();
  const diagnostics = (): KernelDiagnostics => ({
    profile: options.profile.name,
    plugins: order.map((id) => ({
      id,
      status: failed.includes(id) ? "failed" : "active",
    })),
    routes: options.context.http.routeIds,
    routeContributions: options.context.http.routeDetails,
    bridgeRouteCount: 0,
    effects: effects.diagnostics(),
    services: services.forOwner("kernel-diagnostics").entries(),
  });
  try {
    // Cordis owns the runtime composition lifetime while adapters keep its private Context out of plugins.
    cordis.effect(() => () => undefined, "dramaip-kernel");
    for (const id of order) {
      const plugin = options.plugins.get(id)!;
      const context: PluginContext = {
        ...options.context,
        pluginId: id,
        profile: options.profile.name,
        ui,
        services: services.forOwner(id),
        diagnostics,
        capability: <T>(name: string): T | undefined =>
          capabilities.get(name) as T | undefined,
        effect: (
          label: string,
          acquire: () => Cleanup | Promise<Cleanup>,
        ): void | Promise<void> => {
          const acquired = acquire();
          if (acquired instanceof Promise)
            return acquired.then((cleanup) =>
              effects.effect(
                id,
                plugin.descriptor.version,
                options.graphRevision,
                cleanup,
                label,
              ),
            );
          effects.effect(
            id,
            plugin.descriptor.version,
            options.graphRevision,
            acquired,
            label,
          );
        },
      };
      const cleanup = await plugin.activate(context);
      if (cleanup) context.effect("activation", () => cleanup);
      if (plugin.ui?.length)
        context.effect("ui-contributions", () => ui.register(plugin.ui!));
      active.push(id);
    }
  } catch (error) {
    const activeId = order[active.length] ?? "unknown";
    failed.push(activeId);
    await effects.disposeOwner(activeId);
    for (const id of active.reverse()) await effects.disposeOwner(id);
    throw error;
  }
  let disposed = false;
  return {
    pluginOrder: order,
    ui,
    service: <T>(contract: ServiceContract<T>) => services.resolve(contract),
    diagnostics,
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of active.reverse()) await effects.disposeOwner(id);
      await effects.disposeAll();
    },
  };
}
