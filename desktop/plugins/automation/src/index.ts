import { createRoute } from "@hono/zod-openapi";
import {
  RevisionInputSchema,
  RevisionPreviewSchema,
  AUTOMATION_TASK_SERVICE,
  TaskInputSchema,
  TaskRetryInputSchema,
  TaskSchema,
  type RevisionPreview,
  type AutomationTaskService,
  type Task,
} from "@dramaip/contracts/automation";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  WRITING_CHAPTER_SERVICE,
  type WritingChapterService,
} from "@dramaip/contracts/writing";
import {
  defineFirstPartyPlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";
import { pilotMigrations, pilotRoutes } from "./pilot.js";
import {
  automationPreviewMigrations,
  automationPreviewRuntime,
} from "./previews.js";
import { AUTOMATION_PREVIEW_SERVICE } from "@dramaip/contracts/automation";
import {
  automationResourceMigrations,
  automationResourceRoutes,
} from "./resources.js";

interface TaskRow {
  id: string;
  kind: string;
  status: Task["status"];
  title: string;
  progress: number;
  project_id: string | null;
  parent_task_id: string | null;
  payload_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface RevisionRow {
  id: string;
  chapter_id: string;
  base_version: number;
  proposed_content: string;
  rationale: string;
  status: RevisionPreview["status"];
  created_at: string;
  committed_at: string | null;
}

interface IdempotencyRow {
  request_hash: string;
  status: number;
  response_json: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    header(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
}

type Handler = (context: RouteContext) => Response | Promise<Response>;

function declaration(input: {
  method: "get" | "post";
  path: string;
  operationId: string;
  body?: ZodType;
  params?: ZodType;
  response: ZodType;
  status?: 200 | 201;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: [input.operationId.split(".")[0]],
    ...(input.body || input.params
      ? {
          request: {
            ...(input.params ? { params: input.params } : {}),
            ...(input.body
              ? {
                  body: {
                    required: true,
                    content: {
                      "application/json": { schema: input.body },
                    },
                  },
                }
              : {}),
          },
        }
      : {}),
    responses: {
      [status]: {
        description: "Success",
        content: { "application/json": { schema: input.response } },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
      409: {
        description: "Conflict",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
    },
  } as never);
}

function contribute(
  metadata: Omit<RouteContribution, "install">,
  openapi: unknown,
  handler: Handler,
): RouteContribution {
  return {
    ...metadata,
    install: (app) => {
      const register = app.openapi as unknown as (
        route: unknown,
        handler: Handler,
      ) => void;
      register.call(app, openapi, handler);
    },
  };
}

function problem(
  context: RouteContext,
  status: number,
  code: string,
  title: string,
): Response {
  return context.json(
    {
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title,
      detail: title,
      status,
      code,
      traceId: crypto.randomUUID(),
    },
    status,
  );
}

function parseJson(value: string | null): unknown | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function task(row: TaskRow): Task {
  const payload = parseJson(row.payload_json);
  const result = parseJson(row.result_json);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    progress: row.progress,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    ...(result === undefined
      ? payload === undefined
        ? {}
        : { result: { payload } }
      : { result }),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createRecordedTask(
  context: PluginContext,
  input: {
    kind: string;
    title: string;
    projectId?: string;
    status: "running" | "succeeded" | "failed";
    result?: unknown;
    error?: string;
  },
): Task {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return context.uow.execute((transaction) => {
    transaction.run(
      `INSERT INTO automation_tasks(
        id, kind, status, title, progress, project_id, parent_task_id,
        payload_json, result_json, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
      id,
      input.kind,
      input.status,
      input.title,
      input.status === "succeeded" ? 1 : 0,
      input.projectId ?? null,
      input.result === undefined ? null : JSON.stringify(input.result),
      input.error ?? null,
      now,
      now,
    );
    const value = task(
      transaction.get<TaskRow>(
        "SELECT * FROM automation_tasks WHERE id = ?",
        id,
      )!,
    );
    append(transaction, "task", "created", value);
    return value;
  });
}

function revision(row: RevisionRow): RevisionPreview {
  return {
    id: row.id,
    chapterId: row.chapter_id,
    baseVersion: row.base_version,
    proposedContent: row.proposed_content,
    rationale: row.rationale,
    status: row.status,
    createdAt: row.created_at,
    ...(row.committed_at ? { committedAt: row.committed_at } : {}),
  };
}

function append(
  transaction: UnitOfWorkTransaction,
  kind: "revision" | "task",
  action: string,
  value: { id: string; status?: string },
): void {
  transaction.append({
    type: `automation.${kind}-${action}.v1`,
    pluginId: "automation",
    aggregateType: kind,
    aggregateId: value.id,
    aggregateVersion: 0,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function key(context: RouteContext): string | undefined {
  const value = context.req.header("Idempotency-Key")?.trim();
  return value && value.length >= 8 && value.length <= 200 ? value : undefined;
}

function hash(value: unknown): string {
  return JSON.stringify(value);
}

function replay(
  transaction: UnitOfWorkTransaction,
  scope: string,
  idempotencyKey: string,
  requestHash: string,
): { status: number; value: unknown } | "conflict" | undefined {
  const row = transaction.get<IdempotencyRow>(
    "SELECT request_hash, status, response_json FROM automation_idempotency WHERE scope = ? AND idempotency_key = ?",
    scope,
    idempotencyKey,
  );
  if (!row) return undefined;
  return row.request_hash === requestHash
    ? { status: row.status, value: JSON.parse(row.response_json) }
    : "conflict";
}

function recordReplay(
  transaction: UnitOfWorkTransaction,
  scope: string,
  idempotencyKey: string,
  requestHash: string,
  status: number,
  value: unknown,
): void {
  transaction.run(
    "INSERT INTO automation_idempotency(scope, idempotency_key, request_hash, status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    scope,
    idempotencyKey,
    requestHash,
    status,
    JSON.stringify(value),
    new Date().toISOString(),
  );
}

function taskRoutes(context: PluginContext): readonly RouteContribution[] {
  const idParams = z.object({ id: z.string().uuid() });
  return [
    contribute(
      {
        id: "automation:tasks-list",
        pluginId: "automation",
        method: "get",
        path: "/api/v2/tasks",
        operationId: "tasks.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/tasks",
        operationId: "tasks.list",
        response: z.array(TaskSchema),
      }),
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<TaskRow>(
                "SELECT * FROM automation_tasks ORDER BY created_at DESC",
              )
              .map(task),
          ),
        ),
    ),
    contribute(
      {
        id: "automation:tasks-create",
        pluginId: "automation",
        method: "post",
        path: "/api/v2/tasks",
        operationId: "tasks.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/tasks",
        operationId: "tasks.create",
        body: TaskInputSchema,
        response: TaskSchema,
        status: 201,
      }),
      async (requestContext) => {
        const body = await requestContext.req.json();
        const parsed = TaskInputSchema.safeParse(body);
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "任务参数无效。",
          );
        if (!key(requestContext))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "创建任务必须提供 Idempotency-Key。",
          );
        return problem(
          requestContext,
          409,
          "TASK_REJECTED",
          "通用任务创建已禁用，请从对应业务操作启动任务。",
        );
      },
    ),
    ...(
      [
        ["cancel", z.object({}), "tasks.cancel"],
        ["retry", TaskRetryInputSchema, "tasks.retry"],
      ] as const
    ).map(([action, body, operationId]): RouteContribution =>
      contribute(
        {
          id: `automation:tasks-${action}`,
          pluginId: "automation",
          method: "post",
          path: `/api/v2/tasks/{id}/${action}`,
          operationId,
        },
        declaration({
          method: "post",
          path: `/api/v2/tasks/{id}/${action}`,
          operationId,
          params: idParams,
          ...(action === "retry" ? { body } : {}),
          response: TaskSchema,
        }),
        async (requestContext) => {
          if (action === "retry") {
            const parsed = TaskRetryInputSchema.safeParse(
              await requestContext.req.json(),
            );
            if (!parsed.success)
              return problem(
                requestContext,
                400,
                "VALIDATION_ERROR",
                "重试必须明确使用 Pi、Codex 或 Grok。",
              );
          }
          const id = requestContext.req.param("id");
          const result = context.uow.execute((transaction) => {
            const current = transaction.get<TaskRow>(
              "SELECT * FROM automation_tasks WHERE id = ?",
              id,
            );
            if (!current) return { state: "missing" as const };
            const allowed =
              action === "cancel"
                ? ["queued", "running"]
                : ["failed", "canceled", "interrupted"];
            if (!allowed.includes(current.status))
              return { state: "conflict" as const };
            const nextStatus = action === "cancel" ? "canceled" : "queued";
            transaction.run(
              "UPDATE automation_tasks SET status = ?, progress = 0, error = NULL, updated_at = ? WHERE id = ?",
              nextStatus,
              new Date().toISOString(),
              id,
            );
            const value = task(
              transaction.get<TaskRow>(
                "SELECT * FROM automation_tasks WHERE id = ?",
                id,
              )!,
            );
            append(transaction, "task", action, value);
            return { state: "updated" as const, value };
          });
          if (result.state === "missing")
            return problem(requestContext, 404, "NOT_FOUND", "未找到任务。");
          if (result.state === "conflict")
            return problem(
              requestContext,
              409,
              "CONFLICT",
              action === "cancel" ? "任务无法取消。" : "任务无法重试。",
            );
          return requestContext.json(result.value);
        },
      ),
    ),
  ];
}

function revisionRoutes(context: PluginContext): readonly RouteContribution[] {
  const idParams = z.object({ id: z.string().uuid() });
  const commitInput = z.object({ version: z.number().int().nonnegative() });
  const getRevision = (id: string): RevisionRow | undefined =>
    context.uow.execute((transaction) =>
      transaction.get<RevisionRow>(
        "SELECT * FROM automation_revision_previews WHERE id = ?",
        id,
      ),
    );
  return [
    contribute(
      {
        id: "automation:revisions-create",
        pluginId: "automation",
        method: "post",
        path: "/api/v2/revisions",
        operationId: "revisions.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/revisions",
        operationId: "revisions.create",
        body: RevisionInputSchema,
        response: RevisionPreviewSchema,
        status: 201,
      }),
      async (requestContext) => {
        const body = await requestContext.req.json();
        const parsed = RevisionInputSchema.safeParse(body);
        const idempotencyKey = key(requestContext);
        if (!parsed.success || !idempotencyKey)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "修订预览参数或 Idempotency-Key 无效。",
          );
        const writing = context.services.get<WritingChapterService>(
          WRITING_CHAPTER_SERVICE,
        );
        if (!writing)
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "章节服务尚未就绪。",
          );
        const chapter = writing.get(parsed.data.chapterId);
        if (!chapter)
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
        const requestHash = hash(parsed.data);
        const result = context.uow.execute((transaction) => {
          const previous = replay(
            transaction,
            "revisions.create",
            idempotencyKey,
            requestHash,
          );
          if (previous) return { replay: previous };
          const id = crypto.randomUUID();
          const timestamp = new Date().toISOString();
          transaction.run(
            `INSERT INTO automation_revision_previews(
              id, chapter_id, base_version, proposed_content, rationale,
              status, created_at, committed_at
            ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`,
            id,
            chapter.id,
            chapter.version,
            parsed.data.proposedContent,
            parsed.data.rationale ?? "",
            timestamp,
          );
          const value = revision(
            transaction.get<RevisionRow>(
              "SELECT * FROM automation_revision_previews WHERE id = ?",
              id,
            )!,
          );
          recordReplay(
            transaction,
            "revisions.create",
            idempotencyKey,
            requestHash,
            201,
            value,
          );
          append(transaction, "revision", "created", value);
          return { value };
        });
        if ("replay" in result && result.replay !== undefined) {
          if (result.replay === "conflict")
            return problem(
              requestContext,
              409,
              "IDEMPOTENCY_CONFLICT",
              "同一 Idempotency-Key 已用于其他请求。",
            );
          return requestContext.json(result.replay.value, result.replay.status);
        }
        return requestContext.json(result.value, 201);
      },
    ),
    contribute(
      {
        id: "automation:revisions-get",
        pluginId: "automation",
        method: "get",
        path: "/api/v2/revisions/{id}",
        operationId: "revisions.get",
      },
      declaration({
        method: "get",
        path: "/api/v2/revisions/{id}",
        operationId: "revisions.get",
        params: idParams,
        response: RevisionPreviewSchema,
      }),
      (requestContext) => {
        const row = getRevision(requestContext.req.param("id"));
        return row
          ? requestContext.json(revision(row))
          : problem(requestContext, 404, "NOT_FOUND", "未找到修订预览。");
      },
    ),
    ...(
      [
        ["commit", "revisions.commit", commitInput],
        ["discard", "revisions.discard", undefined],
      ] as const
    ).map(([action, operationId, bodySchema]): RouteContribution =>
      contribute(
        {
          id: `automation:revisions-${action}`,
          pluginId: "automation",
          method: "post",
          path: `/api/v2/revisions/{id}/${action}`,
          operationId,
        },
        declaration({
          method: "post",
          path: `/api/v2/revisions/{id}/${action}`,
          operationId,
          params: idParams,
          ...(bodySchema ? { body: bodySchema } : {}),
          response:
            action === "commit"
              ? z.object({ ok: z.literal(true), revisionId: z.string() })
              : RevisionPreviewSchema,
        }),
        async (requestContext) => {
          const id = requestContext.req.param("id");
          const idempotencyKey = key(requestContext);
          if (!idempotencyKey)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "操作必须提供 Idempotency-Key。",
            );
          const current = getRevision(id);
          if (!current)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到修订预览。",
            );
          if (current.status !== "pending")
            return problem(requestContext, 409, "CONFLICT", "修订预览已处理。");
          if (action === "commit") {
            const writing = context.services.get<WritingChapterService>(
              WRITING_CHAPTER_SERVICE,
            );
            if (!writing)
              return problem(
                requestContext,
                503,
                "CAPABILITY_UNAVAILABLE",
                "章节服务尚未就绪。",
              );
            const input = commitInput.safeParse(
              await requestContext.req.json(),
            );
            if (!input.success || input.data.version !== current.base_version)
              return problem(
                requestContext,
                409,
                "CONFLICT",
                "修订版本与章节基线不一致。",
              );
            const replaced = writing.replaceContent(
              current.chapter_id,
              current.base_version,
              current.proposed_content,
            );
            if (replaced.state !== "updated") {
              context.uow.execute((transaction) =>
                transaction.run(
                  "UPDATE automation_revision_previews SET status = 'conflicted' WHERE id = ?",
                  id,
                ),
              );
              return problem(
                requestContext,
                replaced.state === "missing" ? 404 : 409,
                replaced.state === "missing" ? "NOT_FOUND" : "CONFLICT",
                "章节已变化，无法提交修订。",
              );
            }
          }
          const value = context.uow.execute((transaction) => {
            const timestamp = new Date().toISOString();
            transaction.run(
              `UPDATE automation_revision_previews
                 SET status = ?, committed_at = ? WHERE id = ?`,
              action === "commit" ? "committed" : "discarded",
              action === "commit" ? timestamp : null,
              id,
            );
            const updated = revision(
              transaction.get<RevisionRow>(
                "SELECT * FROM automation_revision_previews WHERE id = ?",
                id,
              )!,
            );
            append(transaction, "revision", `${action}ted`, updated);
            return updated;
          });
          return requestContext.json(
            action === "commit" ? { ok: true, revisionId: id } : value,
          );
        },
      ),
    ),
  ];
}

const automationMigrations = [
  {
    id: "automation.0001.tasks-and-revisions",
    pluginId: "automation",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0001.projects-and-series"],
    sql: `
      CREATE TABLE IF NOT EXISTS automation_tasks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        parent_task_id TEXT REFERENCES automation_tasks(id) ON DELETE SET NULL,
        payload_json TEXT,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS automation_tasks_created
        ON automation_tasks(created_at DESC, id);
      CREATE TABLE IF NOT EXISTS automation_revision_previews (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL,
        base_version INTEGER NOT NULL,
        proposed_content TEXT NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        committed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS automation_idempotency (
        scope TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(scope, idempotency_key)
      );
    `,
  },
  ...pilotMigrations,
  ...automationPreviewMigrations,
  ...automationResourceMigrations,
] as const;

export const automationPlugin = defineFirstPartyPlugin({
  descriptor: {
    id: "automation",
    version: "3.0.0-alpha.3",
    apiVersion: "2",
    requires: ["foundation", "workspace"],
    provides: ["automation.tasks", "automation.previews"],
    stability: "internal",
  },
  ui: [
    {
      id: "automation.route.tasks",
      pluginId: "automation",
      kind: "route",
      metadata: { path: "/tasks", title: "任务" },
    },
    {
      id: "automation.navigation.tasks",
      pluginId: "automation",
      kind: "navigation",
      metadata: {
        section: "secondary",
        order: 30,
        label: "任务",
        to: "/tasks",
      },
    },
    {
      id: "automation.panel.project-tools",
      pluginId: "automation",
      kind: "panel",
      metadata: { slot: "project.tools", title: "工作流与模板" },
    },
  ],
  migrations: automationMigrations,
  activate: (context) => {
    const taskService: AutomationTaskService = {
      start: (input) =>
        createRecordedTask(context, { ...input, status: "running" }),
      update: (id, patch) =>
        context.uow.execute((transaction) => {
          const current = transaction.get<TaskRow>(
            "SELECT * FROM automation_tasks WHERE id = ?",
            id,
          );
          if (!current) return undefined;
          transaction.run(
            `UPDATE automation_tasks SET status = ?, progress = ?,
             result_json = ?, error = ?, updated_at = ? WHERE id = ?`,
            patch.status ?? current.status,
            patch.progress ?? current.progress,
            patch.result === undefined
              ? current.result_json
              : JSON.stringify(patch.result),
            patch.error ?? current.error,
            new Date().toISOString(),
            id,
          );
          const value = task(
            transaction.get<TaskRow>(
              "SELECT * FROM automation_tasks WHERE id = ?",
              id,
            )!,
          );
          append(transaction, "task", "updated", value);
          return value;
        }),
      complete: (input) =>
        createRecordedTask(context, { ...input, status: "succeeded" }),
      fail: (input) =>
        createRecordedTask(context, { ...input, status: "failed" }),
    };
    context.effect(
      context.services.provide(AUTOMATION_TASK_SERVICE, taskService),
      `service:${AUTOMATION_TASK_SERVICE}`,
    );
    const previewRuntime = automationPreviewRuntime(context);
    context.effect(
      context.services.provide(
        AUTOMATION_PREVIEW_SERVICE,
        previewRuntime.service,
      ),
      `service:${AUTOMATION_PREVIEW_SERVICE}`,
    );
    const routes = [
      ...taskRoutes(context),
      ...revisionRoutes(context),
      ...pilotRoutes(context),
      ...previewRuntime.routes,
      ...automationResourceRoutes(context),
    ];
    for (const route of routes)
      context.effect(context.http.register(route), `route:${route.id}`);
  },
});
