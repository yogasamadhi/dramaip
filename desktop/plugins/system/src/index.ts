import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  defineFirstPartyPlugin,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";

function hostUnavailable(): Response {
  return Response.json(
    { code: "HOST_UNAVAILABLE", title: "Desktop Host is unavailable" },
    { status: 503 },
  );
}

function hostRoutes(
  host: DesktopHostClient | undefined,
): readonly RouteContribution[] {
  const call = async <T>(
    operation: (client: DesktopHostClient) => Promise<T>,
  ): Promise<T | Response> => (host ? operation(host) : hostUnavailable());
  const routes: RouteContribution[] = [
    {
      id: "system:host-files-pick",
      pluginId: "system",
      install: (app) =>
        app.post("/api/v2/system/host/files/pick", async (context) => {
          const result = await call(async (client) =>
            client.pickFiles(await context.req.json()),
          );
          return result instanceof Response ? result : context.json(result);
        }),
    },
    {
      id: "system:host-files-save-text",
      pluginId: "system",
      install: (app) =>
        app.post("/api/v2/system/host/files/save-text", async (context) => {
          const result = await call(async (client) =>
            client.saveTextFile(await context.req.json()),
          );
          return result instanceof Response ? result : context.json(result);
        }),
    },
    {
      id: "system:host-open-external",
      pluginId: "system",
      install: (app) =>
        app.post("/api/v2/system/host/open-external", async (context) => {
          const { url } = await context.req.json<{ url: string }>();
          const result = await call((client) => client.openExternal(url));
          return result instanceof Response ? result : context.body(null, 204);
        }),
    },
    {
      id: "system:host-reveal-path",
      pluginId: "system",
      install: (app) =>
        app.post("/api/v2/system/host/reveal-path", async (context) => {
          const { path } = await context.req.json<{ path: string }>();
          const result = await call((client) => client.revealPath(path));
          return result instanceof Response ? result : context.body(null, 204);
        }),
    },
    {
      id: "system:host-credential-status",
      pluginId: "system",
      install: (app) =>
        app.get("/api/v2/system/host/credentials/status", async (context) => {
          const result = await call((client) =>
            client.credentialStorageStatus(),
          );
          return result instanceof Response ? result : context.json(result);
        }),
    },
    {
      id: "system:host-credential-store",
      pluginId: "system",
      install: (app) =>
        app.post("/api/v2/system/host/credentials", async (context) => {
          const { secret } = await context.req.json<{ secret: string }>();
          const result = await call((client) => client.storeCredential(secret));
          return result instanceof Response ? result : context.json(result);
        }),
    },
    {
      id: "system:host-credential-remove",
      pluginId: "system",
      install: (app) =>
        app.delete(
          "/api/v2/system/host/credentials/:credentialRef",
          async (context) => {
            const result = await call((client) =>
              client.removeCredential(context.req.param("credentialRef")),
            );
            return result instanceof Response
              ? result
              : context.body(null, 204);
          },
        ),
    },
    {
      id: "system:host-theme",
      pluginId: "system",
      install: (app) =>
        app.post("/api/v2/system/host/window/theme", async (context) => {
          const { theme } = await context.req.json<{
            theme: "light" | "dark";
          }>();
          const result = await call((client) => client.setWindowTheme(theme));
          return result instanceof Response ? result : context.body(null, 204);
        }),
    },
  ];
  const metadata: Record<
    string,
    Pick<RouteContribution, "method" | "path" | "operationId">
  > = {
    "system:host-files-pick": {
      method: "post",
      path: "/api/v2/system/host/files/pick",
      operationId: "system.hostFiles.pick",
    },
    "system:host-files-save-text": {
      method: "post",
      path: "/api/v2/system/host/files/save-text",
      operationId: "system.hostFiles.saveText",
    },
    "system:host-open-external": {
      method: "post",
      path: "/api/v2/system/host/open-external",
      operationId: "system.host.openExternal",
    },
    "system:host-reveal-path": {
      method: "post",
      path: "/api/v2/system/host/reveal-path",
      operationId: "system.host.revealPath",
    },
    "system:host-credential-status": {
      method: "get",
      path: "/api/v2/system/host/credentials/status",
      operationId: "system.credentials.status",
    },
    "system:host-credential-store": {
      method: "post",
      path: "/api/v2/system/host/credentials",
      operationId: "system.credentials.store",
    },
    "system:host-credential-remove": {
      method: "delete",
      path: "/api/v2/system/host/credentials/{credentialRef}",
      operationId: "system.credentials.remove",
    },
    "system:host-theme": {
      method: "post",
      path: "/api/v2/system/host/window/theme",
      operationId: "system.window.setTheme",
    },
  };
  return routes.map((route) => ({ ...route, ...metadata[route.id] }));
}

export function createSystemPlugin(host?: DesktopHostClient) {
  return defineFirstPartyPlugin({
    descriptor: {
      id: "system",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: ["foundation"],
      stability: "internal",
    },
    ui: [
      {
        id: "system.route.settings",
        pluginId: "system",
        kind: "route",
        metadata: { path: "/settings", title: "设置" },
      },
      {
        id: "system.navigation.settings",
        pluginId: "system",
        kind: "navigation",
        metadata: {
          section: "secondary",
          order: 40,
          label: "设置",
          to: "/settings",
        },
      },
      {
        id: "system.settings.diagnostics",
        pluginId: "system",
        kind: "settings",
        metadata: { section: "diagnostics", title: "诊断与备份" },
      },
    ],
    activate: (context) => {
      for (const route of hostRoutes(host))
        context.effect(context.http.register(route), `route:${route.id}`);
      return undefined;
    },
  });
}

export const systemPlugin = createSystemPlugin();
