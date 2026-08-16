import { readFile } from "node:fs/promises";

import type { Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import { pageQuerySchema, problemDetailsSchema } from "@dramaip/contracts";
import { ApiProblem, idempotentResponse, requireIfMatch } from "@dramaip/http";
import type {
  MigrationDefinition,
  RouteContribution,
} from "@dramaip/plugin-api";

import {
  commitSourceImportSchema,
  createProjectSchema,
  createSeriesSchema,
  previewProjectPackageSchema,
  previewSourceImportSchema,
  projectPackagePreviewSchema,
  projectPackageSchema,
  projectPageSchema,
  projectSchema,
  seriesPageSchema,
  seriesSchema,
  sourceImportCommitResultSchema,
  sourceImportPreviewSchema,
  updateProjectSchema,
  updateSeriesSchema,
} from "./contracts.ts";
import { WorkspaceRepository } from "./repository.ts";
import type { FileCapabilityResolver } from "./services.ts";
import {
  FileCapabilityAccessService,
  WorkspaceExtensionRegistryService,
} from "./services.ts";
import { parseSourceImport } from "./source-import.ts";

export const migrations: readonly MigrationDefinition[] = [
  {
    id: "workspace-0001",
    pluginId: "workspace",
    version: "1.0.0",
    dependsOn: ["foundation-0001"],
    sql: `
      CREATE TABLE workspace_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('active', 'archived', 'trashed')),
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX workspace_projects_status_idx ON workspace_projects (status, updated_at);
      CREATE TABLE workspace_series (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX workspace_series_project_idx ON workspace_series (project_id, updated_at);
    `,
  },
  {
    id: "workspace-0002",
    pluginId: "workspace",
    version: "2.0.0",
    dependsOn: ["workspace-0001"],
    sql: `
      ALTER TABLE workspace_projects ADD COLUMN synopsis TEXT NOT NULL DEFAULT '';
      ALTER TABLE workspace_projects ADD COLUMN genre TEXT NOT NULL DEFAULT '都市情感';
      ALTER TABLE workspace_projects ADD COLUMN creation_mode TEXT NOT NULL DEFAULT 'inspiration'
        CHECK (creation_mode IN ('inspiration', 'source-import', 'script-import'));
      ALTER TABLE workspace_projects ADD COLUMN target_word_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspace_projects ADD COLUMN target_episode_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspace_projects ADD COLUMN initial_script TEXT;

      CREATE TABLE workspace_source_imports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        preview_json TEXT NOT NULL,
        selected_candidate_ids_json TEXT NOT NULL DEFAULT '[]',
        created_resource_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('preview', 'committed', 'discarded', 'undone')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX workspace_source_imports_project_idx
        ON workspace_source_imports (project_id, created_at);

      CREATE TABLE workspace_package_previews (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        package_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('preview', 'committed', 'discarded')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `,
  },
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
const idParam = z.object({ id: z.uuid() });

function versionFromRequest(request: Request): number {
  const value = request.headers.get("if-match");
  if (!value) {
    requireIfMatch(request, 0);
    return 0;
  }
  return Number(/^"v(\d+)"$/.exec(value)?.[1] ?? Number.NaN);
}

export function createWorkspaceServer(
  capabilityResolver: FileCapabilityResolver,
): Plugin {
  return {
    name: "dramaip-workspace",
    provide: ["workspaceExtensions", "fileCapabilities"],
    inject: ["http", "uow"],
    apply(ctx) {
      const extensions = new WorkspaceExtensionRegistryService(ctx);
      new FileCapabilityAccessService(ctx, capabilityResolver);
      const repository = new WorkspaceRepository(ctx.uow, extensions);
      const contribution: RouteContribution = {
        id: "workspace.http.v2",
        pluginId: "workspace",
        install(app) {
          const listProjects = createRoute({
            method: "get",
            path: "/api/v2/workspace/projects",
            request: {
              query: pageQuerySchema.extend({
                status: z.enum(["active", "archived"]).optional(),
              }),
            },
            responses: {
              200: jsonResponse(projectPageSchema, "Projects"),
              ...errors,
            },
          });
          app.openapi(listProjects, (context) => {
            const query = context.req.valid("query");
            return context.json(
              repository.listProjects(
                query.cursor,
                query.limit,
                query.status ?? "active",
              ),
            );
          });

          const trash = createRoute({
            method: "get",
            path: "/api/v2/workspace/projects/trash",
            request: { query: pageQuerySchema },
            responses: {
              200: jsonResponse(projectPageSchema, "Trashed projects"),
              ...errors,
            },
          });
          app.openapi(trash, (context) => {
            const query = context.req.valid("query");
            return context.json(
              repository.listProjects(query.cursor, query.limit, "trashed"),
            );
          });

          const createProject = createRoute({
            method: "post",
            path: "/api/v2/workspace/projects",
            request: {
              body: {
                content: {
                  "application/json": { schema: createProjectSchema },
                },
              },
            },
            responses: {
              201: jsonResponse(projectSchema, "Project created"),
              ...errors,
            },
          });
          app.openapi(createProject, (context) => {
            const project = repository.createProject(context.req.valid("json"));
            context.header("etag", `"v${project.version}"`);
            context.header(
              "location",
              `/api/v2/workspace/projects/${project.id}`,
            );
            return context.json(project, 201);
          });

          const getProject = createRoute({
            method: "get",
            path: "/api/v2/workspace/projects/{id}",
            request: { params: idParam },
            responses: {
              200: jsonResponse(projectSchema, "Project"),
              ...errors,
            },
          });
          app.openapi(getProject, (context) => {
            const project = repository.getProject(
              context.req.valid("param").id,
            );
            context.header("etag", `"v${project.version}"`);
            return context.json(project);
          });

          const updateProject = createRoute({
            method: "patch",
            path: "/api/v2/workspace/projects/{id}",
            request: {
              params: idParam,
              body: {
                content: {
                  "application/json": { schema: updateProjectSchema },
                },
              },
            },
            responses: {
              200: jsonResponse(projectSchema, "Project updated"),
              ...errors,
            },
          });
          app.openapi(updateProject, (context) => {
            const project = repository.updateProject(
              context.req.valid("param").id,
              versionFromRequest(context.req.raw),
              context.req.valid("json"),
            );
            context.header("etag", `"v${project.version}"`);
            return context.json(project);
          });

          const deleteProject = createRoute({
            method: "delete",
            path: "/api/v2/workspace/projects/{id}",
            request: { params: idParam },
            responses: {
              204: { description: "Project moved to trash" },
              ...errors,
            },
          });
          app.openapi(deleteProject, (context) => {
            repository.setProjectStatus(
              context.req.valid("param").id,
              versionFromRequest(context.req.raw),
              "trashed",
            );
            return context.body(null, 204);
          });

          const restore = createRoute({
            method: "post",
            path: "/api/v2/workspace/projects/{id}/actions/restore",
            request: { params: idParam },
            responses: {
              200: jsonResponse(projectSchema, "Project restored"),
              ...errors,
            },
          });
          app.openapi(restore, async (context) =>
            idempotentResponse(
              ctx.uow,
              context.req.raw,
              "workspace.project.restore",
              {},
              async () => {
                const project = repository.setProjectStatus(
                  context.req.valid("param").id,
                  versionFromRequest(context.req.raw),
                  "active",
                );
                context.header("etag", `"v${project.version}"`);
                return context.json(project, 200);
              },
            ),
          );

          const purge = createRoute({
            method: "post",
            path: "/api/v2/workspace/projects/{id}/actions/purge",
            request: {
              params: idParam,
              body: {
                content: {
                  "application/json": {
                    schema: z.object({ confirmation: z.string() }).strict(),
                  },
                },
              },
            },
            responses: {
              204: { description: "Project permanently deleted" },
              ...errors,
            },
          });
          app.openapi(purge, async (context) =>
            idempotentResponse(
              ctx.uow,
              context.req.raw,
              "workspace.project.purge",
              context.req.valid("json"),
              async () => {
                repository.purgeProject(
                  context.req.valid("param").id,
                  versionFromRequest(context.req.raw),
                  context.req.valid("json").confirmation,
                );
                return context.body(null, 204);
              },
            ),
          );

          const previewImport = createRoute({
            method: "post",
            path: "/api/v2/workspace/source-imports/actions/preview",
            request: {
              body: {
                content: {
                  "application/json": { schema: previewSourceImportSchema },
                },
              },
            },
            responses: {
              201: jsonResponse(
                sourceImportPreviewSchema,
                "Source import preview",
              ),
              ...errors,
            },
          });
          app.openapi(previewImport, async (context) => {
            const input = context.req.valid("json");
            const capability = await capabilityResolver.resolve(
              input.capability,
            );
            if (!capability)
              throw new ApiProblem(
                404,
                "FILE_CAPABILITY_NOT_FOUND",
                "file capability is invalid or expired",
              );
            const preview = parseSourceImport(
              input.projectId,
              capability.name,
              await readFile(capability.path),
            );
            repository.saveSourceImport(preview);
            context.header(
              "location",
              `/api/v2/workspace/source-imports/${preview.id}`,
            );
            return context.json(preview, 201);
          });

          const getImport = createRoute({
            method: "get",
            path: "/api/v2/workspace/source-imports/{id}",
            request: { params: idParam },
            responses: {
              200: jsonResponse(sourceImportPreviewSchema, "Source import"),
              ...errors,
            },
          });
          app.openapi(getImport, (context) =>
            context.json(
              repository.getSourceImport(context.req.valid("param").id),
            ),
          );

          const commitImport = createRoute({
            method: "post",
            path: "/api/v2/workspace/source-imports/{id}/actions/commit",
            request: {
              params: idParam,
              body: {
                content: {
                  "application/json": { schema: commitSourceImportSchema },
                },
              },
            },
            responses: {
              200: jsonResponse(
                sourceImportCommitResultSchema,
                "Source import committed",
              ),
              ...errors,
            },
          });
          app.openapi(commitImport, async (context) => {
            const input = context.req.valid("json");
            return idempotentResponse(
              ctx.uow,
              context.req.raw,
              "workspace.source-import.commit",
              input,
              async () =>
                context.json(
                  repository.commitSourceImport(
                    context.req.valid("param").id,
                    input.selectedCandidateIds,
                  ),
                  200,
                ),
            );
          });

          const undoImport = createRoute({
            method: "post",
            path: "/api/v2/workspace/source-imports/{id}/actions/undo",
            request: { params: idParam },
            responses: {
              200: jsonResponse(
                sourceImportPreviewSchema,
                "Source import undone",
              ),
              ...errors,
            },
          });
          app.openapi(undoImport, async (context) =>
            idempotentResponse(
              ctx.uow,
              context.req.raw,
              "workspace.source-import.undo",
              {},
              async () =>
                context.json(
                  repository.undoSourceImport(context.req.valid("param").id),
                  200,
                ),
            ),
          );

          const exportProject = createRoute({
            method: "get",
            path: "/api/v2/workspace/projects/{id}/exports/{format}",
            request: {
              params: z.object({
                id: z.uuid(),
                format: z.literal("project-package"),
              }),
            },
            responses: {
              200: jsonResponse(
                projectPackageSchema,
                "Portable project package",
              ),
              ...errors,
            },
          });
          app.openapi(exportProject, (context) => {
            const value = repository.exportProject(
              context.req.valid("param").id,
            );
            context.header(
              "content-disposition",
              `attachment; filename="${value.project.id}.dramaip-next.json"`,
            );
            return context.json(value);
          });

          const previewPackage = createRoute({
            method: "post",
            path: "/api/v2/workspace/project-packages/actions/preview",
            request: {
              body: {
                content: {
                  "application/json": { schema: previewProjectPackageSchema },
                },
              },
            },
            responses: {
              201: jsonResponse(
                projectPackagePreviewSchema,
                "Project package preview",
              ),
              ...errors,
            },
          });
          app.openapi(previewPackage, async (context) => {
            const capability = await capabilityResolver.resolve(
              context.req.valid("json").capability,
            );
            if (!capability)
              throw new ApiProblem(
                404,
                "FILE_CAPABILITY_NOT_FOUND",
                "file capability is invalid or expired",
              );
            const value = projectPackageSchema.parse(
              JSON.parse(await readFile(capability.path, "utf8")),
            );
            return context.json(
              repository.savePackagePreview(capability.name, value),
              201,
            );
          });

          const commitPackage = createRoute({
            method: "post",
            path: "/api/v2/workspace/project-packages/{id}/actions/commit",
            request: {
              params: idParam,
              body: {
                content: {
                  "application/json": {
                    schema: z
                      .object({
                        name: z.string().trim().min(1).max(200).optional(),
                      })
                      .strict(),
                  },
                },
              },
            },
            responses: {
              201: jsonResponse(projectSchema, "Project package imported"),
              ...errors,
            },
          });
          app.openapi(commitPackage, async (context) => {
            const input = context.req.valid("json");
            return idempotentResponse(
              ctx.uow,
              context.req.raw,
              "workspace.project-package.commit",
              input,
              async () => {
                const project = repository.commitPackage(
                  context.req.valid("param").id,
                  input.name,
                );
                context.header("etag", `"v${project.version}"`);
                return context.json(project, 201);
              },
            );
          });

          installSeriesRoutes(app, repository);
        },
      };
      ctx.http.register(contribution);
    },
  };
}

function installSeriesRoutes(app: any, repository: WorkspaceRepository): void {
  const list = createRoute({
    method: "get",
    path: "/api/v2/workspace/series",
    request: {
      query: pageQuerySchema.extend({ projectId: z.uuid().optional() }),
    },
    responses: { 200: jsonResponse(seriesPageSchema, "Series"), ...errors },
  });
  app.openapi(list, (context: any) => {
    const query = context.req.valid("query");
    return context.json(
      repository.listSeries(query.projectId, query.cursor, query.limit),
    );
  });
  const create = createRoute({
    method: "post",
    path: "/api/v2/workspace/series",
    request: {
      body: { content: { "application/json": { schema: createSeriesSchema } } },
    },
    responses: { 201: jsonResponse(seriesSchema, "Series created"), ...errors },
  });
  app.openapi(create, (context: any) => {
    const value = repository.createSeries(context.req.valid("json"));
    context.header("etag", `"v${value.version}"`);
    return context.json(value, 201);
  });
  const get = createRoute({
    method: "get",
    path: "/api/v2/workspace/series/{id}",
    request: { params: idParam },
    responses: { 200: jsonResponse(seriesSchema, "Series"), ...errors },
  });
  app.openapi(get, (context: any) => {
    const value = repository.getSeries(context.req.valid("param").id);
    context.header("etag", `"v${value.version}"`);
    return context.json(value);
  });
  const update = createRoute({
    method: "patch",
    path: "/api/v2/workspace/series/{id}",
    request: {
      params: idParam,
      body: { content: { "application/json": { schema: updateSeriesSchema } } },
    },
    responses: { 200: jsonResponse(seriesSchema, "Series updated"), ...errors },
  });
  app.openapi(update, (context: any) => {
    const value = repository.updateSeries(
      context.req.valid("param").id,
      versionFromRequest(context.req.raw),
      context.req.valid("json"),
    );
    context.header("etag", `"v${value.version}"`);
    return context.json(value);
  });
  const remove = createRoute({
    method: "delete",
    path: "/api/v2/workspace/series/{id}",
    request: { params: idParam },
    responses: { 204: { description: "Series deleted" }, ...errors },
  });
  app.openapi(remove, (context: any) => {
    repository.deleteSeries(
      context.req.valid("param").id,
      versionFromRequest(context.req.raw),
    );
    return context.body(null, 204);
  });
}
