import { fileURLToPath } from "node:url";
import { RuntimeDevelopment } from "./development.js";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { serve } from "@hono/node-server";
import {
  DRAMAIP_HTTP_API_VERSION,
  DRAMAIP_PLUGIN_API_VERSION,
  DRAMAIP_RUNTIME_VERSION,
  defineCapabilityDescriptor,
  type AgentEngineKind,
  type CapabilityDescriptor,
  type PluginDescriptor,
  type RuntimeInfo,
  type RuntimeKind,
  type RuntimeMode,
} from "@dramaip/contracts";
import {
  KNOWLEDGE_WEB_RESEARCH_SERVICE,
  type KnowledgeWebResearchService,
  type WebResearchSearchInput,
} from "@dramaip/contracts/knowledge";
import {
  parseProfileDefinition,
  resolveEffectiveGraph,
  type EffectiveRuntimeGraph,
} from "@dramaip/bundles";
import {
  listAppliedMigrations,
  prepareAlpha2ToAlpha3AgentCutover,
  openDatabase,
  prepareDestructiveV3Cutover,
  runMigrationPlan,
  type DestructiveCutoverOptions,
  type MigrationRunDiagnostic,
} from "@dramaip/database";
import { runMigrationPlanInWorker } from "@dramaip/database/migration-worker";
import {
  DesktopHostClient,
  type HostClientOptions,
} from "@dramaip/desktop-host";
import {
  DomainEventSchemaRegistry,
  PersistentEventRuntime,
} from "@dramaip/events";
import { createRuntimeHttp } from "@dramaip/http";
import { ExtensionPlatform } from "@dramaip/system/extension-platform";
import {
  bootKernel,
  validatePluginGraph,
  type RunningKernel,
} from "@dramaip/kernel";
import type {
  FirstPartyPlugin,
  PluginProfile,
} from "@dramaip/plugin-api/internal";
import {
  collectPluginMigrations,
  createFirstPartyPluginRegistry,
} from "./plugin-registry.js";
import { EffectiveGraphBuilder } from "./effective-graph.js";
import {
  DOMAIN_EVENT_MANIFEST,
  DOMAIN_EVENT_PATTERNS,
} from "./event-manifest.generated.js";

export {
  collectPluginMigrations,
  createFirstPartyPluginRegistry,
} from "./plugin-registry.js";

export interface RuntimeConfig {
  development?: { onRestart(reason: Error): void };
  databasePath: string;
  profile: PluginProfile;
  accessToken?: string;
  allowedOrigins?: readonly string[];
  engineMcpTokens?: readonly string[];
  host?: HostClientOptions;
  runtimeKind: RuntimeKind;
  mode?: RuntimeMode;
  runtimeGeneration?: number;
  destructiveCutover?: Omit<DestructiveCutoverOptions, "databasePath">;
  alpha3AgentCutover?: {
    backupDirectory: string;
    alpha2Version?: string;
  };
  backupDirectory?: string;
  migrationWorker?: {
    runtimeKind: RuntimeKind;
    executable: string;
    entry: string;
    execArgv?: readonly string[];
  };
}

