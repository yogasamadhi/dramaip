import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { utilityProcess, type UtilityProcess } from "electron";
import {
  sha256,
  verifyExtensionPackage,
  type VerifiedExtensionPackage,
} from "@dramaip/extension-host";
import type {
  HostExtensionActivationRequest,
  HostExtensionInvocationRequest,
  HostExtensionPackageDescriptor,
} from "@dramaip/desktop-host";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ManagedExtensionProcess {
  pluginId: string;
  revision: string;
  packageRef: string;
  generation: number;
  child: UtilityProcess;
  state: "active" | "degraded" | "quarantined" | "starting";
  crashes: number[];
  pending: Map<string, PendingRequest>;
  lastError?: string;
}

function packageHash(packageRef: string): string {
  const match = /^extpkg:([a-f0-9]{64})$/u.exec(packageRef);
  if (!match) throw new Error("Invalid extension package reference");
  return match[1]!;
}

export class ExtensionProcessSupervisor {
  private readonly processes = new Map<string, ManagedExtensionProcess>();
  private readonly crashHistory = new Map<string, number[]>();
  private readonly quarantined = new Set<string>();
  private generation = 0;

  constructor(
    private readonly processEntry: string,
    private readonly packageRoot: string,
  ) {}

  async stage(
    archive: Uint8Array,
    publisherPublicKey: string,
  ): Promise<HostExtensionPackageDescriptor> {
    const verified = verifyExtensionPackage(archive, publisherPublicKey);
    const hash = sha256(archive);
    await mkdir(this.packageRoot, { recursive: true, mode: 0o700 });
    const target = join(this.packageRoot, `${hash}.dramaip-extension`);
    if (!existsSync(target)) await writeFile(target, archive, { mode: 0o600 });
    return {
      packageRef: `extpkg:${hash}`,
      contentHash: verified.contentHash,
      manifest: verified.manifest as unknown as Record<string, unknown>,
    };
  }

  async activate(input: HostExtensionActivationRequest): Promise<void> {
    if (this.quarantined.has(input.pluginId))
      throw new Error("Extension revision is quarantined");
    const previous = this.processes.get(input.pluginId);
    const verified = await this.readPackage(
      input.packageRef,
      input.publisherPublicKey,
    );
    if (verified.manifest.id !== input.pluginId)
      throw new Error("Extension package identity mismatch");
    const generation = ++this.generation;
    const child = utilityProcess.fork(this.processEntry, [], {
      serviceName: `DramaIP Extension ${input.pluginId}`,
      stdio: "pipe",
    });
    const managed: ManagedExtensionProcess = {
      pluginId: input.pluginId,
      revision: verified.contentHash,
      packageRef: input.packageRef,
      generation,
      child,
      state: "starting",
      crashes: this.history(input.pluginId),
      pending: new Map(),
    };
    await new Promise<void>((resolve, reject) => {
      let readySettled = false;
      const failReady = (error: Error): void => {
        if (readySettled) return;
        readySettled = true;
        clearTimeout(timeout);
        this.recordCrash(managed, error.message);
        if (child.pid) child.kill();
        reject(error);
      };
      const timeout = setTimeout(() => {
        failReady(new Error("Extension Host did not become ready"));
      }, 20_000);
      timeout.unref?.();
      child.on("message", (message) => {
        const value = message as Record<string, unknown>;
        if (value.generation !== generation) return;
        if (value.type === "ready") {
          if (readySettled) return;
          readySettled = true;
          clearTimeout(timeout);
          managed.state = "active";
          this.processes.set(input.pluginId, managed);
          if (previous)
            this.stopManaged(previous, "Extension revision replaced");
          resolve();
          return;
        }
        if (value.type === "error") {
          clearTimeout(timeout);
          managed.lastError = String(value.error ?? "Extension Host failed");
          failReady(new Error(managed.lastError));
          return;
        }
        if (value.type === "response" && typeof value.requestId === "string") {
          const pending = managed.pending.get(value.requestId);
          if (!pending) return;
          managed.pending.delete(value.requestId);
          clearTimeout(pending.timeout);
          if (value.error) pending.reject(new Error(String(value.error)));
          else pending.resolve(value.result);
        }
      });
      child.once("exit", () => {
        if (!readySettled)
          failReady(new Error("Extension Host exited before ready"));
        else this.exited(managed);
      });
      child.postMessage({
        type: "start",
        generation,
        pluginId: input.pluginId,
        revision: verified.contentHash,
        bundle: verified.bundle,
        capabilityEndpoint: input.capabilityEndpoint,
        capabilityToken: input.capabilityToken,
        limits: {
          memoryBytes: verified.manifest.resources.memoryMiB * 1024 * 1024,
          maximumConcurrentRequests:
            verified.manifest.resources.maxConcurrentRequests,
          requestsPerMinute: verified.manifest.resources.requestsPerMinute,
        },
      });
    });
  }

