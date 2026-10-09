import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import { CreativeOutcomeFactSchema } from "@dramaip/contracts/insights";
import {
  EpisodeDevelopmentResultSchema,
  EpisodeOutlineContentSchema,
  EpisodeScriptRevisionInputSchema,
  EpisodeScriptRevisionConfirmationSchema,
  EpisodeScriptRevisionSchema,
  EpisodeScriptRevisionPageSchema,
  EpisodeScriptRevisionSummarySchema,
  EpisodeScriptRevisionSummaryPageSchema,
  type EpisodeDevelopmentResult,
  type EpisodeScriptRevision,
  type EpisodeScriptRevisionInput,
  type EpisodeScriptRevisionConfirmation,
} from "@dramaip/contracts/production";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { inspectEpisodeScriptContent } from "./episode-script-content.js";
import { exportFountain } from "./screenplay-codec.js";

export const episodeScriptRevisionMigration: PluginMigration = {
  id: "production.0010.author-script-revisions",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0009.projectless-screenplay-intakes"],
  // The historical unique workflow column becomes the adoption key; actual
  // model workflow IDs stay in their own nullable unique column. Human edits
  // must never invent a workflow or run to satisfy the old storage shape.
  sql: `ALTER TABLE production_episode_results RENAME COLUMN workflow_id TO adoption_key;
    ALTER TABLE production_episode_results ADD COLUMN workflow_id TEXT;
    UPDATE production_episode_results SET workflow_id = adoption_key;
    CREATE UNIQUE INDEX production_episode_actual_workflow ON production_episode_results(workflow_id) WHERE workflow_id IS NOT NULL;
    CREATE TABLE production_episode_script_revisions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_result_id TEXT NOT NULL REFERENCES production_episode_results(id),
      value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX production_episode_script_revision_page ON production_episode_script_revisions(project_id, created_at DESC, id DESC);
    CREATE TABLE production_episode_script_revision_requests (
      request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
      revision_id TEXT NOT NULL REFERENCES production_episode_script_revisions(id) ON DELETE CASCADE
    );`,
};
type StoredResult = Omit<
  EpisodeDevelopmentResult,
  "isCurrent" | "sourceState" | "staleReasons"
