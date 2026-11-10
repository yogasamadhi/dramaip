/**
 * Transitional bridge (P4/P5): the existing Studio app still calls the
 * `/api/v2` paths that left the compat router when a domain controller took
 * them over. Each domain package's `./legacy` table names the Remote method
 * behind each path and where its arguments travelled; the bridge turns the
 * old request into that call and the result back into the route's answer.
 * Every other request goes to the page's own `fetch`. Deleted with this
 * package in P6.
 * @module @dramaip/workspace-studio-client/client/remote-bridge
 */
import type { Context } from "@deepseek-ai/cordis";
import { agentsLegacyRoutes } from "@dramaip/agents-agents/legacy";
import type {} from "@dramaip/agents-agents/remote";
import { automationLegacyRoutes } from "@dramaip/automation-automation/legacy";
import type {} from "@dramaip/automation-automation/remote";
import type {
  LegacyArg,
  LegacyRoute,
  LegacyRouteTable,
} from "@dramaip/infra-operations/legacy-routes";
import type {
  CompatEvent,
  CompatFile,
} from "@dramaip/infra-operations/problem";
import type {
  RemoteFailure,
  RemoteResult,
} from "@dramaip/infra-remotes/client";
import { insightsLegacyRoutes } from "@dramaip/insights-insights/legacy";
import type {} from "@dramaip/insights-insights/remote";
import { deliveryLegacyRoutes } from "@dramaip/production-delivery/legacy";
import type {} from "@dramaip/production-delivery/remote";
import { mediaLegacyRoutes } from "@dramaip/production-media/legacy";
import type {} from "@dramaip/production-media/remote";
import { productionLegacyRoutes } from "@dramaip/production-production/legacy";
import type {} from "@dramaip/production-production/remote";
import { reviewLegacyRoutes } from "@dramaip/production-review/legacy";
import type {} from "@dramaip/production-review/remote";
import { timelineLegacyRoutes } from "@dramaip/production-timeline/legacy";
import type {} from "@dramaip/production-timeline/remote";
import { workspaceLegacyRoutes } from "@dramaip/workspace-workspace/legacy";
import type {} from "@dramaip/workspace-workspace/remote";
import { knowledgeLegacyRoutes } from "@dramaip/writing-knowledge/legacy";
import type {} from "@dramaip/writing-knowledge/remote";
import { creativeQualityLegacyRoutes } from "@dramaip/writing-quality/legacy";
import type {} from "@dramaip/writing-quality/remote";
import { writingLegacyRoutes } from "@dramaip/writing-writing/legacy";
import type {} from "@dramaip/writing-writing/remote";

type FetchLike = typeof fetch;

type UnaryMethod = (...args: unknown[]) => Promise<RemoteResult<unknown>>;

/** The handle a stream method returns on the Client. */
interface StreamHandle extends AsyncIterable<CompatEvent> {
  dispose(): void;
}

/** The domain tables the bridge answers from, one per migrated domain. */
export const LEGACY_TABLES: readonly LegacyRouteTable[] = [
  insightsLegacyRoutes,
  reviewLegacyRoutes,
  deliveryLegacyRoutes,
  workspaceLegacyRoutes,
  writingLegacyRoutes,
  creativeQualityLegacyRoutes,
  knowledgeLegacyRoutes,
  agentsLegacyRoutes,
  automationLegacyRoutes,
  // The media playback bytes are not in the media table: they keep their
  // `/api/v2` URL, which the media controller's own route serves.
  timelineLegacyRoutes,
  mediaLegacyRoutes,
  productionLegacyRoutes,
];

interface CompiledRoute {
  readonly namespace: string;
  readonly route: LegacyRoute;
  readonly pattern: RegExp;
  readonly names: readonly string[];
}

/**
 * A path template's shape, one character per segment: `0` literal, `1`
 * parameter. Shapes compared as text put the literal first at the first
 * segment where two templates differ in kind (`…/attributions/summaries`
 * before `…/attributions/{id}`), the order the replaced router matched in.
 */
const shapeOf = (path: string) =>
  path
    .split("/")
    .map((segment) => (segment.startsWith("{") ? "1" : "0"))
    .join("");

