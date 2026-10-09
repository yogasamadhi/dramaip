import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  ProblemDetailsSchema,
  StoryCausalNodeSchema,
  type AgentContextReference,
  type StoryCausalNode,
} from "@dramaip/contracts";
import {
  KNOWLEDGE_STORY_ASSERTION_SERVICE,
  KNOWLEDGE_STORY_DECLARATION_SERVICE,
  StoryAssertionInputSchema,
  StoryAssertionBasisSchema,
  StoryAssertionSchema,
  StoryAssertionSummarySchema,
  StoryAssertionPageSchema,
  StoryAssertionAdoptInputSchema,
  StorySourceWithdrawInputSchema,
  StorySourceReplaceInputSchema,
  type StoryAssertionInput,
  type StoryAssertionBasis,
  type StoryAssertion,
} from "@dramaip/contracts/knowledge";
import { WORKSPACE_PROJECT_SERVICE } from "@dramaip/contracts/workspace";
import {
  defineRouteContribution,
  optionalService,
  provideService,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  compileStoryDeclarationBasis,
  SourceError,
  SOURCE_ANCHORED_NODE_TYPE,
} from "./story-declarations.js";
import {
  sourceLifecycle,
  sourceRetirementEvidence,
  retireStorySource,
} from "./story-source-lifecycle.js";

