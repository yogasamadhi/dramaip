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

export interface Alpha2DatabaseManifest {
  readonly sourcePath: string;
  readonly backupPath: string;
  readonly sha256: string;
  readonly size: number;
  readonly alpha1Version: string;
  readonly userVersion: number;
  readonly tables: readonly string[];
  readonly backedUpAt: string;
}

type Stage =
  "pending" | "moving" | "verified" | "fresh-pending" | "complete" | "failed";

interface State {
  format: 1;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  targets: readonly { sourcePath: string; backupPath?: string }[];
  manifests?: readonly Alpha2DatabaseManifest[];
  failure?: string;
}

export interface Alpha1ToAlpha2CutoverOptions {
  readonly databasePath: string;
  readonly legacyBridgePath: string;
  readonly backupDirectory: string;
  readonly alpha1Version?: string;
}

export interface Alpha1ToAlpha2Cutover {
  readonly statePath: string;
  readonly manifests: readonly Alpha2DatabaseManifest[];
  finalize(): void;
  fail(error: unknown): void;
}

function writeState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function statePathFor(options: Alpha1ToAlpha2CutoverOptions): string {
  return join(
    options.backupDirectory,
    "architecture-upgrade",
    "alpha1-to-alpha2.json",
  );
}

function readState(path: string): State | undefined {
  if (!existsSync(path)) return undefined;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<State>;
  if (
    parsed.format !== 1 ||
    !parsed.stage ||
    !parsed.createdAt ||
    !parsed.updatedAt ||
    !Array.isArray(parsed.targets)
  )
    throw new Error(`invalid alpha.2 cutover state: ${path}`);
  return parsed as State;
}

function integrity(path: string): void {
  const sqlite = createSqlite(path, { readOnly: true });
  try {
    const row = sqlite.prepare("PRAGMA integrity_check").get() as {
      integrity_check?: string;
    };
    if (row.integrity_check !== "ok")
      throw new Error(
        `integrity check failed for ${basename(path)}: ${row.integrity_check ?? "unknown"}`,
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

function manifest(
  sourcePath: string,
  backupPath: string,
  alpha1Version: string,
): Alpha2DatabaseManifest {
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
      alpha1Version,
      userVersion: version.user_version ?? 0,
      tables: tables.map((table) => table.name),
      backedUpAt: new Date().toISOString(),
    };
  } finally {
    sqlite.close();
  }
}

function removeResidualWal(path: string): void {
  for (const suffix of ["-wal", "-shm"] as const) {
    const candidate = `${path}${suffix}`;
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }
}

/**
 * Alpha.2 has an intentionally separate cutover ledger from alpha.1. It moves
 * both alpha.1 databases before creating a fresh one and never imports them.
 */
export function prepareAlpha1ToAlpha2Cutover(
  options: Alpha1ToAlpha2CutoverOptions,
): Alpha1ToAlpha2Cutover {
  const statePath = statePathFor(options);
  const existing = readState(statePath);
  const now = new Date().toISOString();
  let state: State = existing ?? {
    format: 1,
    stage: "pending",
    createdAt: now,
    updatedAt: now,
    targets: [
      { sourcePath: options.databasePath },
      { sourcePath: options.legacyBridgePath },
    ],
  };
  if (!existing) writeState(statePath, state);
  if (state.stage === "failed")
    throw new Error(
      `alpha.2 database cutover is blocked: ${state.failure ?? "unknown failure"}`,
    );
  if (state.stage === "complete")
    return {
      statePath,
      manifests: state.manifests ?? [],
      finalize: () => undefined,
      fail: () => undefined,
    };
  try {
    if (state.stage === "pending") {
      const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
      state = {
        ...state,
        stage: "moving",
        updatedAt: new Date().toISOString(),
        targets: state.targets.map((target) =>
          existsSync(target.sourcePath)
            ? {
                ...target,
                backupPath: join(
                  options.backupDirectory,
                  "architecture-upgrade",
                  `${basename(target.sourcePath)}-alpha.1-${stamp}`,
                ),
              }
            : target,
        ),
      };
      writeState(statePath, state);
    }
    if (state.stage === "moving") {
      const manifests: Alpha2DatabaseManifest[] = [];
      for (const target of state.targets) {
        if (!target.backupPath) continue;
        const sourceExists = existsSync(target.sourcePath);
        const backupExists = existsSync(target.backupPath);
        if (sourceExists && backupExists)
          throw new Error(
            `both source and backup exist for ${basename(target.sourcePath)}`,
          );
        if (sourceExists) {
          checkpoint(target.sourcePath);
          mkdirSync(dirname(target.backupPath), {
            recursive: true,
            mode: 0o700,
          });
          renameSync(target.sourcePath, target.backupPath);
        } else if (!backupExists) {
          throw new Error(
            `database disappeared during cutover: ${basename(target.sourcePath)}`,
          );
        }
        manifests.push(
          manifest(
            target.sourcePath,
            target.backupPath,
            options.alpha1Version ?? "3.0.0-alpha.1",
          ),
        );
      }
      state = {
        ...state,
        stage: "verified",
        manifests,
        updatedAt: new Date().toISOString(),
      };
      writeState(statePath, state);
    }
    if (state.stage === "verified") {
      for (const entry of state.manifests ?? []) integrity(entry.backupPath);
      for (const target of state.targets) removeResidualWal(target.sourcePath);
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
  return {
    statePath,
    manifests: state.manifests ?? [],
    finalize() {
      const latest = readState(statePath);
      if (!latest || latest.stage !== "fresh-pending")
        throw new Error(
          "alpha.2 cutover cannot be finalized from its current state",
        );
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
