import { createHash } from "node:crypto";
import {
  GenerationCostObservationSchema,
  type GenerationCostObservation,
} from "@dramaip/contracts/insights";
import type {
  PluginMigration,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const generationCostMigration: PluginMigration = {
  id: "insights.0005.generation-cost-observations",
  pluginId: "insights",
  version: "3.0.0-alpha.4",
  dependsOn: ["insights.0001.feedback-and-generation"],
  sql: `CREATE TABLE insights_generation_cost_observations (
    record_id TEXT NOT NULL REFERENCES insights_generation_records(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    value_json TEXT NOT NULL CHECK(json_valid(value_json)),
    content_sha256 TEXT NOT NULL,
    PRIMARY KEY(record_id, sequence));`,
};
export class GenerationCostIntegrityError extends Error {}
const fingerprint = (id: string, sequence: number, json: string) =>
  createHash("sha256")
    .update(JSON.stringify([id, sequence, json]))
    .digest("hex");

export function costObservation(
  source: GenerationCostObservation["source"],
  amount: unknown,
  unit?: unknown,
  recordedAt?: string,
): GenerationCostObservation {
  return GenerationCostObservationSchema.parse({
    source,
    measurementScope:
      source === "configured-unit-estimate" ? "configured-unit" : "unspecified",
    billingStatus: "unknown",
    amount:
      amount == null
        ? { status: "unreported" }
        : typeof amount === "number" && Number.isFinite(amount) && amount >= 0
          ? { status: "reported", value: amount }
          : { status: "invalid" },
    unit:
      unit == null
        ? { status: "unreported" }
        : typeof unit === "string" && unit.trim() && unit.trim().length <= 80
          ? { status: "reported", value: unit.trim() }
          : { status: "invalid" },
    ...(recordedAt ? { recordedAt } : {}),
  });
}

/** A digest protects the captured local record, not the truth of a bill. */
export function appendGenerationCost(
  tx: UnitOfWorkTransaction,
  recordId: string,
  value: GenerationCostObservation,
) {
  const parsed = GenerationCostObservationSchema.parse(value);
  const sequence =
    (tx.get<{ sequence: number }>(
      "SELECT MAX(sequence) AS sequence FROM insights_generation_cost_observations WHERE record_id = ?",
      recordId,
    )?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence))
    throw new GenerationCostIntegrityError("费用观察序号无法核对。");
  const json = JSON.stringify(parsed);
  tx.run(
    "INSERT INTO insights_generation_cost_observations VALUES (?, ?, ?, ?)",
    recordId,
    sequence,
    json,
    fingerprint(recordId, sequence, json),
  );
}

export function generationCostHistory(
  tx: UnitOfWorkTransaction,
  recordId: string,
  legacyAmount: unknown,
) {
  const rows = tx.all<{
    sequence: number;
    value_json: string;
    content_sha256: string;
  }>(
    "SELECT sequence, value_json, content_sha256 FROM insights_generation_cost_observations WHERE record_id = ? ORDER BY sequence",
    recordId,
  );
  if (!rows.length)
    return {
      items: [],
      legacyObservation: costObservation("legacy-unverified", legacyAmount),
    };
  try {
    const observations = rows.map((row, index) => {
      if (
        !Number.isSafeInteger(row.sequence) ||
        row.sequence !== index + 1 ||
        fingerprint(recordId, row.sequence, row.value_json) !==
          row.content_sha256
      )
        throw new Error("invalid local observation");
      return {
        sequence: row.sequence,
        observation: GenerationCostObservationSchema.parse(
          JSON.parse(row.value_json),
        ),
      };
    });
    return {
      items: observations,
    };
  } catch {
    throw new GenerationCostIntegrityError(
      "费用观察内容或原记录指纹无法核对。",
    );
  }
}

export function readGenerationCost(
  tx: UnitOfWorkTransaction,
  recordId: string,
  legacyAmount: unknown,
) {
  const history = generationCostHistory(tx, recordId, legacyAmount);
  return {
    costObservation:
      history.items.at(-1)?.observation ?? history.legacyObservation!,
    costObservationCount: history.items.length,
  };
}
