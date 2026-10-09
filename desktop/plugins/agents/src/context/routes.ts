import {
  AgentContextPolicyInputSchema,
  AgentContextPreviewInputSchema,
  AgentContextPreviewPatchSchema,
} from "@dramaip/contracts/agent-context";
import type { AgentRouteDraft } from "../internal/shared.js";
import { expectedVersion, problem } from "../internal/shared.js";
import type { AgentContextStore } from "./store.js";
import { ContextSourceUnavailableError } from "./store.js";

export function agentContextRoutes(
  store: AgentContextStore,
): readonly AgentRouteDraft[] {
  return [
    {
      id: "agents:context-preview-create",
      pluginId: "agents",
      bind: (app) =>
        app.post("/api/v2/agent-context-previews", async (context) => {
          try {
            const value = store.createPreview(
              AgentContextPreviewInputSchema.parse(await context.req.json()),
            );
            context.header("ETag", `"${value.version}"`);
            return context.json(value, 201);
          } catch (cause) {
            if (!(cause instanceof ContextSourceUnavailableError)) throw cause;
            return Response.json(
              {
                type: "https://dramaip.local/problems/context-source-unavailable",
                title: "Context source unavailable",
                detail: cause.message,
                code: "CONTEXT_SOURCE_UNAVAILABLE",
                status: 503,
                traceId: crypto.randomUUID(),
              },
              {
                status: 503,
                headers: { "Content-Type": "application/problem+json" },
              },
            );
          }
        }),
    },
    {
      id: "agents:context-preview-get",
      pluginId: "agents",
      bind: (app) =>
        app.get("/api/v2/agent-context-previews/:id", (context) => {
          const value = store.getPreview(context.req.param("id"));
          if (!value)
            return problem(
              context,
              404,
              "AGENT_CONTEXT_PREVIEW_NOT_FOUND",
              "AI 上下文预览不存在。",
            );
          context.header("ETag", `"${value.version}"`);
          return context.json(value);
        }),
    },
    {
      id: "agents:context-preview-update",
      pluginId: "agents",
      bind: (app) =>
        app.patch("/api/v2/agent-context-previews/:id", async (context) => {
          const version = expectedVersion(context.req.header("If-Match"));
          if (version === undefined)
            return problem(
              context,
              428,
              "IF_MATCH_REQUIRED",
              "修改 AI 上下文预览需要 If-Match。",
            );
          const input = AgentContextPreviewPatchSchema.parse(
            await context.req.json(),
          );
          const value = store.updatePreview(
            context.req.param("id"),
            version,
            input.temporaryOverrides,
          );
          if (value === "conflict")
            return problem(
              context,
              409,
              "AGENT_CONTEXT_PREVIEW_CONFLICT",
              "AI 上下文预览已变化，请重新检查。",
            );
          if (!value)
            return problem(
              context,
              404,
              "AGENT_CONTEXT_PREVIEW_NOT_FOUND",
              "AI 上下文预览不存在。",
            );
          context.header("ETag", `"${value.version}"`);
          return context.json(value);
        }),
    },
    {
      id: "agents:context-snapshot-create",
      pluginId: "agents",
      bind: (app) =>
        app.post("/api/v2/agent-context-previews/:id/snapshots", (context) => {
          const version = expectedVersion(context.req.header("If-Match"));
          if (version === undefined)
            return problem(
              context,
              428,
              "IF_MATCH_REQUIRED",
              "冻结 AI 上下文需要 If-Match。",
            );
          const value = store.freeze(context.req.param("id"), version);
          return value
            ? context.json(value, 201)
            : problem(
                context,
                409,
                "AGENT_CONTEXT_PREVIEW_STALE",
                "AI 上下文预览已过期或发生变化。",
              );
        }),
    },
    {
      id: "agents:context-run-snapshot-get",
      pluginId: "agents",
      bind: (app) =>
        app.get("/api/v2/agent-runs/:id/context-snapshot", (context) => {
          const value = store.getRunSnapshot(context.req.param("id"));
          return value
            ? context.json(value)
            : problem(
                context,
                404,
                "AGENT_CONTEXT_SNAPSHOT_NOT_FOUND",
                "运行尚未绑定 AI 上下文快照。",
              );
        }),
    },
    {
      id: "agents:context-policies-get",
      pluginId: "agents",
      bind: (app) =>
        app.get("/api/v2/projects/:id/agent-context-policies", (context) => {
          const value = store.policies(context.req.param("id"));
          context.header("ETag", `"${value.version}"`);
          return context.json(value);
        }),
    },
    {
      id: "agents:context-policies-update",
      pluginId: "agents",
      bind: (app) =>
        app.put(
          "/api/v2/projects/:id/agent-context-policies",
          async (context) => {
            const headerVersion = expectedVersion(
              context.req.header("If-Match"),
            );
            if (headerVersion === undefined)
              return problem(
                context,
                428,
                "IF_MATCH_REQUIRED",
                "修改 AI 上下文策略需要 If-Match。",
              );
            const input = AgentContextPolicyInputSchema.parse(
              await context.req.json(),
            );
            if (input.version !== headerVersion)
              return problem(
                context,
                409,
                "AGENT_CONTEXT_POLICY_VERSION_MISMATCH",
                "请求体版本与 If-Match 不一致。",
              );
            const value = store.replacePolicies(
              context.req.param("id"),
              headerVersion,
              input.policies,
            );
            if (value === "conflict")
              return problem(
                context,
                409,
                "AGENT_CONTEXT_POLICY_CONFLICT",
                "AI 上下文策略已变化。",
              );
            context.header("ETag", `"${value.version}"`);
            return context.json(value);
          },
        ),
    },
  ];
}
