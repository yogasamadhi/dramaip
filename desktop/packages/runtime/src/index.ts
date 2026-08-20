import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
import {
  DRAMAIP_HTTP_API_VERSION,
  DRAMAIP_PLUGIN_API_VERSION,
  DRAMAIP_RUNTIME_VERSION,
  type AgentEngineKind,
  type PluginDescriptor,
  type RuntimeInfo,
  type RuntimeKind,
  type RuntimeMode,
} from "@dramaip/contracts";
import type { DatabaseMaintenanceService } from "@dramaip/contracts/foundation";
import {
  parseProfileDefinition,
  resolveEffectiveGraph,
  type EffectiveRuntimeGraph,
} from "@dramaip/bundles";
import {
  applyMigrations,
  listAppliedMigrations,
  prepareAlpha2ToAlpha3AgentCutover,
  openDatabase,
  prepareDestructiveV3Cutover,
  type DestructiveCutoverOptions,
} from "@dramaip/database";
import {
  DesktopHostClient,
  type HostClientOptions,
} from "@dramaip/desktop-host";
import { PersistentEventRuntime } from "@dramaip/events";
import { createRuntimeHttp } from "@dramaip/http";
import {
  bootKernel,
  validatePluginGraph,
  type RunningKernel,
} from "@dramaip/kernel";
import type {
  FirstPartyPlugin,
  PluginProfile,
} from "@dramaip/plugin-api/internal";
import { createAgentsPlugin } from "@dramaip/agents";
import { automationPlugin } from "@dramaip/automation";
import { creativeQualityPlugin } from "@dramaip/creative-quality";
import { deliveryPlugin } from "@dramaip/delivery";
import { createFoundationPlugin } from "@dramaip/foundation";
import { createInsightsPlugin } from "@dramaip/insights";
import { knowledgePlugin } from "@dramaip/knowledge";
import { createMediaPlugin } from "@dramaip/media";
import { productionPlugin } from "@dramaip/production";
import { createReviewPlugin } from "@dramaip/review";
import { createSystemPlugin } from "@dramaip/system";
import { timelinePlugin } from "@dramaip/timeline";
import { createWorkspacePlugin } from "@dramaip/workspace";
import { writingPlugin } from "@dramaip/writing";

export interface RuntimeConfig {
  databasePath: string;
  profile: PluginProfile;
  accessToken?: string;
  allowedOrigins?: readonly string[];
  engineMcpTokens?: readonly string[];
  host?: HostClientOptions;
  runtimeKind?: RuntimeKind;
  mode?: RuntimeMode;
  destructiveCutover?: Omit<DestructiveCutoverOptions, "databasePath">;
  alpha3AgentCutover?: {
    backupDirectory: string;
    alpha2Version?: string;
  };
  backupDirectory?: string;
}

export interface RuntimeServerOptions {
  hostname: string;
  port: number;
}

export interface RuntimeHandle {
  readonly accessToken: string;
  readonly kernel: RunningKernel;
  readonly profile: PluginProfile;
  readonly runtimeInfo: RuntimeInfo;
  fetch(request: Request): Promise<Response>;
  start(options: RuntimeServerOptions): { close(): void };
  finalizeCutover(): void;
  stop(): Promise<void>;
}

function pluginMap(
  config: RuntimeConfig,
  host = config.host ? new DesktopHostClient(config.host) : undefined,
  maintenance?: DatabaseMaintenanceService,
): ReadonlyMap<string, FirstPartyPlugin> {
  const plugins: FirstPartyPlugin[] = [
    createFoundationPlugin(maintenance),
    createSystemPlugin(host),
    createWorkspacePlugin(host),
    automationPlugin,
    writingPlugin,
    knowledgePlugin,
    createAgentsPlugin(host),
    creativeQualityPlugin,
    productionPlugin,
    createMediaPlugin(host),
    timelinePlugin,
    createReviewPlugin(host),
    deliveryPlugin,
    createInsightsPlugin(host),
  ];
  return new Map(plugins.map((plugin) => [plugin.descriptor.id, plugin]));
}

