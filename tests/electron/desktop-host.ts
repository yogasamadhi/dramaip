/**
 * Test access to the Desktop Host behind the Electron shell. The window's
 * page never holds the Host's credential; an isolated E2E run reads the
 * shell's authenticated connection from Main through its test hook and calls
 * the Host from the test process with that cookie.
 */
import { _electron, type ElectronApplication, type Page } from "playwright";
import {
  compileLegacyTables,
  LEGACY_TABLES,
  legacyAnswer,
  legacyArgs,
  legacyFailure,
} from "../../packages/workspace/studio-client/src/client/remote-bridge";
import { routeThroughShell } from "./host-routes";

/** The Host's origin and the shell-issued cookie for test-side requests. */
export interface HostAccess {
  readonly baseUrl: string;
  readonly cookie: string;
  /** Kept for runtime descriptors; the Host authenticates by cookie only. */
  readonly accessToken: string;
}

interface ShellTestHook {
  hostPid(): number | undefined;
  crashHost(): void;
  connection(): { origin: string; cookie: string } | undefined;
  ready(): Promise<void> | undefined;
}

const launched = new Set<ElectronApplication>();
const cookies = new Map<string, string>();

/**
 * `_electron` that remembers each application, so pages map back to their
 * shell, and routes its windows' `page.route` through the shell
 * (`host-routes.ts`).
 */
export const electron = {
  async launch(
    options: Parameters<typeof _electron.launch>[0] = {},
  ): Promise<ElectronApplication> {
    const application = await _electron.launch(options);
    launched.add(application);
    application.once("close", () => launched.delete(application));
    routeThroughShell(application);
    return application;
  },
};

function owner(page: Page): ElectronApplication {
  for (const application of launched)
    if (application.windows().includes(page)) return application;
  throw new Error("desktop-host: the page belongs to no launched shell");
}

/**
 * The Host behind a shell, once it is ready.
 * @param target - the shell or one of its windows.
 * @returns origin and cookie.
 */
export async function hostAccess(
  target: Page | ElectronApplication,
): Promise<HostAccess> {
  const application = "firstWindow" in target ? target : owner(target);
  const connection = await application.evaluate(async () => {
    const hook = (globalThis as { __DRAMAIP_E2E_SHELL__?: ShellTestHook })
      .__DRAMAIP_E2E_SHELL__;
    if (!hook) throw new Error("the shell runs without its E2E hook");
    await hook.ready();
    return hook.connection();
  });
  if (!connection) throw new Error("desktop-host: the Host is not connected");
  cookies.set(connection.origin, connection.cookie);
  return {
    baseUrl: connection.origin,
    cookie: connection.cookie,
    accessToken: "",
  };
}

/** The Host's process id, for process assertions. */
export async function hostPid(
  application: ElectronApplication,
): Promise<number | undefined> {
  return application.evaluate(() =>
    (
      globalThis as { __DRAMAIP_E2E_SHELL__?: ShellTestHook }
    ).__DRAMAIP_E2E_SHELL__?.hostPid(),
  );
}

/** Kill the Host abruptly, as a crash would. */
export async function crashHost(
  application: ElectronApplication,
): Promise<void> {
  await application.evaluate(() =>
    (
      globalThis as { __DRAMAIP_E2E_SHELL__?: ShellTestHook }
    ).__DRAMAIP_E2E_SHELL__?.crashHost(),
  );
}

/**
 * `fetch` for runtime clients: requests to a known Host carry its cookie in
 * place of any bearer header. The connection manager's health and runtime
 * probes, whose routes the `system` Remote namespace took over, are answered
 * by `system/health` and `system/runtime`, as the window's bridge answers them.
 */
export const hostFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const cookie = cookies.get(url.origin);
  if (cookie === undefined) return fetch(request);
  const probe =
    request.method !== "GET"
      ? undefined
      : url.pathname === "/api/v2/runtime"
        ? "system/runtime"
        : url.pathname === "/health"
          ? "system/health"
          : undefined;
  if (probe !== undefined) {
    const result = await hostRemote(
      { baseUrl: url.origin, cookie, accessToken: "" },
      probe,
    );
    return new Response(JSON.stringify(result.ok ? result.value : {}), {
      status: result.ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const bridged = await legacyRemoteRequest(request, url, cookie);
  if (bridged !== undefined) return bridged;
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("cookie", cookie);
  return fetch(new Request(request, { headers }));
};

const legacyRoutes = compileLegacyTables(LEGACY_TABLES);

/**
 * Answer an `/api/v2` path a domain controller took over (P4/P5) from its
 * Remote method, as the app's bridge does in the page.
 */
async function legacyRemoteRequest(
  request: Request,
  url: URL,
  cookie: string,
): Promise<Response | undefined> {
  if (!url.pathname.startsWith("/api/v2/")) return undefined;
  for (const { namespace, route, pattern, names } of legacyRoutes) {
    // No spec reads an event stream over HTTP; the Remote stream carrier
    // is the WebSocket the page holds.
    if (route.method !== request.method || route.stream === true) continue;
    const match = pattern.exec(url.pathname);
    if (match === null) continue;
    const params = Object.fromEntries(
      names.map((name, index) => [name, decodeURIComponent(match[index + 1]!)]),
    );
    const positional = await legacyArgs(route.args, params, {
      url,
      headers: request.headers,
      text: () => request.text(),
    });
    const args = Object.fromEntries(
      positional.map((value, index) => [route.args[index]!.name, value]),
    );
    const result = await hostRemote(
      { baseUrl: url.origin, cookie, accessToken: "" },
      `${namespace}/${route.remote}`,
      args,
    );
    return result.ok
      ? legacyAnswer(route, result.value)
      : legacyFailure(result.error);
  }
  return undefined;
}

/** The answer of one unary Remote call over HTTP. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { code: string; message: string; details?: unknown };
    };

/**
 * Call one unary Remote method of the Host from the test process.
 * @param access - the Host and its cookie.
 * @param endpoint - `<namespace>/<method>`, e.g. `system/runtime`.
 * @param args - the method's arguments by parameter name.
 * @returns the call's result envelope.
 */
export async function hostRemote<T = unknown>(
  access: HostAccess,
  endpoint: string,
  args: Record<string, unknown> = {},
): Promise<RemoteResult<T>> {
  const response = await fetch(new URL(`/api/${endpoint}`, access.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", cookie: access.cookie },
    body: JSON.stringify({
      type: "client-request",
      rpcId: crypto.randomUUID(),
      method: endpoint,
      payload: { args },
    }),
  });
  const body = (await response.json()) as { result?: RemoteResult<T> };
  if (body.result === undefined)
    throw new Error(`desktop-host: ${endpoint} answered ${response.status}`);
  return body.result;
}

/** The value of a Remote call that must succeed. */
export async function hostRemoteValue<T = unknown>(
  access: HostAccess,
  endpoint: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await hostRemote<T>(access, endpoint, args);
  if (!result.ok)
    throw new Error(
      `desktop-host: ${endpoint} failed with ${result.error.code}: ${result.error.message}`,
    );
  return result.value;
}
