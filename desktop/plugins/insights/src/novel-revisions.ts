import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema, type DomainEvent } from "@dramaip/contracts";
import {
  NOVEL_REVISION_EVENT,
  NovelRevisionRecordSchema,
  NovelRevisionEffortPageSchema,
  CreativeFunnelRecordSchema,
  CreativeOutcomeRecordSchema,
  measureNovelRevisionEffort,
  canonicalCreativeMetricJSON,
  type NovelRevisionEffortPage,
} from "@dramaip/contracts/insights";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  type PluginMigration,
  type PluginContext,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
export const novelRevisionMigration: PluginMigration = {
  id: "insights.0010.novel-revision-observations",
  pluginId: "insights",
  version: "3.0.0-alpha.4",
  dependsOn: ["insights.0009.planning-adoptions"],
  sql: `CREATE TABLE insights_novel_revision_events (
    event_id TEXT PRIMARY KEY, source_cursor INTEGER NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL,preview_id TEXT NOT NULL,sequence INTEGER NOT NULL,value_json TEXT NOT NULL,
    UNIQUE(preview_id,sequence)
  ); CREATE INDEX insights_novel_revision_project ON insights_novel_revision_events(project_id,source_cursor);`,
};
export function projectNovelRevision(
  tx: UnitOfWorkTransaction,
  event: DomainEvent,
) {
  const record = NovelRevisionRecordSchema.parse({
      fact: event.payload,
      eventId: event.eventId,
      cursor: event.cursor,
      occurredAt: event.occurredAt,
    }),
    f = record.fact;
  if (
    event.type !== NOVEL_REVISION_EVENT ||
    event.pluginId !== "automation" ||
    event.aggregateType !== "change-preview" ||
    event.aggregateId !== f.previewId ||
    event.aggregateVersion !== f.sequence
  )
    throw new Error(
      "Revision facts require their exact original Automation envelope.",
    );
  const prior = tx.get<{ value_json: string }>(
    "SELECT value_json FROM insights_novel_revision_events WHERE event_id=? OR source_cursor=? OR (preview_id=? AND sequence=?)",
    event.eventId,
    event.cursor,
    f.previewId,
    f.sequence,
  );
  if (prior) {
    const old = NovelRevisionRecordSchema.parse(JSON.parse(prior.value_json));
    if (
      canonicalCreativeMetricJSON(old.fact) !==
        canonicalCreativeMetricJSON(f) ||
      ((old.eventId === event.eventId || old.cursor === event.cursor) &&
        canonicalCreativeMetricJSON(old) !==
          canonicalCreativeMetricJSON(record))
    )
      throw new Error(
        "An original saved revision cannot be replaced on replay.",
      );
    return;
  }
  const request = tx.get<{ value_json: string }>(
    "SELECT value_json FROM insights_creative_funnel_events WHERE project_id=? AND workflow_id=? AND json_extract(value_json,'$.fact.kind')='request'",
    f.projectId,
    f.workflowId,
  );
  const q =
    request && CreativeFunnelRecordSchema.parse(JSON.parse(request.value_json));
  if (
    !q ||
    q.fact.metric !== "novel.chapter" ||
    q.fact.targetKey !== f.targetKey ||
    q.cursor >= event.cursor ||
    q.fact.workflowVersion > f.workflowVersion
  )
    throw new Error(
      "A saved revision requires its exact earlier original request.",
    );
  tx.run(
    "INSERT INTO insights_novel_revision_events VALUES (?,?,?,?,?,?,?)",
    event.eventId,
    event.cursor,
    f.projectId,
    f.workflowId,
    f.previewId,
    f.sequence,
    JSON.stringify(record),
  );
}
interface Http {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
  };
  json(value: unknown, status?: number): Response;
}
export function registerNovelRevisionRoute(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  projection: () => NovelRevisionEffortPage["projection"],
) {
  const path = "/api/v2/projects/{projectId}/creative-outcomes/revision-effort";
  const query = z.object({
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  const reject = (c: Http, status: number) => {
    const response = c.json(
      ProblemDetailsSchema.parse({
        type: "https://dramaip.local/problems/revision-effort",
        status,
        title: "原修订观察无法完整核对；不显示旧结果或推定零修订。",
        code:
          status === 404
            ? "NOT_FOUND"
            : status === 400
              ? "VALIDATION_ERROR"
              : status === 409
                ? "CONFLICT"
                : "REVISION_HISTORY_UNAVAILABLE",
        traceId: crypto.randomUUID(),
      }),
      status,
    );
    response.headers.set("Content-Type", "application/problem+json");
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  const contribution = defineRouteContribution({
    id: "insights:novel-revision-effort",
    pluginId: "insights",
    method: "get",
    path,
    operationId: "creativeOutcomes.revisionEffort",
    declaration: createRoute({
      method: "get",
      path,
      operationId: "creativeOutcomes.revisionEffort",
      tags: ["creative-outcomes"],
      request: { params: z.object({ projectId: z.string().uuid() }), query },
      responses: {
        200: {
          description: "Original saved revision observations",
          content: {
            "application/json": { schema: NovelRevisionEffortPageSchema },
          },
        },
        ...Object.fromEntries(
          [400, 404, 409, 503].map((s) => [
            s,
            {
              description: "Original observation unavailable",
              content: {
                "application/problem+json": { schema: ProblemDetailsSchema },
              },
            },
          ]),
        ),
      },
    }),
    handler: (c: Http) => {
      const projectId = c.req.param("projectId");
      if (!workspace.get(projectId)) return reject(c, 404);
      const input = query.safeParse({
        cursor: c.req.query("cursor"),
        limit: c.req.query("limit") ?? 25,
      });
      if (!input.success) return reject(c, 400);
      const health = projection();
      let last: string | undefined;
      if (input.data.cursor) {
        try {
          const cursor = z
            .object({
              projectId: z.string().uuid(),
              checkpoint: z.number().int().nonnegative(),
              targetKey: z.string().regex(/^[a-f0-9]{64}$/u),
            })
            .strict()
            .parse(
              JSON.parse(
                Buffer.from(input.data.cursor, "base64url").toString("utf8"),
              ),
            );
          if (cursor.projectId !== projectId) return reject(c, 400);
          if (cursor.checkpoint !== health.checkpoint) return reject(c, 409);
          last = cursor.targetKey;
        } catch {
          return reject(c, 400);
        }
      }
      try {
        const measures = context.uow.execute((tx) => {
          const rows = (
            table:
              | "insights_creative_funnel_events"
              | "insights_creative_outcome_events"
              | "insights_novel_revision_events",
          ) => {
            const result = tx.all<{
              event_id: string;
              project_id: string;
              value_json: string;
              source_cursor: number;
            }>(
              `SELECT event_id,project_id,value_json,source_cursor FROM ${table} WHERE project_id=? AND source_cursor<=? ORDER BY source_cursor LIMIT 100001`,
              projectId,
              health.checkpoint,
            );
            if (result.length > 100000)
              throw new Error(
                "The complete recorded revision scope exceeds this reader budget.",
              );
            return result.map((r) => {
              const value =
                table === "insights_creative_funnel_events"
                  ? CreativeFunnelRecordSchema.parse(JSON.parse(r.value_json))
                  : table === "insights_creative_outcome_events"
                    ? CreativeOutcomeRecordSchema.parse(
                        JSON.parse(r.value_json),
                      )
                    : NovelRevisionRecordSchema.parse(JSON.parse(r.value_json));
              const scope = "fact" in value ? value.fact : value;
              if (
                value.eventId !== r.event_id ||
                value.cursor !== r.source_cursor ||
                scope.projectId !== r.project_id ||
                r.project_id !== projectId
              )
                throw new Error(
                  "The saved projection identity cannot be replaced.",
                );
              return value;
            });
          };
          return measureNovelRevisionEffort(
            projectId,
            rows("insights_creative_funnel_events"),
            rows("insights_creative_outcome_events"),
            rows("insights_novel_revision_events"),
          );
        });
        if (last && !measures.some((r) => r.targetKey === last))
          return reject(c, 400);
        const remaining = last
            ? measures.filter((r) => r.targetKey < last)
            : measures,
          items = remaining.slice(0, input.data.limit);
        const value = NovelRevisionEffortPageSchema.parse({
          format: "novel-revision-effort-page-v1",
          projectId,
          projection: health,
          totalTargets: measures.length,
          items,
          ...(remaining.length > items.length
            ? {
                nextCursor: Buffer.from(
                  JSON.stringify({
                    projectId,
                    checkpoint: health.checkpoint,
                    targetKey: items.at(-1)!.targetKey,
                  }),
                ).toString("base64url"),
              }
            : {}),
          policy: "saved-content-changes-before-first-recorded-formal-adoption",
          modelRevisions: "excluded",
          qualityState: "unverified",
        });
        const etag = `"${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
        const response =
          c.req.header("If-None-Match") === etag
            ? new Response(null, { status: 304 })
            : c.json(value);
        response.headers.set("Cache-Control", "no-store");
        response.headers.set("ETag", etag);
        return response;
      } catch {
        return reject(c, 503);
      }
    },
  });
  context.effect(
    () => context.http.register(contribution),
    `route:${contribution.id}`,
  );
}
