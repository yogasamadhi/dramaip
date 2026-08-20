import { Context } from "@deepseek-ai/cordis";
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
      this.entries.set(contribution.id, contribution);
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

class ServiceRegistry {
  private readonly values = new Map<
    string,
    { owner: string; service: unknown }
  >();

  forOwner(owner: string): TypedServiceRegistry {
    return {
      provide: <T>(id: string, service: T): Cleanup => {
        const existing = this.values.get(id);
        if (existing)
          throw new Error(
            `duplicate typed service: ${id} (${existing.owner}, ${owner})`,
          );
        this.values.set(id, { owner, service });
        return () => {
          if (this.values.get(id)?.service === service) this.values.delete(id);
        };
      },
      get: <T>(id: string): T | undefined =>
        this.values.get(id)?.service as T | undefined,
      entries: () =>
        [...this.values].map(([id, value]) => ({ id, owner: value.owner })),
    };
  }
}

export interface KernelOptions {
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
  diagnostics(): KernelDiagnostics;
  dispose(): Promise<void>;
}

interface TrackedEffect {
  owner: string;
  label: string;
  revision: string;
  cleanup: Cleanup;
}

class EffectScope {
  private readonly entries: TrackedEffect[] = [];

  effect(
    owner: string,
    revision: string,
    cleanup: Cleanup,
    label = "effect",
  ): void {
    this.entries.push({ owner, revision, cleanup, label });
  }

  diagnostics(): readonly Omit<TrackedEffect, "cleanup">[] {
    return this.entries.map(({ owner, revision, label }) => ({
      owner,
      revision,
      label,
    }));
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
        effect: (cleanup, label) =>
          effects.effect(id, plugin.descriptor.version, cleanup, label),
      };
      const cleanup = await plugin.activate(context);
      if (cleanup) context.effect(cleanup, "activation");
      if (plugin.ui?.length)
        context.effect(ui.register(plugin.ui), "ui-contributions");
      active.push(id);
    }
  } catch (error) {
    const activeId = order[active.length] ?? "unknown";
    failed.push(activeId);
    for (const id of active.reverse()) await effects.disposeOwner(id);
    throw error;
  }
  let disposed = false;
  return {
    pluginOrder: order,
    ui,
    diagnostics,
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of active.reverse()) await effects.disposeOwner(id);
      await effects.disposeAll();
    },
  };
}
