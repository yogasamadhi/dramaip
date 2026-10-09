import { z } from "zod";
import {
  CreativeDeliveryCoverageSchema,
  type CreativeDeliveryCoverage,
} from "./creative-delivery-coverage.js";
import { canonicalCreativeMetricJSON } from "./creative-funnel.js";

const observation = z
  .object({
    formalVersion:
      CreativeDeliveryCoverageSchema.shape.groups.element.shape.items.element
        .shape.formalVersion,
    adoptionEventId: z.string().uuid(),
    savedEventId: z.string().uuid().nullable(),
    adoptedInWindow: z.boolean().nullable(),
    deliveredInWindow: z.boolean().nullable(),
    clockState: z.enum(["measured", "pending", "clock-inconsistent"]),
    reason: z
      .enum([
        "future-evidence",
        "owner-clock-reversed",
        "receipt-before-adoption",
        "receipt-after-owner-event",
        "unsupported-clock-precision",
      ])
      .nullable(),
    adoptionToSavedMs: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict();
const group = z
  .object({
    workflowPath: z.enum(["novel", "adaptation"]),
    adoptedInWindow: z.number().int().nonnegative(),
    deliveredInWindow: z.number().int().nonnegative(),
    measuredVersions: z.number().int().nonnegative(),
    pendingVersions: z.number().int().nonnegative(),
    clockInconsistentVersions: z.number().int().nonnegative(),
    duration: z
      .object({
        minimumMs: z.number().int().nonnegative(),
        maximumMs: z.number().int().nonnegative(),
        mean: z
          .object({
            numerator: z
              .string()
              .regex(/^(0|[1-9]\d*)$/u)
              .max(64),
            denominator: z.number().int().positive(),
          })
          .strict(),
      })
      .strict()
      .nullable(),
    items: z.array(observation),
  })
  .strict();
const day = 24 * 60 * 60 * 1000;
function derive(coverage: CreativeDeliveryCoverage, asOf: string) {
  const end = Date.parse(asOf),
    start = end - 7 * day;
  const inWindow = (value: number) => value >= start && value <= end;
  const precise = (value: string) => !/\.\d{3}\d*[1-9]\d*Z$/u.test(value);
  const groups = coverage.groups.map((g) => {
    const items = g.items.map((r) => {
      const adopted = Date.parse(r.adoption.occurredAt),
        saved = r.firstSaved,
        committed = saved ? Date.parse(saved.occurredAt) : null,
        host = saved ? Date.parse(saved.receipt.savedAt) : null;
      const reason: z.infer<typeof observation>["reason"] = ![
        r.adoption.occurredAt,
        ...(saved ? [saved.occurredAt, saved.receipt.savedAt] : []),
      ].every(precise)
        ? "unsupported-clock-precision"
        : adopted > end ||
            (committed !== null && committed > end) ||
            (host !== null && host > end)
          ? "future-evidence"
          : committed !== null && committed < adopted
            ? "owner-clock-reversed"
            : host !== null && host < adopted
              ? "receipt-before-adoption"
              : host !== null && committed !== null && host > committed
                ? "receipt-after-owner-event"
                : null;
      const measured = saved !== null && reason === null;
      return {
        formalVersion: r.formalVersion,
        adoptionEventId: r.adoption.eventId,
        savedEventId: saved?.eventId ?? null,
        adoptedInWindow:
          adopted > end || !precise(r.adoption.occurredAt)
            ? null
            : inWindow(adopted),
        deliveredInWindow: measured ? inWindow(host!) : null,
        clockState: reason
          ? ("clock-inconsistent" as const)
          : saved
            ? ("measured" as const)
            : ("pending" as const),
        reason,
        adoptionToSavedMs: measured ? host! - adopted : null,
      };
    });
    const times = items.flatMap((r) =>
      r.adoptionToSavedMs === null ? [] : [r.adoptionToSavedMs],
    );
    return {
      workflowPath: g.workflowPath,
      adoptedInWindow: items.filter((r) => r.adoptedInWindow === true).length,
      deliveredInWindow: items.filter((r) => r.deliveredInWindow === true)
        .length,
      measuredVersions: times.length,
      pendingVersions: items.filter((r) => r.clockState === "pending").length,
      clockInconsistentVersions: items.filter(
        (r) => r.clockState === "clock-inconsistent",
      ).length,
      duration: times.length
        ? {
            minimumMs: times.reduce((a, b) => Math.min(a, b), Infinity),
            maximumMs: times.reduce((a, b) => Math.max(a, b), 0),
            mean: {
              numerator: times.reduce((a, b) => a + BigInt(b), 0n).toString(),
              denominator: times.length,
            },
          }
        : null,
      items,
    };
  });
  return {
    window: {
      kind: "rolling-seven-days" as const,
      from: new Date(start).toISOString(),
      to: asOf,
    },
    groups,
  };
}
export const CreativeDeliveryWindowSchema = z
  .object({
    format: z.literal("creative-delivery-window-v1"),
    asOf: z.string().datetime(),
    window: z
      .object({
        kind: z.literal("rolling-seven-days"),
        from: z.string().datetime(),
        to: z.string().datetime(),
      })
      .strict(),
    coverage: CreativeDeliveryCoverageSchema,
    groups: z.array(group).length(2),
    timePolicy: z.literal("first-matching-host-save-after-recorded-adoption"),
    qualityState: z.literal("unverified"),
    modelEvidence: z.literal("unknown"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !preciseAsOf(value.asOf) ||
      canonicalCreativeMetricJSON({
        window: value.window,
        groups: value.groups,
      }) !== canonicalCreativeMetricJSON(derive(value.coverage, value.asOf))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "交付时间窗与耗时须来自原首次匹配回执，异常不补零，重复不计新增。",
      });
  });
function preciseAsOf(value: string) {
  return !/\.\d{3}\d*[1-9]\d*Z$/u.test(value);
}
export type CreativeDeliveryWindow = z.infer<
  typeof CreativeDeliveryWindowSchema
>;
/** Recorded historical version units, not a weekly conversion cohort or literary quality. */
export function measureCreativeDeliveryWindow(
  coverageInput: CreativeDeliveryCoverage,
  asOfInput: string,
): CreativeDeliveryWindow {
  const coverage = CreativeDeliveryCoverageSchema.parse(coverageInput),
    asOf = z.string().datetime().parse(asOfInput);
  return CreativeDeliveryWindowSchema.parse({
    format: "creative-delivery-window-v1",
    asOf,
    ...derive(coverage, asOf),
    coverage,
    timePolicy: "first-matching-host-save-after-recorded-adoption",
    qualityState: "unverified",
    modelEvidence: "unknown",
  });
}
