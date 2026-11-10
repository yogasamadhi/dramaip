/**
 * Test-only composition of the `web` Profile's business layer (P2), in one
 * process: the relational backend, the compat runtime and the operation
 * registry, then the business plugins, as Cordis Loader entries in the order
 * `bundle-base` and the domain bundles give them. The Profile's transport
 * (web server, connection, Client) and the domain controllers are left out,
 * so every operation stays served and suites that substitute hosts and
 * services drive the registry directly; the CLI acceptance specs boot the
 * whole Profile.
 *
 * Deleted with the compat packages (P6).
 * @module @dramaip/test-web-composition
 */

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Context, type Plugin } from "@deepseek-ai/cordis";
import Include from "@deepseek-ai/cordis-plugin-include";
import Loader from "@deepseek-ai/cordis-plugin-loader";
import * as compatRuntime from "@dramaip/compat-runtime";
import type { ServiceContract } from "@dramaip/contracts";
import * as operations from "@dramaip/infra-operations";
import * as storageRelational from "@dramaip/infra-storage-relational";
import type {
  FirstPartyPlugin,
  KernelDiagnostics,
  PluginMigration,
} from "@dramaip/plugin-api/internal";
import type { ContributionRegistry } from "@dramaip/plugin-api/ui-registry";

/** Composition options. */
export interface WebCompositionOptions {
  /** Database file, or `:memory:`. */
  readonly databasePath: string;
  readonly backupDirectory?: string;
  /**
   * Business plugins, constructed with any substituted host, or manifests
   * whose `entry` names the plugin module.
   */
  readonly plugins: readonly FirstPartyPlugin[];
  /** Per-plugin entry config, by plugin id. */
  readonly config?: Readonly<Record<string, unknown>>;
  readonly profile?: compatRuntime.Config["profile"];
  readonly validateEvents?: boolean;
  /**
   * Narrow what each owner declares, to start from an older schema. A later
   * composition on the same file declares the full set and migrates it.
   */
  readonly migrations?: (
    owner: string,
    migrations: readonly PluginMigration[],
  ) => readonly PluginMigration[];
}

/** A running composition; the shape the Kernel-era suites drive. */
export interface WebComposition {
  readonly context: Context;
  /** The operation registry, and a dispatch to its served operations. */
  readonly http: {
    readonly registry: operations.OperationRegistry;
    fetch(request: Request): Promise<Response>;
  };
  readonly relationalStorage: storageRelational.RelationalStorage;
  readonly pluginOrder: readonly string[];
  readonly ui: ContributionRegistry;
  service<T>(contract: ServiceContract<T>): T | undefined;
  diagnostics(): KernelDiagnostics;
  /** Identity of the entry configuration the Loader applied. */
  configurationFingerprint(): string;
  /** Wait until every fiber settles; fails if one is not active. */
  settle(): Promise<void>;
  /** Development reloads publish a revision; the router reports its own. */
  setGraphRevision(revision: string): void;
  dispose(): Promise<void>;
}

// Cordis's FiberState is a const enum with no runtime object in its built package.
const FIBER_ACTIVE = 2;
const FIBER_DISPOSED = 4;

/**
 * Services of the launcher and transport this composition leaves out:
 * infra-operations waits on `appReady` to publish at startup.
 */
const OMITTED_SERVICES = new Set(["appReady", "webServer", "connection"]);

/**
 * Compose and settle the tree, then publish its routes once.
 * @param options - composition options.
 */
