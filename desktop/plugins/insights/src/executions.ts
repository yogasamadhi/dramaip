import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  AGENT_TASK_RUNNER_SERVICE,
  ProblemDetailsSchema,
} from "@dramaip/contracts";
import {
  CREATION_WORKFLOW_SERVICE,
  CreationExecutionReceiptSchema,
} from "@dramaip/contracts/creation";
import {
  CreativeExecutionFactSchema,
  CreativeExecutionRequestSchema,
  CreativeExecutionRequestPageSchema,
  CreativeWorkflowExecutionSchema,
  creativeExecutionFactScope,
  type CreativeExecutionFact,
  type CreativeExecutionRequest,
  type CreativeExecutionRequestPage,
  type CreativeWorkflowExecution,
} from "@dramaip/contracts/insights";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  optionalService,
  type PluginContext,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

// Read Insights' projections only. Never join peer tables or call an owner
// service while holding Insights' UoW (the shared database forbids nesting).
const requestsSql = `
 SELECT 'creative' AS family, event_id, source_cursor, project_id, workflow_id, value_json
 FROM insights_creative_funnel_events WHERE json_extract(value_json,'$.fact.kind')='request'
 UNION ALL
 SELECT 'planning',event_id,source_cursor,project_id,workflow_id,value_json
 FROM insights_creative_planning_funnel WHERE json_extract(value_json,'$.fact.kind')='request'`;
const factsSql = `
 SELECT 'creative' AS family,event_id,source_cursor,project_id,workflow_id,value_json
 FROM insights_creative_funnel_events
 UNION ALL SELECT 'planning',event_id,source_cursor,project_id,workflow_id,value_json
 FROM insights_creative_planning_funnel
 UNION ALL SELECT 'outcome',event_id,source_cursor,project_id,json_extract(value_json,'$.workflowId'),value_json
 FROM insights_creative_outcome_events
 UNION ALL SELECT 'planning-adoption',event_id,source_cursor,project_id,workflow_id,record_json
 FROM insights_creative_planning_adoptions`;
interface Row {
  family: string;
  event_id: string;
  source_cursor: number;
  project_id: string;
  workflow_id: string;
  value_json: string;
}
function parseRow(
  row: Row,
  projectId: string,
  workflowId?: string,
): CreativeExecutionFact {
  const item = CreativeExecutionFactSchema.parse({
    family: row.family,
    record: JSON.parse(row.value_json),
  });
  const scope = creativeExecutionFactScope(item);
  if (
    scope.projectId !== projectId ||
    row.project_id !== projectId ||
    scope.workflowId !== row.workflow_id ||
    (workflowId !== undefined && scope.workflowId !== workflowId) ||
    item.record.eventId !== row.event_id ||
    item.record.cursor !== row.source_cursor
  )
    throw new Error("Original projection scope or envelope changed.");
  return item;
}
function originalRequest(
  tx: UnitOfWorkTransaction,
  projectId: string,
  workflowId: string,
): CreativeExecutionRequest | undefined {
  const rows = tx.all<Row>(
    `SELECT * FROM (${requestsSql}) WHERE project_id=? AND workflow_id=?`,
    projectId,
    workflowId,
  );
  if (rows.length > 1)
    throw new Error("Original workflow request is not unique.");
  return rows[0]
    ? CreativeExecutionRequestSchema.parse(
        parseRow(rows[0], projectId, workflowId),
      )
    : undefined;
}
const query = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
type Http = {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
  };
  header(name: string, value: string): void;
  body(value: null, status: 304): Response;
  json(value: unknown, status?: number): Response;
};

