import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import { AGENT_CONTEXT_SERVICE } from "@dramaip/contracts/agent-context";
import { KNOWLEDGE_STORY_DECLARATION_SERVICE } from "@dramaip/contracts/knowledge";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import {
  PRODUCTION_SCREENPLAY_SOURCE_SERVICE,
  PRODUCTION_STORYBOARD_ATTRIBUTION_SERVICE,
  StoryboardAttributionSourceSchema,
  StoryboardAttributionSchema,
  StoryboardAttributionCreateSchema,
  StoryboardAttributionDecisionSchema,
  StoryboardAttributionPageSchema,
  StoryboardAttributionSummaryPageSchema,
  StoryboardAttributionSummarySchema,
  type EpisodeDevelopmentResult,
  type StoryboardAttribution,
  type StoryboardAttributionSource,
} from "@dramaip/contracts/production";
import {
  defineRouteContribution,
  optionalService,
  provideService,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  captureProductionRecordBaseline,
  type BaselineRecordRow,
  type ProductionRecordBaseline,
} from "./record-baselines.js";
import { inspectSceneSourceEvidence } from "./scene-source-evidence.js";
import {
  inspectStoryboardAttribution,
  storyboardAttributionHash,
  storyboardAttributionSourceHash,
} from "./storyboard-attribution-content.js";
import { createStoryboardAttributionImpactReader } from "./storyboard-attribution-impact.js";

export const storyboardAttributionMigration: PluginMigration = {
  id: "production.0017.exact-shot-attributions",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0016.scene-topology-retirement"],
  sql: `CREATE TABLE production_storyboard_attributions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    storyboard_id TEXT NOT NULL REFERENCES production_episode_results(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX production_storyboard_attribution_page ON production_storyboard_attributions(project_id,created_at DESC,id DESC);
  CREATE TABLE production_storyboard_attribution_heads (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    storyboard_id TEXT NOT NULL REFERENCES production_episode_results(id) ON DELETE CASCADE,
    attribution_id TEXT NOT NULL REFERENCES production_storyboard_attributions(id) ON DELETE CASCADE,
    PRIMARY KEY(project_id,storyboard_id)
  );
  CREATE TABLE production_storyboard_attribution_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    attribution_id TEXT NOT NULL REFERENCES production_storyboard_attributions(id) ON DELETE CASCADE,
    response_json TEXT NOT NULL, response_status INTEGER NOT NULL
  );`,
};
type StoredResult = Omit<
  EpisodeDevelopmentResult,
  "isCurrent" | "sourceState" | "staleReasons"
> & { recordBaselines?: ProductionRecordBaseline[] };
type Stored = Omit<
  StoryboardAttribution,
  "isCurrent" | "sourceState" | "sourceReasons"
