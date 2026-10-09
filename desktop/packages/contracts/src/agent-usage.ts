import { z } from "zod";

export const AgentUsageScopeSchema = z.enum([
  "response-increment",
  "run-total",
  "session-total",
  "unspecified",
]);
export type AgentUsageScope = z.infer<typeof AgentUsageScopeSchema>;
export const AgentUsageTokenFieldSchema = z.enum([
  "inputTokens",
  "outputTokens",
  "cachedTokens",
]);
export type AgentUsageTokenField = z.infer<typeof AgentUsageTokenFieldSchema>;
export const AgentUsageCostFieldSchema = z.enum(["estimatedCost", "currency"]);
export type AgentUsageCostField = z.infer<typeof AgentUsageCostFieldSchema>;
export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCost?: number;
  currency?: string;
  measurementScope?: AgentUsageScope;
  inputAccounting?: "includes-cache" | "excludes-cache" | "unspecified";
  invalidFields?: readonly AgentUsageTokenField[];
  invalidCostFields?: readonly AgentUsageCostField[];
}

/** Strip unknown payloads without converting missing/invalid reports into zero. */
export function normalizeAgentUsage(value: unknown): AgentUsage {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const result: AgentUsage = {};
  const invalidFields: AgentUsageTokenField[] = [];
  for (const field of [
    "inputTokens",
    "outputTokens",
    "cachedTokens",
  ] as const) {
    const number = raw[field];
    if (Array.isArray(raw.invalidFields) && raw.invalidFields.includes(field))
      invalidFields.push(field);
    else if (
      typeof number === "number" &&
      Number.isSafeInteger(number) &&
      number >= 0
    )
      result[field] = number;
    else if (number !== undefined) invalidFields.push(field);
  }
  if (invalidFields.length) result.invalidFields = invalidFields;
  const scope = AgentUsageScopeSchema.safeParse(raw.measurementScope);
  if (scope.success) result.measurementScope = scope.data;
  if (
    raw.inputAccounting === "includes-cache" ||
    raw.inputAccounting === "excludes-cache" ||
    raw.inputAccounting === "unspecified"
  )
    result.inputAccounting = raw.inputAccounting;
  const invalidCostFields: AgentUsageCostField[] = [];
  if (
    Array.isArray(raw.invalidCostFields) &&
    raw.invalidCostFields.includes("estimatedCost")
  )
    invalidCostFields.push("estimatedCost");
  else if (
    typeof raw.estimatedCost === "number" &&
    Number.isFinite(raw.estimatedCost) &&
    raw.estimatedCost >= 0
  )
    result.estimatedCost = raw.estimatedCost;
  else if (raw.estimatedCost !== undefined)
    invalidCostFields.push("estimatedCost");
  if (
    Array.isArray(raw.invalidCostFields) &&
    raw.invalidCostFields.includes("currency")
  )
    invalidCostFields.push("currency");
  else if (typeof raw.currency === "string" && /^[A-Z]{3}$/u.test(raw.currency))
    result.currency = raw.currency;
  else if (raw.currency !== undefined) invalidCostFields.push("currency");
  if (invalidCostFields.length) result.invalidCostFields = invalidCostFields;
  return result;
}
export const AgentUsageNumberSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("reported"),
      value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z.object({ status: z.literal("unreported") }).strict(),
  z.object({ status: z.literal("invalid") }).strict(),
]);
export type AgentUsageNumber = z.infer<typeof AgentUsageNumberSchema>;
export const AgentUsageCostEstimateSchema = z
  .object({
    source: z.literal("engine-reported-estimate"),
    amount: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("reported"),
          value: z.number().finite().nonnegative(),
        })
        .strict(),
      z.object({ status: z.literal("unreported") }).strict(),
      z.object({ status: z.literal("invalid") }).strict(),
    ]),
    currency: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("reported"),
          value: z.string().regex(/^[A-Z]{3}$/u),
        })
        .strict(),
      z.object({ status: z.literal("unreported") }).strict(),
      z.object({ status: z.literal("invalid") }).strict(),
    ]),
    billingStatus: z.literal("unknown"),
  })
  .strict();
export type AgentUsageCostEstimate = z.infer<
  typeof AgentUsageCostEstimateSchema
>;
export const AgentUsageObservationSchema = z
  .object({
    format: z.literal("agent-usage-observation-v1"),
    runId: z.string().min(1),
    sessionId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    engineKind: z.enum(["pi", "codex", "langgraph"]),
    cursor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    measurementScope: AgentUsageScopeSchema,
    inputAccounting: z.enum([
      "includes-cache",
      "excludes-cache",
      "unspecified",
    ]),
    inputTokens: AgentUsageNumberSchema,
    outputTokens: AgentUsageNumberSchema,
    cachedTokens: AgentUsageNumberSchema,
    // Optional for immutable historical observations: never manufacture a cost
    // report, a currency or settlement from tokens or today's provider config.
    costEstimate: AgentUsageCostEstimateSchema.optional(),
    source: z.literal("engine-reported"),
    runClassification: z.literal("unknown"),
    billingStatus: z.literal("unknown"),
    recordedAt: z.string().datetime(),
  })
  .strict();
export type AgentUsageObservation = z.infer<typeof AgentUsageObservationSchema>;
export const AgentUsageObservationPageSchema = z
  .object({
    format: z.literal("agent-usage-observation-page-v1"),
    runId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    observationCount: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    coverage: z.literal("partial-or-unknown"),
    billingStatus: z.literal("unknown"),
    items: z.array(AgentUsageObservationSchema).max(100),
    nextCursor: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();
export type AgentUsageObservationPage = z.infer<
  typeof AgentUsageObservationPageSchema
>;

export const AgentRunUsageScopeSchema = z
  .object({
    runId: z.string().min(1),
    sessionId: z.string().min(1),
    projectId: z.string().min(1).optional(),
    origin: z.enum([
      "frozen-context",
      "first-observation",
      "unreported-session",
    ]),
  })
  .strict();
export type AgentRunUsageScope = z.infer<typeof AgentRunUsageScopeSchema>;
