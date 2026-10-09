import {
  saveRuntimeArtifact,
  restoreRuntimeArtifact,
  isRuntimeConfigurationPath,
} from "@dramaip/runtime-adapters/artifact-recovery";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve, isAbsolute } from "node:path";
import type { KernelDiagnostics } from "@dramaip/plugin-api/internal";
import type { RunningKernel } from "@dramaip/kernel";
import type { RuntimeRouteRegistry } from "@dramaip/http";

const roots = [
  "plugins",
  "packages",
  "framework",
  "profiles",
  "bundles",
  "cordis.yml",
  "core-runtime.js",
];
async function snapshot(base: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const visit = async (path: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      if ((error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
      files.set(relative(base, path), await readFile(path));
      return;
    }
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name.endsWith(".map") ||
        entry.name.endsWith(".d.ts") ||
        entry.isSymbolicLink()
      )
        continue;
      await visit(join(path, entry.name));
    }
  };
  for (const root of roots) await visit(join(base, root));
  return files;
}
function revision(
  files: Map<string, Buffer>,
  appliedConfiguration: string,
): string {
  const hash = createHash("sha256")
    .update("runtime-hmr-active-configuration-v1\0")
    .update(appliedConfiguration)
    .update("\0");
  for (const [path, data] of [...files].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const local = path.replaceAll("\\", "/");
    // A queued config callback may not have activated these disk bytes yet.
    // Keep them in the recovery artifact, but use the applied native config
    // identity for graph publication. Duplicate/restored bytes stay stable.
    if (
      local === "cordis.yml" ||
      local.startsWith("profiles/") ||
      local.startsWith("bundles/")
    )
      continue;
    hash.update(local).update("\0").update(data);
  }
  return hash.digest("hex");
}

function routeMetadata(diagnostics: KernelDiagnostics): string {
  return JSON.stringify(
    [...(diagnostics.routeContributions ?? diagnostics.routes)].sort((a, b) =>
      String(typeof a === "string" ? a : a.id).localeCompare(
        String(typeof b === "string" ? b : b.id),
      ),
    ),
  );
}

/** Serializes native DSH reloads with the business router and published graph. */
export class RuntimeDevelopment {
  private publishedDiagnostics?: KernelDiagnostics;
  private lastGood = new Map<string, Buffer>();
  private appliedConfiguration = new Map<string, Buffer>();
  private readonly initialized = Promise.withResolvers<void>();
  private queue: Promise<void> = Promise.resolve();
  private restarting = false;
  private batching = false;
  private baseline?: { routes: string; services: string[] };
  private reloadCount = 0;
  private lastError?: string;
  constructor(
    private readonly options: {
      base: string;
      configuration?: ReadonlyMap<string, Buffer>;
      registry: RuntimeRouteRegistry;
      kernel(): RunningKernel;
      publish(moduleRevision: string): void;
      restart(reason: Error): void;
    },
  ) {
    void this.initialized.promise.catch(() => undefined);
  }

  async ready(): Promise<void> {
    try {
      this.lastGood = await snapshot(this.options.base);
      this.appliedConfiguration = new Map(
        [...this.lastGood].filter(([path]) => isRuntimeConfigurationPath(path)),
      );
      this.appliedConfiguration = this.configuration(
        this.options.configuration,
      );
      this.withConfiguration(this.lastGood, this.appliedConfiguration);
      await saveRuntimeArtifact(this.options.base, this.lastGood);
      const diagnostics = this.options.kernel().diagnostics();
      this.publishedDiagnostics = diagnostics;
      this.baseline = {
        routes: routeMetadata(diagnostics),
        services: diagnostics.services
          .map((s) => `${s.id}:${s.owner}:${s.major}`)
          .sort(),
      };
      this.initialized.resolve();
      // Initial native watch callbacks can be queued before the initial graph
      // exists. Boot is ready only once their serialized publications finish.
      // A callback can enqueue another during completion, so join the actual
      // queue tail rather than a single earlier promise.
      for (;;) {
        const queue = this.queue;
        await queue;
        if (queue === this.queue) break;
      }
    } catch (error) {
      this.initialized.reject(error);
      throw error;
    }
  }
  kernelDiagnostics(): KernelDiagnostics | undefined {
    return this.batching || this.restarting
      ? this.publishedDiagnostics
      : undefined;
  }

