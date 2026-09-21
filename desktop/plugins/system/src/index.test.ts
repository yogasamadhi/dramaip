import { Context } from "@deepseek-ai/cordis";
import { afterEach, describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createSystemPlugin } from "./index.js";
import type { RouteContribution } from "@dramaip/plugin-api/internal";
import type { DesktopHostClient } from "@dramaip/desktop-host";

const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
});

async function installSystemRoutes(
  host?: DesktopHostClient,
): Promise<OpenAPIHono> {
  const routes: RouteContribution[] = [];
  const plugin = createSystemPlugin(host);
  const ctx = new Context();
  contexts.push(ctx);
  for (const [key, value] of Object.entries({
    "dramaip.plugin.foundation": true,
    domainEvents: { subscribeDomain: () => () => undefined },
    uow: {
      execute: (work: (tx: unknown) => unknown) =>
        work({ all: () => [], get: () => undefined, run: () => undefined }),
    },
    ui: { register: () => () => undefined },
    diagnostics: (): object => ({}),
    profile: "test",
    graphRevision: "test",
    capability: (): undefined => undefined,
    http: {
      register(route: RouteContribution) {
        routes.push(route);
        return () => undefined;
      },
    },
  }))
    ctx.provide(key, value);
  await ctx.plugin(plugin, {}).await();
  const app = new OpenAPIHono();
  for (const route of routes) {
    const register = app.openapi as unknown as (
      declaration: unknown,
      handler: (...args: never[]) => unknown,
    ) => void;
    register.call(app, route.declaration, route.handler);
  }
  return app;
}

describe("system host facade", () => {
  it("proxies the Host credential status as JSON", async () => {
    const host = {
      credentialStorageStatus: async () => ({
        available: true,
        storage: "os_safe_storage" as const,
        backend: "keychain",
        locked: false,
        migrationState: "complete" as const,
      }),
    } as unknown as DesktopHostClient;
    const app = await installSystemRoutes(host);

    const response = await app.request(
      "http://runtime.test/api/v2/system/host/credentials/status",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      available: true,
      storage: "os_safe_storage",
      backend: "keychain",
      locked: false,
      migrationState: "complete",
    });
  });

  it("exposes local model discovery without leaking the loopback URL", async () => {
    const host = {
      localModelRuntimes: async () => [
        {
          kind: "ollama",
          endpointRef: "local-model-runtime:ollama",
          state: "inactive",
          models: [{ id: "qwen3:8b", displayName: "qwen3:8b" }],
          lastHealthAt: "2026-08-31T00:00:00.000Z",
        },
      ],
    } as unknown as DesktopHostClient;
    const app = await installSystemRoutes(host);

    const response = await app.request(
      "http://runtime.test/api/v2/local-model-runtimes",
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("local-model-runtime:ollama");
    expect(body).not.toContain("11434");
  });

  it("reports Host unavailability in headless mode", async () => {
    const app = await installSystemRoutes();
    const response = await app.request(
      "http://runtime.test/api/v2/system/host/credentials/status",
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "HOST_UNAVAILABLE",
    });
  });
});
