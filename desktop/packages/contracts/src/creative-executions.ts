import { z } from "zod";
import { CreationExecutionReceiptSchema } from "./creation.js";
import { AgentUsageObservationPageSchema } from "./agent-usage.js";
import { CreativeFunnelRecordSchema } from "./creative-funnel.js";
import {
  CreativePlanningFunnelRecordSchema,
  CreativePlanningAdoptionRecordSchema,
} from "./creative-planning.js";
import { CreativeOutcomeRecordSchema } from "./creative-outcomes.js";

/** A read-only join, never a replacement of the original committed facts. */
export const CreativeExecutionFactSchema = z.discriminatedUnion("family", [
  z
    .object({
      family: z.literal("creative"),
      record: CreativeFunnelRecordSchema,
    })
    .strict(),
  z
    .object({
      family: z.literal("planning"),
      record: CreativePlanningFunnelRecordSchema,
    })
    .strict(),
  z
    .object({
      family: z.literal("outcome"),
      record: CreativeOutcomeRecordSchema,
    })
    .strict(),
  z
    .object({
      family: z.literal("planning-adoption"),
      record: CreativePlanningAdoptionRecordSchema,
    })
    .strict(),
]);
export type CreativeExecutionFact = z.infer<typeof CreativeExecutionFactSchema>;
export const CreativeExecutionRequestSchema = z.discriminatedUnion("family", [
  z
    .object({
      family: z.literal("creative"),
      record: CreativeFunnelRecordSchema.refine(
        (r) => r.fact.kind === "request",
      ),
    })
    .strict(),
  z
    .object({
      family: z.literal("planning"),
      record: CreativePlanningFunnelRecordSchema.refine(
        (r) => r.fact.kind === "request",
      ),
    })
    .strict(),
]);
export type CreativeExecutionRequest = z.infer<
  typeof CreativeExecutionRequestSchema
>;
const projection = z
  .object({
    state: z.enum(["healthy", "catching-up", "retrying", "degraded"]),
    checkpoint: z.number().int().nonnegative(),
  })
  .strict();

export function creativeExecutionFactScope(item: CreativeExecutionFact) {
  return item.family === "outcome" ? item.record : item.record.fact;
}
export function creativeExecutionOperation(
  request: CreativeExecutionRequest,
): string {
  return request.family === "planning"
    ? request.record.fact.operation
    : {
        "novel.chapter": "chapter",
        "adaptation.diagnosis": "adaptation-diagnosis",
        "adaptation.strategy": "adaptation-strategy",
        "adaptation.season-plan": "season-plan",
        "adaptation.script": "episode",
      }[request.record.fact.metric];
}
function ordered(
  records: readonly { cursor: number; eventId: string }[],
  nextCursor?: number,
) {
  return (
    new Set(records.map((r) => r.eventId)).size === records.length &&
    records.every((r, i) => i === 0 || r.cursor < records[i - 1]!.cursor) &&
    (nextCursor === undefined || nextCursor === records.at(-1)?.cursor)
  );
}
export const CreativeExecutionRequestPageSchema = z
  .object({
    projectId: z.string().uuid(),
    historyPolicy: z.literal("recorded-original-requests-only"),
    projection,
    items: z.array(CreativeExecutionRequestSchema).max(100),
    nextCursor: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !ordered(
        value.items.map((i) => i.record),
        value.nextCursor,
      ) ||
      new Set(value.items.map((i) => i.record.fact.workflowId)).size !==
        value.items.length ||
      value.items.some((i) => i.record.fact.projectId !== value.projectId)
    )
      ctx.addIssue({
        code: "custom",
        message: "请求页须保留原项目、唯一原工作流和实际事件游标。",
      });
  });
export type CreativeExecutionRequestPage = z.infer<
  typeof CreativeExecutionRequestPageSchema
