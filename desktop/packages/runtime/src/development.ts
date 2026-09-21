import {
  saveRuntimeArtifact,
  restoreRuntimeArtifact,
} from "@dramaip/runtime-adapters/artifact-recovery";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
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
function revision(files: Map<string, Buffer>): string {
  const hash = createHash("sha256");
  for (const [path, data] of [...files].sort(([a], [b]) => a.localeCompare(b)))
    hash.update(path).update("\0").update(data);
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
  private queue: Promise<void> = Promise.resolve();
  private restarting = false;
  private batching = false;
  private baseline?: { routes: string; services: string[] };
  private reloadCount = 0;
  private lastError?: string;
  constructor(
    private readonly options: {
      base: string;
      registry: RuntimeRouteRegistry;
      kernel(): RunningKernel;
      publish(moduleRevision: string): void;
      restart(reason: Error): void;
    },
  ) {}

  async ready(): Promise<void> {
    this.lastGood = await snapshot(this.options.base);
    await saveRuntimeArtifact(this.options.base, this.lastGood);
    const diagnostics = this.options.kernel().diagnostics();
    this.publishedDiagnostics = diagnostics;
    this.baseline = {
      routes: routeMetadata(diagnostics),
      services: diagnostics.services
        .map((s) => `${s.id}:${s.owner}:${s.major}`)
        .sort(),
    };
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
  rejectConfig(reason: Error): Promise<void> {
    const restore = this.queue.then(async () => {
      if (this.restarting) return;
      this.lastError = reason.message;
      await restoreRuntimeArtifact(this.options.base);
    });
    this.queue = restore.catch(() => undefined);
    return restore;
  }

  run(task: () => Promise<boolean>): Promise<void> {
    const run = this.queue.then(async () => {
      if (this.restarting) return;
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
        if (!changed) await restoreRuntimeArtifact(this.options.base);
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
          const candidate = await snapshot(this.options.base);
          await saveRuntimeArtifact(this.options.base, candidate);
          this.options.publish(revision(candidate));
          this.lastGood = candidate;
          this.reloadCount++;
          this.lastError = undefined;
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
