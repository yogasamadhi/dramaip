import type { Context as HonoContext } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ProblemDetails } from "@dramaip/contracts";

export class ApiProblem extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly errors?: readonly { path: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

export function problemResponse(
  context: HonoContext,
  problem: ApiProblem,
  requestId: string,
): Response {
  const body: ProblemDetails = {
    type: `https://dramaip.local/problems/${problem.code.toLowerCase().replaceAll("_", "-")}`,
    title: titleForStatus(problem.status),
    status: problem.status,
    detail: problem.message,
    instance: new URL(context.req.url).pathname,
    code: problem.code,
    requestId,
    ...(problem.errors ? { errors: [...problem.errors] } : {}),
  };
  return context.json(body, problem.status, {
    "content-type": "application/problem+json",
  });
}

function titleForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 409:
      return "Conflict";
    case 412:
      return "Precondition Failed";
    case 428:
      return "Precondition Required";
    default:
      return status >= 500 ? "Internal Server Error" : "Request Failed";
  }
}

export function requireIfMatch(request: Request, version: number): void {
  const actual = request.headers.get("if-match");
  if (!actual)
    throw new ApiProblem(
      428,
      "IF_MATCH_REQUIRED",
      "If-Match is required for this operation",
    );
  const expected = `"v${version}"`;
  if (actual !== expected) {
    throw new ApiProblem(
      412,
      "VERSION_CONFLICT",
      `resource version changed; expected ${expected}`,
    );
  }
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) {
    throw new ApiProblem(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key is required for this operation",
    );
  }
  if (key.length > 200)
    throw new ApiProblem(
      400,
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency-Key is too long",
    );
  return key;
}