function runtimeCapabilityDescriptors(
  hostAvailable: boolean,
): Readonly<Record<string, CapabilityDescriptor>> {
  const hostState = hostAvailable ? "experimental" : "unavailable";
  return Object.freeze({
    "desktop.host": defineCapabilityDescriptor({
      id: "desktop.host",
      state: hostState,
      version: DRAMAIP_RUNTIME_VERSION,
      limitations: hostAvailable
        ? ["Host 能力需分别通过产品验收后才能标记 verified。"]
        : ["Headless/Server 模式不提供 Desktop Host。"],
    }),
    "host.files": defineCapabilityDescriptor({
      id: "host.files",
      state: hostState,
      version: DRAMAIP_RUNTIME_VERSION,
      requiredHostCapabilities: ["files"],
    }),
    "host.credentials": defineCapabilityDescriptor({
      id: "host.credentials",
      state: hostState,
      version: "2",
      limitations: hostAvailable
        ? ["保险库后端状态由 Desktop Host 单独报告。"]
        : ["Headless 模式没有明文凭据回退。"],
      requiredHostCapabilities: ["credentials"],
    }),
    "engines.local": defineCapabilityDescriptor({
      id: "engines.local",
      state: hostState,
      version: DRAMAIP_RUNTIME_VERSION,
      requiredHostCapabilities: ["engines"],
    }),
    "media.video-generation.seedance": defineCapabilityDescriptor({
      id: "media.video-generation.seedance",
      state: hostAvailable ? "experimental" : "unavailable",
      version: "ark-2024-01-01",
      limitations: [
        "使用火山方舟异步内容生成任务协议；仍需真实账号连续 smoke 与本地归档证据。",
        "未从模型能力响应确认的取消和原生音频能力不会被声明。",
      ],
      requiredHostCapabilities: ["provider-http", "media-library"],
      requiredProviderCapabilities: ["contents-generations-tasks"],
    }),
    "media.video-generation.minimax-h3-cloud": defineCapabilityDescriptor({
      id: "media.video-generation.minimax-h3-cloud",
      state: hostAvailable ? "experimental" : "unavailable",
      version: "v2",
      limitations: [
        "使用 MiniMax H3 v2 异步任务协议；远端成功不等于本地归档成功。",
        "运行中任务不能通过 queued-only 取消端点伪装取消。",
      ],
      requiredHostCapabilities: ["provider-http", "media-library"],
      requiredProviderCapabilities: ["video-generation-v2"],
    }),
    "media.archive": defineCapabilityDescriptor({
      id: "media.archive",
      state: "unavailable",
      version: "1",
      limitations: [
        "签名 ffprobe 能力和原子媒体归档尚未完成产品验收；远端 URL 不会写入 Runtime DB。",
      ],
      requiredHostCapabilities: ["media-library", "renderer.ffprobe"],
    }),
    "timeline.render": defineCapabilityDescriptor({
      id: "timeline.render",
      state: "unavailable",
      version: "1",
      limitations: ["签名 FFmpeg+x264 sidecar 尚未安装并通过发行验收。"],
      requiredHostCapabilities: ["renderer.ffmpeg-x264"],
    }),
    "production.screenplay-interchange": defineCapabilityDescriptor({
      id: "production.screenplay-interchange",
      state: hostAvailable ? "experimental" : "unavailable",
      version: "1",
      limitations: hostAvailable
        ? [
            "Fountain 与 FDX 已具备安全 Preview→Commit 和结构损失报告；仍需 Electron 产品验收后才能标记 verified。",
            "PDF 仅文本层解析尚未实现，扫描 PDF/OCR 明确不可用。",
          ]
        : ["Headless/Server 模式没有本地文件 grant，不能导入剧本文件。"],
      requiredHostCapabilities: ["files"],
    }),
  });
}

export interface RuntimeServerOptions {
  hostname: string;
  port: number;
}

export interface RuntimeServer {
  readonly hostname: string;
  readonly port: number;
  close(): void;
}

export interface RuntimeHandle {
  readonly accessToken: string;
  readonly kernel: RunningKernel;
  readonly profile: PluginProfile;
  readonly runtimeInfo: RuntimeInfo;
  fetch(request: Request): Promise<Response>;
  start(options: RuntimeServerOptions): Promise<RuntimeServer>;
  finalizeCutover(): void;
  stop(): Promise<void>;
}

const profileConfiguration = new WeakMap<
  PluginProfile,
  ReadonlyMap<string, Buffer>
>();

function configurationReader() {
  const files = new Map<string, Buffer>();
  return {
    files,
    read(path: string | URL): string {
      const filename =
        typeof path === "string" ? resolve(path) : fileURLToPath(path);
      let content = files.get(filename);
      if (!content) {
        content = readFileSync(path);
        files.set(filename, content);
      }
      return content.toString("utf8");
    },
  };
}

