/**
 * The Desktop Host child process (baseline §5.1): the `desktop` Profile run
 * under Electron's own Node, reached over Node IPC only. Main starts one, waits
 * for `ready`, serves the Host's shell-bridge calls, and reports a Host that
 * fails or exits on its own as fatal; it never infers failure from a timeout.
 */
import { fork, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BridgeEndpoint,
  isHostMessage,
  type HostBridgeActions,
  type HostReady,
  type ShellActions,
  type ShellMessage,
} from "@dramaip/host-shell-bridge/protocol";

const require = createRequire(import.meta.url);

/** Upper bound of the Host output kept for the crash report. */
const OUTPUT_TAIL_CHARS = 64 * 1024;

/** How long a Host may take to dispose its tree after `shutdown`. */
const SHUTDOWN_GRACE_MS = 20_000;

/** Why the Host stopped being usable. */
export interface HostFailure {
  readonly message: string;
  /** The Host's inspected error, or its output tail when it exited without one. */
  readonly diagnostic: string;
}

/** What one Host launch runs with. */
export interface HostLaunchOptions {
  /** Environment of the Host, merged over Main's own. */
  readonly env: Readonly<Record<string, string>>;
  /** Overlay patches for this launch (the safe overlay after a recovery choice). */
  readonly patches?: readonly string[];
  /**
   * The compiled Host entry of an installed runtime (desktop-runtime.json).
   * Without one, the Host runs the workspace sources through tsx.
   */
  readonly entry?: string;
}

/** The Host's entry and the loader flags it runs with. */
function hostEntry(installed?: string): { entry: string; execArgv: string[] } {
  // HMR's manifest cache needs internals in either layout.
  if (installed) return { entry: installed, execArgv: ["--expose-internals"] };
  const manifest =
    require.resolve("@dramaip/desktop-host-process/package.json");
  const hostRequire = createRequire(manifest);
  return {
    entry: join(dirname(manifest), "src", "index.ts"),
    // The Profile runner loads TypeScript workspace sources; HMR needs internals.
    execArgv: [
      "--expose-internals",
      "--import",
      pathToFileURL(hostRequire.resolve("tsx")).href,
    ],
  };
}

/** One running Desktop Host. */
export class DesktopHostProcess {
  /** Native actions the Host asks for, and what Main hands it. */
  readonly bridge: BridgeEndpoint<HostBridgeActions, ShellActions>;
  /** Settles once with the Host's launch URL and injections. */
  readonly ready: Promise<HostReady>;
  private readonly child: ChildProcess;
  private output = "";
  private stopping = false;
  private failed = false;
  private readonly failureListeners = new Set<(failure: HostFailure) => void>();
  private shutdownComplete: (() => void) | undefined;
  private readonly exited: Promise<void>;

  constructor(options: HostLaunchOptions) {
    const { entry, execArgv } = hostEntry(options.entry);
    const args = (options.patches ?? []).flatMap((patch) => ["--patch", patch]);
    this.child = fork(entry, args, {
      execPath: process.execPath,
      execArgv,
      cwd: dirname(entry),
      env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      serialization: "json",
    });
    const keep = (chunk: Buffer): void => {
      this.output = (this.output + chunk.toString("utf8")).slice(
        -OUTPUT_TAIL_CHARS,
      );
    };
    this.child.stdout?.on("data", (chunk: Buffer) => {
      keep(chunk);
      process.stdout.write(chunk);
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      keep(chunk);
      process.stderr.write(chunk);
    });
    this.bridge = new BridgeEndpoint(
      (message) =>
        new Promise((resolve, reject) => {
          if (!this.child.connected) {
            reject(new Error("shell bridge: the Desktop Host is not running"));
            return;
          }
          this.child.send(message, (error) => {
            if (error === null) resolve();
            else reject(error);
          });
        }),
    );
    let resolveReady!: (ready: HostReady) => void;
    let rejectReady!: (error: Error) => void;
    this.ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // A failure before ready reaches the caller through `ready` as well.
    this.ready.catch(() => undefined);
    this.child.on("message", (message: unknown) => {
      if (!isHostMessage(message)) return;
      switch (message.type) {
        case "ready":
          resolveReady(message);
          return;
        case "fatal":
          this.fail({
            message: message.message,
            diagnostic: message.diagnostic ?? this.output,
          });
          rejectReady(new Error(message.message));
          return;
        case "shutdown-complete":
          this.shutdownComplete?.();
          return;
        default:
          this.bridge.receive(message);
      }
    });
    this.exited = new Promise((resolve) => {
      this.child.once("exit", (code, signal) => {
        this.bridge.close(new Error("shell bridge: the Desktop Host exited"));
        if (!this.stopping) {
          const message = `Desktop Host exited (${signal ?? String(code)})`;
          this.fail({ message, diagnostic: this.output });
          rejectReady(new Error(message));
        }
        resolve();
      });
    });
    this.child.once("error", (error) => {
      this.fail({ message: error.message, diagnostic: this.output });
      rejectReady(error);
    });
  }

  /** Operating-system process id, for process assertions. */
  get pid(): number | undefined {
    return this.child.pid;
  }

  /**
   * Observe the Host failing; reported once per process.
   * @param listener - receives the failure.
   * @returns a disposer.
   */
  onFailure(listener: (failure: HostFailure) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  /**
   * Ask the Host to dispose its tree and wait for it to exit; kill it when it
   * does not within the grace period.
   */
  async shutdown(): Promise<void> {
    this.stopping = true;
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const complete = new Promise<void>((resolve) => {
      this.shutdownComplete = resolve;
    });
    if (this.child.connected)
      this.child.send({ type: "shutdown" } satisfies ShellMessage, () => {});
    else this.child.kill("SIGTERM");
    const grace = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), SHUTDOWN_GRACE_MS).unref(),
    );
    if (
      (await Promise.race([complete.then(() => this.exited), grace])) ===
      "timeout"
    )
      this.child.kill("SIGKILL");
    await this.exited;
  }

  /** Kill the Host outright (a crash for tests of the recovery path). */
  kill(): void {
    this.child.kill("SIGKILL");
  }

  private fail(failure: HostFailure): void {
    if (this.failed || this.stopping) return;
    this.failed = true;
    for (const listener of this.failureListeners) listener(failure);
  }
}