export function registerCreativeExecutions(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  projection: () => CreativeExecutionRequestPage["projection"],
): void {
  const failure = (c: Http, status: 400 | 404 | 503) =>
    c.json(
      {
        type: "https://dramaip.local/problems/creative-executions",
        title:
          status === 400
            ? "原运行台账分页参数无效。"
            : status === 404
              ? "未找到当前项目的已记录原请求。"
              : "原台账归属无法核对；没有改用最新记录。",
        status,
        code:
          status === 400
            ? "VALIDATION_ERROR"
            : status === 404
              ? "NOT_FOUND"
              : "SERVICE_UNAVAILABLE",
        traceId: crypto.randomUUID(),
      },
      status,
    );
  const respond = (c: Http, value: unknown) => {
    const etag = `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
    c.header("Cache-Control", "no-store");
    c.header("ETag", etag);
    return c.req.header("If-None-Match") === etag
      ? c.body(null, 304)
      : c.json(value);
  };
  const responses = (
    schema:
      | typeof CreativeExecutionRequestPageSchema
      | typeof CreativeWorkflowExecutionSchema,
  ) => ({
    200: {
      description:
        "Body-free original workflow association, not quality or billing proof",
      content: { "application/json": { schema } },
    },
    304: { description: "Unchanged exact original ledger" },
    ...Object.fromEntries(
      [400, 404, 503].map((status) => [
        status,
        {
          description:
            "Invalid scope, cursor or unreadable original projection",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
      ]),
    ),
  });
  const listPath = "/api/v2/projects/{projectId}/creative-outcomes/executions";
  const detailPath = `${listPath}/{workflowId}`;
  const list = defineRouteContribution({
    id: "insights:creative-executions-list",
    pluginId: "insights",
    method: "get",
    path: listPath,
    operationId: "creativeOutcomes.executions",
    declaration: createRoute({
      method: "get",
      path: listPath,
      operationId: "creativeOutcomes.executions",
      tags: ["creative-outcomes"],
      request: { params: z.object({ projectId: z.string().uuid() }), query },
      responses: responses(CreativeExecutionRequestPageSchema),
    }),
    handler: (c: Http) => {
      const projectId = c.req.param("projectId");
      if (!workspace.get(projectId)) return failure(c, 404);
      const input = query.safeParse({
        cursor: c.req.query("cursor"),
        limit: c.req.query("limit") ?? 25,
      });
      if (!input.success) return failure(c, 400);
      try {
        const { cursor, limit } = input.data;
        const result = context.uow.execute((tx) => {
          if (
            cursor !== undefined &&
            !tx.get(
              `SELECT event_id FROM (${requestsSql}) WHERE project_id=? AND source_cursor=?`,
              projectId,
              cursor,
            )
          )
            return undefined;
          const rows = tx.all<Row>(
            `SELECT * FROM (${requestsSql}) WHERE project_id=? AND (? IS NULL OR source_cursor<?) ORDER BY source_cursor DESC LIMIT ?`,
            projectId,
            cursor ?? null,
            cursor ?? null,
            limit + 1,
          );
          const items = rows
            .slice(0, limit)
            .map((row) =>
              CreativeExecutionRequestSchema.parse(parseRow(row, projectId)),
            );
          // A duplicate request on another page is also a damaged ledger.
          for (const item of items)
            originalRequest(tx, projectId, item.record.fact.workflowId);
          return {
            items,
            ...(rows.length > limit
              ? { nextCursor: items.at(-1)!.record.cursor }
              : {}),
          };
        });
        return result
          ? respond(
              c,
              CreativeExecutionRequestPageSchema.parse({
                projectId,
                historyPolicy: "recorded-original-requests-only",
                projection: projection(),
                ...result,
              }),
            )
          : failure(c, 400);
      } catch {
        return failure(c, 503);
      }
    },
  });
  const detail = defineRouteContribution({
    id: "insights:creative-execution-detail",
    pluginId: "insights",
    method: "get",
    path: detailPath,
    operationId: "creativeOutcomes.execution",
    declaration: createRoute({
      method: "get",
      path: detailPath,
      operationId: "creativeOutcomes.execution",
      tags: ["creative-outcomes"],
      request: {
        params: z.object({
          projectId: z.string().uuid(),
          workflowId: z.string().uuid(),
        }),
        query,
      },
      responses: responses(CreativeWorkflowExecutionSchema),
    }),
    handler: (c: Http) => {
      const projectId = c.req.param("projectId"),
        workflowId = c.req.param("workflowId");
      if (!workspace.get(projectId)) return failure(c, 404);
      const input = query.safeParse({
        cursor: c.req.query("cursor"),
        limit: c.req.query("limit") ?? 25,
      });
      if (!input.success) return failure(c, 400);
      try {
        const { cursor, limit } = input.data;
        const saved = context.uow.execute((tx) => {
          const request = originalRequest(tx, projectId, workflowId);
          if (!request) return { kind: "missing" as const };
          if (
            cursor !== undefined &&
            !tx.get(
              `SELECT event_id FROM (${factsSql}) WHERE project_id=? AND workflow_id=? AND source_cursor=?`,
              projectId,
              workflowId,
              cursor,
            )
          )
            return { kind: "cursor" as const };
          const rows = tx.all<Row>(
            `SELECT * FROM (${factsSql}) WHERE project_id=? AND workflow_id=? AND (? IS NULL OR source_cursor<?) ORDER BY source_cursor DESC LIMIT ?`,
            projectId,
            workflowId,
            cursor ?? null,
            cursor ?? null,
            limit + 1,
          );
          const items = rows
            .slice(0, limit)
            .map((row) => parseRow(row, projectId, workflowId));
          return {
            kind: "recorded" as const,
            request,
            facts: {
              items,
              ...(rows.length > limit
                ? { nextCursor: items.at(-1)!.record.cursor }
                : {}),
            },
          };
        });
        if (saved.kind !== "recorded")
          return failure(c, saved.kind === "cursor" ? 400 : 404);
        // All consumer reads are finished before calling the independent owners.
        const workflow = optionalService(context, CREATION_WORKFLOW_SERVICE);
        const agents = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
        let execution: CreativeWorkflowExecution["execution"] = {
          state: "unavailable",
        };
        if (workflow?.execution) {
          try {
            const raw = workflow.execution(workflowId, projectId);
            if (!raw) execution = { state: "missing" };
            else {
              const receipt = CreationExecutionReceiptSchema.parse(raw);
              // Validate the complete owner receipt before passing run IDs to a
              // second owner. Never expose a foreign result on an error branch.
              CreativeWorkflowExecutionSchema.parse({
                format: "creative-workflow-execution-v1",
                projectId,
                workflowId,
                request: saved.request,
                projection: projection(),
                facts: saved.facts,
                execution: {
                  state: "recorded",
                  receipt,
                  usage: receipt.runs
                    .filter((r) => r.state === "recorded")
                    .map((r) => ({ state: "unavailable", runId: r.runId })),
                },
                modelEvidence: "unknown",
                qualityState: "unverified",
                billingStatus: "unknown",
                aggregationPolicy: "individual-observations-no-totals",
              });
              const usage: Extract<
                CreativeWorkflowExecution["execution"],
                { state: "recorded" }
              >["usage"] = receipt.runs
                .filter((r) => r.state === "recorded")
                .map((run) => {
                  if (!agents?.usage)
                    return { state: "unavailable", runId: run.runId };
                  try {
                    const page = agents.usage(
                      run.runId,
                      projectId,
                      undefined,
                      25,
                    );
                    if (!page) return { state: "missing", runId: run.runId };
                    // Parse in the joined original scope, not merely by row shape.
                    const candidate = {
                      state: "recorded" as const,
                      runId: run.runId,
                      page,
                    };
                    CreativeWorkflowExecutionSchema.parse({
                      format: "creative-workflow-execution-v1",
                      projectId,
                      workflowId,
                      request: saved.request,
                      projection: projection(),
                      facts: saved.facts,
                      execution: {
                        state: "recorded",
                        receipt,
                        usage: receipt.runs
                          .filter((r) => r.state === "recorded")
                          .map((r) =>
                            r.runId === run.runId
                              ? candidate
                              : { state: "unavailable", runId: r.runId },
                          ),
                      },
                      modelEvidence: "unknown",
                      qualityState: "unverified",
                      billingStatus: "unknown",
                      aggregationPolicy: "individual-observations-no-totals",
                    });
                    return candidate;
                  } catch {
                    return { state: "read-failed", runId: run.runId };
                  }
                });
              execution = { state: "recorded", receipt, usage };
            }
          } catch {
            execution = { state: "read-failed" };
          }
        }
        return respond(
          c,
          CreativeWorkflowExecutionSchema.parse({
            format: "creative-workflow-execution-v1",
            projectId,
            workflowId,
            request: saved.request,
            projection: projection(),
            facts: saved.facts,
            execution,
            modelEvidence: "unknown",
            qualityState: "unverified",
            billingStatus: "unknown",
            aggregationPolicy: "individual-observations-no-totals",
          }),
        );
      } catch {
        return failure(c, 503);
      }
    },
  });
  for (const contribution of [list, detail])
    context.effect(
      () => context.http.register(contribution),
      `route:${contribution.id}`,
    );
}