function parseObservedProfile(
  text: string,
  reader: ReturnType<typeof configurationReader>,
): PluginProfile {
  const profile = profileFromGraph(
    resolveEffectiveGraph(parseProfileDefinition(text), undefined, reader.read),
  );
  profileConfiguration.set(profile, reader.files);
  return profile;
}

export function parseProfile(text: string): PluginProfile {
  return parseObservedProfile(text, configurationReader());
}

function profileFromGraph(graph: EffectiveRuntimeGraph): PluginProfile {
  return {
    name: graph.profile,
    bundles: graph.bundles,
    plugins: graph.plugins,
    assembly: graph.assembly,
  };
}

export function loadProfile(path: string | URL): PluginProfile {
  const reader = configurationReader();
  const observed = parseObservedProfile(reader.read(path), reader);
  const profile = {
    ...observed,
    assembly: observed.assembly
      ? {
          ...observed.assembly,
          files: [
            ...observed.assembly.files,
            typeof path === "string" ? resolve(path) : fileURLToPath(path),
          ],
        }
      : undefined,
  };
  // The Desktop launcher can legitimately load its named Profile JSON from
  // the source tree while Core executes a detached build. Preserve those exact
  // already-parsed bytes under its logical artifact path; never put external
  // paths in the recovery journal or widen arbitrary receipt validation.
  const inputs = new Map(reader.files);
  const filename =
    typeof path === "string" ? resolve(path) : fileURLToPath(path);
  const recoveryPath = fileURLToPath(
    new URL(`../../../profiles/${profile.name}.json`, import.meta.url),
  );
  const originalBytes = inputs.get(filename);
  if (!originalBytes)
    throw new Error("Original parsed Profile input is unavailable");
  inputs.delete(filename);
  inputs.set(recoveryPath, originalBytes);
  profileConfiguration.set(profile, inputs);
  return profile;
}

