import { z } from "zod";
import { AgentRunExecutionSchema } from "./agent-run-execution.js";
import {
  CreativeExecutionRequestPageSchema,
  CreativeWorkflowExecutionSchema,
  creativeExecutionOperation,
  type CreativeExecutionRequest,
  type CreativeExecutionRequestPage,
  type CreativeWorkflowExecution,
} from "./creative-executions.js";
import {
  CreativeFunnelSummarySchema,
  canonicalCreativeMetricJSON,
} from "./creative-funnel.js";
import { CreativePlanningFunnelSummarySchema } from "./creative-planning.js";
import {
  measureCreativeFunnelRecords,
  measureCreativePlanningFunnelRecords,
} from "./creative-funnel-measurement.js";

export const CreativeGeneratingConfigurationSchema = z.discriminatedUnion(
  "state",
  [
    z
      .object({
        state: z.literal("recorded"),
        engineKind: AgentRunExecutionSchema.shape.engineKind,
        model: AgentRunExecutionSchema.shape.model,
      })
      .strict(),
    ...(
      [
        "missing",
        "unavailable",
        "read-failed",
        "missing-generating-run",
        "unobserved-first-request",
      ] as const
    ).map((state) => z.object({ state: z.literal(state) }).strict()),
  ],
);
type Configuration = z.infer<typeof CreativeGeneratingConfigurationSchema>;
const group = {
  configuration: CreativeGeneratingConfigurationSchema,
  workflowIds: z.array(z.string().uuid()).min(1),
  anchorWorkflowIds: z.array(z.string().uuid()).min(1),
};
export const CreativeConfigurationFunnelSchema = z
  .object({
    format: z.literal("creative-configuration-funnel-v1"),
    projectId: z.string().uuid(),
    projection: CreativeExecutionRequestPageSchema.shape.projection,
    historyPolicy: z.literal(
      "complete-pagination-of-recorded-original-requests-only",
    ),
    groupingPolicy: z.literal(
      "first-target-generating-request-fields-retries-do-not-reset",
    ),
    modelEvidence: z.literal("unknown"),
    qualityState: z.literal("unverified"),
    billingStatus: z.literal("unknown"),
    recordedWorkflows: z.number().int().nonnegative(),
    recordedTargets: z.number().int().nonnegative(),
    groups: z.array(
      z.discriminatedUnion("family", [
        z
          .object({
            ...group,
            family: z.literal("creative"),
            summary: CreativeFunnelSummarySchema,
          })
          .strict(),
        z
          .object({
            ...group,
            family: z.literal("planning"),
            summary: CreativePlanningFunnelSummarySchema,
          })
          .strict(),
      ]),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = value.groups.flatMap((g) => g.workflowIds);
    const keys = value.groups.map((g) =>
      canonicalCreativeMetricJSON([g.family, g.configuration]),
    );
    if (
      ids.length !== value.recordedWorkflows ||
      new Set(ids).size !== ids.length ||
      new Set(keys).size !== keys.length ||
      value.groups.reduce(
        (n, g) =>
          n +
          g.summary.measures.reduce((m, row) => m + row.requestedTargets, 0),
        0,
      ) !== value.recordedTargets ||
      value.groups.some(
        (g) =>
          g.anchorWorkflowIds.length !==
            g.summary.measures.reduce(
              (n, row) => n + row.requestedTargets,
              0,
            ) ||
          new Set(g.anchorWorkflowIds).size !== g.anchorWorkflowIds.length ||
          g.anchorWorkflowIds.some((id) => !g.workflowIds.includes(id)) ||
          g.summary.measures.reduce((n, row) => n + row.recordedRequests, 0) !==
            g.workflowIds.length ||
          g.summary.measures.some(
            (row) =>
              row.firstAccepted &&
              !g.workflowIds.includes(row.firstAccepted.workflowId),
          ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "配置组须完整保留唯一原工作流、最初目标和可核漏斗分母。",
      });
  });
export type CreativeConfigurationFunnel = z.infer<
  typeof CreativeConfigurationFunnelSchema
>;
export interface CreativeConfigurationFunnelInput {
  requestPages: readonly CreativeExecutionRequestPage[];
  workflowPages: readonly {
    workflowId: string;
    pages: readonly CreativeWorkflowExecution[];
  }[];
}

/** No network, owner reads or writes. Only complete, exact original SDK pages. */
export function measureCreativeConfigurationFunnel(
  projectId: string,
  input: CreativeConfigurationFunnelInput,
): CreativeConfigurationFunnel {
  const reject = (): never => {
    throw new Error("原配置漏斗读取不完整或归属／检查点变化；请明确重新读取。");
  };
  const requestFact = (r: CreativeExecutionRequest) => {
    const fact = r.record.fact;
    if (fact.kind !== "request") return reject();
    return fact;
  };
  try {
    if (!input.requestPages.length) return reject();
    const requestPages = input.requestPages.map((p) =>
      CreativeExecutionRequestPageSchema.parse(p),
    );
    const projection = requestPages[0]!.projection;
    const checkpoint = canonicalCreativeMetricJSON(projection);
    const sameProjection = (p: CreativeExecutionRequestPage["projection"]) =>
      canonicalCreativeMetricJSON(p) === checkpoint;
    function completePages<T>(
      pages: readonly T[],
      items: (p: T) => readonly { cursor: number; eventId: string }[],
      next: (p: T) => number | undefined,
    ) {
      if (!pages.length) reject();
      let prior = Infinity;
      const seen = new Set<string>();
      pages.forEach((page, i) => {
        if ((next(page) !== undefined) !== i < pages.length - 1) reject();
        if (i > 0 && items(page).length === 0) reject();
        for (const row of items(page)) {
          if (
            row.cursor >= prior ||
            row.cursor > projection.checkpoint ||
            seen.has(row.eventId)
          )
            reject();
          prior = row.cursor;
          seen.add(row.eventId);
        }
        if (next(page) !== undefined && next(page) !== prior) reject();
      });
    }
    if (
      requestPages.some(
        (p) => p.projectId !== projectId || !sameProjection(p.projection),
      )
    )
      reject();
    completePages(
      requestPages,
      (p) => p.items.map((i) => i.record),
      (p) => p.nextCursor,
    );
    const requests = requestPages
      .flatMap((p) => p.items)
      .sort((a, b) => a.record.cursor - b.record.cursor);
    if (
      new Set(requests.map((r) => r.record.fact.workflowId)).size !==
        requests.length ||
      input.workflowPages.length !== requests.length
    )
      reject();
    const ledgers = new Map<
      string,
      {
        first: CreativeWorkflowExecution;
        facts: CreativeWorkflowExecution["facts"]["items"];
      }
    >();
    const allEventIds = new Set<string>(),
      allCursors = new Set<number>();
    for (const item of input.workflowPages) {
      if (ledgers.has(item.workflowId) || !item.pages.length) reject();
      const pages = item.pages.map((p) =>
        CreativeWorkflowExecutionSchema.parse(p),
      );
      const first = pages[0]!;
      const originalFact = requestFact(first.request);
      const original = requests.find(
        (r) => r.record.fact.workflowId === item.workflowId,
      );
      if (
        !original ||
        canonicalCreativeMetricJSON(first.request) !==
          canonicalCreativeMetricJSON(original)
      )
        reject();
      if (
        pages.some(
          (p) =>
            p.projectId !== projectId ||
            p.workflowId !== item.workflowId ||
            !sameProjection(p.projection) ||
            canonicalCreativeMetricJSON(p.request) !==
              canonicalCreativeMetricJSON(first.request) ||
            canonicalCreativeMetricJSON(p.execution) !==
              canonicalCreativeMetricJSON(first.execution),
        )
      )
        reject();
      completePages(
        pages,
        (p) => p.facts.items.map((i) => i.record),
        (p) => p.facts.nextCursor,
      );
      const facts = pages
        .flatMap((p) => p.facts.items)
        .sort((a, b) => a.record.cursor - b.record.cursor);
      const requestFacts = facts.filter(
        (f) =>
          (f.family === "creative" || f.family === "planning") &&
          f.record.fact.kind === "request",
      );
      if (
        requestFacts.length !== 1 ||
        canonicalCreativeMetricJSON(requestFacts[0]) !==
          canonicalCreativeMetricJSON(first.request)
      )
        reject();
      for (const fact of facts) {
        if (
          allEventIds.has(fact.record.eventId) ||
          allCursors.has(fact.record.cursor)
        )
          reject();
        allEventIds.add(fact.record.eventId);
        allCursors.add(fact.record.cursor);
        if (
          (fact.family === "creative" &&
            fact.record.fact.kind !== "owner-rejection" &&
            (fact.record.fact.targetKey !== originalFact.targetKey ||
              fact.record.fact.requestedAt !== originalFact.requestedAt)) ||
          (fact.family === "planning" &&
            (fact.record.fact.targetKey !== originalFact.targetKey ||
              fact.record.fact.requestedAt !== originalFact.requestedAt))
        )
          reject();
        if (
          fact.family === "planning" &&
          first.request.family === "planning" &&
          fact.record.fact.rootWorkflowId !==
            first.request.record.fact.rootWorkflowId
        )
          reject();
      }
      ledgers.set(item.workflowId, { first, facts });
    }
    const targetKey = (r: CreativeExecutionRequest) =>
      canonicalCreativeMetricJSON([
        r.family,
        creativeExecutionOperation(r),
        requestFact(r).targetKey,
      ]);
    const targets = new Map<string, CreativeExecutionRequest[]>();
    for (const request of requests) {
      const key = targetKey(request),
        rows = targets.get(key) ?? [];
      rows.push(request);
      targets.set(key, rows);
    }
    const groups = new Map<
      string,
      {
        family: CreativeExecutionRequest["family"];
        configuration: Configuration;
        workflowIds: string[];
        anchorWorkflowIds: string[];
      }
    >();
    for (const rows of targets.values()) {
      const anchor = rows[0]!,
        fact = requestFact(anchor);
      if (fact.kind !== "request") return reject();
      const execution = ledgers.get(fact.workflowId)!.first.execution;
      let configuration: Configuration;
      if (fact.targetAttempt !== 1 || fact.requestKind !== "new-request")
        configuration = { state: "unobserved-first-request" };
      else if (execution.state !== "recorded")
        configuration = { state: execution.state };
      else {
        const run = execution.receipt.runs.find(
          (r) => r.state === "recorded" && r.phase === "generating",
        );
        configuration =
          run?.state === "recorded"
            ? {
                state: "recorded",
                engineKind: run.execution.engineKind,
                model: { ...run.execution.model },
              }
            : { state: "missing-generating-run" };
      }
      const key = canonicalCreativeMetricJSON([anchor.family, configuration]);
      const grouped = groups.get(key) ?? {
        family: anchor.family,
        configuration,
        workflowIds: [],
        anchorWorkflowIds: [],
      };
      grouped.anchorWorkflowIds.push(fact.workflowId);
      grouped.workflowIds.push(...rows.map((r) => r.record.fact.workflowId));
      groups.set(key, grouped);
    }
    const result = [...groups.values()].map((g) => {
      const facts = g.workflowIds
        .flatMap((id) => ledgers.get(id)!.facts)
        .sort((a, b) => a.record.cursor - b.record.cursor);
      return g.family === "creative"
        ? {
            ...g,
            family: "creative" as const,
            summary: measureCreativeFunnelRecords(
              facts.flatMap((f) => (f.family === "creative" ? [f.record] : [])),
              facts.flatMap((f) => (f.family === "outcome" ? [f.record] : [])),
            ),
          }
        : {
            ...g,
            family: "planning" as const,
            summary: measureCreativePlanningFunnelRecords(
              facts.flatMap((f) => (f.family === "planning" ? [f.record] : [])),
              facts.flatMap((f) =>
                f.family === "planning-adoption" ? [f.record] : [],
              ),
            ),
          };
    });
    return CreativeConfigurationFunnelSchema.parse({
      format: "creative-configuration-funnel-v1",
      projectId,
      projection,
      historyPolicy: "complete-pagination-of-recorded-original-requests-only",
      groupingPolicy:
        "first-target-generating-request-fields-retries-do-not-reset",
      modelEvidence: "unknown",
      qualityState: "unverified",
      billingStatus: "unknown",
      recordedWorkflows: requests.length,
      recordedTargets: targets.size,
      groups: result,
    });
  } catch {
    return reject();
  }
}
