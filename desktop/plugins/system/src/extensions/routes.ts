import { createRoute } from "@hono/zod-openapi";
import {
  defineRouteContribution,
  type RouteContribution,
  type RoutePolicy,
} from "@dramaip/plugin-api/internal";
import { z } from "zod";
import type { ExtensionPlatform } from "./platform.js";

const JsonResponse = {
  description: "Extension Platform response",
  content: { "application/json": { schema: z.unknown() } },
} as const;
const NoContent = {
  description: "Extension Platform operation completed",
} as const;
const ProblemResponse = {
  description: "Problem Details",
  content: {
    "application/problem+json": {
      schema: z.object({
        type: z.string(),
        title: z.string(),
        status: z.number(),
        code: z.string(),
        traceId: z.string(),
      }),
    },
  },
} as const;

type RequestContext = {
  req: {
    url: string;
    json<T = unknown>(): Promise<T>;
    param(name: string): string;
    header(name: string): string | undefined;
  };
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
};

function endpoint(context: RequestContext): string {
  return new URL("/extensions/v1/capabilities", context.req.url).href;
}

export function extensionPlatformRoutes(
  platform: ExtensionPlatform,
): readonly RouteContribution[] {
  const specifications: readonly {
    id: string;
    method: "delete" | "get" | "patch" | "post" | "put";
    path: `/api/v2/${string}`;
    operationId: string;
    handler(context: RequestContext): Response | Promise<Response>;
    policy?: Partial<RoutePolicy>;
  }[] = [
    {
      id: "system:extensions-installed",
      method: "get",
      path: "/api/v2/system/extensions/installed",
      operationId: "system.extensions.installed",
      handler: (context) => context.json(platform.listInstalled()),
    },
    {
      id: "system:extensions-catalog",
      method: "post",
      path: "/api/v2/system/extensions/catalog",
      operationId: "system.extensions.catalog",
      handler: async (context) =>
        context.json(
          await platform.catalog(
            await context.req.json<{
              registryId: string;
              url: string;
              keyId: string;
              rootPublicKey: string;
            }>(),
          ),
        ),
    },
    {
      id: "system:extensions-install-preview",
      method: "post",
      path: "/api/v2/system/extensions/install-preview",
      operationId: "system.extensions.installPreview",
      handler: async (context) =>
        context.json(
          platform.createPreview(
            await context.req.json<{
              registryId: string;
              pluginId: string;
              version?: string;
            }>(),
          ),
        ),
    },
    {
      id: "system:extensions-install-commit",
      method: "post",
      path: "/api/v2/system/extensions/install-commit",
      operationId: "system.extensions.installCommit",
      policy: { idempotency: "required" },
      handler: async (context) => {
        const input = await context.req.json<{
          previewId: string;
          approvedPermissions: string[];
          approvedPublisherChange?: boolean;
          approvedScopes?: Record<
            string,
            import("@dramaip/contracts").JsonValue
          >;
        }>();
        return context.json(
          await platform.commit(
            input.previewId,
            endpoint(context),
            input.approvedPermissions,
            context.req.header("X-Trace-Id"),
            input.approvedPublisherChange === true,
            input.approvedScopes ?? {},
          ),
        );
      },
    },
    {
      id: "system:extensions-enable",
      method: "post",
      path: "/api/v2/system/extensions/{pluginId}/enable",
      operationId: "system.extensions.enable",
      handler: async (context) =>
        context.json(
          await platform.enable(
            context.req.param("pluginId"),
            endpoint(context),
          ),
        ),
    },
    {
      id: "system:extensions-disable",
      method: "post",
      path: "/api/v2/system/extensions/{pluginId}/disable",
      operationId: "system.extensions.disable",
      handler: async (context) => {
        await platform.disable(context.req.param("pluginId"));
        return context.body(null, 204);
      },
    },
    {
      id: "system:extensions-retry",
      method: "post",
      path: "/api/v2/system/extensions/{pluginId}/retry",
      operationId: "system.extensions.retry",
      handler: async (context) =>
        context.json(
          await platform.retry(
            context.req.param("pluginId"),
            endpoint(context),
          ),
        ),
    },
    {
      id: "system:extensions-rollback",
      method: "post",
      path: "/api/v2/system/extensions/{pluginId}/rollback",
      operationId: "system.extensions.rollback",
      policy: { idempotency: "required" },
      handler: async (context) =>
        context.json(
          await platform.rollback(
            context.req.param("pluginId"),
            endpoint(context),
          ),
        ),
    },
    {
      id: "system:extensions-uninstall",
      method: "delete",
      path: "/api/v2/system/extensions/{pluginId}",
      operationId: "system.extensions.uninstall",
      policy: { idempotency: "required" },
      handler: async (context) => {
        const input = await context.req.json<{
          data: "delete" | "export" | "keep";
        }>();
        return context.json(
          await platform.uninstall(context.req.param("pluginId"), input.data),
        );
      },
    },
    {
      id: "system:extensions-ui",
      method: "get",
      path: "/api/v2/system/extensions/ui-contributions",
      operationId: "system.extensions.uiContributions",
      handler: (context) => context.json(platform.uiContributions()),
    },
    {
      id: "system:extensions-openapi",
      method: "get",
      path: "/api/v2/system/extensions/effective-openapi",
      operationId: "system.extensions.effectiveOpenApi",
      handler: (context) => context.json(platform.effectiveOpenApi()),
    },
    {
      id: "system:extensions-command",
      method: "post",
      path: "/api/v2/system/extensions/{pluginId}/commands/{commandId}",
      operationId: "system.extensions.invokeCommand",
      handler: async (context) =>
        context.json(
          await platform.invokeCommand(
            context.req.param("pluginId"),
            context.req.param("commandId"),
            await context.req.json(),
          ),
        ),
    },
    ...(["delete", "get", "patch", "post", "put"] as const).map((method) => ({
      id: `system:extensions-route-proxy-${method}`,
      method,
      path: "/api/v2/extensions/{pluginId}/*" as const,
      operationId: `system.extensions.invokeRoute.${method}`,
      policy: {
        bodyLimitBytes: 1024 * 1024,
        timeoutMs: 30_000,
        idempotency: method === "get" ? "forbidden" : "optional",
      } as const,
      handler: async (context: RequestContext) => {
        const url = new URL(context.req.url);
        const body = await context.req.json().catch(() => undefined);
        const payload =
          body === undefined
            ? Object.fromEntries(url.searchParams.entries())
            : body;
        return context.json(
          await platform.invokeRouteByPath(
            context.req.param("pluginId"),
            method,
            `/${context.req.param("*")}`,
            payload,
          ),
        );
      },
    })),
  ];

  return specifications.map((specification) => {
    const declaration = createRoute({
      method: specification.method,
      path: specification.path,
      operationId: specification.operationId,
      responses: {
        200: JsonResponse,
        204: NoContent,
        400: ProblemResponse,
        401: ProblemResponse,
        403: ProblemResponse,
        404: ProblemResponse,
        409: ProblemResponse,
        500: ProblemResponse,
        503: ProblemResponse,
      },
    } as never);
    return defineRouteContribution({
      id: specification.id,
      pluginId: "system",
      method: specification.method,
      path: specification.path,
      operationId: specification.operationId,
      declaration,
      handler: specification.handler as never,
      policy: specification.policy,
    });
  });
}
