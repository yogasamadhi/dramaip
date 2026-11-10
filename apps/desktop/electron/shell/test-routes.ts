/**
 * Request routing for isolated E2E runs. The application window's Host traffic
 * is answered by the shell's `dramaip-app://` handler, which Chromium's request
 * interception never sees, so a test routes it here instead: at the point
 * where the shell forwards a request to the Host. Only an isolated E2E run
 * installs this; the test side drives it through the shell's E2E hook.
 */

/** A request held until the test decides what happens to it. */
export interface PausedRequest {
  readonly id: number;
  readonly url: string;
  readonly method: string;
  /** Lower-case names. */
  readonly headers: Record<string, string>;
  /** Base64, when the request has a body. */
  readonly body?: string;
}

/** What replaces parts of a request that continues or is fetched. */
export interface RequestOverrides {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  /** Base64. */
  readonly body?: string;
}

/** A response carried back to the test, body in base64. */
export interface RoutedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export type RouteDecision =
  | ({ readonly kind: "continue" } & RequestOverrides)
  | ({ readonly kind: "fulfill" } & RoutedResponse)
  | { readonly kind: "abort" };

/** Sends a request on to the Host the way the app origin does. */
export type Forward = (request: Request) => Promise<Response>;

/** A pattern as `RegExp` source and flags. */
export interface RoutePattern {
  readonly source: string;
  readonly flags: string;
}

interface Held {
  readonly request: Request;
  readonly body: ArrayBuffer | undefined;
  readonly forward: Forward;
  respond(response: Response): void;
}

// A response body would be refused for these statuses, or Chromium would
// decode it twice.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);
const BODY_FRAMING_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
];

const decode = (base64: string | undefined) =>
  base64 === undefined ? undefined : Buffer.from(base64, "base64");

export class TestRoutes {
  private patterns: RegExp[] = [];
  private readonly queue: PausedRequest[] = [];
  private readonly waiting: Array<(paused: PausedRequest) => void> = [];
  private readonly held = new Map<number, Held>();
  private sequence = 0;

  /** Replace the patterns whose requests are held for the test. */
  setPatterns(patterns: readonly RoutePattern[]): void {
    this.patterns = patterns.map(
      ({ source, flags }) => new RegExp(source, flags.replace("g", "")),
    );
  }

  /**
   * Hold a request the test routes, or leave it to the caller.
   * @returns the response the test chose, or undefined when no pattern matches.
   */
  async handle(
    request: Request,
    forward: Forward,
  ): Promise<Response | undefined> {
    if (!this.patterns.some((pattern) => pattern.test(request.url)))
      return undefined;
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    const id = ++this.sequence;
    const paused: PausedRequest = {
      id,
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers),
      ...(body ? { body: Buffer.from(body).toString("base64") } : {}),
    };
    return new Promise<Response>((respond) => {
      this.held.set(id, { request, body, forward, respond });
      const waiter = this.waiting.shift();
      if (waiter) waiter(paused);
      else this.queue.push(paused);
    });
  }

  /** The next held request, once there is one. */
  next(): Promise<PausedRequest> {
    const paused = this.queue.shift();
    if (paused) return Promise.resolve(paused);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  /** Send a held request on to the Host without releasing it. */
  async fetch(
    id: number,
    overrides: RequestOverrides,
  ): Promise<RoutedResponse> {
    const held = this.held.get(id);
    if (!held) throw new Error(`test routes: request ${id} is not held`);
    const response = await held.forward(this.rebuild(held, overrides));
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()).toString("base64"),
    };
  }

  /** Release a held request with the test's decision. */
  async settle(id: number, decision: RouteDecision): Promise<void> {
    const held = this.held.get(id);
    if (!held) return;
    this.held.delete(id);
    if (decision.kind === "abort") {
      held.respond(Response.error());
      return;
    }
    if (decision.kind === "fulfill") {
      const headers = new Headers(decision.headers);
      for (const name of BODY_FRAMING_HEADERS) headers.delete(name);
      held.respond(
        new Response(
          NULL_BODY_STATUSES.has(decision.status)
            ? null
            : decode(decision.body),
          { status: decision.status, headers },
        ),
      );
      return;
    }
    try {
      held.respond(await held.forward(this.rebuild(held, decision)));
    } catch {
      held.respond(Response.error());
    }
  }

  private rebuild(held: Held, overrides: RequestOverrides): Request {
    const method = overrides.method ?? held.request.method;
    const body = decode(overrides.body) ?? held.body;
    return new Request(overrides.url ?? held.request.url, {
      method,
      headers: overrides.headers ?? held.request.headers,
      ...(body && method !== "GET" && method !== "HEAD" ? { body } : {}),
      signal: held.request.signal,
    });
  }
}
