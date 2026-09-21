import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { CREATION_WORKFLOW_SERVICE } from "@dramaip/contracts/creation";
import { createRoute } from "@hono/zod-openapi";
import {
  RevisionInputSchema,
  RevisionPreviewSchema,
  AUTOMATION_TASK_SERVICE,
  AUTOMATION_RESOURCE_SERVICE,
  TaskAttentionInputSchema,
  TaskInputSchema,
  TaskRetryInputSchema,
  TaskSchema,
  TaskWorklistCategorySchema,
  TaskWorklistResponseSchema,
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
  defineRouteContribution,
  definePlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";
import { pilotMigrations, pilotRoutes } from "./pilot.js";
import { creationMigrations, creationRuntime } from "./creation.js";
import {
  automationPreviewMigrations,
  automationPreviewRuntime,
} from "./previews.js";
import { AUTOMATION_PREVIEW_SERVICE } from "@dramaip/contracts/automation";
import {
  automationResourceMigrations,
  automationResourceRoutes,
  automationResourceService,
} from "./resources.js";

interface TaskRow {
  id: string;
  kind: string;
  status: Task["status"];
  title: string;
  progress: number;
  project_id: string | null;
  parent_task_id: string | null;
  attention_status: Task["attentionStatus"];
  payload_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  result_status?: string | null;
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
    query(name: string): string | undefined;
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
  query?: ZodType;
  response: ZodType;
  status?: 200 | 201;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: [input.operationId.split(".")[0]],
    ...(input.body || input.params || input.query
      ? {
          request: {
            ...(input.params ? { params: input.params } : {}),
            ...(input.query ? { query: input.query } : {}),
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
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  openapi: unknown,
  handler: Handler,
): RouteContribution {
  return defineRouteContribution({
    ...metadata,
    declaration: openapi,
    handler,
  });
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
    attentionStatus: row.attention_status ?? "open",
    resultStatus: normalizeResultStatus(row.result_status),
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

function normalizeResultStatus(
  value: string | null | undefined,
): Task["resultStatus"] {
  if (value === "pending" || value === "discarded" || value === "conflicted")
    return value;
  if (value === "committed" || value === "executed" || value === "applied")
    return "applied";
  return "none";
}

const TASKS_WITH_RESULT_STATUS = `
  SELECT task.*,
    COALESCE(
      (SELECT provider.status
         FROM automation_provider_action_previews provider
        WHERE provider.task_id = task.id
           OR provider.id = json_extract(task.result_json, '$.providerActionPreviewId')
        ORDER BY provider.created_at DESC LIMIT 1),
      (SELECT preview.status
         FROM automation_change_previews preview
        WHERE preview.task_id = task.id
        ORDER BY preview.created_at DESC LIMIT 1)
    ) AS result_status
  FROM automation_tasks task`;

function taskWithResultStatus(
  transaction: UnitOfWorkTransaction,
  row: TaskRow,
): Task {
  const change = transaction.get<{ status: string }>(
    "SELECT status FROM automation_change_previews WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
    row.id,
  );
  const provider = transaction.get<{ status: string }>(
    `SELECT status FROM automation_provider_action_previews
      WHERE task_id = ?
         OR id = json_extract(?, '$.providerActionPreviewId')
      ORDER BY created_at DESC LIMIT 1`,
    row.id,
    row.result_json,
  );
  const value = task({
    ...row,
    result_status: provider?.status ?? change?.status,
  });
  if (
    !value.result ||
    typeof value.result !== "object" ||
    Array.isArray(value.result)
  )
    return value;
  const result = value.result as Record<string, unknown>;
  const changePreview = result.changePreview;
  const providerActionPreview = result.providerActionPreview;
  return {
    ...value,
    result: {
      ...result,
      ...(change && changePreview && typeof changePreview === "object"
        ? { changePreview: { ...changePreview, status: change.status } }
        : {}),
      ...(provider &&
      providerActionPreview &&
      typeof providerActionPreview === "object"
        ? {
            providerActionPreview: {
              ...providerActionPreview,
              status: provider.status,
            },
          }
        : {}),
    },
  };
}

function taskCategory(
  value: Task,
): "pending-result" | "running" | "attention" | "history" {
  if (value.resultStatus === "pending") return "pending-result";
  if (value.status === "queued" || value.status === "running") return "running";
  if (
    (value.status === "failed" || value.status === "interrupted") &&
    value.attentionStatus === "open"
  )
    return "attention";
  return "history";
}

function createRecordedTask(
  context: PluginContext,
  input: {
    kind: string;
    title: string;
    projectId?: string;
    parentTaskId?: string;
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      id,
      input.kind,
      input.status,
      input.title,
      input.status === "succeeded" ? 1 : 0,
      input.projectId ?? null,
      input.parentTaskId ?? null,
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
  const worklistQuery = z.object({
    projectId: z.string().uuid().optional(),
    category: TaskWorklistCategorySchema.default("pending-result"),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
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
                `${TASKS_WITH_RESULT_STATUS} ORDER BY task.created_at DESC`,
              )
              .map(task),
          ),
        ),
    ),
    contribute(
      {
        id: "automation:task-worklist",
        pluginId: "automation",
        method: "get",
        path: "/api/v2/task-worklist",
        operationId: "tasks.worklist",
      },
      declaration({
        method: "get",
        path: "/api/v2/task-worklist",
        operationId: "tasks.worklist",
        query: worklistQuery,
        response: TaskWorklistResponseSchema,
      }),
      (requestContext) => {
        const parsed = worklistQuery.safeParse({
          projectId: requestContext.req.query("projectId"),
          category: requestContext.req.query("category"),
          cursor: requestContext.req.query("cursor"),
          limit: requestContext.req.query("limit"),
        });
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "任务筛选参数无效。",
          );
        const response = context.uow.execute((transaction) => {
          const all = transaction
            .all<TaskRow>(
              parsed.data.projectId
                ? `${TASKS_WITH_RESULT_STATUS} WHERE task.project_id = ? ORDER BY task.created_at DESC, task.id DESC`
                : `${TASKS_WITH_RESULT_STATUS} ORDER BY task.created_at DESC, task.id DESC`,
              ...(parsed.data.projectId ? [parsed.data.projectId] : []),
            )
            .map(task);
          const counts = {
            pendingResult: all.filter(
              (item) => taskCategory(item) === "pending-result",
            ).length,
            running: all.filter((item) => taskCategory(item) === "running")
              .length,
            attention: all.filter((item) => taskCategory(item) === "attention")
              .length,
            history: all.filter((item) => taskCategory(item) === "history")
              .length,
          };
          const categorized = all.filter(
            (item) => taskCategory(item) === parsed.data.category,
          );
          const start = parsed.data.cursor
            ? Math.max(
                0,
                categorized.findIndex(
                  (item) =>
                    `${item.createdAt}|${item.id}` === parsed.data.cursor,
                ) + 1,
              )
            : 0;
          const items = categorized.slice(start, start + parsed.data.limit);
          const hasMore = start + items.length < categorized.length;
          return {
            items,
            counts,
            ...(hasMore && items.length
              ? { nextCursor: `${items.at(-1)!.createdAt}|${items.at(-1)!.id}` }
              : {}),
          };
        });
        return requestContext.json(response);
      },
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
    contribute(
      {
        id: "automation:task-attention",
        pluginId: "automation",
        method: "post",
        path: "/api/v2/tasks/{id}/attention",
        operationId: "tasks.setAttention",
      },
      declaration({
        method: "post",
        path: "/api/v2/tasks/{id}/attention",
        operationId: "tasks.setAttention",
        params: idParams,
        body: TaskAttentionInputSchema,
        response: TaskSchema,
      }),
      async (requestContext) => {
        const input = TaskAttentionInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "提醒状态无效。",
          );
        const value = context.uow.execute((transaction) => {
          const current = transaction.get<TaskRow>(
            "SELECT * FROM automation_tasks WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!current) return undefined;
          transaction.run(
            "UPDATE automation_tasks SET attention_status = ?, updated_at = ? WHERE id = ?",
            input.data.status,
            new Date().toISOString(),
            current.id,
          );
          const updated = taskWithResultStatus(
            transaction,
            transaction.get<TaskRow>(
              "SELECT * FROM automation_tasks WHERE id = ?",
              current.id,
            )!,
          );
          append(transaction, "task", "attention-updated", updated);
          return updated;
        });
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到任务。");
      },
    ),
    ...(
      [
        ["cancel", z.object({}), "tasks.cancel"],
        [
          "retry",
          TaskRetryInputSchema.or(z.object({}).strict()),
          "tasks.retry",
        ],
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
          const currentTask = context.uow.execute((tx) =>
            tx.get<TaskRow>(
              "SELECT * FROM automation_tasks WHERE id = ?",
              requestContext.req.param("id"),
            ),
          );
          const workflowId = currentTask?.result_json
            ? (
                JSON.parse(currentTask.result_json) as {
                  creationWorkflowId?: string;
                }
              ).creationWorkflowId
            : undefined;
          if (workflowId) {
            try {
              const service = optionalService(
                context,
                CREATION_WORKFLOW_SERVICE,
              );
              if (!service) throw new Error("创作工作流未启用。");
              const value = await service.action(
                workflowId,
                action,
                requestContext.req.header("Idempotency-Key") ??
                  (action === "cancel" ? `cancel:${workflowId}` : ""),
              );
              const result = context.uow.execute((tx) =>
                taskWithResultStatus(
                  tx,
                  tx.get<TaskRow>(
                    "SELECT * FROM automation_tasks WHERE id = ?",
                    value.taskId,
                  )!,
                ),
              );
              return requestContext.json(result);
            } catch (error) {
              return problem(
                requestContext,
                409,
                "CONFLICT",
                error instanceof Error ? error.message : "创作操作未完成。",
              );
            }
          }
          if (action === "retry") {
            const parsed = TaskRetryInputSchema.safeParse(
              await requestContext.req.json(),
            );
            if (!parsed.success)
              return problem(
                requestContext,
                400,
                "VALIDATION_ERROR",
                "重试必须明确使用 Pi、Codex、Grok 或 LangGraph.js。",
              );
          }
          const id = requestContext.req.param("id");
          const exists = context.uow.execute((transaction) => {
            const current = transaction.get<TaskRow>(
              "SELECT * FROM automation_tasks WHERE id = ?",
              id,
            );
            return Boolean(current);
          });
          if (!exists)
            return problem(requestContext, 404, "NOT_FOUND", "未找到任务。");
          return problem(
            requestContext,
            409,
            "TASK_OWNER_ACTION_REQUIRED",
            action === "cancel"
              ? "请返回任务所属业务操作执行取消；任务中心不会只修改本地状态。"
              : "请返回任务所属业务操作重新预检并提交；任务中心不会伪造重试。",
          );
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
        const writing = optionalService<WritingChapterService>(
          context,
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
            const writing = optionalService<WritingChapterService>(
              context,
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
  {
    id: "automation.0006.task-attention",
    pluginId: "automation",
    version: "3.0.0-alpha.3",
    dependsOn: ["automation.0003.previews-and-templates"],
    sql: `
      ALTER TABLE automation_tasks
        ADD COLUMN attention_status TEXT NOT NULL DEFAULT 'open';
      CREATE INDEX IF NOT EXISTS automation_tasks_attention
        ON automation_tasks(attention_status, status, created_at DESC, id);
      CREATE INDEX IF NOT EXISTS automation_change_previews_task
        ON automation_change_previews(task_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS automation_provider_previews_task
        ON automation_provider_action_previews(task_id, created_at DESC);
    `,
  },
] as const;

export const automationPlugin = definePlugin({
  inject: [WORKSPACE_PROJECT_SERVICE.id],
  descriptor: {
    id: "automation",
    version: "3.0.0-alpha.3",
    apiVersion: "2",
    requires: ["foundation", "workspace"],
    provides: [
      "automation.tasks",
      "automation.previews",
      "automation.resources",
    ],
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
  migrations: [...automationMigrations, ...creationMigrations],
  apply: (context) => {
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
             attention_status = ?, result_json = ?, error = ?, updated_at = ?
             WHERE id = ?`,
            patch.status ?? current.status,
            patch.progress ?? current.progress,
            patch.attentionStatus ?? current.attention_status,
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
      () => provideService(context, AUTOMATION_TASK_SERVICE, taskService),
      `service:${AUTOMATION_TASK_SERVICE}`,
    );
    const previewRuntime = automationPreviewRuntime(context);
    context.effect(
      () =>
        provideService(
          context,
          AUTOMATION_PREVIEW_SERVICE,
          previewRuntime.service,
        ),
      `service:${AUTOMATION_PREVIEW_SERVICE}`,
    );
    const resourceService = automationResourceService(context);
    context.effect(
      () =>
        provideService(context, AUTOMATION_RESOURCE_SERVICE, resourceService),
      `service:${AUTOMATION_RESOURCE_SERVICE}`,
    );
    const routes = [
      ...creationRuntime(context).routes,
      ...taskRoutes(context),
      ...revisionRoutes(context),
      ...pilotRoutes(context),
      ...previewRuntime.routes,
      ...automationResourceRoutes(context),
    ];
    for (const route of routes)
      context.effect(() => context.http.register(route), `route:${route.id}`);
  },
});

export default automationPlugin;
