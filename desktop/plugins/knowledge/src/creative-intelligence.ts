import { createHash, createPublicKey, verify } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import {
  AudienceKnowledgeStateSchema,
  CorpusCollectionItemSchema,
  CorpusItemInputSchema,
  CorpusItemPatchSchema,
  CorpusItemSchema,
  CorpusSourceSchema,
  CREATIVE_KNOWLEDGE_SERVICE,
  IPTwinSnapshotSchema,
  ProvenanceEdgeSchema,
  ScenarioRunSchema,
  StoryCausalEdgeSchema,
  StoryCausalNodeSchema,
  type AudienceKnowledgeState,
  type CorpusCollectionItem,
  type CorpusItem,
  type CreativeKnowledgeService,
  type CreativePackageAssets,
  type IPTwinSnapshot,
  type ProvenanceEdge,
  type ScenarioRun,
  type StoryCausalEdge,
  type StoryCausalNode,
  ProblemDetailsSchema,
  type JsonValue,
} from "@dramaip/contracts";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { z, type ZodType } from "zod";

interface RouteContext {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
  };
  json(value: unknown, status?: number): Response;
  body(value: null, status?: number): Response;
}

interface CorpusRow {
  id: string;
  source_id: string | null;
  visibility: "public" | "private";
  kind: CorpusItem["kind"];
  title: string;
  trigger_text: string;
  mechanism: string;
  emotional_effect: string;
  contexts_json: string;
  risk_tags_json: string;
  tags_json: string;
  freshness: CorpusItem["freshness"];
  rights_status: CorpusItem["rightsStatus"];
  locale: string;
  tombstoned_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

interface CollectionRow {
  id: string;
  corpus_item_id: string | null;
  title: string;
  mechanism: string;
  notes: string;
  tags_json: string;
  adopted: number;
  use_count: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface NodeRow {
  id: string;
  project_id: string;
  kind: StoryCausalNode["kind"];
  title: string;
  summary: string;
  source_type: string;
  source_id: string;
  source_version: number;
  confirmed: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface EdgeRow {
  id: string;
  project_id: string;
  from_node_id: string;
  to_node_id: string;
  relation: StoryCausalEdge["relation"];
  rationale: string;
  confidence: number;
  confirmed: number;
  version: number;
  created_at: string;
  updated_at: string;
}

interface AudienceRow {
  id: string;
  project_id: string;
  subject_type: AudienceKnowledgeState["subjectType"];
  subject_id: string;
  knowledge_node_id: string;
  story_order: number;
  state: AudienceKnowledgeState["state"];
  evidence: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface ProvenanceRow {
  id: string;
  project_id: string | null;
  from_type: string;
  from_id: string;
  relation: ProvenanceEdge["relation"];
  to_type: string;
  to_id: string;
  quote_excerpt: string | null;
  version: number;
  created_at: string;
}

function corpus(row: CorpusRow): CorpusItem {
  return {
    id: row.id,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
    visibility: row.visibility,
    kind: row.kind,
    title: row.title,
    trigger: row.trigger_text,
    mechanism: row.mechanism,
    emotionalEffect: row.emotional_effect,
    contexts: JSON.parse(row.contexts_json),
    riskTags: JSON.parse(row.risk_tags_json),
    tags: JSON.parse(row.tags_json),
    freshness: row.freshness,
    rightsStatus: row.rights_status,
    locale: row.locale,
    ...(row.tombstoned_at ? { tombstonedAt: row.tombstoned_at } : {}),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function collection(row: CollectionRow): CorpusCollectionItem {
  return {
    id: row.id,
    ...(row.corpus_item_id ? { corpusItemId: row.corpus_item_id } : {}),
    title: row.title,
    mechanism: row.mechanism,
    notes: row.notes,
    tags: JSON.parse(row.tags_json),
    adopted: Boolean(row.adopted),
    useCount: row.use_count,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function node(row: NodeRow): StoryCausalNode {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceVersion: row.source_version,
    confirmed: Boolean(row.confirmed),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function edge(row: EdgeRow): StoryCausalEdge {
  return {
    id: row.id,
    projectId: row.project_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    relation: row.relation,
    rationale: row.rationale,
    confidence: row.confidence,
    confirmed: Boolean(row.confirmed),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function audience(row: AudienceRow): AudienceKnowledgeState {
  return {
    id: row.id,
    projectId: row.project_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    knowledgeNodeId: row.knowledge_node_id,
    storyOrder: row.story_order,
    state: row.state,
    evidence: row.evidence,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function provenance(row: ProvenanceRow): ProvenanceEdge {
  return {
    id: row.id,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    fromType: row.from_type,
    fromId: row.from_id,
    relation: row.relation,
    toType: row.to_type,
    toId: row.to_id,
    ...(row.quote_excerpt ? { quoteExcerpt: row.quote_excerpt } : {}),
    version: row.version,
    createdAt: row.created_at,
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
  method: "get" | "post" | "patch" | "delete";
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
    tags: ["creative-intelligence"],
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
        ...(input.response && status !== 204
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

function route(
  metadata: Omit<RouteContribution, "declaration" | "handler" | "policy">,
  openapi: unknown,
  handler: (context: RouteContext) => Response | Promise<Response>,
  policy?: { idempotency?: "required"; concurrency?: "if-match-required" },
): RouteContribution {
  return defineRouteContribution({
    ...metadata,
    declaration: openapi,
    handler,
    ...(policy ? { policy } : {}),
  });
}

function append(
  transaction: UnitOfWorkTransaction,
  type: `${string}.${string}.v${number}`,
  aggregateType: string,
  aggregateId: string,
  version: number,
  payload: Record<string, unknown>,
): void {
  transaction.append({
    type,
    pluginId: "knowledge",
    aggregateType,
    aggregateId,
    aggregateVersion: version,
    payload: JSON.parse(JSON.stringify(payload)) as JsonValue,
  });
}

function sourceFingerprint(
  nodes: readonly StoryCausalNode[],
  edges: readonly StoryCausalEdge[],
  states: readonly AudienceKnowledgeState[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ nodes, edges, states }))
    .digest("hex");
}

function storyConflicts(
  nodes: readonly StoryCausalNode[],
  edges: readonly StoryCausalEdge[],
  states: readonly AudienceKnowledgeState[],
): string[] {
  const findings: string[] = [];
  const nodeIds = new Set(nodes.map((value) => value.id));
  const causalRelations = new Set(["causes", "enables", "depends_on"]);
  const adjacency = new Map<string, string[]>();
  for (const value of edges) {
    if (!nodeIds.has(value.fromNodeId) || !nodeIds.has(value.toNodeId)) {
      findings.push(`因果关系 ${value.id} 引用了不存在的节点。`);
      continue;
    }
    if (value.fromNodeId === value.toNodeId)
      findings.push(
        `节点“${nodes.find((node) => node.id === value.fromNodeId)?.title ?? value.fromNodeId}”存在自我因果。`,
      );
    if (value.confirmed && value.relation === "conflicts_with")
      findings.push(`已确认设定之间存在冲突：${value.rationale || value.id}。`);
    if (causalRelations.has(value.relation))
      adjacency.set(value.fromNodeId, [
        ...(adjacency.get(value.fromNodeId) ?? []),
        value.toNodeId,
      ]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cyclic = (adjacency.get(id) ?? []).some(visit);
    visiting.delete(id);
    visited.add(id);
    return cyclic;
  };
  if (nodes.some((value) => visit(value.id)))
    findings.push("故事因果图存在循环依赖，需要人工确认是否为有意闭环。");
  const rank = { unknown: 0, suspects: 1, misbelieves: 1, knows: 2 } as const;
  const tracks = new Map<string, AudienceKnowledgeState[]>();
  for (const value of states) {
    const key = `${value.subjectType}:${value.subjectId}:${value.knowledgeNodeId}`;
    tracks.set(key, [...(tracks.get(key) ?? []), value]);
    if (value.state !== "unknown" && !value.evidence.trim())
      findings.push(`认知状态 ${value.id} 缺少实际证据，可能形成无依据推理。`);
  }
  for (const values of tracks.values()) {
    const ordered = [...values].sort(
      (left, right) => left.storyOrder - right.storyOrder,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      if (rank[ordered[index]!.state] < rank[ordered[index - 1]!.state])
        findings.push(
          `认知轨道 ${ordered[index]!.subjectId} 在故事顺序 ${ordered[index]!.storyOrder} 出现无解释回退。`,
        );
    }
  }
  const revealedSecrets = new Set(
    edges
      .filter((value) => value.relation === "reveals")
      .flatMap((value) => [value.fromNodeId, value.toNodeId]),
  );
  for (const secret of nodes.filter((value) => value.kind === "secret")) {
    if (
      states.some(
        (value) =>
          value.knowledgeNodeId === secret.id && value.state === "knows",
      ) &&
      !revealedSecrets.has(secret.id)
    )
      findings.push(
        `秘密“${secret.title}”已被知晓，但因果图中没有揭示证据，可能提前泄露。`,
      );
  }
  return [...new Set(findings)];
}

function markTwinsStale(
  transaction: UnitOfWorkTransaction,
  projectId: string,
): void {
  for (const row of transaction.all<{ id: string; snapshot_json: string }>(
    "SELECT id, snapshot_json FROM knowledge_ip_twin_snapshots WHERE project_id = ?",
    projectId,
  )) {
    const snapshot = JSON.parse(row.snapshot_json) as IPTwinSnapshot;
    if (snapshot.stale) continue;
    transaction.run(
      "UPDATE knowledge_ip_twin_snapshots SET snapshot_json = ? WHERE id = ?",
      JSON.stringify({ ...snapshot, stale: true }),
      row.id,
    );
  }
}

function service(context: PluginContext): CreativeKnowledgeService {
  return {
    listCorpus(input = {}) {
      const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
      const query = `%${input.query?.trim() ?? ""}%`;
      return context.uow.execute((transaction) =>
        transaction
          .all<CorpusRow>(
            `SELECT * FROM knowledge_corpus_items
             WHERE tombstoned_at IS NULL
               AND (? = '' OR title LIKE ? OR mechanism LIKE ? OR tags_json LIKE ?)
               AND (? = '' OR visibility = ?)
             ORDER BY updated_at DESC, id LIMIT ?`,
            input.query?.trim() ?? "",
            query,
            query,
            query,
            input.visibility ?? "",
            input.visibility ?? "",
            limit,
          )
          .map(corpus),
      );
    },
    listNodes(projectId) {
      return context.uow.execute((transaction) =>
        transaction
          .all<NodeRow>(
            "SELECT * FROM knowledge_causal_nodes WHERE project_id = ? ORDER BY created_at, id",
            projectId,
          )
          .map(node),
      );
    },
    listEdges(projectId) {
      return context.uow.execute((transaction) =>
        transaction
          .all<EdgeRow>(
            "SELECT * FROM knowledge_causal_edges WHERE project_id = ? ORDER BY created_at, id",
            projectId,
          )
          .map(edge),
      );
    },
    listProvenance(projectId) {
      return context.uow.execute((transaction) =>
        transaction
          .all<ProvenanceRow>(
            `SELECT * FROM knowledge_provenance_edges
             WHERE (? = '' OR project_id = ?) ORDER BY created_at, id`,
            projectId ?? "",
            projectId ?? "",
          )
          .map(provenance),
      );
    },
    exportPackageAssets(projectId): CreativePackageAssets {
      return context.uow.execute((transaction) => {
        const provenanceValues = transaction
          .all<ProvenanceRow>(
            "SELECT * FROM knowledge_provenance_edges WHERE project_id = ? ORDER BY created_at, id",
            projectId,
          )
          .map(provenance);
        const referencedCorpusIds = new Set(
          provenanceValues.flatMap((value) => [
            ...(value.fromType === "corpus_item" ? [value.fromId] : []),
            ...(value.toType === "corpus_item" ? [value.toId] : []),
          ]),
        );
        const corpusItems = [...referencedCorpusIds].flatMap((id) => {
          const row = transaction.get<CorpusRow>(
            `SELECT * FROM knowledge_corpus_items
             WHERE id = ? AND tombstoned_at IS NULL AND rights_status != 'removed'`,
            id,
          );
          return row ? [corpus(row)] : [];
        });
        return {
          corpusItems: corpusItems.map(
            ({
              sourceId: _sourceId,
              visibility: _visibility,
              tombstonedAt: _tombstonedAt,
              version: _version,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              ...value
            }) => value,
          ),
          causalNodes: transaction
            .all<NodeRow>(
              "SELECT * FROM knowledge_causal_nodes WHERE project_id = ? ORDER BY created_at, id",
              projectId,
            )
            .map(node)
            .map(({ projectId: _projectId, ...value }) => value),
          causalEdges: transaction
            .all<EdgeRow>(
              "SELECT * FROM knowledge_causal_edges WHERE project_id = ? ORDER BY created_at, id",
              projectId,
            )
            .map(edge)
            .map(({ projectId: _projectId, ...value }) => value),
          audienceStates: transaction
            .all<AudienceRow>(
              "SELECT * FROM knowledge_audience_states WHERE project_id = ? ORDER BY story_order, id",
              projectId,
            )
            .map(audience)
            .map(({ projectId: _projectId, ...value }) => value),
          provenance: provenanceValues.map(
            ({ projectId: _projectId, ...value }) => value,
          ),
        };
      });
    },
    importPackageAssets(projectId, assets) {
      return context.uow.execute((transaction) => {
        const idMap = new Map<string, string>();
        let created = 0;
        const now = new Date().toISOString();
        for (const item of assets.corpusItems) {
          const id = crypto.randomUUID();
          idMap.set(item.id, id);
          transaction.run(
            `INSERT INTO knowledge_corpus_items(
              id, visibility, kind, title, trigger_text, mechanism,
              emotional_effect, contexts_json, risk_tags_json, tags_json,
              freshness, rights_status, locale, version, created_at, updated_at
            ) VALUES (?, 'private', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            id,
            item.kind,
            item.title,
            item.trigger,
            item.mechanism,
            item.emotionalEffect,
            JSON.stringify(item.contexts),
            JSON.stringify(item.riskTags),
            JSON.stringify(item.tags),
            item.freshness,
            item.rightsStatus === "removed" ? "unknown" : item.rightsStatus,
            item.locale,
            now,
            now,
          );
          created += 1;
        }
        for (const value of assets.causalNodes) {
          const id = crypto.randomUUID();
          idMap.set(value.id, id);
          transaction.run(
            `INSERT INTO knowledge_causal_nodes(
              id, project_id, kind, title, summary, source_type, source_id,
              source_version, confirmed, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            id,
            projectId,
            value.kind,
            value.title,
            value.summary,
            value.sourceType,
            idMap.get(value.sourceId) ?? value.sourceId,
            value.sourceVersion,
            value.confirmed ? 1 : 0,
            now,
            now,
          );
          created += 1;
        }
        for (const value of assets.causalEdges) {
          const fromNodeId = idMap.get(value.fromNodeId);
          const toNodeId = idMap.get(value.toNodeId);
          if (!fromNodeId || !toNodeId) continue;
          const id = crypto.randomUUID();
          idMap.set(value.id, id);
          transaction.run(
            `INSERT INTO knowledge_causal_edges(
              id, project_id, from_node_id, to_node_id, relation, rationale,
              confidence, confirmed, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            id,
            projectId,
            fromNodeId,
            toNodeId,
            value.relation,
            value.rationale,
            value.confidence,
            value.confirmed ? 1 : 0,
            now,
            now,
          );
          created += 1;
        }
        for (const value of assets.audienceStates) {
          const knowledgeNodeId = idMap.get(value.knowledgeNodeId);
          if (!knowledgeNodeId) continue;
          const id = crypto.randomUUID();
          idMap.set(value.id, id);
          transaction.run(
            `INSERT INTO knowledge_audience_states(
              id, project_id, subject_type, subject_id, knowledge_node_id,
              story_order, state, evidence, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            id,
            projectId,
            value.subjectType,
            value.subjectId,
            knowledgeNodeId,
            value.storyOrder,
            value.state,
            value.evidence,
            now,
            now,
          );
          created += 1;
        }
        for (const value of assets.provenance) {
          transaction.run(
            `INSERT OR IGNORE INTO knowledge_provenance_edges(
              id, project_id, from_type, from_id, relation, to_type, to_id,
              quote_excerpt, version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            crypto.randomUUID(),
            projectId,
            value.fromType,
            idMap.get(value.fromId) ?? value.fromId,
            value.relation,
            value.toType,
            idMap.get(value.toId) ?? value.toId,
            value.quoteExcerpt ?? null,
            now,
          );
          created += 1;
        }
        return created;
      });
    },
    buildTwin(projectId) {
      return context.uow.execute((transaction) => {
        const nodes = transaction
          .all<NodeRow>(
            "SELECT * FROM knowledge_causal_nodes WHERE project_id = ? ORDER BY created_at, id",
            projectId,
          )
          .map(node);
        const edges = transaction
          .all<EdgeRow>(
            "SELECT * FROM knowledge_causal_edges WHERE project_id = ? ORDER BY created_at, id",
            projectId,
          )
          .map(edge);
        const states = transaction
          .all<AudienceRow>(
            "SELECT * FROM knowledge_audience_states WHERE project_id = ? ORDER BY story_order, id",
            projectId,
          )
          .map(audience);
        const conflicts = storyConflicts(nodes, edges, states);
        return {
          id: crypto.randomUUID(),
          projectId,
          sourceFingerprint: sourceFingerprint(nodes, edges, states),
          stale: false,
          nodes,
          edges,
          audienceStates: states,
          conflicts,
          createdAt: new Date().toISOString(),
        };
      });
    },
  };
}

const projectParams = z.object({ id: z.string().uuid() });
const idParams = z.object({ id: z.string().uuid() });
const nodeInput = StoryCausalNodeSchema.omit({
  id: true,
  projectId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});
const edgeInput = StoryCausalEdgeSchema.omit({
  id: true,
  projectId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});
const audienceInput = AudienceKnowledgeStateSchema.omit({
  id: true,
  projectId: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});
const provenanceInput = ProvenanceEdgeSchema.omit({
  id: true,
  version: true,
  createdAt: true,
});
const collectionInput = z.object({
  corpusItemId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(240),
  mechanism: z.string().trim().min(1).max(4_000),
  notes: z.string().max(4_000).default(""),
  tags: z.array(z.string().max(120)).max(64).default([]),
});
const snapshotInput = z.object({
  format: z.literal("dramaip-creative-corpus-snapshot"),
  schemaVersion: z.literal(1),
  version: z.string().min(1).max(80),
  sources: z.array(CorpusSourceSchema.omit({ version: true })),
  items: z.array(CorpusItemSchema.omit({ version: true })),
  tombstones: z.array(z.string().uuid()).default([]),
  signature: z.string().min(1),
});

export function creativeIntelligenceRoutes(
  context: PluginContext,
  creative: CreativeKnowledgeService,
): readonly RouteContribution[] {
  const routes: RouteContribution[] = [];
  routes.push(
    route(
      {
        id: "knowledge:creative-corpus-list",
        pluginId: "knowledge",
        method: "get",
        path: "/api/v2/creative-corpus/items",
        operationId: "creative-corpus.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/creative-corpus/items",
        operationId: "creative-corpus.list",
        response: z.object({ items: z.array(CorpusItemSchema) }),
      }),
      (requestContext) =>
        requestContext.json({
          items: creative.listCorpus({
            query: requestContext.req.query("query"),
            visibility: requestContext.req.query("visibility") as
              "public" | "private" | undefined,
            limit: Number(requestContext.req.query("limit") ?? "100"),
          }),
        }),
    ),
    route(
      {
        id: "knowledge:creative-corpus-create",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/creative-corpus/items",
        operationId: "creative-corpus.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/creative-corpus/items",
        operationId: "creative-corpus.create",
        body: CorpusItemInputSchema,
        response: CorpusItemSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = CorpusItemInputSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "创意语料无效。",
          );
        if (parsed.data.visibility !== "private")
          return problem(
            requestContext,
            400,
            "PUBLIC_CORPUS_REQUIRES_SIGNED_SNAPSHOT",
            "公共语料只能通过签名快照导入。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO knowledge_corpus_items(
              id, source_id, visibility, kind, title, trigger_text, mechanism,
              emotional_effect, contexts_json, risk_tags_json, tags_json,
              freshness, rights_status, locale, version, created_at, updated_at
            ) VALUES (?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            id,
            parsed.data.sourceId ?? null,
            parsed.data.kind,
            parsed.data.title,
            parsed.data.trigger ?? "",
            parsed.data.mechanism,
            parsed.data.emotionalEffect ?? "",
            JSON.stringify(parsed.data.contexts ?? []),
            JSON.stringify(parsed.data.riskTags ?? []),
            JSON.stringify(parsed.data.tags ?? []),
            parsed.data.freshness ?? "stable",
            parsed.data.rightsStatus ?? "unknown",
            parsed.data.locale ?? "zh-CN",
            now,
            now,
          );
          const created = corpus(
            transaction.get<CorpusRow>(
              "SELECT * FROM knowledge_corpus_items WHERE id = ?",
              id,
            )!,
          );
          append(
            transaction,
            "knowledge.corpus-item-created.v1",
            "creative-corpus-item",
            id,
            created.version,
            created,
          );
          return created;
        });
        return requestContext.json(value, 201);
      },
      { idempotency: "required" },
    ),
    route(
      {
        id: "knowledge:creative-corpus-update",
        pluginId: "knowledge",
        method: "patch",
        path: "/api/v2/creative-corpus/items/{id}",
        operationId: "creative-corpus.update",
      },
      declaration({
        method: "patch",
        path: "/api/v2/creative-corpus/items/{id}",
        operationId: "creative-corpus.update",
        params: idParams,
        body: CorpusItemPatchSchema,
        response: CorpusItemSchema,
      }),
      async (requestContext) => {
        const parsed = CorpusItemPatchSchema.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "语料更新无效。",
          );
        const value = context.uow.execute((transaction) => {
          const current = transaction.get<CorpusRow>(
            "SELECT * FROM knowledge_corpus_items WHERE id = ?",
            requestContext.req.param("id"),
          );
          if (!current) return undefined;
          if (current.visibility !== "private") return "readonly" as const;
          if (current.version !== parsed.data.version)
            return "conflict" as const;
          const previous = corpus(current);
          const next = { ...previous, ...parsed.data };
          const now = new Date().toISOString();
          transaction.run(
            `UPDATE knowledge_corpus_items SET kind = ?, title = ?, trigger_text = ?, mechanism = ?,
             emotional_effect = ?, contexts_json = ?, risk_tags_json = ?, tags_json = ?, freshness = ?,
             rights_status = ?, locale = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`,
            next.kind,
            next.title,
            next.trigger,
            next.mechanism,
            next.emotionalEffect,
            JSON.stringify(next.contexts),
            JSON.stringify(next.riskTags),
            JSON.stringify(next.tags),
            next.freshness,
            next.rightsStatus,
            next.locale,
            now,
            current.id,
            current.version,
          );
          return corpus(
            transaction.get<CorpusRow>(
              "SELECT * FROM knowledge_corpus_items WHERE id = ?",
              current.id,
            )!,
          );
        });
        if (value === "readonly")
          return problem(
            requestContext,
            409,
            "PUBLIC_CORPUS_READONLY",
            "公共语料不可在本地修改，可收藏后添加私人备注。",
          );
        if (value === "conflict")
          return problem(
            requestContext,
            409,
            "CONFLICT",
            "语料已更新，请刷新后重试。",
          );
        return value
          ? requestContext.json(value)
          : problem(requestContext, 404, "NOT_FOUND", "未找到语料。");
      },
      { concurrency: "if-match-required" },
    ),
  );

  routes.push(
    route(
      {
        id: "knowledge:creative-collections-list",
        pluginId: "knowledge",
        method: "get",
        path: "/api/v2/creative-corpus/collections",
        operationId: "creative-collections.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/creative-corpus/collections",
        operationId: "creative-collections.list",
        response: z.object({ items: z.array(CorpusCollectionItemSchema) }),
      }),
      (requestContext) =>
        requestContext.json({
          items: context.uow.execute((transaction) =>
            transaction
              .all<CollectionRow>(
                "SELECT * FROM knowledge_corpus_collections ORDER BY updated_at DESC, id",
              )
              .map(collection),
          ),
        }),
    ),
    route(
      {
        id: "knowledge:creative-collections-create",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/creative-corpus/collections",
        operationId: "creative-collections.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/creative-corpus/collections",
        operationId: "creative-collections.create",
        body: collectionInput,
        response: CorpusCollectionItemSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = collectionInput.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "私人收藏无效。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO knowledge_corpus_collections(
              id, corpus_item_id, title, mechanism, notes, tags_json, adopted,
              use_count, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
            id,
            parsed.data.corpusItemId ?? null,
            parsed.data.title,
            parsed.data.mechanism,
            parsed.data.notes,
            JSON.stringify(parsed.data.tags),
            now,
            now,
          );
          return collection(
            transaction.get<CollectionRow>(
              "SELECT * FROM knowledge_corpus_collections WHERE id = ?",
              id,
            )!,
          );
        });
        return requestContext.json(value, 201);
      },
      { idempotency: "required" },
    ),
  );

  routes.push(
    route(
      {
        id: "knowledge:creative-snapshot-import",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/creative-corpus/snapshots/import",
        operationId: "creative-corpus.importSnapshot",
      },
      declaration({
        method: "post",
        path: "/api/v2/creative-corpus/snapshots/import",
        operationId: "creative-corpus.importSnapshot",
        body: snapshotInput,
        response: z.object({ imported: z.number(), tombstoned: z.number() }),
      }),
      async (requestContext) => {
        const parsed = snapshotInput.safeParse(await requestContext.req.json());
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "INVALID_SNAPSHOT",
            "公共语料快照格式无效。",
          );
        const key = process.env.DRAMAIP_CORPUS_SNAPSHOT_PUBLIC_KEY_PEM;
        if (!key)
          return problem(
            requestContext,
            503,
            "CAPABILITY_UNAVAILABLE",
            "未配置公共语料快照验证公钥。",
          );
        const unsigned = {
          format: parsed.data.format,
          schemaVersion: parsed.data.schemaVersion,
          version: parsed.data.version,
          sources: parsed.data.sources,
          items: parsed.data.items,
          tombstones: parsed.data.tombstones,
        };
        let valid = false;
        try {
          valid = verify(
            null,
            Buffer.from(JSON.stringify(unsigned)),
            createPublicKey(key),
            Buffer.from(parsed.data.signature, "base64"),
          );
        } catch {
          valid = false;
        }
        if (!valid)
          return problem(
            requestContext,
            400,
            "INVALID_SNAPSHOT_SIGNATURE",
            "公共语料快照签名无效。",
          );
        const counts = context.uow.execute((transaction) => {
          const now = new Date().toISOString();
          for (const source of parsed.data.sources)
            transaction.run(
              `INSERT INTO knowledge_corpus_sources(
                id, url, domain, title, excerpt, content_hash, status,
                rights_status, locale, retrieved_at, version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                url = excluded.url, domain = excluded.domain, title = excluded.title,
                excerpt = excluded.excerpt, content_hash = excluded.content_hash,
                status = excluded.status, rights_status = excluded.rights_status,
                locale = excluded.locale, retrieved_at = excluded.retrieved_at,
                version = knowledge_corpus_sources.version + 1,
                updated_at = excluded.updated_at`,
              source.id,
              source.url ?? null,
              source.domain ?? null,
              source.title,
              source.excerpt ?? null,
              source.contentHash ?? null,
              source.status,
              source.rightsStatus,
              source.locale,
              source.retrievedAt,
              source.createdAt,
              now,
            );
          for (const item of parsed.data.items)
            transaction.run(
              `INSERT INTO knowledge_corpus_items(
                id, source_id, visibility, kind, title, trigger_text, mechanism,
                emotional_effect, contexts_json, risk_tags_json, tags_json,
                freshness, rights_status, locale, tombstoned_at, version, created_at, updated_at
              ) VALUES (?, ?, 'public', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                source_id = excluded.source_id, kind = excluded.kind, title = excluded.title,
                trigger_text = excluded.trigger_text, mechanism = excluded.mechanism,
                emotional_effect = excluded.emotional_effect, contexts_json = excluded.contexts_json,
                risk_tags_json = excluded.risk_tags_json, tags_json = excluded.tags_json,
                freshness = excluded.freshness, rights_status = excluded.rights_status,
                locale = excluded.locale, tombstoned_at = excluded.tombstoned_at,
                version = knowledge_corpus_items.version + 1, updated_at = excluded.updated_at`,
              item.id,
              item.sourceId ?? null,
              item.kind,
              item.title,
              item.trigger,
              item.mechanism,
              item.emotionalEffect,
              JSON.stringify(item.contexts),
              JSON.stringify(item.riskTags),
              JSON.stringify(item.tags),
              item.freshness,
              item.rightsStatus,
              item.locale,
              item.tombstonedAt ?? null,
              item.createdAt,
              now,
            );
          for (const id of parsed.data.tombstones)
            transaction.run(
              `UPDATE knowledge_corpus_items SET tombstoned_at = ?, version = version + 1,
               updated_at = ? WHERE id = ? AND visibility = 'public'`,
              now,
              now,
              id,
            );
          return {
            imported: parsed.data.items.length,
            tombstoned: parsed.data.tombstones.length,
          };
        });
        return requestContext.json(counts);
      },
      { idempotency: "required" },
    ),
  );

  routes.push(
    route(
      {
        id: "knowledge:provenance-list",
        pluginId: "knowledge",
        method: "get",
        path: "/api/v2/provenance",
        operationId: "provenance.list",
      },
      declaration({
        method: "get",
        path: "/api/v2/provenance",
        operationId: "provenance.list",
        response: z.object({ items: z.array(ProvenanceEdgeSchema) }),
      }),
      (requestContext) => {
        const projectId = requestContext.req.query("projectId") ?? "";
        return requestContext.json({
          items: context.uow.execute((transaction) =>
            transaction
              .all<ProvenanceRow>(
                `SELECT * FROM knowledge_provenance_edges
                 WHERE (? = '' OR project_id = ?) ORDER BY created_at, id`,
                projectId,
                projectId,
              )
              .map(provenance),
          ),
        });
      },
    ),
    route(
      {
        id: "knowledge:provenance-create",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/provenance",
        operationId: "provenance.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/provenance",
        operationId: "provenance.create",
        body: provenanceInput,
        response: ProvenanceEdgeSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = provenanceInput.safeParse(
          await requestContext.req.json(),
        );
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "来源关系无效。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO knowledge_provenance_edges(
              id, project_id, from_type, from_id, relation, to_type, to_id,
              quote_excerpt, version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            id,
            parsed.data.projectId ?? null,
            parsed.data.fromType,
            parsed.data.fromId,
            parsed.data.relation,
            parsed.data.toType,
            parsed.data.toId,
            parsed.data.quoteExcerpt ?? null,
            now,
          );
          if (parsed.data.projectId)
            markTwinsStale(transaction, parsed.data.projectId);
          return provenance(
            transaction.get<ProvenanceRow>(
              "SELECT * FROM knowledge_provenance_edges WHERE id = ?",
              id,
            )!,
          );
        });
        return requestContext.json(value, 201);
      },
      { idempotency: "required" },
    ),
  );

  routes.push(
    route(
      {
        id: "knowledge:story-graph-get",
        pluginId: "knowledge",
        method: "get",
        path: "/api/v2/projects/{id}/story-graph",
        operationId: "story-graph.get",
      },
      declaration({
        method: "get",
        path: "/api/v2/projects/{id}/story-graph",
        operationId: "story-graph.get",
        params: projectParams,
        response: z.object({
          nodes: z.array(StoryCausalNodeSchema),
          edges: z.array(StoryCausalEdgeSchema),
          audienceStates: z.array(AudienceKnowledgeStateSchema),
        }),
      }),
      (requestContext) => {
        const projectId = requestContext.req.param("id");
        return requestContext.json({
          nodes: creative.listNodes(projectId),
          edges: creative.listEdges(projectId),
          audienceStates: context.uow.execute((transaction) =>
            transaction
              .all<AudienceRow>(
                "SELECT * FROM knowledge_audience_states WHERE project_id = ? ORDER BY story_order, id",
                projectId,
              )
              .map(audience),
          ),
        });
      },
    ),
  );

  const createGraphRecord = <T>(input: {
    id: string;
    path: `/api/v2/${string}`;
    operationId: string;
    schema: ZodType<T>;
    response: ZodType;
    insert(
      transaction: UnitOfWorkTransaction,
      projectId: string,
      id: string,
      value: T,
      now: string,
    ): void;
    select(transaction: UnitOfWorkTransaction, id: string): unknown;
  }) =>
    route(
      {
        id: input.id,
        pluginId: "knowledge",
        method: "post",
        path: input.path,
        operationId: input.operationId,
      },
      declaration({
        method: "post",
        path: input.path,
        operationId: input.operationId,
        params: projectParams,
        body: input.schema,
        response: input.response,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = input.schema.safeParse(await requestContext.req.json());
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "故事知识记录无效。",
          );
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const value = context.uow.execute((transaction) => {
          input.insert(
            transaction,
            requestContext.req.param("id"),
            id,
            parsed.data,
            now,
          );
          markTwinsStale(transaction, requestContext.req.param("id"));
          return input.select(transaction, id);
        });
        return requestContext.json(value, 201);
      },
      { idempotency: "required" },
    );

  routes.push(
    createGraphRecord({
      id: "knowledge:story-graph-node-create",
      path: "/api/v2/projects/{id}/story-graph/nodes",
      operationId: "story-graph.createNode",
      schema: nodeInput,
      response: StoryCausalNodeSchema,
      insert: (transaction, projectId, id, value, now) =>
        transaction.run(
          `INSERT INTO knowledge_causal_nodes(
            id, project_id, kind, title, summary, source_type, source_id,
            source_version, confirmed, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          id,
          projectId,
          value.kind,
          value.title,
          value.summary,
          value.sourceType,
          value.sourceId,
          value.sourceVersion,
          value.confirmed ? 1 : 0,
          now,
          now,
        ),
      select: (transaction, id) =>
        node(
          transaction.get<NodeRow>(
            "SELECT * FROM knowledge_causal_nodes WHERE id = ?",
            id,
          )!,
        ),
    }),
    createGraphRecord({
      id: "knowledge:story-graph-edge-create",
      path: "/api/v2/projects/{id}/story-graph/edges",
      operationId: "story-graph.createEdge",
      schema: edgeInput,
      response: StoryCausalEdgeSchema,
      insert: (transaction, projectId, id, value, now) =>
        transaction.run(
          `INSERT INTO knowledge_causal_edges(
            id, project_id, from_node_id, to_node_id, relation, rationale,
            confidence, confirmed, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          id,
          projectId,
          value.fromNodeId,
          value.toNodeId,
          value.relation,
          value.rationale,
          value.confidence,
          value.confirmed ? 1 : 0,
          now,
          now,
        ),
      select: (transaction, id) =>
        edge(
          transaction.get<EdgeRow>(
            "SELECT * FROM knowledge_causal_edges WHERE id = ?",
            id,
          )!,
        ),
    }),
    createGraphRecord({
      id: "knowledge:audience-state-create",
      path: "/api/v2/projects/{id}/audience-knowledge",
      operationId: "audience-knowledge.create",
      schema: audienceInput,
      response: AudienceKnowledgeStateSchema,
      insert: (transaction, projectId, id, value, now) =>
        transaction.run(
          `INSERT INTO knowledge_audience_states(
            id, project_id, subject_type, subject_id, knowledge_node_id,
            story_order, state, evidence, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          id,
          projectId,
          value.subjectType,
          value.subjectId,
          value.knowledgeNodeId,
          value.storyOrder,
          value.state,
          value.evidence,
          now,
          now,
        ),
      select: (transaction, id) =>
        audience(
          transaction.get<AudienceRow>(
            "SELECT * FROM knowledge_audience_states WHERE id = ?",
            id,
          )!,
        ),
    }),
  );

  routes.push(
    route(
      {
        id: "knowledge:ip-twin-build",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/projects/{id}/ip-twin",
        operationId: "ip-twin.build",
      },
      declaration({
        method: "post",
        path: "/api/v2/projects/{id}/ip-twin",
        operationId: "ip-twin.build",
        params: projectParams,
        response: IPTwinSnapshotSchema,
      }),
      (requestContext) => {
        const snapshot = creative.buildTwin(requestContext.req.param("id"));
        context.uow.execute((transaction) => {
          markTwinsStale(transaction, snapshot.projectId);
          transaction.run(
            `INSERT INTO knowledge_ip_twin_snapshots(
              id, project_id, source_fingerprint, snapshot_json, created_at
            ) VALUES (?, ?, ?, ?, ?)`,
            snapshot.id,
            snapshot.projectId,
            snapshot.sourceFingerprint,
            JSON.stringify(snapshot),
            snapshot.createdAt,
          );
        });
        return requestContext.json(snapshot);
      },
      { idempotency: "required" },
    ),
    route(
      {
        id: "knowledge:story-simulation-create",
        pluginId: "knowledge",
        method: "post",
        path: "/api/v2/projects/{id}/story-simulations",
        operationId: "story-simulations.create",
      },
      declaration({
        method: "post",
        path: "/api/v2/projects/{id}/story-simulations",
        operationId: "story-simulations.create",
        params: projectParams,
        body: z.object({
          snapshotId: z.string().uuid(),
          hypothesis: z.string().trim().min(1).max(4_000),
        }),
        response: ScenarioRunSchema,
        status: 201,
      }),
      async (requestContext) => {
        const parsed = z
          .object({
            snapshotId: z.string().uuid(),
            hypothesis: z.string().trim().min(1).max(4_000),
          })
          .safeParse(await requestContext.req.json());
        if (!parsed.success)
          return problem(
            requestContext,
            400,
            "VALIDATION_ERROR",
            "模拟假设无效。",
          );
        const projectId = requestContext.req.param("id");
        const twin = context.uow.execute((transaction) => {
          const row = transaction.get<{ snapshot_json: string }>(
            "SELECT snapshot_json FROM knowledge_ip_twin_snapshots WHERE id = ? AND project_id = ?",
            parsed.data.snapshotId,
            projectId,
          );
          return row
            ? (JSON.parse(row.snapshot_json) as IPTwinSnapshot)
            : undefined;
        });
        if (!twin)
          return problem(requestContext, 404, "NOT_FOUND", "未找到 IP 快照。");
        const affected = twin.nodes
          .filter((value) => parsed.data.hypothesis.includes(value.title))
          .map((value) => value.id);
        const deterministicFindings = [
          ...twin.conflicts,
          ...(affected.length
            ? [`假设直接提及 ${affected.length} 个权威节点。`]
            : ["假设未直接命中权威节点，需人工确认影响范围。"]),
        ];
        const now = new Date().toISOString();
        const value: ScenarioRun = {
          id: crypto.randomUUID(),
          projectId,
          snapshotId: twin.id,
          hypothesis: parsed.data.hypothesis,
          status: "preview",
          deterministicFindings,
          modelInferences: [],
          affectedNodeIds: affected,
          version: 0,
          createdAt: now,
          updatedAt: now,
        };
        context.uow.execute((transaction) => {
          transaction.run(
            `INSERT INTO knowledge_scenario_runs(
              id, project_id, snapshot_id, hypothesis, status,
              deterministic_findings_json, model_inferences_json,
              affected_node_ids_json, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'preview', ?, '[]', ?, 0, ?, ?)`,
            value.id,
            projectId,
            twin.id,
            value.hypothesis,
            JSON.stringify(value.deterministicFindings),
            JSON.stringify(value.affectedNodeIds),
            now,
            now,
          );
          append(
            transaction,
            "knowledge.story-simulation-created.v1",
            "story-simulation",
            value.id,
            0,
            value,
          );
        });
        return requestContext.json(value, 201);
      },
      { idempotency: "required" },
    ),
  );
  return routes;
}

export const creativeIntelligenceMigrations: readonly PluginMigration[] = [
  {
    id: "knowledge.0004.creative-intelligence",
    pluginId: "knowledge",
    version: "3.0.0-alpha.3",
    dependsOn: ["knowledge.0003.creator-research"],
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_corpus_sources (
        id TEXT PRIMARY KEY,
        url TEXT,
        domain TEXT,
        title TEXT NOT NULL,
        excerpt TEXT,
        content_hash TEXT,
        status TEXT NOT NULL CHECK(status IN ('quarantined','allowed','blocked','takedown')),
        rights_status TEXT NOT NULL CHECK(rights_status IN ('unknown','review_required','allowed','restricted','removed')),
        locale TEXT NOT NULL DEFAULT 'zh-CN',
        retrieved_at TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS knowledge_corpus_source_url
        ON knowledge_corpus_sources(url) WHERE url IS NOT NULL;
      CREATE TABLE IF NOT EXISTS knowledge_corpus_items (
        id TEXT PRIMARY KEY,
        source_id TEXT REFERENCES knowledge_corpus_sources(id) ON DELETE SET NULL,
        visibility TEXT NOT NULL CHECK(visibility IN ('public','private')),
        kind TEXT NOT NULL CHECK(kind IN (
          'meme','comic_device','dialogue_pattern','character_hook',
          'relationship_hook','conflict','reversal','scene','world_rule',
          'style','social_observation'
        )),
        title TEXT NOT NULL,
        trigger_text TEXT NOT NULL DEFAULT '',
        mechanism TEXT NOT NULL,
        emotional_effect TEXT NOT NULL DEFAULT '',
        contexts_json TEXT NOT NULL DEFAULT '[]',
        risk_tags_json TEXT NOT NULL DEFAULT '[]',
        tags_json TEXT NOT NULL DEFAULT '[]',
        freshness TEXT NOT NULL CHECK(freshness IN ('emerging','stable','cooling','expired','evergreen')),
        rights_status TEXT NOT NULL CHECK(rights_status IN ('unknown','review_required','allowed','restricted','removed')),
        locale TEXT NOT NULL DEFAULT 'zh-CN',
        tombstoned_at TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS knowledge_corpus_visibility_freshness
        ON knowledge_corpus_items(visibility, freshness, updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS knowledge_corpus_collections (
        id TEXT PRIMARY KEY,
        corpus_item_id TEXT REFERENCES knowledge_corpus_items(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        mechanism TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        adopted INTEGER NOT NULL DEFAULT 0 CHECK(adopted IN (0,1)),
        use_count INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_provenance_edges (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        from_type TEXT NOT NULL,
        from_id TEXT NOT NULL,
        relation TEXT NOT NULL CHECK(relation IN (
          'collected_from','inspired_by','derived_from','generated_from','adopted_from','quoted_from'
        )),
        to_type TEXT NOT NULL,
        to_id TEXT NOT NULL,
        quote_excerpt TEXT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE(from_type, from_id, relation, to_type, to_id)
      );
      CREATE INDEX IF NOT EXISTS knowledge_provenance_project
        ON knowledge_provenance_edges(project_id, created_at, id);
    `,
  },
  {
    id: "knowledge.0005.story-intelligence",
    pluginId: "knowledge",
    version: "3.0.0-alpha.3",
    dependsOn: ["knowledge.0004.creative-intelligence"],
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_causal_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN (
          'character','event','secret','rule','location','organization',
          'resource','relationship','inspiration'
        )),
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_version INTEGER NOT NULL DEFAULT 0,
        confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS knowledge_causal_nodes_project
        ON knowledge_causal_nodes(project_id, kind, created_at, id);
      CREATE TABLE IF NOT EXISTS knowledge_causal_edges (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        from_node_id TEXT NOT NULL REFERENCES knowledge_causal_nodes(id) ON DELETE CASCADE,
        to_node_id TEXT NOT NULL REFERENCES knowledge_causal_nodes(id) ON DELETE CASCADE,
        relation TEXT NOT NULL CHECK(relation IN ('causes','enables','blocks','reveals','conflicts_with','depends_on')),
        rationale TEXT NOT NULL DEFAULT '',
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0,1)),
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, from_node_id, relation, to_node_id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_audience_states (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        subject_type TEXT NOT NULL CHECK(subject_type IN ('audience','character')),
        subject_id TEXT NOT NULL,
        knowledge_node_id TEXT NOT NULL REFERENCES knowledge_causal_nodes(id) ON DELETE CASCADE,
        story_order INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('unknown','suspects','misbelieves','knows')),
        evidence TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, subject_type, subject_id, knowledge_node_id, story_order)
      );
      CREATE TABLE IF NOT EXISTS knowledge_ip_twin_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_fingerprint TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS knowledge_ip_twin_project
        ON knowledge_ip_twin_snapshots(project_id, created_at DESC, id);
      CREATE TABLE IF NOT EXISTS knowledge_scenario_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        snapshot_id TEXT NOT NULL REFERENCES knowledge_ip_twin_snapshots(id) ON DELETE CASCADE,
        hypothesis TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('preview','committed','discarded')),
        deterministic_findings_json TEXT NOT NULL DEFAULT '[]',
        model_inferences_json TEXT NOT NULL DEFAULT '[]',
        affected_node_ids_json TEXT NOT NULL DEFAULT '[]',
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

export function creativeIntelligenceService(
  context: PluginContext,
): CreativeKnowledgeService {
  return service(context);
}

export { CREATIVE_KNOWLEDGE_SERVICE };