  invoke(input: HostExtensionInvocationRequest): Promise<unknown> {
    const managed = this.processes.get(input.pluginId);
    if (!managed || managed.state !== "active")
      return Promise.reject(new Error("Extension is not active"));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        managed.pending.delete(requestId);
        reject(new Error("Extension invocation timed out"));
      }, 30_000);
      timeout.unref?.();
      managed.pending.set(requestId, { resolve, reject, timeout });
      managed.child.postMessage({
        type: "invoke",
        generation: managed.generation,
        requestId,
        handlerId: input.handlerId,
        payload: input.payload,
      });
    });
  }

  async stop(pluginId: string): Promise<void> {
    const managed = this.processes.get(pluginId);
    if (!managed) return;
    this.processes.delete(pluginId);
    this.stopManaged(managed, "Extension Host stopped");
  }

  private stopManaged(managed: ManagedExtensionProcess, reason: string): void {
    for (const pending of managed.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    managed.pending.clear();
    if (managed.child.pid) managed.child.kill();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.processes.keys()].map((id) => this.stop(id)));
  }

  resetQuarantine(pluginId: string): void {
    this.quarantined.delete(pluginId);
    this.crashHistory.delete(pluginId);
    const managed = this.processes.get(pluginId);
    if (managed?.state === "quarantined") managed.state = "degraded";
  }

  diagnostics(): readonly Record<string, unknown>[] {
    return [...this.processes.values()].map((managed) => ({
      pluginId: managed.pluginId,
      revision: managed.revision,
      generation: managed.generation,
      pid: managed.child.pid,
      state: managed.state,
      restartCount: managed.crashes.length,
      pendingRequestCount: managed.pending.size,
      ...(managed.lastError ? { lastError: managed.lastError } : {}),
    }));
  }

  private async readPackage(
    packageRef: string,
    publisherPublicKey: string,
  ): Promise<VerifiedExtensionPackage> {
    const hash = packageHash(packageRef);
    const archive = new Uint8Array(
      await readFile(join(this.packageRoot, `${hash}.dramaip-extension`)),
    );
    if (sha256(archive) !== hash)
      throw new Error("Staged extension package integrity mismatch");
    return verifyExtensionPackage(archive, publisherPublicKey);
  }

  private exited(managed: ManagedExtensionProcess): void {
    if (this.processes.get(managed.pluginId) !== managed) return;
    this.recordCrash(managed, "Extension Host exited unexpectedly");
  }

  private recordCrash(managed: ManagedExtensionProcess, error: string): void {
    const now = Date.now();
    managed.crashes.push(now);
    while (managed.crashes.length > 0 && managed.crashes[0]! < now - 5 * 60_000)
      managed.crashes.shift();
    if (managed.crashes.length >= 5) this.quarantined.add(managed.pluginId);
    managed.state = this.quarantined.has(managed.pluginId)
      ? "quarantined"
      : "degraded";
    managed.lastError = error;
    for (const pending of managed.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(managed.lastError));
    }
    managed.pending.clear();
  }

  private history(pluginId: string): number[] {
    const existing = this.crashHistory.get(pluginId);
    if (existing) return existing;
    const created: number[] = [];
    this.crashHistory.set(pluginId, created);
    return created;
  }
}
