import type { Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import { pageQuerySchema, problemDetailsSchema } from "@dramaip/contracts";
import { createNodeMigration } from "@dramaip/domain-kit";
import { idempotentResponse, requireIfMatch } from "@dramaip/http";
import type {
  ContextFragment,
  ContextRequest,
  MigrationDefinition,
  RouteContribution,
} from "@dramaip/plugin-api";

import {
  applyChangeSetSchema,
  changeSetSchema,
  createChangeSetSchema,
  createKnowledgeRecordSchema,
  importExtractionSchema,
  knowledgeKindSchema,
  knowledgePageSchema,
  knowledgeRecordSchema,
  staleMarkSchema,
  storyBibleSettingsSchema,
  updateKnowledgeRecordSchema,
  type KnowledgeKind,
} from "./contracts.ts";
import {
  KnowledgeRepository,
  knowledgeArchiveContributor,
  knowledgeSourceImportAdopter,
} from "./repository.ts";

const legacyResources = [
  { kind: "character", path: "characters", data: z.object({}) },
  { kind: "outline", path: "outlines", data: z.object({}) },
  { kind: "story-arc", path: "story-arcs", data: z.object({}) },
  { kind: "story-bible", path: "story-bibles", data: z.object({}) },
  { kind: "change-set", path: "change-sets", data: z.object({}) },
] as const;

export const migrations: readonly MigrationDefinition[] = [
  createNodeMigration("knowledge", legacyResources),
  {
    id: "knowledge-0002",
    pluginId: "knowledge",
    version: "2.0.0",
    dependsOn: ["knowledge-0001", "workspace-0002", "writing-0002"],
    sql: `
      CREATE TABLE knowledge_characters (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, data_json TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX knowledge_characters_project_idx ON knowledge_characters (project_id, updated_at);
      CREATE TABLE knowledge_outlines (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, data_json TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX knowledge_outlines_project_idx ON knowledge_outlines (project_id, updated_at);
      CREATE TABLE knowledge_story_arcs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, data_json TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX knowledge_story_arcs_project_idx ON knowledge_story_arcs (project_id, updated_at);
      CREATE TABLE knowledge_story_bibles (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, data_json TEXT NOT NULL, version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX knowledge_story_bibles_project_idx ON knowledge_story_bibles (project_id, updated_at);
      CREATE TABLE knowledge_story_bible_settings (
        project_id TEXT PRIMARY KEY REFERENCES workspace_projects(id) ON DELETE CASCADE,
        auto_suggest INTEGER NOT NULL CHECK (auto_suggest IN (0, 1)),
        version INTEGER NOT NULL CHECK (version > 0), updated_at TEXT NOT NULL
      );
      CREATE TABLE knowledge_change_sets (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        chapter_id TEXT REFERENCES writing_chapters(id) ON DELETE SET NULL,
        rationale TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'paused', 'skipped', 'applied', 'undone', 'discarded')),
        version INTEGER NOT NULL CHECK (version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX knowledge_change_sets_project_idx ON knowledge_change_sets (project_id, created_at);
      CREATE TABLE knowledge_change_set_items (
        id TEXT PRIMARY KEY, change_set_id TEXT NOT NULL REFERENCES knowledge_change_sets(id) ON DELETE CASCADE,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('character', 'outline', 'story-arc', 'story-bible')),
        target_id TEXT, operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
        base_version INTEGER, title TEXT NOT NULL, patch_json TEXT NOT NULL,
        before_json TEXT, applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1))
      );
      CREATE TABLE knowledge_stale_marks (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL, source_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE knowledge_import_extractions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        source_import_id TEXT NOT NULL REFERENCES workspace_source_imports(id) ON DELETE CASCADE,
        candidate_json TEXT NOT NULL, created_resource_ids_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
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

function version(request: Request): number {
  const value = request.headers.get("if-match");
  if (!value) {
    requireIfMatch(request, 0);
    return 0;
  }
  return Number(/^"v(\d+)"$/.exec(value)?.[1] ?? Number.NaN);
}

const paths: ReadonlyArray<{ kind: KnowledgeKind; path: string }> = [
  { kind: "character", path: "characters" },
  { kind: "outline", path: "outlines" },
  { kind: "story-arc", path: "story-arcs" },
  { kind: "story-bible", path: "story-bibles" },
];

export const knowledgeServer: Plugin = {
  name: "dramaip-knowledge",
  inject: ["http", "uow", "workspaceExtensions", "automationRuntime"],
  apply(ctx) {
    const repository = new KnowledgeRepository(ctx.uow);
    ctx.workspaceExtensions.registerSourceImportAdopter(
      knowledgeSourceImportAdopter(repository),
    );
    ctx.workspaceExtensions.registerArchiveContributor(
      knowledgeArchiveContributor(repository),
    );
    ctx.automationRuntime.registerContextProvider({
      id: "knowledge.context",
      pluginId: "knowledge",
      provide: (input) => knowledgeContext(repository, input),
    });
    for (const kind of knowledgeKindSchema.options) {
      ctx.automationRuntime.registerChangeTarget({
        kind: `knowledge.${kind}`,
        pluginId: "knowledge",
        apply(tx, target) {
          repository.updateTx(
            tx,
            kind,
            target.targetId,
            target.baseVersion,
            updateKnowledgeRecordSchema.parse(target.patch),
          );
        },
      });
      ctx.automationRuntime.registerChangeTarget({
        kind: `knowledge.${kind}.create`,
        pluginId: "knowledge",
        apply(tx, target) {
          if (target.baseVersion !== 0)
            throw new Error("knowledge create target must use baseVersion 0");
          const input = createKnowledgeRecordSchema
            .omit({ projectId: true })
            .parse(target.patch);
          const projectId = tx.get<{ project_id: string }>(
            "SELECT project_id FROM automation_change_previews WHERE id = (SELECT preview_id FROM automation_change_preview_targets WHERE id = ?)",
            target.id,
          )?.project_id;
          if (!projectId)
            throw new Error("knowledge create preview project is unavailable");
          repository.createTx(
            tx,
            kind,
            { projectId, title: input.title, data: input.data },
            target.targetId,
          );
        },
      });
    }
    const routes: RouteContribution = {
      id: "knowledge.http.v2",
      pluginId: "knowledge",
      install(app) {
        for (const definition of paths)
          installRecordRoutes(
            app as never,
            repository,
            definition.kind,
            definition.path,
          );

        const getSettings = createRoute({
          method: "get",
          path: "/api/v2/knowledge/projects/{projectId}/story-bible/settings",
          request: { params: z.object({ projectId: z.uuid() }) },
          responses: {
            200: response(storyBibleSettingsSchema, "Story Bible settings"),
            ...errors,
          },
        });
        app.openapi(getSettings, (context) => {
          const value = repository.settings(
            context.req.valid("param").projectId,
          );
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });
        const updateSettings = createRoute({
          method: "put",
          path: "/api/v2/knowledge/projects/{projectId}/story-bible/settings",
          request: {
            params: z.object({ projectId: z.uuid() }),
            body: {
              content: {
                "application/json": {
                  schema: z.object({ autoSuggest: z.boolean() }).strict(),
                },
              },
            },
          },
          responses: {
            200: response(
              storyBibleSettingsSchema,
              "Story Bible settings updated",
            ),
            ...errors,
          },
        });
        app.openapi(updateSettings, (context) => {
          const value = repository.updateSettings(
            context.req.valid("param").projectId,
            version(context.req.raw),
            context.req.valid("json").autoSuggest,
          );
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });

        const listChangeSets = createRoute({
          method: "get",
          path: "/api/v2/knowledge/projects/{projectId}/story-bible/change-sets",
          request: { params: z.object({ projectId: z.uuid() }) },
          responses: {
            200: response(
              z.object({ items: z.array(changeSetSchema) }),
              "Story Bible change sets",
            ),
            ...errors,
          },
        });
        app.openapi(listChangeSets, (context) =>
          context.json({
            items: repository.listChangeSets(
              context.req.valid("param").projectId,
            ),
          }),
        );
        const createChangeSet = createRoute({
          method: "post",
          path: "/api/v2/knowledge/change-sets",
          request: {
            body: {
              content: {
                "application/json": { schema: createChangeSetSchema },
              },
            },
          },
          responses: {
            201: response(changeSetSchema, "Change set created"),
            ...errors,
          },
        });
        app.openapi(createChangeSet, async (context) => {
          const input = context.req.valid("json");
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            "knowledge.change-set.create",
            input,
            async () => {
              const value = repository.createChangeSet(input);
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 201);
            },
          );
        });
        const getChangeSet = createRoute({
          method: "get",
          path: "/api/v2/knowledge/change-sets/{id}",
          request: { params: z.object({ id: z.uuid() }) },
          responses: {
            200: response(changeSetSchema, "Change set"),
            ...errors,
          },
        });
        app.openapi(getChangeSet, (context) => {
          const value = repository.getChangeSet(context.req.valid("param").id);
          context.header("etag", `"v${value.version}"`);
          return context.json(value);
        });
        const apply = createRoute({
          method: "post",
          path: "/api/v2/knowledge/change-sets/{id}/actions/apply",
          request: {
            params: z.object({ id: z.uuid() }),
            body: {
              content: { "application/json": { schema: applyChangeSetSchema } },
            },
          },
          responses: {
            200: response(changeSetSchema, "Change set applied"),
            ...errors,
          },
        });
        app.openapi(apply, async (context) => {
          const input = context.req.valid("json");
          return idempotentResponse(
            ctx.uow,
            context.req.raw,
            "knowledge.change-set.apply",
            input,
            async () => {
              const value = repository.applyChangeSet(
                context.req.valid("param").id,
                version(context.req.raw),
                input.selectedItemIds,
              );
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 200);
            },
          );
        });
        const undo = createRoute({
          method: "post",
          path: "/api/v2/knowledge/change-sets/{id}/actions/undo",
          request: { params: z.object({ id: z.uuid() }) },
          responses: {
            200: response(changeSetSchema, "Change set undone"),
            ...errors,
          },
        });
        app.openapi(undo, async (context) =>
          idempotentResponse(
            ctx.uow,
            context.req.raw,
            "knowledge.change-set.undo",
            {},
            async () => {
              const value = repository.undoChangeSet(
                context.req.valid("param").id,
                version(context.req.raw),
              );
              context.header("etag", `"v${value.version}"`);
              return context.json(value, 200);
            },
          ),
        );
        const stale = createRoute({
          method: "get",
          path: "/api/v2/knowledge/projects/{projectId}/story-bible/stale",
          request: { params: z.object({ projectId: z.uuid() }) },
          responses: {
            200: response(
              z.object({ items: z.array(staleMarkSchema) }),
              "Stale marks",
            ),
            ...errors,
          },
        });
        app.openapi(stale, (context) =>
          context.json({
            items: repository.stale(context.req.valid("param").projectId),
          }),
        );

        const adoptExtraction = createRoute({
          method: "post",
          path: "/api/v2/knowledge/import-extractions/{id}/actions/adopt",
          request: { params: z.object({ id: z.uuid() }) },
          responses: {
            200: response(importExtractionSchema, "Import extraction adopted"),
            ...errors,
          },
        });
        app.openapi(adoptExtraction, async (context) =>
          idempotentResponse(
            ctx.uow,
            context.req.raw,
            "knowledge.import-extraction.adopt",
            {},
            async () =>
              context.json(
                repository.importExtraction(context.req.valid("param").id),
                200,
              ),
          ),
        );
      },
    };
    ctx.http.register(routes);
  },
};

function knowledgeContext(
  repository: KnowledgeRepository,
  input: ContextRequest,
): readonly ContextFragment[] {
  if (!input.projectId) return [];
  const priorities: Record<KnowledgeKind, number> = {
    character: 300,
    outline: 400,
    "story-arc": 350,
    "story-bible": 500,
  };
  return knowledgeKindSchema.options.flatMap((kind) =>
    repository
      .list(kind, input.projectId!, undefined, 200)
      .items.map((record) => ({
        id: `knowledge:${kind}:${record.id}`,
        pluginId: "knowledge",
        kind,
        title: record.title,
        content: JSON.stringify(record.data),
        sourceId: record.id,
        sourceVersion: record.version,
        priority: priorities[kind],
        tokenEstimate: 0,
        provenance: `knowledge_${kind.replaceAll("-", "_")}s`,
      })),
  ) satisfies readonly ContextFragment[];
}

function installRecordRoutes(
  app: any,
  repository: KnowledgeRepository,
  kind: KnowledgeKind,
  path: string,
): void {
  const base = `/api/v2/knowledge/${path}`;
  const list = createRoute({
    method: "get",
    path: base,
    request: { query: pageQuerySchema.extend({ projectId: z.uuid() }) },
    responses: {
      200: response(knowledgePageSchema, `${kind} list`),
      ...errors,
    },
  });
  app.openapi(list, (context: any) => {
    const query = context.req.valid("query");
    return context.json(
      repository.list(kind, query.projectId, query.cursor, query.limit),
    );
  });
  const create = createRoute({
    method: "post",
    path: base,
    request: {
      body: {
        content: {
          "application/json": { schema: createKnowledgeRecordSchema },
        },
      },
    },
    responses: {
      201: response(knowledgeRecordSchema, `${kind} created`),
      ...errors,
    },
  });
  app.openapi(create, (context: any) => {
    const value = repository.create(kind, context.req.valid("json"));
    context.header("etag", `"v${value.version}"`);
    return context.json(value, 201);
  });
  const get = createRoute({
    method: "get",
    path: `${base}/{id}`,
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 200: response(knowledgeRecordSchema, kind), ...errors },
  });
  app.openapi(get, (context: any) => {
    const value = repository.get(kind, context.req.valid("param").id);
    context.header("etag", `"v${value.version}"`);
    return context.json(value);
  });
  const update = createRoute({
    method: "patch",
    path: `${base}/{id}`,
    request: {
      params: z.object({ id: z.uuid() }),
      body: {
        content: {
          "application/json": { schema: updateKnowledgeRecordSchema },
        },
      },
    },
    responses: {
      200: response(knowledgeRecordSchema, `${kind} updated`),
      ...errors,
    },
  });
  app.openapi(update, (context: any) => {
    const value = repository.update(
      kind,
      context.req.valid("param").id,
      version(context.req.raw),
      context.req.valid("json"),
    );
    context.header("etag", `"v${value.version}"`);
    return context.json(value);
  });
  const remove = createRoute({
    method: "delete",
    path: `${base}/{id}`,
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 204: { description: `${kind} deleted` }, ...errors },
  });
  app.openapi(remove, (context: any) => {
    repository.remove(
      kind,
      context.req.valid("param").id,
      version(context.req.raw),
    );
    return context.body(null, 204);
  });
}
