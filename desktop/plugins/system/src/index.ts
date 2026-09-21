import { serviceResolver } from "@dramaip/plugin-api/internal";
import { createRoute } from "@hono/zod-openapi";
import {
  LocalModelRuntimeKindSchema,
  LocalModelRuntimeSchema,
} from "@dramaip/contracts";
import type {
  CredentialCaptureRequest,
  DesktopHostClient,
} from "@dramaip/desktop-host";
import {
  defineRouteContribution,
  definePlugin,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";
import { z } from "zod";
import { ExtensionPlatform } from "./extensions/platform.js";
import { extensionPlatformMigrations } from "./extensions/migrations.js";
import { extensionPlatformRoutes } from "./extensions/routes.js";

export { ExtensionPlatform } from "./extensions/platform.js";

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
  const metadata = {
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
    "system:host-reveal-grant": {
      method: "post",
      path: "/api/v2/system/host/reveal-grant",
      operationId: "system.host.revealGrant",
    },
    "system:host-reveal-artifact": {
      method: "post",
      path: "/api/v2/system/host/reveal-artifact",
      operationId: "system.host.revealArtifact",
    },
    "system:host-credential-status": {
      method: "get",
      path: "/api/v2/system/host/credentials/status",
      operationId: "system.credentials.status",
    },
    "system:host-credential-unlock-create": {
      method: "post",
      path: "/api/v2/system/host/credentials/unlock-sessions",
      operationId: "system.credentials.createUnlockSession",
    },
    "system:host-credential-capture-create": {
      method: "post",
      path: "/api/v2/system/host/credentials/capture-sessions",
      operationId: "system.credentials.createCaptureSession",
    },
    "system:host-credential-capture-status": {
      method: "get",
      path: "/api/v2/system/host/credentials/capture-sessions/{captureSessionId}",
      operationId: "system.credentials.getCaptureSession",
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
    "system:local-model-runtimes-list": {
      method: "get",
      path: "/api/v2/local-model-runtimes",
      operationId: "localModelRuntimes.list",
      response: z.array(LocalModelRuntimeSchema),
    },
    "system:local-model-runtimes-activate": {
      method: "post",
      path: "/api/v2/local-model-runtimes/{kind}/activate",
      operationId: "localModelRuntimes.activate",
      response: LocalModelRuntimeSchema,
    },
    "system:local-model-runtimes-deactivate": {
      method: "post",
      path: "/api/v2/local-model-runtimes/{kind}/deactivate",
      operationId: "localModelRuntimes.deactivate",
      response: LocalModelRuntimeSchema,
    },
    "system:local-model-runtimes-models": {
      method: "get",
      path: "/api/v2/local-model-runtimes/{kind}/models",
      operationId: "localModelRuntimes.models",
      response: LocalModelRuntimeSchema.shape.models,
    },
    "system:local-model-runtimes-health": {
      method: "post",
      path: "/api/v2/local-model-runtimes/{kind}/health-checks",
      operationId: "localModelRuntimes.healthCheck",
      response: LocalModelRuntimeSchema,
    },
  } as const;
  type RouteId = keyof typeof metadata;
  type RouteContext = {
    req: {
      json<T = unknown>(): Promise<T>;
      param(name: string): string;
    };
    json(value: unknown, status?: number): Response;
    body(value: null, status?: number): Response;
  };
  type Handler = (context: RouteContext) => Response | Promise<Response>;
  const handlers: Record<RouteId, Handler> = {
    "system:host-files-pick": async (context) => {
      const result = await call(async (client) =>
        client.pickFiles(await context.req.json()),
      );
      return result instanceof Response ? result : context.json(result);
    },
    "system:host-files-save-text": async (context) => {
      const result = await call(async (client) =>
        client.saveTextFile(await context.req.json()),
      );
      return result instanceof Response ? result : context.json(result);
    },
    "system:host-open-external": async (context) => {
      const { url } = await context.req.json<{ url: string }>();
      const result = await call((client) => client.openExternal(url));
      return result instanceof Response ? result : context.body(null, 204);
    },
    "system:host-reveal-grant": async (context) => {
      const { grantId } = await context.req.json<{ grantId: string }>();
      const result = await call((client) => client.revealGrant(grantId));
      return result instanceof Response ? result : context.body(null, 204);
    },
    "system:host-reveal-artifact": async (context) => {
      const { artifactRef } = await context.req.json<{
        artifactRef: string;
      }>();
      const result = await call((client) => client.revealArtifact(artifactRef));
      return result instanceof Response ? result : context.body(null, 204);
    },
    "system:host-credential-status": async (context) => {
      const result = await call((client) => client.credentialStorageStatus());
      return result instanceof Response ? result : context.json(result);
    },
    "system:host-credential-unlock-create": async (context) => {
      const result = await call((client) =>
        client.createCredentialVaultUnlockSession(),
      );
      return result instanceof Response ? result : context.json(result, 201);
    },
    "system:host-credential-capture-create": async (context) => {
      const input = await context.req.json<CredentialCaptureRequest>();
      const result = await call((client) =>
        client.createCredentialCaptureSession(input),
      );
      return result instanceof Response ? result : context.json(result);
    },
    "system:host-credential-capture-status": async (context) => {
      const result = await call((client) =>
        client.credentialCaptureStatus(context.req.param("captureSessionId")),
      );
      return result instanceof Response ? result : context.json(result);
    },
    "system:host-credential-remove": async (context) => {
      const result = await call((client) =>
        client.removeCredential(context.req.param("credentialRef")),
      );
      return result instanceof Response ? result : context.body(null, 204);
    },
    "system:host-theme": async (context) => {
      const { theme } = await context.req.json<{
        theme: "light" | "dark";
      }>();
      const result = await call((client) => client.setWindowTheme(theme));
      return result instanceof Response ? result : context.body(null, 204);
    },
    "system:local-model-runtimes-list": async (context) => {
      const result = await call((client) => client.localModelRuntimes());
      return result instanceof Response ? result : context.json(result);
    },
    "system:local-model-runtimes-activate": async (context) => {
      const kind = LocalModelRuntimeKindSchema.safeParse(
        context.req.param("kind"),
      );
      if (!kind.success)
        return context.json({ code: "LOCAL_RUNTIME_UNKNOWN" }, 400);
      const result = await call((client) =>
        client.activateLocalModelRuntime(kind.data),
      );
      return result instanceof Response ? result : context.json(result);
    },
    "system:local-model-runtimes-deactivate": async (context) => {
      const kind = LocalModelRuntimeKindSchema.safeParse(
        context.req.param("kind"),
      );
      if (!kind.success)
        return context.json({ code: "LOCAL_RUNTIME_UNKNOWN" }, 400);
      const result = await call((client) =>
        client.deactivateLocalModelRuntime(kind.data),
      );
      return result instanceof Response ? result : context.json(result);
    },
    "system:local-model-runtimes-models": async (context) => {
      const kind = LocalModelRuntimeKindSchema.safeParse(
        context.req.param("kind"),
      );
      if (!kind.success)
        return context.json({ code: "LOCAL_RUNTIME_UNKNOWN" }, 400);
      const result = await call((client) =>
        client.localModelRuntime(kind.data),
      );
      return result instanceof Response ? result : context.json(result.models);
    },
    "system:local-model-runtimes-health": async (context) => {
      const kind = LocalModelRuntimeKindSchema.safeParse(
        context.req.param("kind"),
      );
      if (!kind.success)
        return context.json({ code: "LOCAL_RUNTIME_UNKNOWN" }, 400);
      const result = await call((client) =>
        client.localModelRuntime(kind.data),
      );
      return result instanceof Response ? result : context.json(result);
    },
  };
  return (Object.keys(metadata) as RouteId[]).map((id) => {
    const route = metadata[id];
    const declaration = createRoute({
      ...route,
      responses: {
        200: {
          description: "Desktop Host capability response",
          content: {
            "application/json": {
              schema: "response" in route ? route.response : z.unknown(),
            },
          },
        },
        204: { description: "Desktop Host capability completed" },
        503: {
          description: "Desktop Host unavailable",
          content: { "application/json": { schema: z.unknown() } },
        },
      },
    } as never);
    return defineRouteContribution({
      id,
      pluginId: "system",
      ...route,
      declaration,
      handler: handlers[id],
    });
  });
}

export function createSystemPlugin(
  host?: DesktopHostClient,
  extensionPlatform?: ExtensionPlatform,
) {
  return definePlugin({
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
      {
        id: "system.settings.extensions",
        pluginId: "system",
        kind: "settings",
        metadata: {
          section: "extensions",
          title: "扩展与 Marketplace",
          loader: "system.settings.extensions",
        },
      },
    ],
    migrations: extensionPlatformMigrations,
    apply: (context) => {
      const platform =
        extensionPlatform ?? new ExtensionPlatform(context.uow, host);
      platform.broker.setServiceResolver(() => serviceResolver(context));
      for (const route of hostRoutes(host))
        context.effect(() => context.http.register(route), `route:${route.id}`);
      for (const route of extensionPlatformRoutes(platform))
        context.effect(() => context.http.register(route), `route:${route.id}`);
      // Lightweight Host-facade embeddings intentionally provide only HTTP.
      // Extension event consumers require the complete Runtime data/event pair.
      if (context.uow && context.domainEvents)
        context.effect(
          () => platform.attachEventRuntime(context.domainEvents),
          "extensions:domain-event-consumers",
        );
      return undefined;
    },
  });
}

export const systemPlugin = createSystemPlugin();

import type { Context } from "@deepseek-ai/cordis";
export default {
  name: "system-entry",
  inject: ["pluginEnvironment"],
  apply: (ctx: Context, config: Record<string, unknown>) => {
    ctx.plugin(
      createSystemPlugin(
        ctx.pluginEnvironment.host as Parameters<typeof createSystemPlugin>[0],
        ctx.pluginEnvironment.extensionPlatform as Parameters<
          typeof createSystemPlugin
        >[1],
      ),
      config,
    );
  },
};
