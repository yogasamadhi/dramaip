import { integrityCheck, openDatabase, runMigrationPlan } from "./index.js";
import type {
  MigrationWorkerIntegrityRequest,
  MigrationWorkerMessage,
  MigrationWorkerRequest,
} from "./migration-worker.js";

function send(message: MigrationWorkerMessage): void {
  if (process.send) process.send(message);
  else process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function startMigrationWorkerRuntime(): void {
  if (process.send) {
    process.once("message", (value) => {
      void handle(
        value as MigrationWorkerRequest | MigrationWorkerIntegrityRequest,
      );
    });
    return;
  }
  if (!process.versions.bun)
    throw new Error("Migration Worker requires a supervised parent process");
  void readBunRequest().then(handle);
}

async function readBunRequest(): Promise<
  MigrationWorkerRequest | MigrationWorkerIntegrityRequest
> {
  process.stdin.setEncoding("utf8");
  let serialized = "";
  for await (const chunk of process.stdin) serialized += chunk;
  return JSON.parse(serialized) as
    MigrationWorkerRequest | MigrationWorkerIntegrityRequest;
}

async function handle(
  request: MigrationWorkerRequest | MigrationWorkerIntegrityRequest,
): Promise<void> {
  try {
    assertRuntime(request.runtimeKind);
    if (request.type === "integrity") {
      send({ type: "integrity", result: integrityCheck(request.databasePath) });
      return;
    }
    const database = openDatabase(request.databasePath);
    const diagnostic = (() => {
      try {
        return runMigrationPlan(database, request.migrations, {
          databasePath: request.databasePath,
          backupDirectory: request.backupDirectory,
          dryRun: request.dryRun,
          migrationTimeoutMs: request.migrationTimeoutMs,
          totalTimeoutMs: request.totalTimeoutMs,
          onProgress: (event) => send({ type: "progress", ...event }),
        });
      } finally {
        database.close();
      }
    })();
    send({ type: "completed", diagnostic });
  } catch (error) {
    send({
      type: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function assertRuntime(runtimeKind: "bun" | "electron-node"): void {
  const versions = process.versions as Record<string, string | undefined>;
  const isBun = Boolean(versions.bun);
  const isElectronNode = Boolean(versions.electron) && !isBun;
  if (runtimeKind === "bun" ? !isBun : !isElectronNode)
    throw new Error(
      `Migration Worker runtime mismatch: expected ${runtimeKind}`,
    );
}
