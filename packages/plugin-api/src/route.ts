/**
 * Route declarations, the handler context and the event-stream helper of a
 * first-party route. Plain data and Web types: the registry that runs the
 * routes (`@dramaip/infra-operations`) validates a declaration's schemas and
 * builds the context, so plugins depend on no HTTP framework.
 * @module @dramaip/plugin-api/route
 */

import type { RouteMethod } from "./internal.js";

/** A schema the registry validates a request part with (a zod schema). */
export interface RouteSchema {
  safeParseAsync(value: unknown): Promise<{ readonly success: boolean }>;
}

/** The request parts a route validates before its handler runs. */
export interface RouteRequestDeclaration {
  /** Path parameters, decoded. */
  readonly params?: unknown;
  /** Query parameters; a repeated name is an array. */
  readonly query?: unknown;
  /** Headers; schema keys match case-insensitively. */
  readonly headers?: unknown;
  /** Cookies of the `Cookie` header. */
  readonly cookies?: unknown;
  /**
   * The body, by media type. A JSON body is validated when it is
   * `required`, or else when the request says it sends JSON.
   */
  readonly body?: {
    readonly description?: string;
    readonly required?: boolean;
    readonly content: Readonly<Record<string, { readonly schema?: unknown }>>;
  };
}

/** What a route declares: its operation and the request it validates. */
export interface RouteDeclaration {
  readonly method: RouteMethod;
  /** Path template, e.g. `/api/v2/projects/{id}`. */
  readonly path: string;
  readonly operationId?: string;
  readonly request?: RouteRequestDeclaration;
  /** Documented answers by status; descriptive only. */
  readonly responses: Readonly<Record<string | number, unknown>>;
  readonly [key: string]: unknown;
}

/**
 * Declare a route. The identity function, typed, so a declaration reads as
 * one where it is written.
 * @param declaration - the route's operation and request schemas.
 */
export function defineRoute<const Declaration extends RouteDeclaration>(
  declaration: Declaration,
): Declaration {
  return declaration;
}

/** The request a route handler reads. */
export interface RouteRequest {
  /** The Web request as the registry received it. */
  readonly raw: Request;
  readonly url: string;
  readonly method: string;
  /** The URL's path. */
  readonly path: string;
  /** All path parameters, or one by name, decoded. */
  param(): Record<string, string>;
  param(name: string): string;
  /** All query parameters (first value each), or one by name. */
  query(): Record<string, string>;
  query(name: string): string | undefined;
  /** All query parameters with every value, or one by name. */
  queries(): Record<string, string[]>;
  queries(name: string): string[] | undefined;
  /** All headers by lower-case name, or one by name. */
  header(): Record<string, string>;
  header(name: string): string | undefined;
  /** The body parsed as JSON; rejects when it is not JSON. Read once. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers narrow what they read
  json<T = any>(): Promise<T>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A response's status, or its status and headers. */
export type RouteResponseInit = number | ResponseInit;

/** Headers a response helper adds; an array appends each value. */
export type RouteResponseHeaders = Readonly<Record<string, string | string[]>>;

/** What a route handler receives. */
export interface RouteContext {
  readonly req: RouteRequest;
  /**
   * Set a header of the response the handler builds with this context;
   * undefined removes it.
   */
  header(
    name: string,
    value: string | undefined,
    options?: { readonly append?: boolean },
  ): void;
  /** Set the status of the response the handler builds next. */
  status(status: number): void;
  /** A JSON response. */
  json(
    value: unknown,
    init?: RouteResponseInit,
    headers?: RouteResponseHeaders,
  ): Response;
  /** A `text/plain` response. */
  text(
    text: string,
    init?: RouteResponseInit,
    headers?: RouteResponseHeaders,
  ): Response;
  /** A response with this body. */
  body(
    body: BodyInit | null,
    init?: RouteResponseInit,
    headers?: RouteResponseHeaders,
  ): Response;
  /** The same as {@link body}. */
  newResponse(
    body: BodyInit | null,
    init?: RouteResponseInit,
    headers?: RouteResponseHeaders,
  ): Response;
}

/** One server-sent event. */
export interface RouteEvent {
  readonly event?: string;
  readonly id?: string;
  readonly retry?: number;
  /** Written as one `data:` line per line. */
  readonly data: string;
}

/** The stream an event-stream handler writes to. */
export interface RouteEventStream {
  /** Write one event. */
  writeSSE(event: RouteEvent): Promise<void>;
  /** Write raw text, e.g. a `: heartbeat` comment frame. */
  write(text: string): Promise<void>;
  /** Run `listener` once when the caller goes away. */
  onAbort(listener: () => void): void;
  /** True once the caller went away. */
  readonly aborted: boolean;
}

/**
 * Answer a server-sent event stream that `write` fills. The stream ends when
 * `write` settles; a failure of `write` is logged and ends it. The caller
 * going away (it cancels the body or aborts its request) runs the
 * {@link RouteEventStream.onAbort} listeners.
 * @param context - the handler's context; its prepared headers apply.
 * @param write - writes the events.
 */
export function streamEvents(
  context: RouteContext,
  write: (stream: RouteEventStream) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const listeners: (() => void)[] = [];
  let aborted = false;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const abort = (): void => {
    if (aborted) return;
    aborted = true;
    for (const listener of listeners.splice(0)) listener();
  };
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
    cancel: abort,
  });
  const enqueue = async (text: string): Promise<void> => {
    if (aborted) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      abort();
    }
  };
  const stream: RouteEventStream = {
    writeSSE: ({ event, id, retry, data }) =>
      enqueue(
        [
          event && `event: ${event}`,
          data
            .split(/\r\n|\r|\n/u)
            .map((line) => `data: ${line}`)
            .join("\n"),
          id && `id: ${id}`,
          retry && `retry: ${retry}`,
        ]
          .filter(Boolean)
          .join("\n") + "\n\n",
      ),
    write: enqueue,
    onAbort(listener) {
      if (aborted) listener();
      else listeners.push(listener);
    },
    get aborted() {
      return aborted;
    },
  };
  context.req.raw.signal.addEventListener("abort", abort, { once: true });
  void (async () => {
    try {
      await write(stream);
    } catch (error) {
      console.error(error);
    } finally {
      try {
        controller.close();
      } catch {
        // Already cancelled by the caller.
      }
    }
  })();
  return context.body(body, 200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}
