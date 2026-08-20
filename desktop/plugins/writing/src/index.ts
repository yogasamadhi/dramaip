import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  ChapterInputSchema,
  ChapterPatchSchema,
  ChapterReorderInputSchema,
  ChapterSchema,
  NovelWorkspaceSchema,
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
  WritingResourceKindSchema,
  WritingResourceSchema,
  type Chapter,
  type WritingChapterService,
  type WritingResource,
  type WritingResourceKind,
  type WritingResourceService,
} from "@dramaip/contracts/writing";
import {
  defineFirstPartyPlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";
import {
  writingAdvancedMigrations,
  writingAdvancedRoutes,
} from "./advanced.js";

interface ChapterRow {
  id: string;
  project_id: string;
  title: string;
  order_index: number;
  summary: string;
  outline: string | null;
  content: string;
  main_conflict: string | null;
  hook: string | null;
  highlight: string | null;
  reversal: string | null;
  cliffhanger: string | null;
  short_drama_note: string | null;
  ai_video_note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ChapterVersionRow {
  id: string;
  chapter_id: string;
  version_number: number;
  snapshot_json: string;
  created_at: string;
}

interface WritingResourceRow {
  id: string;
  kind: WritingResourceKind;
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

type RouteHandler = (context: RouteContext) => Response | Promise<Response>;

const idParams = z.object({ id: z.string().uuid() });
const projectIdParams = z.object({ projectId: z.string().uuid() });

function declaration(input: {
  method: "delete" | "get" | "patch" | "post";
  path: string;
  operationId: string;
  response?: ZodType;
  responseStatus?: 200 | 201;
  body?: ZodType;
  params?: ZodType;
}): unknown {
  const status = input.responseStatus ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["chapters"],
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
      [status]: input.response
        ? {
            description: "Success",
            content: { "application/json": { schema: input.response } },
          }
        : { description: "Success" },
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
        description: "Version conflict",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
    },
  } as never);
}

