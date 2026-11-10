import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createSqlite } from "./sqlite.js";

export interface LegacyDatabaseManifest {
  sourcePath: string;
  backupPath: string;
  sha256: string;
  size: number;
  legacyVersion: string | undefined;
  userVersion: number;
  tables: readonly string[];
  backedUpAt: string;
}

type CutoverStage =
  | "pending-backup"
  | "backup-moving"
  | "backup-verified"
  | "fresh-pending"
  | "complete"
  | "failed";

interface CutoverState {
  format: 1;
  stage: CutoverStage;
  createdAt: string;
  updatedAt: string;
  backupPath?: string;
  manifest?: LegacyDatabaseManifest;
  failure?: string;
}

export interface DestructiveCutoverOptions {
  databasePath: string;
  backupDirectory: string;
  legacyVersion?: string;
}

export interface DestructiveCutover {
  readonly statePath: string;
  readonly manifest: LegacyDatabaseManifest | undefined;
  finalize(): void;
  fail(error: unknown): void;
}

function statePathFor(options: DestructiveCutoverOptions): string {
  return join(
    options.backupDirectory,
    "architecture-upgrade",
    `${basename(options.databasePath)}.v3-cutover.json`,
  );
}

function writeState(path: string, state: CutoverState): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function readState(path: string): CutoverState | undefined {
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<CutoverState>;
  if (
    value.format !== 1 ||
    !value.stage ||
    !value.createdAt ||
    !value.updatedAt
  )
    throw new Error(`invalid desktop v3 cutover state: ${path}`);
  return value as CutoverState;
}

function databaseMetadata(
  path: string,
): Pick<LegacyDatabaseManifest, "userVersion" | "tables"> {
  const sqlite = createSqlite(path, { readOnly: true });
  try {
    const version = sqlite.prepare("PRAGMA user_version").get() as {
      user_version?: number;
    };
    const rows = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    return {
      userVersion: version.user_version ?? 0,
      tables: rows.map((row) => row.name),
    };
  } finally {
    sqlite.close();
  }
}

function integrityCheck(path: string): "ok" | string {
  const sqlite = createSqlite(path, { readOnly: true });
  try {
    const row = sqlite.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: string;
    };
    return row.integrity_check === "ok"
      ? "ok"
      : (row.integrity_check ?? "unknown");
  } finally {
    sqlite.close();
  }
}

function checkpointAndVerify(path: string): void {
  const sqlite = createSqlite(path);
  try {
    sqlite.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
  } finally {
    sqlite.close();
  }
  const result = integrityCheck(path);
  if (result !== "ok")
    throw new Error(`legacy database integrity check failed: ${result}`);
}

function timestampPath(options: DestructiveCutoverOptions): string {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return join(
    options.backupDirectory,
    "architecture-upgrade",
    `${basename(options.databasePath)}-${stamp}`,
  );
}

function makeManifest(
  sourcePath: string,
  backupPath: string,
  legacyVersion: string | undefined,
): LegacyDatabaseManifest {
  const file = readFileSync(backupPath);
  const metadata = databaseMetadata(backupPath);
  return {
    sourcePath,
    backupPath,
    sha256: createHash("sha256").update(file).digest("hex"),
    size: statSync(backupPath).size,
    legacyVersion,
    ...metadata,
    backedUpAt: new Date().toISOString(),
  };
}

function removeResidualWalFiles(path: string): void {
  for (const suffix of ["-wal", "-shm"] as const) {
    const candidate = `${path}${suffix}`;
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }
}

/**
 * Performs the irreversible database boundary only once. The state machine is
 * deliberately external to the SQLite file so a crash can never cause a fresh
 * v3 file to be reclassified and backed up as a legacy database on restart.
 */
export function prepareDestructiveV3Cutover(
  options: DestructiveCutoverOptions,
): DestructiveCutover {
  const statePath = statePathFor(options);
  const existingState = readState(statePath);
  const now = new Date().toISOString();
  let state: CutoverState = existingState ?? {
    format: 1,
    stage: existsSync(options.databasePath)
      ? "pending-backup"
      : "fresh-pending",
    createdAt: now,
    updatedAt: now,
  };
  if (!existingState) {
    writeState(statePath, state);
  }
  if (state.stage === "failed")
    throw new Error(
      `desktop v3 database cutover is blocked: ${state.failure ?? "unknown failure"}`,
    );

  try {
    if (state.stage === "pending-backup") {
      state = {
        ...state,
        stage: "backup-moving",
        backupPath: timestampPath(options),
        updatedAt: new Date().toISOString(),
      };
      // Persist the target before rename so a crash cannot reclassify a new DB.
      writeState(statePath, state);
    }

    if (state.stage === "backup-moving") {
      if (!state.backupPath)
        throw new Error("cutover backup target is missing");
      const sourceExists = existsSync(options.databasePath);
      const backupExists = existsSync(state.backupPath);
      if (sourceExists && backupExists)
        throw new Error("both legacy database and cutover backup are present");
      if (sourceExists) {
        checkpointAndVerify(options.databasePath);
        mkdirSync(dirname(state.backupPath), { recursive: true, mode: 0o700 });
        renameSync(options.databasePath, state.backupPath);
      } else if (!backupExists) {
        throw new Error(
          "legacy database disappeared while preparing the v3 cutover",
        );
      }
      if (integrityCheck(state.backupPath) !== "ok")
        throw new Error(
          "backup database integrity check failed after atomic move",
        );
      const manifest = makeManifest(
        options.databasePath,
        state.backupPath,
        options.legacyVersion,
      );
      state = {
        ...state,
        stage: "backup-verified",
        manifest,
        updatedAt: new Date().toISOString(),
      };
      writeState(statePath, state);
    }

    if (state.stage === "backup-verified") {
      if (!state.manifest || integrityCheck(state.manifest.backupPath) !== "ok")
        throw new Error("verified legacy backup is unavailable or corrupt");
      removeResidualWalFiles(options.databasePath);
      state = {
        ...state,
        stage: "fresh-pending",
        updatedAt: new Date().toISOString(),
      };
      writeState(statePath, state);
    }
  } catch (error) {
    state = {
      ...state,
      stage: "failed",
      failure: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    writeState(statePath, state);
    throw error;
  }

  const persist = (next: CutoverState): void => {
    state = { ...next, updatedAt: new Date().toISOString() };
    writeState(statePath, state);
  };
  return {
    statePath,
    manifest: state.manifest,
    finalize() {
      try {
        if (state.stage === "complete") return;
        if (state.stage !== "fresh-pending")
          throw new Error(`cannot finalize v3 cutover from ${state.stage}`);
        if (!existsSync(options.databasePath))
          throw new Error("new v3 database was not created");
        const result = integrityCheck(options.databasePath);
        if (result !== "ok")
          throw new Error(`new v3 database integrity check failed: ${result}`);
        persist({ ...state, stage: "complete" });
      } catch (error) {
        if (state.stage !== "complete")
          persist({
            ...state,
            stage: "failed",
            failure: error instanceof Error ? error.message : String(error),
          });
        throw error;
      }
    },
    fail(error) {
      if (state.stage === "complete") return;
      persist({
        ...state,
        stage: "failed",
        failure: error instanceof Error ? error.message : String(error),
      });
    },
  };
}
