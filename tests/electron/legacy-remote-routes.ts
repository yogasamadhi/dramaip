/**
 * Transitional (P4/P5, deleted in P6): the suite fakes Host answers with
 * `page.route` on the `/api/v2` paths the existing app called. Once a domain
 * controller takes an operation over, the app's bridge sends the call as the
 * Remote request `POST /api/<namespace>/<method>` instead. This module gives
 * such a request the view of the `/api/v2` request it replaced, so the
 * suite's handlers keep matching and reading it, and turns a handler's
 * `/api/v2` answer back into the Remote response envelope (and the Host's
 * Remote answer into the `/api/v2` response `route.fetch()` returns).
 */
import type { LegacyRoute } from "../../packages/infra/operations/src/legacy-routes";
import {
  compileLegacyTables,
  LEGACY_TABLES,
  legacyAnswer,
  legacyFailure,
} from "../../packages/workspace/studio-client/src/client/remote-bridge";

/** A request the shell holds, as its route hook reports it. */
export interface WireRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  /** base64 */
  readonly body?: string;
}

/** A response, as the shell's route hook takes and gives it. */
export interface WireResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  /** base64 */
  readonly body: string;
}

/** The `/api/v2` view of one Remote request. */
export interface LegacyView {
  /** The request the replaced operation would have received. */
  readonly request: WireRequest;
  /** Wrap a handler's `/api/v2` answer as the Remote response. */
  toWire(response: WireResponse): WireResponse;
  /** Read the Host's Remote response as the `/api/v2` answer. */
  fromWire(response: WireResponse): Promise<WireResponse>;
}

const byEndpoint = new Map<string, LegacyRoute>(
  compileLegacyTables(LEGACY_TABLES).map(({ namespace, route }) => [
    `${namespace}/${route.remote}`,
    route,
  ]),
);

/** Matches every Remote endpoint a legacy table names. */
export const legacyRemotePattern = new RegExp(
  `/api/(?:${[...new Set(LEGACY_TABLES.map((table) => table.namespace))].join("|")})/[A-Za-z0-9]+$`,
  "u",
);

const text = (base64: string) => Buffer.from(base64, "base64").toString("utf8");
const base64 = (value: string | Uint8Array) =>
  Buffer.from(value).toString("base64");

function header(
  headers: Record<string, string>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers))
    if (key.toLowerCase() === wanted) return value;
  return undefined;
}

async function wireOf(response: Response): Promise<WireResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  return {
    status: response.status,
    headers,
    body: base64(new Uint8Array(await response.arrayBuffer())),
  };
}

/** The value a handler's successful `/api/v2` answer stands for. */
function valueOf(response: WireResponse): unknown {
  const body = text(response.body);
  if (response.status === 204 || body === "") return undefined;
  const type = header(response.headers, "content-type") ?? "";
  if (type.includes("json")) return JSON.parse(body) as unknown;
  const disposition = header(response.headers, "content-disposition") ?? "";
  const named = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/iu.exec(
    disposition,
  );
  const fileName = named
    ? decodeURIComponent(named[1] ?? named[2] ?? "")
    : undefined;
  return /^(?:text\/|application\/(?:xml|x-subrip|octet-stream))/u.test(type)
    ? { contentType: type, ...(fileName ? { fileName } : {}), text: body }
    : {
        contentType: type,
        ...(fileName ? { fileName } : {}),
        base64: response.body,
      };
}

/** The Remote failure a handler's `/api/v2` problem answer stands for. */
function failureOf(response: WireResponse) {
  let problem: {
    title?: string;
    code?: string;
    detail?: string;
    errors?: unknown;
  } = {};
  try {
    problem = JSON.parse(text(response.body)) as typeof problem;
  } catch {
    // A body that is not a problem document reads as an unexplained failure.
  }
  return {
    code: "compat/problem",
    message: problem.title ?? "Unexpected runtime error",
    details: {
      status: response.status,
      code: problem.code ?? "INTERNAL_ERROR",
      ...(typeof problem.detail === "string" && problem.detail !== problem.title
        ? { detail: problem.detail }
        : {}),
      ...(problem.errors === undefined ? {} : { errors: problem.errors }),
    },
  };
}

/**
 * The `/api/v2` view of a held Remote request, or undefined when the request
 * is not a call of a method that replaced an operation.
 */
