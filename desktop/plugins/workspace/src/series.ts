import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  ProjectSeriesInputSchema,
  SeriesAssetLinkSchema,
  SeriesAssetTransferInputSchema,
  SeriesInputSchema,
  SeriesSchema,
  SeriesStoryBibleInputSchema,
  SeriesStoryBibleOverrideInputSchema,
  SeriesStoryBibleSchema,
  SeriesStoryBibleUpgradeInputSchema,
  WORKSPACE_PROJECT_SERVICE,
  type WorkspaceProjectService,
} from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface SeriesRow {
  id: string;
  title: string;
  description: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface StoryBibleRow {
  id: string;
  series_id: string;
  title: string;
  payload_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface OverrideRow {
  id: string;
  project_id: string;
  source_id: string;
  title: string;
  payload_json: string;
  source_version: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface AssetLinkRow {
  id: string;
  series_id: string;
  source_asset_id: string;
  source_version: number;
  target_project_id: string;
  target_asset_id: string;
  mode: "copy" | "fork" | "link";
  created_at: string;
  updated_at: string;
}

interface RouteContext {
  req: {
    param(name: string): string;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
}

type Handler = (context: RouteContext) => Response | Promise<Response>;

function api(input: {
  method: "get" | "post" | "put";
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
    tags: ["series"],
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
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  declaration: unknown,
  handler: Handler,
): RouteContribution {
  return defineRouteContribution({ ...metadata, declaration, handler });
}

function issue(
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

function series(row: SeriesRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function storyBible(row: StoryBibleRow, override?: OverrideRow) {
  const source = override ?? row;
  return {
    id: row.id,
    seriesId: row.series_id,
    title: source.title,
    payload: JSON.parse(source.payload_json),
    version: source.version,
    overridden: Boolean(override),
    sourceVersion: override?.source_version ?? row.version,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  };
}

function assetLink(row: AssetLinkRow) {
  return {
    id: row.id,
    seriesId: row.series_id,
    sourceAssetId: row.source_asset_id,
    sourceVersion: row.source_version,
    targetProjectId: row.target_project_id,
    targetAssetId: row.target_asset_id,
    mode: row.mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function emit(
  transaction: UnitOfWorkTransaction,
  type: string,
  aggregateId: string,
  version: number,
  payload: unknown,
): void {
  transaction.append({
    type: `workspace.${type}.v1`,
    pluginId: "workspace",
    aggregateType: type.split("-")[0]!,
    aggregateId,
    aggregateVersion: version,
    payload: JSON.parse(JSON.stringify(payload)),
  });
}

const seriesLibrarySchema = z.object({
  projectId: z.string().uuid(),
  series: SeriesSchema.optional(),
  storyBible: z.array(SeriesStoryBibleSchema),
  assets: z.array(SeriesAssetLinkSchema),
});

export function seriesRoutes(
  context: PluginContext,
): readonly RouteContribution[] {
  const workspace = context.services.optional<WorkspaceProjectService>(
    WORKSPACE_PROJECT_SERVICE,
  );
  if (!workspace) throw new Error("series requires workspace.projects.v1");
  const now = () => new Date().toISOString();
  const id = z.object({ id: z.string().uuid() });
  const seriesId = z.object({ seriesId: z.string().uuid() });
  const projectStory = z.object({
    projectId: z.string().uuid(),
    id: z.string().uuid(),
  });
  const getSeries = (transaction: UnitOfWorkTransaction, value: string) =>
    transaction.get<SeriesRow>("SELECT * FROM series WHERE id = ?", value);

  return [
    contribute(
      {
        id: "workspace:series-list",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/series",
        operationId: "series.list",
      },
      api({
        method: "get",
        path: "/api/v2/series",
        operationId: "series.list",
        response: z.array(SeriesSchema),
      }),
      (requestContext) =>
        requestContext.json(
          context.uow.execute((transaction) =>
            transaction
              .all<SeriesRow>("SELECT * FROM series ORDER BY updated_at DESC")
              .map(series),
          ),
        ),
    ),
    contribute(
      {
        id: "workspace:series-create",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/series",
        operationId: "series.create",
      },
      api({
        method: "post",
        path: "/api/v2/series",
        operationId: "series.create",
        body: SeriesInputSchema,
        response: SeriesSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = SeriesInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return issue(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "系列名称不能为空。",
          );
        const created = context.uow.execute((transaction) => {
          const valueId = crypto.randomUUID();
          const timestamp = now();
          transaction.run(
            "INSERT INTO series(id, title, description, version, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
            valueId,
            parsed.data.title.trim(),
            parsed.data.description ?? "",
            timestamp,
            timestamp,
          );
          const value = series(getSeries(transaction, valueId)!);
          emit(transaction, "series-created", valueId, 0, value);
          return value;
        });
        return requestContext.json(created, 201);
      },
    ),
    contribute(
      {
        id: "workspace:series-library",
        pluginId: "workspace",
        method: "get",
        path: "/api/v2/projects/{id}/series-library",
        operationId: "series.library",
      },
      api({
        method: "get",
        path: "/api/v2/projects/{id}/series-library",
        operationId: "series.library",
        params: id,
        response: seriesLibrarySchema,
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        if (!workspace.get(projectId))
          return issue(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(
          context.uow.execute((transaction) => {
            const membership = transaction.get<{ series_id: string }>(
              "SELECT series_id FROM project_series WHERE project_id = ?",
              projectId,
            );
            const seriesRow = membership
              ? getSeries(transaction, membership.series_id)
              : undefined;
            const books = seriesRow
              ? transaction.all<StoryBibleRow>(
                  "SELECT * FROM series_story_bible WHERE series_id = ? ORDER BY updated_at DESC",
                  seriesRow.id,
                )
              : [];
            return {
              projectId,
              ...(seriesRow ? { series: series(seriesRow) } : {}),
              storyBible: books.map((book) =>
                storyBible(
                  book,
                  transaction.get<OverrideRow>(
                    "SELECT * FROM series_story_bible_overrides WHERE project_id = ? AND source_id = ?",
                    projectId,
                    book.id,
                  ),
                ),
              ),
              assets: transaction
                .all<AssetLinkRow>(
                  "SELECT * FROM series_asset_links WHERE target_project_id = ? ORDER BY created_at DESC",
                  projectId,
                )
                .map(assetLink),
            };
          }),
        );
      },
    ),
    contribute(
      {
        id: "workspace:series-set-project",
        pluginId: "workspace",
        method: "put",
        path: "/api/v2/projects/{id}/series",
        operationId: "series.setProjectSeries",
      },
      api({
        method: "put",
        path: "/api/v2/projects/{id}/series",
        operationId: "series.setProjectSeries",
        params: id,
        body: ProjectSeriesInputSchema,
        response: z.record(z.string(), z.unknown()),
      }),
      async (requestContext) => {
        const projectId = requestContext.req.param("id");
        const parsed = ProjectSeriesInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return issue(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "系列设置无效。",
          );
        if (!workspace.get(projectId))
          return issue(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const changed = context.uow.execute((transaction) => {
          if (
            parsed.data.seriesId &&
            !getSeries(transaction, parsed.data.seriesId)
          )
            return false;
          transaction.run(
            "DELETE FROM project_series WHERE project_id = ?",
            projectId,
          );
          if (parsed.data.seriesId)
            transaction.run(
              "INSERT INTO project_series(project_id, series_id, joined_at) VALUES (?, ?, ?)",
              projectId,
              parsed.data.seriesId,
              now(),
            );
          transaction.run(
            "UPDATE projects SET version = version + 1, updated_at = ? WHERE id = ?",
            now(),
            projectId,
          );
          const value = transaction.get<{ version: number }>(
            "SELECT version FROM projects WHERE id = ?",
            projectId,
          );
          emit(
            transaction,
            "project-series-updated",
            projectId,
            value?.version ?? 0,
            { projectId, seriesId: parsed.data.seriesId ?? null },
          );
          return true;
        });
        if (!changed)
          return issue(requestContext, 404, "NOT_FOUND", "未找到系列。");
        return requestContext.json(
          workspace.get(projectId, { includeDeleted: true }),
        );
      },
    ),
    contribute(
      {
        id: "workspace:series-story-bible-create",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/series/{seriesId}/story-bible",
        operationId: "series.createStoryBible",
      },
      api({
        method: "post",
        path: "/api/v2/series/{seriesId}/story-bible",
        operationId: "series.createStoryBible",
        params: seriesId,
        body: SeriesStoryBibleInputSchema,
        response: SeriesStoryBibleSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = SeriesStoryBibleInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const valueSeriesId = requestContext.req.param("seriesId");
        if (!parsed.success)
          return issue(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "系列资料无效。",
          );
        const created = context.uow.execute((transaction) => {
          if (!getSeries(transaction, valueSeriesId)) return undefined;
          const valueId = crypto.randomUUID();
          const timestamp = now();
          transaction.run(
            "INSERT INTO series_story_bible(id, series_id, title, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)",
            valueId,
            valueSeriesId,
            parsed.data.title,
            JSON.stringify(parsed.data.payload),
            timestamp,
            timestamp,
          );
          const value = storyBible(
            transaction.get<StoryBibleRow>(
              "SELECT * FROM series_story_bible WHERE id = ?",
              valueId,
            )!,
          );
          emit(transaction, "series-story-bible-created", valueId, 0, value);
          return value;
        });
        return created
          ? requestContext.json(created, 201)
          : issue(requestContext, 404, "NOT_FOUND", "未找到系列。");
      },
    ),
    ...(
      [
        [
          "override",
          "put",
          "series.overrideStoryBible",
          SeriesStoryBibleOverrideInputSchema,
        ],
        [
          "upgrade",
          "post",
          "series.upgradeStoryBible",
          SeriesStoryBibleUpgradeInputSchema,
        ],
      ] as const
    ).map(([action, method, operationId, body]): RouteContribution =>
      contribute(
        {
          id: `workspace:series-story-bible-${action}`,
          pluginId: "workspace",
          method,
          path: `/api/v2/projects/{projectId}/series-story-bible/{id}/${action}`,
          operationId,
        },
        api({
          method,
          path: `/api/v2/projects/{projectId}/series-story-bible/{id}/${action}`,
          operationId,
          params: projectStory,
          body,
          response: SeriesStoryBibleSchema,
        }),
        async (requestContext) => {
          const parsed = body.safeParse(await requestContext.req.json());
          const projectId = requestContext.req.param("projectId");
          const sourceId = requestContext.req.param("id");
          if (!parsed.success)
            return issue(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "系列资料版本无效。",
            );
          const updated = context.uow.execute((transaction) => {
            const source = transaction.get<StoryBibleRow>(
              "SELECT * FROM series_story_bible WHERE id = ?",
              sourceId,
            );
            const membership = transaction.get<{ series_id: string }>(
              "SELECT series_id FROM project_series WHERE project_id = ?",
              projectId,
            );
            if (!source || membership?.series_id !== source.series_id)
              return { state: "missing" as const };
            if (parsed.data.sourceVersion !== source.version)
              return { state: "conflict" as const };
            const timestamp = now();
            if (action === "override") {
              const input = parsed.data as z.infer<
                typeof SeriesStoryBibleOverrideInputSchema
              >;
              transaction.run(
                `INSERT INTO series_story_bible_overrides(
                    id, project_id, source_id, title, payload_json,
                    source_version, version, created_at, updated_at
                  ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                  ON CONFLICT(project_id, source_id) DO UPDATE SET
                    title = excluded.title, payload_json = excluded.payload_json,
                    source_version = excluded.source_version,
                    version = series_story_bible_overrides.version + 1,
                    updated_at = excluded.updated_at`,
                crypto.randomUUID(),
                projectId,
                sourceId,
                input.title,
                JSON.stringify(input.payload),
                input.sourceVersion,
                timestamp,
                timestamp,
              );
            } else {
              transaction.run(
                "UPDATE series_story_bible_overrides SET source_version = ?, updated_at = ? WHERE project_id = ? AND source_id = ?",
                source.version,
                timestamp,
                projectId,
                sourceId,
              );
            }
            const override = transaction.get<OverrideRow>(
              "SELECT * FROM series_story_bible_overrides WHERE project_id = ? AND source_id = ?",
              projectId,
              sourceId,
            );
            const value = storyBible(source, override);
            emit(
              transaction,
              `series-story-bible-${action}d`,
              sourceId,
              value.version,
              value,
            );
            return { state: "updated" as const, value };
          });
          if (updated.state === "missing")
            return issue(requestContext, 404, "NOT_FOUND", "未找到系列资料。");
          if (updated.state === "conflict")
            return issue(
              requestContext,
              409,
              "CONFLICT",
              "系列资料已有新版本，请刷新后重试。",
            );
          return requestContext.json(updated.value);
        },
      ),
    ),
    contribute(
      {
        id: "workspace:series-asset-transfer",
        pluginId: "workspace",
        method: "post",
        path: "/api/v2/projects/{id}/series-assets",
        operationId: "series.transferAsset",
      },
      api({
        method: "post",
        path: "/api/v2/projects/{id}/series-assets",
        operationId: "series.transferAsset",
        params: id,
        body: SeriesAssetTransferInputSchema,
        response: SeriesAssetLinkSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = SeriesAssetTransferInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const projectId = requestContext.req.param("id");
        if (!parsed.success)
          return issue(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "系列资产迁移参数无效。",
          );
        const created = context.uow.execute((transaction) => {
          const membership = transaction.get<{ series_id: string }>(
            "SELECT series_id FROM project_series WHERE project_id = ?",
            projectId,
          );
          if (!membership) return undefined;
          const valueId = crypto.randomUUID();
          const targetAssetId = crypto.randomUUID();
          const timestamp = now();
          transaction.run(
            `INSERT INTO series_asset_links(
              id, series_id, source_asset_id, source_version,
              target_project_id, target_asset_id, mode, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            valueId,
            membership.series_id,
            parsed.data.sourceAssetId,
            parsed.data.sourceVersion,
            projectId,
            targetAssetId,
            parsed.data.mode,
            timestamp,
            timestamp,
          );
          const value = assetLink(
            transaction.get<AssetLinkRow>(
              "SELECT * FROM series_asset_links WHERE id = ?",
              valueId,
            )!,
          );
          emit(transaction, "series-asset-transferred", valueId, 0, value);
          return value;
        });
        return created
          ? requestContext.json(created, 201)
          : issue(requestContext, 409, "CONFLICT", "项目尚未加入系列。");
      },
    ),
  ];
}

export const seriesMigrations: readonly PluginMigration[] = [
  {
    id: "workspace.0002.series-library",
    pluginId: "workspace",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0001.projects-and-series"],
    sql: `
      CREATE TABLE IF NOT EXISTS series_story_bible (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS series_story_bible_series
        ON series_story_bible(series_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS series_story_bible_overrides (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES series_story_bible(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        source_version INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, source_id)
      );
      CREATE TABLE IF NOT EXISTS series_asset_links (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
        source_asset_id TEXT NOT NULL,
        source_version INTEGER NOT NULL,
        target_project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        target_asset_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('copy', 'fork', 'link')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(target_asset_id)
      );
      CREATE INDEX IF NOT EXISTS series_asset_links_target
        ON series_asset_links(target_project_id, created_at DESC);
    `,
  },
];