/**
 * Compile each table row's path template once, literal segments ahead of the
 * templates they also fit; rows otherwise keep their table order.
 */
export function compileLegacyTables(
  tables: readonly LegacyRouteTable[],
): readonly CompiledRoute[] {
  return tables
    .flatMap((table) =>
      table.routes.map((route) => ({
        table,
        route,
        shape: shapeOf(route.path),
      })),
    )
    .sort((a, b) => (a.shape < b.shape ? -1 : a.shape > b.shape ? 1 : 0))
    .map(({ table, route }) => {
      const names: string[] = [];
      const source = route.path
        .split("/")
        .map((segment) => {
          const param = /^\{([^}]+)\}$/u.exec(segment);
          if (param === null)
            return segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
          names.push(param[1]!);
          return "([^/]+)";
        })
        .join("/");
      return {
        namespace: table.namespace,
        route,
        pattern: new RegExp(`^${source}/?$`, "u"),
        names,
      };
    });
}

/** The request facts a row's arguments are read from. */
export interface LegacyRequest {
  readonly url: URL;
  readonly headers: Headers;
  text(): Promise<string>;
}

/** The method's positional arguments a matched request carries. */
export async function legacyArgs(
  args: readonly LegacyArg[],
  params: Readonly<Record<string, string>>,
  request: LegacyRequest,
): Promise<unknown[]> {
  const values: unknown[] = [];
  for (const arg of args) {
    if (arg.from === "param") values.push(params[arg.name]);
    else if (arg.from === "query") {
      const query: Record<string, string | number> = {};
      for (const [name, value] of request.url.searchParams)
        query[name] = arg.numbers?.includes(name) ? Number(value) : value;
      values.push(query);
    } else if (arg.from === "body") {
      const text = await request.text();
      values.push(text ? (JSON.parse(text) as unknown) : undefined);
    } else if (arg.from === "cursor") {
      // The route read `Last-Event-ID` first, then `?cursor`.
      const header = Number(request.headers.get("Last-Event-ID") ?? "0");
      const query = Number(request.url.searchParams.get("cursor") ?? "0");
      values.push(
        Number.isSafeInteger(header) && header > 0
          ? header
          : Number.isSafeInteger(query) && query > 0
            ? query
            : 0,
      );
    } else if (arg.from === "ifMatch")
      values.push(request.headers.get("If-Match") ?? undefined);
    else values.push(request.headers.get("Idempotency-Key") ?? undefined);
  }
  // The Remote client takes exactly the method's arity, so an absent
  // optional argument is passed as `undefined` rather than dropped.
  return values;
}

function isCompatFile(value: unknown): value is CompatFile {
  if (typeof value !== "object" || value === null) return false;
  const keys = Object.keys(value);
  return (
    typeof (value as { contentType?: unknown }).contentType === "string" &&
    (keys.includes("text") || keys.includes("base64")) &&
    keys.every((key) =>
      ["contentType", "fileName", "text", "base64"].includes(key),
    )
  );
}

