import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalImportRequestJSON,
  SourceImportCommitInputSchema,
  SourceImportCommitRecoverySchema,
  SourceImportCommitResultSchema,
  type SourceImportCommitInput,
  type SourceImportCommitResult,
} from "@dramaip/contracts/workspace";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const ordinaryImportMigration: PluginMigration = {
  id: "workspace.0010.ordinary-import-commits",
  pluginId: "workspace",
  version: "3.0.0-alpha.4",
  dependsOn: ["workspace.0009.project-creation-receipts"],
  sql: `CREATE TABLE workspace_source_import_commits (
    import_id TEXT PRIMARY KEY,
    request_key TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_hash TEXT NOT NULL,
    input_json TEXT NOT NULL CHECK(json_valid(input_json)),
    target_json TEXT NOT NULL CHECK(json_valid(target_json)),
    result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
    created_at TEXT NOT NULL,
    committed_at TEXT
  );`,
};

export class SourceImportRecoveryError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const OrdinaryImportTargetSchema = z
  .object({
    projectVersion: z.number().int().nonnegative(),
    currentAdaptationId: z.string().uuid().nullable(),
  })
  .strict();
export type OrdinaryImportTarget = z.infer<typeof OrdinaryImportTargetSchema>;

const hash = (input: SourceImportCommitInput) =>
  createHash("sha256").update(canonicalImportRequestJSON(input)).digest("hex");

export function readOrdinaryImport(
  tx: UnitOfWorkTransaction,
  id: string,
  key: string,
  projectId: string,
  submitted?: SourceImportCommitInput,
) {
  const row = tx.get<{
    import_id: string;
    request_key: string;
    project_id: string;
    request_hash: string;
    input_json: string;
    target_json: string;
    result_json: string | null;
    created_at: string;
    committed_at: string | null;
  }>(
    "SELECT * FROM workspace_source_import_commits WHERE import_id = ? OR request_key = ?",
    id,
    key,
  );
  if (!row) return;
  if (
    row.import_id !== id ||
    row.request_key !== key ||
    row.project_id !== projectId ||
    (submitted && row.request_hash !== hash(submitted))
  )
    throw new SourceImportRecoveryError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "原导入已绑定其他输入；保留原键和原请求，不重复导入。",
    );
  try {
    const input = SourceImportCommitInputSchema.parse(
      JSON.parse(row.input_json),
    );
    if (input.projectId !== projectId || hash(input) !== row.request_hash)
      throw new Error("corrupt binding");
    const target = OrdinaryImportTargetSchema.parse(
      JSON.parse(row.target_json),
    );
    const recovery = SourceImportCommitRecoverySchema.parse({
      importId: id,
      projectId,
      input,
      state: row.result_json === null ? "pending" : "committed",
      ...(row.result_json === null
        ? {}
        : { result: JSON.parse(row.result_json) }),
      createdAt: row.created_at,
      ...(row.committed_at === null ? {} : { committedAt: row.committed_at }),
    });
    return { recovery, target };
  } catch {
    throw new SourceImportRecoveryError(
      409,
      "IDEMPOTENCY_BINDING_UNKNOWN",
      "原导入回执无法安全核对；保留原键，不重新写入。",
    );
  }
}

export function prepareOrdinaryImport(
  tx: UnitOfWorkTransaction,
  id: string,
  key: string,
  input: SourceImportCommitInput,
  target: OrdinaryImportTarget,
) {
  tx.run(
    "INSERT INTO workspace_source_import_commits(import_id, request_key, project_id, request_hash, input_json, target_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    key,
    input.projectId,
    hash(input),
    JSON.stringify(input),
    JSON.stringify(OrdinaryImportTargetSchema.parse(target)),
    new Date().toISOString(),
  );
}

export function completeOrdinaryImport(
  tx: UnitOfWorkTransaction,
  id: string,
  key: string,
  input: SourceImportCommitInput,
  result: SourceImportCommitResult,
) {
  const actual = SourceImportCommitResultSchema.parse(result);
  const old = readOrdinaryImport(tx, id, key, input.projectId, input);
  if (!old || old.recovery.state !== "pending")
    throw new SourceImportRecoveryError(
      409,
      "CONFLICT",
      "原导入状态已变化，不覆盖历史回执。",
    );
  tx.run(
    "UPDATE workspace_source_import_commits SET result_json = ?, committed_at = ? WHERE import_id = ? AND request_key = ? AND result_json IS NULL",
    JSON.stringify(actual),
    new Date().toISOString(),
    id,
    key,
  );
  tx.run("DELETE FROM workspace_source_imports WHERE id = ?", id);
  return actual;
}
