import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { createRoute } from "@hono/zod-openapi";
import {
  registerKnowledgeCreation,
  knowledgeCreationMigration,
} from "./creation.js";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  KNOWLEDGE_RESEARCH_SERVICE,
  KNOWLEDGE_WEB_RESEARCH_SERVICE,
  StoryBibleChangeSetApplyInputSchema,
  StoryBibleChangeSetInputSchema,
  StoryBibleChangeSetSchema,
  StoryBibleSettingsSchema,
  StoryBibleStaleMarkSchema,
  type StoryBibleChangeSet,
} from "@dramaip/contracts/knowledge";
import type { DesktopHostClient } from "@dramaip/desktop-host";
import {
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  type Chapter,
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
import {
  DuckDuckGoSearchAdapter,
  researchMigrations,
  researchRoutes,
  researchService,
} from "./research.js";
import {
  CREATIVE_KNOWLEDGE_SERVICE,
  creativeIntelligenceMigrations,
  creativeIntelligenceRoutes,
  creativeIntelligenceService,
} from "./creative-intelligence.js";
import { WebResearchAdapter } from "./web-research.js";

interface ChangeSetRow {
  id: string;
  project_id: string;
  chapter_id: string;
  source_version: number;
  source_fingerprint: string;
  status: StoryBibleChangeSet["status"];
  summary: string;
  task_id: string | null;
  conflict_notes_json: string;
  preview_json: string;
  created_memory_ids_json: string;
  applied_at: string | null;
  undone_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StaleRow {
  id: string;
  project_id: string;
  chapter_id: string;
  reason: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

interface KnowledgeRecordRow {
  id: string;
  kind: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  payload_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

type Handler = (context: RouteContext) => Response | Promise<Response>;

function declaration(input: {
  method: "delete" | "get" | "patch" | "post" | "put";
  path: string;
  operationId: string;
  body?: ZodType;
  params?: ZodType;
  response?: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["story-bible"],
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
        ...(input.response
          ? { content: { "application/json": { schema: input.response } } }
          : {}),
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

function fingerprint(content: string): string {
  let value = 2_166_136_261;
  for (const character of content)
    value = Math.imul(value ^ character.charCodeAt(0), 16_777_619);
  return `fnv1a:${(value >>> 0).toString(16).padStart(8, "0")}:${content.length}`;
}

function preview(chapter: Chapter) {
  const excerpt = chapter.content.trim().replace(/\s+/gu, " ").slice(0, 300);
  const summary = chapter.summary || `${chapter.title}：${excerpt}`;
  const fields = [
    ["章节摘要", summary],
    ["重要事件", chapter.mainConflict || "待人工补充"],
    ["人物变化与秘密", chapter.highlight || "待人工补充"],
    ["新增或回收伏笔", chapter.cliffhanger || "待人工补充"],
  ].map(([key, value]) => ({ key: key!, value: value! }));
  return { title: `《${chapter.title}》章节记忆`, fields };
}

function changeSet(row: ChangeSetRow): StoryBibleChangeSet {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    sourceVersion: row.source_version,
    status: row.status,
    summary: row.summary,
    ...(row.task_id ? { taskId: row.task_id } : {}),
    conflictNotes: JSON.parse(row.conflict_notes_json),
    preview: JSON.parse(row.preview_json),
    ...(row.applied_at ? { appliedAt: row.applied_at } : {}),
    ...(row.undone_at ? { undoneAt: row.undone_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function stale(row: StaleRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    chapterId: row.chapter_id,
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function emit(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: { id: string; status?: string },
): void {
  transaction.append({
    type: `knowledge.story-bible-${action}.v1`,
    pluginId: "knowledge",
    aggregateType: "story-bible-change-set",
    aggregateId: value.id,
    aggregateVersion: 0,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function routes(context: PluginContext): readonly RouteContribution[] {
  const workspace = optionalService<WorkspaceProjectService>(
    context,
    WORKSPACE_PROJECT_SERVICE,
  );
  const writing = optionalService<WritingChapterService>(
    context,
    WRITING_CHAPTER_SERVICE,
  );
  if (!workspace || !writing)
    throw new Error("knowledge requires workspace and writing services");
  const projectParams = z.object({ id: z.string().uuid() });
  const idParams = z.object({ id: z.string().uuid() });
  const now = () => new Date().toISOString();
  const find = (id: string) =>
    context.uow.execute((transaction) =>
      transaction.get<ChangeSetRow>(
        "SELECT * FROM knowledge_story_bible_change_sets WHERE id = ?",
        id,
      ),
    );
  const settingsInput = z.object({ autoSuggest: z.boolean() });
  const statusInput = z.object({
    status: z.enum(["queued", "paused", "skipped", "discarded"]),
  });

  const resourceSchema = z.object({
    id: z.string().uuid(),
    domain: z.string(),
    projectId: z.string().uuid().optional(),
    parentId: z.string().uuid().optional(),
    title: z.string(),
    payload: z.unknown(),
    version: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  const resourceInputSchema = z.object({
    projectId: z.string().uuid(),
    parentId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    payload: z.record(z.string(), z.unknown()).optional(),
  });
  const resourcePatchSchema = resourceInputSchema
    .omit({ projectId: true, parentId: true })
    .partial()
    .extend({ version: z.number().int().nonnegative() });
  const resourceDomains = [
    "story",
    "character-states",
    "story-bible",
    "story-events",
    "foreshadowings",
    "memory",
    "visual-profiles",
    "visual-settings",
    "chapter-memories",
    "story-bible-sidecar-preferences",
  ] as const;

  type ResourceDomain = (typeof resourceDomains)[number];
  const resource = (row: KnowledgeRecordRow) => ({
    id: row.id,
    domain: row.kind,
    projectId: row.project_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    title: row.title,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  const listResources = (domain: ResourceDomain, projectId: string) =>
    context.uow.execute((transaction) => {
      const records = transaction
        .all<KnowledgeRecordRow>(
          `SELECT * FROM knowledge_records
           WHERE kind = ? AND project_id = ? ORDER BY updated_at DESC, id`,
          domain,
          projectId,
        )
        .map(resource);
      if (domain !== "chapter-memories") return records;
      const generated = transaction
        .all<{
          id: string;
          project_id: string;
          chapter_id: string;
          title: string;
          payload_json: string;
          version: number;
          created_at: string;
          updated_at: string;
        }>(
          "SELECT * FROM knowledge_chapter_memories WHERE project_id = ? ORDER BY updated_at DESC, id",
          projectId,
        )
        .map((row) => ({
          id: row.id,
          domain,
          projectId: row.project_id,
          parentId: row.chapter_id,
          title: row.title,
          payload: JSON.parse(row.payload_json) as Record<string, unknown>,
          version: row.version,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
      return [...records, ...generated].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    });
  const findResource = (domain: ResourceDomain, id: string) =>
    context.uow.execute((transaction) => {
      const row = transaction.get<KnowledgeRecordRow>(
        "SELECT * FROM knowledge_records WHERE id = ? AND kind = ?",
        id,
        domain,
      );
      if (row) return resource(row);
      if (domain !== "chapter-memories") return undefined;
      const memory = transaction.get<{
        id: string;
        project_id: string;
        chapter_id: string;
        title: string;
        payload_json: string;
        version: number;
        created_at: string;
        updated_at: string;
      }>("SELECT * FROM knowledge_chapter_memories WHERE id = ?", id);
      return memory
        ? {
            id: memory.id,
            domain,
            projectId: memory.project_id,
            parentId: memory.chapter_id,
            title: memory.title,
            payload: JSON.parse(memory.payload_json) as Record<string, unknown>,
            version: memory.version,
            createdAt: memory.created_at,
            updatedAt: memory.updated_at,
          }
        : undefined;
    });

  const resourceRoutes = resourceDomains.flatMap((domain) => {
    const path = `/api/v2/${domain}` as `/api/v2/${string}`;
    const itemPath = `${path}/{id}` as `/api/v2/${string}`;
    const operationPrefix =
      domain === "story-bible" ? "story-bible.records" : domain;
    return [
      contribute(
        {
          id: `knowledge:${domain}-list`,
          pluginId: "knowledge",
          method: "get",
          path,
          operationId: `${operationPrefix}.list`,
        },
        declaration({
          method: "get",
          path,
          operationId: `${operationPrefix}.list`,
          response: z.array(resourceSchema),
        }),
        (requestContext) => {
          const projectId = requestContext.req.query("projectId");
          if (!projectId || !workspace.get(projectId))
            return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
          return requestContext.json(listResources(domain, projectId));
        },
      ),
      contribute(
        {
          id: `knowledge:${domain}-create`,
          pluginId: "knowledge",
          method: "post",
          path,
          operationId: `${operationPrefix}.create`,
        },
        declaration({
          method: "post",
          path,
          operationId: `${operationPrefix}.create`,
          body: resourceInputSchema,
          response: resourceSchema,
          status: 201,
        }),
        async (requestContext) => {
          const input = resourceInputSchema.safeParse(
            await requestContext.req.json(),
          );
          if (!input.success || !workspace.get(input.data.projectId))
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "知识资料内容无效。",
            );
          const value = context.uow.execute((transaction) => {
            const id = crypto.randomUUID();
            const at = now();
            transaction.run(
              `INSERT INTO knowledge_records(
                id, kind, project_id, parent_id, title, payload_json,
                version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
              id,
              domain,
              input.data.projectId,
              input.data.parentId ?? null,
              input.data.title,
              JSON.stringify(input.data.payload ?? {}),
              at,
              at,
            );
            const created = resource(
              transaction.get<KnowledgeRecordRow>(
                "SELECT * FROM knowledge_records WHERE id = ?",
                id,
              )!,
            );
            transaction.append({
              type: `knowledge.${domain}-created.v1`,
              pluginId: "knowledge",
              aggregateType: domain,
              aggregateId: id,
              aggregateVersion: 0,
              payload: JSON.parse(JSON.stringify(created)),
            });
            return created;
          });
          requestContext.header("ETag", `"${value.version}"`);
          return requestContext.json(value, 201);
        },
      ),
      contribute(
        {
          id: `knowledge:${domain}-get`,
          pluginId: "knowledge",
          method: "get",
          path: itemPath,
          operationId: `${operationPrefix}.get`,
        },
        declaration({
          method: "get",
          path: itemPath,
          operationId: `${operationPrefix}.get`,
          params: idParams,
          response: resourceSchema,
        }),
        (requestContext) => {
          const value = findResource(domain, requestContext.req.param("id"));
          if (!value)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到知识资料。",
            );
          requestContext.header("ETag", `"${value.version}"`);
          return requestContext.json(value);
        },
      ),
      contribute(
        {
          id: `knowledge:${domain}-update`,
          pluginId: "knowledge",
          method: "patch",
          path: itemPath,
          operationId: `${operationPrefix}.update`,
        },
        declaration({
          method: "patch",
          path: itemPath,
          operationId: `${operationPrefix}.update`,
          params: idParams,
          body: resourcePatchSchema,
          response: resourceSchema,
        }),
        async (requestContext) => {
          const input = resourcePatchSchema.safeParse(
            await requestContext.req.json(),
          );
          if (!input.success)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "知识资料修改内容无效。",
            );
          const id = requestContext.req.param("id");
          const result = context.uow.execute((transaction) => {
            const current = transaction.get<KnowledgeRecordRow>(
              "SELECT * FROM knowledge_records WHERE id = ? AND kind = ?",
              id,
              domain,
            );
            if (!current) return { state: "missing" as const };
            if (current.version !== input.data.version)
              return { state: "conflict" as const };
            transaction.run(
              `UPDATE knowledge_records SET title = ?, payload_json = ?,
                 version = version + 1, updated_at = ?
               WHERE id = ? AND version = ?`,
              input.data.title ?? current.title,
              JSON.stringify(
                input.data.payload ?? JSON.parse(current.payload_json),
              ),
              now(),
              id,
              current.version,
            );
            const updated = resource(
              transaction.get<KnowledgeRecordRow>(
                "SELECT * FROM knowledge_records WHERE id = ?",
                id,
              )!,
            );
            transaction.append({
              type: `knowledge.${domain}-updated.v1`,
              pluginId: "knowledge",
              aggregateType: domain,
              aggregateId: id,
              aggregateVersion: updated.version,
              payload: JSON.parse(JSON.stringify(updated)),
            });
            return { state: "updated" as const, value: updated };
          });
          if (result.state === "missing")
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到可编辑的知识资料。",
            );
          if (result.state === "conflict")
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "知识资料已更新，请刷新后重试。",
            );
          requestContext.header("ETag", `"${result.value.version}"`);
          return requestContext.json(result.value);
        },
      ),
      contribute(
        {
          id: `knowledge:${domain}-remove`,
          pluginId: "knowledge",
          method: "delete",
          path: itemPath,
          operationId: `${operationPrefix}.remove`,
        },
        declaration({
          method: "delete",
          path: itemPath,
          operationId: `${operationPrefix}.remove`,
          params: idParams,
          status: 204,
        }),
        (requestContext) => {
          const id = requestContext.req.param("id");
          const removed = context.uow.execute((transaction) => {
            const current = transaction.get<KnowledgeRecordRow>(
              "SELECT * FROM knowledge_records WHERE id = ? AND kind = ?",
              id,
              domain,
            );
            if (!current) return false;
            transaction.run("DELETE FROM knowledge_records WHERE id = ?", id);
            transaction.append({
              type: `knowledge.${domain}-removed.v1`,
              pluginId: "knowledge",
              aggregateType: domain,
              aggregateId: id,
              aggregateVersion: current.version,
              payload: { id, projectId: current.project_id },
            });
            return true;
          });
          return removed
            ? requestContext.body(null, 204)
            : problem(
                requestContext,
                404,
                "NOT_FOUND",
                "未找到可删除的知识资料。",
              );
        },
      ),
    ];
  });

  return [
    ...resourceRoutes,
    contribute(
      {
        id: "knowledge:story-bible-settings-get",
        pluginId: "knowledge",
        method: "get",
        path: "/api/v2/projects/{id}/story-bible/settings",
        operationId: "story-bible.settings",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{id}/story-bible/settings",
        operationId: "story-bible.settings",
        params: projectParams,
        response: StoryBibleSettingsSchema,
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const value = context.uow.execute((transaction) =>
          transaction.get<{ auto_suggest: number; updated_at: string }>(
            "SELECT auto_suggest, updated_at FROM knowledge_story_bible_settings WHERE project_id = ?",
            projectId,
          ),
        );
        return requestContext.json({
          projectId,
          autoSuggest: value?.auto_suggest === 1,
          updatedAt: value?.updated_at ?? now(),
        });
      },
    ),
    contribute(
      {
        id: "knowledge:story-bible-settings-update",
        pluginId: "knowledge",
        method: "put",
        path: "/api/v2/projects/{id}/story-bible/settings",
        operationId: "story-bible.updateSettings",
      },
      declaration({
        method: "put",
        path: "/api/v2/projects/{id}/story-bible/settings",
        operationId: "story-bible.updateSettings",
        params: projectParams,
        body: settingsInput,
        response: StoryBibleSettingsSchema,
      }),
      async (requestContext) => {
        const projectId = requestContext.req.param("id");
        const input = settingsInput.safeParse(await requestContext.req.json());
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "自动建议设置无效。",
          );
        const value = context.uow.execute((transaction) => {
          const at = now();
          transaction.run(
            `INSERT INTO knowledge_story_bible_settings(project_id, auto_suggest, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(project_id) DO UPDATE SET
               auto_suggest = excluded.auto_suggest,
               updated_at = excluded.updated_at`,
            projectId,
            input.data.autoSuggest ? 1 : 0,
            at,
          );
          const result = {
            projectId,
            autoSuggest: input.data.autoSuggest,
            updatedAt: at,
          };
          transaction.append({
            type: "knowledge.story-bible-settings-updated.v1",
            pluginId: "knowledge",
            aggregateType: "story-bible-settings",
            aggregateId: projectId,
            aggregateVersion: 0,
            payload: result,
          });
          return result;
        });
        return requestContext.json(value);
      },
    ),
    ...(
      [
        ["change-sets", "story-bible.list", StoryBibleChangeSetSchema],
        ["stale", "story-bible.stale", StoryBibleStaleMarkSchema],
      ] as const
    ).map(([suffix, operationId, schema]): RouteContribution =>
      contribute(
        {
          id: `knowledge:story-bible-${suffix}-list`,
          pluginId: "knowledge",
          method: "get",
          path: `/api/v2/projects/{id}/story-bible/${suffix}`,
          operationId,
        },
        declaration({
          method: "get",
          path: `/api/v2/projects/{id}/story-bible/${suffix}`,
          operationId,
          params: projectParams,
          response: z.array(schema),
        }),
        (requestContext) => {
          const projectId = requestContext.req.param("id");
          if (!workspace.get(projectId))
            return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
          return requestContext.json(
            context.uow.execute((transaction) =>
              suffix === "change-sets"
                ? transaction
                    .all<ChangeSetRow>(
                      "SELECT * FROM knowledge_story_bible_change_sets WHERE project_id = ? ORDER BY updated_at DESC",
                      projectId,
                    )
                    .map(changeSet)
                : transaction
                    .all<StaleRow>(
                      "SELECT * FROM knowledge_story_bible_stale_marks WHERE project_id = ? AND resolved_at IS NULL ORDER BY updated_at DESC",
                      projectId,
                    )
                    .map(stale),
            ),
          );
        },
      ),
    ),
    contribute(
      {
        id: "knowledge:story-bible-queue",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/story-bible/change-sets",
        operationId: "story-bible.queue",
      },
      declaration({
        method: "post",
        path: "/api/v2/story-bible/change-sets",
        operationId: "story-bible.queue",
        body: StoryBibleChangeSetInputSchema,
        response: StoryBibleChangeSetSchema,
        status: 201,
      }),
      async (requestContext) => {
        const input = StoryBibleChangeSetInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "故事圣经变更参数无效。",
          );
        const chapter = writing.get(input.data.chapterId);
        if (!chapter || chapter.projectId !== input.data.projectId)
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
        if (!chapter.content.trim())
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "章节正文为空，无法生成故事圣经建议。",
          );
        const created = context.uow.execute((transaction) => {
          const sourceFingerprint = fingerprint(chapter.content);
          const duplicate = transaction.get<ChangeSetRow>(
            `SELECT * FROM knowledge_story_bible_change_sets
             WHERE project_id = ? AND chapter_id = ? AND source_fingerprint = ?
               AND status IN ('queued', 'draft', 'paused')`,
            chapter.projectId,
            chapter.id,
            sourceFingerprint,
          );
          if (duplicate) return changeSet(duplicate);
          const id = crypto.randomUUID();
          const at = now();
          const draft = preview(chapter);
          transaction.run(
            `INSERT INTO knowledge_story_bible_change_sets(
              id, project_id, chapter_id, source_version, source_fingerprint,
              status, summary, task_id, conflict_notes_json, preview_json,
              created_memory_ids_json, applied_at, undone_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'draft', ?, NULL, '[]', ?, '[]', NULL, NULL, ?, ?)`,
            id,
            chapter.projectId,
            chapter.id,
            chapter.version,
            sourceFingerprint,
            draft.fields.find((field) => field.key === "章节摘要")?.value ?? "",
            JSON.stringify(draft),
            at,
            at,
          );
          const value = changeSet(
            transaction.get<ChangeSetRow>(
              "SELECT * FROM knowledge_story_bible_change_sets WHERE id = ?",
              id,
            )!,
          );
          emit(transaction, "draft-created", value);
          return value;
        });
        return requestContext.json(created, 201);
      },
    ),
    contribute(
      {
        id: "knowledge:story-bible-apply",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/story-bible/change-sets/{id}/apply",
        operationId: "story-bible.apply",
      },
      declaration({
        method: "post",
        path: "/api/v2/story-bible/change-sets/{id}/apply",
        operationId: "story-bible.apply",
        params: idParams,
        body: StoryBibleChangeSetApplyInputSchema,
        response: StoryBibleChangeSetSchema,
      }),
      async (requestContext) => {
        const input = StoryBibleChangeSetApplyInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "故事圣经采纳字段无效。",
          );
        const id = requestContext.req.param("id");
        const current = find(id);
        if (!current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到变更集。");
        if (current.status !== "draft")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "仅草稿状态的变更集可以采纳。",
          );
        const chapter = writing.get(current.chapter_id);
        if (
          !chapter ||
          chapter.version !== current.source_version ||
          fingerprint(chapter.content) !== current.source_fingerprint
        ) {
          context.uow.execute((transaction) => {
            const at = now();
            transaction.run(
              "UPDATE knowledge_story_bible_change_sets SET status = 'stale', updated_at = ? WHERE id = ?",
              at,
              id,
            );
            transaction.run(
              `INSERT OR IGNORE INTO knowledge_story_bible_stale_marks(
                id, project_id, chapter_id, reason, resolved_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
              crypto.randomUUID(),
              current.project_id,
              current.chapter_id,
              "章节正文已更新，需要重新核对故事圣经。",
              at,
              at,
            );
          });
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "章节已变化，请重新生成故事圣经建议。",
          );
        }
        const allowed = [
          "章节摘要",
          "重要事件",
          "人物变化与秘密",
          "新增或回收伏笔",
        ];
        if (input.data.fields?.some((field) => !allowed.includes(field)))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "包含不可采纳的字段。",
          );
        const updated = context.uow.execute((transaction) => {
          const draft = JSON.parse(current.preview_json) as ReturnType<
            typeof preview
          >;
          const selected = input.data.fields
            ? draft.fields.filter((field) =>
                input.data.fields!.includes(field.key),
              )
            : draft.fields;
          const memoryId = crypto.randomUUID();
          const at = now();
          transaction.run(
            `INSERT INTO knowledge_chapter_memories(
              id, project_id, chapter_id, title, payload_json,
              source_change_set_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            memoryId,
            current.project_id,
            current.chapter_id,
            draft.title,
            JSON.stringify(
              Object.fromEntries(
                selected.map((field) => [field.key, field.value]),
              ),
            ),
            id,
            at,
            at,
          );
          transaction.run(
            `UPDATE knowledge_story_bible_change_sets
             SET status = 'applied', created_memory_ids_json = ?,
                 applied_at = ?, updated_at = ? WHERE id = ?`,
            JSON.stringify([memoryId]),
            at,
            at,
            id,
          );
          transaction.run(
            `UPDATE knowledge_story_bible_stale_marks
             SET resolved_at = ?, updated_at = ?
             WHERE project_id = ? AND chapter_id = ? AND resolved_at IS NULL`,
            at,
            at,
            current.project_id,
            current.chapter_id,
          );
          const value = changeSet(
            transaction.get<ChangeSetRow>(
              "SELECT * FROM knowledge_story_bible_change_sets WHERE id = ?",
              id,
            )!,
          );
          emit(transaction, "applied", value);
          return value;
        });
        return requestContext.json(updated);
      },
    ),
    contribute(
      {
        id: "knowledge:story-bible-undo",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/story-bible/change-sets/{id}/undo",
        operationId: "story-bible.undo",
      },
      declaration({
        method: "post",
        path: "/api/v2/story-bible/change-sets/{id}/undo",
        operationId: "story-bible.undo",
        params: idParams,
        response: StoryBibleChangeSetSchema,
      }),
      (requestContext) => {
        const id = requestContext.req.param("id");
        const current = find(id);
        if (!current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到变更集。");
        if (
          !(["applied", "stale"] as const).includes(current.status as "applied")
        )
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "仅已采纳或过期的变更集可以撤销。",
          );
        return requestContext.json(
          context.uow.execute((transaction) => {
            for (const memoryId of JSON.parse(
              current.created_memory_ids_json,
            ) as string[])
              transaction.run(
                "DELETE FROM knowledge_chapter_memories WHERE id = ? AND source_change_set_id = ?",
                memoryId,
                id,
              );
            const at = now();
            transaction.run(
              `UPDATE knowledge_story_bible_change_sets
               SET status = 'discarded', undone_at = ?, updated_at = ? WHERE id = ?`,
              at,
              at,
              id,
            );
            const value = changeSet(
              transaction.get<ChangeSetRow>(
                "SELECT * FROM knowledge_story_bible_change_sets WHERE id = ?",
                id,
              )!,
            );
            emit(transaction, "undone", value);
            return value;
          }),
        );
      },
    ),
    contribute(
      {
        id: "knowledge:story-bible-status",
        pluginId: "knowledge",
        method: "patch",
        path: "/api/v2/story-bible/change-sets/{id}/status",
        operationId: "story-bible.setStatus",
      },
      declaration({
        method: "patch",
        path: "/api/v2/story-bible/change-sets/{id}/status",
        operationId: "story-bible.setStatus",
        params: idParams,
        body: statusInput,
        response: StoryBibleChangeSetSchema,
      }),
      async (requestContext) => {
        const input = statusInput.safeParse(await requestContext.req.json());
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "变更集状态无效。",
          );
        const id = requestContext.req.param("id");
        const current = find(id);
        if (!current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到变更集。");
        if (["applied", "stale"].includes(current.status))
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "已采纳或过期的变更集不能改为此状态。",
          );
        return requestContext.json(
          context.uow.execute((transaction) => {
            transaction.run(
              "UPDATE knowledge_story_bible_change_sets SET status = ?, updated_at = ? WHERE id = ?",
              input.data.status,
              now(),
              id,
            );
            const value = changeSet(
              transaction.get<ChangeSetRow>(
                "SELECT * FROM knowledge_story_bible_change_sets WHERE id = ?",
                id,
              )!,
            );
            emit(transaction, "status-updated", value);
            return value;
          }),
        );
      },
    ),
  ];
}

const knowledgeMigrations = [
  {
    id: "knowledge.0001.story-bible",
    pluginId: "knowledge",
    version: "3.0.0-alpha.3",
    dependsOn: ["writing.0001.chapters"],
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_story_bible_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        auto_suggest INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_story_bible_change_sets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        source_version INTEGER NOT NULL,
        source_fingerprint TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        task_id TEXT,
        conflict_notes_json TEXT NOT NULL DEFAULT '[]',
        preview_json TEXT NOT NULL,
        created_memory_ids_json TEXT NOT NULL DEFAULT '[]',
        applied_at TEXT,
        undone_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS knowledge_story_bible_project
        ON knowledge_story_bible_change_sets(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS knowledge_story_bible_stale_marks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, chapter_id, resolved_at)
      );
      CREATE TABLE IF NOT EXISTS knowledge_chapter_memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        source_change_set_id TEXT REFERENCES knowledge_story_bible_change_sets(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: "knowledge.0002.owned-records",
    pluginId: "knowledge",
    version: "3.0.0-alpha.3",
    dependsOn: ["knowledge.0001.story-bible"],
    sql: `
      ALTER TABLE knowledge_chapter_memories
        ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS knowledge_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN (
          'story', 'character-states', 'story-bible', 'story-events',
          'foreshadowings', 'memory', 'visual-profiles', 'visual-settings',
          'chapter-memories', 'story-bible-sidecar-preferences'
        )),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS knowledge_records_project_kind
        ON knowledge_records(project_id, kind, updated_at DESC, id);
    `,
  },
  ...researchMigrations,
  ...creativeIntelligenceMigrations,
] as const;

export function createKnowledgePlugin(host?: DesktopHostClient) {
  const search = new DuckDuckGoSearchAdapter(host);
  const webResearch = new WebResearchAdapter(host);
  return definePlugin({
    inject: [WORKSPACE_PROJECT_SERVICE.id, WRITING_CHAPTER_SERVICE.id],
    descriptor: {
      id: "knowledge",
      version: "3.0.0-alpha.3",
      apiVersion: "2",
      requires: ["foundation", "workspace", "writing"],
      provides: [
        "knowledge.story-bible",
        "knowledge.creative-intelligence",
        "knowledge.web-research",
      ],
      stability: "internal",
    },
    ui: [
      {
        id: "knowledge.panel.story-bible",
        pluginId: "knowledge",
        kind: "panel",
        metadata: { slot: "writing.story-bible", title: "故事圣经" },
      },
      {
        id: "knowledge.inspector.story-bible",
        pluginId: "knowledge",
        kind: "inspector",
        metadata: { target: "chapter", title: "故事圣经侧栏" },
      },
    ],
    migrations: [...knowledgeMigrations, knowledgeCreationMigration],
    apply: (context) => {
      registerKnowledgeCreation(context);
      const workspace = optionalService<WorkspaceProjectService>(
        context,
        WORKSPACE_PROJECT_SERVICE,
      );
      if (!workspace)
        throw new Error("knowledge requires workspace.projects.v1");
      context.effect(
        () =>
          provideService(
            context,
            KNOWLEDGE_RESEARCH_SERVICE,
            researchService(context),
          ),
        `service:${KNOWLEDGE_RESEARCH_SERVICE}`,
      );
      context.effect(
        () =>
          provideService(context, KNOWLEDGE_WEB_RESEARCH_SERVICE, webResearch),
        `service:${KNOWLEDGE_WEB_RESEARCH_SERVICE}`,
      );
      const creativeIntelligence = creativeIntelligenceService(context);
      context.effect(
        () =>
          provideService(
            context,
            CREATIVE_KNOWLEDGE_SERVICE,
            creativeIntelligence,
          ),
        `service:${CREATIVE_KNOWLEDGE_SERVICE}`,
      );
      for (const route of [
        ...routes(context),
        ...researchRoutes(context, workspace, search),
        ...creativeIntelligenceRoutes(context, creativeIntelligence),
      ])
        context.effect(() => context.http.register(route), `route:${route.id}`);
    },
  });
}

export const knowledgePlugin = createKnowledgePlugin();

import type { Context } from "@deepseek-ai/cordis";
export default {
  name: "knowledge-entry",
  inject: ["pluginEnvironment"],
  apply: (ctx: Context, config: Record<string, unknown>) => {
    ctx.plugin(
      createKnowledgePlugin(
        ctx.pluginEnvironment.host as Parameters<
          typeof createKnowledgePlugin
        >[0],
      ),
      config,
    );
  },
};