function collectMigrations(
  plugins: ReadonlyMap<string, FirstPartyPlugin>,
  profile: PluginProfile,
): readonly NonNullable<FirstPartyPlugin["migrations"]>[number][] {
  const migrations: NonNullable<FirstPartyPlugin["migrations"]>[number][] = [];
  for (const id of validatePluginGraph(plugins, profile)) {
    const plugin = plugins.get(id)!;
    migrations.push(...(plugin.migrations ?? []));
  }
  return migrations;
}

export function parseProfile(text: string): PluginProfile {
  const parsed = parseProfileDefinition(text);
  const graph = resolveEffectiveGraph(parsed);
  return profileFromGraph(graph);
}

function profileFromGraph(graph: EffectiveRuntimeGraph): PluginProfile {
  return {
    name: graph.profile,
    bundles: graph.bundles,
    plugins: graph.plugins,
  };
}

export function loadProfile(path: string): PluginProfile {
  return parseProfile(readFileSync(path, "utf8"));
}

export async function bootRuntime(
  config: RuntimeConfig,
): Promise<RuntimeHandle> {
  const host = config.host ? new DesktopHostClient(config.host) : undefined;
  const cutover = config.alpha3AgentCutover
    ? prepareAlpha2ToAlpha3AgentCutover({
        databasePath: config.databasePath,
        ...config.alpha3AgentCutover,
      })
    : config.destructiveCutover
      ? prepareDestructiveV3Cutover({
          databasePath: config.databasePath,
          ...config.destructiveCutover,
        })
      : undefined;
  const database = openDatabase(config.databasePath);
  const backupDirectory =
    config.backupDirectory ??
    config.alpha3AgentCutover?.backupDirectory ??
    config.destructiveCutover?.backupDirectory ??
    resolve(dirname(config.databasePath), "backups");
  const plugins = pluginMap(
    config,
    host,
    database.maintenance(backupDirectory),
  );
  const order = validatePluginGraph(plugins, config.profile);
  const events = new PersistentEventRuntime(database.uow);
  let kernel: RunningKernel | undefined;
  const accessToken =
    config.accessToken ?? randomBytes(32).toString("base64url");
  const runtimeId = randomUUID();
  const runtimeKind = config.runtimeKind ?? "node";
  const mode = config.mode ?? (config.host ? "desktop" : "headless");
  const runtimeInfo = async (): Promise<RuntimeInfo> => {
    const engineKinds: readonly AgentEngineKind[] = ["pi", "codex", "grok"];
    const engineStatus = Object.fromEntries(
      await Promise.all(
        engineKinds.map(async (engine) => [
          engine,
          host
            ? await host.engineHealth(engine).catch(() => ({
                available: false,
                healthy: false,
              }))
            : { available: false, healthy: false, unavailable: "headless" },
        ]),
      ),
    );
    return {
      runtimeId,
      runtimeVersion: DRAMAIP_RUNTIME_VERSION,
      apiVersion: DRAMAIP_HTTP_API_VERSION,
      pluginApiVersion: DRAMAIP_PLUGIN_API_VERSION,
      runtimeKind,
      mode,
      profile: config.profile.name,
      bundles: [...config.profile.bundles],
      plugins: (
        kernel?.diagnostics().plugins ??
        order.map((id) => ({ id, status: "active" as const }))
      ).map((plugin) => ({
        ...plugin,
        version: plugins.get(plugin.id)?.descriptor.version ?? "unknown",
        kind: plugins.get(plugin.id)?.descriptor.kind ?? "built-in",
      })),
      capabilities: {
        desktopHost: Boolean(host),
        fileGrant: Boolean(host),
        credentials: Boolean(host),
        localEngines: Boolean(host),
      },
      engineStatus,
      uiContributions: [...(kernel?.ui.contributions() ?? [])],
    };
  };
  const http = createRuntimeHttp({
    accessToken,
    allowedOrigins: config.allowedOrigins ?? [],
    engineMcpTokens: config.engineMcpTokens,
    capabilityGrantAuthorized: (authorization) => {
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
      if (!token || token.length > 256) return false;
      try {
        const grant = database.sqlite
          .prepare(
            `SELECT expires_at, consumed_at FROM agent_capability_grants
             WHERE id = ? LIMIT 1`,
          )
          .get(token) as
          { expires_at: string; consumed_at: string | null } | undefined;
        return Boolean(
          grant &&
          grant.consumed_at === null &&
          Date.parse(grant.expires_at) > Date.now(),
        );
      } catch {
        // The grants table is installed by the agents migration. Before that
        // migration has completed no scoped grant can be valid.
        return false;
      }
    },
    events,
    version: DRAMAIP_RUNTIME_VERSION,
    runtimeInfo,
    onDiagnostics: async () => {
      const engineKinds: readonly AgentEngineKind[] = ["pi", "codex", "grok"];
      const hostHealth = host
        ? await host.health().catch(() => ({ healthy: false }))
        : { healthy: false, unavailable: "headless" };
      const engines = Object.fromEntries(
        await Promise.all(
          engineKinds.map(async (engine) => [
            engine,
            host
              ? await host.engineHealth(engine).catch(() => ({
                  available: false,
                  healthy: false,
                }))
              : { available: false, healthy: false, unavailable: "headless" },
          ]),
        ),
      );
      return {
        healthy: true,
        profile: config.profile.name,
        plugins:
          kernel?.diagnostics().plugins ??
          order.map((id) => ({ id, status: "active" })),
        migrations: listAppliedMigrations(database.sqlite),
        eventConsumers: events.diagnostics(),
        host: hostHealth,
        engines,
        bridgeRouteCount: 0,
      };
    },
  });
  try {
    applyMigrations(
      database.sqlite,
      collectMigrations(plugins, config.profile),
    );
    kernel = await bootKernel({
      profile: config.profile,
      plugins,
      context: { http: http.registry, events, uow: database.uow },
    });
  } catch (error) {
    database.close();
    cutover?.fail(error);
    throw error;
  }
  let server: { close(): void } | undefined;
  return {
    accessToken,
    kernel,
    profile: config.profile,
    get runtimeInfo() {
      // RuntimeInfo contains asynchronous Host engine probes, so callers obtain
      // the authoritative version through GET /api/v2/runtime.
      return {
        runtimeId,
        runtimeVersion: DRAMAIP_RUNTIME_VERSION,
        apiVersion: DRAMAIP_HTTP_API_VERSION,
        pluginApiVersion: DRAMAIP_PLUGIN_API_VERSION,
        runtimeKind,
        mode,
        profile: config.profile.name,
        bundles: [...config.profile.bundles],
        plugins: kernel!.diagnostics().plugins.map((plugin) => ({
          ...plugin,
          version: plugins.get(plugin.id)!.descriptor.version,
          kind: plugins.get(plugin.id)!.descriptor.kind,
        })),
        capabilities: {
          desktopHost: Boolean(host),
          fileGrant: Boolean(host),
          credentials: Boolean(host),
          localEngines: Boolean(host),
        },
        engineStatus: {},
        uiContributions: [...kernel!.ui.contributions()],
      };
    },
    fetch: http.fetch,
    start(options) {
      if (server) throw new Error("Runtime server is already running");
      server = serve({
        fetch: http.fetch,
        hostname: options.hostname,
        port: options.port,
      });
      return server;
    },
    finalizeCutover() {
      cutover?.finalize();
    },
    async stop() {
      server?.close();
      await kernel!.dispose();
      database.close();
    },
  };
}

export function descriptorList(
  plugins: ReadonlyMap<string, FirstPartyPlugin>,
): readonly PluginDescriptor[] {
  return [...plugins.values()].map((plugin) => plugin.descriptor);
}
