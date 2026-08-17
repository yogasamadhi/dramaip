import { randomUUID } from "node:crypto";

import type { Context, Plugin } from "@deepseek-ai/cordis";
import { createRoute, z } from "@hono/zod-openapi";

import { pageQuerySchema, problemDetailsSchema } from "@dramaip/contracts";
import { ApiProblem, idempotentResponse, requireIfMatch } from "@dramaip/http";
import type {
  MigrationDefinition,
  RouteContribution,
  UnitOfWork,
} from "@dramaip/plugin-api";

export interface DomainNode<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  kind: string;
  projectId: string;
  parentId: string | null;
  title: string;
  status: string;
  ordinal: number;
  data: TData;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceAction<TData extends Record<string, unknown>> {
  verb: string;
  input: z.ZodType;
  mutate(data: TData, input: unknown): TData;
}

export interface NodeResourceDefinition<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  kind: string;
  path: string;
  data: z.ZodType<TData>;
  defaultStatus?: string;
  createRequiresIdempotency?: boolean;
  validateCreate?: (data: TData) => void;
  validateCreateInput?: (input: {
    projectId: string;
    parentId: string | null;
    data: TData;
  }) => void;
  validateUpdate?: (previous: TData, next: TData) => void;
  validateUpdateInput?: (input: {
    projectId: string;
    parentId: string | null;
    data: TData;
  }) => void;
  actions?: readonly ResourceAction<TData>[];
}

export interface NodePluginConfig {
  pluginId: string;
  routeBase: `/api/v2/${string}`;
  resources: readonly NodeResourceDefinition<any>[];
}

interface NodeRow {
  row_cursor: number;
  id: string;
  kind: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  status: string;
  ordinal: number;
  data_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function safeIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value))
    throw new Error(`unsafe SQL identifier: ${value}`);
  return value;
}

function tableName(pluginId: string): string {
  return `${safeIdentifier(pluginId.replaceAll("-", "_"))}_nodes`;
}

function relationalTableName(pluginId: string, kind: string): string {
  return `${safeIdentifier(pluginId.replaceAll("-", "_"))}_${safeIdentifier(kind.replaceAll("-", "_"))}`;
}

export function createNodeMigration(
  pluginId: string,
  resources: readonly NodeResourceDefinition<any>[],
  dependsOn: readonly string[] = ["workspace-0001"],
): MigrationDefinition {
  const table = tableName(pluginId);
  const kinds = resources
    .map((resource) => `'${resource.kind.replaceAll("'", "''")}'`)
    .join(", ");
  return {
    id: `${pluginId}-0001`,
    pluginId,
    version: "1.0.0",
    dependsOn,
    sql: `
      CREATE TABLE ${table} (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN (${kinds})),
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        parent_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        ordinal INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX ${table}_project_kind_idx ON ${table} (project_id, kind, ordinal);
      CREATE INDEX ${table}_parent_idx ON ${table} (parent_id, kind, ordinal);
    `,
  };
}

/**
 * Forward migration away from the original plugin-wide node table. Each
 * aggregate receives an independently constrained relation while retaining the
 * v1 migration for checksum compatibility with existing Desktop2 databases.
 */
export function createRelationalMigration(
  pluginId: string,
  resources: readonly NodeResourceDefinition<any>[],
  options: {
    sequence?: number;
    dependsOn?: readonly string[];
    beforeDropSql?: string;
  } = {},
): MigrationDefinition {
  const legacyTable = tableName(pluginId);
  const statements = resources.map((resource) => {
    const table = relationalTableName(pluginId, resource.kind);
    const kind = resource.kind.replaceAll("'", "''");
    return `
      CREATE TABLE ${table} (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT '${kind}' CHECK (kind = '${kind}'),
        project_id TEXT NOT NULL REFERENCES workspace_projects(id) ON DELETE CASCADE,
        parent_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        ordinal INTEGER NOT NULL DEFAULT 0,
        data_json TEXT NOT NULL CHECK (json_valid(data_json)),
        version INTEGER NOT NULL CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX ${table}_project_idx ON ${table} (project_id, ordinal);
      CREATE INDEX ${table}_parent_idx ON ${table} (parent_id, ordinal);
      INSERT INTO ${table}
        (id, kind, project_id, parent_id, title, status, ordinal, data_json, version, created_at, updated_at)
      SELECT id, kind, project_id, parent_id, title, status, ordinal, data_json, version, created_at, updated_at
        FROM ${legacyTable} WHERE kind = '${kind}';`;
  });
  const sequence = options.sequence ?? 2;
  return {
    id: `${pluginId}-${String(sequence).padStart(4, "0")}`,
    pluginId,
    version: `${sequence}.0.0`,
    dependsOn: options.dependsOn ?? [`${pluginId}-0001`],
    sql: `${statements.join("\n")}\n${options.beforeDropSql ?? ""}\nDROP TABLE ${legacyTable};`,
  };
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new Error("invalid cursor");
  return parsed;
}

