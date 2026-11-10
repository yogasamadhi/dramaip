/**
 * A domain controller takes over its `/api/v2` operations and runs their
 * plugin handlers in process. A claimed operation leaves the served surface;
 * its Remote method calls the handler through {@link CompatOperations.call}
 * under the same route policy, and a problem response becomes the
 * `compat/problem` RemoteError the Client maps back.
 * @module @dramaip/infra-operations/operations
 */
import type { Context } from "@deepseek-ai/cordis";
import { RemoteError } from "@dramaip/infra-typert-protocol";
import type {} from "./index.ts";
import type { LegacyRoute } from "./legacy-routes.ts";
import type { CompatEvent, CompatFile, CompatProblem } from "./problem.ts";

export type * from "./legacy-routes.ts";
export type * from "./problem.ts";

/** What one call of a claimed operation carries, by its HTTP part. */
export interface CompatCall {
  /** Path parameters by their template name. */
  readonly params?: Readonly<Record<string, string>>;
  /** Query parameters; undefined values are left out. */
  readonly query?: Readonly<
    Record<string, string | number | boolean | undefined>
  >;
  /** JSON request body. */
  readonly body?: unknown;
  /** Version the caller read (the original `If-Match`). */
  readonly ifMatch?: string;
  /** Replay key of a write (the original `Idempotency-Key`). */
  readonly idempotencyKey?: string;
}

/**
 * The call of `route`'s operation that a Remote method's positional
 * arguments stand for.
 * @param route - the method's row of its domain's legacy table.
 * @param args - the method's arguments, in order.
 */
