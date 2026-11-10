import { readFileSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { OperationRegistry } from "@dramaip/infra-operations";
import {
  defineRoute,
  defineRouteContribution,
} from "@dramaip/plugin-api/internal";
import {
  remoteErrorOf,
  remoteMethods,
  type TypertRemoteInfo,
} from "@dramaip/infra-typert-protocol";
import MediaController, { replacedOperations } from "../src/index.ts";
import { mediaLegacyRoutes } from "../src/legacy.ts";

type Seen = {
  method: string;
  path: string;
  search: string;
  body?: unknown;
  ifMatch?: string;
  idempotencyKey?: string;
};
type Route = (typeof mediaLegacyRoutes)["routes"][number];
type Method = (...args: unknown[]) => Promise<unknown>;

const problemOperation: string = mediaLegacyRoutes.routes[0].operationId;

/** The original write headers a request carried. */
function headersOf(request: Request) {
  const ifMatch = request.headers.get("if-match");
  const idempotencyKey = request.headers.get("idempotency-key");
  return {
    ...(ifMatch === null ? {} : { ifMatch }),
    ...(idempotencyKey === null ? {} : { idempotencyKey }),
  };
}

/** A route of the media plugin at the replaced operation's method and path. */
function route(entry: Route, seen: Seen[]) {
  const method = entry.method.toLowerCase() as "get";
  return defineRouteContribution({
    id: `media:${entry.operationId}`,
    pluginId: "media",
    method,
    path: entry.path,
    operationId: entry.operationId,
    declaration: defineRoute({
      method,
      path: entry.path,
      operationId: entry.operationId,
      responses: { 200: { description: "Answer" } },
    }),
    handler: async (c: { req: { raw: Request } }) => {
      const request = c.req.raw;
      const url = new URL(request.url);
      const text = await request.text();
      seen.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        ...(text ? { body: JSON.parse(text) as unknown } : {}),
        ...headersOf(request),
      });
      // A write that read an older version is refused, as the handlers do.
      if (request.headers.get("if-match") === '"stale"')
        return Response.json(
          {
            type: "about:blank",
            title: "Version changed",
            status: 412,
            code: "PRECONDITION_FAILED",
          },
          { status: 412 },
        );
      if (entry.operationId === problemOperation)
        return Response.json(
          {
            type: "about:blank",
            title: "Package not found",
            status: 404,
            code: "NOT_FOUND",
          },
          { status: 404 },
        );
      return (entry.status as number) === 204
        ? new Response(null, { status: 204 })
        : Response.json(
            { operationId: entry.operationId },
            {
              status: entry.status,
            },
          );
    },
  });
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** The playback content route's handler: its media bytes, or a problem for a stale version. */
function playbackRoute(seen: Seen[]) {
  const path = "/api/v2/media-records/{id}/playback/content";
  return defineRouteContribution({
    id: "media:media-playback.read",
    pluginId: "media",
    method: "get",
    path,
    operationId: "media-playback.read",
    declaration: defineRoute({
      method: "get",
      path,
      operationId: "media-playback.read",
      responses: { 200: { description: "Media bytes" } },
    }),
    handler: async (c: { req: { raw: Request } }) => {
      const request = c.req.raw;
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        ...headersOf(request),
      });
      if (request.headers.get("if-match") !== '"v1"')
        return Response.json(
          {
            type: "about:blank",
            title: "Version changed",
            status: 412,
            code: "PRECONDITION_FAILED",
          },
          { status: 412 },
        );
      return new Response(new Uint8Array([0, 1, 2, 255]), {
        headers: { "content-type": "video/mp4", "content-length": "4" },
      });
    },
  });
}

async function boot(admit: () => object = () => ({})) {
  const registry = new OperationRegistry();
  const seen: Seen[] = [];
  const prefixes = new Map<string, Handler>();
  // The router matches in registration order; like the plugin, register a
  // literal path before the template it also fits.
  const params = (entry: Route) => entry.path.split("{").length;
  for (const entry of [...mediaLegacyRoutes.routes].sort(
    (a, b) => params(a) - params(b),
  ))
    registry.register(route(entry, seen));
  registry.register(playbackRoute(seen));
  const ctx = new Context();
  ctx.provide("operations", registry);
  ctx.provide("connection", { admit });
  ctx.provide("webServer", {
    register(route: { kind: string; path: string; handler: Handler }) {
      prefixes.set(route.path, route.handler);
      return () => prefixes.delete(route.path);
    },
  });
  const fiber = ctx.plugin(MediaController);
  await fiber.await();
  registry.publish();
  return { fiber, registry, seen, prefixes, controller: ctx.mediaController };
}