function toNode<TData extends Record<string, unknown>>(
  row: NodeRow,
  resource: NodeResourceDefinition<TData>,
): DomainNode<TData> {
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    parentId: row.parent_id,
    title: row.title,
    status: row.status,
    ordinal: row.ordinal,
    data: resource.data.parse(JSON.parse(row.data_json)),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class NodeRepository {
  constructor(
    readonly uow: UnitOfWork,
    private readonly pluginId: string,
    private readonly relational = false,
  ) {}

  private table(resource: NodeResourceDefinition): string {
    return this.relational
      ? relationalTableName(this.pluginId, resource.kind)
      : tableName(this.pluginId);
  }

  list(
    resource: NodeResourceDefinition,
    projectId: string,
    cursor: string | undefined,
    limit: number,
  ) {
    const table = this.table(resource);
    const rows = this.uow.execute((tx) =>
      tx.all<NodeRow>(
        `SELECT rowid AS row_cursor, * FROM ${table}
          WHERE kind = ? AND project_id = ? AND rowid > ?
          ORDER BY rowid ASC LIMIT ?`,
        resource.kind,
        projectId,
        parseCursor(cursor),
        limit + 1,
      ),
    );
    const visible = rows.slice(0, limit);
    return {
      items: visible.map((row) => toNode(row, resource)),
      ...(rows.length > limit
        ? { nextCursor: String(visible.at(-1)!.row_cursor) }
        : {}),
    };
  }

  get(resource: NodeResourceDefinition, id: string): DomainNode {
    const table = this.table(resource);
    const row = this.uow.execute((tx) =>
      tx.get<NodeRow>(
        `SELECT rowid AS row_cursor, * FROM ${table} WHERE id = ? AND kind = ?`,
        id,
        resource.kind,
      ),
    );
    if (!row)
      throw new ApiProblem(
        404,
        "RESOURCE_NOT_FOUND",
        `${resource.kind} does not exist`,
      );
    return toNode(row, resource);
  }

  create(
    resource: NodeResourceDefinition,
    input: {
      projectId: string;
      parentId?: string | null;
      title: string;
      status?: string;
      ordinal?: number;
      data: unknown;
    },
  ): DomainNode {
    const table = this.table(resource);
    const now = new Date().toISOString();
    const data = resource.data.parse(input.data);
    resource.validateCreate?.(data);
    resource.validateCreateInput?.({
      projectId: input.projectId,
      parentId: input.parentId ?? null,
      data,
    });
    const node: DomainNode = {
      id: randomUUID(),
      kind: resource.kind,
      projectId: input.projectId,
      parentId: input.parentId ?? null,
      title: input.title,
      status: input.status ?? resource.defaultStatus ?? "draft",
      ordinal: input.ordinal ?? 0,
      data,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.uow.execute((tx) => {
      tx.run(
        `INSERT INTO ${table}
         (id, kind, project_id, parent_id, title, status, ordinal, data_json, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        node.id,
        node.kind,
        node.projectId,
        node.parentId,
        node.title,
        node.status,
        node.ordinal,
        JSON.stringify(node.data),
        node.version,
        node.createdAt,
        node.updatedAt,
      );
      tx.append({
        type: `${this.pluginId}.${resource.kind}-created.v1`,
        pluginId: this.pluginId,
        aggregateType: resource.kind,
        aggregateId: node.id,
        aggregateVersion: 1,
        payload: node,
      });
    });
    return node;
  }

  update(
    resource: NodeResourceDefinition,
    id: string,
    expectedVersion: number,
    input: {
      title?: string;
      status?: string;
      ordinal?: number;
      parentId?: string | null;
      data?: unknown;
    },
  ): DomainNode {
    const table = this.table(resource);
    return this.uow.execute((tx) => {
      const row = tx.get<NodeRow>(
        `SELECT rowid AS row_cursor, * FROM ${table} WHERE id = ? AND kind = ?`,
        id,
        resource.kind,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "RESOURCE_NOT_FOUND",
          `${resource.kind} does not exist`,
        );
      if (row.version !== expectedVersion)
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          `${resource.kind} version changed`,
        );
      const previous = toNode(row, resource);
      const data =
        input.data === undefined
          ? previous.data
          : resource.data.parse(input.data);
      resource.validateUpdate?.(previous.data, data);
      const node: DomainNode = {
        ...previous,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.ordinal === undefined ? {} : { ordinal: input.ordinal }),
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        data,
        version: previous.version + 1,
        updatedAt: new Date().toISOString(),
      };
      resource.validateUpdateInput?.({
        projectId: node.projectId,
        parentId: node.parentId,
        data,
      });
      tx.run(
        `UPDATE ${table}
            SET parent_id = ?, title = ?, status = ?, ordinal = ?, data_json = ?, version = ?, updated_at = ?
          WHERE id = ? AND kind = ? AND version = ?`,
        node.parentId,
        node.title,
        node.status,
        node.ordinal,
        JSON.stringify(node.data),
        node.version,
        node.updatedAt,
        id,
        resource.kind,
        expectedVersion,
      );
      tx.append({
        type: `${this.pluginId}.${resource.kind}-updated.v1`,
        pluginId: this.pluginId,
        aggregateType: resource.kind,
        aggregateId: id,
        aggregateVersion: node.version,
        payload: node,
      });
      return node;
    });
  }

  remove(
    resource: NodeResourceDefinition,
    id: string,
    expectedVersion: number,
  ): void {
    const table = this.table(resource);
    this.uow.execute((tx) => {
      const row = tx.get<NodeRow>(
        `SELECT rowid AS row_cursor, * FROM ${table} WHERE id = ? AND kind = ?`,
        id,
        resource.kind,
      );
      if (!row)
        throw new ApiProblem(
          404,
          "RESOURCE_NOT_FOUND",
          `${resource.kind} does not exist`,
        );
      if (row.version !== expectedVersion)
        throw new ApiProblem(
          412,
          "VERSION_CONFLICT",
          `${resource.kind} version changed`,
        );
      tx.run(
        `DELETE FROM ${table} WHERE id = ? AND kind = ? AND version = ?`,
        id,
        resource.kind,
        expectedVersion,
      );
      tx.append({
        type: `${this.pluginId}.${resource.kind}-deleted.v1`,
        pluginId: this.pluginId,
        aggregateType: resource.kind,
        aggregateId: id,
        aggregateVersion: expectedVersion + 1,
        payload: { id },
      });
    });
  }
}

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

function expectedVersion(request: Request): number {
  const value = request.headers.get("if-match");
  if (!value) {
    requireIfMatch(request, 0);
    return 0;
  }
  const match = /^"v(\d+)"$/.exec(value);
  return match ? Number(match[1]) : Number.NaN;
}

function routeSchema(resource: NodeResourceDefinition) {
  return z.object({
    id: z.uuid(),
    kind: z.literal(resource.kind),
    projectId: z.uuid(),
    parentId: z.uuid().nullable(),
    title: z.string(),
    status: z.string(),
    ordinal: z.number().int(),
    data: resource.data,
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  });
}

function installResourceRoutes(
  app: Parameters<RouteContribution["install"]>[0],
  config: NodePluginConfig,
  resource: NodeResourceDefinition<any>,
  repository: NodeRepository,
): void {
  const path = `${config.routeBase}/${resource.path}`;
  const itemPath = `${path}/{id}`;
  const schema = routeSchema(resource);
  const pageSchema = z.object({
    items: z.array(schema),
    nextCursor: z.string().optional(),
  });
  const createSchema = z
    .object({
      projectId: z.uuid(),
      parentId: z.uuid().nullable().optional(),
      title: z.string().trim().min(1).max(500),
      status: z.string().min(1).max(100).optional(),
      ordinal: z.number().int().min(0).optional(),
      data: resource.data,
    })
    .strict();
  const updateSchema = z
    .object({
      parentId: z.uuid().nullable().optional(),
      title: z.string().trim().min(1).max(500).optional(),
      status: z.string().min(1).max(100).optional(),
      ordinal: z.number().int().min(0).optional(),
      data: resource.data.optional(),
    })
    .strict();
  const listRoute = createRoute({
    operationId: `${config.pluginId}_${resource.kind}_list`,
    method: "get",
    path,
    request: { query: pageQuerySchema.extend({ projectId: z.uuid() }) },
    responses: {
      200: jsonResponse(pageSchema, `${resource.kind} list`),
      ...errors,
    },
  });
  app.openapi(
    listRoute as never,
    ((context: any) => {
      const query = context.req.valid("query");
      return context.json(
        repository.list(resource, query.projectId, query.cursor, query.limit),
      );
    }) as never,
  );

  const create = createRoute({
    operationId: `${config.pluginId}_${resource.kind}_create`,
    method: "post",
    path,
    request: {
      body: { content: { "application/json": { schema: createSchema } } },
    },
    responses: {
      201: jsonResponse(schema, `${resource.kind} created`),
      ...errors,
    },
  });
  app.openapi(
    create as never,
    (async (context: any) => {
      const input = context.req.valid("json");
      const execute = async () => {
        const node = repository.create(resource, input);
        context.header("etag", `"v${node.version}"`);
        context.header("location", `${path}/${node.id}`);
        return context.json(node, 201);
      };
      if (!resource.createRequiresIdempotency) return execute();
      return idempotentResponse(
        repository.uow,
        context.req.raw,
        `${config.pluginId}.${resource.kind}.create`,
        input,
        execute,
      );
    }) as never,
  );

  const get = createRoute({
    operationId: `${config.pluginId}_${resource.kind}_get`,
    method: "get",
    path: itemPath,
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 200: jsonResponse(schema, resource.kind), ...errors },
  });
  app.openapi(
    get as never,
    ((context: any) => {
      const node = repository.get(resource, context.req.valid("param").id);
      context.header("etag", `"v${node.version}"`);
      return context.json(node);
    }) as never,
  );

  const update = createRoute({
    operationId: `${config.pluginId}_${resource.kind}_update`,
    method: "patch",
    path: itemPath,
    request: {
      params: z.object({ id: z.uuid() }),
      body: { content: { "application/json": { schema: updateSchema } } },
    },
    responses: {
      200: jsonResponse(schema, `${resource.kind} updated`),
      ...errors,
    },
  });
  app.openapi(
    update as never,
    ((context: any) => {
      const node = repository.update(
        resource,
        context.req.valid("param").id,
        expectedVersion(context.req.raw),
        context.req.valid("json"),
      );
      context.header("etag", `"v${node.version}"`);
      return context.json(node);
    }) as never,
  );

  const remove = createRoute({
    operationId: `${config.pluginId}_${resource.kind}_delete`,
    method: "delete",
    path: itemPath,
    request: { params: z.object({ id: z.uuid() }) },
    responses: { 204: { description: `${resource.kind} deleted` }, ...errors },
  });
  app.openapi(
    remove as never,
    ((context: any) => {
      repository.remove(
        resource,
        context.req.valid("param").id,
        expectedVersion(context.req.raw),
      );
      return context.body(null, 204);
    }) as never,
  );

  for (const action of resource.actions ?? []) {
    const actionRoute = createRoute({
      operationId: `${config.pluginId}_${resource.kind}_${action.verb.replaceAll("-", "_")}`,
      method: "post",
      path: `${itemPath}/actions/${action.verb}`,
      request: {
        params: z.object({ id: z.uuid() }),
        body: { content: { "application/json": { schema: action.input } } },
      },
      responses: {
        200: jsonResponse(schema, `${resource.kind} ${action.verb}`),
        ...errors,
      },
    });
    app.openapi(
      actionRoute as never,
      ((context: any) => {
        const id = context.req.valid("param").id;
        const current = repository.get(resource, id);
        const node = repository.update(
          resource,
          id,
          expectedVersion(context.req.raw),
          {
            data: action.mutate(current.data, context.req.valid("json")),
          },
        );
        context.header("etag", `"v${node.version}"`);
        return context.json(node);
      }) as never,
    );
  }
}

export function createNodePluginServer(config: NodePluginConfig): Plugin {
  return {
    name: `dramaip-${config.pluginId}`,
    inject: ["http", "uow"],
    apply(ctx) {
      installNodePluginServer(ctx, config);
    },
  };
}

export function createRelationalPluginServer(config: NodePluginConfig): Plugin {
  return {
    name: `dramaip-${config.pluginId}`,
    inject: ["http", "uow"],
    apply(ctx) {
      installRelationalPluginServer(ctx, config);
    },
  };
}

export function installRelationalPluginServer(
  ctx: Context,
  config: NodePluginConfig,
): void {
  const repository = new NodeRepository(ctx.uow, config.pluginId, true);
  const contribution: RouteContribution = {
    id: `${config.pluginId}.http.v2`,
    pluginId: config.pluginId,
    install(app) {
      for (const resource of config.resources)
        installResourceRoutes(app, config, resource, repository);
    },
  };
  ctx.http.register(contribution);
}

export function installNodePluginServer(
  ctx: Context,
  config: NodePluginConfig,
): void {
  const repository = new NodeRepository(ctx.uow, config.pluginId);
  const contribution: RouteContribution = {
    id: `${config.pluginId}.http.v2`,
    pluginId: config.pluginId,
    install(app) {
      for (const resource of config.resources)
        installResourceRoutes(app, config, resource, repository);
    },
  };
  ctx.http.register(contribution);
}
