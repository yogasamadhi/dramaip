/**
 * The registry that runs first-party route contributions in process: it
 * matches a Web `Request` to a contribution, applies the route policy
 * (idempotency, concurrency, body limit, timeout), validates the declared
 * request parts and calls the handler with a {@link RouteContext}.
 *
 * A domain controller {@link OperationRegistry.claim | claims} the
 * operations it answers; only {@link OperationRegistry.invoke} reaches a
 * claimed operation. The rest form the served surface
 * {@link OperationRegistry.fetch} dispatches to.
 * @module @dramaip/infra-operations/registry
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  Cleanup,
  HttpRouteRegistry,
  RouteContribution,
} from "@dramaip/plugin-api/internal";
import { compileRoute, runRoute, type CompiledRoute } from "./route.ts";

/** One published set of contributions and its in-flight count. */
interface Snapshot {
  readonly revision: number;
  inFlight: number;
  readonly served: readonly CompiledRoute[];
  readonly claimed: readonly CompiledRoute[];
}

/** What {@link OperationRegistry.diagnostics} reports. */
export interface OperationRegistryDiagnostics {
  reloading: boolean;
  activeRevision: number;
  activeInFlight: number;
  draining: readonly { revision: number; inFlight: number }[];
}

/** A contribution without its declaration and handler. */
export type RouteDetail = Omit<RouteContribution, "declaration" | "handler">;

/**
 * A policy or dispatch problem: RFC 7807 with the problem code.
 * @param status - HTTP status.
 * @param code - problem code, e.g. `ROUTE_TIMEOUT`.
 * @param title - what went wrong.
 */
export function operationProblem(
  status: number,
  code: string,
  title: string,
): Response {
  return Response.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title,
      status,
      code,
      traceId: randomUUID(),
    },
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

function policyFailure(
  contribution: RouteContribution,
  request: Request,
): Response | undefined {
  const idempotency = request.headers.get("Idempotency-Key");
  if (contribution.policy.idempotency === "required" && !idempotency)
    return operationProblem(
      428,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key is required",
    );
  if (contribution.policy.idempotency === "forbidden" && idempotency)
    return operationProblem(
      400,
      "IDEMPOTENCY_KEY_FORBIDDEN",
      "Idempotency-Key is not allowed",
    );
  if (
    contribution.policy.concurrency === "if-match-required" &&
    !request.headers.has("If-Match")
  )
    return operationProblem(428, "IF_MATCH_REQUIRED", "If-Match is required");
  return undefined;
}

/** Runs route contributions; provided to plugins as `http`. */
export class OperationRegistry implements HttpRouteRegistry {
  private readonly contributions = new Map<string, RouteContribution>();
  private readonly idempotentResponses = new Map<
    string,
    { bodyHash: string; response: Response; storedAt: number }
  >();
  private readonly claimedIds = new Set<string>();
  private active: Snapshot = {
    revision: 0,
    inFlight: 0,
    served: [],
    claimed: [],
  };
  private readonly draining = new Set<Snapshot>();
  private published = false;
  private reloading = false;
  private readonly handlerTasks = new Set<Promise<Response>>();

