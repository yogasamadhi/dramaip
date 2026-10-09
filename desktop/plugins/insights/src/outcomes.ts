import { createHash } from "node:crypto";
import {
  NOVEL_REVISION_EVENT,
  NovelRevisionFactSchema,
} from "@dramaip/contracts/insights";
import {
  projectNovelRevision,
  registerNovelRevisionRoute,
} from "./novel-revisions.js";
import { registerCreativeExecutions } from "./executions.js";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema, type DomainEvent } from "@dramaip/contracts";
import {
  CREATIVE_OUTCOME_EVENTS,
  CREATIVE_PLANNING_ADOPTION_EVENTS,
  CREATIVE_PLANNING_FUNNEL_EVENTS,
  CreativePlanningAdoptionFactSchema,
  CreativePlanningFunnelFactSchema,
  CREATIVE_INITIAL_GOAL_EVENT,
  CREATIVE_SOURCE_CONFIRMATION_EVENTS,
  CreativeSourceConfirmationFactSchema,
  CreativeInitialGoalFactSchema,
  CREATIVE_QUALITY_ADOPTION_EVENT,
  CreativeQualityAdoptionFactSchema,
  CREATIVE_FUNNEL_EVENTS,
  CREATIVE_OWNER_REJECTION_EVENT,
  CREATIVE_CONTINUATION_EVENTS,
  CreativeContinuationFactSchema,
  CreativeContinuationGlobalSchema,
  CreativeFunnelFactSchema,
  CreativeOwnerRejectionFactSchema,
  CreativeOutcomeFactSchema,
  CreativeOutcomeKindSchema,
  CreativeOutcomePageSchema,
  CreativeOutcomeRecordSchema,
  CreativeOutcomeSummarySchema,
  type CreativeOutcomeFact,
  type CreativeOutcomeSummary,
} from "@dramaip/contracts/insights";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { projectCreativeFunnel, measureCreativeFunnel } from "./funnel.js";
import {
  projectCreativePlanningAdoption,
  measureCreativePlanningAdoptions,
} from "./planning-adoptions.js";
import {
  projectCreativePlanningFunnel,
  measureCreativePlanningFunnel,
} from "./planning-funnel.js";
import {
  projectCreativeInitialGoal,
  measureCreativeInitialGoals,
} from "./initial-goals.js";
import {
  projectCreativeSourceConfirmation,
  measureCreativeSourceConfirmations,
} from "./source-confirmations.js";
import {
  projectCreativeQualityAdoption,
  measureCreativeQualityAssociations,
} from "./quality-associations.js";
import {
  projectCreativeContinuation,
  measureCreativeContinuation,
  measureGlobalContinuation,
} from "./continuation.js";

export const creativeOutcomeMigration: PluginMigration = {
  id: "insights.0002.creative-outcomes",
  pluginId: "insights",
  version: "3.0.0-alpha.3",
  dependsOn: ["insights.0001.feedback-and-generation"],
  sql: `
    CREATE TABLE insights_creative_outcome_events (
      event_id TEXT PRIMARY KEY, source_cursor INTEGER NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, unit_key TEXT NOT NULL, occurred_at TEXT NOT NULL,
      value_json TEXT NOT NULL
    );
    CREATE INDEX insights_creative_outcome_page ON insights_creative_outcome_events(project_id, source_cursor DESC);
    CREATE TABLE insights_creative_outcome_units (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, unit_key TEXT NOT NULL, first_event_id TEXT NOT NULL,
      first_at TEXT NOT NULL, PRIMARY KEY(project_id, kind, unit_key)
    );
    CREATE INDEX insights_creative_outcome_window ON insights_creative_outcome_units(project_id, first_at, kind);
  `,
};
const CONSUMER = "insights:creative-outcomes.v1";
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The same formal version set is one result across formats, saves and retries. */
export function creativeOutcomeUnitKey(fact: CreativeOutcomeFact): string {
  return digest([
    fact.kind,
    [
      ...new Set(
        fact.formalVersions.map(({ kind, id, version }) =>
          JSON.stringify([kind, id, version]),
        ),
      ),
    ].sort(),
  ]);
}

