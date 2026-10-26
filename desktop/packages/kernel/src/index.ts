import {
  Context,
  Service,
  type EffectMeta,
  type Plugin,
} from "@deepseek-ai/cordis";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import Include, { type PatchOptions } from "@deepseek-ai/cordis-plugin-include";
import Group from "@deepseek-ai/cordis-plugin-group";
import Timer from "@deepseek-ai/cordis-plugin-timer";
import ConsoleExporter from "@deepseek-ai/cordis-plugin-logger-console";
import Hmr from "@deepseek-ai/cordis-plugin-hmr";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serviceContracts } from "@dramaip/plugin-api/internal";
import { createHash } from "node:crypto";
import type { ServiceContract } from "@dramaip/contracts";
import { watchConfigFile } from "./config-watch.js";
import type {
  Cleanup,
  FirstPartyPlugin,
  KernelDiagnostics,
  PluginContext,
  PluginProfile,
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
  private published?: readonly ReturnType<
    UiRegistry["contributions"]
  >[number][];
  stage(): void {
    this.published = [...this.entries.values()];
  }
  publish(): void {
    this.published = undefined;
  }
  candidateContributions() {
    return [...this.entries.values()];
  }
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
    return this.published ?? [...this.entries.values()];
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

export interface KernelOptions {
  graphRevision: string;
  profile: PluginProfile;
  plugins: ReadonlyMap<string, FirstPartyPlugin>;
  context: Pick<PluginContext, "http" | "domainEvents" | "uow">;
  environment?: Record<string, unknown>;
  capabilities?: ReadonlyMap<string, unknown>;
  hmr?: {
    base: string;
    root: string[];
    run(
      task: () => Promise<boolean>,
      profile?: PluginProfile,
      unchanged?: () => boolean,
    ): Promise<void>;
    abortInitialization?(reason: unknown): void;
    recompose?(): PluginProfile;
    rejectConfig?(reason: Error): Promise<void>;
    restart(reason: Error): void;
  };
}

export interface RunningKernel {
  readonly pluginOrder: readonly string[];
  readonly ui: ContributionRegistry;
  readonly context: Context;
  service<T>(contract: ServiceContract<T>): T | undefined;
  diagnostics(): KernelDiagnostics;
  /** Internal identity of configuration actually applied by the native Loader. */
  configurationFingerprint(): string;
  settle(): Promise<void>;
  setGraphRevision(revision: string): void;
  dispose(): Promise<void>;
}

class RuntimeEnvironment extends Service {
  constructor(ctx: Context, values: Record<string, unknown>) {
    super(ctx, "pluginEnvironment");
    Object.assign(this, values);
  }
}

/** Cordis owns every plugin fiber and resource. This layer validates product contracts. */
export async function bootKernel(
  options: KernelOptions,
): Promise<RunningKernel> {
  const order = validatePluginGraph(options.plugins, options.profile);
  let graphRevision = options.graphRevision;
  let appliedConfiguration = JSON.stringify(
    options.profile.assembly?.patches ?? options.profile.plugins,
  );
  const ctx = new Context();
  const ui = new ContributionRegistry();
  const effectTimes = new WeakMap<EffectMeta, string>();
  const directory = await mkdtemp(join(tmpdir(), "dramaip-plugin-graph-"));
  const effects = (): KernelDiagnostics["effects"] => {
    const entries: KernelDiagnostics["effects"][number][] = [];
    const visit = (meta: EffectMeta, owner: string) => {
      if (!effectTimes.has(meta))
        effectTimes.set(meta, new Date().toISOString());
      const acquiredAt = effectTimes.get(meta)!;
      if (meta.label.startsWith("plugin:")) owner = meta.label.slice(7);
      if (options.plugins.has(owner))
        entries.push({
          owner,
          label: meta.label,
          pluginVersion: options.plugins.get(owner)!.descriptor.version,
          graphRevision,
          acquiredAt,
        });
      for (const child of meta.children) visit(child, owner);
    };
    for (const runtime of ctx.registry.values())
      for (const fiber of runtime.fibers) {
        for (const meta of fiber.getEffects()) visit(meta, runtime.name ?? "");
      }
    return entries;
  };
  const diagnostics = (): KernelDiagnostics => ({
    profile: options.profile.name,
    plugins: order.map((id) => ({
      id,
      status: ctx.get(`dramaip.plugin.${id}`) ? "active" : "failed",
    })),
    routes: options.context.http.routeIds,
    routeContributions: options.context.http.routeDetails,
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
  const settle = async () => {
    await ctx.loader.await();
    // Child capabilities created with ctx.plugin() have no Loader entry.
    // Join their native lifecycle too; an entry being ACTIVE alone is insufficient.
    for (;;) {
      const fibers = [...ctx.registry.values()].flatMap((runtime) => [
        ...runtime.fibers,
      ]);
      await Promise.all(fibers.map((fiber) => fiber.await()));
      if (
        ![...ctx.registry.values()].some((runtime) =>
          [...runtime.fibers].some((fiber) => fiber.inertia),
        )
      )
        break;
    }
    for (const entry of ctx.loader.entries()) {
      if (entry.disabled) continue;
      // Cordis exports FiberState as a const enum; ACTIVE is 2 in the locked source.
      if (!entry.fiber || entry.fiber.state !== 2) {
        const missing = entry.fiber
          ? Object.keys(entry.fiber.inject).filter(
              (id) => entry.fiber!.ctx.get(id) === undefined,
            )
          : [];
        throw new Error(
          `Plugin ${entry.options.id} is not active; missing services: ${missing.join(", ")}`,
        );
      }
    }
    for (const runtime of ctx.registry.values())
      for (const fiber of runtime.fibers) {
        if (fiber.state === 4) continue; // Disposed fibers cannot contribute to the graph.
        if (fiber.state !== 2) {
          const missing = Object.keys(fiber.inject).filter(
            (id) => fiber.ctx.get(id) === undefined,
          );
          throw new Error(
            `Plugin fiber ${runtime.name ?? fiber.uid} is not active; missing services: ${missing.join(", ")}`,
          );
        }
      }
    for (const id of order)
      if (!ctx.get(`dramaip.plugin.${id}`))
        throw new Error(`Plugin ${id} failed to activate`);
  };
  try {
    for (const [name, value] of Object.entries({
      ...options.context,
      ui,
      diagnostics,
      profile: options.profile.name,
      graphRevision: options.graphRevision,
    }))
      ctx.provide(name, value);
    ctx.provide("serviceContractMetadata", new Map());
    ctx.provide("validatePluginMetadata", (actual: FirstPartyPlugin) => {
      const expected = options.plugins.get(actual.descriptor.id);
      for (const key of ["descriptor", "migrations", "ui"] as const) {
        if (
          canonicalJson(actual[key] ?? []) !==
          canonicalJson(expected?.[key] ?? [])
        )
          throw new Error(
            `Plugin ${actual.descriptor.id} ${key} changed; full Runtime restart and migration preflight required`,
          );
      }
    });
    ctx.provide("capability", (name: string) =>
      options.capabilities?.get(name),
    );
    await ctx.plugin(RuntimeEnvironment, options.environment ?? {});
    await ctx.plugin(Loader);
    // DSH resolves plugin modules through Node's internal module job when it
    // is reachable. That path bypasses the active module pipeline, so a
    // TypeScript plugin source could never be imported from the source tree.
    // Without HMR the standard import path is used instead, which keeps the
    // Runtime loadable from source and from the built artifact alike.
    if (!options.hmr)
      (ctx.loader as { internal?: unknown }).internal = undefined;
    if (options.hmr) await ctx.plugin(ConsoleExporter).await();
    Object.assign(ctx.loader.builtins, {
      include: Include,
      group: Group,
      timer: Timer,
      hmr: Hmr,
    });
    const entries = options.profile.plugins.map(({ id, config }) => {
      const plugin = options.plugins.get(id)!;
      if (!plugin.entry) ctx.loader.builtins[id] = plugin as Plugin;
      return { id, name: plugin.entry ?? `cordis:${id}`, config: config ?? {} };
    });
    // Resolve trusted package names without changing Include's patch semantics.
    // A first-party plugin without its own entry is served from the
    // authoritative registry builtin, exactly like the non-assembly path.
    const resolveNames = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(resolveNames);
      if (!value || typeof value !== "object") return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          key === "name" &&
          typeof entry === "string" &&
          entry.startsWith("@dramaip/")
            ? (() => {
                const id = entry.slice(9);
                const plugin = options.plugins.get(id);
                return plugin?.entry ?? (plugin ? `cordis:${id}` : entry);
              })()
            : resolveNames(entry),
        ]),
      );
    };
    let includeId: string;
    if (options.profile.assembly) {
      includeId = await ctx.loader.create({
        name: "cordis:include",
        config: {
          path: options.profile.assembly.root,
          patches: resolveNames(
            options.profile.assembly.patches,
          ) as PatchOptions[],
        },
      });
    } else {
      const path = join(directory, "cordis.json");
      await writeFile(path, JSON.stringify(entries));
      includeId = await ctx.loader.create({
        name: "cordis:include",
        config: { path: pathToFileURL(path).href },
      });
    }
    await settle();
    if (options.hmr) {
      const development = options.hmr;
      if (!ctx.loader.internal)
        throw new Error("Cordis HMR requires Node --expose-internals");
      ctx.loader.exit = () =>
        development.restart(
          new Error("Runtime framework or public metadata changed"),
        );
      await ctx.loader.create({ name: "cordis:timer" });
      await ctx.loader.create({
        name: "cordis:hmr",
        config: { base: development.base, root: development.root },
      });
      await ctx.loader.await();
      // DSH does not expose an async before-reload hook. Interpose this pinned
      // instance method to drain business requests BEFORE native disposal.
      // The implementation and module/config recovery remain entirely DSH's.
      const hmr = ctx.hmr as unknown as {
        partialReload(): Promise<void>;
        externals: Set<string>;
      };
      // Contract submodules used only by plugins must still remain shared and
      // require a full restart; DSH's CLI dependency tree alone cannot see them.
      for (const url of ctx.loader.internal.loadCache.keys()) {
        if (
          ["packages/", "framework/"].some((path) =>
            url.startsWith(new URL(path, development.base).href),
          )
        )
          hmr.externals.add(url);
      }
      const partialReload = hmr.partialReload.bind(hmr);
      let reloads = 0;
      ctx.on("hmr/reload", (changed) => {
        if (changed.size) reloads++;
      });
      hmr.partialReload = () =>
        development.run(async () => {
          const before = reloads;
          await partialReload();
          return before !== reloads;
        });
      ctx.effect(
        () => () => {
          hmr.partialReload = partialReload;
        },
        "hmr-batch-coordination",
      );
      const include = ctx.loader.resolve(includeId);
      let lastConfig = appliedConfiguration;
      const reportConfig = (filename: string, error: Error) => {
        ctx.logger.warn("config reload at %C failed", filename);
        ctx.logger.warn(error);
      };
      for (const filename of options.profile.assembly?.files ?? []) {
        await ctx.effect(
          async () =>
            watchConfigFile(
              resolve(fileURLToPath(development.base), filename),
              async () => {
                let profile: PluginProfile | undefined;
                try {
                  profile = development.recompose?.();
                } catch (reason) {
                  const error =
                    reason instanceof Error
                      ? reason
                      : new Error(String(reason));
                  await development.rejectConfig?.(error);
                  // Config callbacks are serialized. A complete later edit
                  // may already exist after this older rejection waits on the
                  // business queue. Revalidate current bytes once; never restore
                  // files or retry a business write/model operation here.
                  try {
                    profile = development.recompose?.();
                  } catch {
                    throw error;
                  }
                }
                if (!profile?.assembly) return;
                validatePluginGraph(options.plugins, profile);
                if (
                  JSON.stringify(profile.plugins.map((p) => p.id).sort()) !==
                  JSON.stringify([...order].sort())
                ) {
                  development.restart(
                    new Error(
                      "Profile membership changed; migration preflight requires a full restart",
                    ),
                  );
                  return;
                }
                const next = JSON.stringify(profile.assembly.patches);

                await development.run(
                  async () => {
                    if (next === lastConfig) return false;
                    await include.update({
                      config: {
                        path: profile.assembly!.root,
                        patches: resolveNames(profile.assembly!.patches),
                      },
                    });
                    lastConfig = next;
                    appliedConfiguration = next;
                    return true;
                  },
                  profile,
                  () => next === lastConfig,
                );
              },
              reportConfig,
            ),
          `hmr-config:${filename}`,
        );
      }
    }
  } catch (error) {
    options.hmr?.abortInitialization?.(error);
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  let disposed: Promise<void> | undefined;
  return {
    pluginOrder: order,
    ui,
    context: ctx,
    diagnostics,
    configurationFingerprint: () =>
      createHash("sha256")
        .update(canonicalJson(JSON.parse(appliedConfiguration)))
        .digest("hex"),
    settle,
    setGraphRevision: (revision) => {
      graphRevision = revision;
    },
    service: <T>(contract: ServiceContract<T>) =>
      ctx.get(contract.id) as T | undefined,
    dispose: () =>
      (disposed ??= (async () => {
        await ctx.fiber.dispose();
        await rm(directory, { recursive: true, force: true });
      })()),
  };
}
