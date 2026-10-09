import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  CREATION_WORKFLOW_SERVICE,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import {
  KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
  NarrativeIndexCatalogSchema,
  NarrativeIndexDetailSchema,
} from "@dramaip/contracts/knowledge";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  WRITING_VOLUME_SERVICE,
  WRITING_RESOURCE_SERVICE,
  type WritingVolume,
} from "@dramaip/contracts/writing";
import {
  optionalService,
  provideService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
} from "@dramaip/plugin-api/internal";
import {
  buildNarrativeIndex,
  type IndexRecord,
} from "./narrative-index-content.js";

// Historical workflow-only receipts cannot prove which generic resource was
// adopted. Do not backfill invented record identities; future adoption records
// exact membership in the same transaction as the Knowledge write.
export const narrativeIndexMigration: PluginMigration = {
  id: "knowledge.0007.narrative-index-receipts",
  pluginId: "knowledge",
  version: "3.0.0-alpha.4",
  dependsOn: ["knowledge.0006.creation-adoption"],
  sql: "CREATE TABLE knowledge_creation_record_receipts (record_id TEXT PRIMARY KEY REFERENCES knowledge_records(id) ON DELETE CASCADE, workflow_id TEXT NOT NULL); CREATE INDEX knowledge_record_receipt_workflow ON knowledge_creation_record_receipts(workflow_id);",
};
class IndexError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type HttpContext = {
  req: {
    param(name: string): string;
    header(name: string): string | undefined;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
};
export function registerNarrativeIndex(context: PluginContext) {
  const read = (projectId: string) => {
    const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
      projectId,
    );
    if (!project) throw new IndexError(404, "项目不存在。");
    const writing = optionalService(context, WRITING_CHAPTER_SERVICE);
    if (!writing)
      throw new IndexError(503, "正文来源暂不可用，不生成虚构索引。");
    const records: IndexRecord[] = context.uow.execute((tx) => {
      const rows = tx
        .all<{
          id: string;
          kind: string;
          project_id: string;
          parent_id: string | null;
          title: string;
          payload_json: string;
          version: number;
          adopted: number;
        }>(
          "SELECT r.*, EXISTS(SELECT 1 FROM knowledge_creation_record_receipts m JOIN knowledge_creation_adoptions a ON a.workflow_id = m.workflow_id WHERE m.record_id = r.id AND m.workflow_id = json_extract(r.payload_json, '$.sourceWorkflowId')) AS adopted FROM knowledge_records r WHERE r.project_id = ? AND r.kind IN ('chapter-memories','character-states','story-events','foreshadowings') ORDER BY r.id",
          projectId,
        )
        .map((row) => ({
          id: row.id,
          kind: row.kind,
          projectId: row.project_id,
          parentId: row.parent_id ?? undefined,
          title: row.title,
          payload: JSON.parse(row.payload_json),
          version: row.version,
          adopted: Boolean(row.adopted),
        }));
      // Legacy Story Bible memories lack exact workflow/quote/record receipts.
      // Inventory them as excluded metadata, never as trusted summaries.
      const legacy = tx
        .all<{
          id: string;
          chapter_id: string;
          title: string;
          payload_json: string;
          version: number;
        }>(
          "SELECT id, chapter_id, title, payload_json, version FROM knowledge_chapter_memories WHERE project_id = ? ORDER BY id",
          projectId,
        )
        .map((row) => ({
          id: row.id,
          kind: "chapter-memories",
          projectId,
          parentId: row.chapter_id,
          title: row.title,
          payload: JSON.parse(row.payload_json),
          version: row.version,
          adopted: false,
        }));
      return [...rows, ...legacy];
    });
    const unavailable: string[] = [];
    const creation = optionalService(context, CREATION_WORKFLOW_SERVICE);
    if (!creation)
      unavailable.push("创作运行来源暂不可用，派生资料未计为有效摘要。");
    const workflows = new Map<string, CreationWorkflow | undefined>();
    for (const record of records) {
      const id = record.payload.sourceWorkflowId;
      if (record.adopted && typeof id === "string" && !workflows.has(id))
        workflows.set(id, creation?.get(id));
    }
    const volumes: WritingVolume[] = [];
    const longform = optionalService(context, WRITING_VOLUME_SERVICE);
    if (longform) {
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = longform.list(projectId, { cursor, limit: 200 });
        volumes.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new IndexError(503, "卷目录分页异常，索引未完成。");
        if (cursor) seen.add(cursor);
      } while (cursor);
    } else unavailable.push("卷目录暂不可用，不能判断完整卷归属。");
    const resources = optionalService(context, WRITING_RESOURCE_SERVICE);
    if (!resources) unavailable.push("故事弧目录暂不可用，不能判断完整范围。");
    return buildNarrativeIndex({
      project,
      chapters: writing.list(projectId),
      volumes,
      arcs: resources?.list("story-arcs", projectId) ?? [],
      records,
      workflows,
      unavailable,
    });
  };
  const service = {
    catalog: (projectId: string) =>
      NarrativeIndexCatalogSchema.parse(read(projectId).catalog),
    chapter: (projectId: string, chapterId: string) => {
      const detail = read(projectId).details.find(
        (entry) => entry.chapter.id === chapterId,
      );
      return detail ? NarrativeIndexDetailSchema.parse(detail) : undefined;
    },
    details: (projectId: string, chapterIds: readonly string[]) => {
      const selected = new Set(chapterIds);
      return read(projectId)
        .details.filter((entry) => selected.has(entry.chapter.id))
        .map((entry) => NarrativeIndexDetailSchema.parse(entry));
    },
  };
  context.effect(
    () => provideService(context, KNOWLEDGE_NARRATIVE_INDEX_SERVICE, service),
    `service:${KNOWLEDGE_NARRATIVE_INDEX_SERVICE}`,
  );
  for (const route of [
    {
      path: "/api/v2/projects/{projectId}/narrative-context-index",
      operationId: "narrativeIndex.catalog",
      schema: NarrativeIndexCatalogSchema,
      params: z.object({ projectId: z.string().uuid() }),
      chapter: false,
    },
    {
      path: "/api/v2/projects/{projectId}/narrative-context-index/chapters/{chapterId}",
      operationId: "narrativeIndex.chapter",
      schema: NarrativeIndexDetailSchema,
      params: z.object({
        projectId: z.string().uuid(),
        chapterId: z.string().uuid(),
      }),
      chapter: true,
    },
  ] as const) {
    const contribution = defineRouteContribution({
      id: `knowledge:${route.operationId}`,
      pluginId: "knowledge",
      method: "get",
      path: route.path,
      operationId: route.operationId,
      declaration: createRoute({
        method: "get",
        path: route.path,
        operationId: route.operationId,
        tags: ["narrative-context-index"],
        request: { params: route.params },
        responses: {
          200: {
            description:
              "Local source index, not semantic validation or model context",
            content: { "application/json": { schema: route.schema } },
          },
          304: { description: "Unchanged source index" },
          404: {
            description: "Source not found",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
          503: {
            description: "Required source unavailable",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
        },
      }),
      policy: { idempotency: "forbidden", concurrency: "optional" },
      handler: (http: HttpContext) => {
        try {
          const value = route.chapter
            ? service.chapter(
                http.req.param("projectId"),
                http.req.param("chapterId"),
              )
            : service.catalog(http.req.param("projectId"));
          if (!value) throw new IndexError(404, "此章节不属于当前项目。");
          const etag = `"${value.fingerprint}"`;
          http.header("ETag", etag);
          if (http.req.header("If-None-Match") === etag)
            return http.body(null, 304);
          return http.json(value);
        } catch (cause) {
          const status = cause instanceof IndexError ? cause.status : 503;
          http.header("Content-Type", "application/problem+json");
          return http.json(
            {
              type: "https://dramaip.local/problems/narrative-index",
              code: "NARRATIVE_INDEX",
              traceId: crypto.randomUUID(),
              title: status === 404 ? "Not Found" : "Source Index Unavailable",
              status,
              detail:
                cause instanceof IndexError
                  ? cause.message
                  : "来源索引暂不可用，未计为已检查。",
            },
            status,
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
