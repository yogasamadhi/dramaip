import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  DRAMAIP_PLUGIN_API_VERSION,
  DRAMAIP_RUNTIME_VERSION,
  type DomainEvent,
  type JsonValue,
  type PluginDescriptor,
  type RealtimeEvent,
} from "@dramaip/contracts";
import type {
  Cleanup,
  DeclarativeUiContribution,
  PublicPluginContext,
} from "./public.js";

export type { Cleanup } from "./public.js";

export interface PluginMigration {
  id: string;
  pluginId: string;
  version: string;
  dependsOn: readonly string[];
  sql: string;
  foreignKeysOff?: boolean;
}

export interface PendingDomainEvent {
  type: `${string}.${string}.v${number}`;
  pluginId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: JsonValue;
}

/** Internal only: neither public plugins nor the renderer receives a raw database object. */
export interface UnitOfWorkTransaction {
  run(sql: string, ...parameters: unknown[]): void;
  get<T>(sql: string, ...parameters: unknown[]): T | undefined;
  all<T>(sql: string, ...parameters: unknown[]): T[];
  append(event: PendingDomainEvent): DomainEvent;
}

export interface UnitOfWork {
  execute<T>(work: (transaction: UnitOfWorkTransaction) => T): T;
}

export interface RouteContribution {
  id: string;
  pluginId: string;
  /**
   * Stable route identity used by the effective-graph OpenAPI and migration
   * ledger. Older alpha contributions omit these fields while they are being
   * converted; the final architecture gate requires them for every business
   * route.
   */
  method?: "delete" | "get" | "patch" | "post" | "put";
  path?: `/api/v2/${string}`;
  operationId?: string;
  install(app: OpenAPIHono<any>): void;
}

export interface HttpRouteRegistry {
  register(contribution: RouteContribution): Cleanup;
  readonly routeIds: readonly string[];
  readonly routeDetails?: readonly Omit<RouteContribution, "install">[];
}

export interface EventRuntime {
  publishLive(input: Omit<RealtimeEvent, "id" | "occurredAt">): void;
  subscribeLive(listener: (event: RealtimeEvent) => void): Cleanup;
  replay(afterCursor: number, limit?: number): readonly DomainEvent[];
  registerConsumer(consumer: DurableEventConsumer): Cleanup;
  diagnostics(): readonly EventConsumerDiagnostic[];
}

export interface DurableEventConsumer {
  id: string;
  pluginId: string;
  critical: boolean;
  handle(event: DomainEvent): void | Promise<void>;
}

export interface EventConsumerDiagnostic {
  id: string;
  pluginId: string;
  critical: boolean;
  checkpoint: number;
  status: "healthy" | "retrying" | "degraded";
  consecutiveFailures: number;
  lastError?: string;
}

/** Server plugins publish metadata only. React modules remain in the signed,
 * compile-time Renderer loader registry and are never received over HTTP. */
export type UiContribution = DeclarativeUiContribution;

export interface UiRegistry {
  register(contributions: readonly UiContribution[]): Cleanup;
  contributions(): readonly UiContribution[];
}

/** Owner-aware first-party services are the only implementation bridge
 * between bounded contexts. Plugins publish stable contract interfaces and
 * never import another plugin's source module. */
export interface TypedServiceRegistry {
  provide<T>(id: string, service: T): Cleanup;
  get<T>(id: string): T | undefined;
  entries(): readonly { id: string; owner: string }[];
}

export interface KernelDiagnostics {
  profile: string;
  plugins: readonly { id: string; status: "active" | "failed" }[];
  routes: readonly string[];
  routeContributions?: readonly {
    id: string;
    pluginId: string;
    method?: string;
    path?: string;
    operationId?: string;
  }[];
  bridgeRouteCount: number;
  effects: readonly { owner: string; label: string; revision: string }[];
}

export interface PluginContext extends PublicPluginContext {
  readonly http: HttpRouteRegistry;
  readonly events: EventRuntime;
  readonly uow: UnitOfWork;
  readonly ui: UiRegistry;
  readonly services: TypedServiceRegistry;
  readonly diagnostics: () => KernelDiagnostics;
}

export interface FirstPartyPlugin {
  readonly descriptor: PluginDescriptor;
  readonly migrations?: readonly PluginMigration[];
  readonly ui?: readonly UiContribution[];
  activate(context: PluginContext): void | Cleanup | Promise<void | Cleanup>;
}

export interface PluginProfileEntry {
  id: string;
  config?: JsonValue;
}
export interface PluginProfile {
  name: "studio" | "server" | "safe" | "test" | "e2e";
  bundles: readonly string[];
  plugins: readonly PluginProfileEntry[];
}

export type PluginDescriptorInput = Omit<
  PluginDescriptor,
  | "kind"
  | "apiVersion"
  | "pluginApiVersion"
  | "runtimeVersion"
  | "provides"
  | "critical"
  | "requires"
> & {
  kind?: PluginDescriptor["kind"];
  /** Alpha.1 descriptors used the HTTP version here; normalize them to SDK v1. */
  apiVersion?: string;
  pluginApiVersion?: PluginDescriptor["pluginApiVersion"];
  runtimeVersion?: string;
  provides?: readonly string[];
  critical?: boolean;
  requires: readonly (string | { id: string; range: string })[];
};
export type FirstPartyPluginInput = Omit<FirstPartyPlugin, "descriptor"> & {
  descriptor: PluginDescriptorInput;
};

export function defineFirstPartyPlugin(
  plugin: FirstPartyPluginInput,
): FirstPartyPlugin {
  const descriptor: PluginDescriptor = {
    ...plugin.descriptor,
    kind: plugin.descriptor.kind ?? "built-in",
    apiVersion: DRAMAIP_PLUGIN_API_VERSION,
    pluginApiVersion:
      plugin.descriptor.pluginApiVersion ?? DRAMAIP_PLUGIN_API_VERSION,
    runtimeVersion:
      plugin.descriptor.runtimeVersion ??
      `^${DRAMAIP_RUNTIME_VERSION.split("-")[0]}`,
    provides: [...(plugin.descriptor.provides ?? [])],
    critical:
      plugin.descriptor.critical ?? plugin.descriptor.id === "foundation",
    requires: plugin.descriptor.requires.map((dependency) =>
      typeof dependency === "string"
        ? { id: dependency, range: "*" }
        : dependency,
    ),
  };
  return Object.freeze({ ...plugin, descriptor });
}
