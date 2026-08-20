import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import type {
  PluginContext,
  RouteContribution,
  UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

type ResourceKind =
  "project-skills" | "agent-schemes" | "inspirations" | "templates";

interface ResourceRow {
  id: string;
  kind: ResourceKind;
  project_id: string | null;
  parent_id: string | null;
  title: string;
  payload_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface TemplateRow {
  id: string;
  project_id: string | null;
  title: string;
  body: string;
  payload_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface TemplateRunRow {
  id: string;
  template_id: string;
  project_id: string | null;
  rendered: string;
  variables_json: string;
  missing_json: string;
  created_at: string;
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
const resourceSchema = z.object({
  id: z.string().uuid(),
  domain: z.string(),
  projectId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  title: z.string(),
  payload: z.record(z.string(), z.unknown()),
  version: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const resourceInputSchema = z.object({
  projectId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(160),
  payload: z.record(z.string(), z.unknown()).optional(),
});
const resourcePatchSchema = resourceInputSchema
  .omit({ projectId: true, parentId: true })
  .partial()
  .extend({ version: z.number().int().nonnegative() });

function declaration(input: {
  method: "delete" | "get" | "patch" | "post";
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
    tags: ["automation"],
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

function contribution(
  metadata: Omit<RouteContribution, "install">,
  schema: unknown,
  handler: Handler,
): RouteContribution {
  return {
    ...metadata,
    install(app) {
      const register = app.openapi as unknown as (
        route: unknown,
        callback: Handler,
      ) => void;
      register.call(app, schema, handler);
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

function toResource(row: ResourceRow) {
  return {
    id: row.id,
    domain: row.kind,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    title: row.title,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTemplate(row: TemplateRow) {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  return {
    id: row.id,
    domain: "templates",
    ...(row.project_id ? { projectId: row.project_id } : {}),
    title: row.title,
    payload: { ...payload, 模板正文: payload["模板正文"] ?? row.body },
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function append(
  transaction: UnitOfWorkTransaction,
  action: string,
  value: { id: string; domain: string; version: number },
): void {
  transaction.append({
    type: `automation.${action}.v1`,
    pluginId: "automation",
    aggregateType: value.domain,
    aggregateId: value.id,
    aggregateVersion: value.version,
    payload: JSON.parse(JSON.stringify(value)),
  });
}

export function automationResourceRoutes(
  context: PluginContext,
): readonly RouteContribution[] {
  const kinds: readonly ResourceKind[] = [
    "project-skills",
    "agent-schemes",
    "inspirations",
    "templates",
  ];
  const routes: RouteContribution[] = [];
  for (const kind of kinds) {
    const path = `/api/v2/${kind}` as `/api/v2/${string}`;
    const itemPath = `${path}/{id}` as `/api/v2/${string}`;
    const add = (
      method: "delete" | "get" | "patch" | "post",
      suffix: string,
      handler: Handler,
      options: {
        body?: ZodType;
        params?: ZodType;
        response?: ZodType;
        status?: 200 | 201 | 204;
      } = {},
    ) => {
      const operationId = `${kind}.${suffix}`;
      const routePath =
        suffix === "list" || suffix === "create" ? path : itemPath;
      routes.push(
        contribution(
          {
            id: `automation:${operationId}`,
            pluginId: "automation",
            method,
            path: routePath,
            operationId,
          },
          declaration({
            method,
            path: routePath,
            operationId,
            ...options,
          }),
          handler,
        ),
      );
    };
    add(
      "get",
      "list",
      (requestContext) => {
        const projectId = requestContext.req.query("projectId");
        if (kind !== "templates" && !projectId)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "必须指定所属项目。",
          );
        return requestContext.json(
          context.uow.execute((transaction) => {
            if (kind === "templates") {
              const rows = projectId
                ? transaction.all<TemplateRow>(
                    `SELECT * FROM automation_templates
                     WHERE project_id IS NULL OR project_id = ?
                     ORDER BY updated_at DESC, id`,
                    projectId,
                  )
                : transaction.all<TemplateRow>(
                    "SELECT * FROM automation_templates ORDER BY updated_at DESC, id",
                  );
              return rows.map(toTemplate);
            }
            return transaction
              .all<ResourceRow>(
                `SELECT * FROM automation_resources
                 WHERE kind = ? AND project_id = ?
                 ORDER BY updated_at DESC, id`,
                kind,
                projectId,
              )
              .map(toResource);
          }),
        );
      },
      { response: z.array(resourceSchema) },
    );
    add(
      "post",
      "create",
      async (requestContext) => {
        const input = resourceInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success || (kind !== "templates" && !input.data.projectId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "自动化资料内容无效。",
          );
        const created = context.uow.execute((transaction) => {
          const id = crypto.randomUUID();
          const at = new Date().toISOString();
          if (kind === "templates") {
            const payload = input.data.payload ?? {};
            transaction.run(
              `INSERT INTO automation_templates(
                id, project_id, title, body, payload_json, version,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
              id,
              input.data.projectId ?? null,
              input.data.title,
              String(payload["模板正文"] ?? ""),
              JSON.stringify(payload),
              at,
              at,
            );
            const result = toTemplate(
              transaction.get<TemplateRow>(
                "SELECT * FROM automation_templates WHERE id = ?",
                id,
              )!,
            );
            append(transaction, "template-created", result);
            return result;
          }
          transaction.run(
            `INSERT INTO automation_resources(
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
          const result = toResource(
            transaction.get<ResourceRow>(
              "SELECT * FROM automation_resources WHERE id = ?",
              id,
            )!,
          );
          append(transaction, `${kind}-created`, result);
          return result;
        });
        requestContext.header("ETag", `"${created.version}"`);
        return requestContext.json(created, 201);
      },
      { body: resourceInputSchema, response: resourceSchema, status: 201 },
    );
    add(
      "get",
      "get",
      (requestContext) => {
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          if (kind === "templates") {
            const row = transaction.get<TemplateRow>(
              "SELECT * FROM automation_templates WHERE id = ?",
              id,
            );
            return row ? toTemplate(row) : undefined;
          }
          const row = transaction.get<ResourceRow>(
            "SELECT * FROM automation_resources WHERE id = ? AND kind = ?",
            id,
            kind,
          );
          return row ? toResource(row) : undefined;
        });
        if (!result)
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到自动化资料。",
          );
        requestContext.header("ETag", `"${result.version}"`);
        return requestContext.json(result);
      },
      { params: idParams, response: resourceSchema },
    );
    add(
      "patch",
      "update",
      async (requestContext) => {
        const input = resourcePatchSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!input.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "自动化资料修改内容无效。",
          );
        const id = requestContext.req.param("id");
        const result = context.uow.execute((transaction) => {
          if (kind === "templates") {
            const current = transaction.get<TemplateRow>(
              "SELECT * FROM automation_templates WHERE id = ?",
              id,
            );
            if (!current) return { state: "missing" as const };
            if (current.version !== input.data.version)
              return { state: "conflict" as const };
            const payload =
              input.data.payload ??
              (JSON.parse(current.payload_json) as Record<string, unknown>);
            transaction.run(
              `UPDATE automation_templates SET title = ?, body = ?,
                 payload_json = ?, version = version + 1, updated_at = ?
               WHERE id = ? AND version = ?`,
              input.data.title ?? current.title,
              String(payload["模板正文"] ?? current.body),
              JSON.stringify(payload),
              new Date().toISOString(),
              id,
              current.version,
            );
            const updated = toTemplate(
              transaction.get<TemplateRow>(
                "SELECT * FROM automation_templates WHERE id = ?",
                id,
              )!,
            );
            append(transaction, "template-updated", updated);
            return { state: "updated" as const, value: updated };
          }
          const current = transaction.get<ResourceRow>(
            "SELECT * FROM automation_resources WHERE id = ? AND kind = ?",
            id,
            kind,
          );
          if (!current) return { state: "missing" as const };
          if (current.version !== input.data.version)
            return { state: "conflict" as const };
          transaction.run(
            `UPDATE automation_resources SET title = ?, payload_json = ?,
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
          const updated = toResource(
            transaction.get<ResourceRow>(
              "SELECT * FROM automation_resources WHERE id = ?",
              id,
            )!,
          );
          append(transaction, `${kind}-updated`, updated);
          return { state: "updated" as const, value: updated };
        });
        if (result.state === "missing")
          return problem(
            requestContext,
            404,
            "NOT_FOUND",
            "未找到自动化资料。",
          );
        if (result.state === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "自动化资料已更新，请刷新后重试。",
          );
        requestContext.header("ETag", `"${result.value.version}"`);
        return requestContext.json(result.value);
      },
      { params: idParams, body: resourcePatchSchema, response: resourceSchema },
    );
    add(
      "delete",
      "remove",
      (requestContext) => {
        const id = requestContext.req.param("id");
        const removed = context.uow.execute((transaction) => {
          if (kind === "templates") {
            const current = transaction.get<TemplateRow>(
              "SELECT * FROM automation_templates WHERE id = ?",
              id,
            );
            if (!current) return false;
            transaction.run(
              "DELETE FROM automation_templates WHERE id = ?",
              id,
            );
            append(transaction, "template-removed", toTemplate(current));
            return true;
          }
          const current = transaction.get<ResourceRow>(
            "SELECT * FROM automation_resources WHERE id = ? AND kind = ?",
            id,
            kind,
          );
          if (!current) return false;
          transaction.run("DELETE FROM automation_resources WHERE id = ?", id);
          append(transaction, `${kind}-removed`, toResource(current));
          return true;
        });
        return removed
          ? requestContext.body(null, 204)
          : problem(requestContext, 404, "NOT_FOUND", "未找到自动化资料。");
      },
      { params: idParams, status: 204 },
    );
  }

  routes.push(
    contribution(
      {
        id: "automation:template-runs-list",
        pluginId: "automation",
        method: "get",
        path: "/api/v2/template-runs",
        operationId: "template-runs.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/template-runs",
        operationId: "template-runs.list",
        response: z.array(resourceSchema),
      }),
      (requestContext) => {
        const projectId = requestContext.req.query("projectId");
        return requestContext.json(
          context.uow.execute((transaction) => {
            const rows = projectId
              ? transaction.all<TemplateRunRow>(
                  "SELECT * FROM automation_template_runs WHERE project_id = ? ORDER BY created_at DESC, id",
                  projectId,
                )
              : transaction.all<TemplateRunRow>(
                  "SELECT * FROM automation_template_runs ORDER BY created_at DESC, id",
                );
            return rows.map((row) => ({
              id: row.id,
              domain: "template-runs",
              ...(row.project_id ? { projectId: row.project_id } : {}),
              parentId: row.template_id,
              title: "模板运行结果",
              payload: {
                渲染结果: row.rendered,
                变量: JSON.parse(row.variables_json),
                缺失变量: JSON.parse(row.missing_json),
              },
              version: 0,
              createdAt: row.created_at,
              updatedAt: row.created_at,
            }));
          }),
        );
      },
    ),
  );
  return routes;
}

export const automationResourceMigrations = [
  {
    id: "automation.0004.resources",
    pluginId: "automation",
    version: "3.0.0-alpha.3",
    dependsOn: ["automation.0003.previews-and-templates"],
    sql: `
      ALTER TABLE automation_templates
        ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE automation_templates
        ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE IF NOT EXISTS automation_resources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN (
          'project-skills', 'agent-schemes', 'inspirations'
        )),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id TEXT,
        title TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS automation_resources_project_kind
        ON automation_resources(project_id, kind, updated_at DESC, id);
    `,
  },
] as const;
