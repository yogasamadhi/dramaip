import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  PRODUCTION_SCREENPLAY_SOURCE_SERVICE,
  ScreenplaySourceSchema,
  ScreenplaySourceDocumentSchema,
  ScreenplaySourcePageSchema,
  type ScreenplaySource,
  EpisodeDevelopmentBasisSchema,
} from "@dramaip/contracts/production";
import { CREATION_WORKFLOW_SERVICE } from "@dramaip/contracts/creation";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  optionalService,
  provideService,
  type PluginContext,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";

interface ScriptRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  version: number;
  created_at: string;
  payload_json: string;
}
interface DocumentRow {
  id: string;
  script_record_id: string;
  project_id: string;
  title: string;
  version: number;
  source_format: string;
  blocks_json: string;
  loss_report_json: string;
}
interface Http {
  req: { param(name: string): string; query(name: string): string | undefined };
  header(name: string, value: string): void;
  json(body: unknown, status?: number): Response;
}
class ReadError extends Error {
  constructor(
    readonly status: 400 | 404 | 503,
    message: string,
  ) {
    super(message);
  }
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const query = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Production-owned read: never sync/initialize a document, parse Fountain, or allocate IDs. */
export function registerScreenplaySources(context: PluginContext) {
  const project = (id: string) => {
    const workspace = optionalService(context, WORKSPACE_PROJECT_SERVICE);
    if (!workspace) throw new ReadError(503, "项目读取服务暂不可用。");
    if (!workspace.get(id)) throw new ReadError(404, "实际项目不存在。");
  };
  const snapshot = (
    tx: UnitOfWorkTransaction,
    script: ScriptRow,
  ): ScreenplaySource => {
    const base = {
      projectId: script.project_id,
      scriptId: script.id,
      scriptVersion: script.version,
      ...(script.parent_id ? { parentId: script.parent_id } : {}),
      title: script.title,
    };
    const row = tx.get<DocumentRow>(
      "SELECT * FROM screenplay_documents WHERE script_record_id = ?",
      script.id,
    );
    if (!row)
      return {
        ...base,
        source: { state: "unavailable", reason: "saved-document-missing" },
      };
    try {
      const document = {
        id: row.id,
        version: row.version,
        title: row.title,
        sourceFormat: row.source_format,
        blocks: JSON.parse(row.blocks_json) as unknown[],
        lossReport: JSON.parse(row.loss_report_json) as unknown,
      };
      const parsed = ScreenplaySourceDocumentSchema.safeParse(document);
      if (
        !parsed.success ||
        row.project_id !== script.project_id ||
        row.script_record_id !== script.id ||
        new Set(parsed.data.blocks.map((block) => block.id)).size !==
          parsed.data.blocks.length
      )
        throw new Error("Invalid saved source");
      // Hash the saved bytes/identity, not normalized blocks or a regenerated export.
      const contentHash = digest({
        documentId: row.id,
        scriptId: script.id,
        projectId: script.project_id,
        version: row.version,
        title: row.title,
        sourceFormat: row.source_format,
        blocksJson: row.blocks_json,
        lossReportJson: row.loss_report_json,
      });
      return {
        ...base,
        source: {
          state: "available",
          contentHash,
          document: document as typeof parsed.data,
          policyDependencies: [],
        },
      };
    } catch {
      return {
        ...base,
        source: { state: "unavailable", reason: "invalid-saved-document" },
      };
    }
  };
  const get = (projectId: string, scriptId: string) => {
    project(projectId);
    const read = context.uow.execute((tx) => {
      const script = tx.get<ScriptRow>(
        "SELECT * FROM production_records WHERE id = ? AND project_id = ? AND kind = 'scripts'",
        scriptId,
        projectId,
      );
      if (!script) return undefined;
      return {
        value: snapshot(tx, script),
        payload: script.payload_json,
        results: tx.all<{ value_json: string }>(
          "SELECT value_json FROM production_episode_results WHERE project_id = ? AND json_extract(value_json, '$.scriptId') = ?",
          projectId,
          scriptId,
        ),
        receipts: tx.all<{ workflow_id: string; result_json: string }>(
          "SELECT workflow_id, result_json FROM production_creation_adoptions WHERE result_json = '{}' OR EXISTS (SELECT 1 FROM json_each(result_json) WHERE value = ?)",
          scriptId,
        ),
      };
    });
    if (!read || read.value.source.state !== "available") return read?.value;
    try {
      const dependencies = new Map<
        string,
        { sourceId: string; sourceVersion: number; fieldPath: string }
      >();
      const add = (source: {
        sourceId: string;
        sourceVersion: number;
        fieldPath: string;
      }) => {
        // Keep every historical denial identity. This is privacy inheritance,
        // not an assertion that old upstream semantics remain current.
        dependencies.set(JSON.stringify(source), source);
      };
      for (const row of read.results) {
        const result = JSON.parse(row.value_json) as {
          scriptId?: string;
          projectId?: string;
          basis?: unknown;
        };
        if (result.scriptId !== scriptId || result.projectId !== projectId)
          throw new Error("Foreign receipt");
        const basis = EpisodeDevelopmentBasisSchema.parse(result.basis);
        for (const ref of basis.references) {
          add({
            sourceId: ref.sourceId,
            sourceVersion: ref.sourceVersion,
            fieldPath: ref.fieldPath,
          });
        }
      }
      let markerBound = false;
      const marker: unknown = (
        JSON.parse(read.payload) as Record<string, unknown>
      ).sourceWorkflowId;
      const workflows = optionalService(context, CREATION_WORKFLOW_SERVICE);
      // Read another owner only AFTER leaving the synchronous SQLite transaction.
      for (const receipt of read.receipts) {
        if (!workflows) throw new Error("Workflow source unavailable");
        const workflow = workflows.get(receipt.workflow_id);
        const materialized = Object.values(
          JSON.parse(receipt.result_json) as Record<string, unknown>,
        ).includes(scriptId);
        const revised =
          workflow?.input.operation === "script-revision" &&
          workflow.input.targetId === scriptId;
        if (!materialized && !revised) continue;
        if (
          !workflow ||
          workflow.stage !== "applied" ||
          workflow.input.projectId !== projectId
        )
          throw new Error("Invalid adopted receipt");
        if (receipt.workflow_id === marker) markerBound = true;
        for (const dependency of workflow.referenceVersions) add(dependency);
      }
      if (marker !== undefined && !markerBound)
        throw new Error("Copied workflow marker is not lineage");
      const value = {
        ...read.value,
        source: {
          ...read.value.source,
          policyDependencies: [...dependencies.values()].sort((a, b) =>
            JSON.stringify(a).localeCompare(JSON.stringify(b)),
          ),
        },
      };
      if (!ScreenplaySourceSchema.safeParse(value).success)
        throw new Error("Source dependency capacity exceeded");
      return value;
    } catch {
      return {
        ...read.value,
        source: {
          state: "unavailable" as const,
          reason: "lineage-unavailable" as const,
        },
      };
    }
  };
  const list = (
    projectId: string,
    options: { cursor?: string; limit?: number } = {},
  ) => {
    project(projectId);
    const parsed = query.safeParse(options);
    if (!parsed.success) throw new ReadError(400, "实际剧本来源分页参数无效。");
    return context.uow.execute((tx) => {
      const cursor = parsed.data.cursor
        ? tx.get<ScriptRow>(
            "SELECT * FROM production_records WHERE id = ? AND project_id = ? AND kind = 'scripts'",
            parsed.data.cursor,
            projectId,
          )
        : undefined;
      if (parsed.data.cursor && !cursor)
        throw new ReadError(400, "游标不是本项目的实际剧本。");
      const rows = cursor
        ? tx.all<ScriptRow>(
            "SELECT * FROM production_records WHERE project_id = ? AND kind = 'scripts' AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
            projectId,
            cursor.created_at,
            cursor.created_at,
            cursor.id,
            parsed.data.limit + 1,
          )
        : tx.all<ScriptRow>(
            "SELECT * FROM production_records WHERE project_id = ? AND kind = 'scripts' ORDER BY created_at DESC, id DESC LIMIT ?",
            projectId,
            parsed.data.limit + 1,
          );
      const items = rows.slice(0, parsed.data.limit).map((row) => {
        const { source, ...identity } = snapshot(tx, row);
        return { ...identity, state: source.state };
      });
      return ScreenplaySourcePageSchema.parse({
        projectId,
        items,
        ...(rows.length > parsed.data.limit
          ? { nextCursor: items.at(-1)!.scriptId }
          : {}),
      });
    });
  };
  context.effect(
    () =>
      provideService(context, PRODUCTION_SCREENPLAY_SOURCE_SERVICE, {
        get,
        list,
      }),
    `service:${PRODUCTION_SCREENPLAY_SOURCE_SERVICE.id}`,
  );
  for (const action of ["list", "get"] as const) {
    const path =
      `/api/v2/projects/{projectId}/screenplay-sources${action === "get" ? "/{scriptId}" : ""}` as const;
    const operationId = `screenplaySources.${action}`;
    const response =
      action === "get" ? ScreenplaySourceSchema : ScreenplaySourcePageSchema;
    const contribution = defineRouteContribution({
      id: `production:screenplay-sources-${action}`,
      pluginId: "production",
      method: "get",
      path,
      operationId,
      policy: { idempotency: "forbidden", concurrency: "optional" },
      declaration: createRoute({
        method: "get",
        path,
        operationId,
        tags: ["production"],
        request: {
          params: z.object({
            projectId: z.string().uuid(),
            ...(action === "get" ? { scriptId: z.string().uuid() } : {}),
          }),
          ...(action === "list" ? { query } : {}),
        },
        responses: {
          200: {
            description:
              "Read the exact already-saved screenplay source without initialization",
            content: { "application/json": { schema: response } },
          },
          ...Object.fromEntries(
            [400, 404, 503].map((status) => [
              status,
              {
                description: "Source unavailable or invalid identity",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            ]),
          ),
        },
      }),
      handler: (http: Http) => {
        try {
          const projectId = http.req.param("projectId");
          const result =
            action === "get"
              ? get(projectId, http.req.param("scriptId"))
              : list(projectId, {
                  cursor: http.req.query("cursor"),
                  limit:
                    http.req.query("limit") === undefined
                      ? undefined
                      : Number(http.req.query("limit")),
                });
          if (!result) throw new ReadError(404, "原剧本不存在或不属于本项目。");
          http.header("ETag", `"${digest(result)}"`);
          return http.json(result);
        } catch (cause) {
          if (!(cause instanceof ReadError)) throw cause;
          return Response.json(
            {
              type: "about:blank",
              title: "Screenplay source read failed",
              status: cause.status,
              detail: cause.message,
              code: "SCREENPLAY_SOURCE_READ_FAILED",
              traceId: crypto.randomUUID(),
            },
            {
              status: cause.status,
              headers: { "Content-Type": "application/problem+json" },
            },
          );
        }
      },
    });
    context.effect(
      () => context.http.register(contribution),
      `route:${contribution.id}`,
    );
  }
}
