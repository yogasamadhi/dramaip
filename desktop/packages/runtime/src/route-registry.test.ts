import { createRoute } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { RuntimeRouteRegistry } from "@dramaip/http";
import { defineRouteContribution } from "@dramaip/plugin-api/internal";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";

function testRoute(
  id: string,
  path: `/api/v2/${string}`,
  operationId: string,
  handler: (...args: never[]) => unknown,
) {
  return defineRouteContribution({
    id,
    pluginId: "test",
    method: "get",
    path,
    operationId,
    declaration: createRoute({
      method: "get",
      path,
      operationId,
      responses: {
        200: {
          description: "Test response",
          content: { "text/plain": { schema: z.string() } },
        },
      },
    }),
    handler,
  });
}

describe("atomic Runtime route registry", () => {
  it("returns RFC 7807 for declarative input validation before executing owner handlers, without disclosing input", async () => {
    const registry = new RuntimeRouteRegistry();
    let calls = 0;
    registry.register(
      defineRouteContribution({
        id: "test:validated",
        pluginId: "test",
        method: "post",
        path: "/api/v2/test/validated/{id}",
        operationId: "test.validated",
        policy: {
          idempotency: "required",
          idempotencyReplay: "handler",
          concurrency: "optional",
        },
        declaration: createRoute({
          method: "post",
          path: "/api/v2/test/validated/{id}",
          request: {
            params: z.object({ id: z.string().uuid() }),
            query: z.object({ limit: z.coerce.number().int().min(1).max(10) }),
            body: {
              required: true,
              content: {
                "application/json": {
                  schema: z.object({ reviewed: z.literal(true) }).strict(),
                },
              },
            },
          },
          responses: { 200: { description: "Validated" } },
        }),
        handler: () => {
          calls++;
          return Response.json({ accepted: true });
        },
      }),
    );
    registry.publish();
    const id = "20000000-0000-4000-8000-000000000001",
      traceId = "20000000-0000-4000-8000-000000000002";
    for (const [suffix, body] of [
      [`${id}?limit=1`, { reviewed: false, secret: "PRIVATE MANUSCRIPT" }],
      [`invalid?limit=1`, { reviewed: true }],
      [`${id}?limit=11`, { reviewed: true }],
    ] as const) {
      const response = await registry.fetch(
        new Request(`http://runtime.test/api/v2/test/validated/${suffix}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            "X-Trace-Id": traceId,
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toContain(
        "application/problem+json",
      );
      const problem = await response.json();
      expect(ProblemDetailsSchema.safeParse(problem).success).toBe(true);
      expect(problem).toMatchObject({ code: "VALIDATION_ERROR", traceId });
      expect(JSON.stringify(problem)).not.toContain("PRIVATE MANUSCRIPT");
    }
    expect(calls).toBe(0);
    const valid = await registry.fetch(
      new Request(`http://runtime.test/api/v2/test/validated/${id}?limit=1`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ reviewed: true }),
      }),
    );
    expect(valid.status).toBe(200);
    expect(calls).toBe(1);
  });
  it.each(["cached", "handler"] as const)(
    "%s idempotency replay preserves policy while owner-managed receipts refresh projections",
    async (replay) => {
      const registry = new RuntimeRouteRegistry();
      let calls = 0;
      let writes = 0;
      let projection = "current";
      const receipts = new Set<string>();
      registry.register(
        defineRouteContribution({
          id: "test:receipt",
          pluginId: "test",
          method: "post",
          path: "/api/v2/test/receipt",
          operationId: "test.receipt",
          policy: {
            idempotency: "required",
            concurrency: "if-match-required",
            ...(replay === "handler" ? { idempotencyReplay: "handler" } : {}),
          },
          declaration: createRoute({
            method: "post",
            path: "/api/v2/test/receipt",
            responses: { 200: { description: "Receipt projection" } },
          }),
          handler: ((context: {
            req: { header(name: string): string };
            json(value: unknown): Response;
          }) => {
            calls++;
            const key = context.req.header("Idempotency-Key");
            if (!receipts.has(key)) {
              receipts.add(key);
              writes++;
            }
            return context.json({ projection });
          }) as (...args: never[]) => unknown,
        }),
      );
      registry.publish();
      const request = () =>
        new Request("http://runtime.test/api/v2/test/receipt", {
          method: "POST",
          headers: { "Idempotency-Key": "receipt-1", "If-Match": '"0"' },
        });
      expect(await (await registry.fetch(request())).json()).toEqual({
        projection: "current",
      });
      projection = "historical";
      expect(await (await registry.fetch(request())).json()).toEqual({
        projection: replay === "handler" ? "historical" : "current",
      });
      expect(writes).toBe(1);
      expect(calls).toBe(replay === "handler" ? 2 : 1);
      expect(
        (
          await registry.fetch(
            new Request("http://runtime.test/api/v2/test/receipt", {
              method: "POST",
              headers: { "Idempotency-Key": "receipt-1" },
            }),
          )
        ).status,
      ).toBe(428);
      expect(calls).toBe(replay === "handler" ? 2 : 1);
    },
  );

  it("removes an unloaded route from the active router", async () => {
    const registry = new RuntimeRouteRegistry();
    const cleanup = registry.register(
      testRoute("test:hello", "/api/v2/test/hello", "test.hello", ((context: {
        text(value: string): Response;
      }) => context.text("ok")) as (...args: never[]) => unknown),
    );
    registry.publish();
    expect(
      await (
        await registry.fetch(
          new Request("http://runtime.test/api/v2/test/hello"),
        )
      ).text(),
    ).toBe("ok");

    cleanup();
    expect(
      (
        await registry.fetch(
          new Request("http://runtime.test/api/v2/test/hello"),
        )
      ).status,
    ).toBe(404);
  });

  it("blocks new dispatch and stages contributions until a drained HMR batch commits", async () => {
    const registry = new RuntimeRouteRegistry();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = registry.register(
      testRoute("test:hmr", "/api/v2/test/hmr", "test.hmr", async () => {
        await blocked;
        return new Response("old");
      }),
    );
    registry.publish();
    const originalRevision = registry.diagnostics().activeRevision;
    const request = new Request("http://runtime.test/api/v2/test/hmr");
    const active = registry.fetch(request);
    let drained = false;
    const drain = registry.beginReload().then(() => {
      drained = true;
    });
    expect((await registry.fetch(request)).status).toBe(503);
    expect(drained).toBe(false);
    release();
    await active;
    await drain;
    old();
    registry.register(
      testRoute(
        "test:hmr",
        "/api/v2/test/hmr",
        "test.hmr",
        () => new Response("new"),
      ),
    );
    expect(registry.diagnostics().activeRevision).toBe(originalRevision);
    registry.commitReload();
    expect(registry.diagnostics().activeRevision).toBe(originalRevision + 1);
    expect(await (await registry.fetch(request)).text()).toBe("new");
  });

  it("drains an in-flight router while new requests use the replacement", async () => {
    const registry = new RuntimeRouteRegistry();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = registry.register(
      testRoute(
        "test:blocked",
        "/api/v2/test/blocked",
        "test.blocked",
        (async (context: { text(value: string): Response }) => {
          await blocked;
          return context.text("old");
        }) as (...args: never[]) => unknown,
      ),
    );
    registry.publish();
    const oldRequest = registry.fetch(
      new Request("http://runtime.test/api/v2/test/blocked"),
    );
    await Promise.resolve();
    cleanup();

    expect(registry.diagnostics().draining).toHaveLength(1);
    expect(
      (
        await registry.fetch(
          new Request("http://runtime.test/api/v2/test/blocked"),
        )
      ).status,
    ).toBe(404);
    release();
    await expect(oldRequest.then((response) => response.text())).resolves.toBe(
      "old",
    );
    expect(registry.diagnostics().draining).toHaveLength(0);
  });
});
