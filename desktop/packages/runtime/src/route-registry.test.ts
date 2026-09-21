import { createRoute } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { RuntimeRouteRegistry } from "@dramaip/http";
import { defineRouteContribution } from "@dramaip/plugin-api/internal";
import { z } from "zod";

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