  diagnostics() {
    return {
      enabled: true,
      reloadCount: this.reloadCount,
      restarting: this.restarting,
      lastError: this.lastError,
    };
  }
  restart(reason: Error): void {
    if (this.restarting) return;
    this.restarting = true;
    this.lastError = reason.message;
    this.options.restart(reason);
  }
  private configuration(
    inputs?: ReadonlyMap<string, Buffer>,
  ): Map<string, Buffer> {
    const files = new Map(this.appliedConfiguration);
    for (const [filename, bytes] of inputs ?? []) {
      const path = relative(resolve(this.options.base), resolve(filename));
      if (
        !path ||
        path.startsWith("..") ||
        isAbsolute(path) ||
        !isRuntimeConfigurationPath(path) ||
        !Buffer.isBuffer(bytes)
      )
        throw new Error(
          "Configuration receipt does not belong to this Runtime artifact",
        );
      files.set(path, Buffer.from(bytes));
    }
    return files;
  }

  abortInitialization(reason: unknown): void {
    // A failed initial graph must release native callbacks before their tracked
    // watcher disposers join them. No graph or business operation is retried.
    this.initialized.reject(reason);
  }

  private withConfiguration(
    files: Map<string, Buffer>,
    configuration: ReadonlyMap<string, Buffer>,
  ) {
    for (const path of files.keys())
      if (isRuntimeConfigurationPath(path) && !configuration.has(path))
        files.delete(path);
    for (const [path, bytes] of configuration)
      files.set(path, Buffer.from(bytes));
    return files;
  }

  private async acknowledgeConfiguration(
    configuration: Map<string, Buffer>,
  ): Promise<void> {
    const candidate = this.withConfiguration(
      new Map(this.lastGood),
      configuration,
    );
    await saveRuntimeArtifact(this.options.base, candidate);
    this.lastGood = candidate;
    this.appliedConfiguration = configuration;
    this.lastError = undefined;
  }

  rejectConfig(reason: Error): Promise<void> {
    const reject = this.queue.then(async () => {
      if (this.restarting) return;
      this.lastError = reason.message;
      // A parse failure is not authority to rewrite the editor's files. In
      // particular, this queued reason may describe earlier/truncated bytes.
      // Keep the previous active graph and its journal; a complete subsequent
      // native config callback validates and acknowledges its own exact inputs.
    });
    this.queue = reject.catch(() => undefined);
    return reject;
  }

  run(
    task: () => Promise<boolean>,
    inputs?: ReadonlyMap<string, Buffer>,
    unchanged?: () => boolean,
  ): Promise<void> {
    const run = this.queue.then(async () => {
      await this.initialized.promise;
      if (this.restarting) return;
      const configuration = inputs ? this.configuration(inputs) : undefined;
      if (configuration && unchanged?.()) {
        await this.acknowledgeConfiguration(configuration);
        return;
      }
      const kernel = this.options.kernel();
      this.publishedDiagnostics = kernel.diagnostics();
      this.batching = true;
      try {
        await this.options.registry.beginReload();
        kernel.ui.stage();
        const changed = await task();
        if (this.restarting) return;
        // DSH may keep the previous module in memory after import failure.
        // Restore disk too, so an unrelated successful reload cannot journal
        // a rejected module as part of the next successful snapshot.
        if (!changed && !configuration)
          await restoreRuntimeArtifact(this.options.base, {
            preserveConfiguration: true,
          });
        await kernel.settle();
        const diagnostic = kernel.diagnostics();
        if (routeMetadata(diagnostic) !== this.baseline?.routes)
          throw new Error(
            "Public route metadata changed; full Runtime restart required",
          );
        if (
          JSON.stringify(
            diagnostic.services
              .map((s) => `${s.id}:${s.owner}:${s.major}`)
              .sort(),
          ) !== JSON.stringify(this.baseline?.services)
        )
          throw new Error("Service graph is incomplete after reload");
        if (
          kernel.ui
            .candidateContributions()
            .some((item) => !/^[a-f0-9]{64}$/.test(item.metadataHash ?? ""))
        )
          throw new Error("Invalid UI contribution after reload");
        const commitRouter = this.options.registry.prepareReload();
        if (changed) {
          const candidate = this.withConfiguration(
            await snapshot(this.options.base),
            configuration ?? this.appliedConfiguration,
          );
          await saveRuntimeArtifact(this.options.base, candidate);
          this.options.publish(
            revision(candidate, kernel.configurationFingerprint()),
          );
          this.lastGood = candidate;
          if (configuration) this.appliedConfiguration = configuration;
          this.reloadCount++;
          this.lastError = undefined;
        }
        if (!changed && configuration) {
          await this.acknowledgeConfiguration(configuration);
        }
        // No await between publication of graph, UI, and router.
        this.publishedDiagnostics = kernel.diagnostics();
        kernel.ui.publish();
        commitRouter();
        this.batching = false;
      } catch (reason) {
        const error =
          reason instanceof Error ? reason : new Error(String(reason));
        this.lastError = error.message;
        // A failed async activation can strand native dependents. Rebuild from
        // the last successful code/config snapshot in a fresh supervised process.
        await restoreRuntimeArtifact(this.options.base);
        this.restart(error);
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
