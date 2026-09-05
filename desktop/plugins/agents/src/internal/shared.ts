import {
  defineRouteContribution,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";
import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { z } from "zod";
import { ProviderEntity } from "../providers/routes.js";
export type ProviderPayload = Record<string, unknown>;

export type AgentRouteContext = Omit<Context, "req"> & {
  readonly req: Omit<Context["req"], "param" | "query"> & {
    param(name: string): string;
    query(name: string): string | undefined;
  };
};

export type AgentRouteHandler = (
  context: AgentRouteContext,
) => Response | Promise<Response>;

export interface AgentRouteBinding {
  readonly method: "delete" | "get" | "patch" | "post" | "put";
  readonly path: string;
  readonly handler: AgentRouteHandler;
}

export interface AgentRouteBuilder {
  delete(path: string, handler: AgentRouteHandler): AgentRouteBinding;
  get(path: string, handler: AgentRouteHandler): AgentRouteBinding;
  patch(path: string, handler: AgentRouteHandler): AgentRouteBinding;
  post(path: string, handler: AgentRouteHandler): AgentRouteBinding;
  put(path: string, handler: AgentRouteHandler): AgentRouteBinding;
}

export interface AgentRouteDraft {
  readonly id: string;
  readonly pluginId: "agents";
  readonly bind: (builder: AgentRouteBuilder) => AgentRouteBinding;
}

export const agentRouteBuilder = Object.freeze({
  delete: (path: string, handler: AgentRouteHandler) => ({
    method: "delete" as const,
    path,
    handler,
  }),
  get: (path: string, handler: AgentRouteHandler) => ({
    method: "get" as const,
    path,
    handler,
  }),
  patch: (path: string, handler: AgentRouteHandler) => ({
    method: "patch" as const,
    path,
    handler,
  }),
  post: (path: string, handler: AgentRouteHandler) => ({
    method: "post" as const,
    path,
    handler,
  }),
  put: (path: string, handler: AgentRouteHandler) => ({
    method: "put" as const,
    path,
    handler,
  }),
}) satisfies AgentRouteBuilder;

export function problem(
  context: { json(value: unknown, status: number): Response },
  status: number,
  code: string,
  message: string,
): Response {
  return context.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title: message,
      status,
      code,
    },
    status,
  );
}

export function entityResponse(
  context: {
    header(name: string, value: string): void;
    json(value: unknown): Response;
  },
  provider: ProviderEntity,
): Response {
  context.header("ETag", `"${provider.version}"`);
  return context.json(provider);
}

export function expectedVersion(value: string | undefined): number | undefined {
  if (!value || value.startsWith("W/")) return undefined;
  const normalized = value.trim().replace(/^"|"$/g, "");
  if (!/^\d+$/u.test(normalized)) return undefined;
  const version = Number(normalized);
  return Number.isSafeInteger(version) ? version : undefined;
}

export function materializeAgentRoute(
  draft: AgentRouteDraft,
): RouteContribution {
  const metadata = agentRouteMetadata[draft.id];
  if (!metadata)
    throw new Error(`Agent route metadata is missing: ${draft.id}`);
  const binding = draft.bind(agentRouteBuilder);
  const normalizedPath = binding.path.replace(
    /:([A-Za-z][A-Za-z0-9_]*)/gu,
    "{$1}",
  );
  if (binding.method !== metadata.method || normalizedPath !== metadata.path)
    throw new Error(`Agent route declaration drifted: ${draft.id}`);
  const declaration = createRoute({
    ...metadata,
    tags: ["agents"],
    responses: {
      200: {
        description: "Agent operation response",
        content: { "application/json": { schema: z.unknown() } },
      },
      201: {
        description: "Agent resource created",
        content: { "application/json": { schema: z.unknown() } },
      },
      204: { description: "Agent operation completed" },
      400: {
        description: "Invalid request",
        content: { "application/problem+json": { schema: z.unknown() } },
      },
      404: {
        description: "Agent resource not found",
        content: { "application/problem+json": { schema: z.unknown() } },
      },
      409: {
        description: "Agent state conflict",
        content: { "application/problem+json": { schema: z.unknown() } },
      },
      503: {
        description: "Agent engine unavailable",
        content: { "application/problem+json": { schema: z.unknown() } },
      },
    },
  } as never);
  return defineRouteContribution({
    id: draft.id,
    pluginId: draft.pluginId,
    ...metadata,
    declaration,
    handler: binding.handler,
  });
}