function problem(
  status: number,
  code: string,
  title: string,
  extra: { detail?: string; errors?: unknown } = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title,
      status,
      detail: extra.detail ?? title,
      code,
      ...(extra.errors === undefined ? {} : { errors: extra.errors }),
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

/** The answer the replaced route gave for a Remote failure. */
export function legacyFailure(
  error: Pick<RemoteFailure, "message"> & { code: string; details?: unknown },
): Response {
  if (error.code === "compat/problem") {
    const details = error.details as {
      status: number;
      code: string;
      detail?: string;
      errors?: unknown;
    };
    return problem(details.status, details.code, error.message, details);
  }
  // The Gateway validates arguments at the Remote boundary, before the
  // route's own validation would have.
  if (
    error.code === "gateway/bad-request" ||
    error.code === "gateway/input-invalid"
  )
    return problem(400, "VALIDATION_ERROR", error.message);
  return problem(500, "INTERNAL_ERROR", "Unexpected runtime error");
}

/** The answer the replaced route gave for a method's value. */
export function legacyAnswer(route: LegacyRoute, value: unknown): Response {
  if (value === undefined || route.status === 204)
    return new Response(null, { status: 204 });
  if (isCompatFile(value)) {
    const headers = new Headers({ "Content-Type": value.contentType });
    if (value.fileName !== undefined)
      headers.set(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(value.fileName)}`,
      );
    const body =
      "text" in value
        ? value.text
        : Uint8Array.from(atob(value.base64), (char) => char.charCodeAt(0));
    return new Response(body, { status: route.status, headers });
  }
  return new Response(JSON.stringify(value), {
    status: route.status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Write a stream method's events back as the server-sent events the route
 * wrote. The handle ends when the reader cancels or the request aborts.
 */
export function legacyEventStream(
  handle: StreamHandle,
  signal: AbortSignal | null | undefined,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stop = () => handle.dispose();
      signal?.addEventListener("abort", stop, { once: true });
      try {
        for await (const { event, id, data } of handle)
          controller.enqueue(
            encoder.encode(
              `event: ${event}\n${id === undefined ? "" : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`,
            ),
          );
        controller.close();
      } catch (error) {
        // The caller reconnects from its last cursor when the stream errors.
        controller.error(error);
      } finally {
        signal?.removeEventListener("abort", stop);
      }
    },
    cancel() {
      handle.dispose();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/**
 * Answer one request from the Remote method its path names, or return
 * undefined when no table row matches it.
 */
export function bridgeLegacyRequest(
  remote: Context["remote"],
  routes: readonly CompiledRoute[],
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origin: string,
): Promise<Response> | undefined {
  // Read the target without building a Request: that would take over the
  // body of a request this bridge passes on.
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    origin,
  );
  if (url.origin !== origin || !url.pathname.startsWith("/api/v2/"))
    return undefined;
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  for (const { namespace, route, pattern, names } of routes) {
    if (route.method !== method) continue;
    const match = pattern.exec(url.pathname);
    if (match === null) continue;
    const call = (
      remote as unknown as Record<
        string,
        Record<string, UnaryMethod> | undefined
      >
    )[namespace]?.[route.remote];
    // The domain's Remote is not selected here: the request goes on as is.
    if (typeof call !== "function") return undefined;
    const request =
      input instanceof Request
        ? init === undefined
          ? input
          : new Request(input, init)
        : new Request(url, init);
    const params = Object.fromEntries(
      names.map((name, index) => [name, decodeURIComponent(match[index + 1]!)]),
    );
    return (async () => {
      const args = await legacyArgs(route.args, params, {
        url,
        headers: request.headers,
        text: () => request.text(),
      });
      if (route.stream === true)
        return legacyEventStream(
          (call as unknown as (...values: unknown[]) => StreamHandle)(...args),
          request.signal,
        );
      const result = await call(...args);
      if (result.ok) return legacyAnswer(route, result.value);
      // A failure the route itself did not answer has no place in the old
      // problem document; keep its code where a developer can see it.
      if (result.error.code !== "compat/problem")
        console.warn(
          `legacy bridge: ${namespace}/${route.remote} failed with ${result.error.code}: ${result.error.message}`,
        );
      return legacyFailure(result.error);
    })();
  }
  return undefined;
}

/**
 * Route the page's `fetch` through the bridge. The app's connection manager
 * captures `fetch` when it is created, which is after this runs.
 * @param ctx - Client Context whose `remote` answers the bridged paths.
 * @returns disposer restoring the `fetch` the bridge wrapped.
 */
export function installRemoteBridge(ctx: Context): () => void {
  // The live Pi catalog is a Remote read, also used by the Studio facade.
  const routes = compileLegacyTables([
    ...LEGACY_TABLES,
    {
      namespace: "agents",
      routes: [
        {
          operationId: "providers.catalog",
          method: "GET",
          path: "/api/v2/providers/catalog",
          status: 200,
          remote: "providersCatalog",
          args: [],
        },
      ],
    },
  ]);
  const pageFetch: FetchLike = window.fetch;
  const bridged: FetchLike = (input, init) =>
    bridgeLegacyRequest(ctx.remote, routes, input, init, location.origin) ??
    pageFetch.call(window, input, init);
  window.fetch = bridged;
  return () => {
    if (window.fetch === bridged) window.fetch = pageFetch;
  };
}
