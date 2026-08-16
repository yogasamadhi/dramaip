import { randomUUID } from "node:crypto";

import type { Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import { pageQuerySchema, problemDetailsSchema } from "@dramaip/contracts";
import { createNodeMigration } from "@dramaip/domain-kit";
import { ApiProblem, idempotentResponse, requireIfMatch } from "@dramaip/http";
import type {
  ContextFragment,
  ContextRequest,
  MigrationDefinition,
  RouteContribution,
} from "@dramaip/plugin-api";

import {
  chapterPageSchema,
  chapterSchema,
  chapterVersionPageSchema,
  createChapterSchema,
  createLocalizationSchema,
  createRevisionSchema,
  localizationPageSchema,
  localizationSchema,
  projectContentVersionPageSchema,
  reorderChaptersSchema,
  revisionSchema,
  subtitleExportSchema,
  updateChapterSchema,
  updateLocalizationSchema,
  updateRevisionSchema,
  writingWorkspaceSchema,
} from "./contracts.ts";
import {
  WritingRepository,
  writingArchiveContributor,
  writingSourceImportAdopter,
} from "./repository.ts";

const legacyResources = [
  { kind: "chapter", path: "chapters", data: z.object({}) },
  { kind: "novel-workspace", path: "novel-workspaces", data: z.object({}) },
  { kind: "revision", path: "revisions", data: z.object({}) },
  { kind: "content-version", path: "content-versions", data: z.object({}) },
  { kind: "localization", path: "localizations", data: z.object({}) },
] as const;

export const migrations: readonly MigrationDefinition[] = [
  createNodeMigration("writing", legacyResources),
  {
    id: "writing-0002",
    pluginId: "writing",
    version: "2.0.0",
    dependsOn: ["writing-0001", "workspace-0002"],
    sql: `
      CREATE TABLE writing_workspaces (
        project_id TEXT PRIMARY KEY REFERENCES workspace_projects(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK (version > 0),
        word_goal INTEGER NOT NULL CHECK (word_goal > 0),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE writing_chapters (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        outline TEXT NOT NULL DEFAULT '',
        main_conflict TEXT NOT NULL DEFAULT '',
        hook TEXT NOT NULL DEFAULT '',
        highlight TEXT NOT NULL DEFAULT '',
        reversal TEXT NOT NULL DEFAULT '',
        cliffhanger TEXT NOT NULL DEFAULT '',
        short_drama_note TEXT NOT NULL DEFAULT '',
        ai_video_note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'final')),
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        word_count INTEGER NOT NULL CHECK (word_count >= 0),
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX writing_chapters_project_order_idx ON writing_chapters (project_id, ordinal);
      CREATE TABLE writing_chapter_versions (
        id TEXT PRIMARY KEY,
        chapter_id TEXT NOT NULL REFERENCES writing_chapters(id) ON DELETE CASCADE,
        chapter_version INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('manual-save', 'agent-commit', 'restore-checkpoint', 'import')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX writing_chapter_versions_chapter_idx
        ON writing_chapter_versions (chapter_id, chapter_version DESC);
      CREATE TABLE writing_revisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL REFERENCES writing_chapters(id) ON DELETE CASCADE,
        base_version INTEGER NOT NULL,
        proposed_title TEXT NOT NULL,
        proposed_content TEXT NOT NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'discarded')),
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE writing_localizations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO writing_workspaces (project_id, version, word_goal, updated_at)
      SELECT id, 1, CASE WHEN target_word_count BETWEEN 1 AND 5000 THEN target_word_count ELSE 2000 END, updated_at
        FROM workspace_projects;
    `,
  },
  {
    id: "writing-0003",
    pluginId: "writing",
    version: "3.0.0",
    dependsOn: ["writing-0002"],
    sql: `
      ALTER TABLE writing_localizations
        ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'adopted', 'archived'));
      ALTER TABLE writing_localizations ADD COLUMN adopted_at TEXT;
      CREATE INDEX writing_localizations_project_source_idx
        ON writing_localizations (project_id, source_id, locale, updated_at DESC);
    `,
  },
] as const;

const response = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});
const errors = {
  400: response(problemDetailsSchema, "Invalid request"),
  401: response(problemDetailsSchema, "Authentication required"),
  404: response(problemDetailsSchema, "Resource not found"),
  409: response(problemDetailsSchema, "Conflict"),
  412: response(problemDetailsSchema, "Version conflict"),
  428: response(problemDetailsSchema, "If-Match required"),
  500: response(problemDetailsSchema, "Internal error"),
} as const;
const idParam = z.object({ id: z.uuid() });
const projectParam = z.object({ projectId: z.uuid() });
const localizationQuery = pageQuerySchema.extend({ projectId: z.uuid() });

