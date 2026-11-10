import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  defineRoute,
  defineRouteContribution,
  streamEvents,
  type RouteContext,
  type RouteDeclaration,
  type RouteMethod,
  type RoutePolicy,
} from "@dramaip/plugin-api/internal";
import { OperationRegistry, serveNode } from "../src/index.ts";

const ORIGIN = "http://operations.test";

function contribution(
  path: `/api/v2/${string}`,
  handler: (context: RouteContext) => unknown,
  options: {
    method?: RouteMethod;
    operationId?: string;
    request?: RouteDeclaration["request"];
    policy?: Partial<RoutePolicy>;
  } = {},
) {
  const method = options.method ?? "get";
  const operationId = options.operationId ?? `test.${path}`;
  return defineRouteContribution({
    id: `test:${operationId}`,
    pluginId: "test",
    method,
    path,
    operationId,
    declaration: defineRoute({
      method,
      path,
      operationId,
      ...(options.request ? { request: options.request } : {}),
      responses: { 200: { description: "Answer" } },
    }),
    handler: handler as (...args: never[]) => unknown,
    ...(options.policy ? { policy: options.policy } : {}),
  });
}

function published(...contributions: ReturnType<typeof contribution>[]) {
  const registry = new OperationRegistry();
  for (const each of contributions) registry.register(each);
  registry.publish();
  return registry;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the route context", () => {
  it("reads decoded path parameters, every query value and headers by any case", async () => {
    let seen: unknown;
    const registry = published(
      contribution("/api/v2/items/{id}/parts/{part}", (c) => {
        seen = {
          id: c.req.param("id"),
          all: c.req.param(),
          tag: c.req.query("tag"),
          query: c.req.query(),
          tags: c.req.queries("tag"),
          none: c.req.queries("none"),
          header: c.req.header("x-sample"),
          path: c.req.path,
        };
        return c.json({ ok: true });
      }),
    );
    const response = await registry.fetch(
      new Request(
        `${ORIGIN}/api/v2/items/a%20b/parts/c?tag=one+two&tag=three&limit=5`,
        { headers: { "X-Sample": "yes" } },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(seen).toEqual({
      id: "a b",
      all: { id: "a b", part: "c" },
      tag: "one two",
      query: { tag: "one two", limit: "5" },
      tags: ["one two", "three"],
      none: undefined,
      header: "yes",
      path: "/api/v2/items/a%20b/parts/c",
    });
  });

  it("matches only the exact template, without a trailing slash", async () => {
    const registry = published(
      contribution("/api/v2/items/{id}", (c) => c.text("one")),
    );
    for (const path of ["/api/v2/items/1/", "/api/v2/items", "/api/v2/items/"])
      expect((await registry.fetch(new Request(`${ORIGIN}${path}`))).status)
        .toBe(404);
    expect(
      await (await registry.fetch(new Request(`${ORIGIN}/api/v2/items/1`))).text(),
    ).toBe("one");
  });

  it("builds responses from prepared headers, the init and the headers argument", async () => {
    const registry = published(
      contribution("/api/v2/headers", (c) => {
        c.header("ETag", '"3"');
        c.header("X-Removed", "soon");
        c.header("X-Removed", undefined);
        c.header("Vary", "Origin");
        c.header("Vary", "Accept", { append: true });
        c.status(202);
        return c.json({ ok: true }, undefined, { "X-Extra": ["a", "b"] });
      }),
      contribution("/api/v2/text", (c) =>
        c.text("plain", { status: 201, headers: { "X-Init": "1" } }),
      ),
      contribution("/api/v2/body", (c) => c.body(null, 204)),
    );
    const json = await registry.fetch(new Request(`${ORIGIN}/api/v2/headers`));
    expect(json.status).toBe(202);
    expect(json.headers.get("etag")).toBe('"3"');
    expect(json.headers.get("x-removed")).toBeNull();
    expect(json.headers.get("vary")).toBe("Origin, Accept");
    expect(json.headers.get("x-extra")).toBe("a, b");
    const text = await registry.fetch(new Request(`${ORIGIN}/api/v2/text`));
    expect(text.status).toBe(201);
    expect(text.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
    expect(text.headers.get("x-init")).toBe("1");
    const body = await registry.fetch(new Request(`${ORIGIN}/api/v2/body`));
    expect(body.status).toBe(204);
    expect(body.headers.get("content-type")).toBeNull();
  });

  it("reads the body once for its validation and its handler", async () => {
    const reads: unknown[] = [];
    const registry = published(
      contribution(
        "/api/v2/body",
        async (c) => {
          reads.push(await c.req.json(), await c.req.json(), await c.req.text());
          return c.json({ ok: true });
        },
        {
          method: "post",
          request: {
            body: {
              content: {
                "application/json": { schema: z.object({ n: z.number() }) },
              },
            },
          },
        },
      ),
    );
    const response = await registry.fetch(
      new Request(`${ORIGIN}/api/v2/body`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ n: 1 }),
      }),
    );
    expect(response.status).toBe(200);
    expect(reads).toEqual([{ n: 1 }, { n: 1 }, '{"n":1}']);
  });

  it("validates an optional JSON body only when the request says it sends JSON", async () => {
    let calls = 0;
    const body = (required: boolean) => ({
      required,
      content: {
        "application/json": { schema: z.object({ n: z.number() }).strict() },
      },
    });
    const registry = published(
      contribution(
        "/api/v2/optional",
        (c) => {
          calls++;
          return c.json({});
        },
        { method: "post", request: { body: body(false) } },
      ),
      contribution(
        "/api/v2/required",
        (c) => {
          calls++;
          return c.json({});
        },
        { method: "post", request: { body: body(true) } },
      ),
    );
    const post = (path: string, init: RequestInit) =>
      registry.fetch(
        new Request(`${ORIGIN}${path}`, { method: "POST", ...init }),
      );
    expect((await post("/api/v2/optional", { body: "n=1" })).status).toBe(200);
    expect(
      (
        await post("/api/v2/optional", {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ n: "1" }),
        })
      ).status,
    ).toBe(400);
    // A required body that is not JSON is validated as `{}`.
    expect((await post("/api/v2/required", { body: "n=1" })).status).toBe(400);
    const malformed = await post("/api/v2/required", {
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.text()).toBe("Malformed JSON in request body");
    expect(calls).toBe(1);
  });

  it("validates headers case-insensitively and cookies by name", async () => {
    const registry = published(
      contribution("/api/v2/guarded", (c) => c.text("in"), {
        request: {
          headers: z.object({ "X-Token": z.literal("t") }),
          cookies: z.object({ session: z.literal("s 1") }),
        },
      }),
    );
    const call = (headers: Record<string, string>) =>
      registry.fetch(new Request(`${ORIGIN}/api/v2/guarded`, { headers }));
    expect((await call({ "x-token": "t", cookie: "a=b; session=s%201" })).status)
      .toBe(200);
    expect((await call({ "x-token": "u", cookie: "session=s%201" })).status)
      .toBe(400);
    expect((await call({ "x-token": "t" })).status).toBe(400);
  });

  it("answers 500 without detail when a handler throws or answers no response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const registry = published(
      contribution("/api/v2/throws", () => {
        throw new Error("PRIVATE");
      }),
      contribution("/api/v2/empty", () => undefined),
    );
    for (const path of ["/api/v2/throws", "/api/v2/empty"]) {
      const response = await registry.fetch(new Request(`${ORIGIN}${path}`));
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Internal Server Error");
    }
  });

  it("refuses a contribution whose declaration names another route", () => {
    const registry = new OperationRegistry();
    registry.register({
      ...contribution("/api/v2/one", (c) => c.text("one")),
      declaration: defineRoute({
        method: "post",
        path: "/api/v2/one",
        responses: {},
      }),
    });
    expect(() => registry.publish()).toThrow(/declares another route/u);
  });
});

