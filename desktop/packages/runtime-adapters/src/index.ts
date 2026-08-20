import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import type { RuntimeKind } from "@dramaip/contracts";
import {
  ServerConnectionManager,
  type RuntimeConnection,
  type RuntimeDescriptor,
} from "@dramaip/server-connection";

export interface RuntimeAdapterStartOptions {
  readonly executable?: string;
  readonly runtimeEntry: string;
  readonly databasePath: string;
  readonly profile: string;
  readonly hostname: string;
  readonly port: number;
  readonly runtimeToken?: string;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  start(options: RuntimeAdapterStartOptions): Promise<RuntimeDescriptor>;
  attach(descriptor: RuntimeDescriptor): Promise<RuntimeConnection>;
  health(descriptor: RuntimeDescriptor): Promise<boolean>;
  stop(): Promise<void>;
}

abstract class ProcessRuntimeAdapter implements RuntimeAdapter {
  private child: ChildProcess | undefined;
  abstract readonly kind: RuntimeKind;
  protected abstract command(
    options: RuntimeAdapterStartOptions,
  ): readonly string[];

  async start(options: RuntimeAdapterStartOptions): Promise<RuntimeDescriptor> {
    if (this.child) throw new Error(`${this.kind} Runtime is already running`);
    const token = options.runtimeToken ?? randomBytes(32).toString("base64url");
    const args = this.command({ ...options, runtimeToken: token });
    const [executable, ...argv] = args;
    if (!executable) throw new Error("Runtime executable is missing");
    this.child = spawn(executable, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DRAMAIP_RUNTIME_TOKEN: token,
        DRAMAIP_RUNTIME_KIND: this.kind,
      },
    });
    const descriptor: RuntimeDescriptor = {
      baseUrl: `http://${options.hostname}:${options.port}`,
      accessToken: token,
      source: "spawned",
    };
    try {
      const manager = new ServerConnectionManager();
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          await manager.discover(descriptor.baseUrl);
          return descriptor;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      throw new Error(`${this.kind} Runtime did not become healthy`);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  attach(descriptor: RuntimeDescriptor): Promise<RuntimeConnection> {
    return new ServerConnectionManager().attach(descriptor);
  }

  async health(descriptor: RuntimeDescriptor): Promise<boolean> {
    try {
      await new ServerConnectionManager().discover(descriptor.baseUrl);
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}

export class NodeRuntimeAdapter extends ProcessRuntimeAdapter {
  readonly kind = "node" as const;
  protected command(options: RuntimeAdapterStartOptions): readonly string[] {
    return [
      options.executable ?? process.execPath,
      "--import",
      "tsx",
      options.runtimeEntry,
      "serve",
      "--database",
      options.databasePath,
      "--profile",
      options.profile,
      "--host",
      options.hostname,
      "--port",
      String(options.port),
      "--runtime",
      "node",
    ];
  }
}

export class BunRuntimeAdapter extends ProcessRuntimeAdapter {
  readonly kind = "bun" as const;
  protected command(options: RuntimeAdapterStartOptions): readonly string[] {
    return [
      options.executable ?? "bun",
      options.runtimeEntry,
      "serve",
      "--database",
      options.databasePath,
      "--profile",
      options.profile,
      "--host",
      options.hostname,
      "--port",
      String(options.port),
      "--runtime",
      "bun",
    ];
  }
}

export function runtimeAdapter(kind: RuntimeKind): RuntimeAdapter {
  return kind === "bun" ? new BunRuntimeAdapter() : new NodeRuntimeAdapter();
}
