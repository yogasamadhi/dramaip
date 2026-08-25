import { describe, expect, it } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createSystemPlugin } from "./index.js";
import type {
  PluginContext,
  RouteContribution,
} from "@dramaip/plugin-api/internal";
import type { DesktopHostClient } from "@dramaip/desktop-host";

async function installSystemRoutes(
  host?: DesktopHostClient,
): Promise<OpenAPIHono> {
  const routes: RouteContribution[] = [];
  const plugin = createSystemPlugin(host);
  await plugin.activate({
    http: {
      register(route: RouteContribution) {
        routes.push(route);
        return () => undefined;
      },
    },
    effect: ((_label, acquire) => void acquire()) as PluginContext["effect"],
  } as unknown as PluginContext);
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
        storage: "local_encrypted_file" as const,
      }),
    } as unknown as DesktopHostClient;
    const app = await installSystemRoutes(host);

    const response = await app.request(
      "http://runtime.test/api/v2/system/host/credentials/status",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      available: true,
      storage: "local_encrypted_file",
    });
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