  /** Freeze dispatch and wait for in-flight requests before a reload. */
  async beginReload(timeoutMs: number = 30_000): Promise<void> {
    if (this.reloading) throw new Error("A Runtime reload is already active");
    this.reloading = true;
    this.published = false;
    const deadline = Date.now() + timeoutMs;
    while (this.active.inFlight || this.handlerTasks.size) {
      if (Date.now() >= deadline)
        throw new Error("Runtime reload could not drain active requests");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /**
   * Compile the staged contributions; an invalid declaration throws here,
   * before anything is published.
   * @returns the commit that publishes them.
   */
  prepareReload(): () => void {
    const candidate = this.snapshot();
    return () => {
      this.active = candidate;
      this.published = true;
      this.reloading = false;
    };
  }

  commitReload(): void {
    this.prepareReload()();
    this.reloading = false;
  }

  register(contribution: RouteContribution): Cleanup {
    if (this.contributions.has(contribution.id))
      throw new Error(`duplicate HTTP route contribution: ${contribution.id}`);
    if (!contribution.method || !contribution.path || !contribution.operationId)
      throw new Error(
        `HTTP contribution is not declarative: ${contribution.id}`,
      );
    if (
      !contribution.declaration ||
      !contribution.handler ||
      !contribution.policy
    )
      throw new Error(`HTTP contribution is incomplete: ${contribution.id}`);
    this.contributions.set(contribution.id, contribution);
    if (this.published) this.rebuild();
    return () => {
      this.contributions.delete(contribution.id);
      if (this.published) this.rebuild();
    };
  }

  publish(): void {
    this.published = true;
    this.rebuild();
  }

  /**
   * Take an operation out of the served surface for the domain controller
   * that answers it: only {@link invoke} reaches its handler.
   * @param operationId - the operation.
   * @returns disposer giving it back to the served surface.
   */
  claim(operationId: string): Cleanup {
    this.claimedIds.add(operationId);
    if (this.published) this.rebuild();
    return () => {
      this.claimedIds.delete(operationId);
      if (this.published) this.rebuild();
    };
  }

  /**
   * Run a claimed operation's handler under its route policy.
   * @param operationId - a claimed operation.
   * @param request - the request its handler reads, addressed to its path.
   * @returns the handler's response, or a problem response.
   */
  invoke(operationId: string, request: Request): Promise<Response> {
    if (!this.published)
      return Promise.resolve(
        operationProblem(
          503,
          "RUNTIME_STARTING",
          "Runtime routes are not published yet",
        ),
      );
    return this.dispatch(request, "claimed", operationId);
  }

  /** Dispatch a request to the served (unclaimed) operations. */
  fetch(request: Request): Promise<Response> {
    return this.dispatch(request, "served");
  }

  private async dispatch(
    request: Request,
    surface: "served" | "claimed",
    operationId?: string,
  ): Promise<Response> {
    if (this.reloading)
      return operationProblem(
        503,
        "RUNTIME_RELOADING",
        "Runtime plugins are reloading; retry when the graph is ready",
      );
    const snapshot = this.active;
    const routes =
      surface === "served"
        ? snapshot.served
        : snapshot.claimed.filter(
            (route) => route.contribution.operationId === operationId,
          );
    snapshot.inFlight += 1;
    try {
      const url = new URL(request.url);
      let params: Record<string, string> | undefined;
      const route = routes.find(
        (candidate) => (params = candidate.match(request.method, url)),
      );
      if (!route || !params) {
        if (surface === "claimed")
          return operationProblem(
            404,
            "OPERATION_NOT_CLAIMED",
            "The operation has no claimed route at this path",
          );
        return new Response("404 Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=UTF-8" },
        });
      }
      const { contribution } = route;
      const failure = policyFailure(contribution, request);
      if (failure) return failure;
      const contentLength = Number(
        request.headers.get("Content-Length") ?? "0",
      );
      if (
        Number.isFinite(contentLength) &&
        contentLength > contribution.policy.bodyLimitBytes
      )
        return operationProblem(
          413,
          "BODY_TOO_LARGE",
          "Request body is too large",
        );
      let bodyHash = "";
      const idempotencyKey = request.headers.get("Idempotency-Key");
      const cacheKey =
        idempotencyKey && contribution.policy.idempotencyReplay !== "handler"
          ? `${contribution.operationId}:${idempotencyKey}`
          : undefined;
      if (request.method !== "GET" && request.method !== "HEAD") {
        const bytes = new Uint8Array(await request.clone().arrayBuffer());
        if (bytes.byteLength > contribution.policy.bodyLimitBytes)
          return operationProblem(
            413,
            "BODY_TOO_LARGE",
            "Request body is too large",
          );
        bodyHash = createHash("sha256").update(bytes).digest("hex");
      }
      if (cacheKey) {
        const cached = this.idempotentResponses.get(cacheKey);
        if (cached) {
          if (cached.bodyHash !== bodyHash)
            return operationProblem(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key was reused with a different request",
            );
          return cached.response.clone();
        }
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("Route timed out")),
        contribution.policy.timeoutMs,
      );
      timeout.unref?.();
      let response: Response;
      const handler = runRoute(
        route,
        new Request(request, {
          signal: AbortSignal.any([controller.signal, request.signal]),
        }),
        params,
      );
      this.handlerTasks.add(handler);
      void handler
        .finally(() => this.handlerTasks.delete(handler))
        .catch(() => undefined);
      try {
        response = await Promise.race([
          handler,
          new Promise<Response>((resolve) => {
            controller.signal.addEventListener(
              "abort",
              () =>
                resolve(
                  operationProblem(
                    504,
                    "ROUTE_TIMEOUT",
                    "Route execution timed out",
                  ),
                ),
              { once: true },
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      if (cacheKey && response.status < 500) {
        this.idempotentResponses.set(cacheKey, {
          bodyHash,
          response: response.clone(),
          storedAt: Date.now(),
        });
        this.trimIdempotencyCache();
      }
      return response;
    } finally {
      snapshot.inFlight -= 1;
      if (snapshot.inFlight === 0) this.draining.delete(snapshot);
    }
  }

  diagnostics(): OperationRegistryDiagnostics {
    return {
      reloading: this.reloading,
      activeRevision: this.active.revision,
      activeInFlight: this.active.inFlight,
      draining: [...this.draining].map((entry) => ({
        revision: entry.revision,
        inFlight: entry.inFlight,
      })),
    };
  }

  private snapshot(): Snapshot {
    const served: CompiledRoute[] = [];
    const claimed: CompiledRoute[] = [];
    for (const contribution of this.contributions.values())
      (this.claimedIds.has(contribution.operationId) ? claimed : served).push(
        compileRoute(contribution),
      );
    return { revision: this.active.revision + 1, inFlight: 0, served, claimed };
  }

  private rebuild(): void {
    const previous = this.active;
    this.active = this.snapshot();
    if (previous.inFlight > 0) {
      this.draining.add(previous);
      setTimeout(() => this.draining.delete(previous), 30_000).unref?.();
    }
  }

  private trimIdempotencyCache(): void {
    const cutoff = Date.now() - 24 * 60 * 60_000;
    for (const [key, entry] of this.idempotentResponses)
      if (entry.storedAt < cutoff) this.idempotentResponses.delete(key);
    while (this.idempotentResponses.size > 1_000)
      this.idempotentResponses.delete(
        this.idempotentResponses.keys().next().value!,
      );
  }

  get routeIds(): readonly string[] {
    return [...this.contributions.keys()];
  }

  get routeContributions(): readonly RouteContribution[] {
    return [...this.contributions.values()];
  }

  get routeDetails(): readonly RouteDetail[] {
    return [...this.contributions.values()].map(
      ({ declaration: _declaration, handler: _handler, ...metadata }) =>
        metadata,
    );
  }

  /** The operations nothing claimed, sorted by operationId. */
  get servedOperations(): readonly RouteDetail[] {
    return this.routeDetails
      .filter((route) => !this.claimedIds.has(route.operationId))
      .sort((a, b) => a.operationId.localeCompare(b.operationId));
  }
}
