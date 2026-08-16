import type { Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import { problemDetailsSchema, taskStateSchema } from "@dramaip/contracts";
import {
  createNodeMigration,
  createRelationalMigration,
  installRelationalPluginServer,
  type NodeResourceDefinition,
  type ResourceAction,
} from "@dramaip/domain-kit";
import { ApiProblem, idempotentResponse, requireIfMatch } from "@dramaip/http";
import {
  defineDramaPlugin,
  type MigrationDefinition,
  type RouteContribution,
} from "@dramaip/plugin-api";

import { AutomationRuntimeService } from "./services.ts";

type TaskData = {
  state:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "canceled"
    | "interrupted";
  progress: number;
  error?: string;
};

const taskData = z.object({
  state: taskStateSchema.default("queued"),
  progress: z.number().min(0).max(1).default(0),
  error: z.string().optional(),
});
const workflowData = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      config: z.record(z.string(), z.unknown()),
    }),
  ),
  enabled: z.boolean().default(true),
});
const templateData = z.object({
  category: z.string(),
  prompt: z.string(),
  variables: z.array(z.string()),
});
const legacyPreviewData = z.object({
  targetType: z.string(),
  targetId: z.string(),
  changes: z.array(
    z.object({ path: z.string(), before: z.unknown(), after: z.unknown() }),
  ),
});

const transitions: Record<TaskData["state"], readonly TaskData["state"][]> = {
  queued: ["running", "canceled"],
  running: ["succeeded", "failed", "canceled", "interrupted"],
  succeeded: [],
  failed: ["queued"],
  canceled: ["queued"],
  interrupted: ["running", "queued", "canceled"],
};

function taskAction(
  verb: string,
  target: TaskData["state"],
): ResourceAction<TaskData> {
  return {
    verb,
    input: z.object({}).strict(),
    mutate(data) {
      return {
        ...data,
        state: target,
        progress:
          target === "succeeded" ? 1 : target === "queued" ? 0 : data.progress,
        ...(target === "queued" ? { error: undefined } : {}),
      };
    },
  };
}

const taskResource = {
  kind: "task",
  path: "tasks",
  data: taskData,
  defaultStatus: "queued",
  createRequiresIdempotency: true,
  validateCreate(data: TaskData) {
    if (data.state !== "queued")
      throw new ApiProblem(
        409,
        "ILLEGAL_TASK_TRANSITION",
        "new tasks must be queued",
      );
  },
  validateUpdate(previous: TaskData, next: TaskData) {
    if (
      previous.state !== next.state &&
      !transitions[previous.state].includes(next.state)
    ) {
      throw new ApiProblem(
        409,
        "ILLEGAL_TASK_TRANSITION",
        `${previous.state} cannot transition to ${next.state}`,
      );
    }
  },
  actions: [
    taskAction("start", "running"),
    taskAction("succeed", "succeeded"),
    taskAction("fail", "failed"),
    taskAction("cancel", "canceled"),
    taskAction("interrupt", "interrupted"),
    taskAction("resume", "running"),
    taskAction("retry", "queued"),
  ],
} satisfies NodeResourceDefinition<TaskData>;

export const automationResources = [
  taskResource,
  { kind: "workflow", path: "workflows", data: workflowData },
  { kind: "template", path: "templates", data: templateData },
] satisfies readonly NodeResourceDefinition<any>[];

// Keep this list and order stable: automation-0001 is already present in developer databases.
const legacyResources = [
  taskResource,
  { kind: "workflow", path: "workflows", data: workflowData },
  { kind: "template", path: "templates", data: templateData },
  {
    kind: "change-preview",
    path: "change-previews",
    data: legacyPreviewData,
    defaultStatus: "pending",
  },
] satisfies readonly NodeResourceDefinition<any>[];

const changeTargetSchema = z.object({
  id: z.uuid(),
  kind: z.string().trim().min(1).max(100),
  targetId: z.uuid(),
  baseVersion: z.number().int().nonnegative(),
  patch: z.record(z.string(), z.unknown()),
  displayDiff: z.unknown().optional(),
});
const changePreviewSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  sessionId: z.uuid().optional(),
  runId: z.uuid().optional(),
  taskType: z.string().optional(),
  rationale: z.string(),
  status: z.enum(["pending", "committed", "discarded"]),
  targets: z.array(changeTargetSchema),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const migrations: readonly MigrationDefinition[] = [
  createNodeMigration("automation", legacyResources),
  {
    id: "automation-0002",
    pluginId: "automation",
    version: "2.0.0",
    dependsOn: ["automation-0001", "workspace-0002"],
    sql: `
      CREATE TABLE automation_change_previews (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        session_id TEXT,
        run_id TEXT,
        task_type TEXT,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'discarded')),
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX automation_change_previews_project_idx
        ON automation_change_previews (project_id, updated_at);
      CREATE TABLE automation_change_preview_targets (
        id TEXT PRIMARY KEY,
        preview_id TEXT NOT NULL REFERENCES automation_change_previews(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        base_version INTEGER NOT NULL CHECK (base_version >= 0),
        patch_json TEXT NOT NULL,
        display_diff_json TEXT
      );
      CREATE INDEX automation_change_preview_targets_preview_idx
        ON automation_change_preview_targets (preview_id);
    `,
  },
  createRelationalMigration("automation", automationResources, {
    sequence: 3,
    dependsOn: ["automation-0002"],
    beforeDropSql: `
      INSERT OR IGNORE INTO automation_change_previews
        (id, project_id, rationale, status, version, created_at, updated_at)
      SELECT id, project_id, '从早期 Desktop2 预览转换',
             CASE WHEN status IN ('pending', 'committed', 'discarded') THEN status ELSE 'discarded' END,
             version, created_at, updated_at
        FROM automation_nodes WHERE kind = 'change-preview';
    `,
  }),
] as const;