/** Serve `handler` on a loopback port for one request. */
async function served(
  handler: Handler,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, init);
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The positional arguments a test call passes, by where each travels. */
function argsOf(entry: Route): unknown[] {
  return entry.args.map((arg) =>
    arg.from === "param"
      ? `${arg.name}-1`
      : arg.from === "query"
        ? { limit: 5 }
        : arg.from === "body"
          ? { note: arg.name }
          : undefined,
  );
}

/** The first write of the table that is not the problem operation. */
const write = mediaLegacyRoutes.routes.find(
  (entry) => entry.method !== "GET" && entry.operationId !== problemOperation,
)!;

/** `write`'s arguments with the original write headers set. */
function writeArgs(ifMatch: string, idempotencyKey: string): unknown[] {
  return write.args.map((arg, index) =>
    arg.from === "ifMatch"
      ? ifMatch
      : arg.from === "idempotencyKey"
        ? idempotencyKey
        : argsOf(write)[index],
  );
}

describe("media Remote namespace", () => {
  it("names every replaced operation exactly once", async () => {
    const { controller } = await boot();
    expect(new Set(replacedOperations).size).toBe(replacedOperations.length);
    expect(remoteMethods(controller).length).toBe(replacedOperations.length);
  });

  it("maps the media operations of the frozen ledger, at their method and path, besides the routed playback content", () => {
    const ledger = JSON.parse(
      readFileSync(
        new URL(
          "../../../../architecture/refactor-ledger.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      operations: {
        operationId: string;
        method: string;
        path: string;
        domain: string;
      }[];
    };
    const frozen = ledger.operations
      .filter(
        (operation) =>
          operation.domain === "media" &&
          operation.operationId !== "media-playback.read",
      )
      .map(({ operationId, method, path }) => ({
        operationId,
        method: method.toUpperCase(),
        path,
      }))
      .sort((a, b) => a.operationId.localeCompare(b.operationId));
    const table = mediaLegacyRoutes.routes
      .map(({ operationId, method, path }) => ({ operationId, method, path }))
      .sort((a, b) => a.operationId.localeCompare(b.operationId));
    expect(table).toEqual(frozen);
  });

  it("names each argument as the generated Remote descriptor does", async () => {
    // Loaded at run time: the generator reads this spec, and its program must
    // not depend on the artifact it writes.
    const artifact = new URL("../lib/typert.remote-client.js", import.meta.url);
    const { default: remote } = (await import(artifact.href)) as {
      default: TypertRemoteInfo;
    };
    const parameters = (method: string) =>
      remote.descriptors
        .find((descriptor) => descriptor.method === method)
        ?.parameters.map(({ name }) => name);
    for (const entry of mediaLegacyRoutes.routes)
      expect(entry.args.map(({ name }) => name)).toEqual(
        parameters(entry.remote),
      );
  });

  it("runs every replaced handler at its method and path, with its query and body", async () => {
    const { controller, seen } = await boot();
    const methods = controller as unknown as Record<string, Method>;
    for (const entry of mediaLegacyRoutes.routes) {
      if (entry.operationId === problemOperation) continue;
      seen.length = 0;
      const value = await methods[entry.remote]!.call(
        controller,
        ...argsOf(entry),
      );
      expect(value).toEqual(
        (entry.status as number) === 204
          ? undefined
          : { operationId: entry.operationId },
      );
      const body = entry.args.find((arg) => arg.from === "body");
      expect(seen).toEqual([
        {
          method: entry.method,
          path: entry.path.replace(/\{([^}]+)\}/gu, "$1-1"),
          search: entry.args.some((arg) => arg.from === "query")
            ? "?limit=5"
            : "",
          ...(body === undefined ? {} : { body: { note: body.name } }),
        },
      ]);
    }
  });

  it("forwards the project query that the generic resource lists read", async () => {
    // The OpenAPI omits these query reads; the generator's `queries` declares them.
    const { controller, seen } = await boot();
    const methods = controller as unknown as Record<string, Method>;
    for (const remote of [
      "assetsList",
      "audioList",
      "imageList",
      "rendersList",
      "rightsList",
      "shotStillsList",
      "videoList",
      "visualAssetsList",
    ]) {
      seen.length = 0;
      await methods[remote]!.call(controller, { projectId: "project-1" });
      expect(seen).toMatchObject([{ search: "?projectId=project-1" }]);
    }
  });

  it("takes its operations off the served /api/v2 surface and gives them back on dispose", async () => {
    const { fiber, registry } = await boot();
    const [first] = mediaLegacyRoutes.routes.filter(
      (entry) =>
        entry.method === "GET" && entry.operationId !== problemOperation,
    );
    const url = `http://local${first!.path.replace(/\{([^}]+)\}/gu, "$1-1")}`;
    expect((await registry.fetch(new Request(url))).status).toBe(404);
    await fiber.dispose();
    expect((await registry.fetch(new Request(url))).status).toBe(200);
  });

  it("answers a handler's problem as the compat/problem RemoteError", async () => {
    const { controller } = await boot();
    const entry = mediaLegacyRoutes.routes[0];
    const methods = controller as unknown as Record<string, Method>;
    const failure = await methods[entry.remote]!.call(
      controller,
      ...argsOf(entry),
    ).then(
      () => undefined,
      (error: unknown) => remoteErrorOf(error),
    );
    expect(failure).toMatchObject({
      code: "compat/problem",
      message: "Package not found",
      details: { status: 404, code: "NOT_FOUND" },
    });
  });

  it("takes the original If-Match and Idempotency-Key on every write", async () => {
    const { controller, seen } = await boot();
    const methods = controller as unknown as Record<string, Method>;
    for (const entry of mediaLegacyRoutes.routes) {
      const headers = entry.args
        .filter(
          (arg) => arg.from === "ifMatch" || arg.from === "idempotencyKey",
        )
        .map((arg) => arg.from);
      expect(headers).toEqual(
        entry.method === "GET" ? [] : ["ifMatch", "idempotencyKey"],
      );
    }
    seen.length = 0;
    await methods[write.remote]!.call(
      controller,
      ...writeArgs('"v1"', "30000000-0000-4000-8000-000000000001"),
    );
    expect(seen).toMatchObject([
      {
        ifMatch: '"v1"',
        idempotencyKey: "30000000-0000-4000-8000-000000000001",
      },
    ]);
  });

  it("answers a write against a changed version as the handler's 412", async () => {
    const { controller } = await boot();
    const methods = controller as unknown as Record<string, Method>;
    const failure = await methods[write.remote]!.call(
      controller,
      ...writeArgs('"stale"', "30000000-0000-4000-8000-000000000002"),
    ).then(
      () => undefined,
      (error: unknown) => remoteErrorOf(error),
    );
    expect(failure).toMatchObject({
      code: "compat/problem",
      details: { status: 412, code: "PRECONDITION_FAILED" },
    });
  });

  it("replays a repeated write by its key without running the handler again", async () => {
    const { controller, seen } = await boot();
    const methods = controller as unknown as Record<string, Method>;
    seen.length = 0;
    const args = writeArgs('"v1"', "30000000-0000-4000-8000-000000000003");
    const first = await methods[write.remote]!.call(controller, ...args);
    const again = await methods[write.remote]!.call(controller, ...args);
    expect(again).toEqual(first);
    expect(seen).toHaveLength(1);
  });
  it("serves the playback content bytes at their /api/v2 URL with the original If-Match", async () => {
    const { prefixes, seen } = await boot();
    const handler = prefixes.get("/api/v2/media-records")!;
    expect(handler).toBeDefined();
    seen.length = 0;
    const response = await served(
      handler,
      "/api/v2/media-records/record%201/playback/content?expectedSha256=abc",
      { headers: { "if-match": '"v1"' } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("4");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      0, 1, 2, 255,
    ]);
    expect(seen).toEqual([
      {
        method: "GET",
        path: "/api/v2/media-records/record%201/playback/content",
        search: "?expectedSha256=abc",
        ifMatch: '"v1"',
      },
    ]);
  });

  it("answers a stale playback version as the handler's problem, and other paths as 404", async () => {
    const { prefixes } = await boot();
    const handler = prefixes.get("/api/v2/media-records")!;
    const stale = await served(
      handler,
      "/api/v2/media-records/record-1/playback/content",
      { headers: { "if-match": '"stale"' } },
    );
    expect(stale.status).toBe(412);
    expect(await stale.json()).toMatchObject({ code: "PRECONDITION_FAILED" });
    // Every other media-record operation is a Remote method now.
    const other = await served(handler, "/api/v2/media-records/record-1");
    expect(other.status).toBe(404);
  });

  it("refuses a playback request the connection does not admit", async () => {
    const { prefixes, seen } = await boot(() => ({ rejection: 401 }));
    seen.length = 0;
    const response = await served(
      prefixes.get("/api/v2/media-records")!,
      "/api/v2/media-records/record-1/playback/content",
      { headers: { "if-match": '"v1"' } },
    );
    expect(response.status).toBe(401);
    expect(seen).toEqual([]);
  });

  it("takes the playback operation off the compat router and gives it back on dispose", async () => {
    const { fiber, registry, prefixes } = await boot();
    const url = "http://local/api/v2/media-records/record-1/playback/content";
    const init = { headers: { "if-match": '"v1"' } };
    expect((await registry.fetch(new Request(url, init))).status).toBe(404);
    await fiber.dispose();
    expect((await registry.fetch(new Request(url, init))).status).toBe(200);
    expect(prefixes.size).toBe(0);
  });
});
