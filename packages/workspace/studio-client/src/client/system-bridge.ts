/**
 * Transitional bridge (P4-a): the existing Studio app still calls the
 * `/api/v2` system and runtime paths, which left the compat router when the
 * `system` Remote namespace took them over. The bridge answers those calls
 * from `ctx.remote.system` and passes every other request to the page's own
 * `fetch`. It is deleted with this package in P6.
 * @module @dramaip/workspace-studio-client/client/system-bridge
 */
import type { Context } from "@deepseek-ai/cordis";
import type {
  RemoteFailure,
  RemoteResult,
} from "@dramaip/infra-remotes/client";
import type {
  SystemCredentialCaptureInput,
  SystemEventEnvelope,
  SystemLocalModelRuntimeKind,
  SystemPickFilesOptions,
  SystemSaveTextInput,
} from "@dramaip/system-system/types";
import type {} from "@dramaip/system-system/remote";

type FetchLike = typeof fetch;

/** The request facts a bridged route reads. */
interface BridgedRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly signal: AbortSignal | undefined;
  json<T>(): Promise<T>;
}

type Route = (
  remote: Context["remote"],
  request: BridgedRequest,
  params: readonly string[],
) => Promise<Response>;

const LOCAL_RUNTIME_KINDS: readonly SystemLocalModelRuntimeKind[] = [
  "ollama",
  "lm_studio",
];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The answer the removed route gave for a Remote failure. */
function failure(error: RemoteFailure): Response {
  if (error.code === "system/host-unavailable")
    return json(
      { code: "HOST_UNAVAILABLE", title: "Desktop Host is unavailable" },
      503,
    );
  // The Gateway validates arguments at the Remote boundary, where the removed
  // routes passed them on unchecked.
  if (
    error.code === "gateway/bad-request" ||
    error.code === "gateway/input-invalid"
  )
    return json({ code: "VALIDATION_FAILED", title: error.message }, 400);
  // The router answered every other failure without its message.
  return json(
    { code: "INTERNAL_ERROR", title: "Unexpected runtime error" },
    500,
  );
}

/** Answer a unary call with its value, or with no body when it has none. */
async function answer<T>(
  call: Promise<RemoteResult<T>>,
  status: 200 | 201 | 204 = 200,
): Promise<Response> {
  const result = await call;
  if (!result.ok) return failure(result.error);
  return status === 204
    ? new Response(null, { status })
    : json(result.value, status);
}

function localKind(
  value: string | undefined,
): SystemLocalModelRuntimeKind | undefined {
  return LOCAL_RUNTIME_KINDS.find((kind) => kind === value);
}