describe("the operation registry's policy", () => {
  it("reaches a claimed operation only through invoke", async () => {
    const unpublished = new OperationRegistry();
    expect(
      (
        await unpublished.invoke(
          "test.claimed",
          new Request(`${ORIGIN}/api/v2/claimed`),
        )
      ).status,
    ).toBe(503);
    const registry = published(
      contribution("/api/v2/claimed", (c) => c.text("claimed"), {
        operationId: "test.claimed",
      }),
    );
    const release = registry.claim("test.claimed");
    expect(registry.servedOperations).toEqual([]);
    expect(
      (await registry.fetch(new Request(`${ORIGIN}/api/v2/claimed`))).status,
    ).toBe(404);
    expect(
      await (
        await registry.invoke(
          "test.claimed",
          new Request(`${ORIGIN}/api/v2/claimed`),
        )
      ).text(),
    ).toBe("claimed");
    const elsewhere = await registry.invoke(
      "test.claimed",
      new Request(`${ORIGIN}/api/v2/other`),
    );
    expect(elsewhere.status).toBe(404);
    expect(await elsewhere.json()).toMatchObject({
      code: "OPERATION_NOT_CLAIMED",
    });
    release();
    expect(registry.servedOperations.map((route) => route.operationId)).toEqual(
      ["test.claimed"],
    );
  });

  it("refuses a reused key with another body and a body over the limit", async () => {
    const registry = published(
      contribution("/api/v2/write", (c) => c.json({ ok: true }), {
        method: "post",
        policy: { bodyLimitBytes: 8 },
      }),
    );
    const post = (body: string) =>
      registry.fetch(
        new Request(`${ORIGIN}/api/v2/write`, {
          method: "POST",
          headers: { "Idempotency-Key": "k-1" },
          body,
        }),
      );
    expect((await post("a")).status).toBe(200);
    const conflict = await post("b");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    const large = await post("123456789");
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it("forbids an Idempotency-Key on a read and times a handler out", async () => {
    const registry = published(
      contribution("/api/v2/read", (c) => c.text("read")),
      contribution("/api/v2/slow", () => new Promise(() => undefined), {
        policy: { timeoutMs: 10 },
      }),
    );
    const keyed = await registry.fetch(
      new Request(`${ORIGIN}/api/v2/read`, {
        headers: { "Idempotency-Key": "k" },
      }),
    );
    expect(keyed.status).toBe(400);
    expect(await keyed.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_FORBIDDEN",
    });
    const slow = await registry.fetch(new Request(`${ORIGIN}/api/v2/slow`));
    expect(slow.status).toBe(504);
    expect(await slow.json()).toMatchObject({ code: "ROUTE_TIMEOUT" });
  });
});

describe("an event stream", () => {
  it("writes server-sent events until the writer ends", async () => {
    const registry = published(
      contribution("/api/v2/events", (c) =>
        streamEvents(c, async (stream) => {
          await stream.writeSSE({ event: "one", id: "1", data: "a\nb" });
          await stream.write(": heartbeat\n\n");
          await stream.writeSSE({ data: "{}" });
        }),
      ),
    );
    const response = await registry.fetch(
      new Request(`${ORIGIN}/api/v2/events`),
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe(
      "event: one\ndata: a\ndata: b\nid: 1\n\n: heartbeat\n\ndata: {}\n\n",
    );
  });

  it("runs its abort listeners when the reader cancels", async () => {
    let aborted = false;
    const registry = published(
      contribution("/api/v2/live", (c) =>
        streamEvents(c, async (stream) => {
          await stream.writeSSE({ data: "first" });
          await new Promise<void>((resolve) =>
            stream.onAbort(() => {
              aborted = true;
              resolve();
            }),
          );
        }),
      ),
    );
    const response = await registry.fetch(new Request(`${ORIGIN}/api/v2/live`));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      "data: first\n\n",
    );
    await reader.cancel();
    await vi.waitFor(() => expect(aborted).toBe(true));
  });
});

describe("serveNode", () => {
  it("answers a node:http request with the handler's response", async () => {
    const server = createServer((req, res) => {
      void serveNode(req, res, async (request) =>
        Response.json(
          {
            method: request.method,
            path: new URL(request.url).pathname,
            body: await request.text(),
            header: request.headers.get("x-sample"),
          },
          { status: 201, headers: { "Set-Cookie": "a=1" } },
        ),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${port}/x?y=1`, {
        method: "POST",
        headers: { "X-Sample": "s" },
        body: "payload",
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("set-cookie")).toBe("a=1");
      expect(await response.json()).toEqual({
        method: "POST",
        path: "/x",
        body: "payload",
        header: "s",
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
