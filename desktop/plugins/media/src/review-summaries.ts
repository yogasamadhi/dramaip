import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z, type ZodType } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  type PluginContext,
} from "@dramaip/plugin-api/internal";

class SummaryError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Media-owned pagination only. Projection runs outside the SQL read transaction. */
export function mediaReviewSummaryRoute<T>(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  input: {
    id: string;
    operationId: string;
    path: `/api/v2/${string}`;
    schema: ZodType;
    table: "media_source_reviews" | "media_audio_revisions";
    project(value: T): unknown;
  },
) {
  return defineRouteContribution({
    id: input.id,
    pluginId: "media",
    method: "get",
    path: input.path,
    operationId: input.operationId,
    declaration: createRoute({
      method: "get",
      path: input.path,
      operationId: input.operationId,
      request: {
        params: z.object({ projectId: z.string().uuid() }),
        query: z.object({
          cursor: z.string().max(1000).optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
      },
      responses: {
        200: {
          description: "Read-only, identity-only Media review summaries",
          content: { "application/json": { schema: input.schema } },
        },
        400: {
          description: "Invalid or foreign cursor",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
        404: {
          description: "Actual project not found",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
      },
    } as never),
    handler: (c: {
      req: {
        param(key: string): string;
        query(key: string): string | undefined;
      };
    }) => {
      try {
        const projectId = c.req.param("projectId");
        if (!workspace.get(projectId))
          throw new SummaryError(404, "未找到实际项目。");
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(c.req.query("limit") ?? 100);
        let after: [string, string] | undefined;
        const cursor = c.req.query("cursor");
        if (cursor) {
          try {
            const parsed = z
              .tuple([
                z.literal(input.operationId),
                z.literal(projectId),
                z.string().datetime(),
                z.string().uuid(),
              ])
              .parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
            after = [parsed[2], parsed[3]];
          } catch {
            throw new SummaryError(400, "游标无效或不属于本项目／领域。");
          }
        }
        const rows = context.uow.execute((tx) => {
          if (after) {
            const actual = tx.get<{ created_at: string }>(
              `SELECT created_at FROM ${input.table} WHERE id = ? AND json_extract(value_json, '$.projectId') = ?`,
              after[1],
              projectId,
            );
            if (actual?.created_at !== after[0])
              throw new SummaryError(400, "游标不再对应本项目的实际记录。");
          }
          return tx.all<{ id: string; created_at: string; value_json: string }>(
            `SELECT id,created_at,value_json FROM ${input.table} WHERE json_extract(value_json, '$.projectId') = ? ${after ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
            projectId,
            ...(after ? [after[0], after[0], after[1]] : []),
            limit + 1,
          );
        });
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        const body = JSON.stringify({
          items: page.map((row) =>
            input.project(JSON.parse(row.value_json) as T),
          ),
          ...(rows.length > limit && last
            ? {
                nextCursor: Buffer.from(
                  JSON.stringify([
                    input.operationId,
                    projectId,
                    last.created_at,
                    last.id,
                  ]),
                ).toString("base64url"),
              }
            : {}),
        });
        return new Response(body, {
          headers: {
            "Content-Type": "application/json",
            ETag: `"${createHash("sha256").update(body).digest("hex")}"`,
          },
        });
      } catch (error) {
        if (!(error instanceof SummaryError) && !(error instanceof z.ZodError))
          throw error;
        const status = error instanceof SummaryError ? error.status : 400;
        return new Response(
          JSON.stringify({
            type: "about:blank",
            title:
              status === 404 ? "未找到实际项目。" : "摘要游标或分页条件无效。",
            status,
            code: status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
            traceId: crypto.randomUUID(),
          }),
          { status, headers: { "Content-Type": "application/problem+json" } },
        );
      }
    },
  });
}
