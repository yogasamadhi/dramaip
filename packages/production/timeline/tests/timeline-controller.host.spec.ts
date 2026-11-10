import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
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
import TimelineController, { replacedOperations } from "../src/index.ts";
import { timelineLegacyRoutes } from "../src/legacy.ts";

type Seen = {
  method: string;
  path: string;
  search: string;
  body?: unknown;
  ifMatch?: string;
  idempotencyKey?: string;
};
type Route = (typeof timelineLegacyRoutes)["routes"][number];
type Method = (...args: unknown[]) => Promise<unknown>;
type StreamMethod = (...args: unknown[]) => AsyncIterable<unknown>;

/** The render whose event stream answers a problem, as for an unknown render. */
const missingRun = "missing";
/** Set when the open-ended stream's reader went away. */
const cancelled = { value: false };

/** The events a stream handler writes: one replayed, one live, then a keep-alive comment. */
function eventStream(url: URL): Response {
  const encoder = new TextEncoder();
  const frames = [
    `event: timeline.render.progress\nid: 8\ndata: {"cursor":8,"search":"${url.search}"}\n\n`,
    `event: timeline.render.status\r\nid: live-1\r\ndata: {"live":true}\r\n\r\n`,
    ": keep-alive\n\n",
  ];
  // A running render keeps its stream open until the reader goes away.
  const open = url.pathname.includes("open-1");
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        if (!open) controller.close();
      },
      cancel() {
        cancelled.value = true;
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const problemOperation: string = timelineLegacyRoutes.routes[0].operationId;

/** The original write headers a request carried. */
function headersOf(request: Request) {
  const ifMatch = request.headers.get("if-match");
  const idempotencyKey = request.headers.get("idempotency-key");
  return {
    ...(ifMatch === null ? {} : { ifMatch }),
    ...(idempotencyKey === null ? {} : { idempotencyKey }),
  };
}

/** A route of the timeline plugin at the replaced operation's method and path. */
function route(entry: Route, seen: Seen[]) {
  const method = entry.method.toLowerCase() as "get";
  return defineRouteContribution({
    id: `timeline:${entry.operationId}`,
    pluginId: "timeline",
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
      if ("stream" in entry && entry.stream === true)
        return url.pathname.includes(missingRun)
          ? Response.json(
              {
                type: "about:blank",
                title: "未找到渲染任务。",
                status: 404,
                code: "NOT_FOUND",
              },
              { status: 404 },
            )
          : eventStream(url);
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

async function boot() {
  const registry = new OperationRegistry();
  const seen: Seen[] = [];
  // The router matches in registration order; like the plugin, register a
  // literal path before the template it also fits.
  const params = (entry: Route) => entry.path.split("{").length;
  for (const entry of [...timelineLegacyRoutes.routes].sort(
    (a, b) => params(a) - params(b),
  ))
    registry.register(route(entry, seen));
  const ctx = new Context();
  ctx.provide("operations", registry);
  const fiber = ctx.plugin(TimelineController);
  await fiber.await();
  registry.publish();
  return { fiber, registry, seen, controller: ctx.timelineController };
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
          : arg.from === "cursor"
            ? 7
            : undefined,
  );
}

/** The streaming operation of the table. */
const stream = timelineLegacyRoutes.routes.find(
  (entry) => "stream" in entry && entry.stream === true,
)!;

/** Every event of the stream for `renderId`. */
async function eventsOf(
  controller: object,
  renderId: string,
  cursor: number,
  signal = new AbortController().signal,
): Promise<unknown[]> {
  const method = (controller as unknown as Record<string, StreamMethod>)[
    stream.remote
  ]!;
  const events: unknown[] = [];
  for await (const event of method.call(controller, renderId, cursor, signal))
    events.push(event);
  return events;
}

/** The first write of the table that is not the problem operation. */
const write = timelineLegacyRoutes.routes.find(
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

describe("timeline Remote namespace", () => {
  it("names every replaced operation exactly once", async () => {
    const { controller } = await boot();
    expect(new Set(replacedOperations).size).toBe(replacedOperations.length);
    expect(remoteMethods(controller).length).toBe(replacedOperations.length);
  });

  it("maps exactly the timeline operations of the frozen ledger, at their method and path", () => {
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
      .filter((operation) => operation.domain === "timeline")
      .map(({ operationId, method, path }) => ({
        operationId,
        method: method.toUpperCase(),
        path,
      }))
      .sort((a, b) => a.operationId.localeCompare(b.operationId));
    const table = timelineLegacyRoutes.routes
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
    for (const entry of timelineLegacyRoutes.routes)
      expect(entry.args.map(({ name }) => name)).toEqual(
        parameters(entry.remote),
      );
  });

  it("runs every replaced handler at its method and path, with its query and body", async () => {
    const { controller, seen } = await boot();
    const methods = controller as unknown as Record<string, Method>;
    for (const entry of timelineLegacyRoutes.routes) {
      if (entry.operationId === problemOperation || entry === stream) continue;
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

  it("takes its operations off the served /api/v2 surface and gives them back on dispose", async () => {
    const { fiber, registry } = await boot();
    const [first] = timelineLegacyRoutes.routes.filter(
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
    const entry = timelineLegacyRoutes.routes[0];
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
    for (const entry of timelineLegacyRoutes.routes) {
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

  it("streams a render's events as its handler wrote them, after the cursor", async () => {
    const { controller } = await boot();
    expect(stream.operationId).toBe("timeline.renderEvents");
    expect(await eventsOf(controller, "render-1", 7)).toEqual([
      {
        event: "timeline.render.progress",
        id: "8",
        data: { cursor: 8, search: "?cursor=7" },
      },
      { event: "timeline.render.status", id: "live-1", data: { live: true } },
    ]);
    // Cursor 0 replays the whole log, as the route did without a cursor.
    expect(await eventsOf(controller, "render-1", 0)).toMatchObject([
      { data: { search: "" } },
      {},
    ]);
  });

  it("answers an unknown render's stream as the compat/problem RemoteError", async () => {
    const { controller } = await boot();
    const failure = await eventsOf(controller, missingRun, 0).then(
      () => undefined,
      (error: unknown) => remoteErrorOf(error),
    );
    expect(failure).toMatchObject({
      code: "compat/problem",
      details: { status: 404, code: "NOT_FOUND" },
    });
  });

  it("closes the handler's stream when the caller cancels", async () => {
    const { controller } = await boot();
    const abort = new AbortController();
    const method = (controller as unknown as Record<string, StreamMethod>)[
      stream.remote
    ]!;
    cancelled.value = false;
    const seenEvents: unknown[] = [];
    for await (const event of method.call(
      controller,
      "open-1",
      0,
      abort.signal,
    )) {
      seenEvents.push(event);
      if (seenEvents.length === 2) abort.abort();
    }
    expect(seenEvents).toHaveLength(2);
    // The cancellation reaches the handler's body through the decoder pipe.
    await vi.waitFor(() => expect(cancelled.value).toBe(true));
  });
});
