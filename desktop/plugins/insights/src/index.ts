import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  AUTOMATION_TASK_SERVICE,
  TaskSchema,
  type AutomationTaskService,
} from "@dramaip/contracts/automation";
import {
  FeedbackBatchSchema,
  FeedbackClusterInputSchema,
  FeedbackClusterSchema,
  FeedbackCommitInputSchema,
  FeedbackDashboardSchema,
  FeedbackPreviewInputSchema,
  FeedbackPreviewSchema,
  GenerationRecordPatchSchema,
  GenerationRecordSchema,
  INSIGHTS_GENERATION_SERVICE,
  type GenerationRecord,
  type InsightsGenerationService,
} from "@dramaip/contracts/insights";
import {
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  defineRouteContribution,
  defineFirstPartyPlugin,
  type PluginContext,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface RouteContext {
  req: { param(name: string): string; json<T = unknown>(): Promise<T> };
  json(value: unknown, status?: number): Response;
}
type RouteHandler = (context: RouteContext) => Response | Promise<Response>;
interface PreviewRow {
  id: string;
  project_id: string;
  kind: "metrics" | "comments";
  source_name: string;
  rows_json: string;
  warnings_json: string;
  expires_at: string;
  created_at: string;
}
interface BatchRow {
  id: string;
  project_id: string;
  kind: "metrics" | "comments";
  source_name: string;
  row_count: number;
  created_at: string;
}
interface MetricRow {
  id: string;
  batch_id: string;
  name: string;
  value: number;
  occurred_at: string | null;
  dimensions_json: string;
  created_at: string;
}
interface CommentRow {
  id: string;
  batch_id: string;
  content: string;
  author: string | null;
  occurred_at: string | null;
  category: string;
  created_at: string;
}
interface ClusterRow {
  id: string;
  project_id: string;
  batch_id: string;
  title: string;
  summary: string;
  comment_count: number;
  created_at: string;
}
interface GenerationRow {
  id: string;
  project_id: string;
  task_id: string | null;
  kind: string;
  title: string;
  status: string;
  summary: string;
  actual_cost: number | null;
  currency: string;
  cost_note: string | null;
  created_at: string;
  updated_at: string;
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
function declaration(input: {
  method: "get" | "patch" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["insights"],
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
  handler: RouteHandler,
): RouteContribution {
  return defineRouteContribution({
    ...metadata,
    declaration: openapi,
    handler,
  });
}

const batch = (row: BatchRow) => ({
  id: row.id,
  projectId: row.project_id,
  kind: row.kind,
  sourceName: row.source_name,
  rowCount: row.row_count,
  createdAt: row.created_at,
});
const metric = (row: MetricRow) => ({
  id: row.id,
  batchId: row.batch_id,
  name: row.name,
  value: row.value,
  ...(row.occurred_at ? { occurredAt: row.occurred_at } : {}),
  dimensions: JSON.parse(row.dimensions_json) as unknown,
  createdAt: row.created_at,
});
const comment = (row: CommentRow) => ({
  id: row.id,
  batchId: row.batch_id,
  content: row.content,
  ...(row.author ? { author: row.author } : {}),
  ...(row.occurred_at ? { occurredAt: row.occurred_at } : {}),
  category: row.category,
  createdAt: row.created_at,
});
const cluster = (row: ClusterRow) => ({
  id: row.id,
  projectId: row.project_id,
  batchId: row.batch_id,
  title: row.title,
  summary: row.summary,
  commentCount: row.comment_count,
  createdAt: row.created_at,
});
function generation(row: GenerationRow): GenerationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    ...(row.task_id ? { taskId: row.task_id } : {}),
    kind: row.kind,
    title: row.title,
    status: row.status,
    summary: row.summary,
    ...(row.actual_cost === null ? {} : { actualCost: row.actual_cost }),
    currency: row.currency,
    ...(row.cost_note ? { costNote: row.cost_note } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(field.trim());
      field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("CSV 引号没有闭合。");
  return rows;
}
function recordsFromContent(
  kind: "metrics" | "comments",
  name: string,
  content: string,
): { rows: Record<string, unknown>[]; warnings: string[] } {
  let source: unknown;
  if (name.toLowerCase().endsWith(".json")) source = JSON.parse(content);
  else {
    const csv = parseCsv(content);
    const headers = csv.shift()?.map((value) => value.trim()) ?? [];
    source = csv.map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index]]),
      ),
    );
  }
  if (!Array.isArray(source)) throw new Error("反馈文件必须包含记录数组。");
  const warnings: string[] = [];
  const rows: Record<string, unknown>[] = [];
  source.forEach((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      warnings.push(`第 ${index + 1} 条不是对象，已跳过。`);
      return;
    }
    const item = value as Record<string, unknown>;
    if (kind === "metrics") {
      const nameValue = String(item.name ?? item["指标"] ?? "").trim();
      const number = Number(item.value ?? item["数值"]);
      if (!nameValue || !Number.isFinite(number)) {
        warnings.push(`第 ${index + 1} 条指标缺少名称或数值，已跳过。`);
        return;
      }
      rows.push({
        name: nameValue.slice(0, 160),
        value: number,
        ...(item.occurredAt ? { occurredAt: String(item.occurredAt) } : {}),
        dimensions:
          item.dimensions && typeof item.dimensions === "object"
            ? item.dimensions
            : {},
      });
      return;
    }
    const body = String(item.content ?? item["评论"] ?? "").trim();
    if (!body) {
      warnings.push(`第 ${index + 1} 条评论为空，已跳过。`);
      return;
    }
    rows.push({
      content: body.slice(0, 10_000),
      ...(item.author ? { author: String(item.author).slice(0, 160) } : {}),
      ...(item.occurredAt ? { occurredAt: String(item.occurredAt) } : {}),
      category: String(item.category ?? item["分类"] ?? "其他反馈").slice(
        0,
        160,
      ),
    });
  });
  return { rows, warnings };
}

