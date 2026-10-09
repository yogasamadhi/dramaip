import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import { AGENT_CONTEXT_SERVICE } from "@dramaip/contracts/agent-context";
import { CreativeOutcomeFactSchema } from "@dramaip/contracts/insights";
import { creationReference } from "@dramaip/contracts/creation";
import {
  EpisodeDevelopmentResultSchema,
  EpisodeTopologyRevisionInputSchema,
  EpisodeTopologyRevisionConfirmationSchema,
  EpisodeTopologyRevisionSchema,
  EpisodeTopologyRevisionPageSchema,
  EpisodeTopologyRevisionSummarySchema,
  EpisodeTopologyRevisionSummaryPageSchema,
  type EpisodeDevelopmentResult,
  type EpisodeTopologyRevision,
  type EpisodeTopologyRevisionInput,
  type EpisodeTopologyRevisionConfirmation,
} from "@dramaip/contracts/production";
import {
  defineRouteContribution,
  optionalService,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { inspectEpisodeOutlineContent } from "./episode-outline-content.js";
import { inspectEpisodeScriptContent } from "./episode-script-content.js";
import { inspectSceneSourceEvidence } from "./scene-source-evidence.js";
import { exportFountain } from "./screenplay-codec.js";

export const episodeTopologyRevisionMigration: PluginMigration = {
  id: "production.0015.author-topology-revisions",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0014.project-purge-requests"],
  sql: `CREATE TABLE production_episode_topology_revisions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_script_id TEXT NOT NULL REFERENCES production_episode_results(id),
    source_outline_id TEXT NOT NULL REFERENCES production_episode_results(id),
    value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX production_episode_topology_revision_page ON production_episode_topology_revisions(project_id, created_at DESC, id DESC);
  CREATE TABLE production_episode_topology_revision_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    revision_id TEXT NOT NULL REFERENCES production_episode_topology_revisions(id) ON DELETE CASCADE
  );`,
};
type StoredResult = Omit<
  EpisodeDevelopmentResult,
  "isCurrent" | "sourceState" | "staleReasons"
>;
type Stored = Omit<EpisodeTopologyRevision, "sourceState" | "staleReasons">;
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
  resultReference(value: StoredResult): ReturnType<typeof creationReference>;
  frozenRef(
    value: ReturnType<typeof creationReference>,
  ): StoredResult["basis"]["references"][number];
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
const fail = (message: string): never => {
  throw new RevisionError(409, message);
};
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
const scriptRecordHash = (record: ScriptRow) =>
  hash({
    id: record.id,
    version: record.version,
    parentId: record.parent_id,
    payload: JSON.parse(record.payload_json),
  });

export function topologyResultReasons(
  tx: UnitOfWorkTransaction,
  value: StoredResult,
): string[] {
  if (value.origin !== "human-topology-revision") return [];
  const receipt = value.topologyRevision;
  if (!receipt) return ["双正式人工确认回执未核全。"];
  const results = [receipt.results.outline, receipt.results.script].map(
    (ref) => {
      const row = tx.get<{ value_json: string }>(
        "SELECT value_json FROM production_episode_results WHERE id = ?",
        ref.id,
      );
      return row ? (JSON.parse(row.value_json) as StoredResult) : undefined;
    },
  );
  if (
    results.some(
      (result, index) =>
        !result ||
        result.projectId !== value.projectId ||
        result.episodeId !== value.episodeId ||
        result.id !==
          [receipt.results.outline, receipt.results.script][index]!.id ||
        result.version !==
          [receipt.results.outline, receipt.results.script][index]!.version ||
        result.operation !==
          (index === 0 ? "episode-outline" : "episode-script") ||
        result.origin !== "human-topology-revision" ||
        hash(result.topologyRevision) !== hash(receipt) ||
        hash(result.content.value) !==
          (index === 0
            ? receipt.outlineContentHash
            : receipt.scriptContentHash) ||
        result.sourceSnapshotId !==
          (index === 0
            ? receipt.inheritedSnapshots.outline
            : receipt.inheritedSnapshots.script),
    )
  )
    return ["双正式原始快照、配对身份、哈希或来源回执不一致。"];
  if (value.operation === "episode-script") {
    const row = tx.get<ScriptRow>(
      "SELECT id, version, parent_id, payload_json FROM production_records WHERE id = ? AND project_id = ? AND kind = 'scripts' AND retired_at IS NULL",
      value.scriptId,
      value.projectId,
    );
    if (!row || scriptRecordHash(row) !== receipt.scriptRecordHash)
      return ["人工拓扑确认实际剧本记录已修改，保留原确认快照。"];
  }
  return [];
}

/** Production-owned immutable author preview. It creates no model/workflow/run,
 * changes no actual screenplay/scene/shot/media and never rewrites old results. */
export function registerEpisodeTopologyRevisions(
  context: PluginContext,
  owner: Owner,
) {
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<{ value_json: string }>(
      "SELECT value_json FROM production_episode_topology_revisions WHERE id = ?",
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
  const sourcePair = (
    tx: UnitOfWorkTransaction,
    value: Pick<
      Stored,
      "sourceScript" | "sourceOutline" | "projectId" | "episodeId"
    >,
  ) => {
    const script = owner.read(tx, value.sourceScript.id),
      outline = owner.read(tx, value.sourceOutline.id);
    if (
      !script ||
      !outline ||
      script.operation !== "episode-script" ||
      outline.operation !== "episode-outline" ||
      script.version !== value.sourceScript.version ||
      outline.version !== value.sourceOutline.version ||
      script.projectId !== value.projectId ||
      outline.projectId !== value.projectId ||
      script.episodeId !== value.episodeId ||
      outline.episodeId !== value.episodeId ||
      script.basis.request.outline?.id !== outline.id ||
      script.basis.request.outline.version !== outline.version ||
      !script.scriptId ||
      !script.episodeRecordId
    )
      fail("原正式大纲／剧本的实际身份、版本或同项目同集绑定未核全。");
    return { script: script!, outline: outline! };
  };
  const inputReasons = (script: StoredResult, pairedAdoption = false) => {
    const status = owner.revisionSourceStatus(script);
    if (status === 503)
      throw new RevisionError(
        503,
        "原人工来源祖先或冻结上下文暂不可核对，不使用缓存或替代稿件。",
      );
    const result = owner
      .sourceReasons(script)
      .filter(
        (reason) =>
          reason !== "标准剧本已人工修改或不存在，保留原采用快照" &&
          reason !== "人工确认剧本记录已修改或不存在，保留原确认快照" &&
          reason !== "人工拓扑确认实际剧本记录已修改，保留原确认快照。" &&
          reason !== "来源确认实际脚本字段已变化或不可核对，保留原正式快照" &&
          !(pairedAdoption && reason === "当前采用单集大纲已变化"),
      );
    if (status === 409)
      result.push(
        "原人工来源祖先、采用回执或当前禁止链未核全，不仅凭新拓扑确认。",
      );
    return result;
  };
  const checkHeadsAndActual = (
    tx: UnitOfWorkTransaction,
    value: Stored,
    script: StoredResult,
  ) => {
    if (
      owner.head(tx, value.projectId, value.episodeId, "episode-script") !==
        (value.results?.script.id ?? value.sourceScript.id) ||
      owner.head(tx, value.projectId, value.episodeId, "episode-outline") !==
        (value.results?.outline.id ?? value.sourceOutline.id)
    )
      fail("当前正式大纲或剧本采用头已变化，不重绑原预览。");
    const { document, record } = actual(tx, script);
    if (
      !document ||
      !record ||
      document.id !== value.document.id ||
      document.script_record_id !== value.document.scriptId ||
      document.version !== value.document.version ||
      record.id !== value.document.scriptId ||
      record.version !== value.scriptRecordVersion ||
      scriptRecordHash(record) !== value.scriptRecordHash ||
      record.parent_id !== script.episodeRecordId ||
      document.title !== value.title ||
      hash({
        blocks: JSON.parse(document.blocks_json),
        sceneLinks: value.scriptContent.sceneLinks,
      }) !== value.scriptContentHash ||
      exportFountain(value.scriptContent.blocks).trim() !==
        String(
          (JSON.parse(record.payload_json) as Record<string, unknown>)[
            "剧本内容"
          ] ?? "",
        ).trim() ||
      hash(value.outlineContent) !== value.outlineContentHash ||
      hash(value.scriptContent) !== value.scriptContentHash
    )
      fail("实际正文、文档、记录、映射或冻结内容已变化，保留原预览。");
  };
  const reasons = (value: Stored): string[] => {
    let pair: ReturnType<typeof sourcePair>;
    try {
      pair = context.uow.execute((tx) => sourcePair(tx, value));
    } catch {
      return ["原正式大纲／剧本身份、版本或绑定不可用。"];
    }
    const result = [
      ...owner.sourceReasons(pair.outline),
      ...inputReasons(pair.script, value.status === "adopted"),
    ];
    if (
      hash(pair.outline.basis) !== hash(value.outlineBasis) ||
      hash(pair.script.basis) !== hash(value.scriptBasis) ||
      pair.outline.sourceSnapshotId !== value.inheritedSnapshots.outline ||
      pair.script.sourceSnapshotId !== value.inheritedSnapshots.script
    )
      result.push("原冻结基准或实际来源快照身份不一致。");
    try {
      context.uow.execute((tx) => checkHeadsAndActual(tx, value, pair.script));
    } catch {
      result.push("实际文档、记录、冻结内容或正式采用头已变化，保留原预览。");
    }
    return [...new Set(result)];
  };
  const decode = (value: Stored) => {
    const staleReasons = reasons(value);
    return EpisodeTopologyRevisionSchema.parse({
      ...value,
      sourceState: staleReasons.length ? "stale" : "current",
      staleReasons,
    });
  };
  const get = (id: string) => {
    const value = context.uow.execute((tx) => read(tx, id));
    if (!value) throw new RevisionError(404, "作者场景拓扑确认预览不存在。");
    return decode(value);
  };
  const receipt = (key: string, digest: string) =>
    context.uow.execute((tx) => {
      const row = tx.get<{ request_hash: string; revision_id: string }>(
        "SELECT request_hash, revision_id FROM production_episode_topology_revision_requests WHERE request_key = ?",
        key,
      );
      if (row && row.request_hash !== digest)
        fail("同一请求键已绑定另一确认，不换源或覆盖。");
      return row?.revision_id;
    });
  const remember = (
    tx: UnitOfWorkTransaction,
    key: string,
    digest: string,
    id: string,
  ) =>
    tx.run(
      "INSERT INTO production_episode_topology_revision_requests VALUES (?, ?, ?)",
      key,
      digest,
      id,
    );
  const event = (tx: UnitOfWorkTransaction, value: Stored) => {
    const envelope = {
      pluginId: "production",
      aggregateType: "episode-topology-revision",
      aggregateId: value.id,
      aggregateVersion: value.stateVersion,
      payload: {
        id: value.id,
        projectId: value.projectId,
        episodeId: value.episodeId,
        sourceScript: value.sourceScript,
        sourceOutline: value.sourceOutline,
        document: value.document,
        status: value.status,
        ...(value.results ? { results: value.results } : {}),
      },
    };
    if (value.status === "pending")
      tx.append({
        ...envelope,
        type: "production.episode-topology-revision-previewed.v1",
      });
    else if (value.status === "adopted")
      tx.append({
        ...envelope,
        type: "production.episode-topology-revision-adopted.v1",
      });
    else
      tx.append({
        ...envelope,
        type: "production.episode-topology-revision-discarded.v1",
      });
  };
  const preview = (
    id: string,
    input: EpisodeTopologyRevisionInput,
    key: string,
  ) => {
    const digest = hash({ id, action: "preview", input }),
      replay = receipt(key, digest);
    if (replay) return get(replay);
    const source = context.uow.execute((tx) => owner.read(tx, id));
    if (!source) throw new RevisionError(404, "原正式剧本不存在。");
    if (source.version !== input.sourceVersion)
      throw new RevisionError(412, "原正式剧本版本不一致。");
    const pair = context.uow.execute((tx) =>
      sourcePair(tx, {
        sourceScript: { id, version: input.sourceVersion },
        sourceOutline: input.outline,
        projectId: source.projectId,
        episodeId: source.episodeId,
      }),
    );
    const blocked = [
      ...owner.sourceReasons(pair.outline),
      ...inputReasons(pair.script),
    ];
    if (blocked.length)
      fail("原故事来源、作者意图、设定或正式大纲已变化，须另行确认来源。");
    let outlineContent: EpisodeTopologyRevisionInput["outlineContent"],
      sourceEvidence: Stored["sourceEvidence"];
    try {
      outlineContent = inspectEpisodeOutlineContent(
        input.outlineContent,
        pair.outline.basis,
      );
      const snapshot = optionalService(
        context,
        AGENT_CONTEXT_SERVICE,
      )?.getSnapshot(pair.outline.sourceSnapshotId);
      if (!snapshot || snapshot.projectId !== source.projectId)
        fail("原实际来源快照不可用，不补新快照。");
      sourceEvidence = inspectSceneSourceEvidence(
        outlineContent,
        pair.outline.basis,
        snapshot!.entries,
        "human-declared",
      );
    } catch (error) {
      if (error instanceof RevisionError) throw error;
      fail("作者新完整大纲未满足原时长、身份、场景或实际来源表达约束。");
    }
    const saved = context.uow.execute((tx) => {
      if (
        owner.head(tx, source.projectId, source.episodeId, "episode-script") !==
          source.id ||
        owner.head(
          tx,
          source.projectId,
          source.episodeId,
          "episode-outline",
        ) !== pair.outline.id
      )
        fail("仅当前同集的正式大纲／剧本可建立双正式预览。");
      const { document, record } = actual(tx, source);
      if (!document || !record || record.parent_id !== source.episodeRecordId)
        fail("实际文档、剧本记录或分集绑定不存在。");
      if (document!.version !== input.documentVersion)
        throw new RevisionError(412, "实际剧本文档版本已变化。");
      if (document!.version === source.scriptDocumentVersion)
        fail("实际文档没有新人工修订，不创建重复双正式版本。");
      let scriptContent: Stored["scriptContent"];
      try {
        scriptContent = inspectEpisodeScriptContent(
          {
            blocks: JSON.parse(document!.blocks_json),
            sceneLinks: input.sceneLinks,
          },
          outlineContent!,
          String(
            (JSON.parse(record!.payload_json) as Record<string, unknown>)[
              "剧本内容"
            ] ?? "",
          ),
        );
      } catch {
        fail("新大纲与实际正文的完整连续场景映射或 Fountain 不一致。");
      }
      const at = new Date().toISOString();
      const value: Stored = {
        id: crypto.randomUUID(),
        projectId: source.projectId,
        episodeId: source.episodeId,
        sourceScript: { id: source.id, version: source.version },
        sourceOutline: input.outline,
        document: {
          id: document!.id,
          scriptId: source.scriptId!,
          version: document!.version,
        },
        scriptRecordVersion: record!.version,
        scriptRecordHash: scriptRecordHash(record!),
        title: document!.title,
        outlineContent: outlineContent!,
        scriptContent: scriptContent!,
        outlineContentHash: hash(outlineContent!),
        scriptContentHash: hash(scriptContent!),
        outlineBasis: pair.outline.basis,
        scriptBasis: source.basis,
        inheritedSnapshots: {
          outline: pair.outline.sourceSnapshotId,
          script: source.sourceSnapshotId,
        },
        ...(sourceEvidence ? { sourceEvidence } : {}),
        status: "pending",
        stateVersion: 0,
        createdAt: at,
        updatedAt: at,
      };
      tx.run(
        "INSERT INTO production_episode_topology_revisions VALUES (?, ?, ?, ?, ?, ?, ?)",
        value.id,
        value.projectId,
        source.id,
        pair.outline.id,
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
    confirmation?: EpisodeTopologyRevisionConfirmation,
  ) => {
    const digest = hash({ id, stateVersion, kind, confirmation }),
      replay = receipt(key, digest);
    if (replay) return get(replay);
    const value = get(id);
    if (value.stateVersion !== stateVersion)
      throw new RevisionError(412, "确认预览状态已变化。");
    if (value.status !== "pending")
      fail("预览已处理；新请求不能重复采用或撤回。");
    if (kind === "adopt" && value.sourceState !== "current")
      fail("实际正文或正式来源已变化；不自动换源。");
    const continuation =
      kind === "adopt"
        ? owner.continuationTarget(value.projectId, value.scriptBasis)
        : undefined;
    context.uow.execute((tx) => {
      const stored = read(tx, id);
      if (
        !stored ||
        stored.stateVersion !== stateVersion ||
        stored.status !== "pending"
      )
        throw new RevisionError(412, "确认预览状态已变化。");
      const at = new Date().toISOString();
      if (kind === "adopt") {
        const pair = sourcePair(tx, stored);
        checkHeadsAndActual(tx, stored, pair.script);
        const next = (operation: "episode-outline" | "episode-script") => ({
          id: crypto.randomUUID(),
          version: tx.get<{ next: number }>(
            "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM production_episode_results WHERE project_id = ? AND episode_key = ? AND operation = ?",
            value.projectId,
            value.episodeId,
            operation,
          )!.next,
        });
        const results = {
          outline: next("episode-outline"),
          script: next("episode-script"),
        };
        const topologyRevision = {
          previewId: id,
          sourceScript: value.sourceScript,
          sourceOutline: value.sourceOutline,
          document: value.document,
          scriptRecordVersion: value.scriptRecordVersion,
          scriptRecordHash: value.scriptRecordHash,
          outlineContentHash: value.outlineContentHash,
          scriptContentHash: value.scriptContentHash,
          inheritedSnapshots: value.inheritedSnapshots,
          results,
          humanReview: confirmation!,
          semanticVerification:
            "human-declared-not-independently-verified" as const,
        };
        const common = {
          projectId: value.projectId,
          episodeId: value.episodeId,
          origin: "human-topology-revision" as const,
          topologyRevision,
          runIds: [],
          ...(value.sourceEvidence
            ? { sourceEvidence: value.sourceEvidence }
            : {}),
          adoptedAt: at,
          isCurrent: true,
          sourceState: "current" as const,
          staleReasons: [],
        };
        const outline = EpisodeDevelopmentResultSchema.parse({
          ...common,
          ...results.outline,
          operation: "episode-outline",
          basis: value.outlineBasis,
          content: { kind: "episode-outline", value: value.outlineContent },
          sourceSnapshotId: value.inheritedSnapshots.outline,
          ...(pair.outline.sourceContextIntegrity
            ? { sourceContextIntegrity: pair.outline.sourceContextIntegrity }
            : {}),
        });
        const scriptBasis = structuredClone(value.scriptBasis);
        scriptBasis.request.outline = results.outline;
        scriptBasis.references = scriptBasis.references.filter(
          (ref) =>
            !(
              ref.sourceKind === "production" &&
              ref.sourceId === value.sourceOutline.id
            ),
        );
        scriptBasis.references.push(
          owner.frozenRef(owner.resultReference(outline)),
        );
        const script = EpisodeDevelopmentResultSchema.parse({
          ...common,
          ...results.script,
          operation: "episode-script",
          basis: scriptBasis,
          content: { kind: "episode-script", value: value.scriptContent },
          sourceSnapshotId: value.inheritedSnapshots.script,
          ...(pair.script.sourceContextIntegrity
            ? { sourceContextIntegrity: pair.script.sourceContextIntegrity }
            : {}),
          scriptId: value.document.scriptId,
          episodeRecordId: pair.script.episodeRecordId,
          scriptDocumentVersion: value.document.version,
        });
        for (const result of [outline, script]) {
          const {
            isCurrent: _current,
            sourceState: _state,
            staleReasons: _reasons,
            ...snapshot
          } = result;
          tx.run(
            "INSERT INTO production_episode_results(id,project_id,episode_key,operation,adoption_key,version,value_json,adopted_at,workflow_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
            result.id,
            value.projectId,
            value.episodeId,
            result.operation,
            `human-topology-revision:${id}:${result.operation}`,
            result.version,
            JSON.stringify(snapshot),
            at,
          );
          tx.run(
            "UPDATE production_episode_result_heads SET result_id = ? WHERE project_id = ? AND episode_key = ? AND operation = ? AND result_id = ?",
            result.id,
            value.projectId,
            value.episodeId,
            result.operation,
            result.operation === "episode-outline"
              ? value.sourceOutline.id
              : value.sourceScript.id,
          );
          if (
            tx.get<{ count: number }>("SELECT changes() AS count")!.count !== 1
          )
            fail("双正式采用头 CAS 不一致，回滚全部确认。");
        }
        const envelope = {
          pluginId: "production",
          aggregateType: "episode-result",
          payload: {
            projectId: value.projectId,
            episodeId: value.episodeId,
            origin: "human-topology-revision",
            revisionId: id,
          },
        };
        tx.append({
          ...envelope,
          type: "production.episode-outline-adopted.v1",
          aggregateId: outline.id,
          aggregateVersion: outline.version,
          payload: {
            ...envelope.payload,
            id: outline.id,
            operation: outline.operation,
            version: outline.version,
          },
        });
        tx.append({
          ...envelope,
          type: "production.episode-script-adopted.v1",
          aggregateId: script.id,
          aggregateVersion: script.version,
          payload: {
            ...envelope.payload,
            id: script.id,
            operation: script.operation,
            version: script.version,
            scriptId: value.document.scriptId,
          },
        });
        tx.append({
          type: "production.script-result-adopted.v1",
          pluginId: "production",
          aggregateType: "episode-result",
          aggregateId: script.id,
          aggregateVersion: script.version,
          payload: CreativeOutcomeFactSchema.parse({
            eventVersion: 1,
            kind: "adaptation.script-adopted",
            workflowPath: "adaptation",
            projectId: value.projectId,
            objectId: script.id,
            ...(continuation ? { continuationTarget: continuation } : {}),
            formalVersions: [{ kind: "episode-script", ...results.script }],
            sourceVersions: [
              value.sourceOutline,
              value.sourceScript,
              { id: value.document.id, version: value.document.version },
            ],
            evidenceKind: "human",
            modelEvidence: "unknown",
            qualityState: "unverified",
            resultStatus: "adopted",
          }),
        });
        stored.results = results;
        stored.confirmation = confirmation;
      }
      stored.status = kind === "adopt" ? "adopted" : "discarded";
      stored.stateVersion++;
      stored.updatedAt = at;
      tx.run(
        "UPDATE production_episode_topology_revisions SET value_json = ?, updated_at = ? WHERE id = ?",
        JSON.stringify(stored),
        at,
        id,
      );
      remember(tx, key, digest, id);
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
  const key = (c: Http, version: number) => {
    const value = c.req.header("Idempotency-Key")?.trim();
    if (!value || value.length > 200 || !c.req.header("If-Match")?.trim())
      throw new RevisionError(
        428,
        "双正式确认须携带实际 If-Match 与 Idempotency-Key。",
      );
    if (c.req.header("If-Match")?.trim() !== `"${version}"`)
      throw new RevisionError(412, "If-Match 与请求版本不一致。");
    return value;
  };
  const list = (c: Http) => {
    const projectId = c.req.param("projectId");
    const parsed = query.safeParse({
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success)
      throw new RevisionError(400, "确认分页游标或条数不合法。");
    const input = parsed.data;
    const values = context.uow.execute((tx) => {
      const cursor = input.cursor ? read(tx, input.cursor) : undefined;
      if (input.cursor && (!cursor || cursor.projectId !== projectId))
        throw new RevisionError(400, "确认游标不属于本项目。");
      return cursor
        ? tx.all<{ value_json: string }>(
            "SELECT value_json FROM production_episode_topology_revisions WHERE project_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
            projectId,
            cursor.createdAt,
            cursor.createdAt,
            cursor.id,
            input.limit + 1,
          )
        : tx.all<{ value_json: string }>(
            "SELECT value_json FROM production_episode_topology_revisions WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
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
        tags: ["author-topology-revisions"],
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
            description: "Author-confirmed outline/script topology revision",
            content: { "application/json": { schema } },
          },
          ...Object.fromEntries(
            [400, 404, 409, 412, 428, 500, 503].map((status) => [
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
          let input: unknown;
          if (body) {
            try {
              input = body.parse(await c.req.json());
            } catch {
              throw new RevisionError(400, "双正式确认请求结构不合法。");
            }
          }
          const result = handler(c, input);
          if (result && typeof result === "object" && "stateVersion" in result)
            c.header("ETag", `"${result.stateVersion}"`);
          return c.json(result);
        } catch (error) {
          const status = error instanceof RevisionError ? error.status : 500;
          const detail =
            error instanceof RevisionError
              ? error.message
              : status === 400
                ? "双正式确认请求结构不合法。"
                : "双正式确认未提交；请保留原预览重试。";
          return new Response(
            JSON.stringify({
              type: "https://dramaip.local/problems/episode-topology-revision",
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
                      : status === 500
                        ? "INTERNAL_ERROR"
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
  const adoptBody = z
    .object({
      stateVersion: z.number().int().nonnegative(),
      confirmation: EpisodeTopologyRevisionConfirmationSchema,
    })
    .strict();
  const discardBody = z
    .object({ stateVersion: z.number().int().nonnegative() })
    .strict();
  add(
    "/api/v2/episode-development/{id}/topology-revision-previews",
    "episodeDevelopments.previewTopologyRevision",
    "post",
    EpisodeTopologyRevisionSchema,
    (c, raw) => {
      const input = EpisodeTopologyRevisionInputSchema.parse(raw);
      return preview(c.req.param("id"), input, key(c, input.sourceVersion));
    },
    EpisodeTopologyRevisionInputSchema,
  );
  add(
    "/api/v2/episode-topology-revisions/{id}",
    "episodeDevelopments.getTopologyRevision",
    "get",
    EpisodeTopologyRevisionSchema,
    (c) => get(c.req.param("id")),
  );
  add(
    "/api/v2/projects/{projectId}/episode-topology-revisions",
    "episodeDevelopments.listTopologyRevisions",
    "get",
    EpisodeTopologyRevisionPageSchema,
    (c) => list(c),
    undefined,
    true,
  );
  add(
    "/api/v2/projects/{projectId}/episode-topology-revision-summaries",
    "episodeDevelopments.topologyRevisionSummaries",
    "get",
    EpisodeTopologyRevisionSummaryPageSchema,
    (c) => {
      const page = list(c);
      return {
        ...page,
        items: page.items.map((value) =>
          EpisodeTopologyRevisionSummarySchema.parse(
            Object.fromEntries(
              Object.keys(EpisodeTopologyRevisionSummarySchema.shape).map(
                (key) => [key, value[key as keyof typeof value]],
              ),
            ),
          ),
        ),
      };
    },
    undefined,
    true,
  );
  add(
    "/api/v2/episode-topology-revisions/{id}/adopt",
    "episodeDevelopments.adoptTopologyRevision",
    "post",
    EpisodeTopologyRevisionSchema,
    (c, raw) => {
      const input = adoptBody.parse(raw);
      return action(
        c.req.param("id"),
        input.stateVersion,
        key(c, input.stateVersion),
        "adopt",
        input.confirmation,
      );
    },
    adoptBody,
  );
  add(
    "/api/v2/episode-topology-revisions/{id}/discard",
    "episodeDevelopments.discardTopologyRevision",
    "post",
    EpisodeTopologyRevisionSchema,
    (c, raw) => {
      const input = discardBody.parse(raw);
      return action(
        c.req.param("id"),
        input.stateVersion,
        key(c, input.stateVersion),
        "discard",
      );
    },
    discardBody,
  );
}
