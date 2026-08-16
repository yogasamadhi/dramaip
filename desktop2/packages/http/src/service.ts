import { randomUUID, timingSafeEqual } from "node:crypto";

import { Service, type Context } from "@deepseek-ai/cordis";
import { OpenAPIHono } from "@hono/zod-openapi";

import type { HttpRouteRegistry, RouteContribution } from "@dramaip/plugin-api";

import { ApiProblem, problemResponse } from "./problem.ts";

export interface HttpHostConfig {
  username: string;
  password: string;
  allowedOrigins: readonly string[];
  internalBearerPath?: string;
  internalBearerTokens?: readonly string[];
}

interface Variables {
  requestId: string;
}

function secretEquals(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function decodeBasic(header: string | undefined): [string, string] | undefined {
  if (!header?.startsWith("Basic ")) return;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return;
    return [decoded.slice(0, separator), decoded.slice(separator + 1)];
  } catch {
    return;
  }
}

function decodeBearer(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return;
  const token = header.slice(7);
  return token || undefined;
}

export class HttpHostService extends Service implements HttpRouteRegistry {
  static provide = "http";

  private readonly contributions = new Map<string, RouteContribution>();
  private active: OpenAPIHono<{ Variables: Variables }>;

  constructor(
    ctx: Context,
    private readonly config: HttpHostConfig,
  ) {
    super(ctx, "http");
    this.active = this.buildSnapshot();
  }

  register(contribution: RouteContribution): () => Promise<void> {
    if (this.contributions.has(contribution.id)) {
      throw new Error(`duplicate HTTP route contribution: ${contribution.id}`);
    }
    this.contributions.set(contribution.id, contribution);
    this.rebuild();
    let disposed = false;
    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      this.contributions.delete(contribution.id);
      this.rebuild();
    };
    this.ctx.effect(() => dispose, `http.routes:${contribution.id}`);
    return dispose;
  }

  fetch(request: Request): Response | Promise<Response> {
    return this.active.fetch(request);
  }

  openapiDocument(): Record<string, unknown> {
    return this.active.getOpenAPIDocument({
      openapi: "3.1.0",
      info: { title: "DramaIP Studio Next API", version: "2.0.0" },
    }) as unknown as Record<string, unknown>;
  }

  private rebuild(): void {
    const next = this.buildSnapshot();
    for (const contribution of this.contributions.values())
      contribution.install(next);
    this.active = next;
  }

  private buildSnapshot(): OpenAPIHono<{ Variables: Variables }> {
    const app = new OpenAPIHono<{ Variables: Variables }>({
      defaultHook(result, context) {
        if (result.success) return;
        const errors = result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }));
        return problemResponse(
          context,
          new ApiProblem(
            400,
            "VALIDATION_FAILED",
            "request validation failed",
            errors,
          ),
          context.get("requestId") || randomUUID(),
        );
      },
    });
    app.use("*", async (context, next) => {
      const requestId =
        context.req.header("x-request-id")?.slice(0, 128) || randomUUID();
      context.set("requestId", requestId);
      context.header("x-request-id", requestId);

      const origin = context.req.header("origin");
      if (origin && !this.config.allowedOrigins.includes(origin)) {
        return problemResponse(
          context,
          new ApiProblem(
            403,
            "ORIGIN_FORBIDDEN",
            "request origin is not allowed",
          ),
          requestId,
        );
      }
      if (origin) {
        context.header("access-control-allow-origin", origin);
        context.header("vary", "Origin");
        context.header(
          "access-control-expose-headers",
          "ETag, Location, X-Request-Id, Content-Disposition",
        );
      }
      if (context.req.method === "OPTIONS") {
        context.header(
          "access-control-allow-methods",
          "GET, POST, PATCH, DELETE, OPTIONS",
        );
        context.header(
          "access-control-allow-headers",
          "Authorization, Content-Type, If-Match, Idempotency-Key, X-Request-Id, Last-Event-ID",
        );
        context.header("access-control-max-age", "600");
        return context.body(null, 204);
      }

      const authorization = context.req.header("authorization");
      const internalBearer =
        context.req.path === this.config.internalBearerPath
          ? decodeBearer(authorization)
          : undefined;
      const internalAuthorized = Boolean(
        internalBearer &&
        this.config.internalBearerTokens?.some((token) =>
          secretEquals(internalBearer, token),
        ),
      );
      const credentials = decodeBasic(authorization);
      if (
        !internalAuthorized &&
        (!credentials ||
          !secretEquals(credentials[0], this.config.username) ||
          !secretEquals(credentials[1], this.config.password))
      ) {
        context.header("www-authenticate", 'Basic realm="DramaIP Studio Next"');
        return problemResponse(
          context,
          new ApiProblem(
            401,
            "AUTH_REQUIRED",
            "valid launch credentials are required",
          ),
          requestId,
        );
      }
      await next();
    });
    app.notFound((context) =>
      problemResponse(
        context,
        new ApiProblem(
          404,
          "ROUTE_NOT_FOUND",
          "the requested API resource does not exist",
        ),
        context.get("requestId") || randomUUID(),
      ),
    );
    app.onError((error, context) => {
      const problem =
        error instanceof ApiProblem
          ? error
          : new ApiProblem(
              500,
              "INTERNAL_ERROR",
              "an unexpected server error occurred",
            );
      return problemResponse(
        context,
        problem,
        context.get("requestId") || randomUUID(),
      );
    });
    return app;
  }
}
