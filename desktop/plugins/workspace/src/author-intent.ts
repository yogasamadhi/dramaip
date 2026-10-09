import { createHash } from "node:crypto";
import { AuthorIntentSourcesUnavailableError } from "./author-intent-creation.js";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  AuthorIntentAdoptInputSchema,
  AuthorIntentCurrentSchema,
  AuthorIntentPageSchema,
  AuthorIntentPreviewInputSchema,
  AuthorIntentSchema,
  AuthorIntentSummarySchema,
  AuthorIntentSourceCatalogSchema,
  AuthorIntentSourceSchema,
  type AuthorIntent,
  type AuthorIntentContent,
  type AuthorIntentCreationBasis,
  type AuthorIntentSourceCatalog,
  type AuthorIntentPreviewInput,
  type Project,
  type WorkspaceAuthorIntentService,
} from "@dramaip/contracts/workspace";
import {
  CREATION_WORKFLOW_SERVICE,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import {
  defineRouteContribution,
  optionalService,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

export const authorIntentMigration: PluginMigration = {
  id: "workspace.0007.author-intents",
  pluginId: "workspace",
  version: "3.0.0-alpha.3",
  dependsOn: ["workspace.0006.projectless-source-imports"],
  sql: `
    CREATE TABLE workspace_author_intents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK(version > 0),
      state_version INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('pending', 'adopted', 'discarded', 'conflicted')),
      content_json TEXT NOT NULL,
      source_json TEXT NOT NULL,
      base_adopted_id TEXT,
      adopted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, version)
    );
    CREATE INDEX workspace_author_intents_cursor ON workspace_author_intents(project_id, version DESC);
    CREATE TABLE workspace_author_intent_heads (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      intent_id TEXT NOT NULL REFERENCES workspace_author_intents(id) ON DELETE CASCADE
    );
    CREATE TABLE workspace_author_intent_requests (
      request_key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      result_json TEXT NOT NULL
    );
  `,
};
export const authorIntentCreationMigration: PluginMigration = {
  id: "workspace.0008.ai-author-intents",
  pluginId: "workspace",
  version: "3.0.0-alpha.4",
  dependsOn: ["workspace.0007.author-intents"],
  sql: `CREATE UNIQUE INDEX workspace_author_intent_workflow
    ON workspace_author_intents(json_extract(source_json, '$.creation.workflowId'))
    WHERE json_extract(source_json, '$.kind') = 'ai-generated';`,
};

interface Row {
  id: string;
  project_id: string;
  version: number;
  state_version: number;
  status: AuthorIntent["status"];
  content_json: string;
  source_json: string;
  base_adopted_id: string | null;
  adopted_at: string | null;
  created_at: string;
  updated_at: string;
}
type Result =
  | { value: AuthorIntent; status: 200 | 201 }
  | {
      status: 400 | 404 | 409 | 412 | 503;
      code: string;
      detail: string;
    };
interface RequestContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const projectParams = z.object({ projectId: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });
const pageQuery = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const error = (
  status: 400 | 404 | 409 | 412 | 503,
  code: string,
  detail: string,
): Result => ({ status, code, detail });

function event(
  tx: UnitOfWorkTransaction,
  action: "previewed" | "adopted" | "discarded" | "conflicted",
  row: Row,
) {
  // No intent text, legacy source fields, prompt, credentials or paths.
  tx.append({
    type: `workspace.author-intent-${action}.v1`,
    pluginId: "workspace",
    aggregateType: "author-intent",
    aggregateId: row.id,
    aggregateVersion: row.state_version,
    payload: {
      id: row.id,
      projectId: row.project_id,
      version: row.version,
      stateVersion: row.state_version,
      status: row.status,
    },
  });
}

export function createAuthorIntentService(
  context: PluginContext,
  readProject: (tx: UnitOfWorkTransaction, id: string) => Project | undefined,
  sourcesCurrent: (
    projectId: string,
    basis: AuthorIntentCreationBasis,
  ) => boolean = () => false,
) {
  // Resolve peer-owned source reads BEFORE the Workspace transaction. All calls
  // are synchronous in this Core; there is no async gap before the head CAS.
  const execute = <T>(
    work: (
      tx: UnitOfWorkTransaction,
      states: Map<string, boolean>,
      reviews: Map<string, CreationWorkflow | undefined>,
    ) => T,
    reviewIntentId?: string,
  ): T => {
    const rows = context.uow.execute((tx) =>
      tx.all<Row>(
        "SELECT * FROM workspace_author_intents WHERE status <> 'adopted' AND json_extract(source_json, '$.kind') = 'ai-generated'",
      ),
    );
    const states = new Map(
      rows.map((row) => {
        const source = AuthorIntentSourceSchema.parse(
          JSON.parse(row.source_json),
        );
        return [
          row.id,
          source.kind === "ai-generated" &&
            sourcesCurrent(row.project_id, source.creation.basis),
        ] as const;
      }),
    );
    const reviews = new Map<string, CreationWorkflow | undefined>();
    // Resolve only this explicit AI proposal's original public workflow before
    // the Workspace transaction. Absence/outage never becomes a source conflict.
    for (const row of rows.filter((row) => row.id === reviewIntentId)) {
      const source = AuthorIntentSourceSchema.parse(
        JSON.parse(row.source_json),
      );
      if (source.kind === "ai-generated") {
        try {
          reviews.set(
            row.id,
            optionalService(context, CREATION_WORKFLOW_SERVICE)?.get(
              source.creation.workflowId,
            ),
          );
        } catch {
          reviews.set(row.id, undefined);
        }
      }
    }
    return context.uow.execute((tx) => work(tx, states, reviews));
  };
  const readRow = (tx: UnitOfWorkTransaction, id: string) =>
    tx.get<Row>("SELECT * FROM workspace_author_intents WHERE id = ?", id);
  const headId = (tx: UnitOfWorkTransaction, projectId: string) =>
    tx.get<{ intent_id: string }>(
      "SELECT intent_id FROM workspace_author_intent_heads WHERE project_id = ?",
      projectId,
    )?.intent_id;
  const decode = (
    tx: UnitOfWorkTransaction,
    row: Row,
    states: Map<string, boolean>,
  ): AuthorIntent => {
    const source = JSON.parse(row.source_json) as AuthorIntent["source"];
    const head = headId(tx, row.project_id);
    const sourceCurrent =
      row.status === "adopted" ||
      (readProject(tx, row.project_id)?.version === source.projectVersion &&
        head === (row.base_adopted_id ?? undefined) &&
        (source.kind !== "ai-generated" || states.get(row.id) === true));
    return AuthorIntentSchema.parse({
      id: row.id,
      projectId: row.project_id,
      version: row.version,
      stateVersion: row.state_version,
      status: row.status,
      content: JSON.parse(row.content_json),
      source,
      ...(row.base_adopted_id ? { baseAdoptedId: row.base_adopted_id } : {}),
      ...(row.adopted_at ? { adoptedAt: row.adopted_at } : {}),
      sourceState: sourceCurrent ? "current" : "stale",
      isCurrent: head === row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  };
  const publicService: WorkspaceAuthorIntentService = {
    get: (projectId, id) =>
      execute((tx, states) => {
        if (!readProject(tx, projectId)) return undefined;
        const row = readRow(tx, id);
        return row?.project_id === projectId
          ? decode(tx, row, states)
          : undefined;
      }),
    current: (projectId) =>
      execute((tx, states) => {
        if (!readProject(tx, projectId)) return undefined;
        const id = headId(tx, projectId);
        const row = id ? readRow(tx, id) : undefined;
        return row ? decode(tx, row, states) : undefined;
      }),
  };
  const replay = (
    tx: UnitOfWorkTransaction,
    key: string,
    digest: string,
    states: Map<string, boolean>,
  ): Result | undefined => {
    const row = tx.get<{ request_hash: string; result_json: string }>(
      "SELECT request_hash, result_json FROM workspace_author_intent_requests WHERE request_key = ?",
      key,
    );
    if (!row) return undefined;
    if (row.request_hash !== digest)
      return error(
        409,
        "IDEMPOTENCY_CONFLICT",
        "此幂等键已用于不同的作者意图操作。",
      );
    const stored = JSON.parse(row.result_json) as Result;
    if (!("value" in stored)) return stored;
    const current = readRow(tx, stored.value.id);
    if (!current || !readProject(tx, current.project_id))
      return error(404, "NOT_FOUND", "未找到作者意图。");
    // Idempotency repeats the business operation, not a stale read projection.
    return { status: stored.status, value: decode(tx, current, states) };
  };
  const remember = (
    tx: UnitOfWorkTransaction,
    key: string,
    digest: string,
    projectId: string,
    result: Result,
  ): Result => {
    tx.run(
      "INSERT INTO workspace_author_intent_requests(request_key, request_hash, project_id, result_json) VALUES (?, ?, ?, ?)",
      key,
      digest,
      projectId,
      JSON.stringify(result),
    );
    return result;
  };
  return {
    publicService,
    generated: (
      workflow: CreationWorkflow,
      content: AuthorIntentContent,
    ): AuthorIntent => {
      const basis = workflow.authorIntentBasis;
      if (!basis || !workflow.sourceSnapshotId || workflow.runIds.length === 0)
        throw new Error("意图候选缺少实际冻结来源或模型运行身份。");
      const source = AuthorIntentSourceSchema.parse({
        kind: "ai-generated",
        projectVersion: basis.request.projectVersion,
        creation: {
          workflowId: workflow.id,
          sourceSnapshotId: workflow.sourceSnapshotId,
          runIds: workflow.runIds,
          engineKind: workflow.input.engineKind,
          basis,
        },
      });
      const fresh = sourcesCurrent(workflow.input.projectId, basis);
      return execute((tx, states) => {
        const existing = tx.get<Row>(
          "SELECT * FROM workspace_author_intents WHERE json_extract(source_json, '$.creation.workflowId') = ? AND json_extract(source_json, '$.kind') = 'ai-generated'",
          workflow.id,
        );
        if (existing) {
          if (
            existing.project_id !== workflow.input.projectId ||
            hash(JSON.parse(existing.content_json)) !== hash(content) ||
            hash(JSON.parse(existing.source_json)) !== hash(source)
          )
            throw new Error("此工作流已绑定另一份不可变意图候选。");
          return decode(tx, existing, states);
        }
        if (!readProject(tx, workflow.input.projectId))
          throw new Error("未找到项目。");
        const version =
          (tx.get<{ latest: number }>(
            "SELECT COALESCE(MAX(version), 0) AS latest FROM workspace_author_intents WHERE project_id = ?",
            workflow.input.projectId,
          )?.latest ?? 0) + 1;
        const id = crypto.randomUUID();
        const at = new Date().toISOString();
        tx.run(
          `INSERT INTO workspace_author_intents(id, project_id, version, state_version, status, content_json, source_json, base_adopted_id, adopted_at, created_at, updated_at)
           VALUES (?, ?, ?, 0, 'pending', ?, ?, ?, NULL, ?, ?)`,
          id,
          workflow.input.projectId,
          version,
          JSON.stringify(content),
          JSON.stringify(source),
          basis.request.baseAdoptedId ?? null,
          at,
          at,
        );
        states.set(id, fresh);
        const row = readRow(tx, id)!;
        event(tx, "previewed", row);
        // Drift while generating preserves a visible stale candidate, not a
        // silently rebased proposal or loss of the model result.
        return decode(tx, row, states);
      });
    },
    byWorkflow: (projectId: string, workflowId: string) =>
      execute((tx, states) => {
        const row = tx.get<Row>(
          "SELECT * FROM workspace_author_intents WHERE project_id = ? AND json_extract(source_json, '$.creation.workflowId') = ? AND json_extract(source_json, '$.kind') = 'ai-generated'",
          projectId,
          workflowId,
        );
        return row && readProject(tx, projectId)
          ? decode(tx, row, states)
          : undefined;
      }),
    current: (projectId: string) =>
      execute((tx, states) => {
        const project = readProject(tx, projectId);
        if (!project) return undefined;
        const id = headId(tx, projectId);
        const row = id ? readRow(tx, id) : undefined;
        const current = row ? decode(tx, row, states) : undefined;
        return {
          projectVersion: project.version,
          ...(current ? { current } : {}),
          legacyReviewRequired: !current,
        };
      }),
    get: (id: string) =>
      execute((tx, states) => {
        const row = readRow(tx, id);
        return row && readProject(tx, row.project_id)
          ? decode(tx, row, states)
          : undefined;
      }),
    list: (projectId: string, query: z.infer<typeof pageQuery>) =>
      execute((tx, states) => {
        if (!readProject(tx, projectId))
          return error(404, "NOT_FOUND", "未找到项目。");
        const cursor = query.cursor ? readRow(tx, query.cursor) : undefined;
        if (query.cursor && (!cursor || cursor.project_id !== projectId))
          return error(400, "INVALID_CURSOR", "游标不属于此项目或已经失效。");
        const rows = tx.all<Row>(
          `SELECT * FROM workspace_author_intents WHERE project_id = ?${cursor ? " AND version < ?" : ""} ORDER BY version DESC LIMIT ?`,
          projectId,
          ...(cursor ? [cursor.version] : []),
          query.limit + 1,
        );
        return {
          items: rows.slice(0, query.limit).map((row) => {
            const value = decode(tx, row, states);
            return AuthorIntentSummarySchema.parse({
              ...value,
              sourceKind: value.source.kind,
              sourceProjectVersion: value.source.projectVersion,
              ...(value.source.kind === "ai-generated"
                ? { workflowId: value.source.creation.workflowId }
                : {}),
            });
          }),
          ...(rows.length > query.limit
            ? { nextCursor: rows[query.limit - 1]!.id }
            : {}),
        };
      }),
    preview: (
      projectId: string,
      input: AuthorIntentPreviewInput,
      key: string,
    ): Result =>
      execute((tx, states) => {
        const digest = hash({ operation: "preview", projectId, input });
        const previous = replay(tx, key, digest, states);
        if (previous) return previous;
        const project = readProject(tx, projectId);
        if (!project) return error(404, "NOT_FOUND", "未找到项目。");
        if (
          project.version !== input.projectVersion ||
          headId(tx, projectId) !== input.baseAdoptedId
        )
          return error(
            409,
            "SOURCE_CONFLICT",
            "项目设定或当前作者意图已变化，请刷新并重新预览。",
          );
        const version =
          (tx.get<{ latest: number }>(
            "SELECT COALESCE(MAX(version), 0) AS latest FROM workspace_author_intents WHERE project_id = ?",
            projectId,
          )?.latest ?? 0) + 1;
        const at = new Date().toISOString();
        const id = crypto.randomUUID();
        const source: AuthorIntent["source"] = {
          kind: input.sourceKind,
          projectVersion: project.version,
        };
        if (input.sourceKind === "legacy-project") {
          source.legacyFields = Object.fromEntries(
            [
              "targetAudience",
              "coreHook",
              "emotionalCore",
              "coreSellingPoint",
              "synopsis",
              "styleGuide",
              "productionBrief",
            ].flatMap((field) => {
              const value = project[field as keyof typeof project];
              return typeof value === "string" ? [[field, value]] : [];
            }),
          );
        }
        tx.run(
          `INSERT INTO workspace_author_intents(id, project_id, version, state_version, status, content_json, source_json, base_adopted_id, adopted_at, created_at, updated_at)
        VALUES (?, ?, ?, 0, 'pending', ?, ?, ?, NULL, ?, ?)`,
          id,
          projectId,
          version,
          JSON.stringify(input.content),
          JSON.stringify(source),
          input.baseAdoptedId ?? null,
          at,
          at,
        );
        const row = readRow(tx, id)!;
        event(tx, "previewed", row);
        return remember(tx, key, digest, projectId, {
          status: 201,
          value: decode(tx, row, states),
        });
      }),
    transition: (
      id: string,
      action: "adopt" | "discard",
      stateVersion: number,
      key: string,
    ): Result =>
      execute(
        (tx, states, reviews) => {
          const digest = hash({ operation: action, id, stateVersion });
          const previous = replay(tx, key, digest, states);
          if (previous) return previous;
          const row = readRow(tx, id);
          if (!row || !readProject(tx, row.project_id))
            return error(404, "NOT_FOUND", "未找到作者意图。");
          if (
            (action === "discard" && row.status === "discarded") ||
            (action === "adopt" && row.status === "adopted")
          )
            return remember(tx, key, digest, row.project_id, {
              status: 200,
              value: decode(tx, row, states),
            });
          if (row.state_version !== stateVersion)
            return error(
              412,
              "PRECONDITION_FAILED",
              "意图状态已变化，请重新读取预览。",
            );
          if (
            action === "adopt"
              ? row.status !== "pending"
              : !["pending", "conflicted"].includes(row.status)
          )
            return error(
              409,
              "CONFLICT",
              "此历史状态不允许该操作；已采用内容不能被丢弃或重新覆盖。",
            );
          const source = AuthorIntentSourceSchema.parse(
            JSON.parse(row.source_json),
          );
          if (action === "adopt" && source.kind === "ai-generated") {
            const workflow = reviews.get(row.id);
            if (!workflow)
              return error(
                503,
                "QUALITY_UNAVAILABLE",
                "原质量工作流未核对，候选保持，不切最新来源。",
              );
            if (workflow.issues.some((issue) => issue.severity === "error"))
              return error(
                409,
                "QUALITY_REVIEW_REQUIRED",
                "候选仍有未解决的严重问题；请保持原来源修订复检，原记录保持。",
              );
          }
          const at = new Date().toISOString();
          if (
            action === "adopt" &&
            decode(tx, row, states).sourceState === "stale"
          ) {
            tx.run(
              "UPDATE workspace_author_intents SET status = 'conflicted', state_version = state_version + 1, updated_at = ? WHERE id = ?",
              at,
              id,
            );
            event(tx, "conflicted", readRow(tx, id)!);
            return remember(
              tx,
              key,
              digest,
              row.project_id,
              error(
                409,
                "SOURCE_CONFLICT",
                "项目设定、选定来源或当前已采用意图已变化，旧候选未覆盖正式内容。",
              ),
            );
          }
          tx.run(
            "UPDATE workspace_author_intents SET status = ?, state_version = state_version + 1, adopted_at = ?, updated_at = ? WHERE id = ?",
            action === "adopt" ? "adopted" : "discarded",
            action === "adopt" ? at : null,
            at,
            id,
          );
          if (action === "adopt")
            tx.run(
              "INSERT INTO workspace_author_intent_heads(project_id, intent_id) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET intent_id = excluded.intent_id",
              row.project_id,
              id,
            );
          const updated = readRow(tx, id)!;
          event(tx, action === "adopt" ? "adopted" : "discarded", updated);
          return remember(tx, key, digest, row.project_id, {
            status: 200,
            value: decode(tx, updated, states),
          });
        },
        action === "adopt" ? id : undefined,
      ),
  };
}

function problem(
  _c: RequestContext,
  status: number,
  code: string,
  detail: string,
) {
  return new Response(
    JSON.stringify({
      type: `https://dramaip.local/problems/${code.toLowerCase()}`,
      title: detail,
      detail,
      status,
      code,
      traceId: crypto.randomUUID(),
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}
export function authorIntentRoutes(
  service: ReturnType<typeof createAuthorIntentService>,
  catalog?: (projectId: string) => AuthorIntentSourceCatalog | undefined,
): RouteContribution[] {
  const routes: RouteContribution[] = [];
  const respond = (c: RequestContext, result: Result) => {
    if (!("value" in result))
      return problem(c, result.status, result.code, result.detail);
    c.header("ETag", `"${result.value.stateVersion}"`);
    return c.json(result.value, result.status);
  };
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operationId: string,
    params: typeof projectParams | typeof idParams,
    response: z.ZodType,
    handler: (c: RequestContext) => Response | Promise<Response>,
    body?: z.ZodType,
    query?: typeof pageQuery,
    status: 200 | 201 = 200,
  ) => {
    routes.push(
      defineRouteContribution({
        id: `workspace:${operationId}`,
        pluginId: "workspace",
        method,
        path,
        operationId,
        ...(method === "post"
          ? {
              policy: {
                idempotency: "required",
                idempotencyReplay: "handler",
                ...(operationId !== "author-intents.preview"
                  ? { concurrency: "if-match-required" }
                  : {}),
              } as const,
            }
          : {}),
        declaration: createRoute({
          method,
          path,
          operationId,
          tags: ["author-intents"],
          request: {
            params,
            ...(method === "post"
              ? {
                  headers: z.object({
                    "idempotency-key": z.string(),
                    ...(operationId !== "author-intents.preview"
                      ? { "if-match": z.string() }
                      : {}),
                  }),
                }
              : {}),
            ...(query ? { query } : {}),
            ...(body
              ? {
                  body: {
                    required: true,
                    content: { "application/json": { schema: body } },
                  },
                }
              : {}),
          },
          responses: {
            [status]: {
              description: "Author intent result",
              content: { "application/json": { schema: response } },
            },
            ...Object.fromEntries(
              [400, 404, 409, 412, 428, 503].map((code) => [
                code,
                {
                  description: "Request cannot be completed",
                  content: {
                    "application/problem+json": {
                      schema: ProblemDetailsSchema,
                    },
                  },
                },
              ]),
            ),
          },
        }),
        handler: async (c) => {
          try {
            return await handler(c);
          } catch (error) {
            if (error instanceof AuthorIntentSourcesUnavailableError)
              return problem(
                c,
                503,
                "AUTHOR_INTENT_SOURCE_UNAVAILABLE",
                error.message,
              );
            throw error;
          }
        },
      }),
    );
  };
  if (catalog)
    add(
      "get",
      "/api/v2/projects/{projectId}/author-intent-sources",
      "author-intents.sources",
      projectParams,
      AuthorIntentSourceCatalogSchema,
      (c) => {
        const value = catalog(c.req.param("projectId"));
        return value
          ? c.json(value)
          : problem(c, 404, "NOT_FOUND", "未找到项目。");
      },
    );
  add(
    "get",
    "/api/v2/projects/{projectId}/author-intents",
    "author-intents.list",
    projectParams,
    AuthorIntentPageSchema,
    (c) => {
      const query = pageQuery.safeParse({
        cursor: c.req.query("cursor"),
        limit: c.req.query("limit"),
      });
      if (!query.success)
        return problem(c, 400, "VALIDATION_ERROR", "作者意图分页参数无效。");
      const result = service.list(c.req.param("projectId"), query.data);
      return "items" in result ? c.json(result) : respond(c, result);
    },
    undefined,
    pageQuery,
  );
  add(
    "get",
    "/api/v2/projects/{projectId}/author-intent",
    "author-intents.current",
    projectParams,
    AuthorIntentCurrentSchema,
    (c) => {
      const value = service.current(c.req.param("projectId"));
      return value
        ? c.json(value)
        : problem(c, 404, "NOT_FOUND", "未找到项目。");
    },
  );
  add(
    "get",
    "/api/v2/author-intents/{id}",
    "author-intents.get",
    idParams,
    AuthorIntentSchema,
    (c) => {
      const value = service.get(c.req.param("id"));
      return value
        ? respond(c, { status: 200, value })
        : problem(c, 404, "NOT_FOUND", "未找到作者意图。");
    },
  );
  add(
    "post",
    "/api/v2/projects/{projectId}/author-intents",
    "author-intents.preview",
    projectParams,
    AuthorIntentSchema,
    async (c) => {
      const key = c.req.header("Idempotency-Key");
      if (!key?.trim() || key.length > 200)
        return problem(
          c,
          428,
          "IDEMPOTENCY_KEY_REQUIRED",
          "预览必须提供幂等键。",
        );
      const input = AuthorIntentPreviewInputSchema.safeParse(
        await c.req.json(),
      );
      return input.success
        ? respond(c, service.preview(c.req.param("projectId"), input.data, key))
        : problem(
            c,
            400,
            "VALIDATION_ERROR",
            "请完整填写作者意图；旧项目字段不能自动视为正式意图。",
          );
    },
    AuthorIntentPreviewInputSchema,
    undefined,
    201,
  );
  for (const action of ["adopt", "discard"] as const) {
    const schema =
      action === "adopt" ? AuthorIntentAdoptInputSchema : z.object({});
    add(
      "post",
      `/api/v2/author-intents/{id}/${action}`,
      `author-intents.${action}`,
      idParams,
      AuthorIntentSchema,
      async (c) => {
        const key = c.req.header("Idempotency-Key");
        const match = /^"(\d+)"$/.exec(c.req.header("If-Match") ?? "");
        if (
          !key?.trim() ||
          key.length > 200 ||
          !match ||
          !Number.isSafeInteger(Number(match[1]))
        )
          return problem(
            c,
            428,
            "PRECONDITION_REQUIRED",
            "此操作必须提供预览状态版本与幂等键。",
          );
        const input = schema.safeParse(await c.req.json());
        return input.success
          ? respond(
              c,
              service.transition(
                c.req.param("id"),
                action,
                Number(match[1]),
                key,
              ),
            )
          : problem(
              c,
              400,
              "VALIDATION_ERROR",
              "采用必须明确确认，不能自动采用。",
            );
      },
      schema,
    );
  }
  return routes;
}