const jsonResponse = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const errors = {
  400: jsonResponse(problemDetailsSchema, "Invalid request"),
  401: jsonResponse(problemDetailsSchema, "Authentication required"),
  404: jsonResponse(problemDetailsSchema, "Resource not found"),
  409: jsonResponse(problemDetailsSchema, "Conflict"),
  412: jsonResponse(problemDetailsSchema, "Version conflict"),
  428: jsonResponse(problemDetailsSchema, "If-Match required"),
  500: jsonResponse(problemDetailsSchema, "Internal error"),
} as const;

function expectedVersion(request: Request): number {
  const value = request.headers.get("if-match");
  if (!value) {
    requireIfMatch(request, 0);
    return 0;
  }
  return Number(/^"v(\d+)"$/.exec(value)?.[1] ?? Number.NaN);
}

const automationServer: Plugin = {
  name: "dramaip-automation",
  provide: "automationRuntime",
  inject: ["http", "uow"],
  apply(ctx) {
    const runtime = new AutomationRuntimeService(ctx, ctx.uow);
    installRelationalPluginServer(ctx, {
      pluginId: "automation",
      routeBase: "/api/v2/automation",
      resources: automationResources,
    });
    const routes: RouteContribution = {
      id: "automation.change-previews.http.v2",
      pluginId: "automation",
      install(app) {
        const get = createRoute({
          method: "get",
          path: "/api/v2/automation/change-previews/{id}",
          request: { params: z.object({ id: z.uuid() }) },
          responses: {
            200: jsonResponse(changePreviewSchema, "Change preview"),
            ...errors,
          },
        });
        app.openapi(get, (context) => {
          const value = runtime.getPreview(context.req.valid("param").id);
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });

        const update = createRoute({
          method: "patch",
          path: "/api/v2/automation/change-previews/{id}",
          request: {
            params: z.object({ id: z.uuid() }),
            body: {
              content: {
                "application/json": {
                  schema: z
                    .object({
                      rationale: z.string().max(20_000).optional(),
                      targets: z.array(changeTargetSchema).min(1).optional(),
                    })
                    .strict(),
                },
              },
            },
          },
          responses: {
            200: jsonResponse(changePreviewSchema, "Change preview updated"),
            ...errors,
          },
        });
        app.openapi(update, (context) => {
          const value = runtime.updatePreview(
            context.req.valid("param").id,
            expectedVersion(context.req.raw),
            context.req.valid("json"),
          );
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });

        for (const action of ["commit", "discard"] as const) {
          const route = createRoute({
            method: "post",
            path: `/api/v2/automation/change-previews/{id}/actions/${action}`,
            request: { params: z.object({ id: z.uuid() }) },
            responses: {
              200: jsonResponse(
                changePreviewSchema,
                `Change preview ${action}`,
              ),
              ...errors,
            },
          });
          app.openapi(route, async (context) =>
            idempotentResponse(
              ctx.uow,
              context.req.raw,
              `automation.change-preview.${action}`,
              {},
              async () => {
                const value = runtime[
                  action === "commit" ? "commitPreview" : "discardPreview"
                ](
                  context.req.valid("param").id,
                  expectedVersion(context.req.raw),
                );
                context.header("etag", `"v${value.version}"`);
                return context.json(value, 200);
              },
            ),
          );
        }
      },
    };
    ctx.http.register(routes);
  },
};

export const automationModule = defineDramaPlugin({
  descriptor: {
    id: "automation",
    version: "2.0.0",
    runtime: "both",
    requires: ["foundation", "workspace"],
    provides: [
      "automation.runtime",
      "automation.tasks",
      "automation.workflows",
      "automation.templates",
      "automation.change-previews",
    ],
    critical: true,
  },
  contracts: {
    node: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("task"), data: taskData }),
      z.object({ kind: z.literal("workflow"), data: workflowData }),
      z.object({ kind: z.literal("template"), data: templateData }),
    ]),
    changePreview: changePreviewSchema,
  },
  server: automationServer,
  migrations,
});

export * from "./services.ts";
