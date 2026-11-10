import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createSqlite } from "./sqlite.js";

export interface Alpha3AgentCutoverManifest {
  readonly sourcePath: string;
  readonly backupPath: string;
  readonly sha256: string;
  readonly size: number;
  readonly alpha2Version: string;
  readonly userVersion: number;
  readonly tables: readonly string[];
  readonly backedUpAt: string;
}

type Stage = "pending" | "copying" | "fresh-pending" | "complete" | "failed";

interface State {
  format: 1;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  manifest?: Alpha3AgentCutoverManifest;
  failure?: string;
}

export interface Alpha2ToAlpha3AgentCutoverOptions {
  readonly databasePath: string;
  readonly backupDirectory: string;
  readonly alpha2Version?: string;
}

export interface Alpha2ToAlpha3AgentCutover {
  readonly statePath: string;
  readonly manifest: Alpha3AgentCutoverManifest | undefined;
  finalize(): void;
  fail(error: unknown): void;
}

function statePathFor(options: Alpha2ToAlpha3AgentCutoverOptions): string {
  return join(
    options.backupDirectory,
    "architecture-upgrade",
    "alpha2-agent-to-alpha3.json",
  );
}

function writeState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function readState(path: string): State | undefined {
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
  if (
    value.format !== 1 ||
    !value.stage ||
    !value.createdAt ||
    !value.updatedAt
  )
    throw new Error(`invalid alpha.3 agent cutover state: ${path}`);
  return value as State;
}

function integrity(path: string): void {
  const sqlite = createSqlite(path, { readOnly: true });
  try {
    const result = sqlite.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: string;
    };
    if (result.integrity_check !== "ok")
      throw new Error(
        `integrity check failed for ${basename(path)}: ${result.integrity_check ?? "unknown"}`,
      );
  } finally {
    sqlite.close();
  }
}

function checkpoint(path: string): void {
  const sqlite = createSqlite(path);
  try {
    sqlite.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
  } finally {
    sqlite.close();
  }
  integrity(path);
}

function createManifest(
  sourcePath: string,
  backupPath: string,
  alpha2Version: string,
): Alpha3AgentCutoverManifest {
  integrity(backupPath);
  const sqlite = createSqlite(backupPath, { readOnly: true });
  try {
    const version = sqlite.prepare("PRAGMA user_version").get() as {
      user_version?: number;
    };
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all() as { name: string }[];
    const content = readFileSync(backupPath);
    return {
      sourcePath,
      backupPath,
      sha256: createHash("sha256").update(content).digest("hex"),
      size: statSync(backupPath).size,
      alpha2Version,
      userVersion: version.user_version ?? 0,
      tables: tables.map((table) => table.name),
      backedUpAt: new Date().toISOString(),
    };
  } finally {
    sqlite.close();
  }
}

/**
 * Alpha.3 only resets Agent execution/evaluation data. The project database is
 * retained in place, but a verified pre-migration copy is mandatory and
 * state is ledgered separately so an interrupted startup cannot back it up
 * twice or re-run destructive Agent cleanup.
 */
export function prepareAlpha2ToAlpha3AgentCutover(
  options: Alpha2ToAlpha3AgentCutoverOptions,
): Alpha2ToAlpha3AgentCutover {
  const statePath = statePathFor(options);
  const existing = readState(statePath);
  const now = new Date().toISOString();
  let state: State = existing ?? {
    format: 1,
    stage: existsSync(options.databasePath) ? "pending" : "fresh-pending",
    createdAt: now,
    updatedAt: now,
  };
  if (!existing) writeState(statePath, state);
  if (state.stage === "failed")
    throw new Error(
      `alpha.3 Agent cutover is blocked: ${state.failure ?? "unknown failure"}`,
    );
  if (state.stage === "complete")
    return {
      statePath,
      manifest: state.manifest,
      finalize: () => undefined,
      fail: () => undefined,
    };

  try {
    if (state.stage === "pending") {
      const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
      const backupPath = join(
        options.backupDirectory,
        "architecture-upgrade",
        `${basename(options.databasePath)}-alpha.2-agent-${stamp}`,
      );
      state = { ...state, stage: "copying", updatedAt: now };
      writeState(statePath, state);
      checkpoint(options.databasePath);
      mkdirSync(dirname(backupPath), { recursive: true, mode: 0o700 });
      const temporary = `${backupPath}.${process.pid}.tmp`;
      copyFileSync(options.databasePath, temporary);
      renameSync(temporary, backupPath);
      const manifest = createManifest(
        options.databasePath,
        backupPath,
        options.alpha2Version ?? "3.0.0-alpha.2",
      );
      state = {
        ...state,
        stage: "fresh-pending",
        manifest,
        updatedAt: new Date().toISOString(),
      };
      writeState(statePath, state);
    } else if (state.stage === "copying") {
      throw new Error(
        "alpha.3 Agent backup was interrupted; inspect and restore the recorded database before retrying",
      );
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

  return {
    statePath,
    manifest: state.manifest,
    finalize() {
      const latest = readState(statePath);
      if (!latest || latest.stage !== "fresh-pending")
        throw new Error(
          "alpha.3 Agent cutover cannot be finalized from its current state",
        );
      if (existsSync(options.databasePath)) integrity(options.databasePath);
      writeState(statePath, {
        ...latest,
        stage: "complete",
        updatedAt: new Date().toISOString(),
      });
    },
    fail(error: unknown) {
      const latest = readState(statePath);
      if (!latest || latest.stage === "complete") return;
      writeState(statePath, {
        ...latest,
        stage: "failed",
        failure: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      });
    },
  };
}
