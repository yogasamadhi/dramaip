/**
 * Transitional host of the services the Kernel used to give every business
 * plugin (D11): persistent domain events over the relational unit of work,
 * the UI contribution registry, Kernel-shaped diagnostics, the capability
 * lookup and the plugin environment. Each moves to a service of its own
 * domain during P4/P5; the package is deleted in P6.
 * @module @dramaip/compat-runtime
 */

import { createHash } from "node:crypto";
import type { Context, EffectMeta, FiberState } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import {
  DomainEventSchemaRegistry,
  PersistentEventRuntime,
} from "@dramaip/events";
import {
  serviceContracts,
  type HttpRouteRegistry,
  type KernelDiagnostics,
  type PendingDomainEvent,
} from "@dramaip/plugin-api/internal";
import { ContributionRegistry } from "@dramaip/plugin-api/ui-registry";
import type { PluginDescriptor } from "@dramaip/contracts";
import {
  DOMAIN_EVENT_MANIFEST,
  DOMAIN_EVENT_PATTERNS,
} from "./event-manifest.generated.ts";
import manifests from "./plugin-manifests.generated.json" with { type: "json" };
import type {} from "@dramaip/host-capabilities";
import type {} from "@dramaip/infra-storage-relational";

/** Value mirror: Cordis's const enum has no runtime object in its built package. */
const FIBER_ACTIVE = 2 as FiberState.ACTIVE;

/** Cordis plugin name. */
export const name = "compat-runtime";

/** The relational backend owns the unit of work events are stored in. */
export const inject = ["uow", "relationalStorage"];

/** Plugin configuration. */
export interface Config {
  /** Profile name reported to business plugins and RuntimeInfo. */
  profile: "studio" | "server" | "safe" | "test" | "e2e";
  /** Validate committed domain events against the generated manifest. */
  validateEvents: boolean;
  /**
   * Hand business plugins the Desktop Host. The desktop bundle sets it and
   * injects `desktopHost` into this row.
   */
  desktopHost: boolean;
}

/** Schemastery validator for {@link Config}. */
export const Config: z<Config> = z.object({
  profile: z
    .union(["studio", "server", "safe", "test", "e2e"] as const)
    .default("server"),
  validateEvents: z.boolean().default(true),
  desktopHost: z.boolean().default(false),
});

/** One business plugin as present in the composed tree. */
export interface BusinessPluginState {
  readonly id: string;
  readonly version: string;
  readonly kind: PluginDescriptor["kind"];
  readonly status: "active" | "failed";
}

/** The `compatRuntime` service: what RuntimeInfo and diagnostics read. */
export interface CompatRuntime {
  readonly runtimeId: string;
  readonly startedAt: string;
  readonly profile: Config["profile"];
  readonly graphRevision: string;
  /** Business plugins composed into this tree, in manifest order. */
  plugins(): readonly BusinessPluginState[];
  readonly ui: ContributionRegistry;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    compatRuntime: CompatRuntime;
  }
}

const descriptors: ReadonlyMap<string, PluginDescriptor> = new Map(
  (manifests as readonly { id: string; descriptor: PluginDescriptor }[]).map(
    (manifest) => [manifest.id, manifest.descriptor],
  ),
);

/**
 * Provide the Kernel-era services on the root of this subtree.
 * @param ctx - plugin context.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const schemas = config.validateEvents
    ? new DomainEventSchemaRegistry(
        DOMAIN_EVENT_MANIFEST,
        DOMAIN_EVENT_PATTERNS,
      )
    : undefined;
  const uow = ctx.uow as typeof ctx.uow & {
    setEventValidator?(validator: (event: PendingDomainEvent) => void): void;
  };
  if (schemas) uow.setEventValidator?.((event) => schemas.validate(event));
  const events = new PersistentEventRuntime(ctx.uow, schemas);
  ctx.effect(() => () => events.dispose(), "compat-runtime: domain events");

  const ui = new ContributionRegistry();
  const registry = ctx.root.registry;
  // Manifest order, not registry order: a reactivated plugin re-enters the
  // registry last but keeps its place in RuntimeInfo and diagnostics.
  const order = [...descriptors.keys()];
  const plugins = (): BusinessPluginState[] =>
    [...registry.values()]
      .filter((runtime) => runtime.name && descriptors.has(runtime.name))
      .sort((a, b) => order.indexOf(a.name!) - order.indexOf(b.name!))
      .map((runtime) => {
        const descriptor = descriptors.get(runtime.name!)!;
        const active =
          [...runtime.fibers].some((fiber) => fiber.state === FIBER_ACTIVE) &&
          ctx.get(`dramaip.plugin.${descriptor.id}`) !== undefined;
        return {
          id: descriptor.id,
          version: descriptor.version,
          kind: descriptor.kind,
          status: active ? "active" : "failed",
        };
      });
  // infra-operations provides the route registry beside this plugin.
  const routes = () =>
    ctx.get("http") as
      Pick<HttpRouteRegistry, "routeIds" | "routeDetails"> | undefined;
  // Effects of business plugin fibers, attributed to the plugin whose
  // `plugin:<id>` effect (from definePlugin) encloses them, as the Kernel did.
  const acquiredAt = new WeakMap<EffectMeta, string>();
  const effects = (): KernelDiagnostics["effects"] => {
    const entries: KernelDiagnostics["effects"][number][] = [];
    const visit = (meta: EffectMeta, owner: string): void => {
      if (!acquiredAt.has(meta)) acquiredAt.set(meta, new Date().toISOString());
      if (meta.label.startsWith("plugin:")) owner = meta.label.slice(7);
      const descriptor = descriptors.get(owner);
      if (descriptor)
        entries.push({
          owner,
          label: meta.label,
          pluginVersion: descriptor.version,
          graphRevision,
          acquiredAt: acquiredAt.get(meta)!,
        });
      for (const child of meta.children) visit(child, owner);
    };
    for (const runtime of registry.values())
      for (const fiber of runtime.fibers)
        for (const meta of fiber.getEffects()) visit(meta, runtime.name ?? "");
    return entries;
  };
  const diagnostics = (): KernelDiagnostics => ({
    profile: config.profile,
    plugins: plugins().map(({ id, status }) => ({ id, status })),
    routes: routes()?.routeIds ?? [],
    routeContributions: routes()?.routeDetails ?? [],
    bridgeRouteCount: 0,
    effects: effects(),
    services: serviceContracts(ctx).map(
      ({ id, owner, major, capabilities }) => ({
        id,
        owner,
        major,
        capabilities,
      }),
    ),
  });
  // One revision per composed generation: the manifests of every business
  // plugin this installation ships, plus the profile it runs.
  const graphRevision = createHash("sha256")
    .update(
      JSON.stringify([
        config.profile,
        [...descriptors.values()].map(({ id, version }) => [id, version]),
      ]),
    )
    .digest("hex");

  ctx.provide("domainEvents", events);
  ctx.provide("ui", ui);
  ctx.provide("diagnostics", diagnostics);
  ctx.provide("profile", config.profile);
  ctx.provide("graphRevision", graphRevision);
  // The Kernel was never given capability values; lookups stay empty.
  ctx.provide("capability", () => undefined);
  ctx.provide("pluginEnvironment", {
    // Only the desktop Profile has a Desktop Host.
    host: config.desktopHost ? ctx.get("desktopHost") : undefined,
    maintenance: ctx.relationalStorage.maintenance(),
  });
  ctx.provide("compatRuntime", {
    runtimeId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    profile: config.profile,
    graphRevision,
    plugins,
    ui,
  } satisfies CompatRuntime);
}