>;
const unavailable = ["missing", "unavailable", "read-failed"] as const;
const usage = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("recorded"),
      runId: z.string().uuid(),
      page: AgentUsageObservationPageSchema,
    })
    .strict(),
  ...unavailable.map((state) =>
    z.object({ state: z.literal(state), runId: z.string().uuid() }).strict(),
  ),
]);
export const CreativeWorkflowExecutionSchema = z
  .object({
    format: z.literal("creative-workflow-execution-v1"),
    projectId: z.string().uuid(),
    workflowId: z.string().uuid(),
    request: CreativeExecutionRequestSchema,
    projection,
    facts: z
      .object({
        items: z.array(CreativeExecutionFactSchema).max(100),
        nextCursor: z.number().int().positive().optional(),
      })
      .strict(),
    execution: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("recorded"),
          receipt: CreationExecutionReceiptSchema,
          usage: z.array(usage).max(4),
        })
        .strict(),
      ...unavailable.map((state) =>
        z.object({ state: z.literal(state) }).strict(),
      ),
    ]),
    modelEvidence: z.literal("unknown"),
    qualityState: z.literal("unverified"),
    billingStatus: z.literal("unknown"),
    aggregationPolicy: z.literal("individual-observations-no-totals"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const problem = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      value.request.record.fact.projectId !== value.projectId ||
      value.request.record.fact.workflowId !== value.workflowId ||
      value.facts.items.some((item) => {
        const scope = creativeExecutionFactScope(item);
        const foreignOperation =
          item.family === "creative"
            ? value.request.family !== "creative" ||
              item.record.fact.metric !== value.request.record.fact.metric
            : item.family === "planning" || item.family === "planning-adoption"
              ? value.request.family !== "planning" ||
                item.record.fact.operation !==
                  value.request.record.fact.operation
              : value.request.family === "planning"
                ? item.record.kind !== "novel.planning-adopted"
                : item.record.kind !==
                  {
                    "novel.chapter": "novel.chapter-adopted",
                    "adaptation.diagnosis": "adaptation.diagnosis-adopted",
                    "adaptation.strategy": "adaptation.strategy-adopted",
                    "adaptation.season-plan": "adaptation.season-plan-adopted",
                    "adaptation.script": "adaptation.script-adopted",
                  }[value.request.record.fact.metric];
        return (
          foreignOperation ||
          scope.projectId !== value.projectId ||
          scope.workflowId !== value.workflowId
        );
      }) ||
      !ordered(
        value.facts.items.map((i) => i.record),
        value.facts.nextCursor,
      )
    )
      problem("原请求和全部历史事实须绑定唯一原工作流、项目和实际分页顺序。");
    if (value.execution.state !== "recorded") return;
    const { receipt, usage: pages } = value.execution;
    const runs = receipt.runs.filter((r) => r.state === "recorded");
    const requestFact = value.request.record.fact;
    const parent =
      requestFact.kind === "request" ? requestFact.parentWorkflowId : undefined;
    if (
      receipt.projectId !== value.projectId ||
      receipt.workflowId !== value.workflowId ||
      receipt.operation !== creativeExecutionOperation(value.request) ||
      receipt.sourceWorkflowId !== parent ||
      pages.length !== runs.length ||
      pages.some((p, i) => p.runId !== runs[i]?.runId)
    )
      problem(
        "运行读取须是原请求的实际尝试和全部已记录阶段，不换最新或漏掉失败阶段。",
      );
    for (const item of pages) {
      if (item.state !== "recorded") continue;
      const run = runs.find((r) => r.runId === item.runId);
      if (!run || run.state !== "recorded") {
        problem("用量没有原阶段运行。");
        continue;
      }
      const page = item.page;
      if (
        page.runId !== run.runId ||
        page.projectId !== value.projectId ||
        page.observationCount < page.items.length ||
        !ordered(
          page.items.map((o) => ({
            eventId: String(o.cursor),
            cursor: o.cursor,
          })),
          page.nextCursor,
        ) ||
        page.items.some(
          (o) =>
            o.runId !== run.runId ||
            o.projectId !== value.projectId ||
            o.sessionId !== run.execution.sessionId ||
            o.engineKind !== run.execution.engineKind,
        )
      )
        problem(
          "用量须来自原项目、阶段、运行、会话和引擎的不可变观测，不混累计口径。",
        );
    }
  });
export type CreativeWorkflowExecution = z.infer<
  typeof CreativeWorkflowExecutionSchema
>;
