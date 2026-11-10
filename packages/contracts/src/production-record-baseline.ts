import { z } from "zod";

const version = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const position = z
  .object({
    parentId: z.string().uuid().nullable(),
    orderIndex: version,
  })
  .strict();
const observation = z
  .object({
    id: z.string().uuid(),
    stableId: z.string().min(1).max(64),
    kind: z.enum(["scenes", "shots"]),
    frozenVersion: version,
    frozen: position
      .extend({
        contentHash: hash,
        capturedResult: z
          .object({
            id: z.string().uuid(),
            version: z.number().int().positive(),
          })
          .strict(),
      })
      .strict()
      .nullable(),
    current: position
      .extend({ version, contentHash: hash })
      .strict()
      .nullable(),
    state: z.enum([
      "unchanged",
      "changed",
      "unrecorded",
      "baseline-invalid",
      "record-missing",
      "record-invalid",
    ]),
    changes: z
      .array(
        z
          .object({
            field: z.enum(["title", "parentId", "orderIndex", "payload"]),
            beforeHash: hash,
            afterHash: hash,
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .superRefine((value, ctx) => {
    const valid =
      value.state === "unrecorded" || value.state === "baseline-invalid"
        ? value.frozen === null && !value.changes.length
        : value.state === "record-missing" || value.state === "record-invalid"
          ? value.frozen !== null &&
            value.current === null &&
            !value.changes.length
          : value.frozen !== null &&
            value.current !== null &&
            (value.state === "unchanged"
              ? value.frozenVersion === value.current.version &&
                value.frozen.contentHash === value.current.contentHash &&
                value.frozen.parentId === value.current.parentId &&
                value.frozen.orderIndex === value.current.orderIndex &&
                !value.changes.length
              : value.frozenVersion !== value.current.version ||
                value.frozen.contentHash !== value.current.contentHash);
    if (
      !valid ||
      new Set(value.changes.map((item) => item.field)).size !==
        value.changes.length ||
      value.changes.some((item) => item.beforeHash === item.afterHash)
    )
      ctx.addIssue({
        code: "custom",
        message: "实际字段基准、当前读取和变化状态不一致。",
      });
  });

/** Body-free observation only. Historical absence is not an empty baseline,
 * an author's conflict choice, or permission to replace actual records. */
export const ProductionRecordBaselineObservationsSchema = z
  .object({
    format: z.literal("production-record-baseline-observations-v1"),
    records: z.array(observation).max(60120),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.records.map((item) => item.id)).size !==
        value.records.length ||
      new Set(value.records.map((item) => `${item.kind}:${item.stableId}`))
        .size !== value.records.length
    )
      ctx.addIssue({
        code: "custom",
        message: "实际记录基准身份重复，不能推定完整映射。",
      });
  });
export type ProductionRecordBaselineObservations = z.infer<
  typeof ProductionRecordBaselineObservationsSchema
>;