/** Forward the event stream as the server-sent events the app parses. */
function eventStream(
  remote: Context["remote"],
  request: BridgedRequest,
): Response {
  const header = Number(request.headers.get("Last-Event-ID") ?? "0");
  const query = Number(request.url.searchParams.get("cursor") ?? "0");
  const cursor =
    Number.isSafeInteger(header) && header > 0
      ? header
      : Number.isSafeInteger(query) && query > 0
        ? query
        : 0;
  const handle = remote.system.events(cursor);
  const encoder = new TextEncoder();
  const frame = (envelope: SystemEventEnvelope): string => {
    const type = String(envelope.event.type ?? "message");
    const id = envelope.kind === "domain" ? `id: ${envelope.cursor}\n` : "";
    return `event: ${type}\n${id}data: ${JSON.stringify(envelope)}\n\n`;
  };
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stop = () => handle.dispose();
      request.signal?.addEventListener("abort", stop, { once: true });
      try {
        for await (const envelope of handle)
          controller.enqueue(encoder.encode(frame(envelope)));
        controller.close();
      } catch (error) {
        // The app reconnects from its last cursor when the stream errors.
        controller.error(error);
      } finally {
        request.signal?.removeEventListener("abort", stop);
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

/** The bridged paths: method and pattern, in the router's own terms. */
const ROUTES: readonly (readonly [string, RegExp, Route])[] = [
  ["GET", /^\/api\/v2\/health$/u, (remote) => answer(remote.system.health())],
  // The connection manager's discovery probe, which the router used to serve.
  ["GET", /^\/health$/u, (remote) => answer(remote.system.health())],
  ["GET", /^\/api\/v2\/version$/u, (remote) => answer(remote.system.version())],
  [
    "GET",
    /^\/api\/v2\/capabilities$/u,
    (remote) => answer(remote.system.capabilities()),
  ],
  ["GET", /^\/api\/v2\/runtime$/u, (remote) => answer(remote.system.runtime())],
  [
    "GET",
    /^\/api\/v2\/system\/diagnostics$/u,
    (remote) => answer(remote.system.diagnostics()),
  ],
  [
    "GET",
    /^\/api\/v2\/events$/u,
    async (remote, request) => eventStream(remote, request),
  ],
  [
    "POST",
    /^\/api\/v2\/system\/host\/files\/pick$/u,
    async (remote, request) =>
      answer(
        remote.system.pickFiles(await request.json<SystemPickFilesOptions>()),
      ),
  ],
  [
    "POST",
    /^\/api\/v2\/system\/host\/files\/save-text$/u,
    async (remote, request) =>
      answer(
        remote.system.saveTextFile(await request.json<SystemSaveTextInput>()),
      ),
  ],
  [
    "POST",
    /^\/api\/v2\/system\/host\/open-external$/u,
    async (remote, request) => {
      const { url } = await request.json<{ url: string }>();
      return answer(remote.system.openExternal(url), 204);
    },
  ],
  [
    "POST",
    /^\/api\/v2\/system\/host\/reveal-grant$/u,
    async (remote, request) => {
      const { grantId } = await request.json<{ grantId: string }>();
      return answer(remote.system.revealGrant(grantId), 204);
    },
  ],
  [
    "POST",
    /^\/api\/v2\/system\/host\/reveal-artifact$/u,
    async (remote, request) => {
      const { artifactRef } = await request.json<{ artifactRef: string }>();
      return answer(remote.system.revealArtifact(artifactRef), 204);
    },
  ],
  [
    "GET",
    /^\/api\/v2\/system\/host\/credentials\/status$/u,
    (remote) => answer(remote.system.credentialStatus()),
  ],
  [
    "POST",
    /^\/api\/v2\/system\/host\/credentials\/unlock-sessions$/u,
    (remote) => answer(remote.system.createCredentialUnlockSession(), 201),
  ],
  [
    "POST",
    /^\/api\/v2\/system\/host\/credentials\/capture-sessions$/u,
    async (remote, request) =>
      answer(
        remote.system.createCredentialCaptureSession(
          await request.json<SystemCredentialCaptureInput>(),
        ),
      ),
  ],
  [
    "GET",
    /^\/api\/v2\/system\/host\/credentials\/capture-sessions\/([^/]+)$/u,
    (remote, _request, [id]) =>
      answer(remote.system.credentialSession(decodeURIComponent(id!))),
  ],
  [
    "DELETE",
    /^\/api\/v2\/system\/host\/credentials\/([^/]+)$/u,
    (remote, _request, [ref]) =>
      answer(remote.system.removeCredential(decodeURIComponent(ref!)), 204),
  ],
  [
    "POST",
    /^\/api\/v2\/system\/host\/window\/theme$/u,
    async (remote, request) => {
      const { theme } = await request.json<{ theme: "light" | "dark" }>();
      return answer(remote.system.setWindowTheme(theme), 204);
    },
  ],
  [
    "GET",
    /^\/api\/v2\/local-model-runtimes$/u,
    (remote) => answer(remote.system.localModelRuntimes()),
  ],
  [
    "POST",
    /^\/api\/v2\/local-model-runtimes\/([^/]+)\/(activate|deactivate|health-checks)$/u,
    async (remote, _request, [raw, action]) => {
      const kind = localKind(raw);
      if (kind === undefined)
        return json({ code: "LOCAL_RUNTIME_UNKNOWN" }, 400);
      return answer(
        action === "activate"
          ? remote.system.activateLocalModelRuntime(kind)
          : action === "deactivate"
            ? remote.system.deactivateLocalModelRuntime(kind)
            : remote.system.checkLocalModelRuntime(kind),
      );
    },
  ],
  [
    "GET",
    /^\/api\/v2\/local-model-runtimes\/([^/]+)\/models$/u,
    async (remote, _request, [raw]) => {
      const kind = localKind(raw);
      if (kind === undefined)
        return json({ code: "LOCAL_RUNTIME_UNKNOWN" }, 400);
      return answer(remote.system.localModels(kind));
    },
  ],
];

/**
 * Answer one request from the `system` namespace when it names a bridged
 * same-origin path.
 * @returns the synthesized response, or undefined to pass the request on.
 */
export function bridgeSystemRequest(
  remote: Context["remote"],
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
  if (url.origin !== origin) return undefined;
  const method = (
    init?.method ?? (input instanceof Request ? input.method : "GET")
  ).toUpperCase();
  for (const [routeMethod, pattern, route] of ROUTES) {
    if (routeMethod !== method) continue;
    const match = pattern.exec(url.pathname);
    if (match === null) continue;
    const request =
      input instanceof Request
        ? init === undefined
          ? input
          : new Request(input, init)
        : new Request(url, init);
    return route(
      remote,
      {
        method,
        url,
        headers: request.headers,
        signal: request.signal,
        json: async <T>() => {
          const text = await request.text();
          return (text ? JSON.parse(text) : {}) as T;
        },
      },
      match.slice(1),
    );
  }
  return undefined;
}

/**
 * Route the page's `fetch` through the bridge. The app's connection manager
 * captures `fetch` when it is created, which is after this runs.
 * @param ctx - Client Context whose `remote.system` answers the bridged paths.
 * @returns disposer restoring the page's own `fetch`.
 */
export function installSystemBridge(ctx: Context): () => void {
  const pageFetch: FetchLike = window.fetch;
  const bridged: FetchLike = (input, init) =>
    bridgeSystemRequest(ctx.remote, input, init, location.origin) ??
    pageFetch.call(window, input, init);
  window.fetch = bridged;
  return () => {
    if (window.fetch === bridged) window.fetch = pageFetch;
  };
}