export function legacyViewOf(request: WireRequest): LegacyView | undefined {
  if (request.method !== "POST" || request.body === undefined) return undefined;
  const url = new URL(request.url);
  const endpoint = url.pathname.replace(/^\/api\//u, "");
  const route = byEndpoint.get(endpoint);
  if (route === undefined || !url.pathname.startsWith("/api/"))
    return undefined;
  const envelope = JSON.parse(text(request.body)) as {
    rpcId: string;
    payload?: { args?: Record<string, unknown> };
  };
  const args = envelope.payload?.args ?? {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers))
    if (!["content-length", "content-type"].includes(key.toLowerCase()))
      headers[key] = value;
  let path: string = route.path;
  let body: string | undefined;
  const search = new URLSearchParams();
  for (const arg of route.args) {
    const value = args[arg.name];
    if (arg.from === "param")
      path = path.replace(`{${arg.name}}`, encodeURIComponent(String(value)));
    else if (arg.from === "query") {
      for (const [name, field] of Object.entries(
        (value ?? {}) as Record<string, unknown>,
      ))
        if (field !== undefined) search.set(name, String(field));
    } else if (arg.from === "body") {
      if (value !== undefined) {
        body = base64(JSON.stringify(value));
        headers["content-type"] = "application/json";
      }
    } else if (value !== undefined)
      headers[arg.from === "ifMatch" ? "if-match" : "idempotency-key"] =
        String(value);
  }
  const query = search.toString();
  // Resolve against the request: `dramaip-app:` URLs have no origin to prefix.
  const legacyUrl = new URL(`${path}${query ? `?${query}` : ""}`, url).href;
  const envelopeOf = (result: unknown): WireResponse => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: base64(
      JSON.stringify({
        type: "server-response",
        rpcId: envelope.rpcId,
        result,
      }),
    ),
  });
  return {
    request: {
      url: legacyUrl,
      method: route.method,
      headers,
      ...(body === undefined ? {} : { body }),
    },
    toWire(response) {
      return response.status >= 200 && response.status < 300
        ? envelopeOf({ ok: true, value: valueOf(response) })
        : envelopeOf({ ok: false, error: failureOf(response) });
    },
    async fromWire(response) {
      const answered = JSON.parse(text(response.body)) as {
        result?:
          | { ok: true; value: unknown }
          | {
              ok: false;
              error: { code: string; message: string; details?: unknown };
            };
      };
      if (answered.result === undefined) return response;
      return wireOf(
        answered.result.ok
          ? legacyAnswer(route, answered.result.value)
          : legacyFailure(answered.result.error),
      );
    },
  };
}

/** The parts of a page request the suite's request listeners read. */
export interface ObservedRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postData(): string | null;
  postDataBuffer(): Buffer | null;
  postDataJSON(): unknown;
}

/**
 * A page request as the `/api/v2` request it stands for: the replaced
 * operation's for a Remote call a legacy table names, else itself.
 * @param request - a request a `page.on("request")` listener received.
 * @returns the request the suite's listeners match on.
 */
export function legacyRequestOf(request: ObservedRequest): ObservedRequest {
  const sent = request.postDataBuffer();
  const view = legacyViewOf({
    url: request.url(),
    method: request.method(),
    headers: request.headers(),
    ...(sent === null ? {} : { body: sent.toString("base64") }),
  });
  if (view === undefined) return request;
  const body =
    view.request.body === undefined
      ? null
      : Buffer.from(view.request.body, "base64");
  return {
    url: () => view.request.url,
    method: () => view.request.method,
    headers: () => view.request.headers,
    postData: () => body?.toString("utf8") ?? null,
    postDataBuffer: () => body,
    postDataJSON: () =>
      body === null ? null : (JSON.parse(body.toString("utf8")) as unknown),
  };
}

/** The parts of a page response the suite's response listeners read. */
export interface ObservedResponse {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  body(): Promise<Buffer>;
  request(): ObservedRequest;
}

/** A response as the suite reads it, with its body read once. */
export interface LegacyResponse {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  text(): string;
  json(): unknown;
  request(): ObservedRequest;
}

/**
 * A page response as the `/api/v2` response it stands for: the replaced
 * operation's answer for a Remote call a legacy table names, else itself.
 * @param response - a response a `page.on("response")` listener or
 *   `waitForResponse` received.
 */
export async function legacyResponseOf(
  response: ObservedResponse,
): Promise<LegacyResponse> {
  const observed = response.request();
  const request = legacyRequestOf(observed);
  const sent = observed.postDataBuffer();
  const view = legacyViewOf({
    url: observed.url(),
    method: observed.method(),
    headers: observed.headers(),
    ...(sent === null ? {} : { body: sent.toString("base64") }),
  });
  const wire: WireResponse = {
    status: response.status(),
    headers: response.headers(),
    body: (await response.body()).toString("base64"),
  };
  const answer = view === undefined ? wire : await view.fromWire(wire);
  const body = text(answer.body);
  return {
    url: () => request.url(),
    status: () => answer.status,
    headers: () => answer.headers,
    text: () => body,
    json: () => JSON.parse(body) as unknown,
    request: () => request,
  };
}
