import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
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
  ProductionGraphSchema,
  ProductionImpactInputSchema,
  ProductionImpactSchema,
  ProductionRecordInputSchema,
  ProductionRecordPatchSchema,
  ProductionRecordSchema,
  ProductionReorderInputSchema,
  ProductionReorderResultSchema,
  type ProductionRecord,
  type ProductionRecordInput,
  type ProductionRecordKind,
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
  type WritingChapterService,
} from "@dramaip/contracts/writing";
import {
  defineFirstPartyPlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface ProductionRow {
  id: string;
  kind: ProductionRecordKind;
  project_id: string;
  parent_id: string | null;
  title: string;
  payload_json: string;
  order_index: number;
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
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

type RouteHandler = (context: RouteContext) => Response | Promise<Response>;
const idParams = z.object({ id: z.string().uuid() });
const projectIdParams = z.object({ projectId: z.string().uuid() });
const productionKinds: readonly ProductionRecordKind[] = [
  "adaptations",
  "episodes",
  "scripts",
  "scenes",
  "shots",
];

function toRecord(row: ProductionRow): ProductionRecord {
  return {
    id: row.id,
    kind: row.kind,
    domain: row.kind,
    projectId: row.project_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    title: row.title,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    orderIndex: row.order_index,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function appendEvent(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: ProductionRecord,
): void {
  transaction.append({
    type: `production.${action}.v1`,
    pluginId: "production",
    aggregateType: value.kind,
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function createRecord(
  context: PluginContext,
  kind: ProductionRecordKind,
  input: ProductionRecordInput,
): ProductionRecord {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return context.uow.execute((transaction) => {
    const orderIndex =
      transaction.get<{ value: number }>(
        `SELECT COALESCE(MAX(order_index), -1) + 1 AS value
         FROM production_records
         WHERE kind = ? AND ((parent_id = ?) OR (parent_id IS NULL AND ? IS NULL))`,
        kind,
        input.parentId ?? null,
        input.parentId ?? null,
      )?.value ?? 0;
    transaction.run(
      `INSERT INTO production_records(
        id, kind, project_id, parent_id, title, payload_json, order_index,
        version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id,
      kind,
      input.projectId,
      input.parentId ?? null,
      input.title.trim(),
      JSON.stringify(input.payload ?? {}),
      orderIndex,
      now,
      now,
    );
    const value = toRecord(
      transaction.get<ProductionRow>(
        "SELECT * FROM production_records WHERE id = ?",
        id,
      )!,
    );
    appendEvent(transaction, `${kind}-created`, value);
    return value;
  });
}

function listRecords(
  context: PluginContext,
  kind: ProductionRecordKind,
  filter: { projectId?: string; parentId?: string },
): readonly ProductionRecord[] {
  return context.uow.execute((transaction) =>
    (filter.parentId
      ? transaction.all<ProductionRow>(
          "SELECT * FROM production_records WHERE kind = ? AND parent_id = ? ORDER BY order_index, created_at",
          kind,
          filter.parentId,
        )
      : transaction.all<ProductionRow>(
          "SELECT * FROM production_records WHERE kind = ? AND project_id = ? ORDER BY order_index, created_at",
          kind,
          filter.projectId,
        )
    ).map(toRecord),
  );
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

function openapi(input: {
  method: "delete" | "get" | "patch" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["production"],
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

function productionResourceRoutes(
  workspace: WorkspaceProjectService,
  records: ProductionRecordService,
): readonly RouteContribution[] {
  const result: RouteContribution[] = [];
  for (const kind of productionKinds) {
    const collectionPath = `/api/v2/${kind}` as `/api/v2/${string}`;
    const itemPath = `/api/v2/${kind}/{id}` as `/api/v2/${string}`;
    result.push(
      route(
        {
          id: `production:${kind}-list`,
          pluginId: "production",
          method: "get",
          path: collectionPath,
          operationId: `${kind}.list`,
        },
        openapi({
          method: "get",
          path: collectionPath,
          operationId: `${kind}.list`,
          response: z.array(ProductionRecordSchema),
        }),
        (requestContext) => {
          const projectId = requestContext.req.query("projectId");
          const parentId = requestContext.req.query("parentId");
          if (!projectId || !workspace.get(projectId))
            return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
          return requestContext.json(
            records.list(kind, parentId ? { parentId } : { projectId }),
          );
        },
      ),
      route(
        {
          id: `production:${kind}-get`,
          pluginId: "production",
          method: "get",
          path: itemPath,
          operationId: `${kind}.get`,
        },
        openapi({
          method: "get",
          path: itemPath,
          operationId: `${kind}.get`,
          params: idParams,
          response: ProductionRecordSchema,
        }),
        (requestContext) => {
          const value = records.get(requestContext.req.param("id"));
          return value?.kind === kind
            ? requestContext.json(value)
            : problem(requestContext, 404, "NOT_FOUND", "未找到制作条目。");
        },
      ),
      route(
        {
          id: `production:${kind}-create`,
          pluginId: "production",
          method: "post",
          path: collectionPath,
          operationId: `${kind}.create`,
        },
        openapi({
          method: "post",
          path: collectionPath,
          operationId: `${kind}.create`,
          body: ProductionRecordInputSchema,
          response: ProductionRecordSchema,
          status: 201,
        }),
        async (requestContext) => {
          const input = ProductionRecordInputSchema.safeParse(
            await requestContext.req.json(),
          );
          if (!input.success || !workspace.get(input.data.projectId))
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "制作条目内容无效。",
            );
          if (input.data.parentId) {
            const parent = records.get(input.data.parentId);
            if (!parent || parent.projectId !== input.data.projectId)
              return problem(
                requestContext,
                404,
                "NOT_FOUND",
                "未找到上级制作条目。",
              );
          }
          return requestContext.json(records.create(kind, input.data), 201);
        },
      ),
      route(
        {
          id: `production:${kind}-update`,
          pluginId: "production",
          method: "patch",
          path: itemPath,
          operationId: `${kind}.update`,
        },
        openapi({
          method: "patch",
          path: itemPath,
          operationId: `${kind}.update`,
          params: idParams,
          body: ProductionRecordPatchSchema,
          response: ProductionRecordSchema,
        }),
        async (requestContext) => {
          const input = ProductionRecordPatchSchema.safeParse(
            await requestContext.req.json(),
          );
          if (!input.success)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "制作条目修改无效。",
            );
          const current = records.get(requestContext.req.param("id"));
          if (!current || current.kind !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到制作条目。",
            );
          const value = records.update(current.id, input.data);
          return value === "conflict"
            ? problem(
                requestContext,
                409,
                "CONFLICT",
                "制作条目已更新，请刷新后重试。",
              )
            : requestContext.json(value);
        },
      ),
      route(
        {
          id: `production:${kind}-remove`,
          pluginId: "production",
          method: "delete",
          path: itemPath,
          operationId: `${kind}.remove`,
        },
        openapi({
          method: "delete",
          path: itemPath,
          operationId: `${kind}.remove`,
          params: idParams,
          response: z.unknown(),
          status: 204,
        }),
        (requestContext) => {
          const current = records.get(requestContext.req.param("id"));
          if (!current || current.kind !== kind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到制作条目。",
            );
          return records.remove(current.id)
            ? requestContext.body(null, 204)
            : problem(requestContext, 409, "CONFLICT", "制作条目无法删除。");
        },
      ),
    );
  }
  return result;
}

function route(
  metadata: Omit<RouteContribution, "install">,
  declaration: unknown,
  handler: RouteHandler,
): RouteContribution {
  return {
    ...metadata,
    install: (app) => {
      const register = app.openapi as unknown as (
        value: unknown,
        routeHandler: RouteHandler,
      ) => void;
      register.call(app, declaration, handler);
    },
  };
}

function productionRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  writing: WritingChapterService,
  records: ProductionRecordService,
): readonly RouteContribution[] {
  const graphDeclaration = openapi({
    method: "get",
    path: "/api/v2/projects/{id}/production-graph",
    operationId: "production.graph",
    params: idParams,
    response: ProductionGraphSchema,
  });
  const impactDeclaration = openapi({
    method: "post",
    path: "/api/v2/production/impact",
    operationId: "production.impact",
    body: ProductionImpactInputSchema,
    response: ProductionImpactSchema,
  });
  const selectDeclaration = openapi({
    method: "post",
    path: "/api/v2/projects/{projectId}/current-adaptation",
    operationId: "production-structure.selectCurrentAdaptation",
    params: projectIdParams,
    body: z.object({ adaptationId: z.string().uuid() }),
    response: z.unknown(),
  });
  const result: RouteContribution[] = [
    ...productionResourceRoutes(workspace, records),
    route(
      {
        id: "production:graph",
        pluginId: "production",
        method: "get",
        path: "/api/v2/projects/{id}/production-graph",
        operationId: "production.graph",
      },
      graphDeclaration,
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        const project = workspace.get(projectId);
        if (!project)
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        const chapters = writing.list(projectId);
        const production = productionKinds.flatMap((kind) =>
          records.list(kind, { projectId }),
        );
        const media =
          context.services.get<MediaRecordService>(MEDIA_RECORD_SERVICE);
        const mediaKinds = [
          "assets",
          "visual-assets",
          "shot-stills",
          "audio",
          "video",
          "animatics",
          "renders",
          "rights",
          "image",
        ] as const;
        const mediaRecords = media
          ? mediaKinds.flatMap((kind) => media.list(kind, { projectId }))
          : [];
        const creativeQuality =
          context.services.get<CreativeQualityRecordService>(
            CREATIVE_QUALITY_SERVICE,
          );
        const qualityRecords =
          creativeQuality?.list("quality", { projectId }) ?? [];
        const review = context.services.get<ReviewRecordService>(
          REVIEW_RECORD_SERVICE,
        );
        const reviewRecords = review
          ? (["compliance", "review"] as const).flatMap((kind) =>
              review.list(kind, { projectId }),
            )
          : [];
        const delivery = context.services.get<DeliveryRecordService>(
          DELIVERY_RECORD_SERVICE,
        );
        const deliveryRecords = delivery
          ? (["localization", "delivery"] as const).flatMap((kind) =>
              delivery.list(kind, { projectId }),
            )
          : [];
        const nodes = [
          {
            id: project.id,
            kind: "project",
            title: project.title,
            status: "项目",
          },
          ...chapters.map((item) => ({
            id: item.id,
            kind: "chapter",
            title: item.title,
            status: "章节",
          })),
          ...production.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            status: String(
              item.payload["采用状态"] ??
                item.payload["审阅状态"] ??
                item.payload["交付状态"] ??
                "待完善",
            ),
          })),
          ...mediaRecords.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            status: String(
              item.payload["采用状态"] ?? item.payload["审阅状态"] ?? "待完善",
            ),
          })),
          ...qualityRecords.map((item) => ({
            id: item.id,
            kind: "quality",
            title: String(item.value["title"] ?? "质量检查"),
            status: "待完善",
          })),
          ...reviewRecords.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: String(item.value["title"] ?? "审查资料"),
            status: String(
              item.value["检查状态"] ?? item.value["审片状态"] ?? "待完善",
            ),
          })),
          ...deliveryRecords.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: String(item.value["title"] ?? "交付资料"),
            status: String(
              item.value["采用状态"] ?? item.value["交付状态"] ?? "待完善",
            ),
          })),
        ];
        const ids = new Set(nodes.map((node) => node.id));
        const edges = [
          ...chapters.map((item) => ({
            sourceId: projectId,
            targetId: item.id,
            relation: "包含",
          })),
          ...production.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
          ...mediaRecords.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
          ...qualityRecords.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
          ...reviewRecords.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
          ...deliveryRecords.map((item) => ({
            sourceId:
              item.parentId && ids.has(item.parentId)
                ? item.parentId
                : projectId,
            targetId: item.id,
            relation: item.parentId ? "依赖" : "归属",
          })),
        ];
        const count = (kind: ProductionRecordKind) =>
          production.filter((item) => item.kind === kind).length;
        const assets = mediaRecords.filter((item) =>
          ["assets", "visual-assets"].includes(item.kind),
        );
        const stills = mediaRecords.filter(
          (item) => item.kind === "shot-stills",
        );
        return requestContext.json({
          projectId,
          nodes,
          edges,
          coverage: {
            episodes: count("episodes"),
            scripts: count("scripts"),
            scenes: count("scenes"),
            shots: count("shots"),
            assets: assets.length,
            stills: stills.length,
            adoptedStills: stills.filter(
              (item) => item.payload["采用状态"] === "已采用",
            ).length,
          },
        });
      },
    ),
    route(
      {
        id: "production:impact",
        pluginId: "production",
        method: "post",
        path: "/api/v2/production/impact",
        operationId: "production.impact",
      },
      impactDeclaration,
      async (requestContext) => {
        const parsed = ProductionImpactInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "影响分析参数无效。",
          );
        const source = records.get(parsed.data.sourceId);
        if (!source || source.projectId !== parsed.data.projectId)
          return problem(requestContext, 404, "NOT_FOUND", "未找到制作来源。");
        const all = productionKinds.flatMap((kind) =>
          records.list(kind, { projectId: source.projectId }),
        );
        const affected: ProductionRecord[] = [];
        const pending = [source.id];
        while (pending.length) {
          const parentId = pending.shift()!;
          for (const candidate of all) {
            if (
              candidate.parentId === parentId &&
              !affected.some((item) => item.id === candidate.id)
            ) {
              affected.push(candidate);
              pending.push(candidate.id);
            }
          }
        }
        return requestContext.json({
          sourceId: source.id,
          affected: affected.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            status: "建议复核",
          })),
          summary: affected.length
            ? `「${source.title}」变更后，建议复核 ${affected.length} 个下游制作条目。`
            : `「${source.title}」当前没有记录到直接下游依赖。`,
        });
      },
    ),
    route(
      {
        id: "production:current-adaptation",
        pluginId: "production",
        method: "post",
        path: "/api/v2/projects/{projectId}/current-adaptation",
        operationId: "production-structure.selectCurrentAdaptation",
      },
      selectDeclaration,
      async (requestContext) => {
        const parsed = z
          .object({ adaptationId: z.string().uuid() })
          .safeParse(await requestContext.req.json());
        const projectId = requestContext.req.param("projectId");
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "改编方案参数无效。",
          );
        const adaptation = records.get(parsed.data.adaptationId);
        if (
          !adaptation ||
          adaptation.kind !== "adaptations" ||
          adaptation.projectId !== projectId
        )
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "改编方案不属于当前项目。",
          );
        const value = workspace.setCurrentAdaptation(projectId, adaptation.id);
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
      },
    ),
  ];

  for (const [kind, parentKind, path, operationId] of [
    [
      "episodes",
      "adaptations",
      "/api/v2/adaptations/{id}/episodes/reorder",
      "production-structure.reorderEpisodes",
    ],
    [
      "scenes",
      "scripts",
      "/api/v2/scripts/{id}/scenes/reorder",
      "production-structure.reorderScenes",
    ],
    [
      "shots",
      "scenes",
      "/api/v2/scenes/{id}/shots/reorder",
      "production-structure.reorderShots",
    ],
  ] as const) {
    const declaration = openapi({
      method: "post",
      path,
      operationId,
      params: idParams,
      body: ProductionReorderInputSchema,
      response: ProductionReorderResultSchema,
    });
    result.push(
      route(
        {
          id: `production:${kind}-reorder`,
          pluginId: "production",
          method: "post",
          path,
          operationId,
        },
        declaration,
        async (requestContext) => {
          const parsed = ProductionReorderInputSchema.safeParse(
            await requestContext.req.json(),
          );
          const parentId = requestContext.req.param("id");
          const parent = records.get(parentId);
          if (!parent || parent.kind !== parentKind)
            return problem(
              requestContext,
              404,
              "NOT_FOUND",
              "未找到上级制作条目。",
            );
          if (!parsed.success)
            return problem(
              requestContext,
              400,
              "VALIDATION_ERROR",
              "排序内容无效。",
            );
          const reordered = context.uow.execute((transaction) => {
            const current = transaction
              .all<ProductionRow>(
                "SELECT * FROM production_records WHERE kind = ? AND parent_id = ? ORDER BY order_index, created_at",
                kind,
                parentId,
              )
              .map(toRecord);
            if (
              current.length !== parsed.data.items.length ||
              new Set(parsed.data.items.map((item) => item.id)).size !==
                current.length ||
              current.some(
                (item) =>
                  !parsed.data.items.some(
                    (candidate) =>
                      candidate.id === item.id &&
                      candidate.version === item.version,
                  ),
              )
            )
              return undefined;
            const now = new Date().toISOString();
            parsed.data.items.forEach((item, index) =>
              transaction.run(
                "UPDATE production_records SET order_index = ?, version = version + 1, updated_at = ? WHERE id = ? AND parent_id = ? AND kind = ?",
                index,
                now,
                item.id,
                parentId,
                kind,
              ),
            );
            const values = transaction
              .all<ProductionRow>(
                "SELECT * FROM production_records WHERE kind = ? AND parent_id = ? ORDER BY order_index, created_at",
                kind,
                parentId,
              )
              .map(toRecord);
            transaction.append({
              type: `production.${kind}-reordered.v1`,
              pluginId: "production",
              aggregateType: kind,
              aggregateId: parentId,
              aggregateVersion: Math.max(
                0,
                ...values.map((item) => item.version),
              ),
              payload: JSON.parse(
                JSON.stringify({ parentId, records: values }),
              ),
            });
            return values;
          });
          return reordered
            ? requestContext.json({ records: reordered })
            : problem(
                requestContext,
                409,
                "CONFLICT",
                "制作顺序已变化，请刷新后重试。",
              );
        },
      ),
    );
  }
  return result;
}

const productionMigrations = [
  {
    id: "production.0001.records",
    pluginId: "production",
    version: "3.0.0-alpha.3",
    dependsOn: ["workspace.0001.projects-and-series"],
    sql: `
      CREATE TABLE IF NOT EXISTS production_records (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('adaptations', 'episodes', 'scripts', 'scenes', 'shots')),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES production_records(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        order_index INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS production_records_project_kind
        ON production_records(project_id, kind, order_index, id);
      CREATE INDEX IF NOT EXISTS production_records_parent_kind
        ON production_records(parent_id, kind, order_index, id);
    `,
  },
] as const;

export const productionPlugin = defineFirstPartyPlugin({
  descriptor: {
    id: "production",
    version: "3.0.0-alpha.3",
    apiVersion: "2",
    requires: ["foundation", "workspace", "automation", "writing", "knowledge"],
    provides: ["production.records"],
    stability: "internal",
  },
  ui: [
    {
      id: "production.route.workspace",
      pluginId: "production",
      kind: "route",
      metadata: { path: "/adapt", title: "改编" },
    },
    {
      id: "production.navigation.workspace",
      pluginId: "production",
      kind: "navigation",
      metadata: { section: "main", order: 30, label: "改编", to: "/adapt" },
    },
    {
      id: "production.editor.script",
      pluginId: "production",
      kind: "editor",
      metadata: { target: "script", title: "剧本编辑器" },
    },
  ],
  migrations: productionMigrations,
  activate: (context) => {
    const workspace = context.services.get<WorkspaceProjectService>(
      WORKSPACE_PROJECT_SERVICE,
    );
    const writing = context.services.get<WritingChapterService>(
      WRITING_CHAPTER_SERVICE,
    );
    if (!workspace || !writing)
      throw new Error("production requires workspace and writing services");
    const service: ProductionRecordService = {
      create: (kind, input) => createRecord(context, kind, input),
      list: (kind, filter) => listRecords(context, kind, filter),
      get: (id) =>
        context.uow.execute((transaction) => {
          const row = transaction.get<ProductionRow>(
            "SELECT * FROM production_records WHERE id = ?",
            id,
          );
          return row ? toRecord(row) : undefined;
        }),
      update: (id, patch) =>
        context.uow.execute((transaction) => {
          const row = transaction.get<ProductionRow>(
            "SELECT * FROM production_records WHERE id = ?",
            id,
          );
          if (!row) return undefined;
          if (row.version !== patch.version) return "conflict" as const;
          transaction.run(
            `UPDATE production_records SET title = ?, payload_json = ?,
             version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
            patch.title?.trim() ?? row.title,
            JSON.stringify(patch.payload ?? JSON.parse(row.payload_json)),
            new Date().toISOString(),
            id,
            row.version,
          );
          const value = toRecord(
            transaction.get<ProductionRow>(
              "SELECT * FROM production_records WHERE id = ?",
              id,
            )!,
          );
          appendEvent(transaction, `${row.kind}-updated`, value);
          return value;
        }),
      remove: (id, expectedVersion) =>
        context.uow.execute((transaction) => {
          const row = transaction.get<ProductionRow>(
            "SELECT * FROM production_records WHERE id = ?",
            id,
          );
          if (
            !row ||
            (expectedVersion !== undefined && row.version !== expectedVersion)
          )
            return false;
          const value = toRecord(row);
          transaction.run("DELETE FROM production_records WHERE id = ?", id);
          transaction.append({
            type: `production.${row.kind}-removed.v1`,
            pluginId: "production",
            aggregateType: row.kind,
            aggregateId: id,
            aggregateVersion: row.version,
            payload: JSON.parse(JSON.stringify(value)),
          });
          return true;
        }),
    };
    context.effect(
      context.services.provide(PRODUCTION_RECORD_SERVICE, service),
      `service:${PRODUCTION_RECORD_SERVICE}`,
    );
    for (const contribution of productionRoutes(
      context,
      workspace,
      writing,
      service,
    ))
      context.effect(
        context.http.register(contribution),
        `route:${contribution.id}`,
      );
  },
});