export function compatCallOf(
  route: LegacyRoute,
  args: readonly unknown[],
): CompatCall {
  const params: Record<string, string> = {};
  let query: CompatCall["query"];
  let body: unknown;
  let ifMatch: string | undefined;
  let idempotencyKey: string | undefined;
  route.args.forEach((arg, index) => {
    const value = args[index];
    if (arg.from === "param") params[arg.name] = String(value);
    else if (arg.from === "query") query = value as CompatCall["query"];
    // The handlers read a positive cursor and replay everything otherwise.
    else if (arg.from === "cursor")
      query = {
        ...query,
        ...(Number(value) > 0 ? { cursor: Number(value) } : {}),
      };
    else if (arg.from === "body") body = value;
    else if (arg.from === "ifMatch") ifMatch = value as string | undefined;
    else idempotencyKey = value as string | undefined;
  });
  return {
    params,
    ...(query === undefined ? {} : { query }),
    ...(body === undefined ? {} : { body }),
    ...(ifMatch === undefined ? {} : { ifMatch }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

/** The claimed operations of one domain controller. */
export interface CompatOperations {
  /**
   * Run one claimed operation's handler.
   * @returns its JSON value, a {@link CompatFile} for any other body, or
   *   undefined for an empty one.
   * @throws RemoteError `compat/problem` for a problem response.
   */
  call(operationId: string, call?: CompatCall): Promise<unknown>;
  /**
   * Run one claimed operation's handler and return its response as is, for
   * a route that serves the bytes itself (a binary read the Remote wire does
   * not carry).
   * @param accept - the `Accept` the original request sent.
   */
  fetch(
    operationId: string,
    call?: CompatCall,
    accept?: string,
  ): Promise<Response>;
  /**
   * Run one claimed streaming operation's handler and read the server-sent
   * events it writes until it ends or `signal` aborts.
   * @throws RemoteError `compat/problem` when it answers a problem instead.
   */
  stream(
    operationId: string,
    call: CompatCall,
    signal: AbortSignal,
  ): AsyncIterable<CompatEvent>;
}

const fileTypes = /^(?:text\/|application\/(?:xml|x-subrip|octet-stream))/u;

/** Read a handler's response as the value a Remote method returns. */
async function valueOf(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Partial<
      CompatProblem & { title: string }
    >;
    const code = body.code ?? "INTERNAL_ERROR";
    throw new RemoteError(
      "compat/problem",
      body.title ?? "Unexpected runtime error",
      {
        status: response.status,
        code,
        ...(typeof body.detail === "string" && body.detail !== body.title
          ? { detail: body.detail }
          : {}),
        ...(body.errors ? { errors: body.errors } : {}),
      },
    );
  }
  if (type.includes("json")) {
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const named = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/iu.exec(
    disposition,
  );
  const fileName = named
    ? decodeURIComponent(named[1] ?? named[2] ?? "")
    : undefined;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const file: CompatFile = fileTypes.test(type)
    ? {
        contentType: type,
        ...(fileName ? { fileName } : {}),
        text: new TextDecoder().decode(bytes),
      }
    : {
        contentType: type,
        ...(fileName ? { fileName } : {}),
        base64: Buffer.from(bytes).toString("base64"),
      };
  return file;
}

/**
 * Claim a domain's operations for the life of `ctx` and return their caller.
 * @param ctx - the controller's Context; it must inject `operations`.
 * @param operationIds - every operation the controller replaces.
 */
export function claimCompatOperations(
  ctx: Context,
  operationIds: readonly string[],
): CompatOperations {
  const registry = ctx.operations;
  for (const id of operationIds)
    ctx.effect(() => registry.claim(id), `operations: claim ${id}`);
  const claimed = new Set(operationIds);
  const invoke = (
    operationId: string,
    call: CompatCall,
    accept: string,
    signal?: AbortSignal,
  ): Promise<Response> => {
    if (!claimed.has(operationId))
      throw new Error(`operations: ${operationId} is not claimed here`);
    const route = registry.routeDetails.find(
      (candidate) => candidate.operationId === operationId,
    );
    if (route === undefined)
      throw new RemoteError(
        "compat/problem",
        "The plugin serving this operation is not loaded",
        { status: 503, code: "CAPABILITY_UNAVAILABLE" },
      );
    const path = route.path.replace(/\{([^}]+)\}/gu, (_, name: string) => {
      const value = call.params?.[name];
      if (value === undefined)
        throw new Error(`operations: ${operationId} needs ${name}`);
      return encodeURIComponent(value);
    });
    const url = new URL(path, "http://operations.invalid");
    for (const [name, value] of Object.entries(call.query ?? {}))
      if (value !== undefined) url.searchParams.set(name, String(value));
    const headers = new Headers({ accept });
    if (call.body !== undefined)
      headers.set("content-type", "application/json");
    if (call.ifMatch !== undefined) headers.set("if-match", call.ifMatch);
    if (call.idempotencyKey !== undefined)
      headers.set("idempotency-key", call.idempotencyKey);
    return registry.invoke(
      operationId,
      new Request(url, {
        method: route.method.toUpperCase(),
        headers,
        ...(signal === undefined ? {} : { signal }),
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      }),
    );
  };
  return {
    async call(operationId, call = {}) {
      return valueOf(await invoke(operationId, call, "application/json"));
    },
    fetch(operationId, call = {}, accept = "*/*") {
      return invoke(operationId, call, accept);
    },
    async *stream(operationId, call, signal) {
      const response = await invoke(
        operationId,
        call,
        "text/event-stream",
        signal,
      );
      if (
        !response.ok ||
        !(response.headers.get("content-type") ?? "").includes(
          "text/event-stream",
        )
      ) {
        await valueOf(response);
        throw new RemoteError(
          "compat/problem",
          "The operation did not answer an event stream",
          { status: 500, code: "INTERNAL_ERROR" },
        );
      }
      yield* eventsOf(response, signal);
    },
  };
}

/** Read a handler's server-sent events until it ends or `signal` aborts. */
async function* eventsOf(
  response: Response,
  signal: AbortSignal,
): AsyncIterable<CompatEvent> {
  const reader = response
    .body!.pipeThrough(new TextDecoderStream())
    .getReader();
  // Cancelling the body is how the handler learns its caller went away.
  const stop = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", stop, { once: true });
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += value.replace(/\r\n?/gu, "\n");
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const event = frameOf(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event !== undefined) yield event;
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    signal.removeEventListener("abort", stop);
    await reader.cancel().catch(() => {});
  }
}

/** One server-sent event frame, or undefined for a comment-only frame. */
function frameOf(frame: string): CompatEvent | undefined {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === 0) continue;
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /u, "");
    if (field === "event") event = value;
    else if (field === "id") id = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0) return undefined;
  return {
    event,
    ...(id === undefined ? {} : { id }),
    data: JSON.parse(data.join("\n")) as unknown,
  };
}