export const agentRouteMetadata: Record<
  string,
  Pick<RouteContribution, "method" | "path" | "operationId">
> = {
  "agents:engine-list": {
    method: "get",
    path: "/api/v2/agent-engines",
    operationId: "agent-engines.list",
  },
  "agents:task-catalog-list": {
    method: "get",
    path: "/api/v2/agent-tasks",
    operationId: "agent-engines.listTasks",
  },
  "agents:global-engine-settings-get": {
    method: "get",
    path: "/api/v2/agent-settings",
    operationId: "agent-engines.getGlobalSettings",
  },
  "agents:global-engine-settings-update": {
    method: "put",
    path: "/api/v2/agent-settings",
    operationId: "agent-engines.updateGlobalSettings",
  },
  "agents:project-engine-settings-get": {
    method: "get",
    path: "/api/v2/projects/{id}/agent-settings",
    operationId: "agent-engines.getProjectSettings",
  },
  "agents:project-engine-settings-update": {
    method: "put",
    path: "/api/v2/projects/{id}/agent-settings",
    operationId: "agent-engines.updateProjectSettings",
  },
  "agents:codex-auth-status": {
    method: "get",
    path: "/api/v2/agent-engines/codex/auth",
    operationId: "codex-auth.status",
  },
  "agents:codex-login": {
    method: "post",
    path: "/api/v2/agent-engines/codex/login",
    operationId: "codex-auth.login",
  },
  "agents:codex-logout": {
    method: "post",
    path: "/api/v2/agent-engines/codex/logout",
    operationId: "codex-auth.logout",
  },
  "agents:providers-list": {
    method: "get",
    path: "/api/v2/providers",
    operationId: "providers.list",
  },
  "agents:context-preview-create": {
    method: "post",
    path: "/api/v2/agent-context-previews",
    operationId: "agent-context.createPreview",
  },
  "agents:context-preview-get": {
    method: "get",
    path: "/api/v2/agent-context-previews/{id}",
    operationId: "agent-context.getPreview",
  },
  "agents:context-preview-update": {
    method: "patch",
    path: "/api/v2/agent-context-previews/{id}",
    operationId: "agent-context.updatePreview",
  },
  "agents:context-snapshot-create": {
    method: "post",
    path: "/api/v2/agent-context-previews/{id}/snapshots",
    operationId: "agent-context.freezePreview",
  },
  "agents:context-run-snapshot-get": {
    method: "get",
    path: "/api/v2/agent-runs/{id}/context-snapshot",
    operationId: "agent-context.getRunSnapshot",
  },
  "agents:context-policies-get": {
    method: "get",
    path: "/api/v2/projects/{id}/agent-context-policies",
    operationId: "agent-context.getPolicies",
  },
  "agents:context-policies-update": {
    method: "put",
    path: "/api/v2/projects/{id}/agent-context-policies",
    operationId: "agent-context.updatePolicies",
  },
  "agents:providers-create": {
    method: "post",
    path: "/api/v2/providers",
    operationId: "providers.create",
  },
  "agents:providers-get": {
    method: "get",
    path: "/api/v2/providers/{id}",
    operationId: "providers.get",
  },
  "agents:providers-update": {
    method: "patch",
    path: "/api/v2/providers/{id}",
    operationId: "providers.update",
  },
  "agents:providers-delete": {
    method: "delete",
    path: "/api/v2/providers/{id}",
    operationId: "providers.delete",
  },
  "agents:providers-activate-for-agent": {
    method: "post",
    path: "/api/v2/providers/{id}/activate-for-agent",
    operationId: "providers.activateForAgent",
  },
  "agents:providers-test-connection": {
    method: "post",
    path: "/api/v2/providers/{id}/test-connection",
    operationId: "providers.testConnection",
  },
  "agents:assistant-conversations-list": {
    method: "get",
    path: "/api/v2/assistant-conversations",
    operationId: "assistant-conversations.list",
  },
  "agents:assistant-web-research-settings-get": {
    method: "get",
    path: "/api/v2/assistant-web-research-settings",
    operationId: "assistant-web-research-settings.get",
  },
  "agents:assistant-web-research-settings-update": {
    method: "put",
    path: "/api/v2/assistant-web-research-settings",
    operationId: "assistant-web-research-settings.update",
  },
  "agents:assistant-conversations-create": {
    method: "post",
    path: "/api/v2/assistant-conversations",
    operationId: "assistant-conversations.create",
  },
  "agents:assistant-conversations-get": {
    method: "get",
    path: "/api/v2/assistant-conversations/{id}",
    operationId: "assistant-conversations.get",
  },
  "agents:assistant-conversations-update": {
    method: "patch",
    path: "/api/v2/assistant-conversations/{id}",
    operationId: "assistant-conversations.update",
  },
  "agents:assistant-conversations-bind-project": {
    method: "post",
    path: "/api/v2/assistant-conversations/{id}/bind-project",
    operationId: "assistant-conversations.bindProject",
  },
  "agents:assistant-conversations-send-message": {
    method: "post",
    path: "/api/v2/assistant-conversations/{id}/messages",
    operationId: "assistant-conversations.sendMessage",
  },
  "agents:assistant-conversations-delete": {
    method: "delete",
    path: "/api/v2/assistant-conversations/{id}",
    operationId: "assistant-conversations.remove",
  },
  "agents:typed-sessions-create": {
    method: "post",
    path: "/api/v2/agent-sessions",
    operationId: "agent-sessions.create",
  },
  "agents:typed-sessions-get": {
    method: "get",
    path: "/api/v2/agent-sessions/{id}",
    operationId: "agent-sessions.get",
  },
  "agents:typed-sessions-run": {
    method: "post",
    path: "/api/v2/agent-sessions/{id}/runs",
    operationId: "agent-sessions.run",
  },
  "agents:typed-runs-get": {
    method: "get",
    path: "/api/v2/agent-runs/{id}",
    operationId: "agent-sessions.getRun",
  },
  "agents:typed-run-items-list": {
    method: "get",
    path: "/api/v2/agent-runs/{id}/items",
    operationId: "agent-sessions.listItems",
  },
  "agents:typed-run-events": {
    method: "get",
    path: "/api/v2/agent-runs/{id}/events",
    operationId: "agent-sessions.subscribe",
  },
  "agents:typed-runs-steer": {
    method: "post",
    path: "/api/v2/agent-runs/{id}/steer",
    operationId: "agent-sessions.steer",
  },
  "agents:typed-runs-interrupt": {
    method: "post",
    path: "/api/v2/agent-runs/{id}/interrupt",
    operationId: "agent-sessions.interrupt",
  },
  "agents:typed-runs-resume": {
    method: "post",
    path: "/api/v2/agent-runs/{id}/resume",
    operationId: "agent-sessions.resume",
  },
  "agents:typed-sessions-fork": {
    method: "post",
    path: "/api/v2/agent-sessions/{id}/fork",
    operationId: "agent-sessions.fork",
  },
  "agents:typed-sessions-dispose": {
    method: "delete",
    path: "/api/v2/agent-sessions/{id}",
    operationId: "agent-sessions.dispose",
  },
  "agents:typed-sessions-abort": {
    method: "post",
    path: "/api/v2/agent-sessions/{id}/abort",
    operationId: "agent-sessions.abort",
  },
  "agents:evaluations-create": {
    method: "post",
    path: "/api/v2/agent-experiments",
    operationId: "agent-experiments.create",
  },
  "agents:evaluations-get": {
    method: "get",
    path: "/api/v2/agent-experiments/{id}",
    operationId: "agent-experiments.get",
  },
  "agents:evaluations-review": {
    method: "post",
    path: "/api/v2/agent-experiments/{id}/review",
    operationId: "agent-experiments.review",
  },
  "agents:evaluations-reveal": {
    method: "post",
    path: "/api/v2/agent-experiments/{id}/reveal",
    operationId: "agent-experiments.reveal",
  },
};