export async function bootRuntime(
  config: RuntimeConfig,
): Promise<RuntimeHandle> {
  const runtimeKind = config.runtimeKind;
  if (process.versions.bun || process.versions.node !== "24.18.0")
    throw new Error(
      "Core Runtime requires Node 24.18.0 (standalone or Electron embedded)",
    );
  if (Boolean(process.versions.electron) !== (runtimeKind === "electron-node"))
    throw new Error(
      `Runtime kind ${runtimeKind} does not match the executing process`,
    );
  const mode = config.mode ?? (config.host ? "desktop" : "headless");
  if (
    (mode === "desktop" && runtimeKind !== "electron-node") ||
    (runtimeKind !== "electron-node" && runtimeKind !== "node")
  )
    throw new Error(`Runtime kind ${runtimeKind} is invalid for ${mode} mode`);
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
  const backupDirectory =
    config.backupDirectory ??
    config.alpha3AgentCutover?.backupDirectory ??
    config.destructiveCutover?.backupDirectory ??
    resolve(dirname(config.databasePath), "backups");
  const migrationPlugins = createFirstPartyPluginRegistry({ host });
  const migrations = collectPluginMigrations(migrationPlugins, config.profile);
  let migrationRun: MigrationRunDiagnostic | undefined;
  let database;
  try {
    if (config.migrationWorker && config.databasePath !== ":memory:") {
      if (config.migrationWorker.runtimeKind !== config.runtimeKind)
        throw new Error("Migration Worker runtime must match Core Runtime");
      migrationRun = await runMigrationPlanInWorker({
        runtimeKind: config.migrationWorker.runtimeKind,
        executable: config.migrationWorker.executable,
        workerEntry: config.migrationWorker.entry,
        execArgv: config.migrationWorker.execArgv,
        databasePath: config.databasePath,
        backupDirectory,
        migrations,
      });
      database = openDatabase(config.databasePath);
    } else {
      database = openDatabase(config.databasePath);
      migrationRun = runMigrationPlan(database, migrations, {
        databasePath: config.databasePath,
        backupDirectory,
      });
    }
  } catch (error) {
    cutover?.fail(error);
    throw error;
  }
  const extensionPlatform = new ExtensionPlatform(database.uow, host);
  const plugins = createFirstPartyPluginRegistry({
    host,
    maintenance: database.maintenance(backupDirectory),
    extensionPlatform,
  });
  const order = validatePluginGraph(plugins, config.profile);
  const eventSchemas = new DomainEventSchemaRegistry(
    DOMAIN_EVENT_MANIFEST,
    DOMAIN_EVENT_PATTERNS,
  );
  database.uow.setEventValidator((event) => eventSchemas.validate(event));
  const events = new PersistentEventRuntime(database.uow, eventSchemas);
  let kernel: RunningKernel | undefined;
  const accessToken =
    config.accessToken ?? randomBytes(32).toString("base64url");
  const runtimeId = randomUUID();
  const runtimeGeneration = config.runtimeGeneration ?? 1;
  const startedAt = new Date().toISOString();
  let graphBuilder = new EffectiveGraphBuilder({
    profile: config.profile.name,
    bundles: config.profile.bundles,
    plugins: order.map((id) => ({
      id,
      version: plugins.get(id)!.descriptor.version,
      config: config.profile.plugins.find((entry) => entry.id === id)?.config,
    })),
    extensions: [],
    apiVersion: DRAMAIP_HTTP_API_VERSION,
    pluginApiVersion: DRAMAIP_PLUGIN_API_VERSION,
    mode,
    capabilities: {
      desktopHost: Boolean(host),
      fileGrant: Boolean(host),
      credentials: Boolean(host),
      localEngines: Boolean(host),
    },
  });
  let graphRevision = graphBuilder.revision;
  let development: RuntimeDevelopment | undefined;
  const kernelDiagnostics = () =>
    development?.kernelDiagnostics() ?? kernel?.diagnostics();
  const runtimeInfo = async (): Promise<RuntimeInfo> => {
    const engineKinds: readonly AgentEngineKind[] = [
      "pi",
      "codex",
      "langgraph",
    ];
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
      runtimeGeneration,
      graphRevision,
      startedAt,
      runtimeVersion: DRAMAIP_RUNTIME_VERSION,
      apiVersion: DRAMAIP_HTTP_API_VERSION,
      pluginApiVersion: DRAMAIP_PLUGIN_API_VERSION,
      runtimeKind,
      mode,
      profile: config.profile.name,
      bundles: [...config.profile.bundles],
      plugins: (
        kernelDiagnostics()?.plugins ??
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
      capabilityDescriptors: runtimeCapabilityDescriptors(Boolean(host)),
      engineStatus,
      uiContributions: [...(kernel?.ui.contributions() ?? [])],
    };
  };
  const http = createRuntimeHttp({
    accessToken,
    allowedOrigins: config.allowedOrigins ?? [],
    engineMcpTokens: config.engineMcpTokens,
    capabilityGrantResolve: (authorization) => {
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
      if (!token || token.length > 256) return undefined;
      try {
        const grant = database.sqlite
          .prepare(
            `SELECT id, run_id, expires_at, consumed_at, capabilities_json
             FROM agent_capability_grants
             WHERE id = ? LIMIT 1`,
          )
          .get(token) as
          | {
              id: string;
              run_id: string;
              expires_at: string;
              consumed_at: string | null;
              capabilities_json: string;
            }
          | undefined;
        if (
          !grant ||
          grant.consumed_at !== null ||
          Date.parse(grant.expires_at) <= Date.now()
        )
          return undefined;
        const parsed = JSON.parse(grant.capabilities_json) as unknown;
        if (
          !Array.isArray(parsed) ||
          !parsed.every(
            (capability) =>
              typeof capability === "string" && capability.length <= 100,
          )
        )
          return undefined;
        const activeRun = ["queued", "preparing", "running"].some((status) => {
          const assistant = database.sqlite
            .prepare(
              "SELECT 1 AS active FROM agent_assistant_runs WHERE id = ? AND status = ? LIMIT 1",
            )
            .get(grant.run_id, status);
          if (assistant) return true;
          try {
            return Boolean(
              database.sqlite
                .prepare(
                  "SELECT 1 AS active FROM agent_runs WHERE id = ? AND status = ? LIMIT 1",
                )
                .get(grant.run_id, status),
            );
          } catch {
            return false;
          }
        });
        if (!grant.run_id || !activeRun) return undefined;
        return {
          grantId: grant.id,
          runId: grant.run_id,
          expiresAt: grant.expires_at,
          capabilities: parsed,
        };
      } catch {
        // The grants table is installed by the agents migration. Before that
        // migration has completed no scoped grant can be valid.
        return undefined;
      }
    },
    engineMcpToolCall: async ({ runId, name, arguments: input }) => {
      const service = kernel?.service<KnowledgeWebResearchService>(
        KNOWLEDGE_WEB_RESEARCH_SERVICE,
      );
      if (!service)
        throw new Error("CAPABILITY_UNAVAILABLE: Web Research 服务未加载");
      if (name === "dramaip_web_search") {
        let sessionId = runId;
        try {
          const row = database.sqlite
            .prepare(
              "SELECT session_id FROM agent_assistant_runs WHERE id = ? LIMIT 1",
            )
            .get(runId) as { session_id?: string } | undefined;
          if (row?.session_id) sessionId = row.session_id;
        } catch {
          // Non-conversation runs use their run id for stable provider routing.
        }
        return service.search({
          ...(input as WebResearchSearchInput),
          sessionId,
        });
      }
      return service.read(input as { url: string; maxCharacters?: number });
    },
    extensionCapabilityHandler: (authorization, call, traceId) =>
      extensionPlatform.broker.handle(authorization, call, traceId),
    events,
    version: DRAMAIP_RUNTIME_VERSION,
    runtimeInfo,
    onDiagnostics: async () => {
      const engineKinds: readonly AgentEngineKind[] = [
        "pi",
        "codex",
        "langgraph",
      ];
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
        runtimeId,
        runtimeGeneration,
        graphRevision,
        graphBuild: { ...graphBuilder.diagnostics(), revision: graphRevision },
        hmr: development?.diagnostics() ?? { enabled: false },
        startedAt,
        profile: config.profile.name,
        plugins:
          kernelDiagnostics()?.plugins ??
          order.map((id) => ({ id, status: "active" })),
        migrations: listAppliedMigrations(database.sqlite),
        migrationRun,
        eventConsumers: events.diagnostics(),
        extensionGraph: extensionPlatform.diagnostics(),
        router: http.registry.diagnostics(),
        effects: kernelDiagnostics()?.effects ?? [],
        services: kernelDiagnostics()?.services ?? [],
        host: hostHealth,
        engines,
        bridgeRouteCount: 0,
      };
    },
  });
  if (config.development)
    development = new RuntimeDevelopment({
      base: fileURLToPath(new URL("../../../", import.meta.url)),
      configuration: profileConfiguration.get(config.profile),
      registry: http.registry,
      kernel: () => {
        if (!kernel)
          throw new Error("Runtime has not published its initial graph");
        return kernel;
      },
      publish: (moduleRevision) => {
        graphRevision = moduleRevision;
        kernel!.setGraphRevision(graphRevision);
      },
      restart: config.development.onRestart,
    });
  try {
    await graphBuilder.build<{ kernel?: RunningKernel }>({
      migrationPreflight: () => undefined,
      stage: () => ({}),
      activate: async (staged) => {
        staged.kernel = await bootKernel({
          graphRevision,
          profile: config.profile,
          plugins,
          context: {
            http: http.registry,
            domainEvents: events,
            uow: database.uow,
          },
          environment: {
            host,
            maintenance: database.maintenance(backupDirectory),
            extensionPlatform,
          },
          hmr: development
            ? {
                base: new URL("../../../", import.meta.url).href,
                root: ["plugins", "packages", "framework", "core-runtime.js"],
                run: (task, profile, unchanged) => {
                  const inputs = profile
                    ? profileConfiguration.get(profile)
                    : undefined;
                  if (profile && !inputs)
                    throw new Error(
                      "Accepted native configuration receipt is unavailable",
                    );
                  return development!.run(task, inputs, unchanged);
                },
                abortInitialization: (reason) =>
                  development!.abortInitialization(reason),
                rejectConfig: (reason) => development!.rejectConfig(reason),
                restart: (reason) => development!.restart(reason),
                recompose: () =>
                  loadProfile(
                    fileURLToPath(
                      new URL(
                        `../../../profiles/${config.profile.name}.json`,
                        import.meta.url,
                      ),
                    ),
                  ),
              }
            : undefined,
        });
      },
      validate: (staged) => {
        if (!staged.kernel) throw new Error("staged Kernel is unavailable");
        if (
          staged.kernel
            .diagnostics()
            .routeContributions?.some(
              (route) => !route.method || !route.path || !route.operationId,
            )
        )
          throw new Error("staged route contribution graph is invalid");
        if (
          staged.kernel.ui
            .contributions()
            .some(
              (contribution) =>
                !/^[a-f0-9]{64}$/u.test(contribution.metadataHash ?? ""),
            )
        )
          throw new Error("staged UI contribution graph is unsigned");
      },
      publish: (staged) => {
        http.registry.publish();
        kernel = staged.kernel;
      },
      dispose: async (staged) => {
        development?.abortInitialization(
          new Error("Initial Runtime graph was not published"),
        );
        await staged.kernel?.dispose();
      },
    });
    await development?.ready();
  } catch (error) {
    development?.abortInitialization(error);
    await kernel?.dispose();
    events.dispose();
    database.close();
    cutover?.fail(error);
    throw error;
  }
  let server: { close(): void } | undefined;
  return {
    accessToken,
    kernel: kernel!,
    profile: config.profile,
    get runtimeInfo() {
      // RuntimeInfo contains asynchronous Host engine probes, so callers obtain
      // the authoritative version through GET /api/v2/runtime.
      return {
        runtimeId,
        runtimeGeneration,
        graphRevision,
        startedAt,
        runtimeVersion: DRAMAIP_RUNTIME_VERSION,
        apiVersion: DRAMAIP_HTTP_API_VERSION,
        pluginApiVersion: DRAMAIP_PLUGIN_API_VERSION,
        runtimeKind,
        mode,
        profile: config.profile.name,
        bundles: [...config.profile.bundles],
        plugins: kernelDiagnostics()!.plugins.map((plugin) => ({
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
        capabilityDescriptors: runtimeCapabilityDescriptors(Boolean(host)),
        engineStatus: {},
        uiContributions: [...kernel!.ui.contributions()],
      };
    },
    fetch: http.fetch,
    async start(options) {
      if (server) throw new Error("Runtime server is already running");
      return new Promise((resolvePromise, reject) => {
        const nodeServer = serve(
          {
            fetch: http.fetch,
            hostname: options.hostname,
            port: options.port,
          },
          (address) => {
            nodeServer.off("error", onError);
            void extensionPlatform
              .restoreActive(
                `http://${options.hostname}:${address.port}/extensions/v1/capabilities`,
              )
              .finally(() =>
                resolvePromise({
                  hostname: options.hostname,
                  port: address.port,
                  close: () => nodeServer.close(),
                }),
              );
          },
        );
        const onError = (error: Error) => {
          nodeServer.close();
          server = undefined;
          reject(error);
        };
        nodeServer.once("error", onError);
        server = nodeServer;
      });
    },
    finalizeCutover() {
      cutover?.finalize();
    },
    async stop() {
      server?.close();
      await kernel!.dispose();
      events.dispose();
      database.close();
    },
  };
}

export function descriptorList(
  plugins: ReadonlyMap<string, FirstPartyPlugin>,
): readonly PluginDescriptor[] {
  return [...plugins.values()].map((plugin) => plugin.descriptor);
}
