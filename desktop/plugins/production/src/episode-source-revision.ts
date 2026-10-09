import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  AGENT_CONTEXT_SERVICE,
  type AgentContextReference,
  type AgentContextSnapshot,
} from "@dramaip/contracts/agent-context";
import { CreativeOutcomeFactSchema } from "@dramaip/contracts/insights";
import {
  EpisodeDevelopmentBasisSchema,
  EpisodeDevelopmentResultSchema,
  EpisodeSourceRevisionInputSchema,
  EpisodeSourceRevisionSchema,
  EpisodeSourceRevisionContextSchema,
  EpisodeSourceRevisionPageSchema,
  EpisodeSourceRevisionSummarySchema,
  EpisodeSourceRevisionSummaryPageSchema,
  EpisodeSourceRevisionConfirmationSchema,
  type EpisodeDevelopmentResult,
  type EpisodeDevelopmentRequest,
  type EpisodeDevelopmentBasis,
  type EpisodeSourceRevision,
  type EpisodeSourceRevisionInput,
  type EpisodeSourceRevisionConfirmation,
  type EpisodeScriptRevision,
  type EpisodeTopologyRevision,
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
import {
  inspectEpisodeFormalAncestry,
  episodeAncestryPolicyDependencies,
  EpisodeFormalAncestryError,
} from "./episode-formal-ancestry.js";

export const episodeSourceRevisionMigration: PluginMigration = {
  id: "production.0018.author-source-revisions",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0017.exact-shot-attributions"],
  sql: `CREATE TABLE production_episode_source_revisions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_script_id TEXT NOT NULL REFERENCES production_episode_results(id),
    source_outline_id TEXT NOT NULL REFERENCES production_episode_results(id),
    value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX production_episode_source_revision_page ON production_episode_source_revisions(project_id,created_at DESC,id DESC);
  CREATE TABLE production_episode_source_revision_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
    revision_id TEXT NOT NULL REFERENCES production_episode_source_revisions(id) ON DELETE CASCADE
  );`,
};
type Result = Omit<
  EpisodeDevelopmentResult,
  "isCurrent" | "sourceState" | "staleReasons"
>;
type Stored = Omit<EpisodeSourceRevision, "sourceState" | "staleReasons">;
type Owner = {
  read(tx: UnitOfWorkTransaction, id: string): Result | undefined;
  head(
    tx: UnitOfWorkTransaction,
    projectId: string,
    episodeId: string,
    operation: EpisodeDevelopmentResult["operation"],
  ): string | undefined;
  freshSources(
    projectId: string,
    request: EpisodeDevelopmentRequest,
  ): { basis: EpisodeDevelopmentBasis; references: AgentContextReference[] };
  resultReference(value: Result): AgentContextReference;
  frozenRef(
    value: AgentContextReference,
  ): EpisodeDevelopmentBasis["references"][number];
  continuationTarget(
    projectId: string,
    basis: EpisodeDevelopmentBasis,
  ): { targetKey: string; position: number } | undefined;
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
class SourceRevisionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(message: string): never {
  throw new SourceRevisionError(409, message);
}
type ActualDocument = {
  id: string;
  script_record_id: string;
  version: number;
  title: string;
  blocks_json: string;
};
type ActualScript = {
  id: string;
  version: number;
  parent_id: string | null;
  title: string;
  payload_json: string;
};
const sourceProjection = (basis: EpisodeDevelopmentBasis) => ({
  references: basis.references,
  authorIntent: basis.authorIntent,
  diagnosis: basis.diagnosis,
  strategy: basis.strategy,
  episode: basis.episode,
  chapters: basis.chapters,
  sourceBasis: basis.sourceBasis,
  contextChapters: basis.contextChapters,
});

export function registerEpisodeSourceRevisions(
  context: PluginContext,
  owner: Owner,
) {
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<{ value_json: string }>(
      "SELECT value_json FROM production_episode_source_revisions WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const pair = (
    tx: UnitOfWorkTransaction,
    scriptId: string,
    version: number,
    outlineRef: { id: string; version: number },
  ) => {
    const script = owner.read(tx, scriptId),
      outline = owner.read(tx, outlineRef.id);
    if (!script || !outline)
      throw new SourceRevisionError(404, "原正式大纲或剧本不存在。");
    if (script.version !== version || outline.version !== outlineRef.version)
      throw new SourceRevisionError(412, "原正式版本已变化。");
    if (
      script.operation !== "episode-script" ||
      script.content.kind !== "episode-script" ||
      outline.operation !== "episode-outline" ||
      outline.content.kind !== "episode-outline" ||
      script.projectId !== outline.projectId ||
      script.episodeId !== outline.episodeId ||
      !script.scriptId ||
      !script.episodeRecordId ||
      script.basis.request.outline?.id !== outline.id ||
      script.basis.request.outline.version !== outline.version
    )
      fail("原正式大纲／剧本的同项目、同分集与实际绑定不完整。");
    return { script, outline };
  };
  const actual = (tx: UnitOfWorkTransaction, script: Result) => {
    const document = tx.get<ActualDocument>(
      "SELECT id,script_record_id,version,title,blocks_json FROM screenplay_documents WHERE script_record_id=? AND project_id=?",
      script.scriptId!,
      script.projectId,
    );
    const record = tx.get<ActualScript>(
      "SELECT id,version,parent_id,title,payload_json FROM production_records WHERE id=? AND project_id=? AND kind='scripts' AND retired_at IS NULL",
      script.scriptId!,
      script.projectId,
    );
    if (!document || !record || record.parent_id !== script.episodeRecordId)
      fail("实际保存文档或脚本／分集绑定不存在，不重建或换稿。");
    return { document, record };
  };
  const fresh = (projectId: string, request: EpisodeDevelopmentRequest) => {
    try {
      return owner.freshSources(projectId, request);
    } catch {
      fail("明确的新正式来源、完整范围或版本不可核对，不取最新或回退旧来源。");
    }
  };
  const protectReferences = (
    references: AgentContextReference[],
    originals: { outline: Result; script: Result },
  ) => {
    const capture = () =>
      context.uow.execute((tx) => {
        const raw = <T>(table: string, id: string): T | undefined => {
          // Only these three Production-owned tables are supplied below.
          const row = tx.get<{ value_json: string }>(
            `SELECT value_json FROM ${table} WHERE id = ?`,
            id,
          );
          return row ? (JSON.parse(row.value_json) as T) : undefined;
        };
        const ancestry = inspectEpisodeFormalAncestry({
          ...originals,
          read: (id) => owner.read(tx, id),
          readScriptRevision: (id) =>
            raw<Omit<EpisodeScriptRevision, "sourceState" | "staleReasons">>(
              "production_episode_script_revisions",
              id,
            ),
          readTopologyRevision: (id) =>
            raw<Omit<EpisodeTopologyRevision, "sourceState" | "staleReasons">>(
              "production_episode_topology_revisions",
              id,
            ),
          readSourceRevision: (id) => read(tx, id),
          formalReference: (value) =>
            owner.frozenRef(owner.resultReference(value)),
        });
        const ancestorRecords = [
          ...new Set(ancestry.branches.map((branch) => branch.scriptId)),
        ].map((id) => {
          const row = tx.get<{ id: string; version: number }>(
            "SELECT id,version FROM production_records WHERE id=? AND project_id=? AND kind='scripts'",
            id,
            originals.script.projectId,
          );
          if (!row)
            fail("原正式祖先的实际剧本记录不可核对，不省略其禁止依赖。");
          return {
            sourceId: row.id,
            sourceVersion: row.version,
            fieldPath: `/production/${row.id}`,
          };
        });
        return {
          saved: actual(tx, originals.script),
          ancestry,
          ancestorRecords,
        };
      });
    let captured;
    try {
      captured = capture();
    } catch (error) {
      if (error instanceof EpisodeFormalAncestryError)
        fail("完整原正式祖先或采用回执不可核对，不推定来源链。");
      throw error;
    }
    const { saved, ancestry, ancestorRecords } = captured;
    if (ancestry.documentId && ancestry.documentId !== saved.document.id)
      fail("实际保存文档不是原人工确认链的同一稿件，不换稿或推定祖先。");
    const service = optionalService(context, AGENT_CONTEXT_SERVICE);
    if (!service)
      throw new SourceRevisionError(
        503,
        "完整原正式快照的禁止链读取暂不可用，不裁剪依赖。",
      );
    // Peer reads are outside the Production transaction. The ancestry helper
    // returns body-free metadata and checks every distinct actual snapshot.
    let ancestorDependencies;
    try {
      ancestorDependencies = episodeAncestryPolicyDependencies(ancestry, (id) =>
        service.getSnapshot(id),
      );
    } catch (error) {
      if (error instanceof EpisodeFormalAncestryError)
        fail("完整原正式祖先或模型快照不可核对，不分配替代来源。");
      throw error;
    }
    const dependencies = [
      ...new Map(
        [
          ...ancestorDependencies,
          ...ancestorRecords,
          {
            sourceId: saved.record.id,
            sourceVersion: saved.record.version,
            fieldPath: `/production/${saved.record.id}`,
          },
        ].map(({ sourceId, sourceVersion, fieldPath }) => {
          const value = { sourceId, sourceVersion, fieldPath };
          return [JSON.stringify(value), value] as const;
        }),
      ).values(),
    ];
    return references.map((reference) => {
      const combined = [
        ...new Map(
          [...(reference.policyDependencies ?? []), ...dependencies].map(
            (value) => [JSON.stringify(value), value] as const,
          ),
        ).values(),
      ];
      if (combined.length > 2000)
        fail("完整原来源禁止链超出协议上限，不裁剪依赖。");
      return { ...reference, policyDependencies: combined };
    });
  };
  const snapshotMatches = (
    snapshot: AgentContextSnapshot | undefined,
    value: Pick<
      Stored,
      | "projectId"
      | "sourceSnapshotId"
      | "sourceManifestHash"
      | "sourcePromptHash"
      | "outlineBasis"
      | "policyDependencies"
      | "input"
    >,
  ) =>
    !!snapshot &&
    snapshot.id === value.sourceSnapshotId &&
    snapshot.projectId === value.projectId &&
    snapshot.tokenBudget === value.input.tokenBudget &&
    snapshot.destination.kind === "local" &&
    snapshot.destination.provider === "author-source-review" &&
    snapshot.destination.model === undefined &&
    snapshot.manifestSha256 === value.sourceManifestHash &&
    snapshot.finalPromptSha256 === value.sourcePromptHash &&
    hash(value.policyDependencies) ===
      hash([
        ...new Map(
          snapshot.entries
            .filter((entry) => entry.included)
            .flatMap((entry) => entry.policyDependencies ?? [])
            .map((value) => [JSON.stringify(value), value] as const),
        ).values(),
      ]) &&
    createHash("sha256")
      .update(
        canonicalJson({
          projectId: snapshot.projectId,
          destination: snapshot.destination,
          tokenBudget: snapshot.tokenBudget,
          entries: snapshot.entries,
        }),
      )
      .digest("hex") === snapshot.manifestSha256 &&
    createHash("sha256").update(snapshot.finalPrompt).digest("hex") ===
      snapshot.finalPromptSha256 &&
    value.outlineBasis.references.every(
      (ref) =>
        snapshot.entries.filter(
          (entry) =>
            entry.included &&
            entry.mode !== "never" &&
            entry.sourceKind === ref.sourceKind &&
            entry.sourceId === ref.sourceId &&
            entry.sourceVersion === ref.sourceVersion &&
            entry.fieldPath === ref.fieldPath &&
            hash(entry.value) === ref.contentHash,
        ).length === 1,
    );
  const reasons = (value: Stored) => {
    const reasons: string[] = [];
    // The actual manuscript is an independent authority, not a substitute for
    // validating the saved candidate itself. Refuse mismatched candidate/input
    // content before compiling any frozen body or releasing selected sources.
    if (
      hash(value.outlineContent) !== value.outlineContentHash ||
      hash(value.scriptContent) !== value.scriptContentHash ||
      hash(value.input.outlineContent) !== value.outlineContentHash ||
      hash(value.input.sceneLinks) !== hash(value.scriptContent.sceneLinks)
    )
      return ["原来源确认候选、完整大纲或原场景映射不可核对，保留原预览。"];
    try {
      const originals = context.uow.execute((tx) =>
        pair(
          tx,
          value.sourceScript.id,
          value.sourceScript.version,
          value.sourceOutline,
        ),
      );
      const current = fresh(value.projectId, value.input.request);
      if (
        hash(current.basis) !== value.sourceBasisHash ||
        hash(value.outlineBasis) !== value.sourceBasisHash
      )
        reasons.push("明确的新来源或完整表达已变化。");
      const snapshot = optionalService(
        context,
        AGENT_CONTEXT_SERVICE,
      )?.getSnapshot(value.sourceSnapshotId);
      if (!snapshotMatches(snapshot, value))
        reasons.push("本次实际新来源快照不可核对。");
      const service = optionalService(context, AGENT_CONTEXT_SERVICE);
      if (!service?.previewCreation) fail("本次来源隐私预检不可用。");
      const preview = service.previewCreation(
        {
          projectId: value.projectId,
          runIntent: "author-source-revision",
          basePrompt: JSON.stringify({
            outline: value.outlineContent,
            script: value.scriptContent,
          }),
          tokenBudget: value.input.tokenBudget,
          destination: { kind: "local", provider: "author-source-review" },
          temporaryOverrides: [],
        },
        protectReferences(current.references, originals),
      );
      if (
        !current.basis.references.every((ref) =>
          preview.entries.some(
            (entry) =>
              entry.included &&
              entry.sourceKind === ref.sourceKind &&
              entry.sourceId === ref.sourceId &&
              entry.sourceVersion === ref.sourceVersion &&
              entry.fieldPath === ref.fieldPath &&
              hash(entry.value) === ref.contentHash,
          ),
        )
      )
        reasons.push("当前来源隐私或完整预算不再允许原明确范围。");
    } catch (error) {
      if (!(error instanceof SourceRevisionError) || error.status >= 500)
        throw error;
      reasons.push("当前来源、隐私或完整预算不可核对。");
    }
    try {
      context.uow.execute((tx) => {
        const originals = pair(
          tx,
          value.sourceScript.id,
          value.sourceScript.version,
          value.sourceOutline,
        );
        for (const operation of [
          "episode-outline",
          "episode-script",
        ] as const) {
          const expected =
            value.results?.[
              operation === "episode-outline" ? "outline" : "script"
            ] ??
            (operation === "episode-outline"
              ? value.sourceOutline
              : value.sourceScript);
          if (
            owner.head(tx, value.projectId, value.episodeId, operation) !==
            expected.id
          )
            reasons.push("当前正式大纲或剧本采用头已变化。");
        }
        const { document, record } = actual(tx, originals.script);
        if (
          document.id !== value.document.id ||
          document.version !== value.document.version ||
          document.title !== value.title ||
          record.version !== value.scriptRecordVersion ||
          hash(record) !== value.scriptRecordHash ||
          hash({
            blocks: JSON.parse(document.blocks_json),
            sceneLinks: value.scriptContent.sceneLinks,
          }) !== value.scriptContentHash ||
          hash(value.outlineContent) !== value.outlineContentHash
        )
          reasons.push("实际稿件、脚本字段或本次冻结内容已变化。");
      });
    } catch (error) {
      if (!(error instanceof SourceRevisionError) || error.status >= 500)
        throw error;
      reasons.push("原正式或实际保存身份不可核对。");
    }
    return [...new Set(reasons)];
  };
  const decode = (value: Stored) => {
    const staleReasons = reasons(value);
    return EpisodeSourceRevisionSchema.parse({
      ...value,
      sourceState: staleReasons.length ? "stale" : "current",
      staleReasons,
    });
  };
  const get = (id: string) => {
    const value = context.uow.execute((tx) => read(tx, id));
    if (!value) throw new SourceRevisionError(404, "明确来源确认预览不存在。");
    return decode(value);
  };
  const sourceContext = (id: string) => {
    // Read and revalidate current sources/privacy before releasing any body.
    // These synchronous public owner reads allocate no preview/run/event and
    // never enter a peer owner's UOW from our write transaction.
    const value = get(id);
    if (value.sourceState !== "current")
      fail("本次来源、隐私或完整稿件已失效；不返回冻结旧正文或替代来源。");
    const snapshot = optionalService(
      context,
      AGENT_CONTEXT_SERVICE,
    )?.getSnapshot(value.sourceSnapshotId);
    if (!snapshotMatches(snapshot, value))
      fail("本次实际完整来源快照不可核对；未返回正文。");
    const entries = value.outlineBasis.references.map((ref) => {
      const matching = snapshot!.entries.filter(
        (entry) =>
          entry.included &&
          entry.mode !== "never" &&
          entry.sourceKind === ref.sourceKind &&
          entry.sourceId === ref.sourceId &&
          entry.sourceVersion === ref.sourceVersion &&
          entry.fieldPath === ref.fieldPath &&
          hash(entry.value) === ref.contentHash,
      );
      if (matching.length !== 1)
        fail("完整来源表达缺失或重复；不返回部分正文。");
      return { ...ref, value: matching[0]!.value };
    });
    return EpisodeSourceRevisionContextSchema.parse({
      id: value.id,
      projectId: value.projectId,
      episodeId: value.episodeId,
      sourceScript: value.sourceScript,
      sourceOutline: value.sourceOutline,
      document: value.document,
      stateVersion: value.stateVersion,
      status: value.status,
      sourceBasisHash: value.sourceBasisHash,
      sourceSnapshotId: value.sourceSnapshotId,
      sourceManifestHash: value.sourceManifestHash,
      sourcePromptHash: value.sourcePromptHash,
      tokenBudget: value.input.tokenBudget,
      entries,
    });
  };
  const receipt = (key: string, digest: string) =>
    context.uow.execute((tx) => {
      const row = tx.get<{ request_hash: string; revision_id: string }>(
        "SELECT request_hash,revision_id FROM production_episode_source_revision_requests WHERE request_key=?",
        key,
      );
      if (row && row.request_hash !== digest)
        fail("原请求键已绑定其他来源确认，不换源或决定。");
      return row?.revision_id;
    });
  const remember = (
    tx: UnitOfWorkTransaction,
    key: string,
    digest: string,
    id: string,
  ) =>
    tx.run(
      "INSERT INTO production_episode_source_revision_requests VALUES (?,?,?)",
      key,
      digest,
      id,
    );
  const event = (tx: UnitOfWorkTransaction, value: Stored) => {
    const envelope = {
      pluginId: "production",
      aggregateType: "episode-source-revision",
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
        type: "production.episode-source-revision-previewed.v1",
      });
    else if (value.status === "adopted")
      tx.append({
        ...envelope,
        type: "production.episode-source-revision-adopted.v1",
      });
    else
      tx.append({
        ...envelope,
        type: "production.episode-source-revision-discarded.v1",
      });
  };
  const preview = (
    id: string,
    input: EpisodeSourceRevisionInput,
    key: string,
  ) => {
    const digest = hash({ id, action: "preview", input }),
      replay = receipt(key, digest);
    if (replay) return get(replay);
    const captured = context.uow.execute((tx) => {
      const originals = pair(tx, id, input.sourceVersion, input.outline);
      if (
        owner.head(
          tx,
          originals.script.projectId,
          originals.script.episodeId,
          "episode-script",
        ) !== id ||
        owner.head(
          tx,
          originals.script.projectId,
          originals.script.episodeId,
          "episode-outline",
        ) !== input.outline.id
      )
        fail("只确认明确当前原正式双头，不从历史或最新猜测。");
      if (
        input.request.episodeId !== originals.script.episodeId ||
        Boolean(input.request.direct) !==
          Boolean(originals.outline.basis.request.direct) ||
        input.request.direct?.entryPath !==
          originals.outline.basis.request.direct?.entryPath
      )
        fail("新来源须保留原分集与独立入口身份，不跨路径重解释。");
      const saved = actual(tx, originals.script);
      if (saved.document.version !== input.documentVersion)
        throw new SourceRevisionError(412, "实际文档版本不符。");
      return { originals, ...saved };
    });
    const { basis, references } = fresh(
      captured.originals.script.projectId,
      input.request,
    );
    if (
      hash(sourceProjection(basis)) ===
      hash(sourceProjection(captured.originals.outline.basis))
    )
      fail("实际上游来源未变化；正文修改使用原人工确认协议。");
    let outlineContent: EpisodeSourceRevisionInput["outlineContent"];
    try {
      outlineContent = inspectEpisodeOutlineContent(
        input.outlineContent,
        basis,
      );
    } catch {
      fail(
        "完整新大纲未满足本次实际章节、时长或场景约束；请明确编辑后重新审阅。",
      );
    }
    const blocks = JSON.parse(captured.document.blocks_json);
    let scriptContent: Stored["scriptContent"];
    try {
      scriptContent = inspectEpisodeScriptContent(
        { blocks, sceneLinks: input.sceneLinks },
        outlineContent,
      );
    } catch {
      fail("实际原稿与完整新场景映射不符；请明确编辑映射，不自动丢块或换稿。");
    }
    if (
      exportFountain(scriptContent.blocks).trim() !==
      String(
        (JSON.parse(captured.record.payload_json) as Record<string, unknown>)[
          "剧本内容"
        ] ?? "",
      ).trim()
    )
      fail("保存的实际AST与正文不一致，不重新生成或修复稿件。");
    // All peer compilation, privacy and snapshot work is outside our write UOW.
    // No model/task/run is allocated. Every required expression must fit before
    // persistence; generic context clipping never becomes a new formal basis.
    const service = optionalService(context, AGENT_CONTEXT_SERVICE);
    if (!service?.previewCreation || !service.prepareCreationOnce)
      fail("本地明确来源上下文预检／冻结服务不可用。");
    const protectedReferences = protectReferences(
      references,
      captured.originals,
    );
    const contextInput = {
      projectId: captured.originals.script.projectId,
      runIntent: "author-source-revision",
      basePrompt: JSON.stringify({
        outline: outlineContent,
        script: scriptContent,
      }),
      tokenBudget: input.tokenBudget,
      destination: { kind: "local" as const, provider: "author-source-review" },
      temporaryOverrides: [],
    };
    let checked: ReturnType<NonNullable<typeof service.previewCreation>>;
    try {
      checked = service.previewCreation(contextInput, protectedReferences);
    } catch {
      fail(
        "完整新来源及保存稿件未通过本次隐私／完整预算，不分配预览或上下文。",
      );
    }
    if (
      !basis.references.every((ref) =>
        checked.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === ref.sourceKind &&
            entry.sourceId === ref.sourceId &&
            entry.sourceVersion === ref.sourceVersion &&
            entry.fieldPath === ref.fieldPath &&
            hash(entry.value) === ref.contentHash,
        ),
      )
    )
      fail("完整新来源被隐私或预算排除；不持久预览、上下文或新正式记录。");
    let sourceEvidence: Stored["sourceEvidence"];
    try {
      sourceEvidence = inspectSceneSourceEvidence(
        outlineContent,
        basis,
        checked.entries,
        "human-declared",
      );
    } catch {
      fail(
        "逐场引文未对应本次实际表达、版本或逐字位置；请明确编辑完整引文，不自动换引用或补读原文。",
      );
    }
    const policyDependencies = [
      ...new Map(
        checked.entries
          .filter((entry) => entry.included)
          .flatMap((entry) => entry.policyDependencies ?? [])
          .map((value) => [JSON.stringify(value), value] as const),
      ).values(),
    ];
    if (policyDependencies.length > 2000)
      fail("完整原来源禁止链超出协议上限，不裁剪依赖。");
    const prepared = service.prepareCreationOnce(
      contextInput,
      protectedReferences,
      {
        scope: "production.episode-source-revision",
        keySha256: createHash("sha256").update(key).digest("hex"),
        requestSha256: digest,
      },
    );
    if (prepared.status === "conflict")
      fail("原来源准备键已绑定另一请求或实际上下文，不重绑或分配替代快照。");
    if (prepared.status === "unavailable")
      throw new SourceRevisionError(
        503,
        "原来源准备快照暂不可核对，不重建或切换来源；原记录保留。",
      );
    const snapshot = prepared.snapshot;
    const sourcePromptHash = createHash("sha256")
      .update(checked.finalPromptPreview)
      .digest("hex");
    const projectId = captured.originals.script.projectId;
    if (
      !snapshotMatches(snapshot, {
        projectId,
        sourceSnapshotId: snapshot.id,
        sourceManifestHash: snapshot.manifestSha256,
        sourcePromptHash,
        policyDependencies,
        outlineBasis: basis,
        input,
      })
    )
      fail("实际新来源冻结不符，不补造原快照。");
    const at = new Date().toISOString();
    const value: Stored = {
      id: crypto.randomUUID(),
      projectId,
      episodeId: captured.originals.script.episodeId,
      sourceScript: { id, version: input.sourceVersion },
      sourceOutline: input.outline,
      document: {
        id: captured.document.id,
        scriptId: captured.document.script_record_id,
        version: captured.document.version,
      },
      scriptRecordVersion: captured.record.version,
      scriptRecordHash: hash(captured.record),
      title: captured.document.title,
      input,
      outlineContent,
      scriptContent,
      outlineContentHash: hash(outlineContent),
      scriptContentHash: hash(scriptContent),
      outlineBasis: basis,
      sourceBasisHash: hash(basis),
      sourceSnapshotId: snapshot.id,
      sourceManifestHash: snapshot.manifestSha256,
      sourcePromptHash,
      policyDependencies,
      ...(sourceEvidence ? { sourceEvidence } : {}),
      status: "pending",
      stateVersion: 0,
      createdAt: at,
      updatedAt: at,
    };
    context.uow.execute((tx) => {
      if (
        owner.head(tx, projectId, value.episodeId, "episode-script") !== id ||
        owner.head(tx, projectId, value.episodeId, "episode-outline") !==
          input.outline.id
      )
        fail("正式双头已变化，不将原确认重绑。");
      const saved = actual(tx, captured.originals.script);
      if (
        hash(saved) !==
        hash({ document: captured.document, record: captured.record })
      )
        fail("实际保存稿件已变化。");
      tx.run(
        "INSERT INTO production_episode_source_revisions VALUES (?,?,?,?,?,?,?)",
        value.id,
        projectId,
        id,
        input.outline.id,
        JSON.stringify(value),
        at,
        at,
      );
      remember(tx, key, digest, value.id);
      event(tx, value);
    });
    return get(value.id);
  };
  const action = (
    id: string,
    stateVersion: number,
    key: string,
    kind: "adopt" | "discard",
    confirmation?: EpisodeSourceRevisionConfirmation,
  ) => {
    const digest = hash({ id, stateVersion, kind, confirmation }),
      replay = receipt(key, digest);
    if (replay) return get(replay);
    const value = get(id);
    if (value.stateVersion !== stateVersion)
      throw new SourceRevisionError(412, "本次来源确认状态已变化。");
    if (value.status !== "pending")
      fail("原来源确认已决定，不以新键重新采用或撤回。");
    if (kind === "adopt" && value.sourceState !== "current")
      fail("明确来源或实际稿件已变化，保留原预览。");
    const continuation =
      kind === "adopt"
        ? owner.continuationTarget(value.projectId, value.outlineBasis)
        : undefined;
    const {
      sourceState: _sourceState,
      staleReasons: _staleReasons,
      ...frozenCandidate
    } = value;
    context.uow.execute((tx) => {
      const stored = read(tx, id);
      if (
        !stored ||
        stored.stateVersion !== stateVersion ||
        stored.status !== "pending"
      )
        throw new SourceRevisionError(412, "实际确认状态已变化。");
      // Peer reads above are outside our transaction. A same-version stored
      // candidate change between that read and this decision must not receive
      // a formal receipt based on one body while persisting another body.
      if (canonicalJson(stored) !== canonicalJson(frozenCandidate))
        fail("原来源确认候选在读取后已变化，保留原预览，不采用或改写该候选。");
      const originals = pair(
        tx,
        value.sourceScript.id,
        value.sourceScript.version,
        value.sourceOutline,
      );
      if (kind === "adopt") {
        if (
          owner.head(tx, value.projectId, value.episodeId, "episode-script") !==
            value.sourceScript.id ||
          owner.head(
            tx,
            value.projectId,
            value.episodeId,
            "episode-outline",
          ) !== value.sourceOutline.id
        )
          fail("正式双头已变化。");
        const { document, record } = actual(tx, originals.script);
        if (
          document.id !== value.document.id ||
          document.version !== value.document.version ||
          document.title !== value.title ||
          hash(record) !== value.scriptRecordHash ||
          hash({
            blocks: JSON.parse(document.blocks_json),
            sceneLinks: value.scriptContent.sceneLinks,
          }) !== value.scriptContentHash
        )
          fail("保存稿件或实际字段已变化，不覆盖作者。");
        const next = (operation: "episode-outline" | "episode-script") => ({
          id: crypto.randomUUID(),
          version: tx.get<{ next: number }>(
            "SELECT COALESCE(MAX(version),0)+1 AS next FROM production_episode_results WHERE project_id=? AND episode_key=? AND operation=?",
            value.projectId,
            value.episodeId,
            operation,
          )!.next,
        });
        const results = {
          outline: next("episode-outline"),
          script: next("episode-script"),
        };
        const sourceRevision = {
          previewId: id,
          sourceScript: value.sourceScript,
          sourceOutline: value.sourceOutline,
          document: value.document,
          scriptRecordVersion: value.scriptRecordVersion,
          scriptRecordHash: value.scriptRecordHash,
          outlineContentHash: value.outlineContentHash,
          scriptContentHash: value.scriptContentHash,
          sourceBasisHash: value.sourceBasisHash,
          sourceSnapshotId: value.sourceSnapshotId,
          sourceManifestHash: value.sourceManifestHash,
          sourcePromptHash: value.sourcePromptHash,
          policyDependencies: value.policyDependencies,
          results,
          humanReview: confirmation!,
          semanticVerification:
            "human-declared-not-independently-verified" as const,
        };
        const at = new Date().toISOString();
        const common = {
          projectId: value.projectId,
          episodeId: value.episodeId,
          origin: "human-source-revision" as const,
          sourceRevision,
          runIds: [],
          sourceSnapshotId: value.sourceSnapshotId,
          sourceContextIntegrity: {
            snapshotId: value.sourceSnapshotId,
            manifestSha256: value.sourceManifestHash,
            finalPromptSha256: value.sourcePromptHash,
          },
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
        });
        const basis = structuredClone(value.outlineBasis);
        delete basis.request.baseOutlineId;
        basis.request.outline = results.outline;
        basis.request.baseScriptId = value.sourceScript.id;
        basis.request.baseScriptDocumentVersion = value.document.version;
        basis.references.push(owner.frozenRef(owner.resultReference(outline)));
        const script = EpisodeDevelopmentResultSchema.parse({
          ...common,
          ...results.script,
          operation: "episode-script",
          basis: EpisodeDevelopmentBasisSchema.parse(basis),
          content: { kind: "episode-script", value: value.scriptContent },
          scriptId: value.document.scriptId,
          episodeRecordId: originals.script.episodeRecordId,
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
            "INSERT INTO production_episode_results(id,project_id,episode_key,operation,adoption_key,version,value_json,adopted_at,workflow_id) VALUES (?,?,?,?,?,?,?,?,NULL)",
            result.id,
            value.projectId,
            value.episodeId,
            result.operation,
            `human-source-revision:${id}:${result.operation}`,
            result.version,
            JSON.stringify(snapshot),
            at,
          );
          tx.run(
            "UPDATE production_episode_result_heads SET result_id=? WHERE project_id=? AND episode_key=? AND operation=? AND result_id=?",
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
            fail("来源正式双头CAS失败，回滚全部决定。");
          tx.append({
            type:
              result.operation === "episode-outline"
                ? "production.episode-outline-adopted.v1"
                : "production.episode-script-adopted.v1",
            pluginId: "production",
            aggregateType: "episode-result",
            aggregateId: result.id,
            aggregateVersion: result.version,
            payload: {
              id: result.id,
              projectId: value.projectId,
              episodeId: value.episodeId,
              operation: result.operation,
              version: result.version,
              origin: "human-source-revision",
              revisionId: id,
            },
          });
          if (result.operation === "episode-script")
            tx.append({
              type: "production.script-result-adopted.v1",
              pluginId: "production",
              aggregateType: "episode-result",
              aggregateId: result.id,
              aggregateVersion: result.version,
              payload: CreativeOutcomeFactSchema.parse({
                eventVersion: 1,
                kind: "adaptation.script-adopted",
                workflowPath: "adaptation",
                projectId: value.projectId,
                objectId: result.id,
                ...(continuation ? { continuationTarget: continuation } : {}),
                formalVersions: [
                  {
                    kind: result.operation,
                    id: result.id,
                    version: result.version,
                  },
                ],
                sourceVersions: [
                  value.sourceScript,
                  value.sourceOutline,
                  { id: value.document.id, version: value.document.version },
                ],
                evidenceKind: "human",
                modelEvidence: "unknown",
                qualityState: "unverified",
                resultStatus: "adopted",
              }),
            });
        }
        stored.results = results;
        stored.confirmation = confirmation;
      }
      stored.status = kind === "adopt" ? "adopted" : "discarded";
      stored.stateVersion++;
      stored.updatedAt = new Date().toISOString();
      tx.run(
        "UPDATE production_episode_source_revisions SET value_json=?,updated_at=? WHERE id=?",
        JSON.stringify(stored),
        stored.updatedAt,
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
    const key = c.req.header("Idempotency-Key")?.trim();
    if (!key || key.length > 200 || !c.req.header("If-Match"))
      throw new SourceRevisionError(
        428,
        "来源确认须携带实际If-Match与Idempotency-Key。",
      );
    if (c.req.header("If-Match")!.trim() !== `"${version}"`)
      throw new SourceRevisionError(412, "If-Match与明确请求版本不一致。");
    return key;
  };
  const list = (c: Http) => {
    const projectId = c.req.param("projectId"),
      input = query.parse({
        cursor: c.req.query("cursor"),
        limit: c.req.query("limit"),
      });
    const rows = context.uow.execute((tx) => {
      const cursor = input.cursor ? read(tx, input.cursor) : undefined;
      if (input.cursor && (!cursor || cursor.projectId !== projectId))
        throw new SourceRevisionError(400, "来源确认游标不属于本项目。");
      return cursor
        ? tx.all<{ value_json: string }>(
            "SELECT value_json FROM production_episode_source_revisions WHERE project_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?",
            projectId,
            cursor.createdAt,
            cursor.createdAt,
            cursor.id,
            input.limit + 1,
          )
        : tx.all<{ value_json: string }>(
            "SELECT value_json FROM production_episode_source_revisions WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT ?",
            projectId,
            input.limit + 1,
          );
    });
    const items = rows
      .slice(0, input.limit)
      .map((row) => decode(JSON.parse(row.value_json) as Stored));
    return {
      items,
      ...(rows.length > input.limit ? { nextCursor: items.at(-1)!.id } : {}),
    };
  };
  const add = (
    path: `/api/v2/${string}`,
    operationId: string,
    method: "get" | "post",
    schema: z.ZodType,
    handler: (c: Http, raw: unknown) => unknown,
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
        tags: ["author-source-revisions"],
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
            description: "Explicit author source revision",
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
        c.header("Cache-Control", "no-store");
        try {
          const result = handler(
            c,
            body ? body.parse(await c.req.json()) : undefined,
          );
          if (result && typeof result === "object" && "stateVersion" in result)
            c.header("ETag", `"${result.stateVersion}"`);
          return c.json(schema.parse(result));
        } catch (error) {
          const status =
            error instanceof SourceRevisionError
              ? error.status
              : error instanceof z.ZodError || error instanceof SyntaxError
                ? 400
                : 503;
          const detail =
            error instanceof SourceRevisionError
              ? error.message
              : status === 400
                ? "来源确认请求或结构不符。"
                : "来源确认读取或处理暂不可用，原记录保留。";
          return new Response(
            JSON.stringify({
              type: "https://dramaip.local/problems/episode-source-revision",
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
                        ? "UNAVAILABLE"
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
  add(
    "/api/v2/episode-development/{id}/source-revision-previews",
    "episodeDevelopments.previewSourceRevision",
    "post",
    EpisodeSourceRevisionSchema,
    (c, raw) => {
      const input = EpisodeSourceRevisionInputSchema.parse(raw);
      return preview(c.req.param("id"), input, key(c, input.sourceVersion));
    },
    EpisodeSourceRevisionInputSchema,
  );
  add(
    "/api/v2/episode-source-revisions/{id}",
    "episodeDevelopments.getSourceRevision",
    "get",
    EpisodeSourceRevisionSchema,
    (c) => get(c.req.param("id")),
  );
  add(
    "/api/v2/episode-source-revisions/{id}/source-context",
    "episodeDevelopments.getSourceRevisionContext",
    "get",
    EpisodeSourceRevisionContextSchema,
    (c) => sourceContext(c.req.param("id")),
  );
  add(
    "/api/v2/projects/{projectId}/episode-source-revisions",
    "episodeDevelopments.listSourceRevisions",
    "get",
    EpisodeSourceRevisionPageSchema,
    (c) => list(c),
    undefined,
    true,
  );
  add(
    "/api/v2/projects/{projectId}/episode-source-revision-summaries",
    "episodeDevelopments.sourceRevisionSummaries",
    "get",
    EpisodeSourceRevisionSummaryPageSchema,
    (c) => {
      const page = list(c);
      return {
        ...page,
        items: page.items.map((item) =>
          EpisodeSourceRevisionSummarySchema.parse({
            id: item.id,
            projectId: item.projectId,
            episodeId: item.episodeId,
            sourceScript: item.sourceScript,
            sourceOutline: item.sourceOutline,
            document: item.document,
            status: item.status,
            stateVersion: item.stateVersion,
            ...(item.results ? { results: item.results } : {}),
            sourceState: item.sourceState,
            staleReasons: item.staleReasons,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }),
        ),
      };
    },
    undefined,
    true,
  );
  const adopt = z
    .object({
      stateVersion: z.number().int().nonnegative(),
      confirmation: EpisodeSourceRevisionConfirmationSchema,
    })
    .strict();
  add(
    "/api/v2/episode-source-revisions/{id}/adopt",
    "episodeDevelopments.adoptSourceRevision",
    "post",
    EpisodeSourceRevisionSchema,
    (c, raw) => {
      const input = adopt.parse(raw);
      return action(
        c.req.param("id"),
        input.stateVersion,
        key(c, input.stateVersion),
        "adopt",
        input.confirmation,
      );
    },
    adopt,
  );
  const discard = z
    .object({ stateVersion: z.number().int().nonnegative() })
    .strict();
  add(
    "/api/v2/episode-source-revisions/{id}/discard",
    "episodeDevelopments.discardSourceRevision",
    "post",
    EpisodeSourceRevisionSchema,
    (c, raw) => {
      const input = discard.parse(raw);
      return action(
        c.req.param("id"),
        input.stateVersion,
        key(c, input.stateVersion),
        "discard",
      );
    },
    discard,
  );
}
