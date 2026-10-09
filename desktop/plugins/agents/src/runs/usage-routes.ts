import { z } from "zod";
import { createRoute } from "@hono/zod-openapi";
import {
  AgentUsageObservationPageSchema,
  ProblemDetailsSchema,
} from "@dramaip/contracts";
import {
  defineRouteContribution,
  type PluginContext,
} from "@dramaip/plugin-api/internal";
import type { AgentRouteContext } from "../internal/shared.js";
import {
  AgentUsageCursorError,
  AgentUsageIntegrityError,
  readAgentUsagePage,
} from "./usage.js";
import {
  AgentUsageBlindError,
  readAuxiliaryUsagePage,
} from "./auxiliary-usage.js";

const params = z.object({ runId: z.string().min(1) });
const query = z.object({
  projectId: z.string().min(1).optional(),
  cursor: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
function failure(
  c: AgentRouteContext,
  status: 400 | 404 | 409 | 503,
  detail: string,
) {
  return c.newResponse(
    JSON.stringify({
      type: "https://dramaip.local/problems/agent-usage-scope",
      title: "Usage observation unavailable",
      status,
      detail,
      code:
        status === 400
          ? "AGENT_USAGE_CURSOR_INVALID"
          : status === 404
            ? "AGENT_USAGE_NOT_FOUND"
            : status === 409
              ? "AGENT_USAGE_NOT_REVEALED"
              : "AGENT_USAGE_UNVERIFIABLE",
      traceId: crypto.randomUUID(),
    }),
    status,
    { "Content-Type": "application/problem+json" },
  );
}
export function agentUsageRoutes(context: PluginContext) {
  return [
    defineRouteContribution({
      id: "agents:usage-observations-list",
      pluginId: "agents",
      method: "get",
      path: "/api/v2/agent-runs/{runId}/usage-observations",
      operationId: "agentUsageObservations.list",
      declaration: createRoute({
        method: "get",
        path: "/api/v2/agent-runs/{runId}/usage-observations",
        operationId: "agentUsageObservations.list",
        tags: ["agents"],
        request: { params, query },
        responses: {
          200: {
            description:
              "Sanitized engine observations, never billing or certified totals",
            content: {
              "application/json": { schema: AgentUsageObservationPageSchema },
            },
          },
          400: {
            description: "Invalid run-scoped cursor",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
          404: {
            description: "Run absent from requested project or global scope",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
          503: {
            description: "Stored observation cannot be verified",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
          409: {
            description: "Evaluation has not been explicitly revealed",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
        },
      }),
      handler: (c: AgentRouteContext) => {
        const input = query.safeParse({
          projectId: c.req.query("projectId"),
          cursor: c.req.query("cursor"),
          limit: c.req.query("limit"),
        });
        if (!input.success) return failure(c, 400, "用量分页参数无效。");
        try {
          const value = context.uow.execute(
            (tx) =>
              readAgentUsagePage(
                tx,
                c.req.param("runId"),
                input.data.projectId,
                input.data.cursor,
                input.data.limit,
              ) ??
              readAuxiliaryUsagePage(
                tx,
                c.req.param("runId"),
                input.data.projectId,
                input.data.cursor,
                input.data.limit,
              ),
          );
          return value
            ? c.json(value)
            : failure(c, 404, "当前项目或全局范围未找到该运行。");
        } catch (error) {
          if (error instanceof AgentUsageCursorError)
            return failure(c, 400, error.message);
          if (error instanceof AgentUsageIntegrityError)
            return failure(c, 503, error.message);
          if (error instanceof AgentUsageBlindError)
            return failure(c, 409, error.message);
          throw error;
        }
      },
    }),
  ];
}
