import { randomUUID, timingSafeEqual } from "node:crypto";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  DRAMAIP_HTTP_API_VERSION,
  DRAMAIP_PLUGIN_API_VERSION,
  type ProblemDetails,
  type RuntimeInfo,
} from "@dramaip/contracts";
import type {
  Cleanup,
  EventRuntime,
  HttpRouteRegistry,
  RouteContribution,
} from "@dramaip/plugin-api/internal";

interface RuntimeVariables {
  requestId: string;
}

export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "HttpProblem";
  }
}

export function problemDetails(
  problem: HttpProblem,
  requestId: string,
  instance?: string,
): ProblemDetails {
  return {
    type: `https://dramaip.local/problems/${problem.code.toLowerCase()}`,
    title: problem.message,
    status: problem.status,
    detail: problem.message,
    instance,
    code: problem.code,
    traceId: requestId,
    ...(problem.errors ? { errors: problem.errors } : {}),
  };
}

function constantTimeMatches(
  actual: string | undefined,
  expected: string,
): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export interface RuntimeHttpOptions {
  accessToken: string;
  allowedOrigins: readonly string[];
  /**
   * Per-launch credentials for vendor sidecars.  This endpoint is not part of
   * the Client API: it is a private, read-only MCP transport used before an
   * engine has a project-scoped run and therefore deliberately advertises no
   * tools.
   */
  engineMcpTokens?: readonly string[];
  /**
   * Short-lived, run-scoped tokens issued by the agents plugin. They are
   * accepted only by the private read-only MCP boundary, never by /api/v2.
   */
  capabilityGrantAuthorized?(authorization: string | undefined): boolean;
  events: EventRuntime;
  version: string;
  runtimeInfo(): RuntimeInfo | Promise<RuntimeInfo>;
  onDiagnostics(): Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface RuntimeHttp {
  app: OpenAPIHono<{ Variables: RuntimeVariables }>;
  registry: RuntimeRouteRegistry;
  fetch(request: Request): Promise<Response>;
}

export class RuntimeRouteRegistry implements HttpRouteRegistry {
  private readonly contributions = new Map<string, RouteContribution>();

  constructor(readonly app: OpenAPIHono<{ Variables: RuntimeVariables }>) {}

  register(contribution: RouteContribution): Cleanup {
    if (this.contributions.has(contribution.id))
      throw new Error(`duplicate HTTP route contribution: ${contribution.id}`);
    if (contribution.method && contribution.path && contribution.operationId)
      this.app.openAPIRegistry.registerPath({
        method: contribution.method,
        path: contribution.path,
        operationId: contribution.operationId,
        tags: [contribution.pluginId],
        responses: {
          200: {
            description:
              "Response schema is declared by the owning first-party contribution",
          },
        },
      });
    contribution.install(this.app);
    this.contributions.set(contribution.id, contribution);
    return () => {
      this.contributions.delete(contribution.id);
    };
  }

  get routeIds(): readonly string[] {
    return [...this.contributions.keys()];
  }

  get routeContributions(): readonly RouteContribution[] {
    return [...this.contributions.values()];
  }

  get routeDetails(): readonly Omit<RouteContribution, "install">[] {
    return [...this.contributions.values()].map(
      ({ install: _install, ...metadata }) => metadata,
    );
  }
}

const healthRoute = createRoute({
  method: "get",
  path: "/api/v2/health",
  operationId: "system.health",
  responses: {
    200: {
      description: "Runtime health",
      content: {
        "application/json": {
          schema: z.object({
            healthy: z.literal(true),
            version: z.string(),
            apiVersion: z.literal(DRAMAIP_HTTP_API_VERSION),
          }),
        },
      },
    },
  },
});

const versionRoute = createRoute({
  method: "get",
  path: "/api/v2/version",
  operationId: "system.version",
  responses: {
    200: {
      description: "Authenticated runtime and protocol versions",
      content: {
        "application/json": {
          schema: z.object({
            runtimeVersion: z.string(),
            apiVersion: z.literal(DRAMAIP_HTTP_API_VERSION),
            pluginApiVersion: z.literal(DRAMAIP_PLUGIN_API_VERSION),
          }),
        },
      },
    },
  },
});

const capabilitiesRoute = createRoute({
  method: "get",
  path: "/api/v2/capabilities",
  operationId: "system.capabilities",
  responses: {
    200: {
      description: "Authenticated capability map",
      content: {
        "application/json": { schema: z.record(z.string(), z.boolean()) },
      },
    },
  },
});

const runtimeRoute = createRoute({
  method: "get",
  path: "/api/v2/runtime",
  operationId: "system.runtime",
  responses: {
    200: {
      description: "Authenticated effective runtime graph",
      content: {
        "application/json": { schema: z.record(z.string(), z.unknown()) },
      },
    },
  },
});

const diagnosticsRoute = createRoute({
  method: "get",
  path: "/api/v2/system/diagnostics",
  operationId: "system.diagnostics",
  responses: {
    200: {
      description: "Runtime diagnostics",
      content: {
        "application/json": { schema: z.record(z.string(), z.unknown()) },
      },
    },
  },
});

const eventsRoute = createRoute({
  method: "get",
  path: "/api/v2/events",
  operationId: "system.events.subscribe",
  request: {
    query: z.object({
      cursor: z.coerce.number().int().nonnegative().optional(),
    }),
  },
  responses: { 200: { description: "Persistent and realtime event stream" } },
});

export function createRuntimeHttp(options: RuntimeHttpOptions): RuntimeHttp {
  const app = new OpenAPIHono<{ Variables: RuntimeVariables }>();
  const registry = new RuntimeRouteRegistry(app);
  const engineMcpAuthorized = (authorization: string | undefined) =>
    (options.engineMcpTokens ?? []).some((token) =>
      constantTimeMatches(authorization, `Bearer ${token}`),
    ) || options.capabilityGrantAuthorized?.(authorization) === true;
  // Deliberately the only unauthenticated endpoint: it cannot disclose profile,
  // paths, plugins, versions or tokens and is used for connection discovery.
  app.get("/health", (context) =>
    context.json({ healthy: true, apiVersion: DRAMAIP_HTTP_API_VERSION }),
  );
  app.get("/engine/v1/mcp", (context) => {
    if (!engineMcpAuthorized(context.req.header("Authorization")))
      return context.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: "Engine MCP token is invalid" },
        },
        401,
      );
    // Streamable HTTP permits a server not to offer a standalone SSE stream;
    // private Host adapters issue JSON-RPC calls through POST instead.
    return context.body(null, 405);
  });
  app.post("/engine/v1/mcp", async (context) => {
    if (!engineMcpAuthorized(context.req.header("Authorization")))
      return context.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32001, message: "Engine MCP token is invalid" },
        },
        401,
      );
    const request = await context.req.json().catch(() => undefined);
    if (!request || typeof request !== "object" || Array.isArray(request))
      return context.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid JSON-RPC request" },
        },
        400,
      );
    const rpc = request as {
      jsonrpc?: unknown;
      id?: unknown;
      method?: unknown;
      params?: unknown;
    };
    const id = rpc.id ?? null;
    const respond = (result: Record<string, unknown>) =>
      context.json({ jsonrpc: "2.0", id, result });
    if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string")
      return context.json(
        {
          jsonrpc: "2.0",
          id,
          error: { code: -32600, message: "Invalid JSON-RPC request" },
        },
        400,
      );
    if (rpc.method === "notifications/initialized")
      return context.body(null, 202);
    if (rpc.method === "initialize")
      return respond({
        protocolVersion:
          typeof (rpc.params as { protocolVersion?: unknown } | undefined)
            ?.protocolVersion === "string"
            ? (rpc.params as { protocolVersion: string }).protocolVersion
            : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "dramaip-readonly", version: options.version },
      });
    if (rpc.method === "tools/list") return respond({ tools: [] });
    return context.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: "No project-scoped MCP tools are available for this run",
      },
    });
  });
  app.use("/api/v2/*", async (context, next) => {
    if (context.req.method === "OPTIONS") return next();
    const origin = context.req.header("Origin");
    if (origin && !options.allowedOrigins.includes(origin))
      throw new HttpProblem(403, "ORIGIN_FORBIDDEN", "Origin is not allowed");
    const authorization = context.req.header("Authorization");
    if (!constantTimeMatches(authorization, `Bearer ${options.accessToken}`))
      throw new HttpProblem(401, "UNAUTHORIZED", "Runtime token is invalid");
    context.set("requestId", randomUUID());
    await next();
  });
  app.use("/api/v2/*", async (context, next) => {
    await next();
    const origin = context.req.header("Origin");
    if (origin && options.allowedOrigins.includes(origin)) {
      context.header("Access-Control-Allow-Origin", origin);
      context.header("Vary", "Origin");
    }
  });
  app.options("/api/v2/*", (context) => {
    const origin = context.req.header("Origin");
    if (origin && options.allowedOrigins.includes(origin)) {
      context.header("Access-Control-Allow-Origin", origin);
      context.header("Vary", "Origin");
      context.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Idempotency-Key, If-Match",
      );
      context.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
    }
    return context.body(null, 204);
  });
  app.onError(async (error, context) => {
    const requestId = context.get("requestId") ?? randomUUID();
    const problem =
      error instanceof HttpProblem
        ? error
        : new HttpProblem(500, "INTERNAL_ERROR", "Unexpected runtime error");
    return new Response(
      JSON.stringify(problemDetails(problem, requestId, context.req.path)),
      {
        status: problem.status,
        headers: { "Content-Type": "application/problem+json" },
      },
    );
  });
  app.openapi(healthRoute, (context) =>
    context.json({
      healthy: true as const,
      version: options.version,
      apiVersion: DRAMAIP_HTTP_API_VERSION,
    }),
  );
  app.openapi(versionRoute, async (context) => {
    const runtime = await options.runtimeInfo();
    return context.json({
      runtimeVersion: runtime.runtimeVersion,
      apiVersion: DRAMAIP_HTTP_API_VERSION,
      pluginApiVersion: DRAMAIP_PLUGIN_API_VERSION,
    });
  });
  app.openapi(capabilitiesRoute, async (context) =>
    context.json((await options.runtimeInfo()).capabilities),
  );
  app.openapi(runtimeRoute, async (context) =>
    context.json(
      (await options.runtimeInfo()) as unknown as Record<string, unknown>,
    ),
  );
  app.openapi(diagnosticsRoute, async (context) =>
    context.json(await options.onDiagnostics()),
  );
  app.openapi(eventsRoute, async (context) => {
    const query = context.req.valid("query");
    const headerCursor = Number(context.req.header("Last-Event-ID") ?? "0");
    const afterCursor =
      Number.isFinite(headerCursor) && headerCursor > 0
        ? headerCursor
        : (query.cursor ?? 0);
    return streamSSE(context, async (stream) => {
      for (const event of options.events.replay(afterCursor))
        await stream.writeSSE({
          event: event.type,
          id: String(event.cursor),
          data: JSON.stringify(event),
        });
      await new Promise<void>((resolve) => {
        const unsubscribe = options.events.subscribeLive((event) => {
          void stream.writeSSE({
            event: event.type,
            id: event.id,
            data: JSON.stringify(event),
          });
        });
        stream.onAbort(() => {
          void unsubscribe();
          resolve();
        });
      });
    });
  });
  app.doc31("/api/v2/openapi.json", {
    openapi: "3.1.0",
    info: { title: "DramaIP Runtime API", version: options.version },
  });
  return { app, registry, fetch: async (request) => app.fetch(request) };
}
