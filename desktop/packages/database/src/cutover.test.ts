import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  openDatabase,
  prepareAlpha2ToAlpha3AgentCutover,
  prepareAlpha1ToAlpha2Cutover,
  prepareDestructiveV3Cutover,
} from "./index.js";

describe("destructive v3 cutover", () => {
  it("backs up alpha.2 in place and preserves project data for the alpha.3 Agent reset", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "dramaip-alpha3-agent-cutover-"),
    );
    const databasePath = join(directory, "dramaip.db");
    const backupDirectory = join(directory, "backups");
    const database = new DatabaseSync(databasePath);
    database.exec(
      "CREATE TABLE projects (id TEXT PRIMARY KEY); INSERT INTO projects VALUES ('p1');",
    );
    database.close();
    try {
      const cutover = prepareAlpha2ToAlpha3AgentCutover({
        databasePath,
        backupDirectory,
      });
      expect(cutover.manifest?.alpha2Version).toBe("3.0.0-alpha.2");
      expect(cutover.manifest?.tables).toContain("projects");
      expect(existsSync(databasePath)).toBe(true);
      expect(existsSync(cutover.manifest!.backupPath)).toBe(true);
      cutover.finalize();
      const repeated = prepareAlpha2ToAlpha3AgentCutover({
        databasePath,
        backupDirectory,
      });
      expect(repeated.manifest?.backupPath).toBe(cutover.manifest?.backupPath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("backs up both alpha.1 databases in one alpha.2 ledger without importing them", () => {
    const directory = mkdtempSync(join(tmpdir(), "dramaip-alpha2-cutover-"));
    const databasePath = join(directory, "dramaip.db");
    const legacyBridgePath = join(directory, "legacy-bridge.db");
    const backupDirectory = join(directory, "backups");
    const primary = new DatabaseSync(databasePath);
    primary.exec("CREATE TABLE alpha1_workspace (id TEXT PRIMARY KEY)");
    primary.close();
    const bridge = new DatabaseSync(legacyBridgePath);
    bridge.exec("CREATE TABLE alpha1_bridge (id TEXT PRIMARY KEY)");
    bridge.close();
    try {
      const cutover = prepareAlpha1ToAlpha2Cutover({
        databasePath,
        legacyBridgePath,
        backupDirectory,
      });
      expect(cutover.manifests).toHaveLength(2);
      expect(cutover.manifests.flatMap((entry) => entry.tables)).toEqual(
        expect.arrayContaining(["alpha1_workspace", "alpha1_bridge"]),
      );
      expect(existsSync(databasePath)).toBe(false);
      expect(existsSync(legacyBridgePath)).toBe(false);
      openDatabase(databasePath).close();
      cutover.finalize();
      expect(readFileSync(cutover.statePath, "utf8")).toContain(
        '"stage": "complete"',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("moves a verified legacy database once and records a durable completion state", () => {
    const directory = mkdtempSync(join(tmpdir(), "dramaip-cutover-"));
    const databasePath = join(directory, "dramaip.db");
    const backupDirectory = join(directory, "backups");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      "CREATE TABLE legacy_projects (id TEXT PRIMARY KEY); INSERT INTO legacy_projects VALUES ('p1')",
    );
    legacy.close();
    try {
      const cutover = prepareDestructiveV3Cutover({
        databasePath,
        backupDirectory,
        legacyVersion: "2.0.0-rc.1",
      });
      expect(cutover.manifest?.legacyVersion).toBe("2.0.0-rc.1");
      expect(cutover.manifest?.tables).toContain("legacy_projects");
      expect(existsSync(databasePath)).toBe(false);
      const fresh = openDatabase(databasePath);
      fresh.sqlite.exec(
        "CREATE TABLE plugin_migrations (migration_id TEXT PRIMARY KEY)",
      );
      fresh.close();
      cutover.finalize();
      const repeated = prepareDestructiveV3Cutover({
        databasePath,
        backupDirectory,
      });
      expect(repeated.manifest?.backupPath).toBe(cutover.manifest?.backupPath);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resumes a cutover interrupted after its backup target was recorded", () => {
    const directory = mkdtempSync(join(tmpdir(), "dramaip-cutover-resume-"));
    const databasePath = join(directory, "dramaip.db");
    const backupDirectory = join(directory, "backups");
    const backupPath = join(
      backupDirectory,
      "architecture-upgrade",
      "dramaip.db-interrupted",
    );
    const statePath = join(
      backupDirectory,
      "architecture-upgrade",
      "dramaip.db.v3-cutover.json",
    );
    const legacy = new DatabaseSync(databasePath);
    legacy.exec("CREATE TABLE legacy_state (id TEXT PRIMARY KEY)");
    legacy.close();
    mkdirSync(join(backupDirectory, "architecture-upgrade"), {
      recursive: true,
    });
    writeFileSync(
      statePath,
      `${JSON.stringify({
        format: 1,
        stage: "backup-moving",
        backupPath,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })}\n`,
    );
    try {
      const cutover = prepareDestructiveV3Cutover({
        databasePath,
        backupDirectory,
      });
      expect(cutover.manifest?.backupPath).toBe(backupPath);
      expect(existsSync(databasePath)).toBe(false);
      expect(existsSync(backupPath)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("blocks automatic retry after a legacy integrity failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "dramaip-cutover-failed-"));
    const databasePath = join(directory, "dramaip.db");
    const backupDirectory = join(directory, "backups");
    writeFileSync(databasePath, "not a sqlite database");
    try {
      expect(() =>
        prepareDestructiveV3Cutover({ databasePath, backupDirectory }),
      ).toThrow();
      expect(() =>
        prepareDestructiveV3Cutover({ databasePath, backupDirectory }),
      ).toThrow("cutover is blocked");
      const state = readFileSync(
        join(
          backupDirectory,
          "architecture-upgrade",
          "dramaip.db.v3-cutover.json",
        ),
        "utf8",
      );
      expect(state).toContain('"stage": "failed"');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