export function projectCreativeOutcome(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
): void {
  const expected =
    CREATIVE_OUTCOME_EVENTS[event.type as keyof typeof CREATIVE_OUTCOME_EVENTS];
  if (!expected) throw new Error("Unsupported creative outcome event.");
  const fact = CreativeOutcomeFactSchema.parse(event.payload);
  if (
    fact.kind !== expected ||
    event.pluginId !== event.type.split(".")[0] ||
    fact.objectId !== event.aggregateId ||
    (fact.kind === "adaptation.strategy-adopted" &&
      event.aggregateType !== "adaptation-strategy") ||
    (fact.resultStatus === "written" &&
      (event.aggregateType !== "creation" || event.aggregateVersion !== 1)) ||
    (fact.resultStatus === "adopted" &&
      fact.formalVersions[0]!.version !== event.aggregateVersion)
  )
    throw new Error(
      "Creative outcome owner, kind or object does not match its committed envelope.",
    );
  const unitKey = creativeOutcomeUnitKey(fact);
  const record = CreativeOutcomeRecordSchema.parse({
    ...fact,
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    cursor: event.cursor,
    unitKey,
  });
  const existing = tx.get<{ value_json: string }>(
    "SELECT value_json FROM insights_creative_outcome_events WHERE event_id = ? OR source_cursor = ?",
    event.eventId,
    event.cursor,
  );
  if (existing) {
    if (existing.value_json !== JSON.stringify(record))
      throw new Error(
        "A committed outcome event cannot be replaced on replay.",
      );
    return;
  }
  // Projection and dedupe commit together in Insights. The event runtime owns
  // its checkpoint separately; a crash between commits safely replays this fact.
  tx.run(
    "INSERT OR IGNORE INTO insights_creative_outcome_events(event_id, source_cursor, project_id, kind, unit_key, occurred_at, value_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    event.eventId,
    event.cursor,
    fact.projectId,
    fact.kind,
    unitKey,
    event.occurredAt,
    JSON.stringify(record),
  );
  tx.run(
    "INSERT OR IGNORE INTO insights_creative_outcome_units(project_id, kind, unit_key, first_event_id, first_at) VALUES (?, ?, ?, ?, ?)",
    fact.projectId,
    fact.kind,
    unitKey,
    event.eventId,
    event.occurredAt,
  );
}

