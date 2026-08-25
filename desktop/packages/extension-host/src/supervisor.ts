import {
  QuickJsExtensionSandbox,
  type ExtensionCapabilityBridge,
  type ExtensionSandboxLimits,
} from "./sandbox.js";
import type { VerifiedExtensionPackage } from "./package.js";

export type ExtensionLifecycleState =
  "disabled" | "starting" | "active" | "degraded" | "quarantined" | "stopped";

export interface ExtensionSupervisorDiagnostic {
  readonly pluginId: string;
  readonly revision: string;
  readonly state: ExtensionLifecycleState;
  readonly restartCount: number;
  readonly lastError?: string;
  readonly sandbox?: ReturnType<QuickJsExtensionSandbox["diagnostics"]>;
}

export class ExtensionRevisionSupervisor {
  private state: ExtensionLifecycleState = "disabled";
  private sandbox: QuickJsExtensionSandbox | undefined;
  private readonly crashes: number[] = [];
  private lastError: string | undefined;

  constructor(
    readonly extensionPackage: VerifiedExtensionPackage,
    private readonly bridge: ExtensionCapabilityBridge,
    private readonly limitOverrides: ExtensionSandboxLimits = {},
  ) {}

  async start(): Promise<void> {
    if (this.quarantineIfBudgetExceeded() || this.state === "quarantined")
      throw new Error("Extension revision is quarantined");
    this.state = "starting";
    try {
      this.sandbox = await QuickJsExtensionSandbox.create({
        bundle: this.extensionPackage.bundle,
        bridge: this.bridge,
        limits: {
          memoryBytes:
            this.extensionPackage.manifest.resources.memoryMiB * 1024 * 1024,
          maximumConcurrentRequests:
            this.extensionPackage.manifest.resources.maxConcurrentRequests,
          requestsPerMinute:
            this.extensionPackage.manifest.resources.requestsPerMinute,
          ...this.limitOverrides,
        },
      });
      this.state = "active";
      this.lastError = undefined;
    } catch (error) {
      this.recordCrash(error);
      throw error;
    }
  }

  async invoke(handlerId: string, payload: unknown): Promise<unknown> {
    if (this.quarantineIfBudgetExceeded())
      throw new Error("Extension revision is quarantined");
    if (!this.sandbox || this.state !== "active")
      throw new Error(`Extension is not active: ${this.state}`);
    try {
      return await this.sandbox.invoke(handlerId, payload);
    } catch (error) {
      if (this.sandbox.diagnostics().state !== "active")
        this.recordCrash(error);
      throw error;
    }
  }

  stop(): void {
    this.sandbox?.dispose();
    this.sandbox = undefined;
    if (this.state !== "quarantined") this.state = "stopped";
  }

  retry(): void {
    this.stop();
    this.crashes.length = 0;
    this.lastError = undefined;
    this.state = "disabled";
  }

  diagnostics(): ExtensionSupervisorDiagnostic {
    this.quarantineIfBudgetExceeded();
    return {
      pluginId: this.extensionPackage.manifest.id,
      revision: this.extensionPackage.contentHash,
      state: this.state,
      restartCount: this.crashes.length,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.sandbox ? { sandbox: this.sandbox.diagnostics() } : {}),
    };
  }

  private recordCrash(error: unknown): void {
    const now = Date.now();
    this.crashes.push(now);
    this.lastError = error instanceof Error ? error.message : String(error);
    this.sandbox?.dispose();
    this.sandbox = undefined;
    this.state = this.quarantineIfBudgetExceeded(now)
      ? "quarantined"
      : "degraded";
  }

  private quarantineIfBudgetExceeded(now = Date.now()): boolean {
    const cutoff = now - 5 * 60_000;
    while (this.crashes[0] !== undefined && this.crashes[0] < cutoff)
      this.crashes.shift();
    if (this.crashes.length < 5) return false;
    this.sandbox?.dispose();
    this.sandbox = undefined;
    this.state = "quarantined";
    return true;
  }
}
