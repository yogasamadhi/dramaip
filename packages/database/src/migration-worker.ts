import { fork } from "node:child_process";
import type { RuntimeKind } from "@dramaip/contracts";
import type { PluginMigration } from "@dramaip/plugin-api/internal";
import type { MigrationRunDiagnostic } from "./index.js";

export interface MigrationWorkerRequest {
  type: "run";
  runtimeKind: RuntimeKind;
  databasePath: string;
  backupDirectory: string;
  migrations: readonly PluginMigration[];
  dryRun: boolean;
  migrationTimeoutMs: number;
  totalTimeoutMs: number;
}

export interface MigrationWorkerIntegrityRequest {
  type: "integrity";
  runtimeKind: RuntimeKind;
  databasePath: string;
}

export type MigrationWorkerMessage =
  | {
      type: "progress";
      phase: "dry-run" | "apply";
      status: "started" | "completed";
      migrationId: string;
    }
  | { type: "completed"; diagnostic: MigrationRunDiagnostic }
  | { type: "integrity"; result: string }
  | { type: "failed"; error: string };

interface MigrationWorkerProcess {
  readonly stderr: readonly string[];
  readonly exitCode: number | null;
  send(message: MigrationWorkerRequest | MigrationWorkerIntegrityRequest): void;
  kill(signal?: NodeJS.Signals): void;
  onMessage(listener: (value: unknown) => void): void;
  onceError(listener: (error: Error) => void): void;
  onceExit(
    listener: (code: number | null, signal: string | number | null) => void,
  ): void;
}

function electronNodeWorker(
  executable: string,
  entry: string,
  execArgv: readonly string[],
  environment: NodeJS.ProcessEnv,
): MigrationWorkerProcess {
  const child = fork(entry, [], {
    execPath: executable,
    execArgv: [...execArgv],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: environment,
  });
  const stderr: string[] = [];
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => stderr.push(chunk));
  return {
    stderr,
    get exitCode() {
      return child.exitCode;
    },
    send: (message) => child.send(message),
    kill: (signal) => child.kill(signal),
    onMessage: (listener) => child.on("message", listener),
    onceError: (listener) => child.once("error", listener),
    onceExit: (listener) => child.once("exit", listener),
  };
}

function worker(
  executable: string,
  entry: string,
  request: MigrationWorkerRequest | MigrationWorkerIntegrityRequest,
  execArgv: readonly string[] = [],
): MigrationWorkerProcess {
  const environment = migrationWorkerEnvironment(request.runtimeKind);
  const child = electronNodeWorker(executable, entry, execArgv, environment);
  child.send(request);
  return child;
}

export function migrationWorkerEnvironment(
  runtimeKind: RuntimeKind,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  if (runtimeKind === "electron-node") environment.ELECTRON_RUN_AS_NODE = "1";
  else delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function stderrText(chunks: readonly string[]): string {
  const value = chunks.join("").trim();
  return value ? `: ${value.slice(-2_000)}` : "";
}

async function integrityInWorker(input: {
  runtimeKind: RuntimeKind;
  executable: string;
  workerEntry: string;
  databasePath: string;
  execArgv?: readonly string[];
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = worker(
      input.executable,
      input.workerEntry,
      {
        type: "integrity",
        runtimeKind: input.runtimeKind,
        databasePath: input.databasePath,
      },
      input.execArgv,
    );
    let settled = false;
    const finish = (result: { value: string } | { error: Error }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      if ("value" in result) resolve(result.value);
      else reject(result.error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ error: new Error("post-migration integrity worker timed out") });
    }, 30_000);
    child.onMessage((value) => {
      const message = value as MigrationWorkerMessage;
      if (message.type === "integrity") finish({ value: message.result });
      if (message.type === "failed")
        finish({ error: new Error(message.error) });
    });
    child.onceError((error) => finish({ error }));
    child.onceExit((code, signal) => {
      if (!settled)
        finish({
          error: new Error(
            `integrity worker exited before reporting (${code ?? signal})${stderrText(child.stderr)}`,
          ),
        });
    });
  });
}

export async function runMigrationPlanInWorker(input: {
  runtimeKind: RuntimeKind;
  executable: string;
  workerEntry: string;
  databasePath: string;
  backupDirectory: string;
  migrations: readonly PluginMigration[];
  execArgv?: readonly string[];
  dryRun?: boolean;
  migrationTimeoutMs?: number;
  totalTimeoutMs?: number;
}): Promise<MigrationRunDiagnostic> {
  const migrationTimeoutMs = input.migrationTimeoutMs ?? 60_000;
  const totalTimeoutMs = input.totalTimeoutMs ?? 10 * 60_000;
  return new Promise((resolve, reject) => {
    const child = worker(
      input.executable,
      input.workerEntry,
      {
        type: "run",
        runtimeKind: input.runtimeKind,
        databasePath: input.databasePath,
        backupDirectory: input.backupDirectory,
        migrations: input.migrations,
        dryRun: input.dryRun !== false,
        migrationTimeoutMs,
        totalTimeoutMs,
      },
      input.execArgv,
    );
    let settled = false;
    let migrationTimer: ReturnType<typeof setTimeout> | undefined;
    const totalTimer = setTimeout(
      () => fail(new Error("migration worker exceeded total timeout"), true),
      totalTimeoutMs,
    );
    const clear = () => {
      clearTimeout(totalTimer);
      if (migrationTimer) clearTimeout(migrationTimer);
    };
    const fail = async (error: Error, terminate = false) => {
      if (settled) return;
      settled = true;
      clear();
      if (child.exitCode === null)
        child.kill(terminate ? "SIGKILL" : "SIGTERM");
      try {
        const integrity = await integrityInWorker(input);
        if (integrity !== "ok")
          reject(
            new Error(
              `${error.message}; recovery integrity failed: ${integrity}`,
            ),
          );
        else reject(error);
      } catch (integrityError) {
        reject(
          new Error(`${error.message}; recovery worker failed`, {
            cause: integrityError,
          }),
        );
      }
    };
    child.onMessage((value) => {
      const message = value as MigrationWorkerMessage;
      if (message.type === "progress") {
        if (migrationTimer) clearTimeout(migrationTimer);
        if (message.status === "started")
          migrationTimer = setTimeout(
            () =>
              void fail(
                new Error(`migration timed out: ${message.migrationId}`),
                true,
              ),
            migrationTimeoutMs,
          );
        return;
      }
      if (message.type === "completed" && !settled) {
        settled = true;
        clear();
        child.kill();
        resolve(message.diagnostic);
        return;
      }
      if (message.type === "failed")
        void fail(
          new Error(`${message.error}${stderrText(child.stderr)}`),
          false,
        );
    });
    child.onceError((error) => void fail(error, false));
    child.onceExit((code, signal) => {
      if (!settled)
        void fail(
          new Error(
            `migration worker exited before completion (${code ?? signal})${stderrText(child.stderr)}`,
          ),
          false,
        );
    });
  });
}