interface LocalizationRow {
  row_cursor: number;
  id: string;
  project_id: string;
  source_id: string;
  locale: string;
  content: string;
  status: "draft" | "adopted" | "archived";
  version: number;
  adopted_at: string | null;
  created_at: string;
  updated_at: string;
}

function localizationJson(row: LocalizationRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    locale: row.locale,
    content: row.content,
    status: row.status,
    version: row.version,
    adoptedAt: row.adopted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subtitleTimestamp(seconds: number, separator: "," | "."): string {
  const milliseconds = Math.max(0, Math.floor(seconds * 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

function expectedVersion(request: Request): number {
  const value = request.headers.get("if-match");
  if (!value) {
    requireIfMatch(request, 0);
    return 0;
  }
  return Number(/^"v(\d+)"$/.exec(value)?.[1] ?? Number.NaN);
}

export const writingServer: Plugin = {
  name: "dramaip-writing",
  inject: ["http", "uow", "workspaceExtensions", "automationRuntime"],
  apply(ctx) {
    const repository = new WritingRepository(ctx.uow);
    ctx.workspaceExtensions.registerSourceImportAdopter(
      writingSourceImportAdopter(repository),
    );
    ctx.workspaceExtensions.registerArchiveContributor(
      writingArchiveContributor(repository),
    );
    ctx.automationRuntime.registerContextProvider({
      id: "writing.context",
      pluginId: "writing",
      provide: (input) => writingContext(repository, input),
    });
    ctx.automationRuntime.registerChangeTarget({
      kind: "writing.chapter",
      pluginId: "writing",
      apply(tx, target) {
        repository.updateChapterTx(
          tx,
          target.targetId,
          target.baseVersion,
          updateChapterSchema.parse(target.patch),
          "agent-commit",
        );
      },
    });
    const routes: RouteContribution = {
      id: "writing.http.v2",
      pluginId: "writing",
      install(app) {
        const workspace = createRoute({
          method: "get",
          path: "/api/v2/writing/projects/{projectId}/workspace",
          request: { params: projectParam },
          responses: {
            200: response(writingWorkspaceSchema, "Writing workspace"),
            ...errors,
          },
        });
        app.openapi(workspace, (context) => {
          const value = repository.workspace(
            context.req.valid("param").projectId,
          );
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });

        const list = createRoute({
          method: "get",
          path: "/api/v2/writing/projects/{projectId}/chapters",
          request: { params: projectParam, query: pageQuerySchema },
          responses: {
            200: response(chapterPageSchema, "Chapters"),
            ...errors,
          },
        });
        app.openapi(list, (context) => {
          const query = context.req.valid("query");
          return context.json(
            repository.listChapters(
              context.req.valid("param").projectId,
              query.cursor,
              query.limit,
            ),
          );
        });

        const create = createRoute({
          method: "post",
          path: "/api/v2/writing/projects/{projectId}/chapters",
          request: {
            params: projectParam,
            body: {
              content: {
                "application/json": {
                  schema: createChapterSchema.omit({ projectId: true }),
                },
              },
            },
          },
          responses: {
            201: response(chapterSchema, "Chapter created"),
            ...errors,
          },
        });
        app.openapi(create, (context) => {
          const chapter = repository.createChapter({
            ...context.req.valid("json"),
            projectId: context.req.valid("param").projectId,
          });
          context.header("etag", `"v${chapter.version}"`);
          context.header("location", `/api/v2/writing/chapters/${chapter.id}`);
          return context.json(chapter, 201);
        });

        const reorder = createRoute({
          method: "post",
          path: "/api/v2/writing/projects/{projectId}/chapters/actions/reorder",
          request: {
            params: projectParam,
            body: {
              content: {
                "application/json": { schema: reorderChaptersSchema },
              },
            },
          },
          responses: {
            200: response(writingWorkspaceSchema, "Chapters reordered"),
            ...errors,
          },
        });
        app.openapi(reorder, async (context) => {
          const input = context.req.valid("json");
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.chapters.reorder",
            input,
            async () => {
              const value = repository.reorder(
                context.req.valid("param").projectId,
                expectedVersion(context.req.raw),
                input.chapterIds,
              );
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 200);
            },
          );
        });

        const get = createRoute({
          method: "get",
          path: "/api/v2/writing/chapters/{id}",
          request: { params: idParam },
          responses: { 200: response(chapterSchema, "Chapter"), ...errors },
        });
        app.openapi(get, (context) => {
          const value = repository.getChapter(context.req.valid("param").id);
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });

        const update = createRoute({
          method: "patch",
          path: "/api/v2/writing/chapters/{id}",
          request: {
            params: idParam,
            body: {
              content: { "application/json": { schema: updateChapterSchema } },
            },
          },
          responses: {
            200: response(chapterSchema, "Chapter updated"),
            ...errors,
          },
        });
        app.openapi(update, (context) => {
          const value = repository.updateChapter(
            context.req.valid("param").id,
            expectedVersion(context.req.raw),
            context.req.valid("json"),
          );
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });

        const save = createRoute({
          method: "post",
          path: "/api/v2/writing/chapters/{id}/actions/save",
          request: {
            params: idParam,
            body: {
              content: { "application/json": { schema: updateChapterSchema } },
            },
          },
          responses: {
            200: response(
              chapterSchema,
              "Chapter saved with immutable version",
            ),
            ...errors,
          },
        });
        app.openapi(save, async (context) => {
          const input = context.req.valid("json");
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.chapter.save",
            input,
            async () => {
              const value = repository.updateChapter(
                context.req.valid("param").id,
                expectedVersion(context.req.raw),
                input,
                "manual-save",
              );
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 200);
            },
          );
        });

        const remove = createRoute({
          method: "delete",
          path: "/api/v2/writing/chapters/{id}",
          request: { params: idParam },
          responses: { 204: { description: "Chapter deleted" }, ...errors },
        });
        app.openapi(remove, (context) => {
          repository.removeChapter(
            context.req.valid("param").id,
            expectedVersion(context.req.raw),
          );
          return context.body(null, 204);
        });

        const versions = createRoute({
          method: "get",
          path: "/api/v2/writing/chapters/{id}/versions",
          request: { params: idParam, query: pageQuerySchema },
          responses: {
            200: response(chapterVersionPageSchema, "Chapter versions"),
            ...errors,
          },
        });
        app.openapi(versions, (context) => {
          const query = context.req.valid("query");
          return context.json(
            repository.versions(
              context.req.valid("param").id,
              query.cursor,
              query.limit,
            ),
          );
        });

        const restore = createRoute({
          method: "post",
          path: "/api/v2/writing/chapters/{id}/versions/{versionId}/actions/restore",
          request: { params: z.object({ id: z.uuid(), versionId: z.uuid() }) },
          responses: {
            200: response(chapterSchema, "Chapter restored"),
            ...errors,
          },
        });
        app.openapi(restore, async (context) =>
          idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.chapter.restore",
            {},
            async () => {
              const params = context.req.valid("param");
              const value = repository.restore(
                params.id,
                params.versionId,
                expectedVersion(context.req.raw),
              );
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 200);
            },
          ),
        );

        const createRevision = createRoute({
          method: "post",
          path: "/api/v2/writing/revisions",
          request: {
            body: {
              content: { "application/json": { schema: createRevisionSchema } },
            },
          },
          responses: {
            201: response(revisionSchema, "Revision created"),
            ...errors,
          },
        });
        app.openapi(createRevision, async (context) => {
          const input = context.req.valid("json");
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.revision.create",
            input,
            async () => {
              const value = repository.createRevision(input);
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 201);
            },
          );
        });

        const getRevision = createRoute({
          method: "get",
          path: "/api/v2/writing/revisions/{id}",
          request: { params: idParam },
          responses: { 200: response(revisionSchema, "Revision"), ...errors },
        });
        app.openapi(getRevision, (context) => {
          const value = repository.getRevision(context.req.valid("param").id);
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });

        const updateRevision = createRoute({
          method: "patch",
          path: "/api/v2/writing/revisions/{id}",
          request: {
            params: idParam,
            body: {
              content: { "application/json": { schema: updateRevisionSchema } },
            },
          },
          responses: {
            200: response(revisionSchema, "Revision updated"),
            ...errors,
          },
        });
        app.openapi(updateRevision, (context) => {
          const value = repository.updateRevision(
            context.req.valid("param").id,
            expectedVersion(context.req.raw),
            context.req.valid("json"),
          );
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });

        const commitRevision = createRoute({
          method: "post",
          path: "/api/v2/writing/revisions/{id}/actions/commit",
          request: { params: idParam },
          responses: {
            200: response(
              z.object({ revision: revisionSchema, chapter: chapterSchema }),
              "Revision committed",
            ),
            ...errors,
          },
        });
        app.openapi(commitRevision, async (context) =>
          idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.revision.commit",
            {},
            async () => {
              const result = repository.commitRevision(
                context.req.valid("param").id,
                expectedVersion(context.req.raw),
              );
              context.header("etag", `"v${result.revision.version}"`);
              return context.json(result, 200);
            },
          ),
        );

        const discardRevision = createRoute({
          method: "post",
          path: "/api/v2/writing/revisions/{id}/actions/discard",
          request: { params: idParam },
          responses: {
            200: response(revisionSchema, "Revision discarded"),
            ...errors,
          },
        });
        app.openapi(discardRevision, async (context) =>
          idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.revision.discard",
            {},
            async () => {
              const value = repository.discardRevision(
                context.req.valid("param").id,
                expectedVersion(context.req.raw),
              );
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 200);
            },
          ),
        );

        const projectVersions = createRoute({
          method: "get",
          path: "/api/v2/writing/projects/{projectId}/content-versions",
          request: { params: projectParam, query: pageQuerySchema },
          responses: {
            200: response(
              projectContentVersionPageSchema,
              "Project content checkpoints",
            ),
            ...errors,
          },
        });
        app.openapi(projectVersions, (context) => {
          const query = context.req.valid("query");
          const cursor = query.cursor
            ? Number.parseInt(query.cursor, 10)
            : Number.MAX_SAFE_INTEGER;
          if (!Number.isSafeInteger(cursor) || cursor < 1)
            throw new ApiProblem(400, "INVALID_CURSOR", "cursor is invalid");
          const rows = ctx.uow.execute((tx) =>
            tx.all<{
              row_cursor: number;
              id: string;
              chapter_id: string;
              chapter_version: number;
              title: string;
              content: string;
              fields_json: string;
              reason:
                | "manual-save"
                | "agent-commit"
                | "restore-checkpoint"
                | "import";
              created_at: string;
              project_id: string;
              chapter_title: string;
            }>(
              `SELECT versions.rowid AS row_cursor, versions.*, chapters.project_id,
                      chapters.title AS chapter_title
                 FROM writing_chapter_versions AS versions
                 JOIN writing_chapters AS chapters ON chapters.id = versions.chapter_id
                WHERE chapters.project_id = ? AND versions.rowid < ?
                ORDER BY versions.rowid DESC LIMIT ?`,
              context.req.valid("param").projectId,
              cursor,
              query.limit + 1,
            ),
          );
          const visible = rows.slice(0, query.limit);
          return context.json({
            items: visible.map((row) => ({
              id: row.id,
              projectId: row.project_id,
              chapterId: row.chapter_id,
              chapterTitle: row.chapter_title,
              chapterVersion: row.chapter_version,
              title: row.title,
              content: row.content,
              fields: JSON.parse(row.fields_json) as Record<string, string>,
              reason: row.reason,
              createdAt: row.created_at,
            })),
            ...(rows.length > query.limit
              ? { nextCursor: String(visible.at(-1)!.row_cursor) }
              : {}),
          });
        });

        const restoreContentVersion = createRoute({
          method: "post",
          path: "/api/v2/writing/content-versions/{id}/actions/restore",
          request: { params: idParam },
          responses: {
            200: response(chapterSchema, "Content checkpoint restored"),
            ...errors,
          },
        });
        app.openapi(restoreContentVersion, async (context) =>
          idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.content-version.restore",
            {},
            async () => {
              const versionId = context.req.valid("param").id;
              const version = ctx.uow.execute((tx) =>
                tx.get<{ chapter_id: string }>(
                  "SELECT chapter_id FROM writing_chapter_versions WHERE id = ?",
                  versionId,
                ),
              );
              if (!version)
                throw new ApiProblem(
                  404,
                  "CONTENT_VERSION_NOT_FOUND",
                  "content checkpoint does not exist",
                );
              const value = repository.restore(
                version.chapter_id,
                versionId,
                expectedVersion(context.req.raw),
              );
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 200);
            },
          ),
        );

        const listLocalizations = createRoute({
          method: "get",
          path: "/api/v2/writing/localizations",
          request: { query: localizationQuery },
          responses: {
            200: response(localizationPageSchema, "Localization variants"),
            ...errors,
          },
        });
        app.openapi(listLocalizations, (context) => {
          const query = context.req.valid("query");
          const cursor = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
          if (!Number.isSafeInteger(cursor) || cursor < 0)
            throw new ApiProblem(400, "INVALID_CURSOR", "cursor is invalid");
          const rows = ctx.uow.execute((tx) =>
            tx.all<LocalizationRow>(
              `SELECT rowid AS row_cursor, * FROM writing_localizations
                WHERE project_id = ? AND rowid > ?
                ORDER BY rowid LIMIT ?`,
              query.projectId,
              cursor,
              query.limit + 1,
            ),
          );
          const visible = rows.slice(0, query.limit);
          return context.json({
            items: visible.map(localizationJson),
            ...(rows.length > query.limit
              ? { nextCursor: String(visible.at(-1)!.row_cursor) }
              : {}),
          });
        });

        const createLocalization = createRoute({
          method: "post",
          path: "/api/v2/writing/localizations",
          request: {
            body: {
              content: {
                "application/json": { schema: createLocalizationSchema },
              },
            },
          },
          responses: {
            201: response(localizationSchema, "Localization variant created"),
            ...errors,
          },
        });
        app.openapi(createLocalization, async (context) => {
          const input = context.req.valid("json");
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.localization.create",
            input,
            async () => {
              const id = randomUUID();
              const now = new Date().toISOString();
              const row = ctx.uow.execute((tx) => {
                tx.run(
                  `INSERT INTO writing_localizations
                   (id, project_id, source_id, locale, content, version, created_at,
                    updated_at, status, adopted_at)
                   VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'draft', NULL)`,
                  id,
                  input.projectId,
                  input.sourceId,
                  input.locale,
                  input.content,
                  now,
                  now,
                );
                tx.append({
                  type: "writing.localization-created.v1",
                  pluginId: "writing",
                  aggregateType: "localization",
                  aggregateId: id,
                  aggregateVersion: 1,
                  payload: { id, projectId: input.projectId },
                });
                return tx.get<LocalizationRow>(
                  "SELECT rowid AS row_cursor, * FROM writing_localizations WHERE id = ?",
                  id,
                )!;
              });
              context.header("etag", '"v1"');
              context.header("location", `/api/v2/writing/localizations/${id}`);
              return context.json(localizationJson(row), 201);
            },
          );
        });

        const getLocalization = createRoute({
          method: "get",
          path: "/api/v2/writing/localizations/{id}",
          request: { params: idParam },
          responses: {
            200: response(localizationSchema, "Localization variant"),
            ...errors,
          },
        });
        app.openapi(getLocalization, (context) => {
          const row = ctx.uow.execute((tx) =>
            tx.get<LocalizationRow>(
              "SELECT rowid AS row_cursor, * FROM writing_localizations WHERE id = ?",
              context.req.valid("param").id,
            ),
          );
          if (!row)
            throw new ApiProblem(
              404,
              "LOCALIZATION_NOT_FOUND",
              "localization variant does not exist",
            );
          context.header("etag", `"v${row.version}"`);
          return context.json(localizationJson(row));
        });

        const updateLocalization = createRoute({
          method: "patch",
          path: "/api/v2/writing/localizations/{id}",
          request: {
            params: idParam,
            body: {
              content: {
                "application/json": { schema: updateLocalizationSchema },
              },
            },
          },
          responses: {
            200: response(localizationSchema, "Localization variant updated"),
            ...errors,
          },
        });
        app.openapi(updateLocalization, (context) => {
          const id = context.req.valid("param").id;
          const input = context.req.valid("json");
          const version = expectedVersion(context.req.raw);
          const row = ctx.uow.execute((tx) => {
            const current = tx.get<LocalizationRow>(
              "SELECT rowid AS row_cursor, * FROM writing_localizations WHERE id = ?",
              id,
            );
            if (!current)
              throw new ApiProblem(
                404,
                "LOCALIZATION_NOT_FOUND",
                "localization variant does not exist",
              );
            if (current.version !== version)
              throw new ApiProblem(
                412,
                "VERSION_CONFLICT",
                "localization version changed",
              );
            if (current.status !== "draft")
              throw new ApiProblem(
                409,
                "LOCALIZATION_LOCKED",
                "adopted or archived localization cannot be edited",
              );
            const now = new Date().toISOString();
            tx.run(
              `UPDATE writing_localizations
                  SET locale = ?, content = ?, version = version + 1, updated_at = ?
                WHERE id = ? AND version = ?`,
              input.locale ?? current.locale,
              input.content ?? current.content,
              now,
              id,
              version,
            );
            tx.append({
              type: "writing.localization-updated.v1",
              pluginId: "writing",
              aggregateType: "localization",
              aggregateId: id,
              aggregateVersion: version + 1,
              payload: { id },
            });
            return tx.get<LocalizationRow>(
              "SELECT rowid AS row_cursor, * FROM writing_localizations WHERE id = ?",
              id,
            )!;
          });
          context.header("etag", `"v${row.version}"`);
          return context.json(localizationJson(row));
        });

        const removeLocalization = createRoute({
          method: "delete",
          path: "/api/v2/writing/localizations/{id}",
          request: { params: idParam },
          responses: {
            204: { description: "Localization deleted" },
            ...errors,
          },
        });
        app.openapi(removeLocalization, (context) => {
          const id = context.req.valid("param").id;
          const version = expectedVersion(context.req.raw);
          ctx.uow.execute((tx) => {
            const current = tx.get<LocalizationRow>(
              "SELECT rowid AS row_cursor, * FROM writing_localizations WHERE id = ?",
              id,
            );
            if (!current)
              throw new ApiProblem(
                404,
                "LOCALIZATION_NOT_FOUND",
                "localization variant does not exist",
              );
            if (current.version !== version)
              throw new ApiProblem(
                412,
                "VERSION_CONFLICT",
                "localization version changed",
              );
            tx.run("DELETE FROM writing_localizations WHERE id = ?", id);
            tx.append({
              type: "writing.localization-deleted.v1",
              pluginId: "writing",
              aggregateType: "localization",
              aggregateId: id,
              aggregateVersion: version + 1,
              payload: { id, projectId: current.project_id },
            });
          });
          return context.body(null, 204);
        });

        const adoptLocalization = createRoute({
          method: "post",
          path: "/api/v2/writing/localizations/{id}/actions/adopt",
          request: { params: idParam },
          responses: {
            200: response(localizationSchema, "Localization adopted"),
            ...errors,
          },
        });
        app.openapi(adoptLocalization, async (context) =>
          idempotentResponse(
            ctx.uow,
            context.req.raw,
            "writing.localization.adopt",
            {},
            async () => {
              const id = context.req.valid("param").id;
              const version = expectedVersion(context.req.raw);
              const row = ctx.uow.execute((tx) => {
                const current = tx.get<LocalizationRow>(
                  "SELECT rowid AS row_cursor, * FROM writing_localizations WHERE id = ?",
                  id,
                );
                if (!current)
                  throw new ApiProblem(
                    404,
                    "LOCALIZATION_NOT_FOUND",
                    "localization variant does not exist",
                  );
                if (current.version !== version)
                  throw new ApiProblem(
                    412,
                    "VERSION_CONFLICT",
                    "localization version changed",
                  );
                if (!current.content.trim())
                  throw new ApiProblem(
                    409,
                    "LOCALIZATION_EMPTY",
                    "localization content is required before adoption",
                  );
                const now = new Date().toISOString();
                tx.run(
                  `UPDATE writing_localizations
                      SET status = 'archived', version = version + 1, updated_at = ?
                    WHERE project_id = ? AND source_id = ? AND locale = ?
                      AND status = 'adopted' AND id != ?`,
                  now,
                  current.project_id,
                  current.source_id,
                  current.locale,
                  id,
                );
                tx.run(
                  `UPDATE writing_localizations
                      SET status = 'adopted', adopted_at = ?, version = version + 1, updated_at = ?
                    WHERE id = ? AND version = ?`,
                  now,
                  now,
                  id,
                  version,
                );
                tx.append({
                  type: "writing.localization-adopted.v1",
                  pluginId: "writing",
                  aggregateType: "localization",
                  aggregateId: id,
                  aggregateVersion: version + 1,
                  payload: {
                    id,
                    projectId: current.project_id,
                    sourceId: current.source_id,
                    locale: current.locale,
                  },
                });
                return tx.get<LocalizationRow>(
                  "SELECT rowid AS row_cursor, * FROM writing_localizations WHERE id = ?",
                  id,
                )!;
              });
              context.header("etag", `"v${row.version}"`);
              return context.json(localizationJson(row), 200);
            },
          ),
        );

        const exportSubtitles = createRoute({
          method: "get",
          path: "/api/v2/writing/localizations/{id}/subtitles/{format}",
          request: {
            params: z.object({ id: z.uuid(), format: z.enum(["srt", "vtt"]) }),
          },
          responses: {
            200: response(subtitleExportSchema, "Localized subtitles"),
            ...errors,
          },
        });
        app.openapi(exportSubtitles, (context) => {
          const params = context.req.valid("param");
          const row = ctx.uow.execute((tx) =>
            tx.get<LocalizationRow>(
              "SELECT rowid AS row_cursor, * FROM writing_localizations WHERE id = ?",
              params.id,
            ),
          );
          if (!row)
            throw new ApiProblem(
              404,
              "LOCALIZATION_NOT_FOUND",
              "localization variant does not exist",
            );
          if (!row.content.trim())
            throw new ApiProblem(
              409,
              "LOCALIZATION_EMPTY",
              "localization content is required for subtitle export",
            );
          const separator = params.format === "srt" ? "," : ".";
          const lines = row.content
            .split(/\r?\n+/u)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 2_000);
          const cues = lines.map((line, index) => {
            const start = subtitleTimestamp(index * 3, separator);
            const end = subtitleTimestamp(index * 3 + 2.8, separator);
            return params.format === "srt"
              ? `${index + 1}\n${start} --> ${end}\n${line}`
              : `${start} --> ${end}\n${line}`;
          });
          return context.json({
            fileName: `localization-${row.locale}.${params.format}`,
            mimeType:
              params.format === "srt"
                ? ("application/x-subrip" as const)
                : ("text/vtt" as const),
            content: `${params.format === "vtt" ? "WEBVTT\n\n" : ""}${cues.join("\n\n")}\n`,
          });
        });
      },
    };
    ctx.http.register(routes);
  },
};