>;
type Stored = Omit<EpisodeScriptRevision, "sourceState" | "staleReasons">;
type Owner = {
  read(tx: UnitOfWorkTransaction, id: string): StoredResult | undefined;
  head(
    tx: UnitOfWorkTransaction,
    projectId: string,
    episodeId: string,
    operation: EpisodeDevelopmentResult["operation"],
  ): string | undefined;
  sourceReasons(value: StoredResult): string[];
  revisionSourceStatus(value: StoredResult): 200 | 409 | 503;
  continuationTarget(
    projectId: string,
    basis: StoredResult["basis"],
  ): { targetKey: string; position: number } | undefined;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
class RevisionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(message: string): never {
  throw new RevisionError(409, message);
}
interface DocumentRow {
  id: string;
  script_record_id: string;
  version: number;
  title: string;
  blocks_json: string;
}
interface ScriptRow {
  id: string;
  version: number;
  parent_id: string | null;
  payload_json: string;
}

export function registerEpisodeScriptRevisions(
  context: PluginContext,
  owner: Owner,
) {
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<{ value_json: string }>(
      "SELECT value_json FROM production_episode_script_revisions WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const actual = (tx: UnitOfWorkTransaction, source: StoredResult) => ({
    document: tx.get<DocumentRow>(
      "SELECT id, script_record_id, version, title, blocks_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
      source.scriptId ?? "",
      source.projectId,
    ),
    record: tx.get<ScriptRow>(
      "SELECT id, version, parent_id, payload_json FROM production_records WHERE id = ? AND project_id = ? AND kind = 'scripts' AND retired_at IS NULL",
      source.scriptId ?? "",
      source.projectId,
    ),
  });
  const inputReasons = (source: StoredResult) => {
    const status = owner.revisionSourceStatus(source);
    if (status === 503)
      throw new RevisionError(
        503,
        "原人工来源祖先或冻结上下文暂不可核对，不使用缓存或替代稿件。",
      );
    const result = owner.sourceReasons(source).filter(
      (reason) =>
        reason !== "标准剧本已人工修改或不存在，保留原采用快照" &&
        reason !== "人工确认剧本记录已修改或不存在，保留原确认快照" &&
        reason !== "人工拓扑确认实际剧本记录已修改，保留原确认快照。" &&
        reason !== "来源确认实际脚本字段已变化或不可核对，保留原正式快照",
      // A new author edit can explicitly reconfirm actual document/record
      // changes, but never missing/corrupt paired formal ancestry.
    );
    if (status === 409)
      result.push(
        "原人工来源祖先、采用回执或当前禁止链未核全，不仅凭新正文确认。",
      );
    return result;
  };
  const reasons = (value: Stored): string[] => {
    const source = context.uow.execute((tx) =>
      owner.read(tx, value.sourceResult.id),
    );
    if (
      !source ||
      source.operation !== "episode-script" ||
      source.projectId !== value.projectId ||
      source.version !== value.sourceResult.version
    )
      return ["原正式剧本身份或版本不存在。"];
    const result = inputReasons(source);
    context.uow.execute((tx) => {
      if (
        owner.head(tx, value.projectId, value.episodeId, "episode-script") !==
        (value.resultId ?? value.sourceResult.id)
      )
        result.push("当前正式剧本采用头已变化。");
      if (
        owner.head(tx, value.projectId, value.episodeId, "episode-outline") !==
        value.outline.id
      )
        result.push("正式大纲采用头已变化。");
      const { document, record } = actual(tx, source);
      if (
        !document ||
        document.id !== value.document.id ||
        document.version !== value.document.version ||
        !record ||
        record.version !== value.scriptRecordVersion ||
        record.parent_id !== source.episodeRecordId
      )
        result.push("实际人工剧本或文档版本已变化，保留原预览。");
      else {
        try {
          const content = {
            blocks: JSON.parse(document.blocks_json),
            sceneLinks: value.content.sceneLinks,
          };
          if (
            hash(content) !== value.contentHash ||
            document.title !== value.title ||
            exportFountain(value.content.blocks).trim() !==
              String(
                (JSON.parse(record.payload_json) as Record<string, unknown>)[
                  "剧本内容"
                ] ?? "",
              ).trim()
          )
            result.push("实际人工正文、场景映射或标题与冻结预览不一致。");
        } catch {
          result.push("实际人工剧本未核全。");
        }
      }
    });
    return [...new Set(result)];
  };
  const decode = (value: Stored) => {
    const staleReasons = reasons(value);
    return EpisodeScriptRevisionSchema.parse({
      ...value,
      sourceState: staleReasons.length ? "stale" : "current",
      staleReasons,
    });
  };
  const get = (id: string) => {
    const value = context.uow.execute((tx) => read(tx, id));
    if (!value) throw new RevisionError(404, "人工剧本确认预览不存在。");
    return decode(value);
  };
  const receipt = (key: string, digest: string) =>
    context.uow.execute((tx) => {
      const row = tx.get<{ request_hash: string; revision_id: string }>(
        "SELECT request_hash, revision_id FROM production_episode_script_revision_requests WHERE request_key = ?",
        key,
      );
      if (row && row.request_hash !== digest)
        fail("同一请求键已绑定其他人工确认，不换源或覆盖。");
      return row?.revision_id;
    });
  const persist = (tx: UnitOfWorkTransaction, value: Stored) =>
    tx.run(
      "UPDATE production_episode_script_revisions SET value_json = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(value),
      value.updatedAt,
      value.id,
    );
  const remember = (
    tx: UnitOfWorkTransaction,
    key: string,
    digest: string,
    id: string,
  ) =>
    tx.run(
      "INSERT INTO production_episode_script_revision_requests VALUES (?, ?, ?)",
      key,
      digest,
      id,
    );
  const event = (tx: UnitOfWorkTransaction, value: Stored) =>
    tx.append({
      type: `production.episode-script-revision-${value.status === "pending" ? "previewed" : value.status}.v1`,
      pluginId: "production",
      aggregateType: "episode-script-revision",
      aggregateId: value.id,
      aggregateVersion: value.stateVersion,
      payload: {
        id: value.id,
        projectId: value.projectId,
        episodeId: value.episodeId,
        sourceResult: value.sourceResult,
        document: value.document,
        status: value.status,
        ...(value.resultId ? { resultId: value.resultId } : {}),
      },
    });
  const preview = (
    id: string,
    input: EpisodeScriptRevisionInput,
    key: string,
  ) => {
    const digest = hash({ id, action: "preview", input });
    const replay = receipt(key, digest);
    if (replay) return get(replay);
    const source = context.uow.execute((tx) => owner.read(tx, id));
    if (!source) throw new RevisionError(404, "原正式剧本不存在。");
    if (source.version !== input.sourceVersion)
      throw new RevisionError(412, "原正式剧本版本已变化。");
    if (
      source.operation !== "episode-script" ||
      source.content.kind !== "episode-script" ||
      !source.scriptId ||
      !source.episodeRecordId ||
      !source.basis.request.outline
    )
      fail("只有真实正式标准剧本可以确认人工修订。");
    const blocked = inputReasons(source);
    if (blocked.length)
      fail(
        `作者意图、故事来源、设定或大纲已变化；不能仅重新确认正文：${blocked.join("；")}`,
      );
    const saved = context.uow.execute((tx) => {
      if (
        owner.head(tx, source.projectId, source.episodeId, "episode-script") !==
        source.id
      )
        fail("仅当前正式剧本可确认人工修订。");
      const outline = owner.read(tx, source.basis.request.outline!.id);
      if (
        outline?.content.kind !== "episode-outline" ||
        outline.version !== source.basis.request.outline!.version ||
        owner.head(
          tx,
          source.projectId,
          source.episodeId,
          "episode-outline",
        ) !== outline.id
      )
        fail("当前正式大纲未核全。");
      const { document, record } = actual(tx, source);
      if (!document || !record || record.parent_id !== source.episodeRecordId)
        fail("实际剧本、文档或分集绑定不存在，不重建或猜测。");
      if (document.version !== input.documentVersion)
        throw new RevisionError(412, "实际剧本文档版本已变化。");
      if (document.version === source.scriptDocumentVersion)
        fail("实际文档没有新的人工修订，不创建重复正式版本。");
      const content = inspectEpisodeScriptContent(
        {
          blocks: JSON.parse(document.blocks_json),
          sceneLinks: input.sceneLinks,
        },
        EpisodeOutlineContentSchema.parse(outline.content.value),
      );
      if (
        exportFountain(content.blocks).trim() !==
        String(
          (JSON.parse(record.payload_json) as Record<string, unknown>)[
            "剧本内容"
          ] ?? "",
        ).trim()
      )
        fail("实际 AST 与正文未一致，不能冒充有效人工修订。");
      const at = new Date().toISOString();
      const value: Stored = {
        id: crypto.randomUUID(),
        projectId: source.projectId,
        episodeId: source.episodeId,
        sourceResult: { id: source.id, version: source.version },
        outline: { id: outline.id, version: outline.version },
        document: {
          id: document.id,
          version: document.version,
          scriptId: source.scriptId!,
        },
        scriptRecordVersion: record.version,
        title: document.title,
        content,
        contentHash: hash(content),
        basis: source.basis,
        sourceSnapshotId: source.sourceSnapshotId,
        status: "pending",
        stateVersion: 0,
        createdAt: at,
        updatedAt: at,
      };
      tx.run(
        "INSERT INTO production_episode_script_revisions VALUES (?, ?, ?, ?, ?, ?)",
        value.id,
        value.projectId,
        source.id,
        JSON.stringify(value),
        at,
        at,
      );
      remember(tx, key, digest, value.id);
      event(tx, value);
      return value.id;
    });
    return get(saved);
  };
  const action = (
    id: string,
    stateVersion: number,
    key: string,
    kind: "adopt" | "discard",
    confirmation?: EpisodeScriptRevisionConfirmation,
  ) => {
    const digest = hash({ id, stateVersion, kind, confirmation });
    const replay = receipt(key, digest);
    if (replay) return get(replay);
    const value = get(id);
    if (value.stateVersion !== stateVersion)
      throw new RevisionError(412, "确认预览状态已变化。");
    if (value.status !== "pending")
      fail("该预览已处理；不能以新请求再次采用或撤回。");
    if (kind === "adopt" && value.sourceState !== "current")
      fail(`实际正文或正式来源已变化：${value.staleReasons.join("；")}`);
    const continuation =
      kind === "adopt"
        ? owner.continuationTarget(value.projectId, value.basis)
        : undefined;
    context.uow.execute((tx) => {
      const stored = read(tx, id)!;
      if (stored.stateVersion !== stateVersion || stored.status !== "pending")
        throw new RevisionError(412, "确认预览状态已变化。");
      const at = new Date().toISOString();
      if (kind === "adopt") {
        const source = owner.read(tx, value.sourceResult.id);
        if (
          !source ||
          source.version !== value.sourceResult.version ||
          source.projectId !== value.projectId ||
          owner.head(tx, value.projectId, value.episodeId, "episode-script") !==
            source.id ||
          owner.head(
            tx,
            value.projectId,
            value.episodeId,
            "episode-outline",
          ) !== value.outline.id
        )
          fail("正式剧本或大纲采用头已变化。");
        const { document, record } = actual(tx, source);
        if (
          !document ||
          !record ||
          document.id !== value.document.id ||
          document.version !== value.document.version ||
          record.version !== value.scriptRecordVersion ||
          record.parent_id !== source.episodeRecordId ||
          hash({
            blocks: JSON.parse(document.blocks_json),
            sceneLinks: value.content.sceneLinks,
          }) !== value.contentHash ||
          document.title !== value.title
        )
          fail("人工修订已变化；原预览保留，不能自动重绑。");
        const version = tx.get<{ next: number }>(
          "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM production_episode_results WHERE project_id = ? AND episode_key = ? AND operation = 'episode-script'",
          value.projectId,
          value.episodeId,
        )!.next;
        const result = EpisodeDevelopmentResultSchema.parse({
          id: crypto.randomUUID(),
          projectId: value.projectId,
          episodeId: value.episodeId,
          operation: "episode-script",
          version,
          origin: "human-script-revision",
          basis: value.basis,
          content: { kind: "episode-script", value: value.content },
          sourceSnapshotId: value.sourceSnapshotId,
          ...(source.sourceContextIntegrity
            ? { sourceContextIntegrity: source.sourceContextIntegrity }
            : {}),
          ...(source.sourceEvidence
            ? { sourceEvidence: source.sourceEvidence }
            : {}),
          runIds: [],
          scriptId: value.document.scriptId,
          episodeRecordId: source.episodeRecordId,
          scriptDocumentVersion: value.document.version,
          adoptedAt: at,
          scriptRevision: {
            previewId: value.id,
            sourceResult: value.sourceResult,
            document: value.document,
            scriptRecordVersion: value.scriptRecordVersion,
            contentHash: value.contentHash,
            humanReview: confirmation,
            semanticVerification: "human-declared-not-independently-verified",
          },
          isCurrent: true,
          sourceState: "current",
          staleReasons: [],
        });
        const {
          isCurrent: _current,
          sourceState: _state,
          staleReasons: _reasons,
          ...snapshot
        } = result;
        tx.run(
          "INSERT INTO production_episode_results(id,project_id,episode_key,operation,adoption_key,version,value_json,adopted_at,workflow_id) VALUES (?, ?, ?, 'episode-script', ?, ?, ?, ?, NULL)",
          result.id,
          value.projectId,
          value.episodeId,
          `human-script-revision:${value.id}`,
          version,
          JSON.stringify(snapshot),
          at,
        );
        tx.run(
          "UPDATE production_episode_result_heads SET result_id = ? WHERE project_id = ? AND episode_key = ? AND operation = 'episode-script'",
          result.id,
          value.projectId,
          value.episodeId,
        );
        stored.resultId = result.id;
        stored.confirmation = confirmation;
        tx.append({
          type: "production.episode-script-adopted.v1",
          pluginId: "production",
          aggregateType: "episode-result",
          aggregateId: result.id,
          aggregateVersion: version,
          payload: {
            id: result.id,
            projectId: value.projectId,
            episodeId: value.episodeId,
            operation: "episode-script",
            version,
            origin: "human-script-revision",
            revisionId: value.id,
            scriptId: value.document.scriptId,
          },
        });
        tx.append({
          type: "production.script-result-adopted.v1",
          pluginId: "production",
          aggregateType: "episode-result",
          aggregateId: result.id,
          aggregateVersion: version,
          payload: CreativeOutcomeFactSchema.parse({
            eventVersion: 1,
            kind: "adaptation.script-adopted",
            workflowPath: "adaptation",
            projectId: value.projectId,
            objectId: result.id,
            ...(continuation ? { continuationTarget: continuation } : {}),
            formalVersions: [
              { kind: "episode-script", id: result.id, version },
            ],
            sourceVersions: [
              value.sourceResult,
              { id: value.document.id, version: value.document.version },
            ],
            evidenceKind: "human",
            modelEvidence: "unknown",
            qualityState: "unverified",
            resultStatus: "adopted",
          }),
        });
      }
      stored.status = kind === "adopt" ? "adopted" : "discarded";
      stored.stateVersion++;
      stored.updatedAt = at;
      persist(tx, stored);
      remember(tx, key, digest, stored.id);
      event(tx, stored);
    });
    return get(id);
  };
  const query = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  type Http = {
    req: {
      param(name: string): string;
      query(name: string): string | undefined;
      header(name: string): string | undefined;
      json(): Promise<unknown>;
    };
    json(value: unknown): Response;
    header(name: string, value: string): void;
  };
  const add = (
    path: `/api/v2/${string}`,
    operationId: string,
    method: "get" | "post",
    schema: z.ZodType,
    handler: (c: Http, input: unknown) => unknown,
    body?: z.ZodType,
    paged = false,
  ) => {
    const route = defineRouteContribution({
      id: `production:${operationId}`,
      pluginId: "production",
      method,
      path,
      operationId,
      policy: {
        idempotency: method === "post" ? "required" : "forbidden",
        concurrency: method === "post" ? "if-match-required" : "optional",
        ...(method === "post" ? { idempotencyReplay: "handler" as const } : {}),
      },
      declaration: createRoute({
        method,
        path,
        operationId,
        tags: ["author-script-revisions"],
        request: {
          params: path.includes("{projectId}")
            ? z.object({ projectId: z.string().uuid() })
            : z.object({ id: z.string().uuid() }),
          ...(paged ? { query } : {}),
          ...(body
            ? { body: { content: { "application/json": { schema: body } } } }
            : {}),
        },
        responses: {
          200: {
            description: "Author-confirmed script revision",
            content: { "application/json": { schema } },
          },
          ...Object.fromEntries(
            [400, 404, 409, 412, 428, 503].map((status) => [
              status,
              {
                description: "Request cannot be completed",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            ]),
          ),
        },
      }),
      handler: async (c: Http) => {
        try {
          const input = body ? body.parse(await c.req.json()) : undefined;
          const result = handler(c, input);
          if (result && typeof result === "object" && "stateVersion" in result)
            c.header("ETag", `"${result.stateVersion}"`);
          return c.json(result);
        } catch (error) {
          const status =
            error instanceof RevisionError
              ? error.status
              : error instanceof z.ZodError || error instanceof SyntaxError
                ? 400
                : 409;
          const detail =
            error instanceof Error ? error.message : "人工剧本确认未完成。";
          return new Response(
            JSON.stringify({
              type: "https://dramaip.local/problems/episode-script-revision",
              title: detail,
              detail,
              status,
              code:
                status === 404
                  ? "NOT_FOUND"
                  : status === 400
                    ? "VALIDATION_ERROR"
                    : status === 428
                      ? "PRECONDITION_REQUIRED"
                      : status === 503
                        ? "SOURCE_UNAVAILABLE"
                        : "CONFLICT",
              traceId: crypto.randomUUID(),
            }),
            {
              status,
              headers: {
                "Content-Type": "application/problem+json",
                "Cache-Control": "no-store",
              },
            },
          );
        }
      },
    });
    context.effect(() => context.http.register(route), `route:${route.id}`);
  };
  const key = (c: Http, version: number) => {
    const value = c.req.header("Idempotency-Key")?.trim();
    if (!value || value.length > 200 || !c.req.header("If-Match")?.trim())
      throw new RevisionError(
        428,
        "人工确认写入须携带实际版本一致的 If-Match 与 Idempotency-Key。",
      );
    if (c.req.header("If-Match")?.trim() !== `"${version}"`)
      throw new RevisionError(412, "If-Match 与人工确认请求版本不一致。");
    return value;
  };
  const list = (c: Http) => {
    const projectId = c.req.param("projectId");
    const input = query.parse({
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    const values = context.uow.execute((tx) => {
      const cursor = input.cursor ? read(tx, input.cursor) : undefined;
      if (input.cursor && (!cursor || cursor.projectId !== projectId))
        throw new RevisionError(400, "人工确认游标不属于本项目。");
      return cursor
        ? tx.all<{ value_json: string }>(
            "SELECT value_json FROM production_episode_script_revisions WHERE project_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
            projectId,
            cursor.createdAt,
            cursor.createdAt,
            cursor.id,
            input.limit + 1,
          )
        : tx.all<{ value_json: string }>(
            "SELECT value_json FROM production_episode_script_revisions WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            projectId,
            input.limit + 1,
          );
    });
    const items = values
      .slice(0, input.limit)
      .map((row) => decode(JSON.parse(row.value_json) as Stored));
    return {
      items,
      ...(values.length > input.limit ? { nextCursor: items.at(-1)!.id } : {}),
    };
  };
  add(
    "/api/v2/projects/{projectId}/episode-script-revision-summaries",
    "episodeDevelopments.scriptRevisionSummaries",
    "get",
    EpisodeScriptRevisionSummaryPageSchema,
    (c) => {
      const page = list(c);
      return {
        ...page,
        items: page.items.map((value) =>
          EpisodeScriptRevisionSummarySchema.parse(value),
        ),
      };
    },
    undefined,
    true,
  );
  add(
    "/api/v2/episode-development/{id}/script-revision-previews",
    "episodeDevelopments.previewScriptRevision",
    "post",
    EpisodeScriptRevisionSchema,
    (c, raw) => {
      const input = EpisodeScriptRevisionInputSchema.parse(raw);
      return preview(c.req.param("id"), input, key(c, input.sourceVersion));
    },
    EpisodeScriptRevisionInputSchema,
  );
  add(
    "/api/v2/episode-script-revisions/{id}",
    "episodeDevelopments.getScriptRevision",
    "get",
    EpisodeScriptRevisionSchema,
    (c) => get(c.req.param("id")),
  );
  add(
    "/api/v2/projects/{projectId}/episode-script-revisions",
    "episodeDevelopments.listScriptRevisions",
    "get",
    EpisodeScriptRevisionPageSchema,
    (c) => list(c),
    undefined,
    true,
  );
  add(
    "/api/v2/episode-script-revisions/{id}/adopt",
    "episodeDevelopments.adoptScriptRevision",
    "post",
    EpisodeScriptRevisionSchema,
    (c, raw) => {
      const input = z
        .object({
          stateVersion: z.number().int().nonnegative(),
          confirmation: EpisodeScriptRevisionConfirmationSchema,
        })
        .strict()
        .parse(raw);
      return action(
        c.req.param("id"),
        input.stateVersion,
        key(c, input.stateVersion),
        "adopt",
        input.confirmation,
      );
    },
    z
      .object({
        stateVersion: z.number().int().nonnegative(),
        confirmation: EpisodeScriptRevisionConfirmationSchema,
      })
      .strict(),
  );
  add(
    "/api/v2/episode-script-revisions/{id}/discard",
    "episodeDevelopments.discardScriptRevision",
    "post",
    EpisodeScriptRevisionSchema,
    (c, raw) => {
      const input = z
        .object({ stateVersion: z.number().int().nonnegative() })
        .strict()
        .parse(raw);
      return action(
        c.req.param("id"),
        input.stateVersion,
        key(c, input.stateVersion),
        "discard",
      );
    },
    z.object({ stateVersion: z.number().int().nonnegative() }).strict(),
  );
}
