import { creationReference } from "@dramaip/contracts/creation";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  ResearchFindingInputSchema,
  ResearchFindingPageSchema,
  ResearchFindingSchema,
  ResearchPageSchema,
  ResearchSearchInputSchema,
  ResearchSearchResponseSchema,
  ResearchSourceInputSchema,
  ResearchSourcePageSchema,
  ResearchSourceSchema,
  ResearchTopicInputSchema,
  ResearchTopicSchema,
  type KnowledgeResearchService,
  type ResearchTopic,
  type ResearchSearchResponse,
} from "@dramaip/contracts/knowledge";
import type { WorkspaceProjectService } from "@dramaip/contracts/workspace";
import type { DesktopHost } from "@dramaip/host-contracts";
import {
  defineRoute,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface TopicRow {
  id: string;
  project_id: string;
  title: string;
  query: string;
  risk_domain: ResearchTopic["riskDomain"];
  status: ResearchTopic["status"];
  version: number;
  created_at: string;
  updated_at: string;
}

interface SourceRow {
  id: string;
  topic_id: string;
  source_type:
    "duckduckgo" | "gdelt" | "wikimedia" | "rss_atom" | "manual_url" | "local";
  title: string;
  url: string | null;
  excerpt: string | null;
  published_at: string | null;
  data_date: string | null;
  retrieved_at: string;
  status: "discovered" | "adopted" | "rejected";
  created_at: string;
}

interface FindingRow {
  id: string;
  topic_id: string;
  statement: string;
  kind: "fact" | "quote" | "inference" | "creator_opinion";
  source_ids_json: string;
  status: "draft" | "supported" | "stale" | "blocked";
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
}

function topic(row: TopicRow): ResearchTopic {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    query: row.query,
    riskDomain: row.risk_domain,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function source(row: SourceRow) {
  return {
    id: row.id,
    topicId: row.topic_id,
    sourceType: row.source_type,
    title: row.title,
    ...(row.url ? { url: row.url } : {}),
    ...(row.excerpt ? { excerpt: row.excerpt } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.data_date ? { dataDate: row.data_date } : {}),
    retrievedAt: row.retrieved_at,
    status: row.status,
    createdAt: row.created_at,
  };
}

function finding(row: FindingRow) {
  return {
    id: row.id,
    topicId: row.topic_id,
    statement: row.statement,
    kind: row.kind,
    sourceIds: JSON.parse(row.source_ids_json) as string[],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  declaration: unknown,
  handler: (context: RouteContext) => Response | Promise<Response>,
): RouteContribution {
  return defineRouteContribution({ ...metadata, declaration, handler });
}

function declaration(input: {
  method: "get" | "post";
  path: string;
  operationId: string;
  params?: ZodType;
  body?: ZodType;
  response: ZodType;
  status?: 200 | 201;
}): unknown {
  const status = input.status ?? 200;
  return defineRoute({
    method: input.method,
    path: input.path,
    operationId: input.operationId,
    tags: ["research"],
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
      503: {
        description: "Capability unavailable",
        content: {
          "application/problem+json": { schema: ProblemDetailsSchema },
        },
      },
    },
  } as never);
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

/** Read a user-selected research URL through curl without a fixed search provider. */
export class CurlResearchAdapter {
  constructor(private readonly host: DesktopHost | undefined) {}

  get available(): boolean {
    return Boolean(this.host);
  }

  async search(
    query: string,
  ): Promise<Pick<ResearchSearchResponse, "results" | "fallbackUsed">> {
    const url = new URL(query.trim());
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(
        "请提供公开 HTTPS 资料网址；也可在 AI 助手中通过 curl 查找资料。",
      );
    if (!this.host) throw new Error("当前运行模式没有 curl 联网读取能力。");
    const page = await this.host.readWebPage({
      url: url.toString(),
      maxCharacters: 6000,
    });
    return {
      results: [
        {
          source: "manual_url",
          coverage:
            "通过 curl 读取指定公开网址。网页内容仅作为外部资料，需要人工核实并采用。",
          results: [
            {
              title: page.title,
              url: page.url,
              excerpt: page.content.slice(0, 4000),
            },
          ],
        },
      ],
      fallbackUsed: false,
    };
  }
}

function listTopics(
  context: PluginContext,
  projectId: string,
  options: { cursor?: string; limit?: number; status?: string } = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 100);
  return context.uow.execute((transaction) => {
    const rows = transaction.all<TopicRow>(
      `SELECT * FROM knowledge_research_topics
       WHERE project_id = ? AND (? = '' OR status = ?) AND id > ?
       ORDER BY id LIMIT ?`,
      projectId,
      options.status ?? "",
      options.status ?? "",
      options.cursor ?? "",
      limit + 1,
    );
    const items = rows.slice(0, limit).map(topic);
    const last = items.at(-1);
    return {
      items,
      ...(rows.length > limit && last ? { nextCursor: last.id } : {}),
    };
  });
}

export const researchMigrations: readonly PluginMigration[] = [
  {
    id: "knowledge.0003.creator-research",
    pluginId: "knowledge",
    version: "3.0.0-alpha.3",
    dependsOn: ["knowledge.0002.owned-records", "workspace.0005.project-modes"],
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_research_topics (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        query TEXT NOT NULL,
        risk_domain TEXT NOT NULL CHECK(risk_domain IN ('general', 'finance', 'health', 'legal')),
        status TEXT NOT NULL CHECK(status IN ('draft', 'researching', 'ready', 'archived')),
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS knowledge_research_topics_project_status
        ON knowledge_research_topics(project_id, status, id);
      CREATE TABLE IF NOT EXISTS knowledge_research_sources (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES knowledge_research_topics(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL CHECK(source_type IN ('duckduckgo', 'gdelt', 'wikimedia', 'rss_atom', 'manual_url', 'local')),
        title TEXT NOT NULL,
        url TEXT,
        excerpt TEXT,
        published_at TEXT,
        data_date TEXT,
        retrieved_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('discovered', 'adopted', 'rejected')),
        created_at TEXT NOT NULL,
        UNIQUE(topic_id, url)
      );
      CREATE INDEX IF NOT EXISTS knowledge_research_sources_topic_status
        ON knowledge_research_sources(topic_id, status, created_at DESC, id);
      CREATE TABLE IF NOT EXISTS knowledge_research_findings (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES knowledge_research_topics(id) ON DELETE CASCADE,
        statement TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('fact', 'quote', 'inference', 'creator_opinion')),
        source_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK(status IN ('draft', 'supported', 'stale', 'blocked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function researchService(
  context: PluginContext,
): KnowledgeResearchService {
  return {
    references: (projectId) =>
      context.uow.execute((tx) =>
        tx
          .all<SourceRow>(
            "SELECT s.* FROM knowledge_research_sources s JOIN knowledge_research_topics t ON t.id=s.topic_id WHERE t.project_id = ? AND s.status = 'adopted' ORDER BY s.created_at DESC LIMIT 100",
            projectId,
          )
          .map((row) =>
            creationReference("knowledge", {
              ...source(row),
              version: Date.parse(row.created_at),
            }),
          ),
      ),
    listTopics: (projectId, options) => listTopics(context, projectId, options),
  };
}

export function researchRoutes(
  context: PluginContext,
  workspace: WorkspaceProjectService,
  adapter: CurlResearchAdapter,
): readonly RouteContribution[] {
  const projectParams = z.object({ projectId: z.string().uuid() });
  const topicParams = z.object({ id: z.string().uuid() });
  const find = (id: string) =>
    context.uow.execute((transaction) =>
      transaction.get<TopicRow>(
        "SELECT * FROM knowledge_research_topics WHERE id = ?",
        id,
      ),
    );
  return [
    route(
      {
        id: "knowledge:research-topics-list",
        pluginId: "knowledge",
        method: "get",
        path: "/api/v2/projects/{projectId}/research-topics",
        operationId: "research.topics.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{projectId}/research-topics",
        operationId: "research.topics.list",
        params: projectParams,
        response: ResearchPageSchema,
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("projectId");
        if (!workspace.get(projectId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到项目。");
        return requestContext.json(
          listTopics(context, projectId, {
            cursor: requestContext.req.query("cursor"),
            limit: Number(requestContext.req.query("limit") ?? "40"),
            status: requestContext.req.query("status"),
          }),
        );
      },
    ),
    route(
      {
        id: "knowledge:research-topics-create",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/projects/{projectId}/research-topics",
        operationId: "research.topics.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/projects/{projectId}/research-topics",
        operationId: "research.topics.create",
        params: projectParams,
        body: ResearchTopicInputSchema.omit({ projectId: true }),
        response: ResearchTopicSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = ResearchTopicInputSchema.omit({
          projectId: true,
        }).safeParse(await requestContext.req.json());
        const projectId = requestContext.req.param("projectId");
        if (!parsed.success || !workspace.get(projectId))
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "研究专题无效。",
          );
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO knowledge_research_topics(id, project_id, title, query, risk_domain, status, version, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'draft', 0, ?, ?)`,
            id,
            projectId,
            parsed.data.title.trim(),
            parsed.data.query.trim(),
            parsed.data.riskDomain,
            now,
            now,
          );
          return topic(
            transaction.get<TopicRow>(
              "SELECT * FROM knowledge_research_topics WHERE id = ?",
              id,
            )!,
          );
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "knowledge:research-search",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/research-topics/{id}/search",
        operationId: "research.search",
      },
      declaration({
        method: "post",
        path: "/api/v2/research-topics/{id}/search",
        operationId: "research.search",
        params: topicParams,
        body: ResearchSearchInputSchema,
        response: ResearchSearchResponseSchema,
      }),
      async (requestContext) => {
        const parsed = ResearchSearchInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = find(requestContext.req.param("id"));
        if (!parsed.success || !current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到研究专题。");
        if (!adapter.available)
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "当前运行模式没有 curl 联网读取能力；仍可采用手工网址、RSS/Atom 或本地资料。",
          );
        const query = parsed.data.query ?? current.query;
        let target: URL;
        try {
          target = new URL(query);
        } catch {
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "请提供公开 HTTPS 资料网址；可在 AI 助手中通过 curl 查找网址。",
          );
        }
        if (target.protocol !== "https:" || target.username || target.password)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "请提供公开 HTTPS 资料网址。",
          );
        let searched: Awaited<ReturnType<CurlResearchAdapter["search"]>>;
        try {
          searched = await adapter.search(target.toString());
        } catch {
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "curl 无法读取该公开网址，请检查网址和网络后重试。",
          );
        }
        const now = new Date().toISOString();
        context.uow.execute((transaction) => {
          for (const response of searched.results)
            for (const item of response.results)
              transaction.run(
                `INSERT OR IGNORE INTO knowledge_research_sources(
                id, topic_id, source_type, title, url, excerpt, published_at, data_date, retrieved_at, status, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?)`,
                crypto.randomUUID(),
                current.id,
                response.source,
                item.title,
                item.url,
                item.excerpt ?? null,
                item.publishedAt ?? null,
                item.publishedAt ?? null,
                now,
                now,
              );
          transaction.run(
            `UPDATE knowledge_research_topics SET status = ?, version = version + 1, updated_at = ? WHERE id = ?`,
            searched.results.length ? "researching" : "draft",
            now,
            current.id,
          );
        });
        return requestContext.json({
          topicId: current.id,
          results: searched.results,
          coverage: searched.results
            .map((value) => value.coverage)
            .concat("也可独立采用手工网址、本地资料、RSS/Atom。"),
          fallbackUsed: searched.fallbackUsed,
        });
      },
    ),
    route(
      {
        id: "knowledge:research-sources-list",
        pluginId: "knowledge",
        method: "get",
        path: "/api/v2/research-topics/{id}/sources",
        operationId: "research.sources.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/research-topics/{id}/sources",
        operationId: "research.sources.list",
        params: topicParams,
        response: ResearchSourcePageSchema,
      }),
      (requestContext) => {
        const topicId = requestContext.req.param("id");
        if (!find(topicId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到研究专题。");
        const limit = Math.min(
          Math.max(Number(requestContext.req.query("limit") ?? "40") || 40, 1),
          100,
        );
        const cursor = requestContext.req.query("cursor") ?? "";
        const rows = context.uow.execute((transaction) =>
          transaction.all<SourceRow>(
            `SELECT * FROM knowledge_research_sources WHERE topic_id = ? AND id > ?
           ORDER BY id LIMIT ?`,
            topicId,
            cursor,
            limit + 1,
          ),
        );
        const items = rows.slice(0, limit).map(source);
        return requestContext.json({
          items,
          ...(rows.length > limit && items.at(-1)
            ? { nextCursor: items.at(-1)!.id }
            : {}),
        });
      },
    ),
    route(
      {
        id: "knowledge:research-sources-create",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/research-topics/{id}/sources",
        operationId: "research.sources.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/research-topics/{id}/sources",
        operationId: "research.sources.create",
        params: topicParams,
        body: ResearchSourceInputSchema,
        response: ResearchSourceSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = ResearchSourceInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = find(requestContext.req.param("id"));
        if (!current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到研究专题。");
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "资料来源无效。",
          );
        if (parsed.data.sourceType !== "local" && !parsed.data.url)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "网址和 RSS 资料必须提供链接。",
          );
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO knowledge_research_sources(id, topic_id, source_type, title, url, excerpt, published_at, data_date, retrieved_at, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'adopted', ?)`,
            id,
            current.id,
            parsed.data.sourceType,
            parsed.data.title,
            parsed.data.url ?? null,
            parsed.data.excerpt ?? null,
            parsed.data.publishedAt ?? null,
            parsed.data.dataDate ?? null,
            now,
            now,
          );
          return source(
            transaction.get<SourceRow>(
              "SELECT * FROM knowledge_research_sources WHERE id = ?",
              id,
            )!,
          );
        });
        return requestContext.json(value, 201);
      },
    ),
    route(
      {
        id: "knowledge:research-findings-list",
        pluginId: "knowledge",
        method: "get",
        path: "/api/v2/research-topics/{id}/findings",
        operationId: "research.findings.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/research-topics/{id}/findings",
        operationId: "research.findings.list",
        params: topicParams,
        response: ResearchFindingPageSchema,
      }),
      (requestContext) => {
        const topicId = requestContext.req.param("id");
        if (!find(topicId))
          return problem(requestContext, 404, "NOT_FOUND", "未找到研究专题。");
        const rows = context.uow.execute((transaction) =>
          transaction.all<FindingRow>(
            "SELECT * FROM knowledge_research_findings WHERE topic_id = ? ORDER BY created_at, id",
            topicId,
          ),
        );
        return requestContext.json({ items: rows.map(finding) });
      },
    ),
    route(
      {
        id: "knowledge:research-findings-create",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/research-topics/{id}/findings",
        operationId: "research.findings.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/research-topics/{id}/findings",
        operationId: "research.findings.create",
        params: topicParams,
        body: ResearchFindingInputSchema,
        response: ResearchFindingSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = ResearchFindingInputSchema.safeParse(
          await requestContext.req.json(),
        );
        const current = find(requestContext.req.param("id"));
        if (!current)
          return problem(requestContext, 404, "NOT_FOUND", "未找到研究专题。");
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "研究结论无效。",
          );
        const sourceCount = parsed.data.sourceIds.length
          ? context.uow.execute(
              (transaction) =>
                transaction.get<{ count: number }>(
                  `SELECT COUNT(*) AS count FROM knowledge_research_sources
               WHERE topic_id = ? AND status = 'adopted' AND id IN (${parsed.data.sourceIds.map(() => "?").join(",")})`,
                  current.id,
                  ...parsed.data.sourceIds,
                )?.count ?? 0,
            )
          : 0;
        const needsEvidence =
          current.risk_domain !== "general" &&
          ["fact", "quote"].includes(parsed.data.kind);
        const status =
          needsEvidence && sourceCount !== parsed.data.sourceIds.length
            ? "blocked"
            : parsed.data.sourceIds.length
              ? "supported"
              : "draft";
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO knowledge_research_findings(id, topic_id, statement, kind, source_ids_json, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            current.id,
            parsed.data.statement,
            parsed.data.kind,
            JSON.stringify(parsed.data.sourceIds),
            status,
            now,
            now,
          );
          return finding(
            transaction.get<FindingRow>(
              "SELECT * FROM knowledge_research_findings WHERE id = ?",
              id,
            )!,
          );
        });
        return requestContext.json(value, 201);
      },
    ),
  ];
}