function createGenerationService(
  context: PluginContext,
): InsightsGenerationService {
  return {
    record: (input) =>
      context.uow.execute((transaction) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        transaction.run(
          `INSERT INTO insights_generation_records(
            id, project_id, task_id, kind, title, status, summary,
            actual_cost, currency, cost_note, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          id,
          input.projectId,
          input.taskId ?? null,
          input.kind,
          input.title,
          input.status,
          input.summary,
          input.actualCost ?? null,
          input.currency ?? "CNY",
          now,
          now,
        );
        const value = generation(
          transaction.get<GenerationRow>(
            "SELECT * FROM insights_generation_records WHERE id = ?",
            id,
          )!,
        );
        transaction.append({
          type: "insights.generation-recorded.v1",
          pluginId: "insights",
          aggregateType: "generation-record",
          aggregateId: id,
          aggregateVersion: 0,
          payload: JSON.parse(JSON.stringify(value)),
        });
        return value;
      }),
  };
}

function feedbackRoutes(
  context: PluginContext,
  host: DesktopHostClient | undefined,
  workspace: WorkspaceProjectService,
  tasks: AutomationTaskService,
): RouteContribution[] {
  const idParams = z.object({ id: z.string().uuid() });
  return [
    route(
      {
        id: "insights:feedback-preview",
        pluginId: "insights",
        method: "post",
        path: "/api/v2/feedback/preview",
        operationId: "feedback.preview",
      },
      declaration({
        method: "post",
        path: "/api/v2/feedback/preview",
        operationId: "feedback.preview",
        body: FeedbackPreviewInputSchema,
        response: FeedbackPreviewSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = FeedbackPreviewInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success || !workspace.get(input.data.projectId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "反馈导入参数无效。",
          );
        if (!host)
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "当前模式无法读取本地反馈文件。",
          );
        try {
          const file = await host.readGrantedText(
            input.data.capabilityToken,
            4 * 1024 * 1024,
          );
          const parsed = recordsFromContent(
            input.data.kind,
            file.name,
            file.content,
          );
          if (!parsed.rows.length)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "反馈文件没有有效记录。",
            );
          const value = context.uow.execute((transaction) => {
            const id = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
            const now = new Date().toISOString();
            transaction.run(
              "INSERT INTO insights_feedback_previews VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              id,
              input.data.projectId,
              input.data.kind,
              file.name,
              JSON.stringify(parsed.rows),
              JSON.stringify(parsed.warnings),
              expiresAt,
              now,
            );
            return {
              importId: id,
              projectId: input.data.projectId,
              kind: input.data.kind,
              sourceName: file.name,
              validCount: parsed.rows.length,
              warnings: parsed.warnings,
              sample: parsed.rows.slice(0, 8),
              expiresAt,
            };
          });
          return requestContext.json(value, 201);
        } catch (error) {
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            error instanceof Error ? error.message : "反馈文件无法读取。",
          );
        }
      },
    ),
    route(
      {
        id: "insights:feedback-commit",
        pluginId: "insights",
        method: "post",
        path: "/api/v2/feedback/{id}/commit",
        operationId: "feedback.commit",
      },
      declaration({
        method: "post",
        path: "/api/v2/feedback/{id}/commit",
        operationId: "feedback.commit",
        params: idParams,
        body: FeedbackCommitInputSchema,
        response: FeedbackBatchSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = FeedbackCommitInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "反馈项目无效。",
          );
        const result = context.uow.execute((transaction) => {
          const stored = transaction.get<PreviewRow>(
            "SELECT * FROM insights_feedback_previews WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!stored) return { state: "missing" as const };
          if (stored.project_id !== input.data.projectId)
            return { state: "invalid" as const };
          if (stored.expires_at < new Date().toISOString()) {
            transaction.run(
              "DELETE FROM insights_feedback_previews WHERE id = ?",
              stored.id,
            );
            return { state: "expired" as const };
          }
          const values = JSON.parse(stored.rows_json) as Record<
            string,
            unknown
          >[];
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          transaction.run(
            "INSERT INTO insights_feedback_batches VALUES (?, ?, ?, ?, ?, ?)",
            id,
            stored.project_id,
            stored.kind,
            stored.source_name,
            values.length,
            now,
          );
          for (const value of values) {
            if (stored.kind === "metrics")
              transaction.run(
                "INSERT INTO insights_feedback_metrics VALUES (?, ?, ?, ?, ?, ?, ?)",
                crypto.randomUUID(),
                id,
                value.name,
                value.value,
                value.occurredAt ?? null,
                JSON.stringify(value.dimensions ?? {}),
                now,
              );
            else
              transaction.run(
                "INSERT INTO insights_feedback_comments VALUES (?, ?, ?, ?, ?, ?, ?)",
                crypto.randomUUID(),
                id,
                value.content,
                value.author ?? null,
                value.occurredAt ?? null,
                value.category,
                now,
              );
          }
          transaction.run(
            "DELETE FROM insights_feedback_previews WHERE id = ?",
            stored.id,
          );
          const created = batch(
            transaction.get<BatchRow>(
              "SELECT * FROM insights_feedback_batches WHERE id = ?",
              id,
            )!,
          );
          transaction.append({
            type: "insights.feedback-imported.v1",
            pluginId: "insights",
            aggregateType: "feedback-batch",
            aggregateId: id,
            aggregateVersion: 0,
            payload: JSON.parse(JSON.stringify(created)),
          });
          return { state: "created" as const, value: created };
        });
        if (result.state === "missing")
          return problem(requestContext, 404, "NOT_FOUND", "未找到反馈预览。");
        if (result.state !== "created")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            result.state === "expired"
              ? "反馈预览已过期。"
              : "反馈项目与预览不一致。",
          );
        return requestContext.json(result.value, 201);
      },
    ),
    route(
      {
        id: "insights:feedback-dashboard",
        pluginId: "insights",
        method: "get",
        path: "/api/v2/projects/{id}/feedback",
        operationId: "feedback.dashboard",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{id}/feedback",
        operationId: "feedback.dashboard",
        params: idParams,
        response: FeedbackDashboardSchema,
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(
          context.uow.execute((transaction) => ({
            batches: transaction
              .all<BatchRow>(
                "SELECT * FROM insights_feedback_batches WHERE project_id = ? ORDER BY created_at DESC",
                projectId,
              )
              .map(batch),
            metrics: transaction
              .all<MetricRow>(
                `SELECT m.* FROM insights_feedback_metrics m
                 JOIN insights_feedback_batches b ON b.id = m.batch_id
                 WHERE b.project_id = ? ORDER BY m.created_at DESC LIMIT 500`,
                projectId,
              )
              .map(metric),
            comments: transaction
              .all<CommentRow>(
                `SELECT c.* FROM insights_feedback_comments c
                 JOIN insights_feedback_batches b ON b.id = c.batch_id
                 WHERE b.project_id = ? ORDER BY c.created_at DESC LIMIT 500`,
                projectId,
              )
              .map(comment),
            clusters: transaction
              .all<ClusterRow>(
                "SELECT * FROM insights_feedback_clusters WHERE project_id = ? ORDER BY created_at DESC",
                projectId,
              )
              .map(cluster),
          })),
        );
      },
    ),
    route(
      {
        id: "insights:feedback-cluster",
        pluginId: "insights",
        method: "post",
        path: "/api/v2/feedback/clusters",
        operationId: "feedback.cluster",
      },
      declaration({
        method: "post",
        path: "/api/v2/feedback/clusters",
        operationId: "feedback.cluster",
        body: FeedbackClusterInputSchema,
        response: z.array(FeedbackClusterSchema),
        status: 201,
      }),
      async (requestContext) => {
        const input = FeedbackClusterInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "评论聚类参数无效。",
          );
        const result = context.uow.execute((transaction) => {
          const selected = transaction.get<BatchRow>(
            "SELECT * FROM insights_feedback_batches WHERE id = ? AND project_id = ?",
            input.data.batchId,
            input.data.projectId,
          );
          if (!selected || selected.kind !== "comments") return undefined;
          const comments = transaction.all<CommentRow>(
            "SELECT * FROM insights_feedback_comments WHERE batch_id = ?",
            selected.id,
          );
          const groups = new Map<string, CommentRow[]>();
          for (const item of comments) {
            const key = item.category || "其他反馈";
            groups.set(key, [...(groups.get(key) ?? []), item]);
          }
          transaction.run(
            "DELETE FROM insights_feedback_clusters WHERE batch_id = ?",
            selected.id,
          );
          const now = new Date().toISOString();
          for (const [title, values] of groups)
            transaction.run(
              "INSERT INTO insights_feedback_clusters VALUES (?, ?, ?, ?, ?, ?, ?)",
              crypto.randomUUID(),
              selected.project_id,
              selected.id,
              title,
              `共 ${values.length} 条评论。代表反馈：${values
                .slice(0, 3)
                .map((item) => item.content.slice(0, 80))
                .join("；")}`,
              values.length,
              now,
            );
          const values = transaction
            .all<ClusterRow>(
              "SELECT * FROM insights_feedback_clusters WHERE batch_id = ? ORDER BY comment_count DESC, id",
              selected.id,
            )
            .map(cluster);
          transaction.append({
            type: "insights.feedback-clustered.v1",
            pluginId: "insights",
            aggregateType: "feedback-batch",
            aggregateId: selected.id,
            aggregateVersion: 0,
            payload: { count: values.length },
          });
          return values;
        });
        return result
          ? requestContext.json(result, 201)
          : problem(requestContext, 404, "NOT_FOUND", "未找到评论反馈批次。");
      },
    ),
    route(
      {
        id: "insights:feedback-revision-task",
        pluginId: "insights",
        method: "post",
        path: "/api/v2/feedback/clusters/{id}/revision-task",
        operationId: "feedback.createRevisionTask",
      },
      declaration({
        method: "post",
        path: "/api/v2/feedback/clusters/{id}/revision-task",
        operationId: "feedback.createRevisionTask",
        params: idParams,
        response: TaskSchema,
        status: 201,
      }),
      (requestContext) => {
        const selected = context.uow.execute((transaction) =>
          transaction.get<ClusterRow>(
            "SELECT * FROM insights_feedback_clusters WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!selected)
          return problem(requestContext, 404, "NOT_FOUND", "未找到反馈主题。");
        return requestContext.json(
          tasks.complete({
            kind: "feedback.revision",
            title: `反馈修订建议：${selected.title}`,
            projectId: selected.project_id,
            result: {
              feedbackCluster: cluster(selected),
              nextSteps: [
                "复核关联内容。",
                "创建修订预览。",
                "人工确认后提交。",
              ],
            },
          }),
          201,
        );
      },
    ),
  ];
}

function generationRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
): RouteContribution[] {
  const idParams = z.object({ id: z.string().uuid() });
  return [
    route(
      {
        id: "insights:generation-list",
        pluginId: "insights",
        method: "get",
        path: "/api/v2/projects/{id}/generation-ledger",
        operationId: "generation.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{id}/generation-ledger",
        operationId: "generation.list",
        params: idParams,
        response: z.array(GenerationRecordSchema),
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<GenerationRow>(
                "SELECT * FROM insights_generation_records WHERE project_id = ? ORDER BY created_at DESC, id",
                projectId,
              )
              .map(generation),
          ),
        );
      },
    ),
    route(
      {
        id: "insights:generation-update",
        pluginId: "insights",
        method: "patch",
        path: "/api/v2/generation-ledger/{id}",
        operationId: "generation.update",
      },
      declaration({
        method: "patch",
        path: "/api/v2/generation-ledger/{id}",
        operationId: "generation.update",
        params: idParams,
        body: GenerationRecordPatchSchema,
        response: GenerationRecordSchema,
      }),
      async (requestContext) => {
        const input = GenerationRecordPatchSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "成本记录无效。",
          );
        const value = context.uow.execute((transaction) => {
          const current = transaction.get<GenerationRow>(
            "SELECT * FROM insights_generation_records WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!current) return undefined;
          transaction.run(
            `UPDATE insights_generation_records
             SET actual_cost = ?, currency = ?, cost_note = ?, updated_at = ?
             WHERE id = ?`,
            input.data.actualCost ?? current.actual_cost,
            input.data.currency ?? current.currency,
            input.data.costNote?.trim() || current.cost_note,
            new Date().toISOString(),
            current.id,
          );
          const updated = generation(
            transaction.get<GenerationRow>(
              "SELECT * FROM insights_generation_records WHERE id = ?",
              current.id,
            )!,
          );
          transaction.append({
            type: "insights.generation-updated.v1",
            pluginId: "insights",
            aggregateType: "generation-record",
            aggregateId: current.id,
            aggregateVersion: 1,
            payload: JSON.parse(JSON.stringify(updated)),
          });
          return updated;
        });
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到生成记录。");
      },
    ),
  ];
}

const migrations = [
  {
    id: "insights.0001.feedback-and-generation",
    pluginId: "insights",
    version: "3.0.0-alpha.3",
    dependsOn: ["review.0002.owned-records"],
    sql: `
      CREATE TABLE IF NOT EXISTS insights_feedback_previews (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('metrics','comments')), source_name TEXT NOT NULL, rows_json TEXT NOT NULL, warnings_json TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS insights_feedback_batches (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('metrics','comments')), source_name TEXT NOT NULL, row_count INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS insights_feedback_batches_project ON insights_feedback_batches(project_id, created_at DESC, id);
      CREATE TABLE IF NOT EXISTS insights_feedback_metrics (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES insights_feedback_batches(id) ON DELETE CASCADE, name TEXT NOT NULL, value REAL NOT NULL, occurred_at TEXT, dimensions_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS insights_feedback_comments (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES insights_feedback_batches(id) ON DELETE CASCADE, content TEXT NOT NULL, author TEXT, occurred_at TEXT, category TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS insights_feedback_clusters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, batch_id TEXT NOT NULL REFERENCES insights_feedback_batches(id) ON DELETE CASCADE, title TEXT NOT NULL, summary TEXT NOT NULL, comment_count INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS insights_feedback_clusters_project ON insights_feedback_clusters(project_id, created_at DESC, id);
      CREATE TABLE IF NOT EXISTS insights_generation_records (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, task_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL, actual_cost REAL, currency TEXT NOT NULL DEFAULT 'CNY', cost_note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS insights_generation_records_project ON insights_generation_records(project_id, created_at DESC, id);
    `,
  },
] as const;

export function createInsightsPlugin(host?: DesktopHostClient) {
  return defineFirstPartyPlugin({
    descriptor: {
      id: "insights",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: ["foundation", "workspace", "automation", "review"],
      provides: ["insights.feedback", "insights.generation-ledger"],
      stability: "internal",
    },
    ui: [
      {
        id: "insights.route.dashboard",
        pluginId: "insights",
        kind: "route",
        metadata: { path: "/insights", title: "数据洞察" },
      },
      {
        id: "insights.navigation.dashboard",
        pluginId: "insights",
        kind: "navigation",
        metadata: {
          section: "secondary",
          order: 10,
          label: "数据洞察",
          to: "/insights",
        },
      },
    ],
    migrations,
    activate: (context) => {
      const workspace = context.services.optional<WorkspaceProjectService>(
        WORKSPACE_PROJECT_SERVICE,
      );
      const tasks = context.services.optional<AutomationTaskService>(
        AUTOMATION_TASK_SERVICE,
      );
      if (!workspace || !tasks)
        throw new Error("insights requires workspace and automation services");
      const generationService = createGenerationService(context);
      context.effect(`service:${INSIGHTS_GENERATION_SERVICE}`, () =>
        context.services.provide(
          INSIGHTS_GENERATION_SERVICE,
          generationService,
        ),
      );
      for (const contribution of [
        ...feedbackRoutes(context, host, workspace, tasks),
        ...generationRoutes(context, workspace),
      ])
        context.effect(`route:${contribution.id}`, () =>
          context.http.register(contribution),
        );
    },
  });
}

export const insightsPlugin = createInsightsPlugin();
