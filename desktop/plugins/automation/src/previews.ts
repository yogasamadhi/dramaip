import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  ChangePreviewContentInputSchema,
  ChangePreviewSchema,
  EpisodeWorkflowInputSchema,
  EpisodeWorkflowResultSchema,
  ProviderActionPreviewSchema,
  PROVIDER_ACTION_EXECUTOR_SERVICE,
  TaskSchema,
  TemplateRunInputSchema,
  TemplateRunResultSchema,
  type AutomationPreviewService,
  type ChangePreview,
  type ProviderActionExecutorService,
  type ProviderActionPreview,
  type Task,
} from "@dramaip/contracts/automation";
import {
  CREATIVE_QUALITY_SERVICE,
  type CreativeQualityRecordService,
} from "@dramaip/contracts/creative-quality";
import {
  DELIVERY_RECORD_SERVICE,
  type DeliveryRecordService,
} from "@dramaip/contracts/delivery";
import {
  MEDIA_RECORD_SERVICE,
  type MediaRecordService,
} from "@dramaip/contracts/media";
import {
  PRODUCTION_RECORD_SERVICE,
  type ProductionRecordService,
} from "@dramaip/contracts/production";
import {
  REVIEW_RECORD_SERVICE,
  type ReviewRecordService,
} from "@dramaip/contracts/review";
import {
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
  type WritingChapterService,
  type WritingResourceService,
} from "@dramaip/contracts/writing";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface RouteContext {
  req: {
    param(name: string): string;
    header(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
}

interface ChangeRow {
  id: string;
  project_id: string;
  session_id: string | null;
  run_id: string | null;
  task_id: string | null;
  engine_kind: string | null;
  task_type: string | null;
  targets_json: string;
  rationale: string;
  status: ChangePreview["status"];
  content_hash: string;
  created_at: string;
  committed_at: string | null;
}

interface ProviderRow {
  id: string;
  project_id: string;
  session_id: string | null;
  run_id: string | null;
  task_id: string | null;
  kind: ProviderActionPreview["kind"];
  provider_id: string;
  model_id: string | null;
  parameters_json: string;
  estimated_cost: number | null;
  currency: string | null;
  status: ProviderActionPreview["status"];
  created_at: string;
  executed_at: string | null;
}

interface TaskRow {
  id: string;
  kind: string;
  status: Task["status"];
  title: string;
  progress: number;
  project_id: string | null;
  parent_task_id: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const idParams = z.object({ id: z.string().uuid() });

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

function declaration(input: {
  method: "get" | "post" | "put";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201 | 202;
}) {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["automation"],
    request: {
      ...(input.params ? { params: input.params } : {}),
      ...(input.body
        ? {
            body: {
              required: true,
              content: { "application/json": { schema: input.body } },
            },
          }
        : {}),
    },
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

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  openapi: unknown,
  handler: (context: RouteContext) => Response | Promise<Response>,
): RouteContribution {
  return defineRouteContribution({
    ...metadata,
    declaration: openapi,
    handler,
  });
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function change(row: ChangeRow): ChangePreview {
  return ChangePreviewSchema.parse({
    id: row.id,
    projectId: row.project_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    ...(row.engine_kind ? { engineKind: row.engine_kind } : {}),
    ...(row.task_type ? { taskType: row.task_type } : {}),
    targets: JSON.parse(row.targets_json),
    rationale: row.rationale,
    status: row.status,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    ...(row.committed_at ? { committedAt: row.committed_at } : {}),
  });
}

function provider(row: ProviderRow): ProviderActionPreview {
  return ProviderActionPreviewSchema.parse({
    id: row.id,
    projectId: row.project_id,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.task_id ? { taskId: row.task_id } : {}),
    kind: row.kind,
    providerId: row.provider_id,
    ...(row.model_id ? { modelId: row.model_id } : {}),
    parameters: JSON.parse(row.parameters_json),
    ...(row.estimated_cost === null
      ? {}
      : { estimatedCost: row.estimated_cost }),
    ...(row.currency ? { currency: row.currency } : {}),
    status: row.status,
    createdAt: row.created_at,
    ...(row.executed_at ? { executedAt: row.executed_at } : {}),
  });
}

function task(row: TaskRow): Task {
  return TaskSchema.parse({
    id: row.id,
    kind: row.kind,
    status: row.status,
    title: row.title,
    progress: row.progress,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    ...(row.result_json ? { result: JSON.parse(row.result_json) } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function createTask(
  transaction: UnitOfWorkTransaction,
  input: {
    kind: string;
    title: string;
    projectId?: string;
    status?: Task["status"];
    progress?: number;
    result?: unknown;
    error?: string;
  },
): Task {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  transaction.run(
    `INSERT INTO automation_tasks(
      id, kind, status, title, progress, project_id, parent_task_id,
      payload_json, result_json, error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    id,
    input.kind,
    input.status ?? "succeeded",
    input.title,
    input.progress ?? 1,
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
  transaction.append({
    type: "automation.task-created.v1",
    pluginId: "automation",
    aggregateType: "task",
    aggregateId: id,
    aggregateVersion: 0,
    payload: JSON.parse(JSON.stringify(value)),
  });
  return value;
}

function idempotencyKey(context: RouteContext): string | undefined {
  const key = context.req.header("Idempotency-Key")?.trim();
  return key && key.length >= 8 && key.length <= 200 ? key : undefined;
}

function containsSecret(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [name, child] of Object.entries(value)) {
    if (/secret|token|api.?key|password|credential/iu.test(name)) return true;
    if (containsSecret(child)) return true;
  }
  return false;
}

function previewService(context: PluginContext): AutomationPreviewService {
  return {
    createChange: (input) => {
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      return context.uow.execute((transaction) => {
        transaction.run(
          `INSERT INTO automation_change_previews(
            id, project_id, session_id, run_id, task_id, engine_kind, task_type,
            targets_json, rationale, status, content_hash, created_at, committed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`,
          id,
          input.projectId,
          input.sessionId ?? null,
          input.runId ?? null,
          input.taskId ?? null,
          input.engineKind ?? null,
          input.taskType ?? null,
          JSON.stringify(input.targets),
          input.rationale,
          stableHash(input.targets),
          createdAt,
        );
        const value = change(
          transaction.get<ChangeRow>(
            "SELECT * FROM automation_change_previews WHERE id = ?",
            id,
          )!,
        );
        transaction.append({
          type: "automation.change-preview-created.v1",
          pluginId: "automation",
          aggregateType: "change-preview",
          aggregateId: id,
          aggregateVersion: 0,
          payload: JSON.parse(JSON.stringify(value)),
        });
        return value;
      });
    },
    createProviderAction: (input) => {
      if (containsSecret(input.parameters))
        throw new Error("provider action parameters contain secret material");
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      return context.uow.execute((transaction) => {
        transaction.run(
          `INSERT INTO automation_provider_action_previews(
            id, project_id, session_id, run_id, task_id, kind, provider_id,
            model_id, parameters_json, estimated_cost, currency, status,
            created_at, executed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
          id,
          input.projectId,
          input.sessionId ?? null,
          input.runId ?? null,
          input.taskId ?? null,
          input.kind,
          input.providerId,
          input.modelId ?? null,
          JSON.stringify(input.parameters),
          input.estimatedCost ?? null,
          input.currency ?? null,
          createdAt,
        );
        const value = provider(
          transaction.get<ProviderRow>(
            "SELECT * FROM automation_provider_action_previews WHERE id = ?",
            id,
          )!,
        );
        transaction.append({
          type: "automation.provider-action-preview-created.v1",
          pluginId: "automation",
          aggregateType: "provider-action-preview",
          aggregateId: id,
          aggregateVersion: 0,
          payload: JSON.parse(JSON.stringify(value)),
        });
        return value;
      });
    },
  };
}

function applyChange(
  context: PluginContext,
  preview: ChangePreview,
): "conflict" | "unsupported" | "updated" {
  const workspace = context.services.optional<WorkspaceProjectService>(
    WORKSPACE_PROJECT_SERVICE,
  );
  const chapters = context.services.optional<WritingChapterService>(
    WRITING_CHAPTER_SERVICE,
  );
  const writing = context.services.optional<WritingResourceService>(
    WRITING_RESOURCE_SERVICE,
  );
  const production = context.services.optional<ProductionRecordService>(
    PRODUCTION_RECORD_SERVICE,
  );
  if (!workspace || !chapters || !writing || !production) return "unsupported";
  for (const target of preview.targets) {
    if (target.kind === "project") {
      const current = workspace.get(target.id);
      if (!current || current.version !== target.baseVersion) return "conflict";
    } else if (target.kind === "chapter") {
      const current = chapters.get(target.id);
      if (!current || current.version !== target.baseVersion) return "conflict";
    } else if (target.kind === "character" || target.kind === "outline") {
      const current = writing.get(target.id);
      if (!current || current.version !== target.baseVersion) return "conflict";
    } else if (["episode", "script", "scene", "shot"].includes(target.kind)) {
      const current = production.get(target.id);
      if (!current || current.version !== target.baseVersion) return "conflict";
    } else return "unsupported";
  }
  for (const target of preview.targets) {
    const patch = target.patch;
    if (target.kind === "project") {
      const result = workspace.update(target.id, {
        version: target.baseVersion,
        ...(typeof patch.title === "string" ? { title: patch.title } : {}),
        ...(typeof patch.synopsis === "string"
          ? { synopsis: patch.synopsis }
          : {}),
        ...(typeof patch.coreHook === "string"
          ? { coreHook: patch.coreHook }
          : {}),
        ...(typeof patch.coreSellingPoint === "string"
          ? { coreSellingPoint: patch.coreSellingPoint }
          : {}),
      });
      if (!result || result === "conflict") return "conflict";
    } else if (target.kind === "chapter") {
      const result = chapters.update(target.id, {
        version: target.baseVersion,
        ...(typeof patch.title === "string" ? { title: patch.title } : {}),
        ...(typeof patch.summary === "string"
          ? { summary: patch.summary }
          : {}),
        ...(typeof patch.outline === "string"
          ? { outline: patch.outline }
          : {}),
        ...(typeof patch.content === "string"
          ? { content: patch.content }
          : {}),
      });
      if (result.state !== "updated") return "conflict";
    } else if (target.kind === "character" || target.kind === "outline") {
      const current = writing.get(target.id)!;
      const result = writing.update(target.id, {
        version: target.baseVersion,
        ...(typeof patch.title === "string" ? { title: patch.title } : {}),
        payload: {
          ...current.payload,
          ...(patch.payload && typeof patch.payload === "object"
            ? patch.payload
            : patch),
        },
      });
      if (!result || result === "conflict") return "conflict";
    } else {
      const current = production.get(target.id)!;
      const result = production.update(target.id, {
        version: target.baseVersion,
        ...(typeof patch.title === "string" ? { title: patch.title } : {}),
        payload: {
          ...current.payload,
          ...(patch.payload && typeof patch.payload === "object"
            ? patch.payload
            : patch),
        },
      });
      if (!result || result === "conflict") return "conflict";
    }
  }
  return "updated";
}

function workflow(
  context: PluginContext,
  input: z.infer<typeof EpisodeWorkflowInputSchema>,
) {
  const production = context.services.optional<ProductionRecordService>(
    PRODUCTION_RECORD_SERVICE,
  );
  const episode = production?.get(input.episodeId);
  if (
    !production ||
    !episode ||
    episode.kind !== "episodes" ||
    episode.projectId !== input.projectId
  )
    return undefined;
  const media =
    context.services.optional<MediaRecordService>(MEDIA_RECORD_SERVICE);
  const creative = context.services.optional<CreativeQualityRecordService>(
    CREATIVE_QUALITY_SERVICE,
  );
  const review = context.services.optional<ReviewRecordService>(
    REVIEW_RECORD_SERVICE,
  );
  const delivery = context.services.optional<DeliveryRecordService>(
    DELIVERY_RECORD_SERVICE,
  );
  const scripts = production.list("scripts", { parentId: episode.id });
  const scenes = scripts.flatMap((script) =>
    production.list("scenes", { parentId: script.id }),
  );
  const shots = scenes.flatMap((scene) =>
    production.list("shots", { parentId: scene.id }),
  );
  const evidence = {
    episodeId: episode.id,
    scripts: scripts.length,
    scenes: scenes.length,
    shots: shots.length,
    evaluatedAt: new Date().toISOString(),
  };
  if (input.kind === "quality-check" && creative) {
    const record = creative.create("quality", {
      projectId: input.projectId,
      parentId: episode.id,
      value: {
        ...evidence,
        score: Math.min(100, 40 + scripts.length * 15 + shots.length * 3),
        findings: shots.length ? [] : ["尚未建立可审阅分镜。"],
      },
    });
    return {
      recordId: record.id,
      recordOwner: "creative-quality",
      summary: "分集质量检查已完成。",
    };
  }
  if (input.kind === "compliance-check" && review) {
    const record = review.create("compliance", {
      projectId: input.projectId,
      parentId: episode.id,
      value: { ...evidence, status: "needs-human-review", findings: [] },
    });
    return {
      recordId: record.id,
      recordOwner: "review",
      summary: "合规证据已整理，等待人工确认。",
    };
  }
  if (input.kind === "delivery-preflight" && delivery) {
    const record = delivery.create("delivery", {
      projectId: input.projectId,
      parentId: episode.id,
      value: {
        ...evidence,
        status: shots.length > 0 ? "ready-with-warnings" : "blocked",
        warnings: shots.length ? ["需核验素材权利与字幕。"] : ["分镜为空。"],
      },
    });
    return {
      recordId: record.id,
      recordOwner: "delivery",
      summary: "交付预检已完成。",
    };
  }
  if (
    (input.kind === "render-preflight" || input.kind === "animatic-draft") &&
    media
  ) {
    const record = media.create(
      input.kind === "animatic-draft" ? "animatics" : "renders",
      {
        projectId: input.projectId,
        parentId: episode.id,
        title: `${episode.title}·${input.kind === "animatic-draft" ? "动态分镜草稿" : "渲染预检"}`,
        payload: {
          ...evidence,
          status: shots.length ? "draft" : "blocked",
          notice: "本操作只建立制作清单，不伪造已渲染媒体。",
        },
      },
    );
    return {
      recordId: record.id,
      recordOwner: "media",
      summary: "制作清单已建立。",
    };
  }
  if (
    (input.kind === "minimal-redo-plan" || input.kind === "review-package") &&
    review
  ) {
    const record = review.create("review", {
      projectId: input.projectId,
      parentId: episode.id,
      value: {
        ...evidence,
        kind: input.kind,
        status: "draft",
        recommendations: shots.length ? [] : ["先完成分镜拆解。"],
      },
    });
    return {
      recordId: record.id,
      recordOwner: "review",
      summary: "审阅草案已建立。",
    };
  }
  return null;
}

export const automationPreviewMigrations: readonly PluginMigration[] = [
  {
    id: "automation.0003.previews-and-templates",
    pluginId: "automation",
    version: "3.0.0-alpha.3",
    dependsOn: ["automation.0002.pilot-plans"],
    sql: `
      CREATE TABLE IF NOT EXISTS automation_change_previews (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        session_id TEXT,
        run_id TEXT,
        task_id TEXT,
        engine_kind TEXT,
        task_type TEXT,
        targets_json TEXT NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        committed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS automation_provider_action_previews (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        session_id TEXT,
        run_id TEXT,
        task_id TEXT,
        kind TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT,
        parameters_json TEXT NOT NULL,
        estimated_cost REAL,
        currency TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        executed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS automation_templates (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS automation_template_runs (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL REFERENCES automation_templates(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        rendered TEXT NOT NULL,
        variables_json TEXT NOT NULL,
        missing_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT OR IGNORE INTO automation_templates(
        id, project_id, title, body, created_at, updated_at
      ) VALUES (
        '00000000-0000-4000-8000-000000000301', NULL,
        '分集诊断摘要', '项目：{{project}}\n分集：{{episode}}\n目标：{{goal}}',
        '2026-08-20T00:00:00.000Z', '2026-08-20T00:00:00.000Z'
      );
    `,
  },
];

export function automationPreviewRuntime(context: PluginContext): {
  service: AutomationPreviewService;
  routes: readonly RouteContribution[];
} {
  const service = previewService(context);
  const routes: RouteContribution[] = [
    route(
      {
        id: "automation:change-preview-get",
        pluginId: "automation",
        method: "get",
        path: "/api/v2/change-previews/{id}",
        operationId: "change-previews.get",
      },
      declaration({
        method: "get",
        path: "/api/v2/change-previews/{id}",
        operationId: "change-previews.get",
        params: idParams,
        response: ChangePreviewSchema,
      }),
      (requestContext) => {
        const row = context.uow.execute((transaction) =>
          transaction.get<ChangeRow>(
            "SELECT * FROM automation_change_previews WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        return row
          ? requestContext.json(change(row))
          : problem(requestContext, 404, "NOT_FOUND", "变更预览不存在。");
      },
    ),
    route(
      {
        id: "automation:change-preview-content",
        pluginId: "automation",
        method: "put",
        path: "/api/v2/change-previews/{id}/content",
        operationId: "change-previews.updateContent",
      },
      declaration({
        method: "put",
        path: "/api/v2/change-previews/{id}/content",
        operationId: "change-previews.updateContent",
        params: idParams,
        body: ChangePreviewContentInputSchema,
        response: ChangePreviewSchema,
      }),
      async (requestContext) => {
        const input = ChangePreviewContentInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "候选正文无效。",
          );
        const value = context.uow.execute((transaction) => {
          const row = transaction.get<ChangeRow>(
            "SELECT * FROM automation_change_previews WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!row || row.status !== "pending") return undefined;
          const targets = ChangePreviewSchema.shape.targets.parse(
            JSON.parse(row.targets_json),
          );
          const chapter = targets.find((target) => target.kind === "chapter");
          if (!chapter) return "unsupported" as const;
          chapter.patch = { ...chapter.patch, content: input.data.content };
          transaction.run(
            "UPDATE automation_change_previews SET targets_json = ?, content_hash = ? WHERE id = ?",
            JSON.stringify(targets),
            stableHash(targets),
            row.id,
          );
          transaction.append({
            type: "automation.change-preview-content-updated.v1",
            pluginId: "automation",
            aggregateType: "change-preview",
            aggregateId: row.id,
            aggregateVersion: 0,
            payload: { id: row.id, contentHash: stableHash(targets) },
          });
          return change(
            transaction.get<ChangeRow>(
              "SELECT * FROM automation_change_previews WHERE id = ?",
              row.id,
            )!,
          );
        });
        if (value === "unsupported")
          return problem(
            requestContext,
            409,
            "UNSUPPORTED_OPERATION",
            "该预览不包含可编辑章节正文。",
          );
        return value
          ? requestContext.json(value)
          : problem(
              requestContext,
              409,
              "CONFLICT",
              "变更预览不存在或已处理。",
            );
      },
    ),
    ...[
      {
        action: "commit" as const,
        id: "automation:change-preview-commit",
        path: "/api/v2/change-previews/{id}/commit" as const,
        operationId: "change-previews.commit",
      },
      {
        action: "discard" as const,
        id: "automation:change-preview-discard",
        path: "/api/v2/change-previews/{id}/discard" as const,
        operationId: "change-previews.discard",
      },
    ].map(({ action, id, path, operationId }) =>
      route(
        {
          id,
          pluginId: "automation",
          method: "post",
          path,
          operationId,
        },
        declaration({
          method: "post",
          path,
          operationId,
          params: idParams,
          response: ChangePreviewSchema,
        }),
        (requestContext) => {
          if (!idempotencyKey(requestContext))
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "操作必须提供 Idempotency-Key。",
            );
          const row = context.uow.execute((transaction) =>
            transaction.get<ChangeRow>(
              "SELECT * FROM automation_change_previews WHERE id = ?",
              requestContext.req.param("id"),
            ),
          );
          if (!row)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "变更预览不存在。",
            );
          const current = change(row);
          if (current.status !== "pending")
            return problem(requestContext, 409, "CONFLICT", "变更预览已处理。");
          if (action === "commit") {
            const result = applyChange(context, current);
            if (result !== "updated") {
              context.uow.execute((transaction) =>
                transaction.run(
                  "UPDATE automation_change_previews SET status = 'conflicted' WHERE id = ?",
                  current.id,
                ),
              );
              return problem(
                requestContext,
                409,
                result === "unsupported" ? "UNSUPPORTED_OPERATION" : "CONFLICT",
                result === "unsupported"
                  ? "预览包含当前版本不支持的写入目标。"
                  : "目标内容已变化，请重新生成预览。",
              );
            }
          }
          const value = context.uow.execute((transaction) => {
            const at = new Date().toISOString();
            transaction.run(
              "UPDATE automation_change_previews SET status = ?, committed_at = ? WHERE id = ?",
              action === "commit" ? "committed" : "discarded",
              action === "commit" ? at : null,
              current.id,
            );
            const updated = change(
              transaction.get<ChangeRow>(
                "SELECT * FROM automation_change_previews WHERE id = ?",
                current.id,
              )!,
            );
            transaction.append({
              type: `automation.change-preview-${action === "commit" ? "committed" : "discarded"}.v1`,
              pluginId: "automation",
              aggregateType: "change-preview",
              aggregateId: current.id,
              aggregateVersion: 0,
              payload: JSON.parse(JSON.stringify(updated)),
            });
            return updated;
          });
          return requestContext.json(value);
        },
      ),
    ),
    route(
      {
        id: "automation:provider-preview-get",
        pluginId: "automation",
        method: "get",
        path: "/api/v2/provider-action-previews/{id}",
        operationId: "provider-action-previews.get",
      },
      declaration({
        method: "get",
        path: "/api/v2/provider-action-previews/{id}",
        operationId: "provider-action-previews.get",
        params: idParams,
        response: ProviderActionPreviewSchema,
      }),
      (requestContext) => {
        const row = context.uow.execute((transaction) =>
          transaction.get<ProviderRow>(
            "SELECT * FROM automation_provider_action_previews WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        return row
          ? requestContext.json(provider(row))
          : problem(requestContext, 404, "NOT_FOUND", "厂商调用预览不存在。");
      },
    ),
    ...[
      {
        action: "execute" as const,
        id: "automation:provider-preview-execute",
        path: "/api/v2/provider-action-previews/{id}/execute" as const,
        operationId: "provider-action-previews.execute",
      },
      {
        action: "discard" as const,
        id: "automation:provider-preview-discard",
        path: "/api/v2/provider-action-previews/{id}/discard" as const,
        operationId: "provider-action-previews.discard",
      },
    ].map(({ action, id, path, operationId }) =>
      route(
        {
          id,
          pluginId: "automation",
          method: "post",
          path,
          operationId,
        },
        declaration({
          method: "post",
          path,
          operationId,
          params: idParams,
          response:
            action === "execute" ? TaskSchema : ProviderActionPreviewSchema,
          ...(action === "execute" ? { status: 202 as const } : {}),
        }),
        (requestContext) => {
          if (!idempotencyKey(requestContext))
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "操作必须提供 Idempotency-Key。",
            );
          const row = context.uow.execute((transaction) =>
            transaction.get<ProviderRow>(
              "SELECT * FROM automation_provider_action_previews WHERE id = ?",
              requestContext.req.param("id"),
            ),
          );
          if (!row)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "厂商调用预览不存在。",
            );
          const current = provider(row);
          if (current.status !== "pending")
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "厂商调用预览已处理。",
            );
          if (action === "discard") {
            const updated = context.uow.execute((transaction) => {
              transaction.run(
                "UPDATE automation_provider_action_previews SET status = 'discarded' WHERE id = ?",
                current.id,
              );
              const value = provider(
                transaction.get<ProviderRow>(
                  "SELECT * FROM automation_provider_action_previews WHERE id = ?",
                  current.id,
                )!,
              );
              transaction.append({
                type: "automation.provider-action-preview-discarded.v1",
                pluginId: "automation",
                aggregateType: "provider-action-preview",
                aggregateId: current.id,
                aggregateVersion: 0,
                payload: JSON.parse(JSON.stringify(value)),
              });
              return value;
            });
            return requestContext.json(updated);
          }
          const executor =
            context.services.optional<ProviderActionExecutorService>(
              PROVIDER_ACTION_EXECUTOR_SERVICE,
            );
          if (!executor)
            return problem(
              requestContext,
              409,
              "CAPABILITY_UNAVAILABLE",
              "媒体厂商执行能力不可用。",
            );
          try {
            const accepted = executor.execute(current);
            const created = context.uow.execute((transaction) => {
              const at = new Date().toISOString();
              transaction.run(
                "UPDATE automation_provider_action_previews SET status = 'executed', executed_at = ?, task_id = ? WHERE id = ?",
                at,
                accepted.taskId,
                current.id,
              );
              const value = createTask(transaction, {
                kind: `provider.${current.kind}`,
                title: "已确认的厂商任务",
                projectId: current.projectId,
                status: "queued",
                progress: 0,
                result: {
                  providerActionPreviewId: current.id,
                  providerTaskId: accepted.taskId,
                },
              });
              transaction.append({
                type: "automation.provider-action-preview-executed.v1",
                pluginId: "automation",
                aggregateType: "provider-action-preview",
                aggregateId: current.id,
                aggregateVersion: 0,
                payload: { id: current.id, taskId: value.id },
              });
              return value;
            });
            return requestContext.json(created, 202);
          } catch (error) {
            return problem(
              requestContext,
              409,
              "TASK_REJECTED",
              error instanceof Error ? error.message : "厂商任务启动失败。",
            );
          }
        },
      ),
    ),
    route(
      {
        id: "automation:template-run",
        pluginId: "automation",
        method: "post",
        path: "/api/v2/templates/{id}/run",
        operationId: "templates.run",
      },
      declaration({
        method: "post",
        path: "/api/v2/templates/{id}/run",
        operationId: "templates.run",
        params: idParams,
        body: TemplateRunInputSchema,
        response: TemplateRunResultSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = TemplateRunInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "模板运行参数无效。",
          );
        const template = context.uow.execute((transaction) =>
          transaction.get<{
            id: string;
            project_id: string | null;
            title: string;
            body: string;
          }>(
            "SELECT id, project_id, title, body FROM automation_templates WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!template)
          return problem(requestContext, 404, "NOT_FOUND", "模板不存在。");
        const values = Object.fromEntries(
          Object.entries(input.data.variables ?? {}).map(([name, value]) => [
            name.trim(),
            String(value),
          ]),
        );
        const variables = [
          ...new Set(
            [...template.body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu)].map(
              (match) => match[1]!.trim(),
            ),
          ),
        ];
        const missing = variables.filter((name) => !values[name]?.trim());
        const rendered = template.body.replace(
          /\{\{\s*([^{}]+?)\s*\}\}/gu,
          (_match, name: string) => values[name.trim()] ?? "",
        );
        const runId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        context.uow.execute((transaction) => {
          transaction.run(
            "INSERT INTO automation_template_runs(id, template_id, project_id, rendered, variables_json, missing_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            runId,
            template.id,
            input.data.projectId ?? template.project_id,
            rendered,
            JSON.stringify(variables),
            JSON.stringify(missing),
            createdAt,
          );
          transaction.append({
            type: "automation.template-run-created.v1",
            pluginId: "automation",
            aggregateType: "template-run",
            aggregateId: runId,
            aggregateVersion: 0,
            payload: { runId, templateId: template.id, missing },
          });
        });
        return requestContext.json(
          { runId, rendered, variables, missing, createdAt },
          201,
        );
      },
    ),
    route(
      {
        id: "automation:episode-workflow",
        pluginId: "automation",
        method: "post",
        path: "/api/v2/workflows/episodes/run",
        operationId: "workflows.runEpisode",
      },
      declaration({
        method: "post",
        path: "/api/v2/workflows/episodes/run",
        operationId: "workflows.runEpisode",
        body: EpisodeWorkflowInputSchema,
        response: EpisodeWorkflowResultSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = EpisodeWorkflowInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const key = idempotencyKey(requestContext);
        if (!input.success || !key)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "工作流参数或 Idempotency-Key 无效。",
          );
        const previous = context.uow.execute((transaction) =>
          transaction.get<{ response_json: string }>(
            "SELECT response_json FROM automation_idempotency WHERE scope = 'workflows.runEpisode' AND idempotency_key = ?",
            key,
          ),
        );
        if (previous)
          return requestContext.json(JSON.parse(previous.response_json), 201);
        const outcome = workflow(context, input.data);
        if (outcome === undefined)
          return problem(requestContext, 404, "NOT_FOUND", "未找到分集。");
        if (outcome === null)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "该工作流所需插件不可用。",
          );
        const response = context.uow.execute((transaction) => {
          const createdTask = createTask(transaction, {
            kind: input.data.kind,
            title: `${input.data.kind} 工作流`,
            projectId: input.data.projectId,
            result: outcome,
          });
          const value = { task: createdTask, ...outcome };
          transaction.run(
            "INSERT INTO automation_idempotency(scope, idempotency_key, request_hash, status, response_json, created_at) VALUES ('workflows.runEpisode', ?, ?, 201, ?, ?)",
            key,
            stableHash(input.data),
            JSON.stringify(value),
            new Date().toISOString(),
          );
          return value;
        });
        return requestContext.json(response, 201);
      },
    ),
  ];
  return { service, routes };
}