export const storyAssertionMigration: PluginMigration = {
  id: "knowledge.0010.source-anchored-assertions",
  pluginId: "knowledge",
  version: "3.0.0-alpha.5",
  dependsOn: ["knowledge.0009.source-anchored-declarations"],
  sql: `CREATE TABLE knowledge_story_assertions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    input_json TEXT NOT NULL, basis_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','adopted','discarded')),
    version INTEGER NOT NULL DEFAULT 0,
    adopted_kind TEXT CHECK(adopted_kind IN ('edge','cognition')), adopted_id TEXT, adopted_version INTEGER,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(adopted_kind, adopted_id),
    CHECK((status = 'adopted' AND adopted_kind IS NOT NULL AND adopted_id IS NOT NULL AND adopted_version IS NOT NULL)
      OR (status != 'adopted' AND adopted_kind IS NULL AND adopted_id IS NULL AND adopted_version IS NULL))
  );
  CREATE INDEX knowledge_story_assertions_project ON knowledge_story_assertions(project_id, created_at DESC, id DESC);
  CREATE TABLE knowledge_story_assertion_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    assertion_id TEXT NOT NULL REFERENCES knowledge_story_assertions(id) ON DELETE CASCADE,
    response_row_json TEXT NOT NULL, response_status INTEGER NOT NULL CHECK(response_status IN (200,201))
  );`,
};
interface Row {
  id: string;
  project_id: string;
  input_json: string;
  basis_json: string;
  status: StoryAssertion["status"];
  version: number;
  adopted_kind: "edge" | "cognition" | null;
  adopted_id: string | null;
  adopted_version: number | null;
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
interface Http {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
}
interface Receipt {
  key: string;
  hash: string;
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const asNode = (row: NodeRow) =>
  StoryCausalNodeSchema.parse({
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
  });
const selectedNodes = (input: StoryAssertionInput) =>
  input.kind === "relationship"
    ? [input.from, input.to]
    : [
        input.target,
        ...(input.subject.kind === "character" ? [input.subject.node] : []),
      ];

export function registerStoryAssertions(context: PluginContext) {
  const project = (id: string) => {
    const owner = optionalService(context, WORKSPACE_PROJECT_SERVICE);
    if (!owner) throw new SourceError(503, "实际项目读取服务不可用。");
    if (!owner.get(id)) throw new SourceError(404, "当前实际项目不存在。");
  };
  const compile = (
    projectId: string,
    input: StoryAssertionInput,
  ): StoryAssertionBasis => {
    const sourceBasis = compileStoryDeclarationBasis(context, projectId, input);
    const refs = selectedNodes(input);
    if (
      refs.some((ref, index) =>
        refs.some(
          (other, position) =>
            position !== index &&
            other.id === ref.id &&
            other.version !== ref.version,
        ),
      )
    )
      throw new SourceError(
        409,
        "同一实际节点版本互相冲突，不自动换成最新节点。",
      );
    const nodes = [...new Map(refs.map((ref) => [ref.id, ref])).values()].map(
      (ref) => {
        const row = context.uow.execute((tx) =>
          tx.get<NodeRow>(
            "SELECT * FROM knowledge_causal_nodes WHERE id = ? AND project_id = ? AND retired_at IS NULL",
            ref.id,
            projectId,
          ),
        );
        if (!row)
          throw new SourceError(404, "所选节点不存在或不属于当前项目。");
        const actual = asNode(row);
        if (!actual.confirmed || actual.version !== ref.version)
          throw new SourceError(409, "所选节点尚未确认或原版本已变化。");
        if (
          actual.sourceType !== "manual" &&
          actual.sourceType !== SOURCE_ANCHORED_NODE_TYPE
        )
          throw new SourceError(
            409,
            "任意来源标记不是明确人工节点或实际采用的来源声明。",
          );
        return actual;
      },
    );
    const characterId =
      input.kind === "cognition" && input.subject.kind === "character"
        ? input.subject.node.id
        : undefined;
    if (
      input.kind === "cognition" &&
      input.subject.kind === "character" &&
      !nodes.some(
        (value) => value.id === characterId && value.kind === "character",
      )
    )
      throw new SourceError(
        409,
        "角色认知主体须是所选实际角色节点，不能用观众或其他节点代替。",
      );
    const dependencies = new Map<
      string,
      StoryAssertionBasis["policyDependencies"][number]
    >();
    const dependency = (
      value: StoryAssertionBasis["policyDependencies"][number],
    ) => {
      const previous = dependencies.get(value.fieldPath);
      if (
        previous &&
        (previous.sourceId !== value.sourceId ||
          previous.sourceVersion !== value.sourceVersion)
      )
        throw new SourceError(
          409,
          "关系／认知和节点的上游来源版本冲突，不裁剪禁止依赖。",
        );
      dependencies.set(value.fieldPath, value);
    };
    sourceBasis.policyDependencies.forEach(dependency);
    for (const value of nodes) {
      dependency({
        sourceId: value.id,
        sourceVersion: value.version,
        fieldPath: `/story-declarations/nodes/${value.id}`,
      });
      if (value.sourceType === SOURCE_ANCHORED_NODE_TYPE) {
        const declarations = optionalService(
          context,
          KNOWLEDGE_STORY_DECLARATION_SERVICE,
        );
        if (!declarations)
          throw new SourceError(
            503,
            "正式节点来源服务不可用，不保留缺项证据。",
          );
        const reference = declarations.nodeReference(
          projectId,
          value.id,
          value.version,
        );
        if (!reference)
          throw new SourceError(
            409,
            "所选节点的正式原来源已失效或没有精确采用绑定。",
          );
        dependency({
          sourceId: reference.sourceId,
          sourceVersion: reference.sourceVersion,
          fieldPath: reference.fieldPath,
        });
        for (const original of reference.policyDependencies ?? [])
          dependency(original);
      }
    }
    // One slot is reserved for the eventually adopted edge/cognition denial path.
    if (dependencies.size > 1999)
      throw new SourceError(
        400,
        "完整节点与原文禁止依赖超出容量，请缩小选择，不静默裁剪。",
      );
    const basis = {
      format: "source-anchored-story-assertion-v1" as const,
      projectId,
      interpretationPolicy:
        "human-reviewed-not-semantic-or-calibrated-proof" as const,
      sourceBasis,
      nodes,
      policyDependencies: [...dependencies.values()].sort((a, b) =>
        a.fieldPath.localeCompare(b.fieldPath),
      ),
    };
    return StoryAssertionBasisSchema.parse({
      ...basis,
      fingerprint: hash({ input, basis }),
    });
  };
  const getRow = (projectId: string, id: string) =>
    context.uow.execute((tx) =>
      tx.get<Row>(
        "SELECT * FROM knowledge_story_assertions WHERE id = ? AND project_id = ?",
        id,
        projectId,
      ),
    );
  const binding = (projectId: string, kind: "edge" | "cognition", id: string) =>
    context.uow.execute((tx) =>
      tx.get<Row>(
        "SELECT * FROM knowledge_story_assertions WHERE project_id = ? AND status = 'adopted' AND adopted_kind = ? AND adopted_id = ?",
        projectId,
        kind,
        id,
      ),
    );
  const state = (row: Row): StoryAssertion["sourceStatus"] => {
    try {
      const input = StoryAssertionInputSchema.parse(JSON.parse(row.input_json)),
        basis = StoryAssertionBasisSchema.parse(JSON.parse(row.basis_json));
      return compile(row.project_id, input).fingerprint === basis.fingerprint
        ? { state: "current", reasons: [] }
        : { state: "stale", reasons: ["原文或所选节点身份／版本已变化。"] };
    } catch (cause) {
      return {
        state:
          cause instanceof SourceError && cause.status !== 503
            ? "stale"
            : "unavailable",
        reasons: [
          cause instanceof SourceError
            ? cause.message
            : "原关系／认知来源暂不可核对，不认为已经证明。",
        ],
      };
    }
  };
  const value = (row: Row): StoryAssertion => {
    const body = {
      id: row.id,
      projectId: row.project_id,
      version: row.version,
      status: row.status,
      input: StoryAssertionInputSchema.parse(JSON.parse(row.input_json)),
      basis: StoryAssertionBasisSchema.parse(JSON.parse(row.basis_json)),
      ...(row.adopted_kind && row.adopted_id && row.adopted_version !== null
        ? {
            adoptedRecord: {
              kind: row.adopted_kind,
              id: row.adopted_id,
              version: row.adopted_version,
            },
          }
        : {}),
      sourceStatus: state(row),
      ...(row.status === "adopted" &&
      row.adopted_id &&
      row.adopted_kind &&
      row.adopted_version !== null
        ? {
            lifecycle: context.uow.execute((tx) =>
              sourceLifecycle(tx, row.project_id, "assertion", row.id, {
                kind: row.adopted_kind!,
                id: row.adopted_id!,
                version: row.adopted_version!,
              }),
            ),
          }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    return StoryAssertionSchema.parse({ ...body, etag: `"${hash(body)}"` });
  };
  const currentRecord = (
    projectId: string,
    kind: "edge" | "cognition",
    id: string,
    version: number,
  ) => {
    const row = binding(projectId, kind, id);
    if (!row) {
      const exists = context.uow.execute((tx) =>
        kind === "edge"
          ? tx.get(
              "SELECT id FROM knowledge_causal_edges WHERE id = ? AND project_id = ? AND version = ? AND confirmed = 1 AND retired_at IS NULL",
              id,
              projectId,
              version,
            )
          : tx.get(
              "SELECT id FROM knowledge_audience_states WHERE id = ? AND project_id = ? AND version = ? AND retired_at IS NULL",
              id,
              projectId,
              version,
            ),
      );
      return exists ? { manual: true as const } : undefined;
    }
    if (row.adopted_version !== version) return undefined;
    const active = context.uow.execute((tx) =>
      kind === "edge"
        ? tx.get(
            "SELECT id FROM knowledge_causal_edges WHERE id = ? AND project_id = ? AND version = ? AND retired_at IS NULL",
            id,
            projectId,
            version,
          )
        : tx.get(
            "SELECT id FROM knowledge_audience_states WHERE id = ? AND project_id = ? AND version = ? AND retired_at IS NULL",
            id,
            projectId,
            version,
          ),
    );
    if (!active) return undefined;
    const assertion = value(row),
      input = assertion.input;
    const actual = context.uow.execute((tx) =>
      kind === "edge"
        ? tx.get<{
            from_node_id: string;
            to_node_id: string;
            relation: string;
            rationale: string;
            confidence: number;
            confirmed: number;
          }>(
            "SELECT * FROM knowledge_causal_edges WHERE id = ? AND project_id = ? AND version = ?",
            id,
            projectId,
            version,
          )
        : tx.get<{
            subject_type: string;
            subject_id: string;
            knowledge_node_id: string;
            story_order: number;
            state: string;
            evidence: string;
          }>(
            "SELECT * FROM knowledge_audience_states WHERE id = ? AND project_id = ? AND version = ?",
            id,
            projectId,
            version,
          ),
    );
    const exact =
      actual &&
      (input.kind === "relationship" &&
      kind === "edge" &&
      "from_node_id" in actual
        ? actual.from_node_id === input.from.id &&
          actual.to_node_id === input.to.id &&
          actual.relation === input.relation &&
          actual.rationale === input.statement &&
          actual.confidence === input.confidence &&
          Boolean(actual.confirmed)
        : input.kind === "cognition" &&
          kind === "cognition" &&
          "subject_type" in actual &&
          actual.subject_type === input.subject.kind &&
          actual.subject_id ===
            (input.subject.kind === "character"
              ? input.subject.node.id
              : input.subject.id) &&
          actual.knowledge_node_id === input.target.id &&
          actual.story_order === input.storyOrder &&
          actual.state === input.state &&
          actual.evidence === input.statement);
    if (!exact) return undefined;
    if (assertion.sourceStatus.state === "unavailable")
      throw new SourceError(
        503,
        "关系／认知本身的原来源暂不可核对，不生成缺项快照或外发上下文。",
      );
    return assertion.sourceStatus.state === "current"
      ? { manual: false as const, assertion }
      : undefined;
  };
  context.effect(
    () =>
      provideService(context, KNOWLEDGE_STORY_ASSERTION_SERVICE, {
        indexRecords: (projectId) => {
          project(projectId);
          const rows = context.uow.execute((tx) =>
            tx.all<Row>(
              "SELECT * FROM knowledge_story_assertions WHERE project_id = ? ORDER BY created_at, id LIMIT 20001",
              projectId,
            ),
          );
          if (rows.length > 20000)
            throw new SourceError(
              503,
              "关系／认知声明超过本地索引容量，未返回截断目录。",
            );
          return rows.map(value);
        },
        isSourceAnchored: (projectId, kind, id) =>
          Boolean(binding(projectId, kind, id)),
        isCurrentRecord: (projectId, kind, id, version) =>
          Boolean(currentRecord(projectId, kind, id, version)),
        references: (projectId) => {
          project(projectId);
          const rows = context.uow.execute((tx) =>
            tx.all<Row>(
              "SELECT * FROM knowledge_story_assertions WHERE project_id = ? AND status = 'adopted' ORDER BY created_at, id",
              projectId,
            ),
          );
          return rows.flatMap((row): AgentContextReference[] => {
            if (
              !row.adopted_kind ||
              !row.adopted_id ||
              row.adopted_version === null
            )
              return [];
            const current = currentRecord(
              projectId,
              row.adopted_kind,
              row.adopted_id,
              row.adopted_version,
            );
            if (!current || current.manual) return [];
            const assertion = current.assertion;
            return [
              {
                sourceKind: "knowledge",
                sourceId: row.id,
                sourceVersion: row.version,
                fieldPath: `/story-assertions/${row.id}`,
                sensitivity: "project",
                policyDependencies: [
                  ...assertion.basis.policyDependencies,
                  {
                    sourceId: row.adopted_id,
                    sourceVersion: row.adopted_version,
                    fieldPath:
                      row.adopted_kind === "edge"
                        ? `/story-declarations/edges/${row.adopted_id}`
                        : `/story-declarations/cognition/${row.adopted_id}`,
                  },
                ],
                value: {
                  id: row.id,
                  projectId,
                  version: row.version,
                  // Only the author's assertion and source identities are eligible;
                  // never silently include frozen quotes or endpoint summaries.
                  ...(({ sources: _sources, ...statement }) => statement)(
                    assertion.input,
                  ),
                  evidenceBasis:
                    "human-adopted-source-anchored-assertion-not-semantic-proof",
                  interpretationPolicy: assertion.basis.interpretationPolicy,
                  sourceFingerprint: assertion.basis.fingerprint,
                  sourceAnchors: assertion.basis.sourceBasis.sources.map(
                    ({ selection, quoteHash, anchors }) => ({
                      selection,
                      quoteHash,
                      anchors,
                    }),
                  ),
                },
              },
            ];
          });
        },
      }),
    `service:${KNOWLEDGE_STORY_ASSERTION_SERVICE}`,
  );
  const emit = (
    tx: UnitOfWorkTransaction,
    action: "created" | "adopted" | "discarded",
    row: Row,
  ) =>
    tx.append({
      type: `knowledge.story-assertion-${action}.v1`,
      pluginId: "knowledge",
      aggregateType: "story-assertion",
      aggregateId: row.id,
      aggregateVersion: row.version,
      payload: {
        id: row.id,
        projectId: row.project_id,
        version: row.version,
        status: row.status,
        ...(row.adopted_kind && row.adopted_id
          ? { recordKind: row.adopted_kind, recordId: row.adopted_id }
          : {}),
      },
    });
  const remember = (
    tx: UnitOfWorkTransaction,
    receipt: Receipt,
    row: Row,
    status: 200 | 201,
  ) =>
    tx.run(
      "INSERT INTO knowledge_story_assertion_requests(request_key, request_hash, assertion_id, response_row_json, response_status) VALUES (?, ?, ?, ?, ?)",
      receipt.key,
      receipt.hash,
      row.id,
      JSON.stringify(row),
      status,
    );
  const respond = (http: Http, row: Row, status = 200) => {
    const result = value(row);
    http.header("ETag", result.etag);
    return http.json(result, status);
  };
  const basePath = "/api/v2/projects/{projectId}/story-assertions";
  const params = z.object({ projectId: z.string().uuid() }),
    oneParams = params.extend({ assertionId: z.string().uuid() });
  const pagination = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });
  const register = (
    name: string,
    method: "get" | "post",
    path: string,
    response: z.ZodType,
    handler: (http: Http, receipt?: Receipt) => Promise<Response> | Response,
    body?: z.ZodType,
    status: 200 | 201 = 200,
  ) => {
    const route = defineRouteContribution({
      id: `knowledge:story-assertions-${name}`,
      pluginId: "knowledge",
      method,
      path: path as `/api/v2/${string}`,
      operationId: `storyAssertions.${name}`,
      declaration: createRoute({
        method,
        path,
        operationId: `storyAssertions.${name}`,
        tags: ["story-assertions"],
        request: {
          params: path === basePath ? params : oneParams,
          ...(name === "list" ? { query: pagination } : {}),
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
            description: "Frozen human-reviewed assertion, not semantic proof",
            content: { "application/json": { schema: response } },
          },
          ...Object.fromEntries(
            [400, 404, 409, 412, 428, 503].map((code) => [
              code,
              {
                description: "Assertion rejected",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            ]),
          ),
        },
      }),
      policy: {
        idempotency: method === "post" ? "required" : "forbidden",
        ...(method === "post" ? { idempotencyReplay: "handler" as const } : {}),
        concurrency: ["adopt", "discard", "withdraw", "replace"].includes(name)
          ? "if-match-required"
          : "optional",
      },
      handler: async (http: Http) => {
        try {
          project(http.req.param("projectId"));
          let receipt: Receipt | undefined;
          if (method === "post") {
            const key = http.req.header("Idempotency-Key");
            if (!key?.trim() || key.length > 200)
              throw new SourceError(
                428,
                "须保留本次关系／认知声明的原请求键。",
              );
            receipt = {
              key,
              hash: hash({
                operation: name,
                projectId: http.req.param("projectId"),
                assertionId:
                  path === basePath ? null : http.req.param("assertionId"),
                body: await http.req.json(),
                ifMatch: http.req.header("If-Match") ?? null,
              }),
            };
            const prior = context.uow.execute((tx) =>
              tx.get<{
                request_hash: string;
                response_row_json: string;
                response_status: 200 | 201;
              }>(
                "SELECT * FROM knowledge_story_assertion_requests WHERE request_key = ?",
                key,
              ),
            );
            if (prior) {
              if (prior.request_hash !== receipt.hash)
                throw new SourceError(
                  409,
                  "原动作键已经绑定不同输入／对象／审阅版本，不能替换。",
                );
              return respond(
                http,
                JSON.parse(prior.response_row_json) as Row,
                prior.response_status,
              );
            }
          }
          return await handler(http, receipt);
        } catch (cause) {
          if (!(cause instanceof SourceError)) throw cause;
          return Response.json(
            {
              type: "https://dramaip.local/problems/story-assertion",
              title: "Story assertion rejected",
              detail: cause.message,
              code: "STORY_ASSERTION",
              status: cause.status,
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
    context.effect(() => context.http.register(route), `route:${route.id}`);
  };
  register(
    "create",
    "post",
    basePath,
    StoryAssertionSchema,
    async (http, receipt) => {
      const parsed = StoryAssertionInputSchema.safeParse(await http.req.json());
      if (!parsed.success)
        throw new SourceError(400, "关系／认知、解释类型和实际来源选择无效。");
      const projectId = http.req.param("projectId"),
        basis = compile(projectId, parsed.data),
        now = new Date().toISOString();
      const row: Row = {
        id: crypto.randomUUID(),
        project_id: projectId,
        input_json: JSON.stringify(parsed.data),
        basis_json: JSON.stringify(basis),
        status: "pending",
        version: 0,
        adopted_kind: null,
        adopted_id: null,
        adopted_version: null,
        created_at: now,
        updated_at: now,
      };
      context.uow.execute((tx) => {
        tx.run(
          "INSERT INTO knowledge_story_assertions(id, project_id, input_json, basis_json, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)",
          row.id,
          projectId,
          row.input_json,
          row.basis_json,
          now,
          now,
        );
        emit(tx, "created", row);
        remember(tx, receipt!, row, 201);
      });
      return respond(http, row, 201);
    },
    StoryAssertionInputSchema,
    201,
  );
  register(
    "get",
    "get",
    `${basePath}/{assertionId}`,
    StoryAssertionSchema,
    (http) => {
      const row = getRow(
        http.req.param("projectId"),
        http.req.param("assertionId"),
      );
      if (!row) throw new SourceError(404, "未找到本项目原关系／认知声明。");
      return respond(http, row);
    },
  );
  register("list", "get", basePath, StoryAssertionPageSchema, (http) => {
    const parsed = pagination.safeParse({
      cursor: http.req.query("cursor"),
      limit: http.req.query("limit"),
    });
    if (!parsed.success) throw new SourceError(400, "声明分页参数无效。");
    const projectId = http.req.param("projectId"),
      cursor = parsed.data.cursor
        ? getRow(projectId, parsed.data.cursor)
        : undefined;
    if (parsed.data.cursor && !cursor)
      throw new SourceError(400, "游标不是本项目实际关系／认知声明。");
    const rows = context.uow.execute((tx) =>
      tx.all<Row>(
        "SELECT * FROM knowledge_story_assertions WHERE project_id = ? AND (? = '' OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
        projectId,
        cursor?.id ?? "",
        cursor?.created_at ?? "",
        cursor?.created_at ?? "",
        cursor?.id ?? "",
        parsed.data.limit + 1,
      ),
    );
    const items = rows.slice(0, parsed.data.limit).map((row) => {
      const { input, basis, etag: _etag, lifecycle, ...metadata } = value(row);
      return StoryAssertionSummarySchema.parse({
        ...metadata,
        ...(lifecycle
          ? {
              lifecycle: {
                state: lifecycle.state,
                version: lifecycle.version,
                record: lifecycle.record,
                ...(lifecycle.replacementId
                  ? { replacementId: lifecycle.replacementId }
                  : {}),
              },
            }
          : {}),
        title: input.title,
        kind: input.kind,
        sourceFingerprint: basis.fingerprint,
      });
    });
    return http.json({
      projectId,
      items,
      ...(rows.length > parsed.data.limit
        ? { nextCursor: items.at(-1)!.id }
        : {}),
    });
  });
  for (const action of ["adopt", "discard"] as const)
    register(
      action,
      "post",
      `${basePath}/{assertionId}/${action}`,
      StoryAssertionSchema,
      async (http, receipt) => {
        const body = await http.req.json(),
          adoption =
            action === "adopt"
              ? StoryAssertionAdoptInputSchema.safeParse(body)
              : undefined;
        if (
          (adoption && !adoption.success) ||
          (action === "discard" &&
            !z.object({}).strict().safeParse(body).success)
        )
          throw new SourceError(
            400,
            "须明确审阅原文／节点版本和关系／认知解释，不能自动采用。",
          );
        const expected = http.req.header("If-Match");
        if (!expected)
          throw new SourceError(428, "处理原声明须保留审阅 ETag。");
        const projectId = http.req.param("projectId"),
          id = http.req.param("assertionId"),
          original = getRow(projectId, id);
        if (!original)
          throw new SourceError(404, "未找到本项目原关系／认知声明。");
        // All cross-owner reads finish synchronously before the write transaction.
        const current = value(original);
        if (current.etag !== expected)
          throw new SourceError(
            412,
            "原候选或来源状态已变，请重读原 ID，不换最新。",
          );
        const updated = context.uow.execute((tx) => {
          const row = tx.get<Row>(
            "SELECT * FROM knowledge_story_assertions WHERE id = ? AND project_id = ?",
            id,
            projectId,
          );
          if (!row || JSON.stringify(row) !== JSON.stringify(original))
            throw new SourceError(412, "原声明已变，不能覆盖。");
          if (row.status !== "pending")
            throw new SourceError(
              409,
              "原声明已处理，不执行第二次采用或放弃。",
            );
          const now = new Date().toISOString();
          if (action === "adopt") {
            if (current.sourceStatus.state === "unavailable")
              throw new SourceError(
                503,
                "原文或节点来源暂不可核对，不能采用旧缓存。",
              );
            if (
              !adoption?.success ||
              adoption.data.sourceFingerprint !== current.basis.fingerprint ||
              current.sourceStatus.state !== "current"
            )
              throw new SourceError(409, "原来源已失效或指纹不符，不能采用。");
            for (const frozen of current.basis.nodes) {
              const actual = tx.get<NodeRow>(
                "SELECT * FROM knowledge_causal_nodes WHERE id = ? AND project_id = ? AND retired_at IS NULL",
                frozen.id,
                projectId,
              );
              if (!actual || hash(asNode(actual)) !== hash(frozen))
                throw new SourceError(412, "实际节点在提交前变化，未采用。");
            }
            const input = current.input,
              recordId = crypto.randomUUID();
            const existing =
              input.kind === "relationship"
                ? tx.get<{ id: string }>(
                    "SELECT id FROM knowledge_causal_edges WHERE project_id = ? AND from_node_id = ? AND relation = ? AND to_node_id = ? AND retired_at IS NULL",
                    projectId,
                    input.from.id,
                    input.relation,
                    input.to.id,
                  )
                : tx.get<{ id: string }>(
                    "SELECT id FROM knowledge_audience_states WHERE project_id = ? AND subject_type = ? AND subject_id = ? AND knowledge_node_id = ? AND story_order = ? AND retired_at IS NULL",
                    projectId,
                    input.subject.kind,
                    input.subject.kind === "character"
                      ? input.subject.node.id
                      : input.subject.id,
                    input.target.id,
                    input.storyOrder,
                  );
            if (existing)
              throw new SourceError(
                409,
                "相同关系或同一认知位置已有实际记录；原候选保留未采用，不覆盖既有声明。",
              );
            if (input.kind === "relationship")
              tx.run(
                "INSERT INTO knowledge_causal_edges(id, project_id, from_node_id, to_node_id, relation, rationale, confidence, confirmed, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)",
                recordId,
                projectId,
                input.from.id,
                input.to.id,
                input.relation,
                input.statement,
                input.confidence,
                now,
                now,
              );
            else
              tx.run(
                "INSERT INTO knowledge_audience_states(id, project_id, subject_type, subject_id, knowledge_node_id, story_order, state, evidence, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
                recordId,
                projectId,
                input.subject.kind,
                input.subject.kind === "character"
                  ? input.subject.node.id
                  : input.subject.id,
                input.target.id,
                input.storyOrder,
                input.state,
                input.statement,
                now,
                now,
              );
            tx.run(
              "UPDATE knowledge_story_assertions SET status = 'adopted', version = version + 1, adopted_kind = ?, adopted_id = ?, adopted_version = 0, updated_at = ? WHERE id = ?",
              input.kind === "relationship" ? "edge" : "cognition",
              recordId,
              now,
              id,
            );
          } else
            tx.run(
              "UPDATE knowledge_story_assertions SET status = 'discarded', version = version + 1, updated_at = ? WHERE id = ?",
              now,
              id,
            );
          const result = tx.get<Row>(
            "SELECT * FROM knowledge_story_assertions WHERE id = ?",
            id,
          )!;
          emit(tx, action === "adopt" ? "adopted" : "discarded", result);
          remember(tx, receipt!, result, 200);
          return result;
        });
        return respond(http, updated);
      },
      action === "adopt"
        ? StoryAssertionAdoptInputSchema
        : z.object({}).strict(),
    );
  for (const action of ["withdraw", "replace"] as const)
    register(
      action,
      "post",
      `${basePath}/{assertionId}/${action}`,
      StoryAssertionSchema,
      async (http, receipt) => {
        const parsed = (
          action === "replace"
            ? StorySourceReplaceInputSchema
            : StorySourceWithdrawInputSchema
        ).safeParse(await http.req.json());
        if (!parsed.success)
          throw new SourceError(
            400,
            "须明确核对原图记录、撤回理由及指定新候选的两项审阅。",
          );
        const expected = http.req.header("If-Match");
        if (!expected)
          throw new SourceError(428, "须保留原关系／认知的审阅 ETag。");
        const projectId = http.req.param("projectId"),
          id = http.req.param("assertionId"),
          row = getRow(projectId, id);
        if (!row) throw new SourceError(404, "未找到本项目原关系／认知声明。");
        const original = value(row);
        if (original.etag !== expected)
          throw new SourceError(412, "原声明已变，请重查原 ID。");
        if (row.status !== "adopted" || !original.adoptedRecord)
          throw new SourceError(
            409,
            "只能明确撤回或替换已独立采用的原关系／认知声明。",
          );
        const adopted = original.adoptedRecord,
          old = original.input;
        const fields =
          old.kind === "relationship"
            ? {
                from_node_id: old.from.id,
                to_node_id: old.to.id,
                relation: old.relation,
                rationale: old.statement,
                confidence: old.confidence,
                confirmed: 1,
              }
            : {
                subject_type: old.subject.kind,
                subject_id:
                  old.subject.kind === "character"
                    ? old.subject.node.id
                    : old.subject.id,
                knowledge_node_id: old.target.id,
                story_order: old.storyOrder,
                state: old.state,
                evidence: old.statement,
              };
        const evidence = context.uow.execute((tx) =>
          sourceRetirementEvidence(
            tx,
            projectId,
            "assertion",
            id,
            adopted,
            parsed.data,
            fields,
          ),
        );
        const replacementInput =
          action === "replace"
            ? StorySourceReplaceInputSchema.parse(parsed.data).replacement
            : undefined;
        const nextRow = replacementInput
          ? getRow(projectId, replacementInput.id)
          : undefined;
        if (replacementInput && !nextRow)
          throw new SourceError(404, "指定新候选不存在或不属于本项目。");
        const next = nextRow ? value(nextRow) : undefined;
        if (next && replacementInput) {
          if (next.etag !== replacementInput.etag)
            throw new SourceError(412, "指定新候选或来源已变化，请重审原 ID。");
          if (next.sourceStatus.state === "unavailable")
            throw new SourceError(503, "新来源不可核对，不采用缺项候选。");
          if (
            next.status !== "pending" ||
            next.id === id ||
            next.input.kind !== original.input.kind ||
            next.sourceStatus.state !== "current" ||
            next.basis.fingerprint !== replacementInput.sourceFingerprint
          )
            throw new SourceError(
              409,
              "新来源必须是同类、当前且单独审阅的本项目未采用候选。",
            );
        }
        context.uow.execute((tx) => {
          if (
            JSON.stringify(
              tx.get<Row>(
                "SELECT * FROM knowledge_story_assertions WHERE id = ? AND project_id = ?",
                id,
                projectId,
              ),
            ) !== JSON.stringify(row)
          )
            throw new SourceError(412, "原声明在提交前变化。");
          if (
            nextRow &&
            JSON.stringify(
              tx.get<Row>(
                "SELECT * FROM knowledge_story_assertions WHERE id = ? AND project_id = ?",
                nextRow.id,
                projectId,
              ),
            ) !== JSON.stringify(nextRow)
          )
            throw new SourceError(412, "指定新候选在提交前变化。");
          retireStorySource(
            tx,
            projectId,
            "assertion",
            id,
            adopted,
            parsed.data,
            fields,
            evidence,
            next?.id,
          );
          if (next) {
            for (const frozen of next.basis.nodes) {
              const actual = tx.get<NodeRow>(
                "SELECT * FROM knowledge_causal_nodes WHERE id = ? AND project_id = ? AND retired_at IS NULL",
                frozen.id,
                projectId,
              );
              if (!actual || hash(asNode(actual)) !== hash(frozen))
                throw new SourceError(
                  412,
                  "指定新候选的实际节点在提交前变化。",
                );
            }
            const input = next.input,
              recordId = crypto.randomUUID(),
              now = new Date().toISOString();
            const existing =
              input.kind === "relationship"
                ? tx.get(
                    "SELECT id FROM knowledge_causal_edges WHERE project_id = ? AND from_node_id = ? AND relation = ? AND to_node_id = ? AND retired_at IS NULL",
                    projectId,
                    input.from.id,
                    input.relation,
                    input.to.id,
                  )
                : tx.get(
                    "SELECT id FROM knowledge_audience_states WHERE project_id = ? AND subject_type = ? AND subject_id = ? AND knowledge_node_id = ? AND story_order = ? AND retired_at IS NULL",
                    projectId,
                    input.subject.kind,
                    input.subject.kind === "character"
                      ? input.subject.node.id
                      : input.subject.id,
                    input.target.id,
                    input.storyOrder,
                  );
            if (existing)
              throw new SourceError(
                409,
                "指定新候选位置已有另一实际记录，不覆盖、不复用旧占用。",
              );
            if (input.kind === "relationship")
              tx.run(
                "INSERT INTO knowledge_causal_edges(id,project_id,from_node_id,to_node_id,relation,rationale,confidence,confirmed,version,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)",
                recordId,
                projectId,
                input.from.id,
                input.to.id,
                input.relation,
                input.statement,
                input.confidence,
                now,
                now,
              );
            else
              tx.run(
                "INSERT INTO knowledge_audience_states(id,project_id,subject_type,subject_id,knowledge_node_id,story_order,state,evidence,version,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
                recordId,
                projectId,
                input.subject.kind,
                input.subject.kind === "character"
                  ? input.subject.node.id
                  : input.subject.id,
                input.target.id,
                input.storyOrder,
                input.state,
                input.statement,
                now,
                now,
              );
            tx.run(
              "UPDATE knowledge_story_assertions SET status = 'adopted', version = version + 1, adopted_kind = ?, adopted_id = ?, adopted_version = 0, updated_at = ? WHERE id = ?",
              input.kind === "relationship" ? "edge" : "cognition",
              recordId,
              now,
              next.id,
            );
            emit(
              tx,
              "adopted",
              tx.get<Row>(
                "SELECT * FROM knowledge_story_assertions WHERE id = ?",
                next.id,
              )!,
            );
          }
          remember(tx, receipt!, row, 200);
        });
        return respond(http, row);
      },
      action === "replace"
        ? StorySourceReplaceInputSchema
        : StorySourceWithdrawInputSchema,
    );
}
