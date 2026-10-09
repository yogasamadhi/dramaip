import { registerQualityProjectLineage } from "./project-lineage.js";
import { CREATIVE_KNOWLEDGE_SERVICE } from "@dramaip/contracts";
import { provideService } from "@dramaip/plugin-api/internal";
import { registerCreationQuality } from "./creation.js";
import { narrativeLocalQualityMigration } from "./narrative-local.js";
import {
  narrativeQualityMigration,
  registerNarrativeQuality,
} from "./narrative.js";
import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  CREATIVE_QUALITY_SERVICE,
  CreativeAcknowledgementInputSchema,
  CreativeCaseStudyInputSchema,
  CreativeCaseStudyPatchSchema,
  CreativeDiagnosticInputSchema,
  type CreativeQualityRecord,
  type CreativeQualityRecordKind,
  type CreativeQualityRecordService,
} from "@dramaip/contracts/creative-quality";
import {
  defineRouteContribution,
  definePlugin,
  type PluginContext,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";
import {
  creativeIntelligenceQualityMigrations,
  creativeIntelligenceQualityRoutes,
} from "./intelligence.js";

interface Row {
  id: string;
  kind: CreativeQualityRecordKind;
  project_id: string | null;
  parent_id: string | null;
  value_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ResourceRow {
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
const idParams = z.object({ id: z.string().uuid() });

function toRecord(row: Row): CreativeQualityRecord {
  return {
    id: row.id,
    kind: row.kind,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    value: JSON.parse(row.value_json) as Record<string, unknown>,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function wire(record: CreativeQualityRecord): Record<string, unknown> {
  return {
    ...record.value,
    id: record.id,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function append(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: CreativeQualityRecord,
): void {
  transaction.append({
    type: `creative-quality.${action}.v1`,
    pluginId: "creative-quality",
    aggregateType: value.kind,
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

function makeService(context: PluginContext): CreativeQualityRecordService {
  return {
    create(kind, input) {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      return context.uow.execute((transaction) => {
        transaction.run(
          `INSERT INTO creative_quality_records(
            id, kind, project_id, parent_id, value_json, version,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          id,
          kind,
          input.projectId ?? null,
          input.parentId ?? null,
          JSON.stringify(input.value),
          now,
          now,
        );
        const value = toRecord(
          transaction.get<Row>(
            "SELECT * FROM creative_quality_records WHERE id = ?",
            id,
          )!,
        );
        append(transaction, `${kind}-created`, value);
        return value;
      });
    },
    list(kind, filter = {}) {
      return context.uow.execute((transaction) => {
        const conditions = ["kind = ?"];
        const values: unknown[] = [kind];
        if (filter.projectId) {
          conditions.push("project_id = ?");
          values.push(filter.projectId);
        }
        if (filter.parentId) {
          conditions.push("parent_id = ?");
          values.push(filter.parentId);
        }
        return transaction
          .all<Row>(
            `SELECT * FROM creative_quality_records WHERE ${conditions.join(" AND ")} ORDER BY created_at, id`,
            ...values,
          )
          .map(toRecord);
      });
    },
    get(id) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<Row>(
          "SELECT * FROM creative_quality_records WHERE id = ?",
          id,
        );
        return row ? toRecord(row) : undefined;
      });
    },
    update(id, version, patch) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<Row>(
          "SELECT * FROM creative_quality_records WHERE id = ?",
          id,
        );
        if (!row) return undefined;
        if (row.version !== version) return "conflict" as const;
        const now = new Date().toISOString();
        transaction.run(
          "UPDATE creative_quality_records SET value_json = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
          JSON.stringify({
            ...(JSON.parse(row.value_json) as Record<string, unknown>),
            ...patch,
          }),
          now,
          id,
          version,
        );
        const value = toRecord(
          transaction.get<Row>(
            "SELECT * FROM creative_quality_records WHERE id = ?",
            id,
          )!,
        );
        append(transaction, `${value.kind}-updated`, value);
        return value;
      });
    },
    remove(id) {
      return context.uow.execute((transaction) => {
        const row = transaction.get<Row>(
          "SELECT * FROM creative_quality_records WHERE id = ?",
          id,
        );
        if (!row) return false;
        const value = toRecord(row);
        transaction.run(
          "DELETE FROM creative_quality_records WHERE id = ?",
          id,
        );
        append(transaction, `${value.kind}-removed`, value);
        return true;
      });
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

function declaration(input: {
  method: "delete" | "get" | "patch" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  status?: 200 | 201 | 204;
}): unknown {
  const status = input.status ?? 200;
  return createRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["creative-quality"],
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
        ...(status === 204
          ? {}
          : { content: { "application/json": { schema: z.unknown() } } }),
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
  schema: unknown,
  handler: Handler,
): RouteContribution {
  return defineRouteContribution({ ...metadata, declaration: schema, handler });
}

function routes(records: CreativeQualityRecordService): RouteContribution[] {
  const definitions: RouteContribution[] = [];
  const add = (
    method: "delete" | "get" | "patch" | "post",
    path: string,
    operationId: string,
    handler: Handler,
    options: {
      params?: ZodType;
      body?: ZodType;
      status?: 200 | 201 | 204;
    } = {},
  ) =>
    definitions.push(
      route(
        {
          id: `creative-quality:${operationId}`,
          pluginId: "creative-quality",
          method,
          path: path as `/api/v2/${string}`,
          operationId,
        },
        declaration({ method, path, operationId, ...options }),
        handler,
      ),
    );

  add(
    "get",
    "/api/v2/creative/case-studies",
    "creative.listCaseStudies",
    (context) => context.json(records.list("case-study").map(wire)),
  );
  add(
    "post",
    "/api/v2/creative/case-studies",
    "creative.createCaseStudy",
    async (context) => {
      const parsed = CreativeCaseStudyInputSchema.safeParse(
        await context.req.json(),
      );
      if (!parsed.success)
        return problem(context, 400, "VALIDATION_ERROR", "案例资料无效。");
      const value = records.create("case-study", {
        value: {
          ...parsed.data,
          relationshipPatterns: parsed.data.relationshipPatterns ?? [],
          openingHooks: parsed.data.openingHooks ?? [],
          highlightBeats: parsed.data.highlightBeats ?? [],
          reversalMechanisms: parsed.data.reversalMechanisms ?? [],
          cliffhangers: parsed.data.cliffhangers ?? [],
          visualPatterns: parsed.data.visualPatterns ?? [],
          rhythmCurve: parsed.data.rhythmCurve ?? [],
          riskTags: parsed.data.riskTags ?? [],
        },
      });
      return context.json(wire(value), 201);
    },
    { body: CreativeCaseStudyInputSchema, status: 201 },
  );
  add(
    "patch",
    "/api/v2/creative/case-studies/{id}",
    "creative.updateCaseStudy",
    async (context) => {
      const parsed = CreativeCaseStudyPatchSchema.safeParse(
        await context.req.json(),
      );
      if (!parsed.success)
        return problem(context, 400, "VALIDATION_ERROR", "案例更新无效。");
      const { version, ...patch } = parsed.data;
      const value = records.update(context.req.param("id"), version, patch);
      if (value === "conflict")
        return problem(context, 409, "CONFLICT", "案例已更新，请刷新后重试。");
      return value
        ? context.json(wire(value))
        : problem(context, 404, "NOT_FOUND", "未找到案例。");
    },
    { params: idParams, body: CreativeCaseStudyPatchSchema },
  );
  add(
    "delete",
    "/api/v2/creative/case-studies/{id}",
    "creative.removeCaseStudy",
    (context) =>
      records.remove(context.req.param("id"))
        ? context.body(null, 204)
        : problem(context, 404, "NOT_FOUND", "未找到案例。"),
    { params: idParams, status: 204 },
  );
  add(
    "get",
    "/api/v2/projects/{id}/creative-diagnostics",
    "creative.listDiagnostics",
    (context) =>
      context.json(
        records
          .list("diagnostic", { projectId: context.req.param("id") })
          .map(wire),
      ),
    { params: idParams },
  );
  add(
    "post",
    "/api/v2/creative/diagnostics",
    "creative.runDiagnostics",
    async (context) => {
      const parsed = CreativeDiagnosticInputSchema.safeParse(
        await context.req.json(),
      );
      if (!parsed.success)
        return problem(context, 400, "VALIDATION_ERROR", "创意诊断参数无效。");
      return problem(
        context,
        409,
        "UNSUPPORTED_OPERATION",
        "旧兼容诊断未读取实际内容，固定分数与曲线不能作为质量结论；已停止新生成。历史记录保留为未认证资料，请明确选择独立人工、规则或模型评议。",
      );
    },
    { body: CreativeDiagnosticInputSchema },
  );
  add(
    "get",
    "/api/v2/projects/{id}/creative-issue-acknowledgements",
    "creative.listIssueAcknowledgements",
    (context) =>
      context.json(
        records
          .list("acknowledgement", { projectId: context.req.param("id") })
          .map(wire),
      ),
    { params: idParams },
  );
  add(
    "post",
    "/api/v2/creative/issue-acknowledgements",
    "creative.acknowledgeIssue",
    async (context) => {
      const parsed = CreativeAcknowledgementInputSchema.safeParse(
        await context.req.json(),
      );
      if (!parsed.success)
        return problem(context, 400, "VALIDATION_ERROR", "问题确认内容无效。");
      return problem(
        context,
        409,
        "UNSUPPORTED_OPERATION",
        "旧兼容诊断缺少实际质量基准，不再新增问题确认；已有确认仅为历史声明，不证明修复或质量通过。请在独立评议中明确记录新的人工决定。",
      );
    },
    { body: CreativeAcknowledgementInputSchema, status: 201 },
  );
  add(
    "get",
    "/api/v2/adaptations/{id}/episode-analysis",
    "adaptation-analysis.get",
    (context) => {
      const value = records.list("episode-analysis", {
        parentId: context.req.param("id"),
      })[0];
      return value ? context.json(wire(value)) : context.body(null, 204);
    },
    { params: idParams },
  );
  add(
    "post",
    "/api/v2/adaptations/{id}/episode-analysis",
    "adaptation-analysis.run",
    (context) => {
      return problem(
        context,
        409,
        "UNSUPPORTED_OPERATION",
        "旧分集分析未读取实际分集而填写零分／零覆盖；已停止新生成和自动替换旧历史。原记录保持未认证，正式结构与质量请在实际来源上明确评议。",
      );
    },
    { params: idParams, status: 201 },
  );
  add(
    "delete",
    "/api/v2/adaptations/{id}/episode-analysis",
    "adaptation-analysis.remove",
    (context) => {
      const value = records.list("episode-analysis", {
        parentId: context.req.param("id"),
      })[0];
      if (value) records.remove(value.id);
      return context.body(null, 204);
    },
    { params: idParams, status: 204 },
  );
  return definitions;
}

function resourceRoutes(context: PluginContext): RouteContribution[] {
  const kinds = [
    "analysis",
    "beats",
    "episode-pacing-marks",
    "highlights",
    "feasibility",
    "trends",
    "evaluations",
    "quality",
  ] as const;
  const inputSchema = z.object({
    projectId: z.string().uuid(),
    parentId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    payload: z.record(z.string(), z.unknown()).optional(),
  });
  const patchSchema = inputSchema
    .omit({ projectId: true, parentId: true })
    .partial()
    .extend({ version: z.number().int().nonnegative() });
  const value = (row: ResourceRow) => ({
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
  const definitions: RouteContribution[] = [];
  const register = (
    method: "delete" | "get" | "patch" | "post",
    path: string,
    operationId: string,
    handler: Handler,
    options: {
      params?: ZodType;
      body?: ZodType;
      status?: 200 | 201 | 204;
    } = {},
  ) =>
    definitions.push(
      route(
        {
          id: `creative-quality:${operationId}`,
          pluginId: "creative-quality",
          method,
          path: path as `/api/v2/${string}`,
          operationId,
        },
        declaration({ method, path, operationId, ...options }),
        handler,
      ),
    );

  for (const kind of kinds) {
    const path = `/api/v2/${kind}`;
    const itemPath = `${path}/{id}`;
    register("get", path, `${kind}.list`, (requestContext) => {
      const projectId = requestContext.req.query("projectId");
      if (!projectId)
        return problem(
          requestContext,
          400,
          "VALIDATION_ERROR",
          "必须指定所属项目。",
        );
      const parentId = requestContext.req.query("parentId");
      const conditions = ["kind = ?", "project_id = ?"];
      const parameters: unknown[] = [kind, projectId];
      if (parentId) {
        conditions.push("parent_id = ?");
        parameters.push(parentId);
      }
      return requestContext.json(
        context.uow.execute((transaction) =>
          transaction
            .all<ResourceRow>(
              `SELECT * FROM creative_quality_resources
               WHERE ${conditions.join(" AND ")}
               ORDER BY updated_at DESC, id`,
              ...parameters,
            )
            .map(value),
        ),
      );
    });
    register(
      "post",
      path,
      `${kind}.create`,
      async (requestContext) => {
        const input = inputSchema.safeParse(await requestContext.req.json());
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "创意质量资料内容无效。",
          );
        const created = context.uow.execute((transaction) => {
          const id = crypto.randomUUID();
          const at = new Date().toISOString();
          transaction.run(
            `INSERT INTO creative_quality_resources(
              id, kind, project_id, parent_id, title, payload_json,
              version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            id,
            kind,
            input.data.projectId,
            input.data.parentId ?? null,
            input.data.title,
            JSON.stringify(input.data.payload ?? {}),
            at,
            at,
          );
          const result = value(
            transaction.get<ResourceRow>(
              "SELECT * FROM creative_quality_resources WHERE id = ?",
              id,
            )!,
          );
          transaction.append({
            type: `creative-quality.${kind}-created.v1`,
            pluginId: "creative-quality",
            aggregateType: kind,
            aggregateId: id,
            aggregateVersion: 0,
            payload: JSON.parse(JSON.stringify(result)),
          });
          return result;
        });
        requestContext.header("ETag", `"${created.version}"`);
        return requestContext.json(created, 201);
      },
      { body: inputSchema, status: 201 },
    );
    register(
      "get",
      itemPath,
      `${kind}.get`,
      (requestContext) => {
        const result = context.uow.execute((transaction) => {
          const row = transaction.get<ResourceRow>(
            "SELECT * FROM creative_quality_resources WHERE id = ? AND kind = ?",
            requestContext.req.param("id"),
            kind,
          );
          return row ? value(row) : undefined;
        });
        if (!result)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到创意质量资料。",
          );
        requestContext.header("ETag", `"${result.version}"`);
        return requestContext.json(result);
      },
      { params: idParams },
    );
    register(
      "patch",
      itemPath,
      `${kind}.update`,
      async (requestContext) => {
        const input = patchSchema.safeParse(await requestContext.req.json());
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "创意质量资料修改内容无效。",
          );
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          const current = transaction.get<ResourceRow>(
            "SELECT * FROM creative_quality_resources WHERE id = ? AND kind = ?",
            id,
            kind,
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== input.data.version)
            return { state: "conflict" as const };
          transaction.run(
            `UPDATE creative_quality_resources SET title = ?, payload_json = ?,
               version = version + 1, updated_at = ?
             WHERE id = ? AND version = ?`,
            input.data.title ?? current.title,
            JSON.stringify(
              input.data.payload ?? JSON.parse(current.payload_json),
            ),
            new Date().toISOString(),
            id,
            current.version,
          );
          const updated = value(
            transaction.get<ResourceRow>(
              "SELECT * FROM creative_quality_resources WHERE id = ?",
              id,
            )!,
          );
          transaction.append({
            type: `creative-quality.${kind}-updated.v1`,
            pluginId: "creative-quality",
            aggregateType: kind,
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
            "未找到创意质量资料。",
          );
        if (result.state === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "创意质量资料已更新，请刷新后重试。",
          );
        requestContext.header("ETag", `"${result.value.version}"`);
        return requestContext.json(result.value);
      },
      { params: idParams, body: patchSchema },
    );
    register(
      "delete",
      itemPath,
      `${kind}.remove`,
      (requestContext) => {
        const id = requestContext.req.param("id");
        const removed = context.uow.execute((transaction) => {
          const current = transaction.get<ResourceRow>(
            "SELECT * FROM creative_quality_resources WHERE id = ? AND kind = ?",
            id,
            kind,
          );
          if (!current) return false;
          transaction.run(
            "DELETE FROM creative_quality_resources WHERE id = ?",
            id,
          );
          transaction.append({
            type: `creative-quality.${kind}-removed.v1`,
            pluginId: "creative-quality",
            aggregateType: kind,
            aggregateId: id,
            aggregateVersion: current.version,
            payload: { id, projectId: current.project_id },
          });
          return true;
        });
        return removed
          ? requestContext.body(null, 204)
          : problem(requestContext, 404, "NOT_FOUND", "未找到创意质量资料。");
      },
      { params: idParams, status: 204 },
    );
  }
  return definitions;
}

export const creativeQualityPlugin = definePlugin({
  inject: [CREATIVE_KNOWLEDGE_SERVICE.id],
  descriptor: {
    id: "creative-quality",
    version: "3.0.0-alpha.3",
    apiVersion: "2",
    requires: ["foundation", "automation", "writing", "knowledge"],
    provides: ["creative-quality.records", "creative-quality.intelligence"],
    stability: "internal",
  },
  ui: [
    {
      id: "creative-quality.panel.narrative-review",
      pluginId: "creative-quality",
      kind: "panel",
      metadata: {
        slot: "project.tools",
        title: "质量报告",
        toolKey: "quality-review",
      },
    },
    {
      id: "creative-quality.route.workspace",
      pluginId: "creative-quality",
      kind: "route",
      metadata: { path: "/create", title: "创作工作区" },
    },
    {
      id: "creative-quality.navigation.workspace",
      pluginId: "creative-quality",
      kind: "navigation",
      metadata: {
        section: "secondary",
        order: 10,
        label: "创作分析",
        to: "/create",
      },
    },
    {
      id: "creative-quality.panel.diagnostics",
      pluginId: "creative-quality",
      kind: "panel",
      metadata: { slot: "creative.diagnostics", title: "创意诊断" },
    },
  ],
  migrations: [
    {
      id: "creative-quality.0001.records",
      pluginId: "creative-quality",
      version: "3.0.0-alpha.3",
      dependsOn: ["knowledge.0001.story-bible"],
      sql: `
        CREATE TABLE IF NOT EXISTS creative_quality_records (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('quality', 'episode-analysis', 'case-study', 'diagnostic', 'acknowledgement')),
          project_id TEXT,
          parent_id TEXT,
          value_json TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS creative_quality_kind_project
          ON creative_quality_records(kind, project_id, created_at, id);
        CREATE INDEX IF NOT EXISTS creative_quality_kind_parent
          ON creative_quality_records(kind, parent_id, created_at, id);
      `,
    },
    {
      id: "creative-quality.0002.resources",
      pluginId: "creative-quality",
      version: "3.0.0-alpha.3",
      dependsOn: ["creative-quality.0001.records"],
      sql: `
        CREATE TABLE IF NOT EXISTS creative_quality_resources (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN (
            'analysis', 'beats', 'episode-pacing-marks', 'highlights',
            'feasibility', 'trends', 'evaluations', 'quality'
          )),
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          parent_id TEXT,
          title TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',
          version INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS creative_quality_resources_project_kind
          ON creative_quality_resources(project_id, kind, updated_at DESC, id);
      `,
    },
    ...creativeIntelligenceQualityMigrations,
    narrativeQualityMigration,
    narrativeLocalQualityMigration,
  ],
  apply: (context) => {
    registerCreationQuality(context);
    registerNarrativeQuality(context);
    registerQualityProjectLineage(context);
    const records = makeService(context);
    context.effect(
      () => provideService(context, CREATIVE_QUALITY_SERVICE, records),
      `service:${CREATIVE_QUALITY_SERVICE}`,
    );
    for (const contribution of [
      ...routes(records),
      ...resourceRoutes(context),
      ...creativeIntelligenceQualityRoutes(context),
    ])
      context.effect(
        () => context.http.register(contribution),
        `route:${contribution.id}`,
      );
  },
});

export default creativeQualityPlugin;
