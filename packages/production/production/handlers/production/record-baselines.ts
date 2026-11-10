import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ProductionRecordBaselineObservationsSchema,
  type EpisodeDevelopmentResult,
  type ProductionRecordBaselineObservations,
} from "@dramaip/contracts/production";

type Binding = NonNullable<
  EpisodeDevelopmentResult["productionRecords"]
>[number];
const recordFields = z
  .object({
    title: z.string(),
    parentId: z.string().uuid().nullable(),
    orderIndex: z.number().int().nonnegative(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
const identity = z
  .object({
    projectId: z.string().uuid(),
    id: z.string().uuid(),
    stableId: z.string().min(1).max(64),
    kind: z.enum(["scenes", "shots"]),
    version: z.number().int().nonnegative(),
    fields: recordFields,
  })
  .strict();
const baselineSchema = identity
  .extend({
    format: z.literal("production-record-baseline-v1"),
    capturedResult: z
      .object({ id: z.string().uuid(), version: z.number().int().positive() })
      .strict(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type ProductionRecordBaseline = z.infer<typeof baselineSchema>;
export interface BaselineRecordRow {
  id: string;
  project_id: string;
  kind: string;
  version: number;
  title: string;
  parent_id: string | null;
  order_index: number;
  payload_json: string;
}
export function canonicalProductionRecordJSON(
  value: unknown,
  depth = 0,
): string {
  if (depth > 100) throw new Error("实际记录字段层级超限，不能完整冻结。");
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalProductionRecordJSON(item, depth + 1)).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalProductionRecordJSON((value as Record<string, unknown>)[key], depth + 1)}`,
      )
      .join(",")}}`;
  throw new Error("实际记录字段不是完整可保存的 JSON，不截断或归一成空值。");
}
const hash = (value: unknown) =>
  createHash("sha256")
    .update(canonicalProductionRecordJSON(value))
    .digest("hex");
function actual(row: BaselineRecordRow, binding: Binding, projectId: string) {
  const payload = JSON.parse(row.payload_json) as unknown;
  const value = identity.parse({
    projectId: row.project_id,
    id: row.id,
    stableId: binding.stableId,
    kind: row.kind,
    version: row.version,
    fields: {
      title: row.title,
      parentId: row.parent_id,
      orderIndex: row.order_index,
      payload,
    },
  });
  if (
    canonicalProductionRecordJSON(payload) !==
    canonicalProductionRecordJSON(value.fields.payload)
  )
    throw new Error("实际保存字段无法完整保留，不归一或静默省略字段。");
  if (
    value.projectId !== projectId ||
    value.id !== binding.id ||
    value.kind !== binding.kind ||
    value.fields.payload.stableId !== binding.stableId
  )
    throw new Error("实际记录归属或稳定身份不符。");
  return { ...value, contentHash: hash(value) };
}

/** Called only after the owner wrote the real row, inside the same adoption
 * transaction. Never reconstructs missing historic fields from model output. */
export function captureProductionRecordBaseline(input: {
  row: BaselineRecordRow;
  binding: Binding;
  projectId: string;
  result: { id: string; version: number };
}): ProductionRecordBaseline {
  const value = actual(input.row, input.binding, input.projectId);
  if (value.version !== input.binding.version)
    throw new Error("基准版本与实际采用记录不符。");
  return baselineSchema.parse({
    ...value,
    format: "production-record-baseline-v1",
    capturedResult: input.result,
  });
}

export function inspectProductionRecordBaselines(input: {
  projectId: string;
  bindings: Binding[];
  baselines: unknown;
  rows: BaselineRecordRow[];
}): ProductionRecordBaselineObservations {
  const candidates = Array.isArray(input.baselines) ? input.baselines : [];
  const knownIds = new Set(input.bindings.map((binding) => binding.id));
  const malformedCollection =
    input.baselines !== undefined &&
    (!Array.isArray(input.baselines) ||
      candidates.some(
        (value) =>
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          !knownIds.has(value.id as string),
      ));
  const byId = <T>(values: T[], id: (value: T) => string) => {
    const map = new Map<string, T[]>();
    for (const value of values) {
      const key = id(value);
      const group = map.get(key);
      if (group) group.push(value);
      else map.set(key, [value]);
    }
    return map;
  };
  const rowsById = byId(input.rows, (row) => row.id);
  const candidatesById = byId(
    candidates.filter(
      (value) => value && typeof value === "object" && "id" in value,
    ),
    (value) => value.id,
  );
  const records = input.bindings.map((binding) => {
    const basic = {
      id: binding.id,
      stableId: binding.stableId,
      kind: binding.kind,
      frozenVersion: binding.version,
    };
    let current: ReturnType<typeof actual> | undefined;
    const rows = rowsById.get(binding.id) ?? [];
    try {
      if (rows.length === 1)
        current = actual(rows[0]!, binding, input.projectId);
    } catch {
      /* Invalid remains distinct from missing. */
    }
    const currentMeta = current
      ? {
          version: current.version,
          contentHash: current.contentHash,
          parentId: current.fields.parentId,
          orderIndex: current.fields.orderIndex,
        }
      : null;
    const matches = candidatesById.get(binding.id) ?? [];
    const parsed =
      matches.length === 1 ? baselineSchema.safeParse(matches[0]) : undefined;
    let baseline: ProductionRecordBaseline | undefined;
    if (parsed?.success) {
      const {
        format: _format,
        capturedResult: _capture,
        contentHash,
        ...value
      } = parsed.data;
      try {
        if (
          value.projectId === input.projectId &&
          value.id === binding.id &&
          value.kind === binding.kind &&
          value.stableId === binding.stableId &&
          value.version === binding.version &&
          value.fields.payload.stableId === binding.stableId &&
          contentHash === hash(value)
        )
          baseline = parsed.data;
      } catch {
        /* No normalization or re-capture of a malformed stored baseline. */
      }
    }
    if (!baseline)
      return {
        ...basic,
        frozen: null,
        current: currentMeta,
        state:
          malformedCollection || matches.length
            ? ("baseline-invalid" as const)
            : ("unrecorded" as const),
        changes: [],
      };
    const frozen = {
      contentHash: baseline.contentHash,
      capturedResult: baseline.capturedResult,
      parentId: baseline.fields.parentId,
      orderIndex: baseline.fields.orderIndex,
    };
    if (!current)
      return {
        ...basic,
        frozen,
        current: null,
        state: rows.length
          ? ("record-invalid" as const)
          : ("record-missing" as const),
        changes: [],
      };
    const changes = (
      ["title", "parentId", "orderIndex", "payload"] as const
    ).flatMap((field) => {
      const beforeHash = hash(baseline.fields[field]),
        afterHash = hash(current.fields[field]);
      return beforeHash === afterHash ? [] : [{ field, beforeHash, afterHash }];
    });
    return {
      ...basic,
      frozen,
      current: currentMeta,
      state:
        baseline.contentHash === current.contentHash
          ? ("unchanged" as const)
          : ("changed" as const),
      changes,
    };
  });
  return ProductionRecordBaselineObservationsSchema.parse({
    format: "production-record-baseline-observations-v1",
    records,
  });
}