function writingContext(
  repository: WritingRepository,
  input: ContextRequest,
): readonly ContextFragment[] {
  if (!input.projectId) return [];
  const project = repository.uow.execute((tx) =>
    tx.get<{
      id: string;
      name: string;
      description: string;
      synopsis: string;
      genre: string;
      target_word_count: number;
      version: number;
    }>(
      `SELECT id, name, description, synopsis, genre, target_word_count, version
       FROM workspace_projects WHERE id = ? AND status != 'trashed'`,
      input.projectId,
    ),
  );
  if (!project) return [];
  const chapters = repository.listChapters(
    input.projectId,
    undefined,
    200,
  ).items;
  const fragments: ContextFragment[] = [
    {
      id: `writing:project:${project.id}`,
      pluginId: "writing",
      kind: "project-brief",
      title: "项目创作简报",
      content: JSON.stringify({
        name: project.name,
        description: project.description,
        synopsis: project.synopsis,
        genre: project.genre,
        targetWordCount: project.target_word_count,
      }),
      sourceId: project.id,
      sourceVersion: project.version,
      priority: 100,
      tokenEstimate: 0,
      provenance: "workspace_projects",
    },
  ];
  for (const chapter of chapters) {
    const current = chapter.id === input.chapterId;
    fragments.push({
      id: `writing:chapter:${chapter.id}`,
      pluginId: "writing",
      kind: current ? "current-chapter" : "chapter",
      title: chapter.title,
      content: JSON.stringify({
        title: chapter.title,
        summary: chapter.summary,
        outline: chapter.outline,
        mainConflict: chapter.mainConflict,
        hook: chapter.hook,
        highlight: chapter.highlight,
        reversal: chapter.reversal,
        cliffhanger: chapter.cliffhanger,
        content: current ? chapter.content : chapter.summary || chapter.content,
      }),
      sourceId: chapter.id,
      sourceVersion: chapter.version,
      priority: current ? 1_000 : 60,
      tokenEstimate: 0,
      provenance: "writing_chapters",
    });
  }
  if (input.selection?.trim()) {
    fragments.push({
      id: `writing:selection:${input.chapterId ?? project.id}`,
      pluginId: "writing",
      kind: "selection",
      title: "当前选区",
      content: input.selection,
      sourceId: input.chapterId ?? project.id,
      sourceVersion:
        chapters.find((chapter) => chapter.id === input.chapterId)?.version ??
        project.version,
      priority: 2_000,
      tokenEstimate: 0,
      provenance: "renderer-selection",
    });
  }
  return fragments;
}
