/**
 * `page.route` for the Host traffic of a shell window. The window's API
 * requests are answered by the shell's `dramaip-app://` handler, which
 * Chromium's request interception (and so Playwright's) never sees. On a
 * shell window `page.route` and `page.unroute` therefore route through the
 * shell's E2E hook instead, at the point where the shell forwards a request
 * to the Host: the page, its requests and the Host stay exactly as in a real
 * run. Matching, handler order, `fallback`, `continue`, `fulfill`, `abort` and
 * `fetch` follow Playwright's semantics for the parts the suite uses.
 *
 * A Remote call of a method that replaced an `/api/v2` operation (P4/P5)
 * reaches the handlers as the `/api/v2` request it replaced, and their answer
 * goes back as the Remote response (./legacy-remote-routes). A measure call
 * the Host composes from single-page reads is composed here instead, each
 * read going through the handlers (./composite-remote-routes).
 */
import type { ElectronApplication, Page, Request, Route } from "playwright";
import {
  answerComposite,
  compositeRemotePattern,
} from "./composite-remote-routes";
import {
  legacyRemotePattern,
  legacyViewOf,
  type LegacyView,
} from "./legacy-remote-routes";

interface PausedRequest {
  readonly id: number;
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

interface RequestOverrides {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

interface RoutedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

type RouteDecision =
  | ({ readonly kind: "continue" } & RequestOverrides)
  | ({ readonly kind: "fulfill" } & RoutedResponse)
  | { readonly kind: "abort" };

interface RoutesHook {
  setPatterns(patterns: Array<{ source: string; flags: string }>): void;
  next(): Promise<PausedRequest>;
  fetch(id: number, overrides: RequestOverrides): Promise<RoutedResponse>;
  settle(id: number, decision: RouteDecision): Promise<void>;
}

type Hooked = typeof globalThis & {
  __DRAMAIP_E2E_SHELL__?: { routes?: RoutesHook };
};

/**
 * A request only the test process holds: a single-page read of a measure
 * composed here, sent through the shell as the held measure call.
 */
interface LocalHold {
  fetch(overrides: RequestOverrides): Promise<RoutedResponse>;
  settle(decision: RouteDecision): Promise<void>;
}

type Handler = (route: Route, request: Request) => unknown;
type UrlMatch = string | RegExp;

interface Registered {
  readonly url: UrlMatch;
  readonly pattern: RegExp;
  readonly handler: Handler;
}

const ESCAPED = new Set([
  "$",
  "^",
  "+",
  ".",
  "*",
  "(",
  ")",
  "|",
  "\\",
  "?",
  "{",
  "}",
  "[",
  "]",
]);

/** Playwright's glob: `**` spans `/`, `*` does not, `?` is literal, `{a,b}` alternates. */
function globToRegExp(glob: string): RegExp {
  const tokens = ["^"];
  let inGroup = false;
  for (let i = 0; i < glob.length; ++i) {
    const c = glob[i]!;
    if (c === "\\" && i + 1 < glob.length) {
      const next = glob[++i]!;
      tokens.push(ESCAPED.has(next) ? `\\${next}` : next);
    } else if (c === "*") {
      const before = glob[i - 1];
      let stars = 1;
      while (glob[i + 1] === "*") {
        stars++;
        i++;
      }
      if (stars === 1) tokens.push("([^/]*)");
      else if (glob[i + 1] === "/") {
        tokens.push(before === "/" ? "((.+/)|)" : "(.*/)");
        ++i;
      } else tokens.push("(.*)");
    } else if (c === "{") {
      inGroup = true;
      tokens.push("(");
    } else if (c === "}") {
      inGroup = false;
      tokens.push(")");
    } else if (c === ",") tokens.push(inGroup ? "|" : "\\,");
    else tokens.push(ESCAPED.has(c) ? `\\${c}` : c);
  }
  tokens.push("$");
  return new RegExp(tokens.join(""));
}

const toRegExp = (url: UrlMatch) =>
  typeof url === "string" ? globToRegExp(url) : url;

const base64 = (value: string | Buffer) =>
  Buffer.from(value).toString("base64");

/** The `APIResponse` subset `route.fetch()` returns. */
class FetchedResponse {
  constructor(
    private readonly requestUrl: string,
    readonly routed: RoutedResponse,
  ) {}
  status() {
    return this.routed.status;
  }
  ok() {
    return this.routed.status >= 200 && this.routed.status < 300;
  }
  url() {
    return this.requestUrl;
  }
  headers() {
    return { ...this.routed.headers };
  }
  async body() {
    return Buffer.from(this.routed.body, "base64");
  }
  async text() {
    return (await this.body()).toString("utf8");
  }
  async json() {
    return JSON.parse(await this.text()) as unknown;
  }
}

/** The `Request` subset handlers read. */
class HeldRequest {
  constructor(private readonly paused: PausedRequest) {}
  url() {
    return this.paused.url;
  }
  method() {
    return this.paused.method;
  }
  headers() {
    return { ...this.paused.headers };
  }
  async allHeaders() {
    return this.headers();
  }
  headerValue(name: string) {
    return Promise.resolve(this.paused.headers[name.toLowerCase()] ?? null);
  }
  postDataBuffer() {
    return this.paused.body === undefined
      ? null
      : Buffer.from(this.paused.body, "base64");
  }
  postData() {
    return this.postDataBuffer()?.toString("utf8") ?? null;
  }
  postDataJSON() {
    const text = this.postData();
    return text === null ? null : (JSON.parse(text) as unknown);
  }
}

interface ContinueOptions {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  postData?: string | Buffer | unknown;
}

interface FulfillOptions {
  status?: number;
  headers?: Record<string, string>;
  contentType?: string;
  body?: string | Buffer;
  json?: unknown;
  response?: FetchedResponse;
}

function overridesOf(options: ContinueOptions = {}): RequestOverrides {
  const { postData } = options;
  return {
    ...(options.url ? { url: options.url } : {}),
    ...(options.method ? { method: options.method } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(postData === undefined
      ? {}
      : {
          body: base64(
            typeof postData === "string" || Buffer.isBuffer(postData)
              ? postData
              : JSON.stringify(postData),
          ),
        }),
  };
}

/** One handler's view of a held request. */
class HeldRoute {
  /** true once the request is answered; false when the handler falls back. */
  readonly handled: Promise<boolean>;
  private finish!: (handled: boolean) => void;
  private done = false;
  private readonly held: HeldRequest;

  constructor(
    private readonly application: ElectronApplication,
    private readonly paused: PausedRequest,
    private readonly inherited: RequestOverrides,
    private readonly fallen: (overrides: RequestOverrides) => void,
    /** The `/api/v2` view of a Remote request, when it is one. */
    private readonly view?: LegacyView,
    /** Where a request only the test process holds is sent and answered. */
    private readonly local?: LocalHold,
  ) {
    this.handled = new Promise((resolve) => (this.finish = resolve));
    this.held = new HeldRequest(
      view === undefined ? paused : { id: paused.id, ...view.request },
    );
  }

  /** Overrides change the replaced request, which no longer travels. */
  private plain(overrides: RequestOverrides) {
    if (this.view !== undefined && Object.keys(overrides).length > 0)
      throw new Error(
        `${this.held.url()} travels as a Remote call: continue it unchanged or fulfill it`,
      );
  }

  request() {
    return this.held;
  }

  private claim() {
    if (this.done) throw new Error("Route is already handled!");
    this.done = true;
  }

  private settle(decision: RouteDecision) {
    if (this.local !== undefined)
      return this.local.settle(decision).finally(() => this.finish(true));
    return this.application
      .evaluate(
        (_electron, { id, decision }) =>
          (globalThis as Hooked).__DRAMAIP_E2E_SHELL__!.routes!.settle(
            id,
            decision,
          ),
        { id: this.paused.id, decision },
      )
      .catch(() => undefined)
      .finally(() => this.finish(true));
  }

  async fetch(options?: ContinueOptions) {
    const overrides = { ...this.inherited, ...overridesOf(options) };
    this.plain(overrides);
    const routed = this.local
      ? await this.local.fetch(overrides)
      : await this.application.evaluate(
          (_electron, { id, overrides }) =>
            (globalThis as Hooked).__DRAMAIP_E2E_SHELL__!.routes!.fetch(
              id,
              overrides,
            ),
          { id: this.paused.id, overrides },
        );
    if (this.view !== undefined)
      return new FetchedResponse(
        this.held.url(),
        await this.view.fromWire(routed),
      );
    return new FetchedResponse(overrides.url ?? this.paused.url, routed);
  }

  async continue(options?: ContinueOptions) {
    this.plain({ ...this.inherited, ...overridesOf(options) });
    this.claim();
    await this.settle({
      kind: "continue",
      ...this.inherited,
      ...overridesOf(options),
    });
  }

  async fallback(options?: ContinueOptions) {
    this.claim();
    this.fallen({ ...this.inherited, ...overridesOf(options) });
    this.finish(false);
  }

  async abort(_errorCode?: string) {
    this.claim();
    await this.settle({ kind: "abort" });
  }

  async fulfill(options: FulfillOptions = {}) {
    this.claim();
    const headers: Record<string, string> = {
      ...(options.response?.headers() ?? {}),
      ...(options.headers ?? {}),
    };
    let body: string;
    if (options.json !== undefined) {
      body = base64(JSON.stringify(options.json));
      if (!options.contentType && !headers["content-type"])
        headers["content-type"] = "application/json";
    } else if (options.body !== undefined) body = base64(options.body);
    else body = options.response?.routed.body ?? "";
    if (options.contentType) headers["content-type"] = options.contentType;
    const answer = {
      status: options.status ?? options.response?.status() ?? 200,
      headers,
      body,
    };
    await this.settle({
      kind: "fulfill",
      ...(this.view === undefined ? answer : this.view.toWire(answer)),
    });
  }
}

class ShellRoutes {
  private readonly routes: Registered[] = [];
  private pumping = false;

  constructor(private readonly application: ElectronApplication) {}

  private async sync() {
    const patterns = this.routes.map(({ pattern }) => ({
      source: pattern.source,
      flags: pattern.flags,
    }));
    // Hold the Remote calls that replaced an `/api/v2` operation too, so a
    // handler of that operation's path still sees them, and the measure
    // calls, so their single-page reads do.
    if (patterns.length > 0)
      patterns.push(
        {
          source: legacyRemotePattern.source,
          flags: legacyRemotePattern.flags,
        },
        {
          source: compositeRemotePattern.source,
          flags: compositeRemotePattern.flags,
        },
      );
    await this.application.evaluate((_electron, patterns) => {
      const hook = (globalThis as Hooked).__DRAMAIP_E2E_SHELL__?.routes;
      if (!hook) throw new Error("the shell runs without its E2E route hook");
      hook.setPatterns(patterns);
    }, patterns);
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    for (;;) {
      let paused: PausedRequest;
      try {
        paused = await this.application.evaluate(() =>
          (globalThis as Hooked).__DRAMAIP_E2E_SHELL__!.routes!.next(),
        );
      } catch {
        return; // The shell has closed.
      }
      void this.dispatch(paused);
    }
  }

  /** Forward a request through the shell as the held request `id`. */
  private forward(id: number, request: RequestOverrides) {
    return this.application.evaluate(
      (_electron, { id, request }) =>
        (globalThis as Hooked).__DRAMAIP_E2E_SHELL__!.routes!.fetch(
          id,
          request,
        ),
      { id, request },
    );
  }

  /**
   * Answer a request only the test process holds: through the handlers, as
   * a held request would be, else from the Host.
   * @param id - the held request it is sent as.
   * @param request - the request.
   */
  private async dispatchLocal(
    id: number,
    request: Omit<PausedRequest, "id">,
  ): Promise<RoutedResponse> {
    const paused = { id, ...request };
    const send = (overrides: RequestOverrides) =>
      this.forward(id, {
        url: request.url,
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        ...overrides,
      });
    const view = legacyViewOf(paused);
    const candidates = [
      ...(view === undefined ? [] : [{ url: view.request.url, view }]),
      { url: request.url, view: undefined },
    ];
    for (const candidate of candidates)
      for (const registered of [...this.routes].reverse()) {
        registered.pattern.lastIndex = 0;
        if (!registered.pattern.test(candidate.url)) continue;
        let answer: RoutedResponse | undefined;
        let aborted = false;
        const route = new HeldRoute(
          this.application,
          paused,
          {},
          () => undefined,
          candidate.view,
          {
            fetch: send,
            async settle(decision) {
              if (decision.kind === "abort") aborted = true;
              else if (decision.kind === "fulfill") answer = decision;
              else {
                const { kind: _kind, ...overrides } = decision;
                answer = await send(overrides);
              }
            },
          },
        );
        try {
          await registered.handler(
            route as unknown as Route,
            route.request() as unknown as Request,
          );
        } catch (error) {
          console.error(`route handler for ${candidate.url} failed`, error);
        }
        if (!(await route.handled)) continue;
        if (aborted || answer === undefined)
          throw new Error(`${candidate.url} was aborted`);
        return answer;
      }
    return send({});
  }

  private async dispatch(paused: PausedRequest) {
    let overrides: RequestOverrides = {};
    if (compositeRemotePattern.test(new URL(paused.url).pathname)) {
      const decision: RouteDecision = await answerComposite(paused, (request) =>
        this.dispatchLocal(paused.id, request),
      ).then(
        (answer) =>
          answer === undefined
            ? { kind: "continue" }
            : { kind: "fulfill", ...answer },
        () => ({ kind: "abort" }),
      );
      await this.application
        .evaluate(
          (_electron, { id, decision }) =>
            (globalThis as Hooked).__DRAMAIP_E2E_SHELL__!.routes!.settle(
              id,
              decision,
            ),
          { id: paused.id, decision },
        )
        .catch(() => undefined);
      return;
    }
    const view = legacyViewOf(paused);
    if (view !== undefined) {
      for (const registered of [...this.routes].reverse()) {
        registered.pattern.lastIndex = 0;
        if (!registered.pattern.test(view.request.url)) continue;
        const route = new HeldRoute(
          this.application,
          paused,
          {},
          () => undefined,
          view,
        );
        try {
          await registered.handler(
            route as unknown as Route,
            route.request() as unknown as Request,
          );
        } catch (error) {
          console.error(`route handler for ${view.request.url} failed`, error);
        }
        if (await route.handled) return;
      }
    }
    // Like Playwright, the route registered last runs first.
    for (const registered of [...this.routes].reverse()) {
      registered.pattern.lastIndex = 0;
      if (!registered.pattern.test(paused.url)) continue;
      const route = new HeldRoute(
        this.application,
        paused,
        overrides,
        (next) => (overrides = next),
      );
      try {
        await registered.handler(
          route as unknown as Route,
          route.request() as unknown as Request,
        );
      } catch (error) {
        console.error(`route handler for ${paused.url} failed`, error);
      }
      if (await route.handled) return;
    }
    await this.application
      .evaluate(
        (_electron, { id, decision }) =>
          (globalThis as Hooked).__DRAMAIP_E2E_SHELL__!.routes!.settle(
            id,
            decision,
          ),
        {
          id: paused.id,
          decision: { kind: "continue" as const, ...overrides },
        },
      )
      .catch(() => undefined);
  }

  async route(url: UrlMatch, handler: Handler) {
    this.routes.push({ url, pattern: toRegExp(url), handler });
    await this.sync();
    void this.pump();
  }

  async unroute(url: UrlMatch, handler?: Handler) {
    const same = (a: UrlMatch, b: UrlMatch) =>
      a instanceof RegExp && b instanceof RegExp
        ? a.source === b.source && a.flags === b.flags
        : a === b;
    for (let i = this.routes.length - 1; i >= 0; i--) {
      const registered = this.routes[i]!;
      if (
        same(registered.url, url) &&
        (handler === undefined || registered.handler === handler)
      )
        this.routes.splice(i, 1);
    }
    await this.sync().catch(() => undefined);
  }

  async unrouteAll() {
    this.routes.length = 0;
    await this.sync().catch(() => undefined);
  }
}

const installed = new WeakSet<Page>();

/**
 * Route a shell window's `page.route` / `page.unroute` through its shell.
 * @param page - one of its windows.
 * @param routes - the shell's routes, shared by its windows.
 */
function install(page: Page, routes: ShellRoutes) {
  if (installed.has(page)) return;
  installed.add(page);
  Object.assign(page, {
    route: (url: UrlMatch, handler: Handler) => routes.route(url, handler),
    unroute: (url: UrlMatch, handler?: Handler) => routes.unroute(url, handler),
    unrouteAll: () => routes.unrouteAll(),
  });
}

/** Give every window of a shell routing through the shell. */
export function routeThroughShell(application: ElectronApplication): void {
  const routes = new ShellRoutes(application);
  for (const page of application.windows()) install(page, routes);
  application.on("window", (page) => install(page, routes));
}
