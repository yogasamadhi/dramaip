import { optionalService } from "@dramaip/plugin-api/internal";
import { createRoute } from "@hono/zod-openapi";
import {
  AUTOMATION_RESOURCE_SERVICE,
  type AutomationResourceService,
} from "@dramaip/contracts/automation";
import {
  WORKSPACE_PROJECT_SERVICE,
  ProjectInputSchema,
  type ProjectInput,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  type PluginContext,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";
import { z } from "zod";

const CARD_KINDS = [
  "premise",
  "character",
  "world",
  "conflict",
  "scene",
  "style",
  "question",
] as const;
const MEMORY_KINDS = [
  "preference",
  "theme",
  "constraint",
  "avoid",
  "goal",
] as const;

type RouteContext = {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
};

type CardRow = {
  id: string;
  conversation_id: string;
  kind: (typeof CARD_KINDS)[number];
  title: string;
  content: string;
  source_turn_id: string | null;
  adopted: number;
  version: number;
  created_at: string;
  updated_at: string;
};
type MemoryRow = {
  id: string;
  kind: (typeof MEMORY_KINDS)[number];
  content: string;
  confidence: number;
  status: "active" | "disabled";
  version: number;
  created_at: string;
  updated_at: string;
};
type PreviewRow = {
  id: string;
  conversation_id: string;
  project_json: string;
  card_ids_json: string;
  status:
    "pending" | "project_created" | "cards_copied" | "completed" | "failed";
  project_id: string | null;
  copied_count: number;
  error: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

function contribution(
  id: string,
  method: "delete" | "get" | "patch" | "post" | "put",
  path: `/api/v2/${string}`,
  operationId: string,
  handler: (context: RouteContext) => Response | Promise<Response>,
): RouteContribution {
  return defineRouteContribution({
    id,
    pluginId: "agents",
    method,
    path,
    operationId,
    declaration: createRoute({
      method,
      path,
      operationId,
      tags: ["inspiration"],
      responses: {
        200: {
          description: "Success",
          content: { "application/json": { schema: z.unknown() } },
        },
        201: {
          description: "Created",
          content: { "application/json": { schema: z.unknown() } },
        },
        204: { description: "Removed" },
        400: { description: "Invalid request" },
        404: { description: "Not found" },
        409: { description: "Conflict" },
      },
    } as never),
    handler: handler as never,
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

function card(row: CardRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    ...(row.source_turn_id ? { sourceTurnId: row.source_turn_id } : {}),
    adopted: Boolean(row.adopted),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function memory(context: PluginContext, row: MemoryRow) {
  const sourceConversationIds = context.uow.execute((transaction) =>
    transaction
      .all<{ conversation_id: string }>(
        "SELECT conversation_id FROM agent_creative_memory_sources WHERE memory_id = ? ORDER BY conversation_id",
        row.id,
      )
      .map((source) => source.conversation_id),
  );
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    confidence: row.confidence,
    sourceConversationIds,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function preview(context: PluginContext, row: PreviewRow) {
  const ids = JSON.parse(row.card_ids_json) as string[];
  const cards = context.uow.execute((transaction) =>
    ids
      .map((id) =>
        transaction.get<CardRow>(
          "SELECT * FROM agent_inspiration_cards WHERE id = ? AND conversation_id = ?",
          id,
          row.conversation_id,
        ),
      )
      .filter((value): value is CardRow => Boolean(value))
      .map(card),
  );
  return {
    id: row.id,
    conversationId: row.conversation_id,
    project: JSON.parse(row.project_json),
    cards,
    status: row.status,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inspirationSession(
  context: PluginContext,
  id: string,
): { id: string } | undefined {
  return context.uow.execute((transaction) =>
    transaction.get<{ id: string }>(
      "SELECT id FROM agent_assistant_sessions WHERE id = ? AND surface = 'inspiration'",
      id,
    ),
  );
}

export function queueInspirationMemoryJob(
  context: PluginContext,
  conversationId: string,
  force = false,
  reason: "six_turns" | "archive" | "manual" = force ? "manual" : "six_turns",
): void {
  const turnCount = context.uow.execute(
    (transaction) =>
      transaction.get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM agent_assistant_turns WHERE session_id = ? AND status = 'succeeded'",
        conversationId,
      )?.count ?? 0,
  );
  if (!force && (turnCount === 0 || turnCount % 6 !== 0)) return;
  if (
    reason === "six_turns" &&
    context.uow.execute((transaction) =>
      transaction.get<{ id: string }>(
        `SELECT id FROM agent_inspiration_memory_jobs
         WHERE conversation_id = ? AND through_turn_count = ? AND reason = 'six_turns'`,
        conversationId,
        turnCount,
      ),
    )
  )
    return;
  const now = new Date().toISOString();
  context.uow.execute((transaction) =>
    transaction.run(
      `INSERT INTO agent_inspiration_memory_jobs(
        id, conversation_id, through_turn_count, status, reason, error,
        input_tokens, output_tokens, created_at, updated_at
      ) VALUES (?, ?, ?, 'pending', ?, NULL, 0, 0, ?, ?)`,
      crypto.randomUUID(),
      conversationId,
      turnCount,
      reason,
      now,
      now,
    ),
  );
}

export function inspirationRoutes(
  context: PluginContext,
): readonly RouteContribution[] {
  const routes: RouteContribution[] = [];
  routes.push(
    contribution(
      "agents:inspiration-cards-list",
      "get",
      "/api/v2/inspiration-cards",
      "inspiration-cards.list",
      (requestContext) => {
        const conversationId = requestContext.req.query("conversationId");
        if (!conversationId || !inspirationSession(context, conversationId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "必须指定有效的灵感对话。",
          );
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<CardRow>(
                "SELECT * FROM agent_inspiration_cards WHERE conversation_id = ? ORDER BY updated_at DESC, id",
                conversationId,
              )
              .map(card),
          ),
        );
      },
    ),
    contribution(
      "agents:inspiration-cards-create",
      "post",
      "/api/v2/inspiration-cards",
      "inspiration-cards.create",
      async (requestContext) => {
        const schema = z.object({
          conversationId: z.string().uuid(),
          kind: z.enum(CARD_KINDS),
          title: z.string().trim().min(1).max(160),
          content: z.string().trim().min(1).max(100_000),
          sourceTurnId: z.string().uuid().optional(),
        });
        const input = schema.safeParse(await requestContext.req.json());
        if (
          !input.success ||
          !inspirationSession(context, input.data.conversationId)
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "灵感卡片内容无效。",
          );
        const value = context.uow.execute((transaction) => {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          transaction.run(
            `INSERT INTO agent_inspiration_cards(
              id, conversation_id, kind, title, content, source_turn_id,
              adopted, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
            id,
            input.data.conversationId,
            input.data.kind,
            input.data.title,
            input.data.content,
            input.data.sourceTurnId ?? null,
            now,
            now,
          );
          transaction.append({
            type: "agents.inspiration-card-created.v1",
            pluginId: "agents",
            aggregateType: "inspiration-card",
            aggregateId: id,
            aggregateVersion: 0,
            payload: { conversationId: input.data.conversationId },
          });
          return card(
            transaction.get<CardRow>(
              "SELECT * FROM agent_inspiration_cards WHERE id = ?",
              id,
            )!,
          );
        });
        requestContext.header("ETag", `"${value.version}"`);
        return requestContext.json(value, 201);
      },
    ),
    contribution(
      "agents:inspiration-cards-update",
      "patch",
      "/api/v2/inspiration-cards/{id}",
      "inspiration-cards.update",
      async (requestContext) => {
        const schema = z.object({
          kind: z.enum(CARD_KINDS).optional(),
          title: z.string().trim().min(1).max(160).optional(),
          content: z.string().trim().min(1).max(100_000).optional(),
          adopted: z.boolean().optional(),
          version: z.number().int().nonnegative(),
        });
        const input = schema.safeParse(await requestContext.req.json());
        const id = requestContext.req.param("id");
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "灵感卡片修改内容无效。",
          );
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<CardRow>(
            "SELECT * FROM agent_inspiration_cards WHERE id = ?",
            id,
          );
          if (!current) return "missing" as const;
          if (current.version !== input.data.version)
            return "conflict" as const;
          const now = new Date().toISOString();
          transaction.run(
            `UPDATE agent_inspiration_cards SET kind = ?, title = ?, content = ?,
             adopted = ?, version = version + 1, updated_at = ? WHERE id = ?`,
            input.data.kind ?? current.kind,
            input.data.title ?? current.title,
            input.data.content ?? current.content,
            input.data.adopted === undefined
              ? current.adopted
              : Number(input.data.adopted),
            now,
            id,
          );
          return card(
            transaction.get<CardRow>(
              "SELECT * FROM agent_inspiration_cards WHERE id = ?",
              id,
            )!,
          );
        });
        if (result === "missing")
          return problem(requestContext, 404, "NOT_FOUND", "未找到灵感卡片。");
        if (result === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "灵感卡片已更新，请刷新后重试。",
          );
        requestContext.header("ETag", `"${result.version}"`);
        return requestContext.json(result);
      },
    ),
    contribution(
      "agents:inspiration-cards-delete",
      "delete",
      "/api/v2/inspiration-cards/{id}",
      "inspiration-cards.remove",
      (requestContext) => {
        const removed = context.uow.execute((transaction) => {
          const id = requestContext.req.param("id");
          const exists = transaction.get<{ id: string }>(
            "SELECT id FROM agent_inspiration_cards WHERE id = ?",
            id,
          );
          if (exists)
            transaction.run(
              "DELETE FROM agent_inspiration_cards WHERE id = ?",
              id,
            );
          return Boolean(exists);
        });
        return removed
          ? requestContext.body(null, 204)
          : problem(requestContext, 404, "NOT_FOUND", "未找到灵感卡片。");
      },
    ),
  );

  routes.push(
    contribution(
      "agents:creative-memory-settings-get",
      "get",
      "/api/v2/inspiration-memory-settings",
      "inspiration-memory-settings.get",
      (requestContext) => {
        const value = context.uow.execute((transaction) =>
          transaction.get<{
            enabled: number;
            consented_at: string | null;
            updated_at: string;
          }>(
            "SELECT * FROM agent_creative_memory_settings WHERE singleton = 1",
          ),
        )!;
        return requestContext.json({
          enabled: Boolean(value.enabled),
          ...(value.consented_at ? { consentedAt: value.consented_at } : {}),
          updatedAt: value.updated_at,
        });
      },
    ),
    contribution(
      "agents:creative-memory-settings-update",
      "put",
      "/api/v2/inspiration-memory-settings",
      "inspiration-memory-settings.update",
      async (requestContext) => {
        const input = z
          .object({ enabled: z.boolean() })
          .safeParse(await requestContext.req.json());
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "记忆设置无效。",
          );
        const now = new Date().toISOString();
        context.uow.execute((transaction) =>
          transaction.run(
            `UPDATE agent_creative_memory_settings SET enabled = ?,
             consented_at = COALESCE(consented_at, ?),
             updated_at = ? WHERE singleton = 1`,
            Number(input.data.enabled),
            now,
            now,
          ),
        );
        const value = context.uow.execute((transaction) =>
          transaction.get<{
            enabled: number;
            consented_at: string | null;
            updated_at: string;
          }>(
            "SELECT * FROM agent_creative_memory_settings WHERE singleton = 1",
          ),
        )!;
        return requestContext.json({
          enabled: Boolean(value.enabled),
          ...(value.consented_at ? { consentedAt: value.consented_at } : {}),
          updatedAt: value.updated_at,
        });
      },
    ),
    contribution(
      "agents:creative-memories-list",
      "get",
      "/api/v2/inspiration-memories",
      "inspiration-memories.list",
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<MemoryRow>(
                "SELECT * FROM agent_creative_memories ORDER BY updated_at DESC, id",
              )
              .map((row) => memory(context, row)),
          ),
        ),
    ),
    contribution(
      "agents:inspiration-memory-jobs-list",
      "get",
      "/api/v2/inspiration-memory-jobs",
      "inspiration-memory-jobs.list",
      (requestContext) => {
        const conversationId = requestContext.req.query("conversationId");
        if (!conversationId || !inspirationSession(context, conversationId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "必须指定有效的灵感对话。",
          );
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<{
                id: string;
                conversation_id: string;
                through_turn_count: number;
                status: string;
                reason: string;
                error: string | null;
                model: string | null;
                input_tokens: number;
                output_tokens: number;
                context_snapshot_id: string | null;
                context_manifest_sha256: string | null;
                created_at: string;
                updated_at: string;
              }>(
                `SELECT job.*,
                        snapshot.manifest_sha256 AS context_manifest_sha256
                 FROM agent_inspiration_memory_jobs job
                 LEFT JOIN agent_context_snapshots snapshot
                   ON snapshot.id = job.context_snapshot_id
                 WHERE job.conversation_id = ?
                 ORDER BY job.created_at DESC, job.id DESC LIMIT 50`,
                conversationId,
              )
              .map((job) => ({
                id: job.id,
                conversationId: job.conversation_id,
                throughTurnCount: job.through_turn_count,
                status: job.status,
                reason: job.reason,
                ...(job.error ? { error: job.error } : {}),
                ...(job.model ? { model: job.model } : {}),
                ...(job.context_snapshot_id
                  ? { contextSnapshotId: job.context_snapshot_id }
                  : {}),
                ...(job.context_manifest_sha256
                  ? { contextManifestSha256: job.context_manifest_sha256 }
                  : {}),
                inputTokens: job.input_tokens,
                outputTokens: job.output_tokens,
                createdAt: job.created_at,
                updatedAt: job.updated_at,
              })),
          ),
        );
      },
    ),
    contribution(
      "agents:creative-memories-update",
      "patch",
      "/api/v2/inspiration-memories/{id}",
      "inspiration-memories.update",
      async (requestContext) => {
        const input = z
          .object({
            kind: z.enum(MEMORY_KINDS).optional(),
            content: z.string().trim().min(1).max(2_000).optional(),
            status: z.enum(["active", "disabled"]).optional(),
            version: z.number().int().nonnegative(),
          })
          .safeParse(await requestContext.req.json());
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "记忆修改内容无效。",
          );
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<MemoryRow>(
            "SELECT * FROM agent_creative_memories WHERE id = ?",
            id,
          );
          if (!current) return "missing" as const;
          if (current.version !== input.data.version)
            return "conflict" as const;
          transaction.run(
            `UPDATE agent_creative_memories SET kind = ?, content = ?, status = ?,
             version = version + 1, updated_at = ? WHERE id = ?`,
            input.data.kind ?? current.kind,
            input.data.content ?? current.content,
            input.data.status ?? current.status,
            new Date().toISOString(),
            id,
          );
          return transaction.get<MemoryRow>(
            "SELECT * FROM agent_creative_memories WHERE id = ?",
            id,
          )!;
        });
        if (result === "missing")
          return problem(requestContext, 404, "NOT_FOUND", "未找到创意记忆。");
        if (result === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "创意记忆已更新，请刷新后重试。",
          );
        return requestContext.json(memory(context, result));
      },
    ),
    contribution(
      "agents:creative-memories-delete",
      "delete",
      "/api/v2/inspiration-memories/{id}",
      "inspiration-memories.remove",
      (requestContext) => {
        const removed = context.uow.execute((transaction) => {
          const id = requestContext.req.param("id");
          const exists = transaction.get<{ id: string }>(
            "SELECT id FROM agent_creative_memories WHERE id = ?",
            id,
          );
          if (exists)
            transaction.run(
              "DELETE FROM agent_creative_memories WHERE id = ?",
              id,
            );
          return Boolean(exists);
        });
        return removed
          ? requestContext.body(null, 204)
          : problem(requestContext, 404, "NOT_FOUND", "未找到创意记忆。");
      },
    ),
    contribution(
      "agents:creative-memories-clear",
      "post",
      "/api/v2/inspiration-memories/clear",
      "inspiration-memories.clear",
      (requestContext) => {
        context.uow.execute((transaction) =>
          transaction.run("DELETE FROM agent_creative_memories"),
        );
        return requestContext.body(null, 204);
      },
    ),
    contribution(
      "agents:creative-memories-rebuild",
      "post",
      "/api/v2/inspiration-memories/rebuild",
      "inspiration-memories.rebuild",
      async (requestContext) => {
        const input = z
          .object({ conversationId: z.string().uuid() })
          .safeParse(await requestContext.req.json());
        if (
          !input.success ||
          !inspirationSession(context, input.data.conversationId)
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "灵感对话无效。",
          );
        queueInspirationMemoryJob(
          context,
          input.data.conversationId,
          true,
          "manual",
        );
        return requestContext.json({ queued: true });
      },
    ),
  );

  routes.push(
    contribution(
      "agents:inspiration-project-previews-create",
      "post",
      "/api/v2/inspiration-project-previews",
      "inspiration-project-previews.create",
      async (requestContext) => {
        const input = z
          .object({
            conversationId: z.string().uuid(),
            project: ProjectInputSchema,
            cardIds: z.array(z.string().uuid()),
          })
          .safeParse(await requestContext.req.json());
        if (
          !input.success ||
          !inspirationSession(context, input.data.conversationId)
        )
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "项目转换预览内容无效。",
          );
        const cards = context.uow.execute((transaction) =>
          input.data.cardIds.map((id) =>
            transaction.get<CardRow>(
              "SELECT * FROM agent_inspiration_cards WHERE id = ? AND conversation_id = ?",
              id,
              input.data.conversationId,
            ),
          ),
        );
        if (cards.some((value) => !value))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "所选灵感卡片不属于当前对话。",
          );
        const row = context.uow.execute((transaction) => {
          const id = crypto.randomUUID();
          const now = new Date().toISOString();
          const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
          transaction.run(
            `INSERT INTO agent_inspiration_project_previews(
              id, conversation_id, project_json, card_ids_json, status,
              project_id, copied_count, error, expires_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'pending', NULL, 0, NULL, ?, ?, ?)`,
            id,
            input.data.conversationId,
            JSON.stringify(input.data.project),
            JSON.stringify(input.data.cardIds),
            expiresAt,
            now,
            now,
          );
          return transaction.get<PreviewRow>(
            "SELECT * FROM agent_inspiration_project_previews WHERE id = ?",
            id,
          )!;
        });
        return requestContext.json(preview(context, row), 201);
      },
    ),
    contribution(
      "agents:inspiration-project-previews-get",
      "get",
      "/api/v2/inspiration-project-previews/{id}",
      "inspiration-project-previews.get",
      (requestContext) => {
        const row = context.uow.execute((transaction) =>
          transaction.get<PreviewRow>(
            "SELECT * FROM agent_inspiration_project_previews WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        return row
          ? requestContext.json(preview(context, row))
          : problem(requestContext, 404, "NOT_FOUND", "未找到项目转换预览。");
      },
    ),
    contribution(
      "agents:inspiration-project-previews-commit",
      "post",
      "/api/v2/inspiration-project-previews/{id}/commit",
      "inspiration-project-previews.commit",
      (requestContext) => {
        const row = context.uow.execute((transaction) =>
          transaction.get<PreviewRow>(
            "SELECT * FROM agent_inspiration_project_previews WHERE id = ?",
            requestContext.req.param("id"),
          ),
        );
        if (!row)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到项目转换预览。",
          );
        if (
          Date.parse(row.expires_at) <= Date.now() &&
          row.status === "pending"
        )
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "项目转换预览已过期。",
          );
        const workspace = optionalService<WorkspaceProjectService>(
          context,
          WORKSPACE_PROJECT_SERVICE,
        );
        const resources = optionalService<AutomationResourceService>(
          context,
          AUTOMATION_RESOURCE_SERVICE,
        );
        if (!workspace || !resources)
          return problem(
            requestContext,
            409,
            "CAPABILITY_UNAVAILABLE",
            "项目或灵感资料服务不可用。",
          );
        try {
          const projectInput = ProjectInputSchema.parse(
            JSON.parse(row.project_json),
          ) as ProjectInput;
          const project = row.project_id
            ? workspace.get(row.project_id)
            : workspace.createIdempotent(
                projectInput,
                `inspiration-project:${row.id}`,
              );
          if (!project)
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "已创建的项目当前不可用。",
            );
          context.uow.execute((transaction) =>
            transaction.run(
              "UPDATE agent_inspiration_project_previews SET project_id = ?, status = 'project_created', error = NULL, updated_at = ? WHERE id = ?",
              project.id,
              new Date().toISOString(),
              row.id,
            ),
          );
          const ids = JSON.parse(row.card_ids_json) as string[];
          let copied = 0;
          for (const id of ids) {
            const selected = context.uow.execute((transaction) =>
              transaction.get<CardRow>(
                "SELECT * FROM agent_inspiration_cards WHERE id = ? AND conversation_id = ?",
                id,
                row.conversation_id,
              ),
            );
            if (!selected) continue;
            resources.createInspiration({
              projectId: project.id,
              title: selected.title,
              sourceRef: `inspiration-card:${selected.id}`,
              payload: {
                类型: selected.kind,
                内容: selected.content,
                来源对话: row.conversation_id,
                来源卡片: selected.id,
              },
            });
            copied += 1;
          }
          context.uow.execute((transaction) =>
            transaction.run(
              "UPDATE agent_inspiration_project_previews SET status = 'cards_copied', copied_count = ?, updated_at = ? WHERE id = ?",
              copied,
              new Date().toISOString(),
              row.id,
            ),
          );
          const completed = context.uow.execute((transaction) => {
            const now = new Date().toISOString();
            transaction.run(
              "UPDATE agent_inspiration_project_previews SET status = 'completed', copied_count = ?, error = NULL, updated_at = ? WHERE id = ?",
              copied,
              now,
              row.id,
            );
            transaction.run(
              "UPDATE agent_inspiration_cards SET adopted = 1, version = version + 1, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))",
              now,
              row.card_ids_json,
            );
            return transaction.get<PreviewRow>(
              "SELECT * FROM agent_inspiration_project_previews WHERE id = ?",
              row.id,
            )!;
          });
          return requestContext.json({
            preview: preview(context, completed),
            project,
            cardsCopied: copied,
          });
        } catch {
          context.uow.execute((transaction) =>
            transaction.run(
              "UPDATE agent_inspiration_project_previews SET status = 'failed', error = '项目转换未完成，可安全重试。', updated_at = ? WHERE id = ?",
              new Date().toISOString(),
              row.id,
            ),
          );
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "项目转换未完成，可安全重试。",
          );
        }
      },
    ),
  );
  return routes;
}