export function countCreativeOutcomes(
  tx: UnitOfWorkTransaction,
  projectId: string,
  to: string,
): CreativeOutcomeSummary["counts"] {
  const from = new Date(Date.parse(to) - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = tx.all<{ kind: string; total: number; recent: number }>(
    "SELECT kind, COUNT(*) AS total, SUM(CASE WHEN first_at >= ? AND first_at <= ? THEN 1 ELSE 0 END) AS recent FROM insights_creative_outcome_units WHERE project_id = ? GROUP BY kind",
    from,
    to,
    projectId,
  );
  return CreativeOutcomeKindSchema.options.map((kind) => ({
    kind,
    total: rows.find((row) => row.kind === kind)?.total ?? 0,
    lastSevenDays: rows.find((row) => row.kind === kind)?.recent ?? 0,
  }));
}

type Http = {
  req: { param(name: string): string; query(name: string): string | undefined };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
};
const params = z.object({ projectId: z.string().uuid() });
const query = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function registerCreativeOutcomes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
): void {
  context.effect(
    () =>
      context.domainEvents.registerConsumer({
        id: CONSUMER,
        pluginId: "insights",
        critical: false,
        eventTypes: [
          NOVEL_REVISION_EVENT,
          ...Object.values(CREATIVE_PLANNING_ADOPTION_EVENTS),
          ...Object.values(CREATIVE_PLANNING_FUNNEL_EVENTS),
          ...Object.keys(CREATIVE_OUTCOME_EVENTS),
          CREATIVE_INITIAL_GOAL_EVENT,
          ...Object.values(CREATIVE_SOURCE_CONFIRMATION_EVENTS),
          CREATIVE_QUALITY_ADOPTION_EVENT,
          ...Object.values(CREATIVE_FUNNEL_EVENTS),
          CREATIVE_OWNER_REJECTION_EVENT,
          ...Object.values(CREATIVE_CONTINUATION_EVENTS),
        ],
        handle: (event) => {
          if (event.type === NOVEL_REVISION_EVENT) {
            const fact = NovelRevisionFactSchema.parse(event.payload);
            if (!workspace.get(fact.projectId, { includeDeleted: true }))
              return;
            context.uow.execute((tx) => projectNovelRevision(tx, event));
            return;
          }
          const planningBatch = Object.values(
            CREATIVE_PLANNING_ADOPTION_EVENTS,
          ).includes(
            event.type as (typeof CREATIVE_PLANNING_ADOPTION_EVENTS)[keyof typeof CREATIVE_PLANNING_ADOPTION_EVENTS],
          );
          const planningFunnel = Object.values(
            CREATIVE_PLANNING_FUNNEL_EVENTS,
          ).includes(
            event.type as (typeof CREATIVE_PLANNING_FUNNEL_EVENTS)[keyof typeof CREATIVE_PLANNING_FUNNEL_EVENTS],
          );
          if (planningBatch || planningFunnel) {
            const fact = planningBatch
              ? CreativePlanningAdoptionFactSchema.parse(event.payload)
              : CreativePlanningFunnelFactSchema.parse(event.payload);
            if (!workspace.get(fact.projectId, { includeDeleted: true }))
              return;
            context.uow.execute((tx) =>
              planningBatch
                ? projectCreativePlanningAdoption(tx, event)
                : projectCreativePlanningFunnel(tx, event),
            );
            return;
          }
          if (
            Object.values(CREATIVE_SOURCE_CONFIRMATION_EVENTS).includes(
              event.type as (typeof CREATIVE_SOURCE_CONFIRMATION_EVENTS)[keyof typeof CREATIVE_SOURCE_CONFIRMATION_EVENTS],
            )
          ) {
            const fact = CreativeSourceConfirmationFactSchema.parse(
              event.payload,
            );
            // Trash is reversible: a delayed fact must survive until restore.
            // A physically purged project must never be resurrected.
            if (!workspace.get(fact.projectId, { includeDeleted: true }))
              return;
            context.uow.execute((tx) =>
              projectCreativeSourceConfirmation(tx, event),
            );
            return;
          }
          if (event.type === CREATIVE_INITIAL_GOAL_EVENT) {
            const fact = CreativeInitialGoalFactSchema.parse(event.payload);
            if (!workspace.get(fact.projectId, { includeDeleted: true }))
              return;
            context.uow.execute((tx) => projectCreativeInitialGoal(tx, event));
            return;
          }
          if (event.type === CREATIVE_QUALITY_ADOPTION_EVENT) {
            const fact = CreativeQualityAdoptionFactSchema.parse(event.payload);
            if (!workspace.get(fact.projectId, { includeDeleted: true }))
              return;
            context.uow.execute((tx) =>
              projectCreativeQualityAdoption(tx, event),
            );
            return;
          }
          const ownerRejection = event.type === CREATIVE_OWNER_REJECTION_EVENT;
          const funnel =
            ownerRejection ||
            Object.values(CREATIVE_FUNNEL_EVENTS).includes(
              event.type as (typeof CREATIVE_FUNNEL_EVENTS)[keyof typeof CREATIVE_FUNNEL_EVENTS],
            );
          const fact = funnel
            ? ownerRejection
              ? CreativeOwnerRejectionFactSchema.parse(event.payload)
              : CreativeFunnelFactSchema.parse(event.payload)
            : Object.values(CREATIVE_CONTINUATION_EVENTS).includes(
                  event.type as (typeof CREATIVE_CONTINUATION_EVENTS)[keyof typeof CREATIVE_CONTINUATION_EVENTS],
                )
              ? CreativeContinuationFactSchema.parse(event.payload)
              : CreativeOutcomeFactSchema.parse(event.payload);
          // Trash is reversible and must not discard a delayed historical fact.
          // Physical purge still removes the scope and cascades its projection.
          if (!workspace.get(fact.projectId, { includeDeleted: true })) return;
          context.uow.execute((tx) =>
            funnel
              ? projectCreativeFunnel(tx, event)
              : Object.values(CREATIVE_CONTINUATION_EVENTS).includes(
                    event.type as (typeof CREATIVE_CONTINUATION_EVENTS)[keyof typeof CREATIVE_CONTINUATION_EVENTS],
                  )
                ? projectCreativeContinuation(tx, event)
                : projectCreativeOutcome(tx, event),
          );
        },
      }),
    "event:creative-outcomes",
  );
  const failure = (c: Http, status: 400 | 404, detail: string) =>
    c.json(
      {
        type: "https://dramaip.local/problems/creative-outcomes",
        title: detail,
        detail,
        status,
        code: status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
        traceId: crypto.randomUUID(),
      },
      status,
    );
  const respond = (c: Http, value: unknown) => {
    c.header("Cache-Control", "no-store");
    c.header("ETag", `"${digest(value)}"`);
    return c.json(value);
  };
  const projection = (): CreativeOutcomeSummary["projection"] => {
    const diagnostic = context.domainEvents
      .diagnostics()
      .find((item) => item.id === CONSUMER);
    const checkpoint = diagnostic?.checkpoint ?? 0;
    const state = !diagnostic
      ? "degraded"
      : diagnostic.status !== "healthy"
        ? diagnostic.status
        : context.domainEvents.replay(checkpoint, 1).length
          ? "catching-up"
          : "healthy";
    return { state, checkpoint };
  };
  registerCreativeExecutions(context, workspace, projection);
  registerNovelRevisionRoute(context, workspace, projection);
  for (const contribution of [
    defineRouteContribution({
      id: "insights:creative-continuations-summary",
      pluginId: "insights",
      method: "get",
      path: "/api/v2/creative-continuations/summary",
      operationId: "creativeOutcomes.continuationSummary",
      declaration: createRoute({
        method: "get",
        path: "/api/v2/creative-continuations/summary",
        operationId: "creativeOutcomes.continuationSummary",
        tags: ["creative-outcomes"],
        responses: {
          200: {
            description:
              "Local matured project cohorts, never a public quality or retention claim",
            content: {
              "application/json": { schema: CreativeContinuationGlobalSchema },
            },
          },
        },
      }),
      handler: (c: Http) => {
        const health = projection();
        return respond(
          c,
          context.uow.execute((tx) =>
            measureGlobalContinuation(tx, new Date().toISOString(), health),
          ),
        );
      },
    }),
    defineRouteContribution({
      id: "insights:creative-outcomes-summary",
      pluginId: "insights",
      method: "get",
      path: "/api/v2/projects/{projectId}/creative-outcomes/summary",
      operationId: "creativeOutcomes.summary",
      declaration: createRoute({
        method: "get",
        path: "/api/v2/projects/{projectId}/creative-outcomes/summary",
        operationId: "creativeOutcomes.summary",
        tags: ["creative-outcomes"],
        request: { params },
        responses: {
          200: {
            description:
              "Local deduplicated formal results, not a quality score",
            content: {
              "application/json": { schema: CreativeOutcomeSummarySchema },
            },
          },
          404: {
            description: "Project not found",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
        },
      }),
      handler: (c: Http) => {
        const projectId = c.req.param("projectId");
        if (!workspace.get(projectId)) return failure(c, 404, "未找到项目。");
        const to = new Date().toISOString();
        const from = new Date(
          Date.parse(to) - 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const counts = context.uow.execute((tx) =>
          countCreativeOutcomes(tx, projectId, to),
        );
        const diagnostic = context.domainEvents
          .diagnostics()
          .find((item) => item.id === CONSUMER);
        const checkpoint = diagnostic?.checkpoint ?? 0;
        const state = !diagnostic
          ? "degraded"
          : diagnostic.status !== "healthy"
            ? diagnostic.status
            : context.domainEvents.replay(checkpoint, 1).length
              ? "catching-up"
              : "healthy";
        const summary: CreativeOutcomeSummary = {
          projectId,
          asOf: to,
          window: { kind: "rolling-seven-days", from, to },
          projection: { state, checkpoint },
          historyPolicy: "recorded-owner-facts-only",
          funnel: context.uow.execute((tx) =>
            measureCreativeFunnel(tx, projectId),
          ),
          continuation: context.uow.execute((tx) =>
            measureCreativeContinuation(tx, projectId, to),
          ),
          qualityAssociations: context.uow.execute((tx) =>
            measureCreativeQualityAssociations(tx, projectId),
          ),
          goalConfirmations: context.uow.execute((tx) =>
            measureCreativeInitialGoals(tx, projectId),
          ),
          sourceConfirmations: context.uow.execute((tx) =>
            measureCreativeSourceConfirmations(tx, projectId),
          ),
          planningBatches: context.uow.execute((tx) =>
            measureCreativePlanningAdoptions(tx, projectId),
          ),
          planningFunnel: context.uow.execute((tx) =>
            measureCreativePlanningFunnel(tx, projectId),
          ),
          counts,
          unavailable: ["model-usage-and-cost", "narrative-quality-rate"],
        };
        return respond(c, CreativeOutcomeSummarySchema.parse(summary));
      },
    }),
    defineRouteContribution({
      id: "insights:creative-outcomes-list",
      pluginId: "insights",
      method: "get",
      path: "/api/v2/projects/{projectId}/creative-outcomes",
      operationId: "creativeOutcomes.list",
      declaration: createRoute({
        method: "get",
        path: "/api/v2/projects/{projectId}/creative-outcomes",
        operationId: "creativeOutcomes.list",
        tags: ["creative-outcomes"],
        request: { params, query },
        responses: {
          200: {
            description: "Body-free committed owner fact page",
            content: {
              "application/json": { schema: CreativeOutcomePageSchema },
            },
          },
          400: {
            description: "Invalid cursor or limit",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
          404: {
            description: "Project not found",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
        },
      }),
      handler: (c: Http) => {
        const projectId = c.req.param("projectId");
        if (!workspace.get(projectId)) return failure(c, 404, "未找到项目。");
        const input = query.safeParse({
          cursor: c.req.query("cursor"),
          limit: c.req.query("limit") ?? 25,
        });
        if (!input.success) return failure(c, 400, "结果台账分页参数无效。");
        if (
          input.data.cursor !== undefined &&
          !context.uow.execute((tx) =>
            tx.get(
              "SELECT event_id FROM insights_creative_outcome_events WHERE project_id = ? AND source_cursor = ?",
              projectId,
              input.data.cursor,
            ),
          )
        )
          return failure(c, 400, "分页游标不属于当前项目结果台账。");
        const rows = context.uow.execute((tx) =>
          tx.all<{ value_json: string }>(
            "SELECT value_json FROM insights_creative_outcome_events WHERE project_id = ? AND (? IS NULL OR source_cursor < ?) ORDER BY source_cursor DESC LIMIT ?",
            projectId,
            input.data.cursor ?? null,
            input.data.cursor ?? null,
            input.data.limit + 1,
          ),
        );
        const items = rows
          .slice(0, input.data.limit)
          .map((row) =>
            CreativeOutcomeRecordSchema.parse(JSON.parse(row.value_json)),
          );
        return respond(
          c,
          CreativeOutcomePageSchema.parse({
            projectId,
            items,
            ...(rows.length > items.length
              ? { nextCursor: items.at(-1)!.cursor }
              : {}),
          }),
        );
      },
    }),
  ])
    context.effect(
      () => context.http.register(contribution),
      `route:${contribution.id}`,
    );
}
