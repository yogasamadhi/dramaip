import { createHash } from "node:crypto";
import type { UnitOfWorkTransaction } from "@dramaip/plugin-api/internal";

type Operation =
  | "projects.create"
  | "projects.commitDerivation"
  | "workspace.projects.createIdempotent";
export class ProjectCreationReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 404 | 409 = 409,
  ) {
    super(message);
  }
}

/** Owner-local request material. Neither its private fields nor digest are metrics. */
export function projectCreationRequestHash(value: unknown): string {
  const canonical = (entry: unknown): unknown =>
    Array.isArray(entry)
      ? entry.map(canonical)
      : entry && typeof entry === "object"
        ? Object.fromEntries(
            Object.entries(entry)
              .filter(([, child]) => child !== undefined)
              .sort(([left], [right]) =>
                left < right ? -1 : left > right ? 1 : 0,
              )
              .map(([key, child]) => [key, canonical(child)]),
          )
        : entry;
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function readProjectCreationReceipt<T>(
  tx: UnitOfWorkTransaction,
  key: string,
  operation: Operation,
  requestHash: string,
  decode: (value: unknown) => T,
  legacyMatches: (
    value: unknown,
  ) => "legacy-input" | "legacy-project-snapshot" | undefined,
):
  | {
      value: T;
      binding: "request" | "legacy-input" | "legacy-project-snapshot";
    }
  | undefined {
  const row = tx.get<{
    operation: Operation | null;
    request_hash: string | null;
    response_json: string;
  }>(
    "SELECT operation, request_hash, response_json FROM workspace_project_create_idempotency WHERE idempotency_key = ?",
    key,
  );
  if (!row) return;
  let value: unknown;
  try {
    value = JSON.parse(row.response_json);
  } catch {
    throw new ProjectCreationReceiptError(
      "IDEMPOTENCY_BINDING_UNKNOWN",
      "原创建回执无法安全读取；请检查原项目，不会重新创建。",
    );
  }
  const decodeValue = (): T => {
    try {
      return decode(value);
    } catch {
      throw new ProjectCreationReceiptError(
        "IDEMPOTENCY_BINDING_UNKNOWN",
        "原创建回执不完整；请检查原项目，不会重新创建。",
      );
    }
  };
  if (row.operation !== null || row.request_hash !== null) {
    if (row.operation !== operation || row.request_hash !== requestHash)
      throw new ProjectCreationReceiptError(
        "IDEMPOTENCY_CONFLICT",
        "创建恢复键已绑定另一操作或输入；不会创建替代项目。",
      );
    return { value: decodeValue(), binding: "request" };
  }
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const oldOperation: Operation | undefined =
    "derivationId" in record
      ? "projects.commitDerivation"
      : "requestInput" in record
        ? "workspace.projects.createIdempotent"
        : "initialization" in record
          ? "projects.create"
          : undefined;
  if (oldOperation && oldOperation !== operation)
    throw new ProjectCreationReceiptError(
      "IDEMPOTENCY_CONFLICT",
      "旧创建回执属于另一操作；不会创建替代项目。",
    );
  const binding = oldOperation === operation ? legacyMatches(value) : undefined;
  if (!binding)
    throw new ProjectCreationReceiptError(
      "IDEMPOTENCY_BINDING_UNKNOWN",
      "旧创建回执缺少可核对的原输入或派生预览；请检查原项目，不会重新创建。",
    );
  // Never bind an unverified historical request to the first new retry, or fabricate facts.
  return { value: decodeValue(), binding };
}

export function writeProjectCreationReceipt(
  tx: UnitOfWorkTransaction,
  key: string,
  operation: Operation,
  requestHash: string,
  value: unknown,
): void {
  tx.run(
    "INSERT INTO workspace_project_create_idempotency(idempotency_key, response_json, created_at, operation, request_hash) VALUES (?, ?, ?, ?, ?)",
    key,
    JSON.stringify(value),
    new Date().toISOString(),
    operation,
    requestHash,
  );
}

export const projectCreationReceiptMigration = {
  id: "workspace.0009.project-creation-receipts",
  pluginId: "workspace",
  version: "3.0.0-alpha.4",
  dependsOn: ["workspace.0008.ai-author-intents"],
  sql: `ALTER TABLE workspace_project_create_idempotency ADD COLUMN operation TEXT
    CHECK(operation IS NULL OR operation IN ('projects.create', 'projects.commitDerivation', 'workspace.projects.createIdempotent'));
    ALTER TABLE workspace_project_create_idempotency ADD COLUMN request_hash TEXT
    CHECK(request_hash IS NULL OR (length(request_hash) = 64 AND request_hash NOT GLOB '*[^a-f0-9]*'));`,
};