export async function bootWebComposition(
  options: WebCompositionOptions,
): Promise<WebComposition> {
  const ctx = new Context();
  const directory = await mkdtemp(join(tmpdir(), "dramaip-web-composition-"));
  const pluginOrder = options.plugins.map((plugin) => plugin.descriptor.id);
  const entries = [
    {
      id: storageRelational.name,
      name: `cordis:${storageRelational.name}`,
      config: {
        path: options.databasePath,
        ...(options.backupDirectory
          ? { backupDirectory: options.backupDirectory }
          : {}),
      },
    },
    {
      id: compatRuntime.name,
      name: `cordis:${compatRuntime.name}`,
      config: {
        profile: options.profile ?? "server",
        validateEvents: options.validateEvents ?? true,
      },
    },
    { id: operations.name, name: `cordis:${operations.name}`, config: {} },
    ...options.plugins.map(({ descriptor: { id }, entry }) => ({
      id,
      name: entry ?? `cordis:${id}`,
      config: options.config?.[id] ?? {},
    })),
  ];
  const settle = async (): Promise<void> => {
    await ctx.loader.await();
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
    for (const runtime of ctx.registry.values())
      for (const fiber of runtime.fibers) {
        if (fiber.state === FIBER_DISPOSED) continue;
        if (fiber.state !== FIBER_ACTIVE) {
          const missing = Object.keys(fiber.inject).filter(
            (id) => fiber.ctx.get(id) === undefined,
          );
          if (missing.every((id) => OMITTED_SERVICES.has(id))) continue;
          throw new Error(
            `Plugin fiber ${runtime.name ?? fiber.uid} is not active; missing services: ${missing.join(", ")}`,
          );
        }
      }
    for (const id of pluginOrder)
      if (!ctx.get(`dramaip.plugin.${id}`))
        throw new Error(
          `Plugin ${id} failed to activate; DEBUG ${JSON.stringify([...ctx.loader.entries()].map((e) => [e.options.id, e.options.name, e.fiber?.state, e.disabled]))} ${[...ctx.registry.values()].map((r) => `${r.name}:${[...r.fibers].map((f) => f.state)}`).join(" ")}`,
        );
  };
  try {
    await ctx.plugin(Loader);
    // Plugin modules load through the standard import path, which keeps their
    // TypeScript sources loadable under the test pipeline, as in the Kernel.
    (ctx.loader as { internal?: unknown }).internal = undefined;
    Object.assign(ctx.loader.builtins, {
      include: Include,
      [storageRelational.name]: storageRelational,
      [compatRuntime.name]: compatRuntime,
      [operations.name]: operations,
      ...Object.fromEntries(
        options.plugins
          .filter((plugin) => !plugin.entry)
          .map((plugin) => [plugin.descriptor.id, plugin as Plugin]),
      ),
    });
    const narrow = options.migrations;
    if (narrow)
      ctx.on("internal/service", (name) => {
        if (name !== "relationalStorage") return;
        const storage = ctx.get("relationalStorage");
        if (!storage) return;
        const declare = storage.declare.bind(storage);
        storage.declare = (owner, migrations) =>
          declare(owner, narrow(owner, migrations));
      });
    const path = join(directory, "cordis.json");
    await writeFile(path, JSON.stringify(entries));
    await ctx.loader.create({
      name: "cordis:include",
      config: { path: pathToFileURL(path).href },
    });
    await settle();
  } catch (error) {
    await ctx.fiber.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const registry = ctx.operations;
  registry.publish();
  const http = {
    registry,
    fetch: (request: Request) => registry.fetch(request),
  };
  // Held past disposal, so a suite can assert every effect was released.
  const diagnostics = ctx.diagnostics;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");
  let disposed: Promise<void> | undefined;
  return {
    context: ctx,
    http,
    relationalStorage: ctx.relationalStorage,
    pluginOrder,
    ui: ctx.compatRuntime.ui,
    service: <T>(contract: ServiceContract<T>) =>
      ctx.get(contract.id) as T | undefined,
    diagnostics: () => diagnostics(),
    configurationFingerprint: () => fingerprint,
    settle,
    setGraphRevision: () => undefined,
    dispose: () =>
      (disposed ??= (async () => {
        await ctx.fiber.dispose();
        await rm(directory, { recursive: true, force: true });
      })()),
  };
}