function contribution(
  metadata: Omit<RouteContribution, "install">,
  openapi: unknown,
  handler: RouteHandler,
): RouteContribution {
  return {
    ...metadata,
    install: (app) => {
      const register = app.openapi as unknown as (
        route: unknown,
        handler: RouteHandler,
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

function optional(value: string | null): string | undefined {
  return value === null ? undefined : value;
}

function chapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    orderIndex: row.order_index,
    summary: row.summary,
    outline: optional(row.outline),
    content: row.content,
    mainConflict: optional(row.main_conflict),
    hook: optional(row.hook),
    highlight: optional(row.highlight),
    reversal: optional(row.reversal),
    cliffhanger: optional(row.cliffhanger),
    shortDramaNote: optional(row.short_drama_note),
    aiVideoNote: optional(row.ai_video_note),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function writingResource(row: WritingResourceRow): WritingResource {
  return {
    id: row.id,
    domain: row.kind,
    projectId: row.project_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    title: row.title,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function appendChapterEvent(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: Chapter | { id: string; projectId: string },
): void {
  transaction.append({
    type: `writing.chapter-${action}.v1`,
    pluginId: "writing",
    aggregateType: "chapter",
    aggregateId: value.id,
    aggregateVersion: "version" in value ? value.version : 0,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function writingResourceRoutes(
  workspace: WorkspaceProjectService,
  service: WritingResourceService,
): RouteContribution[] {
  const kinds: readonly WritingResourceKind[] = [
    "characters",
    "outlines",
    "story-arcs",
  ];
  const inputSchema = z.object({
    projectId: z.string().uuid(),
    parentId: z.string().uuid().optional(),
    title: z.string().min(1).max(160),
    payload: z.record(z.string(), z.unknown()).optional(),
  });
  const patchSchema = inputSchema
    .omit({ projectId: true, parentId: true })
    .partial()
    .extend({ version: z.number().int().nonnegative() });
  const result: RouteContribution[] = [];
  for (const kind of kinds) {
    const path = `/api/v2/${kind}` as `/api/v2/${string}`;
    result.push(
      contribution(
        {
          id: `writing:${kind}-list`,
          pluginId: "writing",
          method: "get",
          path,
          operationId: `${kind}.list`,
        },
        declaration({
          method: "get",
          path,
          operationId: `${kind}.list`,
          response: z.array(WritingResourceSchema),
        }),
        (requestContext) => {
          const projectId = requestContext.req.query("projectId");
          if (!projectId || !workspace.get(projectId))
            return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
          return requestContext.json(service.list(kind, projectId));
        },
      ),
      contribution(
        {
          id: `writing:${kind}-create`,
          pluginId: "writing",
          method: "post",
          path,
          operationId: `${kind}.create`,
        },
        declaration({
          method: "post",
          path,
          operationId: `${kind}.create`,
          body: inputSchema,
          response: WritingResourceSchema,
          responseStatus: 201,
        }),
        async (requestContext) => {
          const input = inputSchema.safeParse(await requestContext.req.json());
          if (!input.success || !workspace.get(input.data.projectId))
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "写作资料内容无效。",
            );
          return requestContext.json(
            service.create({
              kind: WritingResourceKindSchema.parse(kind),
              projectId: input.data.projectId,
              ...(input.data.parentId ? { parentId: input.data.parentId } : {}),
              title: input.data.title,
              payload: input.data.payload ?? {},
            }),
            201,
          );
        },
      ),
      contribution(
        {
          id: `writing:${kind}-get`,
          pluginId: "writing",
          method: "get",
          path: `${path}/{id}`,
          operationId: `${kind}.get`,
        },
        declaration({
          method: "get",
          path: `${path}/{id}`,
          operationId: `${kind}.get`,
          params: idParams,
          response: WritingResourceSchema,
        }),
        (requestContext) => {
          const value = service.get(requestContext.req.param("id"));
          if (!value || value.domain !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到写作资料。",
            );
          requestContext.header("ETag", `"${value.version}"`);
          return requestContext.json(value);
        },
      ),
      contribution(
        {
          id: `writing:${kind}-update`,
          pluginId: "writing",
          method: "patch",
          path: `${path}/{id}`,
          operationId: `${kind}.update`,
        },
        declaration({
          method: "patch",
          path: `${path}/{id}`,
          operationId: `${kind}.update`,
          params: idParams,
          body: patchSchema,
          response: WritingResourceSchema,
        }),
        async (requestContext) => {
          const input = patchSchema.safeParse(await requestContext.req.json());
          if (!input.success)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "写作资料修改内容无效。",
            );
          const current = service.get(requestContext.req.param("id"));
          if (!current || current.domain !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到写作资料。",
            );
          const value = service.update(current.id, input.data);
          if (value === "conflict")
            return problem(
              requestContext,
              409,
              "CONFLICT",
              "写作资料已更新，请刷新后重试。",
            );
          if (!value)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到写作资料。",
            );
          requestContext.header("ETag", `"${value.version}"`);
          return requestContext.json(value);
        },
      ),
      contribution(
        {
          id: `writing:${kind}-remove`,
          pluginId: "writing",
          method: "delete",
          path: `${path}/{id}`,
          operationId: `${kind}.remove`,
        },
        declaration({
          method: "delete",
          path: `${path}/{id}`,
          operationId: `${kind}.remove`,
          params: idParams,
        }),
        (requestContext) => {
          const current = service.get(requestContext.req.param("id"));
          if (!current || current.domain !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到写作资料。",
            );
          service.remove(current.id);
          return requestContext.body(null, 204);
        },
      ),
    );
  }
  return result;
}

function createChapter(
  context: PluginContext,
  input: z.infer<typeof ChapterInputSchema>,
): Chapter {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  return context.uow.execute((transaction) => {
    const next =
      transaction.get<{ value: number }>(
        "SELECT COALESCE(MAX(order_index), -1) + 1 AS value FROM chapters WHERE project_id = ?",
        input.projectId,
      )?.value ?? 0;
    transaction.run(
      `INSERT INTO chapters(
        id, project_id, title, order_index, summary, outline, content,
        main_conflict, hook, highlight, reversal, cliffhanger,
        short_drama_note, ai_video_note, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      input.projectId,
      input.title.trim(),
      next,
      input.summary ?? "",
      input.outline ?? null,
      input.content ?? "",
      input.mainConflict ?? null,
      input.hook ?? null,
      input.highlight ?? null,
      input.reversal ?? null,
      input.cliffhanger ?? null,
      input.shortDramaNote ?? null,
      input.aiVideoNote ?? null,
      now,
      now,
    );
    const value = chapter(
      transaction.get<ChapterRow>("SELECT * FROM chapters WHERE id = ?", id)!,
    );
    appendChapterEvent(transaction, "created", value);
    return value;
  });
}

function writingRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
): readonly RouteContribution[] {
  const timestamp = () => new Date().toISOString();
  const byId = (id: string): ChapterRow | undefined =>
    context.uow.execute((transaction) =>
      transaction.get<ChapterRow>("SELECT * FROM chapters WHERE id = ?", id),
    );
  const list = (projectId: string): Chapter[] =>
    context.uow.execute((transaction) =>
      transaction
        .all<ChapterRow>(
          "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index, created_at",
          projectId,
        )
        .map(chapter),
    );

  return [
    contribution(
      {
        id: "writing:chapters-list",
        pluginId: "writing",
        method: "get",
        path: "/api/v2/projects/{projectId}/chapters",
        operationId: "chapters.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{projectId}/chapters",
        operationId: "chapters.list",
        params: projectIdParams,
        response: z.array(ChapterSchema),
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("projectId");
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(list(projectId));
      },
    ),
    contribution(
      {
        id: "writing:chapters-get",
        pluginId: "writing",
        method: "get",
        path: "/api/v2/chapters/{id}",
        operationId: "chapters.get",
      },
      declaration({
        method: "get",
        path: "/api/v2/chapters/{id}",
        operationId: "chapters.get",
        params: idParams,
        response: ChapterSchema,
      }),
      (requestContext) => {
        const row = byId(requestContext.req.param("id"));
        if (!row)
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
        const value = chapter(row);
        requestContext.header("ETag", `"${value.version}"`);
        return requestContext.json(value);
      },
    ),
    contribution(
      {
        id: "writing:chapters-create",
        pluginId: "writing",
        method: "post",
        path: "/api/v2/chapters",
        operationId: "chapters.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/chapters",
        operationId: "chapters.create",
        body: ChapterInputSchema,
        response: ChapterSchema,
        responseStatus: 201,
      }),
      async (requestContext) => {
        const parsed = ChapterInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "章节内容无效。",
          );
        if (!workspace.get(parsed.data.projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const created = createChapter(context, parsed.data);
        requestContext.header("ETag", `"${created.version}"`);
        return requestContext.json(created, 201);
      },
    ),
    contribution(
      {
        id: "writing:chapters-update",
        pluginId: "writing",
        method: "patch",
        path: "/api/v2/chapters/{id}",
        operationId: "chapters.update",
      },
      declaration({
        method: "patch",
        path: "/api/v2/chapters/{id}",
        operationId: "chapters.update",
        params: idParams,
        body: ChapterPatchSchema,
        response: ChapterSchema,
      }),
      async (requestContext) => {
        const parsed = ChapterPatchSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "章节修改内容无效。",
          );
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<ChapterRow>(
            "SELECT * FROM chapters WHERE id = ?",
            id,
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== parsed.data.version)
            return { state: "conflict" as const };
          transaction.run(
            `INSERT INTO writing_chapter_versions(
              id, chapter_id, version_number, snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
            crypto.randomUUID(),
            id,
            current.version,
            JSON.stringify(chapter(current)),
            timestamp(),
          );
          const input = parsed.data;
          transaction.run(
            `UPDATE chapters SET
              title = ?, summary = ?, outline = ?, content = ?,
              main_conflict = ?, hook = ?, highlight = ?, reversal = ?,
              cliffhanger = ?, short_drama_note = ?, ai_video_note = ?,
              version = version + 1, updated_at = ?
             WHERE id = ? AND version = ?`,
            input.title?.trim() ?? current.title,
            input.summary ?? current.summary,
            input.outline ?? current.outline,
            input.content ?? current.content,
            input.mainConflict ?? current.main_conflict,
            input.hook ?? current.hook,
            input.highlight ?? current.highlight,
            input.reversal ?? current.reversal,
            input.cliffhanger ?? current.cliffhanger,
            input.shortDramaNote ?? current.short_drama_note,
            input.aiVideoNote ?? current.ai_video_note,
            timestamp(),
            id,
            current.version,
          );
          const value = chapter(
            transaction.get<ChapterRow>(
              "SELECT * FROM chapters WHERE id = ?",
              id,
            )!,
          );
          appendChapterEvent(transaction, "updated", value);
          return { state: "updated" as const, value };
        });
        if (result.state === "missing")
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
        if (result.state === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "章节已在其他操作中更新，请刷新后重试。",
          );
        requestContext.header("ETag", `"${result.value.version}"`);
        return requestContext.json(result.value);
      },
    ),
    contribution(
      {
        id: "writing:chapters-delete",
        pluginId: "writing",
        method: "delete",
        path: "/api/v2/chapters/{id}",
        operationId: "chapters.remove",
      },
      declaration({
        method: "delete",
        path: "/api/v2/chapters/{id}",
        operationId: "chapters.remove",
        params: idParams,
      }),
      (requestContext) => {
        const id = requestContext.req.param("id");
        const deleted = context.uow.execute((transaction) => {
          const current = transaction.get<ChapterRow>(
            "SELECT * FROM chapters WHERE id = ?",
            id,
          );
          if (!current) return false;
          transaction.run("DELETE FROM chapters WHERE id = ?", id);
          appendChapterEvent(transaction, "deleted", {
            id,
            projectId: current.project_id,
          });
          return true;
        });
        return deleted
          ? requestContext.body(null, 204)
          : problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
      },
    ),
    contribution(
      {
        id: "writing:chapters-reorder",
        pluginId: "writing",
        method: "post",
        path: "/api/v2/projects/{projectId}/chapters/reorder",
        operationId: "chapters.reorder",
      },
      declaration({
        method: "post",
        path: "/api/v2/projects/{projectId}/chapters/reorder",
        operationId: "chapters.reorder",
        params: projectIdParams,
        body: ChapterReorderInputSchema,
        response: z.array(ChapterSchema),
      }),
      async (requestContext) => {
        const parsed = ChapterReorderInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "章节排序内容无效。",
          );
        const projectId = requestContext.req.param("projectId");
        const reordered = context.uow.execute((transaction) => {
          const current = transaction.all<ChapterRow>(
            "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
            projectId,
          );
          const requested = parsed.data.chapterIds;
          if (
            current.length !== requested.length ||
            new Set(requested).size !== requested.length ||
            current.some((item) => !requested.includes(item.id))
          )
            return undefined;
          const now = timestamp();
          requested.forEach((id, index) =>
            transaction.run(
              "UPDATE chapters SET order_index = ?, version = version + 1, updated_at = ? WHERE id = ?",
              index,
              now,
              id,
            ),
          );
          const values = transaction
            .all<ChapterRow>(
              "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index",
              projectId,
            )
            .map(chapter);
          transaction.append({
            type: "writing.chapters-reordered.v1",
            pluginId: "writing",
            aggregateType: "project-chapters",
            aggregateId: projectId,
            aggregateVersion: Math.max(
              0,
              ...values.map((item) => item.version),
            ),
            payload: JSON.parse(
              JSON.stringify({ projectId, chapters: values }),
            ),
          });
          return values;
        });
        return reordered
          ? requestContext.json(reordered)
          : problem(
              requestContext,
              409,
              "CONFLICT",
              "章节列表已变化，请刷新后重新排序。",
            );
      },
    ),
    contribution(
      {
        id: "writing:novel-workspace-get",
        pluginId: "writing",
        method: "get",
        path: "/api/v2/projects/{id}/novel-workspace",
        operationId: "novel-workspace.get",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{id}/novel-workspace",
        operationId: "novel-workspace.get",
        params: idParams,
        response: NovelWorkspaceSchema,
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        const project = workspace.get(projectId);
        if (!project)
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const chapters = list(projectId);
        return requestContext.json({
          project,
          chapters,
          characters: [],
          outlines: [],
          storyArcs: [],
          statuses: chapters.map((item) => ({
            chapterId: item.id,
            words: item.content.replace(/\s/gu, "").length,
            hasMemory: false,
          })),
        });
      },
    ),
    contribution(
      {
        id: "writing:chapter-versions-list",
        pluginId: "writing",
        method: "get",
        path: "/api/v2/chapters/{id}/versions",
        operationId: "novel-workspace.listChapterVersions",
      },
      declaration({
        method: "get",
        path: "/api/v2/chapters/{id}/versions",
        operationId: "novel-workspace.listChapterVersions",
        params: idParams,
        response: z.array(z.record(z.string(), z.unknown())),
      }),
      (requestContext) => {
        const chapterId = requestContext.req.param("id");
        const source = byId(chapterId);
        if (!source)
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
        return requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<ChapterVersionRow>(
                "SELECT * FROM writing_chapter_versions WHERE chapter_id = ? ORDER BY version_number DESC",
                chapterId,
              )
              .map((row) => {
                const snapshot = JSON.parse(row.snapshot_json) as Chapter;
                return {
                  id: row.id,
                  domain: "content-versions",
                  projectId: source.project_id,
                  parentId: chapterId,
                  title: `${source.title} · 版本 ${row.version_number}`,
                  payload: {
                    内容: snapshot.content,
                    基线版本: row.version_number,
                  },
                  version: row.version_number,
                  createdAt: row.created_at,
                  updatedAt: row.created_at,
                };
              }),
          ),
        );
      },
    ),
    contribution(
      {
        id: "writing:chapter-versions-restore",
        pluginId: "writing",
        method: "post",
        path: "/api/v2/chapters/{id}/versions/{versionId}/restore",
        operationId: "novel-workspace.restoreChapterVersion",
      },
      declaration({
        method: "post",
        path: "/api/v2/chapters/{id}/versions/{versionId}/restore",
        operationId: "novel-workspace.restoreChapterVersion",
        params: z.object({
          id: z.string().uuid(),
          versionId: z.string().uuid(),
        }),
        body: z.object({ baseVersion: z.number().int().nonnegative() }),
        response: ChapterSchema,
      }),
      async (requestContext) => {
        const input = z
          .object({ baseVersion: z.number().int().nonnegative() })
          .safeParse(await requestContext.req.json());
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "版本恢复参数无效。",
          );
        const chapterId = requestContext.req.param("id");
        const versionId = requestContext.req.param("versionId");
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<ChapterRow>(
            "SELECT * FROM chapters WHERE id = ?",
            chapterId,
          );
          if (!current) return { state: "missing-chapter" as const };
          if (current.version !== input.data.baseVersion)
            return { state: "conflict" as const };
          const version = transaction.get<ChapterVersionRow>(
            "SELECT * FROM writing_chapter_versions WHERE id = ? AND chapter_id = ?",
            versionId,
            chapterId,
          );
          if (!version) return { state: "missing-version" as const };
          const snapshot = JSON.parse(version.snapshot_json) as Chapter;
          const at = timestamp();
          transaction.run(
            `INSERT OR IGNORE INTO writing_chapter_versions(
              id, chapter_id, version_number, snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
            crypto.randomUUID(),
            chapterId,
            current.version,
            JSON.stringify(chapter(current)),
            at,
          );
          transaction.run(
            "UPDATE chapters SET content = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
            snapshot.content,
            at,
            chapterId,
            current.version,
          );
          const value = chapter(
            transaction.get<ChapterRow>(
              "SELECT * FROM chapters WHERE id = ?",
              chapterId,
            )!,
          );
          appendChapterEvent(transaction, "version-restored", value);
          return { state: "restored" as const, value };
        });
        if (result.state === "missing-chapter")
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节。");
        if (result.state === "missing-version")
          return problem(requestContext, 404, "NOT_FOUND", "未找到章节版本。");
        if (result.state === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "章节已变化，请刷新后重新恢复。",
          );
        return requestContext.json(result.value);
      },
    ),
  ];
}

const writingMigrations = [
  {
    id: "writing.0001.chapters",
    pluginId: "writing",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0001.projects-and-series"],
    sql: `
      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        outline TEXT,
        content TEXT NOT NULL DEFAULT '',
        main_conflict TEXT,
        hook TEXT,
        highlight TEXT,
        reversal TEXT,
        cliffhanger TEXT,
        short_drama_note TEXT,
        ai_video_note TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chapters_project_order
        ON chapters(project_id, order_index, id);
      CREATE TABLE IF NOT EXISTS writing_chapter_versions (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(chapter_id, version_number)
      );
      CREATE INDEX IF NOT EXISTS writing_chapter_versions_chapter
        ON writing_chapter_versions(chapter_id, version_number DESC);
    `,
  },
  {
    id: "writing.0002.resources",
    pluginId: "writing",
    version: "3.0.0-alpha.3",
    dependsOn: ["writing.0001.chapters"],
    sql: `
      CREATE TABLE IF NOT EXISTS writing_resources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('characters', 'outlines', 'story-arcs')),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS writing_resources_project_kind
        ON writing_resources(project_id, kind, updated_at DESC, id);
    `,
  },
  ...writingAdvancedMigrations,
] as const;

export const writingPlugin = defineFirstPartyPlugin({
  descriptor: {
    id: "writing",
    version: "3.0.0-alpha.3",
    apiVersion: "2",
    requires: ["foundation", "workspace", "automation"],
    provides: ["writing.chapters"],
    stability: "internal",
  },
  ui: [
    {
      id: "writing.route.home",
      pluginId: "writing",
      kind: "route",
      metadata: { path: "/write", title: "小说写作" },
    },
    {
      id: "writing.route.quick-start",
      pluginId: "writing",
      kind: "route",
      metadata: { path: "/write/new", title: "新建小说" },
    },
    {
      id: "writing.navigation.home",
      pluginId: "writing",
      kind: "navigation",
      metadata: { section: "main", order: 20, label: "小说写作", to: "/write" },
    },
    {
      id: "writing.editor.chapter",
      pluginId: "writing",
      kind: "editor",
      metadata: { target: "chapter", title: "章节编辑器" },
    },
  ],
  migrations: writingMigrations,
  activate: (context) => {
    const workspace = context.services.get<WorkspaceProjectService>(
      WORKSPACE_PROJECT_SERVICE,
    );
    if (!workspace) throw new Error("writing requires workspace.projects.v1");
    const chapterService: WritingChapterService = {
      create: (input) => createChapter(context, input),
      get: (id) =>
        context.uow.execute((transaction) => {
          const row = transaction.get<ChapterRow>(
            "SELECT * FROM chapters WHERE id = ?",
            id,
          );
          return row ? chapter(row) : undefined;
        }),
      list: (projectId) =>
        context.uow.execute((transaction) =>
          transaction
            .all<ChapterRow>(
              "SELECT * FROM chapters WHERE project_id = ? ORDER BY order_index, created_at",
              projectId,
            )
            .map(chapter),
        ),
      update: (id, input) =>
        context.uow.execute((transaction) => {
          const current = transaction.get<ChapterRow>(
            "SELECT * FROM chapters WHERE id = ?",
            id,
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== input.version)
            return { state: "conflict" as const, current: chapter(current) };
          const at = new Date().toISOString();
          transaction.run(
            `INSERT OR IGNORE INTO writing_chapter_versions(
              id, chapter_id, version_number, snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
            crypto.randomUUID(),
            id,
            current.version,
            JSON.stringify(chapter(current)),
            at,
          );
          transaction.run(
            `UPDATE chapters SET title = ?, summary = ?, outline = ?, content = ?,
              main_conflict = ?, hook = ?, highlight = ?, reversal = ?,
              cliffhanger = ?, short_drama_note = ?, ai_video_note = ?,
              version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
            input.title?.trim() ?? current.title,
            input.summary ?? current.summary,
            input.outline ?? current.outline,
            input.content ?? current.content,
            input.mainConflict ?? current.main_conflict,
            input.hook ?? current.hook,
            input.highlight ?? current.highlight,
            input.reversal ?? current.reversal,
            input.cliffhanger ?? current.cliffhanger,
            input.shortDramaNote ?? current.short_drama_note,
            input.aiVideoNote ?? current.ai_video_note,
            at,
            id,
            current.version,
          );
          const value = chapter(
            transaction.get<ChapterRow>(
              "SELECT * FROM chapters WHERE id = ?",
              id,
            )!,
          );
          appendChapterEvent(transaction, "updated", value);
          return { state: "updated" as const, value };
        }),
      remove: (id) =>
        context.uow.execute((transaction) => {
          const current = transaction.get<ChapterRow>(
            "SELECT * FROM chapters WHERE id = ?",
            id,
          );
          if (!current) return false;
          transaction.run("DELETE FROM chapters WHERE id = ?", id);
          appendChapterEvent(transaction, "deleted", {
            id,
            projectId: current.project_id,
          });
          return true;
        }),
      replaceContent: (id, baseVersion, content) =>
        context.uow.execute((transaction) => {
          const current = transaction.get<ChapterRow>(
            "SELECT * FROM chapters WHERE id = ?",
            id,
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== baseVersion)
            return { state: "conflict" as const, current: chapter(current) };
          const at = new Date().toISOString();
          transaction.run(
            `INSERT OR IGNORE INTO writing_chapter_versions(
              id, chapter_id, version_number, snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
            crypto.randomUUID(),
            id,
            current.version,
            JSON.stringify(chapter(current)),
            at,
          );
          transaction.run(
            "UPDATE chapters SET content = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
            content,
            at,
            id,
            current.version,
          );
          const value = chapter(
            transaction.get<ChapterRow>(
              "SELECT * FROM chapters WHERE id = ?",
              id,
            )!,
          );
          appendChapterEvent(transaction, "content-replaced", value);
          return { state: "updated" as const, value };
        }),
      updateSummary: (id, baseVersion, summary) =>
        context.uow.execute((transaction) => {
          const current = transaction.get<ChapterRow>(
            "SELECT * FROM chapters WHERE id = ?",
            id,
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== baseVersion)
            return { state: "conflict" as const, current: chapter(current) };
          transaction.run(
            "UPDATE chapters SET summary = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
            summary,
            new Date().toISOString(),
            id,
            current.version,
          );
          const value = chapter(
            transaction.get<ChapterRow>(
              "SELECT * FROM chapters WHERE id = ?",
              id,
            )!,
          );
          appendChapterEvent(transaction, "summary-updated", value);
          return { state: "updated" as const, value };
        }),
    };
    const resourceService: WritingResourceService = {
      create: (input) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        return context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO writing_resources(
              id, kind, project_id, parent_id, title, payload_json, version,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            id,
            input.kind,
            input.projectId,
            input.parentId ?? null,
            input.title.trim(),
            JSON.stringify(input.payload),
            now,
            now,
          );
          const value = writingResource(
            transaction.get<WritingResourceRow>(
              "SELECT * FROM writing_resources WHERE id = ?",
              id,
            )!,
          );
          transaction.append({
            type: `writing.${input.kind}-created.v1`,
            pluginId: "writing",
            aggregateType: input.kind,
            aggregateId: id,
            aggregateVersion: 0,
            payload: JSON.parse(JSON.stringify(value)),
          });
          return value;
        });
      },
      list: (kind, projectId) =>
        context.uow.execute((transaction) =>
          transaction
            .all<WritingResourceRow>(
              "SELECT * FROM writing_resources WHERE kind = ? AND project_id = ? ORDER BY updated_at DESC, id",
              kind,
              projectId,
            )
            .map(writingResource),
        ),
      get: (id) =>
        context.uow.execute((transaction) => {
          const row = transaction.get<WritingResourceRow>(
            "SELECT * FROM writing_resources WHERE id = ?",
            id,
          );
          return row ? writingResource(row) : undefined;
        }),
      update: (id, patch) =>
        context.uow.execute((transaction) => {
          const current = transaction.get<WritingResourceRow>(
            "SELECT * FROM writing_resources WHERE id = ?",
            id,
          );
          if (!current) return undefined;
          if (current.version !== patch.version) return "conflict" as const;
          transaction.run(
            `UPDATE writing_resources SET title = ?, payload_json = ?,
               version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
            patch.title?.trim() ?? current.title,
            JSON.stringify(patch.payload ?? JSON.parse(current.payload_json)),
            new Date().toISOString(),
            id,
            current.version,
          );
          const value = writingResource(
            transaction.get<WritingResourceRow>(
              "SELECT * FROM writing_resources WHERE id = ?",
              id,
            )!,
          );
          transaction.append({
            type: `writing.${current.kind}-updated.v1`,
            pluginId: "writing",
            aggregateType: current.kind,
            aggregateId: id,
            aggregateVersion: value.version,
            payload: JSON.parse(JSON.stringify(value)),
          });
          return value;
        }),
      remove: (id, expectedVersion) =>
        context.uow.execute((transaction) => {
          const current = transaction.get<WritingResourceRow>(
            "SELECT * FROM writing_resources WHERE id = ?",
            id,
          );
          if (
            !current ||
            (expectedVersion !== undefined &&
              current.version !== expectedVersion)
          )
            return false;
          transaction.run("DELETE FROM writing_resources WHERE id = ?", id);
          transaction.append({
            type: `writing.${current.kind}-removed.v1`,
            pluginId: "writing",
            aggregateType: current.kind,
            aggregateId: id,
            aggregateVersion: current.version,
            payload: { id, projectId: current.project_id },
          });
          return true;
        }),
    };
    context.effect(
      context.services.provide(WRITING_CHAPTER_SERVICE, chapterService),
      `service:${WRITING_CHAPTER_SERVICE}`,
    );
    context.effect(
      context.services.provide(WRITING_RESOURCE_SERVICE, resourceService),
      `service:${WRITING_RESOURCE_SERVICE}`,
    );
    for (const route of [
      ...writingRoutes(context, workspace),
      ...writingResourceRoutes(workspace, resourceService),
      ...writingAdvancedRoutes(context, chapterService),
    ])
      context.effect(context.http.register(route), `route:${route.id}`);
  },
});