>;
type Owner = {
  read(tx: UnitOfWorkTransaction, id: string): StoredResult | undefined;
  head(
    tx: UnitOfWorkTransaction,
    projectId: string,
    episodeId: string,
    operation: EpisodeDevelopmentResult["operation"],
  ): string | undefined;
  sourceReasons(value: StoredResult): string[];
};
type HttpContext = {
  req: {
    param(name: string): string;
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  json(value: unknown, status?: 200 | 201): Response;
  header(name: string, value: string): void;
};
class AttributionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(message: string): never {
  throw new AttributionError(409, message);
}
const jsonHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function registerStoryboardAttributions(
  context: PluginContext,
  owner: Owner,
) {
  const read = (
    tx: UnitOfWorkTransaction,
    projectId: string,
    id: string,
  ): Stored | undefined => {
    const row = tx.get<{ value_json: string }>(
      "SELECT value_json FROM production_storyboard_attributions WHERE id = ? AND project_id = ?",
      id,
      projectId,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const head = (
    tx: UnitOfWorkTransaction,
    projectId: string,
    storyboardId: string,
  ) =>
    tx.get<{ attribution_id: string }>(
      "SELECT attribution_id FROM production_storyboard_attribution_heads WHERE project_id = ? AND storyboard_id = ?",
      projectId,
      storyboardId,
    )?.attribution_id ?? null;
  const capture = (
    projectId: string,
    selected: { id: string; version: number },
  ): StoryboardAttributionSource => {
    const board = context.uow.execute((tx) => owner.read(tx, selected.id));
    if (
      !board ||
      board.projectId !== projectId ||
      board.operation !== "storyboard-package" ||
      board.content.kind !== "storyboard-package"
    )
      throw new AttributionError(404, "所选正式分镜不存在或不属于本项目。");
    if (
      board.version !== selected.version ||
      context.uow.execute((tx) =>
        owner.head(tx, projectId, board.episodeId, "storyboard-package"),
      ) !== board.id ||
      owner.sourceReasons(board).length
    )
      fail("原正式分镜或其实际来源已变化；不换成最新版本。");
    const outline =
      board.basis.request.outline &&
      context.uow.execute((tx) =>
        owner.read(tx, board.basis.request.outline!.id),
      );
    const script =
      board.basis.request.script &&
      context.uow.execute((tx) =>
        owner.read(tx, board.basis.request.script!.id),
      );
    if (
      !outline ||
      !script ||
      outline.projectId !== projectId ||
      script.projectId !== projectId ||
      outline.episodeId !== board.episodeId ||
      script.episodeId !== board.episodeId ||
      outline.content.kind !== "episode-outline" ||
      script.content.kind !== "episode-script" ||
      outline.version !== board.basis.request.outline!.version ||
      script.version !== board.basis.request.script!.version ||
      context.uow.execute((tx) =>
        owner.head(tx, projectId, board.episodeId, "episode-outline"),
      ) !== outline.id ||
      context.uow.execute((tx) =>
        owner.head(tx, projectId, board.episodeId, "episode-script"),
      ) !== script.id ||
      owner.sourceReasons(outline).length ||
      owner.sourceReasons(script).length
    )
      fail("所选分镜的精确正式大纲／剧本或其来源未核全。");
    if (
      !outline.basis.request.sourceEvidenceFormat ||
      !outline.sourceEvidence?.length ||
      !board.sourceEvidence?.length ||
      storyboardAttributionHash(outline.sourceEvidence) !==
        storyboardAttributionHash(board.sourceEvidence)
    )
      fail("此历史版本缺少真实逐场引文协议，不补造镜头来源。");
    const snapshots = optionalService(context, AGENT_CONTEXT_SERVICE);
    if (!snapshots) throw new AttributionError(503, "冻结来源读取服务不可用。");
    const snapshot = snapshots.getSnapshot(outline.sourceSnapshotId);
    if (!snapshot || snapshot.projectId !== projectId)
      throw new AttributionError(503, "原大纲实际冻结来源不可用。");
    let evidence;
    try {
      evidence = inspectSceneSourceEvidence(
        outline.content.value,
        outline.basis,
        snapshot.entries,
        outline.origin === "human-topology-revision" ||
          outline.origin === "human-source-revision"
          ? "human-declared"
          : "model-declared",
      );
    } catch {
      fail("实际冻结引文／位置与正式声明不符，不把历史记录升级成新证据。");
    }
    if (
      !evidence ||
      storyboardAttributionHash(evidence) !==
        storyboardAttributionHash(outline.sourceEvidence)
    )
      fail("原逐场引文证据不一致。");
    const screenplays = optionalService(
      context,
      PRODUCTION_SCREENPLAY_SOURCE_SERVICE,
    );
    if (!screenplays || !script.scriptId)
      throw new AttributionError(503, "正式剧本只读来源服务不可用。");
    const saved = screenplays.get(projectId, script.scriptId);
    if (
      !saved ||
      saved.source.state !== "available" ||
      saved.source.document.version !== script.scriptDocumentVersion ||
      jsonHash(saved.source.document.blocks) !==
        jsonHash(script.content.value.blocks)
    )
      fail("实际已保存剧本与正式稳定块不一致，不初始化或重解析文档。");
    const document = {
      id: saved.source.document.id,
      version: saved.source.document.version,
      scriptId: saved.scriptId,
      scriptVersion: saved.scriptVersion,
      contentHash: saved.source.contentHash,
    };
    let originalScriptDocument: StoryboardAttributionSource["originalScriptDocument"];
    const original = outline.basis.request.direct?.sourceScript;
    if (original) {
      const source = screenplays.get(projectId, original.id);
      if (
        !source ||
        source.source.state !== "available" ||
        source.scriptVersion !== original.version ||
        source.source.document.version !== original.documentVersion
      )
        fail("当前明确原稿文档身份／版本不可用，不倒推历史文档身份。");
      originalScriptDocument = {
        id: source.source.document.id,
        version: source.source.document.version,
        scriptId: source.scriptId,
        scriptVersion: source.scriptVersion,
        contentHash: source.source.contentHash,
      };
    }
    const chapterReader = optionalService(context, WRITING_CHAPTER_SERVICE);
    const chapters = [
      ...new Map(
        evidence
          .filter((e) => e.source.sourceKind === "chapter")
          .map((e) => [e.source.sourceId, e.source]),
      ).values(),
    ].map((ref) => {
      if (!chapterReader)
        throw new AttributionError(503, "原章节读取服务不可用。");
      const chapter = chapterReader.get(ref.sourceId);
      if (
        !chapter ||
        chapter.projectId !== projectId ||
        chapter.version !== ref.sourceVersion
      )
        fail("实际原章节版本不可用，不补最新章节。");
      return {
        id: chapter.id,
        version: chapter.version,
        contentHash: jsonHash(chapter.content),
      };
    });
    const bindings = board.productionRecords ?? [];
    if (
      !board.recordBaselines ||
      board.recordBaselines.length !== bindings.length
    )
      fail("历史实际场景／镜头字段基准未记录，不补造原采用证明。");
    const record = (kind: "scenes" | "shots", stableId: string) =>
      context.uow.execute((tx) => {
        const actual = bindings.filter(
          (b) => b.kind === kind && b.stableId === stableId,
        );
        if (actual.length !== 1) fail("实际场景／镜头绑定缺失或不唯一。");
        const binding = actual[0]!;
        const row = tx.get<BaselineRecordRow & { retired_at: string | null }>(
          "SELECT id,project_id,kind,version,title,parent_id,order_index,payload_json,retired_at FROM production_records WHERE id = ? AND project_id = ? AND kind = ?",
          binding.id,
          projectId,
          kind,
        );
        if (!row || row.retired_at) fail("实际场景／镜头不存在或已明确退役。");
        const current = captureProductionRecordBaseline({
          row,
          binding,
          projectId,
          result: { id: board.id, version: board.version },
        });
        const prior = board.recordBaselines!.filter((b) => b.id === binding.id);
        if (prior.length !== 1 || prior[0]!.contentHash !== current.contentHash)
          fail("实际场景／镜头字段与原基准不一致。");
        return {
          id: binding.id,
          version: binding.version,
          contentHash: current.contentHash,
        };
      });
    const body = {
      format: "exact-shot-attribution-source-v1" as const,
      projectId,
      episodeId: board.episodeId,
      storyboard: {
        id: board.id,
        version: board.version,
        contentHash: storyboardAttributionHash(board),
        sourceSnapshotId: board.sourceSnapshotId,
      },
      outline: {
        id: outline.id,
        version: outline.version,
        contentHash: storyboardAttributionHash(outline),
        sourceSnapshotId: outline.sourceSnapshotId,
      },
      script: {
        id: script.id,
        version: script.version,
        contentHash: storyboardAttributionHash(script),
        sourceSnapshotId: script.sourceSnapshotId,
      },
      document,
      ...(originalScriptDocument ? { originalScriptDocument } : {}),
      chapters,
      scriptBlocks: script.content.value.blocks.map((block, index) => ({
        id: block.id,
        type: block.type,
        index,
      })),
      shots: board.content.value.scenes.flatMap((scene) => {
        const sceneRecord = record("scenes", scene.sceneId);
        return scene.shots.map((shot) => ({
          sceneId: scene.sceneId,
          shotId: shot.id,
          sceneRecord,
          shotRecord: record("shots", shot.id),
          sourceBlockIds: shot.sourceBlockIds,
        }));
      }),
      evidence,
      semanticVerification: "unverified" as const,
    };
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 8_388_608)
      throw new AttributionError(
        400,
        "实际关联来源超过8 MiB，不截断或默选局部。",
      );
    const source = StoryboardAttributionSourceSchema.parse({
      ...body,
      sourceFingerprint: storyboardAttributionSourceHash(body),
      baseAttributionId: context.uow.execute((tx) =>
        head(tx, projectId, board.id),
      ),
    });
    context.uow.execute((tx) => assertOwned(tx, source));
    return source;
  };
  // Public owner reads are synchronous and complete before the writer is
  // entered. Never nest peer UOWs. Recheck every Production-owned field/head
  // under the actual write lock; there is no await between these phases.
  const assertOwned = (
    tx: UnitOfWorkTransaction,
    source: StoryboardAttributionSource,
  ) => {
    for (const [operation, expected] of [
      ["storyboard-package", source.storyboard],
      ["episode-outline", source.outline],
      ["episode-script", source.script],
    ] as const) {
      const actual = owner.read(tx, expected.id);
      if (
        !actual ||
        actual.projectId !== source.projectId ||
        actual.episodeId !== source.episodeId ||
        actual.operation !== operation ||
        actual.version !== expected.version ||
        actual.sourceSnapshotId !== expected.sourceSnapshotId ||
        storyboardAttributionHash(actual) !== expected.contentHash ||
        owner.head(tx, source.projectId, source.episodeId, operation) !==
          actual.id
      )
        fail("本域正式结果／实际字段或采用头已变化，未覆盖原关联。");
    }
    for (const expected of [
      source.document,
      ...(source.originalScriptDocument ? [source.originalScriptDocument] : []),
    ]) {
      const script = tx.get<{ version: number }>(
        "SELECT version FROM production_records WHERE id = ? AND project_id = ? AND kind = 'scripts'",
        expected.scriptId,
        source.projectId,
      );
      const row = tx.get<{
        id: string;
        project_id: string;
        script_record_id: string;
        version: number;
        title: string;
        source_format: string;
        blocks_json: string;
        loss_report_json: string;
      }>(
        "SELECT id,project_id,script_record_id,version,title,source_format,blocks_json,loss_report_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
        expected.scriptId,
        source.projectId,
      );
      if (
        !script ||
        script.version !== expected.scriptVersion ||
        !row ||
        row.id !== expected.id ||
        row.version !== expected.version ||
        jsonHash({
          documentId: row.id,
          scriptId: expected.scriptId,
          projectId: source.projectId,
          version: row.version,
          title: row.title,
          sourceFormat: row.source_format,
          blocksJson: row.blocks_json,
          lossReportJson: row.loss_report_json,
        }) !== expected.contentHash
      )
        fail("实际已保存剧本文档／原稿版本或字节已变化，未采用旧确认。");
    }
    const board = owner.read(tx, source.storyboard.id)!;
    const seen = new Set<string>();
    for (const shot of source.shots)
      for (const [kind, stableId, expected] of [
        ["scenes", shot.sceneId, shot.sceneRecord],
        ["shots", shot.shotId, shot.shotRecord],
      ] as const) {
        if (seen.has(expected.id)) continue;
        seen.add(expected.id);
        const row = tx.get<BaselineRecordRow & { retired_at: string | null }>(
          "SELECT id,project_id,kind,version,title,parent_id,order_index,payload_json,retired_at FROM production_records WHERE id = ? AND project_id = ? AND kind = ?",
          expected.id,
          source.projectId,
          kind,
        );
        if (
          !row ||
          row.retired_at ||
          captureProductionRecordBaseline({
            row,
            binding: {
              id: expected.id,
              version: expected.version,
              stableId,
              kind,
            },
            projectId: source.projectId,
            result: { id: board.id, version: board.version },
          }).contentHash !== expected.contentHash
        )
          fail("实际场景／镜头身份、版本或字段已变化，未采用旧确认。");
      }
  };
  const inspect = (
    source: StoryboardAttributionSource,
    request: StoryboardAttribution["input"],
  ) =>
    inspectStoryboardAttribution({
      source,
      request,
      nodeReference: (id, version) => {
        const declarations = optionalService(
          context,
          KNOWLEDGE_STORY_DECLARATION_SERVICE,
        );
        if (!declarations)
          throw new AttributionError(503, "实际故事节点读取服务不可用。");
        try {
          return declarations.nodeReference(source.projectId, id, version);
        } catch {
          throw new AttributionError(
            503,
            "实际故事节点本次读取失败，不使用缓存或换节点。",
          );
        }
      },
    });
  const decode = (value: Stored): StoryboardAttribution => {
    let state: StoryboardAttribution["sourceState"] = "current";
    const reasons: string[] = [];
    try {
      const fresh = capture(value.projectId, value.input.storyboard);
      if (fresh.sourceFingerprint !== value.source.sourceFingerprint)
        fail("实际来源、记录字段或正式版本已变化，保留原关联。");
      const checked = inspect(
        { ...fresh, baseAttributionId: value.source.baseAttributionId },
        value.input,
      );
      if (checked.associationFingerprint !== value.associationFingerprint)
        fail("原已采用故事节点／位置或关联指纹已变化。");
    } catch (error) {
      state =
        error instanceof Error && "status" in error && error.status === 503
          ? "unavailable"
          : "stale";
      reasons.push(
        error instanceof AttributionError
          ? error.message
          : "原实际来源或节点无法核对，未使用缓存／最新对象替换。",
      );
    }
    return StoryboardAttributionSchema.parse({
      ...value,
      isCurrent:
        value.status === "adopted" &&
        context.uow.execute((tx) =>
          head(tx, value.projectId, value.source.storyboard.id),
        ) === value.id,
      sourceState: state,
      sourceReasons: reasons,
    });
  };
  const get = (projectId: string, id: string) => {
    const value = context.uow.execute((tx) => read(tx, projectId, id));
    return value ? decode(value) : undefined;
  };
  context.effect(
    () =>
      provideService(context, PRODUCTION_STORYBOARD_ATTRIBUTION_SERVICE, {
        get,
      }),
    `service:${PRODUCTION_STORYBOARD_ATTRIBUTION_SERVICE.id}`,
  );
  const originalReceipt = (
    tx: UnitOfWorkTransaction,
    key: string,
    hash: string,
  ) => {
    const original = tx.get<{
      request_hash: string;
      response_json: string;
      response_status: 200 | 201;
    }>(
      "SELECT request_hash,response_json,response_status FROM production_storyboard_attribution_requests WHERE request_key = ?",
      key,
    );
    if (!original) return undefined;
    if (original.request_hash !== hash)
      fail("原请求键已用于不同动作／项目／输入，不重新创建或换键。");
    return {
      value: JSON.parse(original.response_json) as Stored,
      status: original.response_status,
    };
  };
  const remember = (
    tx: UnitOfWorkTransaction,
    key: string,
    hash: string,
    value: Stored,
    status: 200 | 201,
  ) =>
    tx.run(
      "INSERT INTO production_storyboard_attribution_requests(request_key,request_hash,attribution_id,response_json,response_status) VALUES (?,?,?,?,?)",
      key,
      hash,
      value.id,
      JSON.stringify(value),
      status,
    );
  const append = (tx: UnitOfWorkTransaction, value: Stored) =>
    tx.append({
      type: `production.storyboard-attribution-${value.status === "pending" ? "created" : value.status}.v1`,
      pluginId: "production",
      aggregateType: "storyboard-attribution",
      aggregateId: value.id,
      aggregateVersion: value.version,
      payload: {
        id: value.id,
        projectId: value.projectId,
        version: value.version,
        status: value.status,
        storyboard: {
          id: value.source.storyboard.id,
          version: value.source.storyboard.version,
        },
        sourceFingerprint: value.source.sourceFingerprint,
        associationFingerprint: value.associationFingerprint,
        associatedShots: value.coverage.associatedShots,
        semanticVerification: "unverified",
      },
    });
  const key = (http: HttpContext) => {
    const value = http.req.header("Idempotency-Key");
    if (!value?.trim() || value.length > 200)
      throw new AttributionError(400, "须保留本次人工关联的原请求键。");
    return value;
  };
  const etag = (http: HttpContext, expected: string) => {
    if (http.req.header("If-Match") !== `"${expected}"`)
      throw new AttributionError(
        412,
        "需要精确原来源／版本的If-Match，未覆盖原候选。",
      );
  };
  const route = (
    method: "get" | "post",
    path: `/${string}`,
    operationId: string,
    schema: z.ZodType,
    handler: (http: HttpContext) => unknown,
    body?: z.ZodType,
    write = false,
    status: 200 | 201 = 200,
  ) =>
    defineRouteContribution({
      id: `production:${operationId}`,
      pluginId: "production",
      method,
      path: `/api/v2${path}`,
      operationId,
      declaration: createRoute({
        method,
        path: `/api/v2${path}`,
        operationId,
        tags: ["production"],
        request: {
          params: z.object({
            projectId: z.string().uuid(),
            ...(path.includes("{id}") ? { id: z.string().uuid() } : {}),
          }),
          ...(body
            ? {
                body: {
                  required: true,
                  content: { "application/json": { schema: body } },
                },
              }
            : {}),
          ...(method === "get" &&
          (path.endsWith("/storyboard-attributions") ||
            path.endsWith("/storyboard-attributions/summaries"))
            ? {
                query: z.object({
                  cursor: z.string().uuid().optional(),
                  limit: z.coerce.number().int().min(1).max(100).default(20),
                }),
              }
            : {}),
          ...(path.includes("attribution-sources")
            ? {
                query: z.object({
                  version: z.coerce.number().int().positive(),
                }),
              }
            : {}),
        },
        responses: {
          [status]: {
            description:
              "Exact human-declared shot association; semantics remain unverified",
            content: { "application/json": { schema } },
          },
          409: {
            description: "Original source or identity conflict",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
        },
      }),
      policy: {
        idempotency: write ? "required" : "forbidden",
        concurrency: write ? "if-match-required" : "optional",
        ...(write ? { idempotencyReplay: "handler" as const } : {}),
      },
      handler: async (http: HttpContext) => {
        http.header("Cache-Control", "no-store");
        try {
          return await handler(http);
        } catch (error) {
          const status =
            error instanceof AttributionError
              ? error.status
              : error instanceof z.ZodError
                ? 400
                : error instanceof Error &&
                    "status" in error &&
                    error.status === 503
                  ? 503
                  : 500;
          const detail =
            error instanceof AttributionError
              ? error.message
              : status === 400
                ? "关联请求不符合精确契约，未创建虚构来源。"
                : "实际来源／节点读取或事务未完成，请沿原键核对；未声明语义通过。";
          return new Response(
            JSON.stringify({
              type: "https://dramaip.local/problems/storyboard-attribution",
              status,
              title: detail,
              detail,
              code: "STORYBOARD_ATTRIBUTION",
              traceId: crypto.randomUUID(),
            }),
            { status, headers: { "Content-Type": "application/problem+json" } },
          );
        }
      },
    });
  const root = "/projects/{projectId}/storyboard-attributions" as const;
  const list = (http: HttpContext, summary: boolean) => {
    const projectId = http.req.param("projectId"),
      cursor = z.string().uuid().optional().parse(http.req.query("cursor")),
      limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .parse(http.req.query("limit"));
    const values = context.uow.execute((tx) => {
      const anchor = cursor ? read(tx, projectId, cursor) : undefined;
      if (cursor && !anchor)
        throw new AttributionError(400, "原分页游标不属于此项目。");
      return tx
        .all<{ value_json: string }>(
          `SELECT value_json FROM production_storyboard_attributions WHERE project_id = ? ${anchor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
          projectId,
          ...(anchor ? [anchor.createdAt, anchor.createdAt, anchor.id] : []),
          limit + 1,
        )
        .map((row) => JSON.parse(row.value_json) as Stored);
    });
    return http.json({
      projectId,
      items: values.slice(0, limit).map((row) => {
        const value = decode(row);
        return summary
          ? StoryboardAttributionSummarySchema.parse({
              id: value.id,
              projectId: value.projectId,
              episodeId: value.source.episodeId,
              version: value.version,
              status: value.status,
              storyboard: {
                id: value.source.storyboard.id,
                version: value.source.storyboard.version,
              },
              outline: {
                id: value.source.outline.id,
                version: value.source.outline.version,
              },
              script: {
                id: value.source.script.id,
                version: value.source.script.version,
              },
              coverage: value.coverage,
              sourceFingerprint: value.source.sourceFingerprint,
              associationFingerprint: value.associationFingerprint,
              isCurrent: value.isCurrent,
              sourceState: value.sourceState,
              sourceReasons: value.sourceReasons,
              createdAt: value.createdAt,
              updatedAt: value.updatedAt,
            })
          : value;
      }),
      ...(values.length > limit ? { nextCursor: values[limit - 1]!.id } : {}),
    });
  };
  const contributions = [
    route(
      "get",
      `${root}/summaries`,
      "storyboardAttribution.summaries",
      StoryboardAttributionSummaryPageSchema,
      (http) => list(http, true),
    ),
    route(
      "get",
      "/projects/{projectId}/storyboard-attribution-sources/{id}",
      "storyboardAttribution.sources",
      StoryboardAttributionSourceSchema,
      (http) => {
        const selected = {
          id: http.req.param("id"),
          version: z.coerce
            .number()
            .int()
            .positive()
            .parse(http.req.query("version")),
        };
        const source = capture(http.req.param("projectId"), selected);
        http.header("ETag", `"${source.sourceFingerprint}"`);
        return http.json(source);
      },
    ),
    route(
      "post",
      root,
      "storyboardAttribution.create",
      StoryboardAttributionSchema,
      async (http) => {
        const projectId = http.req.param("projectId"),
          input = StoryboardAttributionCreateSchema.parse(
            await http.req.json(),
          ),
          originalKey = key(http),
          digest = storyboardAttributionHash({
            action: "create",
            projectId,
            input,
          });
        const original = context.uow.execute((tx) =>
          originalReceipt(tx, originalKey, digest),
        );
        if (original) {
          http.header("ETag", `"${original.value.version}"`);
          return http.json(decode(original.value), original.status);
        }
        etag(http, input.sourceFingerprint);
        const source = capture(projectId, input.storyboard);
        if (
          source.sourceFingerprint !== input.sourceFingerprint ||
          source.baseAttributionId !== input.baseAttributionId
        )
          fail("明确审阅的实际来源或关联采用头已变化，不静默重绑。");
        let checked;
        try {
          checked = inspect(source, input);
        } catch (error) {
          if (error instanceof AttributionError) throw error;
          throw new AttributionError(
            400,
            "逐镜头选择、具体引文位置或实际故事节点不匹配；未写入候选。",
          );
        }
        const response = context.uow.execute((tx) => {
          const replay = originalReceipt(tx, originalKey, digest);
          if (replay) return replay;
          assertOwned(tx, source);
          if (
            head(tx, projectId, source.storyboard.id) !==
            source.baseAttributionId
          )
            fail("关联采用头已变化，未创建旧位置候选。");
          const now = new Date().toISOString();
          const value: Stored = {
            id: crypto.randomUUID(),
            projectId,
            version: 0,
            status: "pending",
            origin: "human-declared",
            input,
            source,
            ...checked,
            createdAt: now,
            updatedAt: now,
          };
          // Public reads above have no async gap; all own rows/heads, receipt
          // and body-free event are checked/written under this same lock.
          tx.run(
            "INSERT INTO production_storyboard_attributions(id,project_id,storyboard_id,version,value_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
            value.id,
            projectId,
            source.storyboard.id,
            0,
            JSON.stringify(value),
            now,
            now,
          );
          remember(tx, originalKey, digest, value, 201);
          append(tx, value);
          return { value, status: 201 as const };
        });
        http.header("ETag", `"${response.value.version}"`);
        return http.json(decode(response.value), response.status);
      },
      StoryboardAttributionCreateSchema,
      true,
      201,
    ),
    route(
      "get",
      `${root}/{id}`,
      "storyboardAttribution.get",
      StoryboardAttributionSchema,
      (http) => {
        const value = get(http.req.param("projectId"), http.req.param("id"));
        if (!value)
          throw new AttributionError(404, "原人工关联不存在或不属于此项目。");
        http.header("ETag", `"${value.version}"`);
        return http.json(value);
      },
    ),
    route(
      "get",
      root,
      "storyboardAttribution.list",
      StoryboardAttributionPageSchema,
      (http) => list(http, false),
    ),
    route(
      "post",
      `${root}/{id}/decision`,
      "storyboardAttribution.decide",
      StoryboardAttributionSchema,
      async (http) => {
        const projectId = http.req.param("projectId"),
          id = http.req.param("id"),
          input = StoryboardAttributionDecisionSchema.parse(
            await http.req.json(),
          ),
          originalKey = key(http),
          digest = storyboardAttributionHash({
            action: "decision",
            projectId,
            id,
            input,
          });
        const original = context.uow.execute((tx) =>
          originalReceipt(tx, originalKey, digest),
        );
        if (original) {
          http.header("ETag", `"${original.value.version}"`);
          return http.json(decode(original.value), original.status);
        }
        etag(http, String(input.version));
        const value = context.uow.execute((tx) => read(tx, projectId, id));
        if (!value)
          throw new AttributionError(404, "原关联候选不存在或归属错误。");
        if (
          value.version !== input.version ||
          value.status !== "pending" ||
          input.sourceFingerprint !== value.source.sourceFingerprint ||
          input.associationFingerprint !== value.associationFingerprint
        )
          fail("原关联候选／版本或实际审阅指纹不一致。");
        let fresh: StoryboardAttributionSource | undefined;
        if (input.action === "adopt") {
          fresh = capture(projectId, value.input.storyboard);
          if (
            fresh.sourceFingerprint !== value.source.sourceFingerprint ||
            fresh.baseAttributionId !== value.source.baseAttributionId
          )
            fail("来源或明确关联采用位置已变化，保留原候选。");
          let checked;
          try {
            checked = inspect(fresh, value.input);
          } catch (error) {
            if (error instanceof AttributionError) throw error;
            fail("实际节点／位置已变化，未采用旧确认。");
          }
          if (checked.associationFingerprint !== value.associationFingerprint)
            fail("实际故事节点或关联绑定已变化，未采用旧确认。");
        }
        const response = context.uow.execute((tx) => {
          const replay = originalReceipt(tx, originalKey, digest);
          if (replay) return replay;
          const actual = read(tx, projectId, id);
          if (
            !actual ||
            actual.version !== input.version ||
            actual.status !== "pending" ||
            storyboardAttributionHash(actual) !==
              storyboardAttributionHash(value)
          )
            fail("本域原候选已变化，未覆盖当前决定。");
          if (fresh) {
            assertOwned(tx, fresh);
            if (
              head(tx, projectId, fresh.storyboard.id) !==
              value.source.baseAttributionId
            )
              fail("明确关联采用位置已变化，保留原候选。");
          }
          const now = new Date().toISOString();
          const next: Stored = {
            ...value,
            version: value.version + 1,
            status: input.action === "adopt" ? "adopted" : "discarded",
            updatedAt: now,
            ...(input.action === "adopt" ? { adoptedAt: now } : {}),
          };
          tx.run(
            "UPDATE production_storyboard_attributions SET version = ?,value_json = ?,updated_at = ? WHERE id = ? AND project_id = ? AND version = ?",
            next.version,
            JSON.stringify(next),
            now,
            id,
            projectId,
            input.version,
          );
          if (input.action === "adopt")
            tx.run(
              "INSERT INTO production_storyboard_attribution_heads(project_id,storyboard_id,attribution_id) VALUES (?,?,?) ON CONFLICT(project_id,storyboard_id) DO UPDATE SET attribution_id = excluded.attribution_id",
              projectId,
              next.source.storyboard.id,
              next.id,
            );
          remember(tx, originalKey, digest, next, 200);
          append(tx, next);
          return { value: next, status: 200 as const };
        });
        http.header("ETag", `"${response.value.version}"`);
        return http.json(decode(response.value), response.status);
      },
      StoryboardAttributionDecisionSchema,
      true,
    ),
  ];
  for (const contribution of contributions)
    context.effect(
      () => context.http.register(contribution),
      `route:${contribution.id}`,
    );
  return createStoryboardAttributionImpactReader(context, {
    read,
    head,
    readResult: owner.read,
  });
}
