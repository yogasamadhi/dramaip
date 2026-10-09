import { frozenEpisodeSharedInputsMatch } from "./frozen-shared-constraints.js";
import { observeFrozenEpisodeNarrativeSources } from "./episode-narrative-observation.js";
import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  AGENT_CONTEXT_SERVICE,
  agentContextManifestJSON,
} from "@dramaip/contracts/agent-context";
import {
  CreativeOutcomeFactSchema,
  canonicalCreativeMetricJSON,
  creativeContinuationIdentity,
} from "@dramaip/contracts/insights";
import {
  AUTHOR_INTENT_CREATION_PROMPT,
  CREATION_KNOWLEDGE_SERVICE,
  CREATION_WORKFLOW_SERVICE,
  creationAuthorIntent,
  creationReference,
  WRITING_NARRATIVE_SOURCE_SERVICE,
  narrativeSourceSelection,
  narrativeSourceIdentity,
  type CreationInput,
  type CreationWorkflow,
  type CreationContent,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import {
  WORKSPACE_AUTHOR_INTENT_SERVICE,
  WORKSPACE_PROJECT_SERVICE,
} from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import {
  PRODUCTION_DIAGNOSIS_SERVICE,
  PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
  PRODUCTION_SEASON_PLAN_SERVICE,
  PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
  PRODUCTION_RECORD_SERVICE,
  EpisodeDevelopmentRequestSchema,
  EpisodeDevelopmentBasisSchema,
  EpisodeDevelopmentResultSchema,
  EpisodeDevelopmentPageSchema,
  EpisodeDevelopmentSummarySchema,
  EpisodeDevelopmentSummaryPageSchema,
  EpisodeDevelopmentCatalogSchema,
  EpisodeDevelopmentImpactSchema,
  EpisodeConfirmedSourceTransitionSchema,
  StoryboardAttributionImpactQuerySchema,
  type StoryboardAttributionImpactSelection,
  type StoryboardAttributionImpact,
  ProductionRecordMergeComparisonSchema,
  ProductionRecordMergeRequestSchema,
  ProductionRecordMergeSourceSchema,
  type ProductionRecordMergeRequest,
  EpisodeOutlineContentSchema,
  EpisodeScriptContentSchema,
  EpisodeSceneEvidenceSchema,
  StoryboardPackageContentSchema,
  StoryboardShotPatchSchema,
  StoryboardBlockStructurePatchSchema,
  StoryboardSceneShotPlanPatchSchema,
  StoryboardSceneTopologyPlanPatchSchema,
  StoryboardTopologyPlanReceiptSchema,
  type StoryboardSourceReviewReceipt,
  type EpisodeTopologyRevision,
  type EpisodeScriptRevision,
  type EpisodeSourceRevision,
  StoryboardRedoPatchSchema,
  type StoryboardRedoReceipt,
  type StoryboardBlockStructureMapping,
  type EpisodeScriptContent,
  type EpisodeDevelopmentBasis,
  type EpisodeDevelopmentResult,
  type EpisodeDevelopmentRequest,
  type DirectScriptSource,
  type EpisodeUpstreamConstraints,
  type EpisodeUpstreamConstraint,
  type StoryboardShotSourceObservation,
} from "@dramaip/contracts/production";
import {
  optionalService,
  provideService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { inspectStoryboardContent } from "./storyboard-content.js";
import {
  strategyDiagnosisReference,
  selectedAdaptationStrategyReference,
} from "./adaptation-strategy-content.js";
import {
  adaptationExpressionScope,
  episodeBibleReferences,
} from "./narrative-sources.js";
import {
  directScriptSourceContent,
  type DirectScriptSourceDocument,
} from "./direct-script-source.js";
import {
  inspectSceneSourceEvidence,
  sceneStoryReferences,
} from "./scene-source-evidence.js";
import { inspectEpisodeImpact, type ImpactRecord } from "./episode-impact.js";
import { inspectEpisodeScriptContent } from "./episode-script-content.js";
import { inspectEpisodeOutlineContent } from "./episode-outline-content.js";
import { episodeResultReference as resultReference } from "./episode-result-reference.js";
import { registerEpisodeScriptRevisions } from "./episode-script-revision.js";
import { registerEpisodeSourceRevisions } from "./episode-source-revision.js";
import { registerStoryboardAttributions } from "./storyboard-attribution.js";
import { AttributionImpactError } from "./storyboard-attribution-impact.js";
import {
  registerEpisodeTopologyRevisions,
  topologyResultReasons,
} from "./episode-topology-revision.js";
import { inspectStoryboardRedo } from "./storyboard-redo.js";
import {
  freezeStoryboardSourceReview,
  StoryboardSourceReviewError,
} from "./storyboard-source-review.js";
import { freezeStoryboardShotPlan } from "./storyboard-shot-plan.js";
import { freezeStoryboardTopologyPlan } from "./storyboard-topology-plan.js";
import { inspectStoryboardTopologyAncestry } from "./storyboard-topology-ancestry.js";
import { confirmedStoryboardBlockMappings } from "./storyboard-block-structure.js";
import {
  inspectEpisodeFormalAncestry,
  episodeAncestryPolicyDependencies,
  EpisodeFormalAncestryError,
} from "./episode-formal-ancestry.js";
import {
  inspectReviewedStoryboardSourceAncestry,
  inspectStoryboardSourceAncestry,
  StoryboardSourceAncestryError,
} from "./storyboard-source-ancestry.js";
import {
  observeConstraintRead,
  observeEpisodeConstraint,
} from "./episode-constraint-observations.js";
import {
  captureProductionRecordBaseline,
  inspectProductionRecordBaselines,
  type BaselineRecordRow,
  type ProductionRecordBaseline,
} from "./record-baselines.js";
import {
  planProductionRecordFields,
  productionRecordFieldHash,
  resolveProductionRecordFields,
} from "./record-field-merge.js";

export const episodeDevelopmentMigration: PluginMigration = {
  id: "production.0007.episode-development",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0006.season-plans"],
  sql: `CREATE TABLE production_episode_results (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    episode_key TEXT NOT NULL, operation TEXT NOT NULL, workflow_id TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL, value_json TEXT NOT NULL, adopted_at TEXT NOT NULL,
    UNIQUE(project_id, episode_key, operation, version)
  );
  CREATE INDEX production_episode_result_page ON production_episode_results(project_id, adopted_at DESC, id DESC);
  CREATE TABLE production_episode_result_heads (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, episode_key TEXT NOT NULL,
    operation TEXT NOT NULL, result_id TEXT NOT NULL REFERENCES production_episode_results(id),
    PRIMARY KEY(project_id, episode_key, operation)
  );`,
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bodyHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Stored = Omit<
  EpisodeDevelopmentResult,
  "isCurrent" | "sourceState" | "staleReasons"
> & { recordBaselines?: ProductionRecordBaseline[] };
type Operation = Stored["operation"];
class EpisodeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function fail(message: string): never {
  throw new EpisodeError(409, message);
}

function reservedStoryboardIds(
  tx: UnitOfWorkTransaction,
  projectId: string,
  kind: "scenes" | "shots",
): string[] {
  const identities = new Set<string>();
  for (const row of tx.all<{ id: string; payload_json: string }>(
    "SELECT id, payload_json FROM production_records WHERE project_id = ? AND kind = ?",
    projectId,
    kind,
  )) {
    identities.add(row.id);
    const stableId = (JSON.parse(row.payload_json) as Record<string, unknown>)
      .stableId;
    if (typeof stableId === "string") identities.add(stableId);
  }
  for (const row of tx.all<{ value_json: string }>(
    "SELECT value_json FROM production_episode_results WHERE project_id = ? AND operation = 'storyboard-package'",
    projectId,
  )) {
    const stored = JSON.parse(row.value_json) as Stored;
    if (stored.content.kind !== "storyboard-package")
      fail("历史分镜身份不可核全，不能重用身份或补造历史。");
    const content = StoryboardPackageContentSchema.parse(stored.content.value);
    for (const scene of content.scenes)
      if (kind === "scenes") identities.add(scene.sceneId);
      else for (const shot of scene.shots) identities.add(shot.id);
  }
  return [...identities];
}
const reservedStoryboardShotIds = (
  tx: UnitOfWorkTransaction,
  projectId: string,
) => reservedStoryboardIds(tx, projectId, "shots");

export function registerEpisodeDevelopment(context: PluginContext) {
  const readSourceSnapshot = (id: string) => {
    try {
      return optionalService(context, AGENT_CONTEXT_SERVICE)?.getSnapshot(id);
    } catch {
      throw new EpisodeError(
        503,
        "原冻结上下文本次读取暂不可用；不使用缓存或替代快照。",
      );
    }
  };
  const project = (id: string) => {
    const value = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(id);
    if (!value) throw new EpisodeError(404, "项目不存在。");
    return value;
  };
  const head = (
    tx: UnitOfWorkTransaction,
    projectId: string,
    episodeId: string,
    operation: Operation,
  ) =>
    tx.get<{ result_id: string }>(
      "SELECT result_id FROM production_episode_result_heads WHERE project_id = ? AND episode_key = ? AND operation = ?",
      projectId,
      episodeId,
      operation,
    )?.result_id;
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<{ value_json: string }>(
      "SELECT value_json FROM production_episode_results WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const current = (
    projectId: string,
    episodeId: string,
    operation: Operation,
  ) =>
    context.uow.execute((tx) => {
      const id = head(tx, projectId, episodeId, operation);
      return id ? read(tx, id) : undefined;
    });
  const recordBaselineObservations = (
    tx: UnitOfWorkTransaction,
    value: Stored,
  ) =>
    inspectProductionRecordBaselines({
      projectId: value.projectId,
      bindings: value.productionRecords ?? [],
      baselines: value.recordBaselines,
      rows: (value.productionRecords ?? []).flatMap((binding) => {
        const row = tx.get<BaselineRecordRow>(
          "SELECT id, project_id, kind, version, title, parent_id, order_index, payload_json FROM production_records WHERE id = ? AND project_id = ? AND kind = ?",
          binding.id,
          value.projectId,
          binding.kind,
        );
        return row ? [row] : [];
      }),
    });
  const documentVersion = (value: Stored | undefined) =>
    value?.scriptId
      ? context.uow.execute(
          (tx) =>
            tx.get<{ version: number }>(
              "SELECT version FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
              value.scriptId,
              value.projectId,
            )?.version,
        )
      : undefined;
  const continuationTarget = (
    projectId: string,
    basis: EpisodeDevelopmentBasis,
  ) => {
    const plan = basis.request.direct
      ? undefined
      : optionalService(context, PRODUCTION_SEASON_PLAN_SERVICE)?.current(
          projectId,
        );
    if (
      !basis.request.direct &&
      (!plan ||
        plan.id !== basis.request.seasonPlan?.id ||
        plan.version !== basis.request.seasonPlan.version)
    )
      return undefined;
    const directory = basis.request.direct
      ? (
          optionalService(context, PRODUCTION_RECORD_SERVICE)?.list(
            "episodes",
            { projectId },
          ) ?? []
        ).filter(
          (item) => item.parentId === project(projectId).currentAdaptationId,
        )
      : plan!.content.episodes;
    const ordered = [...directory].sort(
      (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
    );
    const position = ordered.findIndex((item) => item.id === basis.episode.id);
    if (position < 0) return undefined;
    const scope = basis.request.direct
      ? (project(projectId).currentAdaptationId ?? "")
      : basis.request.seasonPlan!.id;
    return {
      targetKey: createHash("sha256")
        .update(
          creativeContinuationIdentity(
            projectId,
            "adaptation",
            basis.episode.id,
            scope,
          ),
        )
        .digest("hex"),
      position,
    };
  };
  const continuationBasis = (
    projectId: string,
    basis: EpisodeDevelopmentBasis,
  ) => {
    const target = continuationTarget(projectId, basis);
    if (target?.position !== 1) return undefined;
    const directory = basis.request.direct
      ? (
          optionalService(context, PRODUCTION_RECORD_SERVICE)?.list(
            "episodes",
            { projectId },
          ) ?? []
        ).filter(
          (item) => item.parentId === project(projectId).currentAdaptationId,
        )
      : optionalService(context, PRODUCTION_SEASON_PLAN_SERVICE)!.current(
          projectId,
        )!.content.episodes;
    const first = [...directory].sort(
      (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
    )[0]!;
    const source = current(projectId, first.id, "episode-script");
    if (
      !source ||
      sourceReasons(source).length ||
      documentVersion(source) !== source.scriptDocumentVersion ||
      hash(source.basis.request.seasonPlan ?? null) !==
        hash(basis.request.seasonPlan ?? null) ||
      Boolean(source.basis.request.direct) !== Boolean(basis.request.direct)
    )
      return undefined;
    const anchor = continuationTarget(projectId, source.basis);
    if (anchor?.position !== 0) return undefined;
    return {
      workflowPath: "adaptation" as const,
      source: {
        ...anchor,
        kind: "episode-script" as const,
        id: source.id,
        version: source.version,
      },
      target,
    };
  };
  const bible = (projectId: string) => {
    const service = optionalService(context, CREATION_KNOWLEDGE_SERVICE);
    if (!service?.approvedStoryBible) fail("已批准 Story Bible 服务未启用。");
    return service.approvedStoryBible!(projectId);
  };
  const frozenRef = (value: ReturnType<typeof creationReference>) => ({
    sourceKind:
      value.sourceKind as EpisodeDevelopmentBasis["references"][number]["sourceKind"],
    sourceId: value.sourceId,
    sourceVersion: value.sourceVersion,
    fieldPath: value.fieldPath,
    contentHash: hash(value.value),
  });
  const directSources = (projectId: string, source: DirectScriptSource) => {
    const value = project(projectId);
    if (
      value.id !== source.project.id ||
      value.version !== source.project.version ||
      value.modeConfig.mode !== "single_season" ||
      value.modeConfig.entryPath !== source.entryPath ||
      !["script", "inspiration"].includes(value.modeConfig.entryPath)
    )
      fail("直写项目、创建路径或简报版本已变化；不会补造小说、诊断或季纲。");
    const intent = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    )?.current(projectId);
    if (
      !intent ||
      intent.id !== source.authorIntent.id ||
      intent.version !== source.authorIntent.version ||
      intent.sourceState !== "current"
    )
      fail("请明确采用并确认当前正式作者意图。");
    const records = optionalService(context, PRODUCTION_RECORD_SERVICE);
    const episode = records?.get(source.episode.id);
    const parent = episode?.parentId
      ? records?.get(episode.parentId)
      : undefined;
    if (
      !episode ||
      episode.projectId !== projectId ||
      episode.kind !== "episodes" ||
      episode.version !== source.episode.version ||
      !parent ||
      parent.kind !== "adaptations" ||
      parent.projectId !== projectId ||
      parent.id !== value.currentAdaptationId
    )
      fail("直写分集不属于当前实际分集目录，或版本已变化。");
    const officialIntent = creationAuthorIntent(projectId, intent);
    const references = [
      ...officialIntent.references,
      creationReference("project", {
        id: value.id,
        version: value.version,
        projectId,
        title: "作者保存的直写简报（不是季纲）",
        content: {
          synopsis: value.synopsis,
          productionBrief: value.productionBrief,
          entryPath: source.entryPath,
        },
      }),
      creationReference("episode-directory", {
        id: episode.id,
        version: episode.version,
        projectId,
        title: episode.title,
        parentId: episode.parentId,
        orderIndex: episode.orderIndex,
      }),
    ];
    if (
      source.entryPath === "inspiration" &&
      !value.synopsis?.trim() &&
      !value.productionBrief?.trim()
    )
      fail("请先保存实际故事创意或创作简报；空目录不是故事来源。");
    if (source.sourceScript) {
      const script = records?.get(source.sourceScript.id);
      const document = context.uow.execute((tx) =>
        tx.get<DirectScriptSourceDocument>(
          "SELECT version, blocks_json, source_format, loss_report_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
          source.sourceScript!.id,
          projectId,
        ),
      );
      const content = directScriptSourceContent(
        script?.payload["剧本内容"],
        document,
      );
      if (
        !script ||
        script.kind !== "scripts" ||
        script.projectId !== projectId ||
        script.parentId !== episode.id ||
        script.payload["episodeResultId"] ||
        script.version !== source.sourceScript.version ||
        (document?.version ?? null) !== source.sourceScript.documentVersion ||
        !content
      )
        fail("所选原剧本、真实文档或正文版本已变化；不换源、不覆盖原稿。");
      const { content: body, blocks, ...representation } = content;
      references.push(
        creationReference("source-script", {
          id: script.id,
          version: script.version,
          projectId,
          title: script.title,
          content: body,
          documentVersion: document?.version ?? null,
          ...(blocks ? { blocks } : {}),
          ...representation,
        }),
      );
    }
    return {
      officialIntent,
      references,
      authorIntent: { id: intent.id, version: intent.version },
      diagnosis: undefined,
      episode: {
        sourcePath: "direct-script" as const,
        id: episode.id,
        version: episode.version,
        title: episode.title,
        orderIndex: episode.orderIndex,
        durationSeconds: source.durationSeconds,
      },
      chapters: [] as EpisodeDevelopmentBasis["chapters"],
    };
  };
  const sourceReasons = (value: Stored) => {
    const reasons: string[] = context.uow.execute((tx) =>
      topologyResultReasons(tx, value),
    );
    const basis = value.basis;
    if (basis.request.direct) {
      try {
        const sources = directSources(value.projectId, basis.request.direct);
        if (
          sources.references
            .map(frozenRef)
            .some(
              (source) =>
                !basis.references.some(
                  (expected) =>
                    expected.sourceKind === source.sourceKind &&
                    expected.sourceId === source.sourceId &&
                    expected.sourceVersion === source.sourceVersion &&
                    expected.fieldPath === source.fieldPath &&
                    expected.contentHash === source.contentHash,
                ),
            )
        )
          reasons.push("直写简报、原剧本或分集来源已变化");
      } catch (error) {
        reasons.push(error instanceof Error ? error.message : "直写来源未核全");
      }
    } else {
      const plan = optionalService(
        context,
        PRODUCTION_SEASON_PLAN_SERVICE,
      )?.current(value.projectId);
      const parentRequiresReview =
        !plan ||
        plan.id !== basis.request.seasonPlan?.id ||
        plan.version !== basis.request.seasonPlan?.version ||
        plan.sourceState !== "current";
      let independentInputsUnchanged = false;
      if (
        plan &&
        !basis.request.episodeNarrativeContext &&
        (Boolean(plan.basis.sourceBasis) !== Boolean(basis.sourceBasis) ||
          (plan.basis.sourceBasis &&
            basis.sourceBasis &&
            (narrativeSourceIdentity(plan.basis.sourceBasis) !==
              narrativeSourceIdentity(basis.sourceBasis) ||
              hash(plan.basis.chapters) !== hash(basis.contextChapters))))
      )
        reasons.push("整季实际表达与本集冻结基准不一致，须重新明确确认");
      if (basis.request.episodeNarrativeContext) {
        try {
          const compiler = optionalService(
            context,
            WRITING_NARRATIVE_SOURCE_SERVICE,
          );
          const originalPlan = optionalService(
            context,
            PRODUCTION_SEASON_PLAN_SERVICE,
          )?.get(value.projectId, basis.request.seasonPlan!.id);
          if (
            !compiler ||
            !basis.sourceBasis ||
            !originalPlan ||
            originalPlan.id !== basis.request.seasonPlan?.id ||
            originalPlan.version !== basis.request.seasonPlan.version ||
            originalPlan.status !== "adopted"
          )
            fail("独立单集原正式父级或来源无法核对。");
          const observed = observeFrozenEpisodeNarrativeSources(
            value.projectId,
            originalPlan.basis.chapters.map(({ id, version }) => ({
              id,
              version,
            })),
            basis.sourceBasis,
            basis.request.episodeNarrativeContext,
            (scope, request) =>
              compiler.compile(value.projectId, scope, request),
          );
          if (
            !observed.matches ||
            hash(
              originalPlan.basis.chapters.filter((item) =>
                observed.covered.has(item.id),
              ),
            ) !== hash(basis.contextChapters)
          )
            reasons.push("本集独立选择的实际表达或完整覆盖已变化");
          else independentInputsUnchanged = true;
        } catch {
          reasons.push("本集独立选择的实际表达不可用，不补最新来源");
        }
      }
      if (
        parentRequiresReview &&
        !(
          plan?.status === "adopted" &&
          plan.id === basis.request.seasonPlan?.id &&
          plan.version === basis.request.seasonPlan?.version &&
          independentInputsUnchanged &&
          frozenEpisodeSharedInputsMatch(basis, {
            format: "formal-constraint-observations-v1",
            ...crossOwnerConstraintObservations(value),
          })
        )
      )
        reasons.push("当前季纲或其诊断/来源已变化");
    }
    const intent = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    )?.current(value.projectId);
    if (
      !intent ||
      intent.id !== basis.authorIntent.id ||
      intent.version !== basis.authorIntent.version
    )
      reasons.push("正式作者意图已变化");
    const expectedBible = episodeBibleReferences(basis);
    if (hash(bible(value.projectId).map(frozenRef)) !== hash(expectedBible))
      reasons.push("已批准 Story Bible 集合或版本已变化");
    if (value.operation !== "episode-outline") {
      const outline = current(
        value.projectId,
        value.episodeId,
        "episode-outline",
      );
      if (
        !outline ||
        outline.id !== basis.request.outline?.id ||
        outline.version !== basis.request.outline.version
      )
        reasons.push("当前采用单集大纲已变化");
      if (documentVersion(value) !== value.scriptDocumentVersion)
        reasons.push("标准剧本已人工修改或不存在，保留原采用快照");
      if (
        (value.origin === "human-script-revision" ||
          value.origin === "human-topology-revision" ||
          value.origin === "human-source-revision") &&
        (value.scriptRevision ||
          value.topologyRevision ||
          value.sourceRevision) &&
        context.uow.execute(
          (tx) =>
            tx.get<{ version: number }>(
              "SELECT version FROM production_records WHERE id = ? AND project_id = ? AND kind = 'scripts'",
              value.scriptId,
              value.projectId,
            )?.version,
        ) !==
          (value.scriptRevision ??
            value.topologyRevision ??
            value.sourceRevision)!.scriptRecordVersion
      )
        reasons.push("人工确认剧本记录已修改或不存在，保留原确认快照");
      if (
        value.origin === "human-source-revision" &&
        value.sourceRevision &&
        context.uow.execute((tx) => {
          const row = tx.get<{
            id: string;
            version: number;
            parent_id: string | null;
            title: string;
            payload_json: string;
          }>(
            "SELECT id,version,parent_id,title,payload_json FROM production_records WHERE id=? AND project_id=? AND kind='scripts' AND retired_at IS NULL",
            value.scriptId,
            value.projectId,
          );
          return !row || hash(row) !== value.sourceRevision!.scriptRecordHash;
        })
      )
        reasons.push("来源确认实际脚本字段已变化或不可核对，保留原正式快照");
      if (value.operation === "storyboard-package") {
        const script = current(
          value.projectId,
          value.episodeId,
          "episode-script",
        );
        if (
          !script ||
          script.id !== basis.request.script?.id ||
          script.version !== basis.request.script.version
        )
          reasons.push("当前采用标准剧本已变化");
        const recordsChanged = context.uow.execute((tx) =>
          (value.productionRecords ?? []).some((record) => {
            const row = tx.get<{ version: number }>(
              "SELECT version FROM production_records WHERE id = ? AND project_id = ? AND kind = ?",
              record.id,
              value.projectId,
              record.kind,
            );
            return !row || row.version !== record.version;
          }),
        );
        if (recordsChanged)
          reasons.push("已采用场景或分镜已人工修改或删除，保留原分镜快照");
        // New immutable actual-record baselines also detect same-version field
        // changes. Historical absence is never fabricated or backfilled.
        if (
          value.recordBaselines !== undefined &&
          context.uow.execute((tx) =>
            recordBaselineObservations(tx, value).records.some(
              (item) =>
                ["unrecorded", "baseline-invalid", "record-invalid"].includes(
                  item.state,
                ) ||
                (item.state === "changed" &&
                  item.current?.version === item.frozenVersion),
            ),
          )
        )
          reasons.push("实际场景／镜头字段基准不一致或未核全，保留原分镜快照");
      }
    }
    return [...new Set(reasons)];
  };
  const decode = (value: Stored): EpisodeDevelopmentResult => {
    const staleReasons = sourceReasons(value);
    return EpisodeDevelopmentResultSchema.parse({
      ...value,
      isCurrent:
        current(value.projectId, value.episodeId, value.operation)?.id ===
        value.id,
      sourceState: staleReasons.length ? "stale" : "current",
      staleReasons,
    });
  };
  const get = (id: string) => {
    const value = context.uow.execute((tx) => read(tx, id));
    return value ? decode(value) : undefined;
  };
  // Actual records and all known formal history are Production-owned. A logical
  // episode key must never be guessed from an editable record payload.
  const observeStoryboardShot = (
    projectId: string,
    shotRecordId: string,
  ): StoryboardShotSourceObservation => {
    type Row = {
      id: string;
      kind: string;
      project_id: string;
      parent_id: string | null;
      version: number;
      payload_json: string;
      retired_result_id: string | null;
    };
    type FormalRow = {
      id: string;
      project_id: string;
      episode_key: string;
      operation: string;
      value_json: string;
      current_head: string | null;
      workflow_id: string | null;
      adoption_result_json: string | null;
    };
    const unavailable = () => ({
      state: "unavailable" as const,
      reasonCode: "formal-source-unavailable" as const,
    });
    const capture = () =>
      context.uow.execute((tx) => {
        const readRecord = (id: string | null) =>
          id
            ? tx.get<Row>(
                "SELECT id,kind,project_id,parent_id,version,payload_json,retired_result_id FROM production_records WHERE id=?",
                id,
              )
            : undefined;
        const shot = readRecord(shotRecordId),
          scene = readRecord(shot?.parent_id ?? null),
          script = readRecord(scene?.parent_id ?? null),
          episode = readRecord(script?.parent_id ?? null);
        const records = [shot, scene, script, episode];
        if (
          records.some(
            (record, index) =>
              !record ||
              record.kind !==
                ["shots", "scenes", "scripts", "episodes"][index] ||
              record.project_id !== projectId,
          )
        )
          throw new Error("Actual record chain unavailable");
        const rows = tx.all<FormalRow>(
          `SELECT r.id,r.project_id,r.episode_key,r.operation,r.value_json,h.result_id AS current_head,r.workflow_id,a.result_json AS adoption_result_json
         FROM production_episode_results r
         LEFT JOIN production_creation_adoptions a ON a.workflow_id=r.workflow_id
         LEFT JOIN production_episode_result_heads h ON h.project_id=r.project_id AND h.episode_key=r.episode_key AND h.operation=r.operation
         WHERE r.project_id=? AND r.operation='storyboard-package' AND (EXISTS(
           SELECT 1 FROM json_each(r.value_json,'$.productionRecords') b
           WHERE json_extract(b.value,'$.kind')='shots' AND json_extract(b.value,'$.id')=?
         ) OR EXISTS(
           SELECT 1 FROM json_each(r.value_json,'$.recordBaselines') b
           WHERE json_extract(b.value,'$.kind')='shots' AND json_extract(b.value,'$.id')=?
         ) OR (json_extract(r.value_json,'$.episodeRecordId')=? AND json_extract(r.value_json,'$.scriptId')=?) OR (json_extract(a.result_json,'$.episodeResultId')=r.id AND json_extract(a.result_json,'$.scriptId')=?))
         ORDER BY r.id LIMIT 1001`,
          projectId,
          shotRecordId,
          shotRecordId,
          episode!.id,
          script!.id,
          script!.id,
        );
        if (rows.length > 1000)
          throw new Error("Actual formal history exceeds observation bound");
        return { records, rows };
      });
    try {
      const captured = capture();
      const [shot, scene, script, episode] = captured.records as [
        Row,
        Row,
        Row,
        Row,
      ];
      if (captured.records.some((row) => row?.retired_result_id))
        return { state: "stale", reasonCode: "actual-record-retired" };
      // Only a complete, truly manual record chain with no known formal history
      // is unbound. Corrupt formal membership is not a manual-source fallback.
      if (!captured.rows.length) return { state: "unbound" };
      const heads = captured.rows.filter((row) => row.id === row.current_head);
      if (!heads.length)
        return { state: "stale", reasonCode: "not-in-current-formal" };
      if (heads.length !== 1) return unavailable();
      const row = heads[0]!;
      const stored = JSON.parse(row.value_json) as Stored;
      // The same-owner adoption receipt is an independent history anchor, not
      // permission to treat damaged formal membership as a valid source.
      if (row.adoption_result_json != null) {
        const receipt = JSON.parse(row.adoption_result_json);
        if (
          receipt.episodeResultId !== row.id ||
          receipt.scriptId !== script.id
        )
          return unavailable();
      }
      if (
        stored.id !== row.id ||
        stored.projectId !== row.project_id ||
        stored.episodeId !== row.episode_key ||
        stored.operation !== row.operation
      )
        return unavailable();
      // Peer owner reads happen outside the Production capture UOW. Recheck all
      // captured actual bytes, formal history and heads after those reads.
      const formal = decode(stored);
      if (JSON.stringify(capture()) !== JSON.stringify(captured))
        return unavailable();
      if (
        formal.projectId !== projectId ||
        formal.operation !== "storyboard-package" ||
        formal.episodeRecordId !== episode.id ||
        formal.scriptId !== script.id ||
        !formal.productionRecords?.some(
          (binding) => binding.kind === "scenes" && binding.id === scene.id,
        ) ||
        !formal.productionRecords?.some(
          (binding) => binding.kind === "shots" && binding.id === shot.id,
        )
      )
        return unavailable();
      const proof = {
        id: formal.id,
        version: formal.version,
        episodeKey: formal.episodeId,
        episodeRecordId: episode.id,
        sourceState: formal.sourceState,
      };
      if (!formal.isCurrent || formal.sourceState !== "current")
        return {
          state: "stale",
          reasonCode: "formal-source-stale",
          formal: proof,
        };
      if (
        !formal.productionRecords.some(
          (binding) =>
            binding.kind === "shots" &&
            binding.id === shot.id &&
            binding.version === shot.version,
        )
      )
        return {
          state: "stale",
          reasonCode: "actual-shot-version-changed",
          formal: proof,
        };
      return { state: "current", formal: { ...proof, sourceState: "current" } };
    } catch {
      return unavailable();
    }
  };
  const crossOwnerConstraintObservations = (value: Stored) => {
    const items: EpisodeUpstreamConstraint[] = [];
    const basis = value.basis;
    const observe = <T extends { id: string; version: number }>(
      kind: EpisodeUpstreamConstraint["kind"],
      frozen: { id: string; version: number },
      reader: (() => T | undefined) | undefined,
      reference: (value: T) => ReturnType<typeof creationReference>,
    ) => {
      const read = observeConstraintRead(() => {
        if (!reader) throw new Error("Owner unavailable");
        const actual = reader();
        if (
          actual &&
          (kind === "direct-project"
            ? actual.id
            : "projectId" in actual
              ? actual.projectId
              : undefined) !== value.projectId
        )
          throw new Error("Owner identity mismatch");
        if (
          actual &&
          [
            "season-plan",
            "adaptation-diagnosis",
            "adaptation-strategy",
          ].includes(kind) &&
          (!("status" in actual) ||
            actual.status !== "adopted" ||
            !("isCurrent" in actual) ||
            actual.isCurrent !== true)
        )
          throw new Error("Shared adopted head identity unavailable");
        const sourceState: "current" | "stale" | "unverified" =
          actual &&
          "sourceState" in actual &&
          (actual.sourceState === "current" || actual.sourceState === "stale")
            ? actual.sourceState
            : "unverified";
        return actual
          ? {
              reference: reference(actual),
              sourceState,
            }
          : undefined;
      });
      items.push(
        observeEpisodeConstraint({
          basis,
          kind,
          frozen,
          current: read.value?.reference,
          currentSourceState: read.value?.sourceState,
          readState: read.readState,
        }),
      );
    };
    if (basis.request.direct) {
      const service = optionalService(context, WORKSPACE_PROJECT_SERVICE);
      observe(
        "direct-project",
        basis.request.direct.project,
        service ? () => service.get(value.projectId) : undefined,
        (actual) =>
          creationReference("project", {
            id: actual.id,
            version: actual.version,
            projectId: actual.id,
            title: "作者保存的直写简报（不是季纲）",
            content: {
              synopsis: actual.synopsis,
              productionBrief: actual.productionBrief,
              entryPath:
                actual.modeConfig.mode === "single_season"
                  ? actual.modeConfig.entryPath
                  : actual.modeConfig.mode,
            },
          }),
      );
    } else {
      const plans = optionalService(context, PRODUCTION_SEASON_PLAN_SERVICE);
      observe(
        "season-plan",
        basis.request.seasonPlan!,
        plans ? () => plans.current(value.projectId) : undefined,
        (actual) =>
          creationReference("season-plan", {
            id: actual.id,
            version: actual.version,
            projectId: actual.projectId,
            title: "已采用整季分集方案",
            content: actual.content,
          }),
      );
      const diagnoses = optionalService(context, PRODUCTION_DIAGNOSIS_SERVICE);
      observe(
        "adaptation-diagnosis",
        basis.diagnosis!,
        diagnoses ? () => diagnoses.current(value.projectId) : undefined,
        (actual) => {
          if (basis.strategy) return strategyDiagnosisReference(actual);
          const { strategies, ...narrative } = actual.content;
          return creationReference("adaptation-diagnosis", {
            id: actual.id,
            version: actual.version,
            projectId: actual.projectId,
            title: "已采用改编诊断与唯一策略",
            content: {
              ...narrative,
              strategy: strategies.find(
                (item) => item.id === actual.selectedStrategyId,
              )!,
            },
          });
        },
      );
      if (basis.strategy) {
        const strategies = optionalService(
          context,
          PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
        );
        observe(
          "adaptation-strategy",
          basis.strategy,
          strategies ? () => strategies.current(value.projectId) : undefined,
          selectedAdaptationStrategyReference,
        );
      }
    }
    const intents = optionalService(context, WORKSPACE_AUTHOR_INTENT_SERVICE);
    observe(
      "author-intent",
      basis.authorIntent,
      intents ? () => intents.current(value.projectId) : undefined,
      (actual) => creationAuthorIntent(value.projectId, actual).references[0]!,
    );
    const knowledge = optionalService(context, CREATION_KNOWLEDGE_SERVICE);
    const approved = observeConstraintRead(
      knowledge?.approvedStoryBible
        ? () => {
            const references = knowledge.approvedStoryBible!(value.projectId);
            if (
              references.some(
                (item) =>
                  item.sourceKind !== "knowledge" ||
                  (item.value as { projectId?: unknown }).projectId !==
                    value.projectId ||
                  (item.value as { kind?: unknown }).kind !== "story-bible",
              ) ||
              new Set(references.map((item) => item.sourceId)).size !==
                references.length
            )
              throw new Error("Approved collection identity mismatch");
            return references;
          }
        : undefined,
    );
    const frozenBible = episodeBibleReferences(basis);
    const currentBible = approved.value ?? [];
    for (const id of new Set([
      ...frozenBible.map((item) => item.sourceId),
      ...currentBible.map((item) => item.sourceId),
    ])) {
      const oldPosition = frozenBible.findIndex((item) => item.sourceId === id);
      const position = currentBible.findIndex((item) => item.sourceId === id);
      const original = frozenBible[oldPosition];
      items.push(
        observeEpisodeConstraint({
          basis,
          kind: "story-bible",
          frozen: original
            ? { id: original.sourceId, version: original.sourceVersion }
            : null,
          current: currentBible[position],
          readState: approved.readState,
          ...(original ? { frozenPosition: oldPosition } : {}),
          ...(position >= 0 ? { currentPosition: position } : {}),
        }),
      );
    }
    return {
      items,
      approvedStoryBible: {
        frozenCount: frozenBible.length,
        currentCount:
          approved.readState === "available" ? currentBible.length : null,
        readState: approved.readState,
      },
    };
  };
  const impact = (
    id: string,
    attribution?: StoryboardAttributionImpactSelection,
  ) => {
    const value = context.uow.execute((tx) => read(tx, id));
    if (!value) throw new EpisodeError(404, "单集正式结果不存在。");
    if (value.content.kind !== "storyboard-package")
      fail("当前影响清单只核对已采用分镜包；不会为其他结果补造镜头映射。");
    const storyboard = value.content.value;
    let attributionImpact: StoryboardAttributionImpact | undefined;
    if (attribution) {
      try {
        attributionImpact = attributionImpactReader(
          value.projectId,
          { id: value.id, version: value.version, episodeId: value.episodeId },
          attribution,
        );
      } catch (error) {
        if (error instanceof AttributionImpactError)
          throw new EpisodeError(error.status, error.message);
        throw new EpisodeError(
          503,
          "指定原关联本次读取未核全；不使用缓存或最新关联。",
        );
      }
    }
    // Cross-owner readers own transactions; do not nest them in ours. No await
    // separates these reads. Only our actual AST/record capture is atomic; this
    // read-only report is never commit authority or a semantic safety claim.
    const staleReasons = sourceReasons(value);
    const crossOwnerConstraints = crossOwnerConstraintObservations(value);
    if (
      crossOwnerConstraints.items.some(
        (item) => item.readState === "unavailable",
      ) ||
      crossOwnerConstraints.approvedStoryBible.readState === "unavailable"
    )
      staleReasons.push("上游正式约束读取未核全，仍须全包复核。");
    // Read-only provenance is distinct from author review. Verify the actual
    // human parent path, current source eligibility and ALL original snapshots
    // before allowing known source changes to have a mechanical observation.
    // A model replacement/provenance branch is not an in-place confirmation.
    let transition:
      | {
          script: Stored;
          outline: Stored;
          observation: NonNullable<
            import("@dramaip/contracts/production").EpisodeDevelopmentImpact["confirmedSourceTransition"]
          >;
        }
      | undefined;
    const newScript = current(
      value.projectId,
      value.episodeId,
      "episode-script",
    );
    if (
      newScript &&
      newScript.id !== value.basis.request.script?.id &&
      [
        "human-script-revision",
        "human-topology-revision",
        "human-source-revision",
      ].includes(newScript.origin ?? "model")
    ) {
      try {
        const inspected = context.uow.execute((tx) =>
          inspectReviewedRedoPath(tx, value, newScript),
        );
        const newOutline = current(
          value.projectId,
          value.episodeId,
          "episode-outline",
        );
        if (
          inspected.path.sourceSteps &&
          newOutline &&
          newScript.basis.request.outline?.id === newOutline.id &&
          newScript.basis.request.outline.version === newOutline.version &&
          !sourceReasons(newScript).length &&
          !sourceReasons(newOutline).length
        ) {
          reviewedRedoDependencies(value, newScript);
          const ids = new Set(
            inspected.path.confirmedRefs.map((ref) => ref.sourceId),
          );
          const previews = inspected.ancestry.pairs.flatMap((pair) =>
            pair.script.id !== inspected.path.old.id &&
            ids.has(pair.script.id) &&
            pair.script.sourceRevision
              ? [{ id: pair.script.sourceRevision.previewId, version: 1 }]
              : [],
          );
          transition = {
            script: newScript,
            outline: newOutline,
            observation: EpisodeConfirmedSourceTransitionSchema.parse({
              format: "verified-formal-source-transition-v1",
              originalOutline: {
                id: inspected.path.oldOutline.id,
                version: inspected.path.oldOutline.version,
              },
              originalScript: {
                id: inspected.path.old.id,
                version: inspected.path.old.version,
              },
              currentOutline: {
                id: newOutline.id,
                version: newOutline.version,
              },
              currentScript: { id: newScript.id, version: newScript.version },
              document: {
                id: inspected.document.id,
                scriptId: inspected.document.scriptId,
                version: inspected.document.version,
                contentHash: hash(inspected.document.blocks),
              },
              confirmationPreviews: previews,
              completeAuthorReviewRequired: true,
              semanticVerification: "unverified",
            }),
          };
        }
      } catch (error) {
        if (!(error instanceof EpisodeError) || error.status !== 409)
          throw error;
        // A failed proof remains unknown. Never manufacture a transition from
        // a changed head, author statement or a partly readable graph.
      }
    }
    return context.uow.execute((tx) => {
      const constraintItems = [...crossOwnerConstraints.items];
      for (const operation of ["episode-outline", "episode-script"] as const) {
        const reference =
          operation === "episode-outline"
            ? value.basis.request.outline
            : value.basis.request.script;
        if (!reference) continue;
        const headId = head(tx, value.projectId, value.episodeId, operation);
        const actual = headId ? read(tx, headId) : undefined;
        const valid =
          !actual ||
          (actual.projectId === value.projectId &&
            actual.episodeId === value.episodeId &&
            actual.operation === operation);
        constraintItems.push(
          observeEpisodeConstraint({
            basis: value.basis,
            kind: operation,
            frozen: reference,
            current: valid && actual ? resultReference(actual) : undefined,
            readState: valid ? "available" : "unavailable",
          }),
        );
      }
      const direct = value.basis.request.direct;
      if (direct) {
        const episode = tx.get<{
          id: string;
          version: number;
          title: string;
          parent_id: string | null;
          order_index: number;
        }>(
          "SELECT id, version, title, parent_id, order_index FROM production_records WHERE id = ? AND project_id = ? AND kind = 'episodes'",
          direct.episode.id,
          value.projectId,
        );
        constraintItems.push(
          observeEpisodeConstraint({
            basis: value.basis,
            kind: "direct-episode",
            frozen: direct.episode,
            current: episode
              ? creationReference("episode-directory", {
                  id: episode.id,
                  version: episode.version,
                  projectId: value.projectId,
                  title: episode.title,
                  parentId: episode.parent_id,
                  orderIndex: episode.order_index,
                })
              : undefined,
            readState: "available",
          }),
        );
        if (direct.sourceScript) {
          const original = tx.get<{
            id: string;
            version: number;
            title: string;
            payload_json: string;
            parent_id: string | null;
          }>(
            "SELECT id, version, title, payload_json, parent_id FROM production_records WHERE id = ? AND project_id = ? AND kind = 'scripts'",
            direct.sourceScript.id,
            value.projectId,
          );
          const saved = tx.get<DirectScriptSourceDocument>(
            "SELECT version, blocks_json, source_format, loss_report_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
            direct.sourceScript.id,
            value.projectId,
          );
          const observed = observeConstraintRead(() => {
            if (!original) return undefined;
            const payload = JSON.parse(original.payload_json);
            if (
              original.parent_id !== direct.episode.id ||
              payload.episodeResultId
            )
              throw new Error("Direct source identity mismatch");
            const expression = directScriptSourceContent(
              payload["剧本内容"],
              saved,
            );
            if (!expression)
              throw new Error("Direct source expression unavailable");
            const { content, blocks, ...representation } = expression;
            return creationReference("source-script", {
              id: original.id,
              version: original.version,
              projectId: value.projectId,
              title: original.title,
              content,
              documentVersion: saved?.version ?? null,
              ...(blocks ? { blocks } : {}),
              ...representation,
            });
          });
          constraintItems.push(
            observeEpisodeConstraint({
              basis: value.basis,
              kind: "direct-source-script",
              frozen: direct.sourceScript,
              current: observed.value,
              readState: observed.readState,
              frozenDocumentVersion: direct.sourceScript.documentVersion,
              currentDocumentVersion: saved?.version ?? null,
            }),
          );
        }
      }
      if (constraintItems.length > 5000)
        fail("正式约束集合超过本清单的完整核对范围；不截断或补造已核全清单。");
      if (
        constraintItems.some((item) => item.readState === "unavailable") &&
        !staleReasons.includes("上游正式约束读取未核全，仍须全包复核。")
      )
        staleReasons.push("上游正式约束读取未核全，仍须全包复核。");
      const upstreamConstraints: EpisodeUpstreamConstraints = {
        format: "formal-constraint-observations-v1",
        items: constraintItems,
        approvedStoryBible: crossOwnerConstraints.approvedStoryBible,
      };
      const isCurrent =
        head(tx, value.projectId, value.episodeId, value.operation) ===
        value.id;
      // These two checks can be localized against actual AST/record versions.
      // Every other upstream uncertainty keeps a whole-package review gate.
      const localized = new Set([
        "标准剧本已人工修改或不存在，保留原采用快照",
        "已采用场景或分镜已人工修改或删除，保留原分镜快照",
      ]);
      const globalReviewReasons = staleReasons.filter(
        (reason) => !localized.has(reason),
      );
      const knownAttributionChanges: string[] = [];
      if (
        attributionImpact &&
        (!attributionImpact.isCurrent ||
          attributionImpact.links.some(
            (link) => link.associationImpact !== "no-observed-change",
          ))
      ) {
        const known =
          attributionImpact.isCurrent &&
          attributionImpact.links.every(
            (link) => link.associationImpact !== "unresolved",
          );
        const reason = known
          ? "指定原人工关联有已观察变化；保留原关联并完整明确复核，受影响镜头须明确重做，不自动换源。"
          : "指定原人工关联有未知或非当前采用；保留原关联，不推定局部范围或自动换源。";
        globalReviewReasons.push(reason);
        // A readable deletion is an observed change, not an owner outage.
        // Only the complete verified source transition below may localize it;
        // the exact association still forces affected-shot redo in the review.
        if (known) knownAttributionChanges.push(reason);
      }
      if (!isCurrent)
        globalReviewReasons.push(
          "这不是当前采用分镜包；历史关联不能自动用于当前局部重做。",
        );
      const scriptRef = value.basis.request.script;
      const script = scriptRef ? read(tx, scriptRef.id) : undefined;
      const validScript =
        script?.content.kind === "episode-script" &&
        script.projectId === value.projectId &&
        script.episodeId === value.episodeId &&
        script.version === scriptRef?.version &&
        script.scriptId === value.scriptId &&
        script.scriptDocumentVersion === value.scriptDocumentVersion;
      if (!validScript)
        globalReviewReasons.push(
          "冻结正式剧本身份、版本或实际文档绑定未核全。",
        );
      const document = value.scriptId
        ? tx.get<{ version: number; blocks_json: string }>(
            "SELECT version, blocks_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
            value.scriptId,
            value.projectId,
          )
        : undefined;
      const records: ImpactRecord[] = (value.productionRecords ?? []).flatMap(
        (binding) => {
          const row = tx.get<{
            id: string;
            kind: string;
            version: number;
            parent_id: string | null;
            payload_json: string;
          }>(
            "SELECT id, kind, version, parent_id, payload_json FROM production_records WHERE id = ? AND project_id = ? AND kind = ?",
            binding.id,
            value.projectId,
            binding.kind,
          );
          return row
            ? [
                {
                  id: row.id,
                  kind: row.kind,
                  version: row.version,
                  parentId: row.parent_id,
                  stableId: (
                    JSON.parse(row.payload_json) as Record<string, unknown>
                  ).stableId,
                },
              ]
            : [];
        },
      );
      const comparison = inspectEpisodeImpact({
        frozenScript:
          validScript && script?.content.kind === "episode-script"
            ? script.content.value
            : undefined,
        currentBlocks: document ? JSON.parse(document.blocks_json) : undefined,
        storyboard,
        bindings: value.productionRecords ?? [],
        records,
        scriptId: value.scriptId,
        globalReviewReasons,
        ...(transition &&
        isCurrent &&
        head(tx, value.projectId, value.episodeId, "episode-script") ===
          transition.script.id &&
        head(tx, value.projectId, value.episodeId, "episode-outline") ===
          transition.outline.id &&
        value.recordBaselines &&
        recordBaselineObservations(tx, value).records.every(
          (item) => item.state === "unchanged",
        ) &&
        constraintItems.every(
          (item) => item.readState === "available" && item.current !== null,
        ) &&
        crossOwnerConstraints.approvedStoryBible.readState === "available"
          ? {
              confirmedSourceReviewReasons: [
                ...staleReasons,
                ...knownAttributionChanges,
              ],
              ...(transition.script.content.kind === "episode-script"
                ? { confirmedCurrentScript: transition.script.content.value }
                : {}),
            }
          : {}),
      });
      const report = {
        result: { id: value.id, version: value.version },
        projectId: value.projectId,
        episodeId: value.episodeId,
        isCurrent,
        sourceState: staleReasons.length
          ? ("stale" as const)
          : ("current" as const),
        staleReasons,
        upstreamConstraints,
        recordBaselines: recordBaselineObservations(tx, value),
        ...(attributionImpact ? { attributionImpact } : {}),
        ...(transition
          ? { confirmedSourceTransition: transition.observation }
          : {}),
        script: {
          id: value.scriptId ?? null,
          result: scriptRef ?? null,
          frozenDocumentVersion: value.scriptDocumentVersion ?? null,
          currentDocumentVersion: document?.version ?? null,
        },
        ...comparison,
        comparison:
          "frozen-script-to-actual-document-and-record-versions-v1" as const,
        semanticVerification: "unverified" as const,
        automaticRedo: false as const,
      };
      return EpisodeDevelopmentImpactSchema.parse({
        ...report,
        snapshotHash: hash(report),
      });
    });
  };
  const catalog = (projectId: string) => {
    const value = project(projectId);
    const direct =
      value.modeConfig.mode === "single_season" &&
      ["inspiration", "script"].includes(value.modeConfig.entryPath);
    const recordService = optionalService(context, PRODUCTION_RECORD_SERVICE);
    const intent = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    )?.current(projectId);
    const plan = optionalService(
      context,
      PRODUCTION_SEASON_PLAN_SERVICE,
    )?.current(projectId);
    const rows = context.uow.execute((tx) =>
      tx.all<{ value_json: string }>(
        "SELECT r.value_json FROM production_episode_results r JOIN production_episode_result_heads h ON h.result_id = r.id WHERE r.project_id = ? ORDER BY r.episode_key, r.operation",
        projectId,
      ),
    );
    return {
      projectId,
      seasonPlan:
        plan?.status === "adopted" && plan.sourceState === "current"
          ? { id: plan.id, version: plan.version }
          : undefined,
      ...(plan?.status === "adopted" && plan.sourceState === "current"
        ? { narrativeSourceScope: plan.basis.chapters }
        : {}),
      ...(plan?.status === "adopted" &&
      plan.sourceState === "current" &&
      plan.basis.sourceBasis
        ? {
            narrativeSources: {
              basis: plan.basis.sourceBasis,
              chapters: plan.basis.chapters,
            },
          }
        : {}),
      episodes: plan?.content.episodes ?? [],
      storyBibleCount: bible(projectId).length,
      currentResults: rows.map((row) =>
        decode(JSON.parse(row.value_json) as Stored),
      ),
      ...(direct
        ? {
            direct: {
              entryPath:
                value.modeConfig.mode === "single_season"
                  ? value.modeConfig.entryPath
                  : "inspiration",
              project: { id: value.id, version: value.version },
              authorIntent:
                intent?.sourceState === "current"
                  ? { id: intent.id, version: intent.version }
                  : undefined,
              episodes: (recordService?.list("episodes", { projectId }) ?? [])
                .filter(
                  (episode) => episode.parentId === value.currentAdaptationId,
                )
                .map((episode) => ({
                  id: episode.id,
                  version: episode.version,
                  title: episode.title,
                  orderIndex: episode.orderIndex,
                  scripts: (recordService?.list("scripts", { projectId }) ?? [])
                    .filter(
                      (script) =>
                        script.parentId === episode.id &&
                        !script.payload["episodeResultId"],
                    )
                    .flatMap((script) => {
                      const document = context.uow.execute((tx) =>
                        tx.get<DirectScriptSourceDocument>(
                          "SELECT version, blocks_json, source_format, loss_report_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
                          script.id,
                          projectId,
                        ),
                      );
                      return directScriptSourceContent(
                        script.payload["剧本内容"],
                        document,
                      )
                        ? [
                            {
                              id: script.id,
                              version: script.version,
                              title: script.title,
                              documentVersion: document?.version ?? null,
                            },
                          ]
                        : [];
                    }),
                }))
                .sort(
                  (a, b) =>
                    a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
                ),
            },
          }
        : {}),
    };
  };
  const adaptationSources = (
    input: Pick<CreationInput, "projectId">,
    request: EpisodeDevelopmentRequest,
  ) => {
    const plan = optionalService(
      context,
      PRODUCTION_SEASON_PLAN_SERVICE,
    )?.current(input.projectId);
    if (
      !plan ||
      plan.status !== "adopted" ||
      plan.sourceState !== "current" ||
      plan.id !== request.seasonPlan?.id ||
      plan.version !== request.seasonPlan?.version
    )
      fail("当前季纲或来源已变化，请重新确认。");
    const episode = plan.content.episodes.find(
      (item) => item.id === request.episodeId,
    );
    if (!episode) fail("分集标识不属于当前季纲。");
    const intent = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    )?.current(input.projectId);
    if (
      !intent ||
      intent.id !== plan.basis.authorIntent.id ||
      intent.version !== plan.basis.authorIntent.version
    )
      fail("季纲引用的正式作者意图已变化。");
    const officialIntent = creationAuthorIntent(input.projectId, intent);
    const diagnosis = optionalService(
      context,
      PRODUCTION_DIAGNOSIS_SERVICE,
    )?.current(input.projectId);
    if (
      !diagnosis ||
      diagnosis.id !== plan.basis.diagnosis.id ||
      diagnosis.version !== plan.basis.diagnosis.version ||
      (!plan.basis.strategy &&
        diagnosis.selectedStrategyId !== plan.basis.diagnosis.strategyId) ||
      diagnosis.sourceState !== "current"
    )
      fail("季纲引用的诊断与唯一策略已变化。");
    const { strategies, ...narrative } = diagnosis.content;
    const independent = plan.basis.strategy
      ? optionalService(
          context,
          PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
        )?.current(input.projectId)
      : undefined;
    if (
      plan.basis.strategy &&
      (!independent ||
        independent.id !== plan.basis.strategy.id ||
        independent.version !== plan.basis.strategy.version ||
        independent.selectedOptionId !== plan.basis.strategy.optionId ||
        independent.sourceState !== "current" ||
        !independent.isCurrent ||
        independent.status !== "adopted")
    )
      fail("季纲引用的独立策略已变化，不能改用旧诊断内选项。");
    const references = [
      ...officialIntent.references,
      ...(independent
        ? [
            strategyDiagnosisReference(diagnosis),
            selectedAdaptationStrategyReference(independent),
          ]
        : [
            creationReference("adaptation-diagnosis", {
              id: diagnosis.id,
              version: diagnosis.version,
              projectId: input.projectId,
              title: "已采用改编诊断与唯一策略",
              content: {
                ...narrative,
                strategy: strategies.find(
                  (item) => item.id === diagnosis.selectedStrategyId,
                )!,
              },
            }),
          ]),
      // Coverage directory/basis are local only. The adopted narrative plan is
      // a separate policy-controlled source, never embedded in the raw Prompt.
      creationReference("season-plan", {
        id: plan.id,
        version: plan.version,
        projectId: input.projectId,
        title: "已采用整季分集方案",
        content: plan.content,
      }),
    ];
    const chapters = episode.sourceChapters.map((source) => {
      const value = optionalService(context, WRITING_CHAPTER_SERVICE)?.get(
        source.id,
      );
      const meta = plan.basis.chapters.find((item) => item.id === source.id);
      if (
        !value ||
        !meta ||
        value.projectId !== input.projectId ||
        value.version !== source.version ||
        bodyHash(value.content) !== meta.contentHash
      )
        fail("本集实际原文与季纲版本不符。");
      if (!plan.basis.sourceBasis && !request.episodeNarrativeContext)
        references.push(
          creationReference("chapter", {
            id: value.id,
            version: value.version,
            title: value.title,
            orderIndex: value.orderIndex,
            content: value.content,
          }),
        );
      return meta;
    });
    if (
      !request.episodeNarrativeContext &&
      Boolean(plan.basis.sourceBasis) !==
        Boolean(request.inheritSeasonNarrative)
    )
      fail(
        "须明确确认是否完整继承整季已确认的实际表达；不会默认补读整章或截取跨集摘要。",
      );
    const compiler = optionalService(context, WRITING_NARRATIVE_SOURCE_SERVICE);
    const compileNarrative = (
      selection: NonNullable<
        EpisodeDevelopmentRequest["episodeNarrativeContext"]
      >,
    ) => {
      if (!compiler) fail("明确叙事来源服务未启用。");
      try {
        return compiler.compile(
          input.projectId,
          plan.basis.chapters.map(({ id, version }) => ({ id, version })),
          selection,
        );
      } catch {
        fail("所确认实际表达不可用、版本或完整范围不符；不补原文或最新摘要。");
      }
    };
    // Original plan inputs remain privacy dependencies even when the episode
    // chooses a different representation. Only the selected episode values go
    // into its Prompt; the plan/diagnosis themselves remain formal constraints.
    const inherited = plan.basis.sourceBasis
      ? compileNarrative(narrativeSourceSelection(plan.basis.sourceBasis))
      : undefined;
    if (
      inherited &&
      narrativeSourceIdentity(inherited.basis) !==
        narrativeSourceIdentity(plan.basis.sourceBasis!)
    )
      fail("整季已确认的实际表达已变化，不能另选来源绕过正式季纲。");
    const selected = request.episodeNarrativeContext
      ? compileNarrative(request.episodeNarrativeContext)
      : inherited;
    let contextChapters: typeof plan.basis.chapters | undefined;
    if (selected) {
      const covered = new Map([
        ...selected.basis.chapters.map(
          (item) => [item.id, item.version] as const,
        ),
        ...(selected.basis.summaries ?? []).flatMap((item) =>
          item.chapters.map(
            (chapter) => [chapter.id, chapter.version] as const,
          ),
        ),
      ]);
      contextChapters = plan.basis.chapters.filter((item) =>
        covered.has(item.id),
      );
      if (
        !contextChapters.length ||
        covered.size !== contextChapters.length ||
        chapters.some((item) => covered.get(item.id) !== item.version)
      )
        fail(
          "本集独立表达须完整覆盖正式季纲的本集映射，不以其他章节或部分摘要替代。",
        );
      const dependencies = [
        ...new Map(
          [...(inherited?.references ?? []), ...selected.references]
            .flatMap((source) => [
              {
                sourceId: source.sourceId,
                sourceVersion: source.sourceVersion,
                fieldPath: source.fieldPath,
              },
              ...(source.policyDependencies ?? []),
            ])
            .concat(
              request.episodeNarrativeContext
                ? [
                    ...plan.basis.chapters.map((item) => ({
                      sourceId: item.id,
                      sourceVersion: item.version,
                      fieldPath: `/chapters/${item.id}`,
                    })),
                    ...(diagnosis.basis.sourceBasis?.references ?? []).map(
                      ({ sourceId, sourceVersion, fieldPath }) => ({
                        sourceId,
                        sourceVersion,
                        fieldPath,
                      }),
                    ),
                  ]
                : [],
            )
            .map((source) => [
              `${source.sourceId}:${source.sourceVersion}:${source.fieldPath}`,
              source,
            ]),
        ).values(),
      ];
      for (const reference of references)
        if (reference.sourceKind === "production")
          reference.policyDependencies = [
            ...(reference.policyDependencies ?? []),
            ...dependencies,
          ];
      references.push(...selected.references);
    }
    return {
      episode,
      chapters,
      references,
      officialIntent,
      authorIntent: plan.basis.authorIntent,
      diagnosis: plan.basis.diagnosis,
      strategy: plan.basis.strategy,
      ...(selected
        ? {
            sourceBasis: selected.basis,
            contextChapters,
          }
        : {}),
    };
  };
  const inspectReviewedRedoPath = (
    tx: UnitOfWorkTransaction,
    base: Stored,
    script: Stored,
    review?: StoryboardSourceReviewReceipt,
  ) => {
    const outlineRef = script.basis.request.outline,
      outline = outlineRef && read(tx, outlineRef.id);
    if (!outline || outline.version !== outlineRef?.version)
      fail("新来源的实际双正式大纲不可核对。");
    const raw = <T>(
      table:
        | "production_episode_script_revisions"
        | "production_episode_topology_revisions"
        | "production_episode_source_revisions",
      id: string,
    ): T | undefined => {
      const row = tx.get<{ value_json: string }>(
        `SELECT value_json FROM ${table} WHERE id = ?`,
        id,
      );
      return row ? (JSON.parse(row.value_json) as T) : undefined;
    };
    try {
      const ancestry = inspectEpisodeFormalAncestry({
        script,
        outline,
        read: (id) => read(tx, id),
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
        readSourceRevision: (id) =>
          raw<Omit<EpisodeSourceRevision, "sourceState" | "staleReasons">>(
            "production_episode_source_revisions",
            id,
          ),
        formalReference: (value) => frozenRef(resultReference(value)),
      });
      const document = tx.get<{
        id: string;
        version: number;
        blocks_json: string;
      }>(
        "SELECT id,version,blocks_json FROM screenplay_documents WHERE script_record_id=? AND project_id=?",
        script.scriptId,
        script.projectId,
      );
      if (!document) fail("新正式来源的同一实际保存稿件不可核对。");
      const pathInput = {
        base,
        script,
        outline,
        ancestry,
        document: {
          id: document.id,
          scriptId: script.scriptId!,
          version: document.version,
          blocks: JSON.parse(document.blocks_json),
        },
      };
      const path = review
        ? inspectReviewedStoryboardSourceAncestry({ ...pathInput, review })
        : inspectStoryboardSourceAncestry(pathInput);
      return { ancestry, path, document: pathInput.document };
    } catch (error) {
      if (error instanceof EpisodeError) throw error;
      if (
        error instanceof EpisodeFormalAncestryError ||
        error instanceof StoryboardSourceAncestryError
      )
        fail("实际正式祖先、原采用记录或原分镜父链未核全，不自动换来源。");
      throw new EpisodeError(
        503,
        "实际正式祖先读取暂不可用，不回退旧稿或替代来源。",
      );
    }
  };
  const reviewedRedoDependencies = (
    base: Stored,
    script: Stored,
    review?: StoryboardSourceReviewReceipt,
    options: { sourceConfirmedOnly?: boolean } = {},
  ) => {
    const captured = context.uow.execute((tx) => {
      const inspected = inspectReviewedRedoPath(tx, base, script, review);
      if (
        options.sourceConfirmedOnly &&
        !inspected.ancestry.sourcePreviews.length
      )
        return undefined;
      const boards: Stored[] = [],
        seen = new Set<string>();
      let board = base;
      while (true) {
        if (seen.has(board.id) || seen.size >= 1000)
          fail("实际原分镜上下文祖先循环或超限。");
        seen.add(board.id);
        boards.push(board);
        const receipt = board.basis.storyboardRedo;
        if (!receipt) break;
        const parent = read(tx, receipt.base.id);
        if (
          !parent ||
          parent.version !== receipt.base.version ||
          parent.version >= board.version ||
          parent.projectId !== base.projectId ||
          parent.episodeId !== base.episodeId ||
          parent.content.kind !== "storyboard-package" ||
          parent.scriptId !== base.scriptId ||
          hash(parent.content.value) !== receipt.baseContentHash ||
          board.basis.request.baseStoryboardId !== parent.id ||
          hash(board.storyboardRedo ?? null) !== hash(receipt)
        )
          fail("实际原分镜快照或上下文父版本不符，不补造历史。");
        board = parent;
      }
      const records = [
        ...new Set(
          inspected.ancestry.branches.map((branch) => branch.scriptId),
        ),
      ].map((id) => {
        const row = tx.get<{ id: string; version: number }>(
          "SELECT id,version FROM production_records WHERE id=? AND project_id=? AND kind='scripts' AND retired_at IS NULL",
          id,
          base.projectId,
        );
        if (!row) fail("完整正式祖先的实际脚本禁止依赖不可核对。");
        return {
          sourceId: row.id,
          sourceVersion: row.version,
          fieldPath: `/production/${row.id}`,
        };
      });
      return { ...inspected, boards, records };
    });
    if (!captured) return [];
    const service = optionalService(context, AGENT_CONTEXT_SERVICE);
    if (!service)
      throw new EpisodeError(
        503,
        "完整原上下文读取暂不可用，不省略祖先禁止依赖。",
      );
    try {
      // This peer read stays outside every Production UOW. Include the actual
      // original board snapshots too, including preceding local-redo contexts.
      const dependencies = [
        ...new Map(
          [
            ...episodeAncestryPolicyDependencies(
              captured.ancestry,
              (id) => service.getSnapshot(id),
              captured.boards,
            ),
            ...captured.records,
          ].map((value) => [JSON.stringify(value), value]),
        ).values(),
      ];
      if (captured.ancestry.sourcePreviews.length) {
        if (dependencies.length > 2000)
          fail("完整原来源禁止链超出上限，不省略祖先依赖。");
        if (!service.previewCreation)
          throw new EpisodeError(503, "当前原来源禁止链暂不可核对。");
        // This metadata-only read is also used at commit/field comparison;
        // rebuilding references alone does not re-evaluate current policy.
        const checked = service.previewCreation(
          {
            projectId: base.projectId,
            runIntent: "author-manuscript-confirmation",
            basePrompt: "Verify original source policy; no content generation.",
            tokenBudget: 1024,
            destination: {
              kind: "local",
              provider: "author-manuscript-review",
            },
            temporaryOverrides: [],
          },
          [
            {
              sourceKind: "production",
              sourceId: base.id,
              sourceVersion: base.version,
              fieldPath: `/production/${base.id}`,
              value: { id: base.id, version: base.version },
              sensitivity: "project",
              policyDependencies: dependencies,
            },
          ],
        );
        if (
          checked.entries.length !== 1 ||
          checked.entries[0]?.included !== true
        )
          fail("当前原来源禁止链不允许采用或重做，不仅凭旧冻结策略继续。");
      }
      return dependencies;
    } catch (error) {
      if (error instanceof EpisodeError) throw error;
      if (error instanceof EpisodeFormalAncestryError)
        fail("完整原模型／来源／分镜上下文或禁止链不符，不缩小依赖。");
      throw new EpisodeError(503, "完整原上下文读取暂不可用，不返回私人原因。");
    }
  };
  // Shared read-only ancestry verification; it never relaxes actual-record
  // admission in the ordinary prepare/commit path.
  const inspectRedoScript = (
    tx: UnitOfWorkTransaction,
    base: Stored,
    script: Stored,
    mode: EpisodeDevelopmentRequest["redoMode"],
    sourceReview?: StoryboardSourceReviewReceipt,
  ) => {
    const reviewed =
      sourceReview &&
      inspectReviewedRedoPath(tx, base, script, sourceReview).path;
    if (reviewed?.sourceSteps) {
      if (reviewed.old.content.kind !== "episode-script")
        fail("实际原剧本类型不符。");
      const oldContent = reviewed.old.content.value;
      if (
        !mode &&
        reviewed.confirmedAncestors.some(
          (content) => hash(content.sceneLinks) !== hash(oldContent.sceneLinks),
        )
      )
        fail("固定映射来源重做不能隐式改块或场景结构，须选择对应明确协议。");
      let sceneMappings: StoryboardBlockStructureMapping[] | undefined;
      if (mode) {
        try {
          sceneMappings = confirmedStoryboardBlockMappings(
            oldContent,
            reviewed.confirmedAncestors,
            { allowUnchanged: mode === "scene-shot-plan" },
          );
        } catch {
          fail("新来源人工确认链的原／新场内块映射不符。");
        }
      }
      return {
        old: reviewed.old,
        sceneMappings,
        confirmedRefs: reviewed.confirmedRefs,
      };
    }
    const previous = base.basis.request.script;
    if (!previous) fail("冻结分镜缺少正式剧本来源。");
    const old = read(tx, previous.id);
    if (
      !old ||
      old.content.kind !== "episode-script" ||
      old.version !== previous.version ||
      old.projectId !== base.projectId ||
      old.episodeId !== base.episodeId ||
      old.scriptId !== base.scriptId ||
      old.scriptDocumentVersion !== base.scriptDocumentVersion ||
      (!mode &&
        hash(old.content.value.sceneLinks) !==
          hash(
            script.content.kind === "episode-script"
              ? script.content.value.sceneLinks
              : null,
          ))
    )
      fail(
        "局部重做只接受同一实际剧本的完整稳定场景映射；结构改变须整包复核。",
      );
    let ancestor = script;
    const seen = new Set<string>();
    const confirmedAncestors: EpisodeScriptContent[] = [];
    const confirmedRefs = [
      {
        sourceId: old.id,
        sourceVersion: old.version,
        fieldPath: `/production/${old.id}`,
      },
    ];
    while (ancestor.id !== old.id) {
      if (
        seen.has(ancestor.id) ||
        seen.size >= 1000 ||
        ancestor.origin !== "human-script-revision" ||
        !ancestor.scriptRevision ||
        ancestor.projectId !== base.projectId ||
        ancestor.episodeId !== base.episodeId ||
        ancestor.scriptId !== base.scriptId ||
        ancestor.content.kind !== "episode-script" ||
        (!mode &&
          hash(ancestor.content.value.sceneLinks) !==
            hash(old.content.value.sceneLinks))
      )
        fail("新剧本不是原冻结版本的可核全人工确认链，不能自动换源。");
      seen.add(ancestor.id);
      confirmedRefs.push({
        sourceId: ancestor.id,
        sourceVersion: ancestor.version,
        fieldPath: `/production/${ancestor.id}`,
      });
      confirmedAncestors.push(ancestor.content.value);
      const parent = read(tx, ancestor.scriptRevision.sourceResult.id);
      if (
        !parent ||
        parent.version !== ancestor.scriptRevision.sourceResult.version
      )
        fail("人工确认剧本祖先版本未核全。");
      ancestor = parent;
    }
    let sceneMappings: StoryboardBlockStructureMapping[] | undefined;
    if (mode) {
      try {
        sceneMappings = confirmedStoryboardBlockMappings(
          old.content.value,
          confirmedAncestors.reverse(),
          { allowUnchanged: mode === "scene-shot-plan" },
        );
      } catch (error) {
        fail(error instanceof Error ? error.message : "人工确认块映射未核全。");
      }
    }
    return { old, sceneMappings, confirmedRefs };
  };
  const inspectTopologyAncestry = (
    tx: UnitOfWorkTransaction,
    base: Stored,
    script: Stored,
    sourceReview?: StoryboardSourceReviewReceipt,
  ) => {
    const reviewed =
      sourceReview &&
      inspectReviewedRedoPath(tx, base, script, sourceReview).path;
    if (reviewed?.sourceSteps) return reviewed;
    const outlineRef = script.basis.request.outline,
      outline = outlineRef && read(tx, outlineRef.id);
    if (!outline || outline.version !== outlineRef?.version)
      fail("新双正式大纲不可核对。");
    try {
      return inspectStoryboardTopologyAncestry({
        base,
        script,
        outline,
        read: (id) => read(tx, id),
        readRevision: (id) => {
          const row = tx.get<{ value_json: string }>(
            "SELECT value_json FROM production_episode_topology_revisions WHERE id = ?",
            id,
          );
          return row
            ? (JSON.parse(row.value_json) as Omit<
                EpisodeTopologyRevision,
                "sourceState" | "staleReasons"
              >)
            : undefined;
        },
        readScriptRevision: (id) => {
          const row = tx.get<{ value_json: string }>(
            "SELECT value_json FROM production_episode_script_revisions WHERE id = ?",
            id,
          );
          return row
            ? (JSON.parse(row.value_json) as Omit<
                EpisodeScriptRevision,
                "sourceState" | "staleReasons"
              >)
            : undefined;
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "双正式实际确认链未核全。");
    }
  };
  const freezeTopologyReceipt = (
    tx: UnitOfWorkTransaction,
    base: Stored,
    script: Stored,
    request: EpisodeDevelopmentRequest["redoTopologyPlan"],
    sourceReview?: StoryboardSourceReviewReceipt,
  ) => {
    const confirmed = inspectTopologyAncestry(tx, base, script, sourceReview),
      outline = read(tx, script.basis.request.outline!.id)!;
    if (
      base.content.kind !== "storyboard-package" ||
      script.content.kind !== "episode-script" ||
      outline.content.kind !== "episode-outline" ||
      confirmed.old.content.kind !== "episode-script" ||
      confirmed.oldOutline.content.kind !== "episode-outline"
    )
      fail("双正式场景拓扑类型不可核对。");
    let frozen;
    try {
      frozen = freezeStoryboardTopologyPlan({
        request,
        base: base.content.value,
        bindings: base.productionRecords ?? [],
        previousOutline: confirmed.oldOutline.content.value,
        previousScript: confirmed.old.content.value,
        outline: outline.content.value,
        script: script.content.value,
        reservedSceneIds: reservedStoryboardIds(tx, base.projectId, "scenes"),
        reservedShotIds: reservedStoryboardShotIds(tx, base.projectId),
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "实际场景拓扑计划未核全。");
    }
    return StoryboardTopologyPlanReceiptSchema.parse({
      base: { id: base.id, version: base.version },
      baseContentHash: hash(base.content.value),
      previousScript: base.basis.request.script,
      previousOutline: base.basis.request.outline,
      script: { id: script.id, version: script.version },
      outline: { id: outline.id, version: outline.version },
      shots: frozen.selectedShots,
      selectedScenes: frozen.selectedScenes,
      topologyPlan: frozen.request,
      scope: "author-frozen-scene-topology-plan-v1",
      semanticVerification: "unverified",
      ancestry: confirmed.confirmedRefs,
      topologySteps: confirmed.topologySteps,
      ...(sourceReview ? { sourceReview } : {}),
    });
  };
  const captureSourceReview = (
    base: Stored | undefined,
    request: EpisodeDevelopmentRequest,
  ) => {
    if (!request.redoSourceReview) return undefined;
    if (!base || !request.redoShots)
      fail("来源影响审阅缺少原分镜或完整明确重做选择。");
    try {
      return freezeStoryboardSourceReview(
        request.redoSourceReview,
        impact(base.id, request.redoSourceReview.attribution),
        request.redoShots,
      );
    } catch (error) {
      if (error instanceof EpisodeError) throw error;
      if (error instanceof StoryboardSourceReviewError) fail(error.message);
      throw new EpisodeError(503, "本次原关联与完整影响范围读取暂不可用。");
    }
  };
  const assertSourceReview = (
    tx: UnitOfWorkTransaction,
    receipt: StoryboardSourceReviewReceipt,
  ) => {
    const row = tx.get<{ version: number; value_json: string }>(
      "SELECT version,value_json FROM production_storyboard_attributions WHERE id=? AND project_id=? AND storyboard_id=?",
      receipt.review.attribution.id,
      receipt.projectId,
      receipt.storyboard.id,
    );
    const currentHead = tx.get<{ attribution_id: string }>(
      "SELECT attribution_id FROM production_storyboard_attribution_heads WHERE project_id=? AND storyboard_id=?",
      receipt.projectId,
      receipt.storyboard.id,
    );
    const value = row ? JSON.parse(row.value_json) : undefined;
    if (
      !value ||
      row?.version !== receipt.review.attribution.version ||
      value.version !== receipt.review.attribution.version ||
      value.status !== "adopted" ||
      currentHead?.attribution_id !== receipt.review.attribution.id ||
      value.source?.sourceFingerprint !== receipt.sourceFingerprint ||
      value.associationFingerprint !== receipt.associationFingerprint
    )
      fail("原关联采用头、版本或实际指纹已变化，原影响审阅不自动换最新。");
    for (const shot of receipt.review.shots) {
      const actual = tx.get<{ version: number }>(
        "SELECT version FROM production_records WHERE id=? AND project_id=? AND kind='shots' AND retired_result_id IS NULL",
        shot.record.id,
        receipt.projectId,
      );
      if (actual?.version !== shot.record.version)
        fail("完整审阅范围中的实际镜头已变化，不仅核选中镜头。");
    }
  };
  const prepareRedo = (
    base: Stored | undefined,
    script: Stored,
    selection: NonNullable<EpisodeDevelopmentRequest["redoShots"]>,
    mode: EpisodeDevelopmentRequest["redoMode"],
    shotPlan: EpisodeDevelopmentRequest["redoShotPlan"],
    topologyPlan: EpisodeDevelopmentRequest["redoTopologyPlan"],
    sourceReview?: StoryboardSourceReviewReceipt,
  ): StoryboardRedoReceipt => {
    if (
      !base ||
      base.content.kind !== "storyboard-package" ||
      script.content.kind !== "episode-script" ||
      base.scriptId !== script.scriptId ||
      base.episodeRecordId !== script.episodeRecordId
    )
      fail("局部重做须绑定当前分镜包与同一实际剧本，不自动迁移镜头身份。");
    const allowed = new Set([
      "标准剧本已人工修改或不存在，保留原采用快照",
      "当前采用标准剧本已变化",
    ]);
    if (mode === "scene-topology-plan") allowed.add("当前采用单集大纲已变化");
    const reviewedPath =
      sourceReview &&
      context.uow.execute(
        (tx) => inspectReviewedRedoPath(tx, base, script, sourceReview).path,
      );
    if (
      !reviewedPath?.sourceSteps &&
      sourceReasons(base).some((reason) => !allowed.has(reason))
    )
      fail("分镜上游或实际场景／镜头已变化，不能将未核全变化静默局部化。");
    const previous = base.basis.request.script;
    if (!previous) fail("冻结分镜缺少正式剧本来源。");
    return context.uow.execute((tx) => {
      if (sourceReview) assertSourceReview(tx, sourceReview);
      if (
        reviewedPath?.sourceSteps &&
        (!base.recordBaselines ||
          recordBaselineObservations(tx, base).records.some(
            (item) => item.state !== "unchanged",
          ))
      )
        fail(
          "新来源局部重做须核全原实际场景／镜头字段，不覆盖人工变化或补造旧基准。",
        );
      if (mode === "scene-topology-plan") {
        if (
          !base.recordBaselines ||
          recordBaselineObservations(tx, base).records.some(
            (item) => item.state !== "unchanged",
          )
        )
          fail("场景拓扑准备须完整未修改的实际旧基准，不静默覆盖作者字段。");
        const receipt = freezeTopologyReceipt(
          tx,
          base,
          script,
          topologyPlan,
          sourceReview,
        );
        if (
          hash(
            [...receipt.shots].sort((a, b) =>
              a.recordId.localeCompare(b.recordId),
            ),
          ) !==
          hash(
            [...selection].sort((a, b) => a.recordId.localeCompare(b.recordId)),
          )
        )
          fail(
            "场景拓扑须明确选中所有生成或退役场景的全部旧实际镜头，不补缺选。",
          );
        return receipt;
      }
      const { old, sceneMappings } = inspectRedoScript(
        tx,
        base,
        script,
        mode,
        sourceReview,
      );
      const bindings = base.productionRecords ?? [];
      const records: ImpactRecord[] = bindings.flatMap((binding) => {
        const row = tx.get<{
          id: string;
          kind: string;
          version: number;
          parent_id: string | null;
          payload_json: string;
        }>(
          "SELECT id, kind, version, parent_id, payload_json FROM production_records WHERE id = ? AND project_id = ? AND retired_result_id IS NULL",
          binding.id,
          base.projectId,
        );
        return row
          ? [
              {
                id: row.id,
                kind: row.kind,
                version: row.version,
                parentId: row.parent_id,
                stableId: (
                  JSON.parse(row.payload_json) as Record<string, unknown>
                ).stableId,
              },
            ]
          : [];
      });
      const comparison = inspectEpisodeImpact({
        frozenScript: old.content.value,
        currentBlocks:
          script.content.kind === "episode-script"
            ? script.content.value.blocks
            : undefined,
        storyboard:
          base.content.kind === "storyboard-package"
            ? base.content.value
            : fail("分镜类型无效。"),
        bindings,
        records,
        scriptId: base.scriptId,
        globalReviewReasons: [],
      });
      if (
        comparison.globalReviewReasons.length ||
        comparison.shots.some((shot) => shot.associationImpact === "unresolved")
      )
        fail("实际映射未核全，不能推定局部重做范围。");
      const selected = new Set(selection.map((shot) => shot.shotId));
      if (
        selected.size !== selection.length ||
        selection.some((shot) => {
          const matched = comparison.shots.find(
            (item) => item.shotId === shot.shotId,
          );
          return (
            !matched?.record ||
            matched.record.id !== shot.recordId ||
            matched.record.currentVersion !== shot.version ||
            matched.record.frozenVersion !== shot.version
          );
        })
      )
        fail("选中镜头身份或版本已变化，请重新核对；不会自动换版本。");
      if (
        comparison.shots.some(
          (shot) =>
            shot.associationImpact === "affected" && !selected.has(shot.shotId),
        )
      )
        fail(
          "所有机械关联受影响镜头都须明确选中；未选镜头不能被当作安全或静默覆盖。",
        );
      if (mode === "scene-shot-plan") {
        const outlineRef = reviewedPath?.sourceSteps
          ? script.basis.request.outline
          : base.basis.request.outline;
        const outline = outlineRef ? read(tx, outlineRef.id) : undefined;
        if (
          !outline ||
          outline.version !== outlineRef?.version ||
          outline.content.kind !== "episode-outline" ||
          !base.recordBaselines ||
          recordBaselineObservations(tx, base).records.some(
            (item) => item.state !== "unchanged",
          )
        )
          fail(
            "场景镜头计划须有完整实际旧基准，人工字段变化不能被结构重做覆盖。",
          );
        const frozen = freezeStoryboardShotPlan({
          request: shotPlan,
          base: StoryboardPackageContentSchema.parse(base.content.value),
          bindings,
          outline: outline.content.value,
          script: EpisodeScriptContentSchema.parse(script.content.value),
          reservedShotIds: reservedStoryboardShotIds(tx, base.projectId),
        });
        if (
          frozen.selectedShots.length !== selection.length ||
          frozen.selectedShots.some((shot) => !selected.has(shot.shotId))
        )
          fail(
            "场景镜头计划须明确选中所改场景的全部原实际镜头，包括将退役者。",
          );
        return {
          base: { id: base.id, version: base.version },
          baseContentHash: hash(base.content.value),
          previousScript: previous,
          shots: frozen.selectedShots,
          scope: "author-frozen-scene-shot-plan-v1",
          semanticVerification: "unverified",
          sceneMappings: sceneMappings ?? [],
          scenePlans: frozen.scenePlans,
        };
      }
      return {
        base: { id: base.id, version: base.version },
        baseContentHash: hash(base.content.value),
        shots: selection,
        previousScript: previous,
        ...(sceneMappings
          ? {
              scope:
                "confirmed-block-structure-fixed-shots-duration-assets-v1" as const,
              sceneMappings,
            }
          : {
              scope:
                "stable-mapping-fixed-duration-existing-assets-v1" as const,
            }),
        semanticVerification: "unverified",
      };
    });
  };
  const prepare = (input: CreationInput) => {
    project(input.projectId);
    const request = EpisodeDevelopmentRequestSchema.parse(
      input.episodeDevelopmentRequest,
    );
    if (request.redoShots && input.operation !== "storyboard-package")
      fail("选中镜头重做只适用于分镜包，其他操作不得忽略范围。");
    if (
      input.targetId ||
      input.sourceIds.length ||
      input.diagnosisRequest ||
      input.seasonPlanRequest ||
      input.narrativeContextRequest
    )
      fail("单集开发只接受明确正式季纲或直写来源，不接受兼容目标或另选章节。");
    const origin = request.direct
      ? directSources(input.projectId, request.direct)
      : adaptationSources(input, request);
    const { episode, chapters, references, officialIntent } = origin;
    const approved = bible(input.projectId);
    if (!approved.length)
      fail("请先审阅并采用至少一份 Story Bible，不以待确认设定作为正式事实。");
    references.push(...approved);
    const outline = current(input.projectId, episode.id, "episode-outline");
    if (input.operation === "episode-outline") {
      if (
        request.outline ||
        request.baseScriptId ||
        request.baseScriptDocumentVersion !== undefined ||
        request.script ||
        request.baseStoryboardId
      )
        fail("单集大纲不接受剧本或未采用大纲作为输入。");
      if (outline?.id !== request.baseOutlineId)
        fail("当前采用单集大纲已变化，请重新确认。");
    } else {
      if (
        !outline ||
        outline.id !== request.outline?.id ||
        outline.version !== request.outline.version ||
        sourceReasons(outline).length
      )
        fail("请确认当前且来源有效的已采用单集大纲。");
      if (request.baseOutlineId)
        fail("剧本只继承明确采用的单集大纲，不另设大纲头。");
      if (
        hash(request.direct ?? null) !==
          hash(outline.basis.request.direct ?? null) ||
        hash(request.seasonPlan ?? null) !==
          hash(outline.basis.request.seasonPlan ?? null) ||
        request.inheritSeasonNarrative !==
          outline.basis.request.inheritSeasonNarrative ||
        hash(request.episodeNarrativeContext ?? null) !==
          hash(outline.basis.request.episodeNarrativeContext ?? null) ||
        request.sourceEvidenceFormat !==
          outline.basis.request.sourceEvidenceFormat
      )
        fail(
          "下游必须精确继承已采用大纲的故事来源和目标时长；不会换原稿或重绑简报。",
        );
      const script = current(input.projectId, episode.id, "episode-script");
      references.push(resultReference(outline));
      if (input.operation === "episode-script") {
        if (request.script || request.baseStoryboardId)
          fail("标准剧本不接受分镜包基准。");
        if (
          script?.id !== request.baseScriptId ||
          documentVersion(script) !== request.baseScriptDocumentVersion
        )
          fail("当前剧本或人工编辑版本已变化，请重新确认；不会覆盖作者新稿。");
      } else if (input.operation === "storyboard-package") {
        if (
          request.baseScriptId ||
          !script ||
          script.id !== request.script?.id ||
          script.version !== request.script.version ||
          sourceReasons(script).length ||
          documentVersion(script) !== request.baseScriptDocumentVersion
        )
          fail(
            "分镜包只能继承当前、有效且未人工改写的正式标准剧本，请重新确认。",
          );
        if (
          current(input.projectId, episode.id, "storyboard-package")?.id !==
          request.baseStoryboardId
        )
          fail("当前采用分镜包已变化，请重新确认。");
        references.push(resultReference(script));
      } else fail("不支持的单集开发操作。");
    }
    const baseStoryboard =
      input.operation === "storyboard-package"
        ? current(input.projectId, episode.id, "storyboard-package")
        : undefined;
    // The complete public observation is read outside the Production UOW;
    // own attribution/head/record versions are checked again inside it.
    const reviewedSource = captureSourceReview(baseStoryboard, request);
    const frozenRedo = request.redoShots
      ? prepareRedo(
          baseStoryboard,
          current(input.projectId, episode.id, "episode-script")!,
          request.redoShots,
          request.redoMode,
          request.redoShotPlan,
          request.redoTopologyPlan,
          reviewedSource?.receipt,
        )
      : undefined;
    const storyboardRedo = frozenRedo
      ? {
          ...frozenRedo,
          ...(reviewedSource ? { sourceReview: reviewedSource.receipt } : {}),
        }
      : undefined;
    if (
      storyboardRedo &&
      baseStoryboard?.content.kind === "storyboard-package"
    ) {
      const selected = new Set(storyboardRedo.shots.map((item) => item.shotId));
      const shots = baseStoryboard.content.value.scenes.flatMap((scene) =>
        scene.shots
          .filter((shot) => selected.has(shot.id))
          .map((shot) => ({ sceneId: scene.sceneId, ...shot })),
      );
      const assetIds = new Set(shots.flatMap((shot) => shot.assetIds));
      if (storyboardRedo.scope === "author-frozen-scene-shot-plan-v1")
        for (const scene of storyboardRedo.scenePlans)
          for (const shot of scene.shots)
            for (const id of shot.assetIds) assetIds.add(id);
      if (storyboardRedo.scope === "author-frozen-scene-topology-plan-v1")
        for (const scene of storyboardRedo.topologyPlan.scenes.filter(
          (scene) => scene.mode === "generate",
        ))
          for (const shot of scene.shots)
            for (const id of shot.assetIds) assetIds.add(id);
      const selectionReference = creationReference(
        "storyboard-redo-selection",
        {
          id: baseStoryboard.id,
          version: baseStoryboard.version,
          projectId: input.projectId,
          title: "明确选中镜头的冻结局部基准（未选镜头正文不外发）",
          receipt: storyboardRedo,
          shots,
          assets: baseStoryboard.content.value.assets.filter((asset) =>
            assetIds.has(asset.id),
          ),
          subtitles: baseStoryboard.content.value.subtitles.filter((item) =>
            selected.has(item.shotId),
          ),
          costRisks: baseStoryboard.content.value.costRisks.flatMap((item) => {
            const shotIds = item.shotIds.filter((id) => selected.has(id));
            return shotIds.length ? [{ ...item, shotIds }] : [];
          }),
        },
      );
      if (storyboardRedo.scope === "author-frozen-scene-shot-plan-v1") {
        const script = current(input.projectId, episode.id, "episode-script")!;
        const confirmed = context.uow.execute((tx) =>
          inspectRedoScript(
            tx,
            baseStoryboard,
            script,
            request.redoMode,
            reviewedSource?.receipt,
          ),
        );
        selectionReference.policyDependencies = [
          ...confirmed.confirmedRefs,
          ...baseStoryboard.basis.references.map(
            ({ sourceId, sourceVersion, fieldPath }) => ({
              sourceId,
              sourceVersion,
              fieldPath,
            }),
          ),
          {
            sourceId: baseStoryboard.scriptId!,
            sourceVersion: script.version,
            fieldPath: `/production/${baseStoryboard.scriptId}`,
          },
          ...storyboardRedo.scenePlans.map((scene) => ({
            sourceId: scene.recordId,
            sourceVersion: scene.version,
            fieldPath: `/production/${scene.recordId}`,
          })),
          ...storyboardRedo.shots.map((shot) => ({
            sourceId: shot.recordId,
            sourceVersion: shot.version,
            fieldPath: `/production/${shot.recordId}`,
          })),
        ];
      }
      if (storyboardRedo.scope === "author-frozen-scene-topology-plan-v1") {
        selectionReference.policyDependencies = [
          ...storyboardRedo.ancestry.map(
            ({ sourceId, sourceVersion, fieldPath }) => ({
              sourceId,
              sourceVersion,
              fieldPath,
            }),
          ),
          ...baseStoryboard.basis.references.map(
            ({ sourceId, sourceVersion, fieldPath }) => ({
              sourceId,
              sourceVersion,
              fieldPath,
            }),
          ),
          {
            sourceId: baseStoryboard.scriptId!,
            sourceVersion: context.uow.execute(
              (tx) =>
                tx.get<{ version: number }>(
                  "SELECT version FROM production_records WHERE id = ? AND project_id = ? AND kind = 'scripts'",
                  baseStoryboard.scriptId!,
                  baseStoryboard.projectId,
                )?.version ?? fail("实际剧本依赖不可核对。"),
            ),
            fieldPath: `/production/${baseStoryboard.scriptId}`,
          },
          ...[...storyboardRedo.selectedScenes, ...storyboardRedo.shots].map(
            ({ recordId, version }) => ({
              sourceId: recordId,
              sourceVersion: version,
              fieldPath: `/production/${recordId}`,
            }),
          ),
        ];
      }
      // A previous adopted source confirmation remains part of the actual
      // history even when this request only changes manuscript topology. Do
      // not make original snapshot/policy verification conditional on a new
      // author-source review being requested in this particular redo.
      const originalSourceDependencies = reviewedRedoDependencies(
        baseStoryboard,
        current(input.projectId, episode.id, "episode-script")!,
        reviewedSource?.receipt,
        { sourceConfirmedOnly: !reviewedSource },
      );
      if (reviewedSource || originalSourceDependencies.length) {
        selectionReference.policyDependencies = [
          ...new Map(
            [
              ...(selectionReference.policyDependencies ?? []),
              ...(reviewedSource?.policyDependencies ?? []),
              ...originalSourceDependencies,
            ].map((value) => [JSON.stringify(value), value]),
          ).values(),
        ];
        if (selectionReference.policyDependencies.length > 2000)
          fail("完整审阅禁止依赖超出上限，不截断或省略未选范围。");
      }
      references.push(selectionReference);
    }
    const basis = EpisodeDevelopmentBasisSchema.parse({
      request,
      diagnosis: origin.diagnosis,
      strategy: "strategy" in origin ? origin.strategy : undefined,
      authorIntent: origin.authorIntent,
      episode,
      chapters,
      references: references.map(frozenRef),
      ...(storyboardRedo ? { storyboardRedo } : {}),
      ...("sourceBasis" in origin
        ? {
            sourceBasis: origin.sourceBasis,
            contextChapters: origin.contextChapters,
          }
        : {}),
      ...(input.operation === "storyboard-package"
        ? {
            baseStoryboardRecords: context.uow.execute((tx) =>
              (baseStoryboard?.productionRecords ?? []).map((record) => ({
                id: record.id,
                version:
                  tx.get<{ version: number }>(
                    "SELECT version FROM production_records WHERE id = ? AND project_id = ?",
                    record.id,
                    input.projectId,
                  )?.version ?? null,
              })),
            ),
          }
        : {}),
    });
    return {
      authorIntent: officialIntent.authorIntent,
      episodeDevelopmentBasis: basis,
      ...(["episode-outline", "episode-script"].includes(input.operation)
        ? { continuationBasis: continuationBasis(input.projectId, basis) }
        : {}),
      references,
      sources: references.map((item) => ({
        kind:
          item.sourceKind === "author_intent"
            ? "author-intent"
            : item.sourceKind,
        id: item.sourceId,
        version: item.sourceVersion,
      })),
      prompt: `${AUTHOR_INTENT_CREATION_PROMPT}\n只开发明确指定的一集 ${episode.id}，${request.direct ? "当前路径为直写剧本，实际作者简报/原剧本、正式意图和已批准 Story Bible 是约束；没有小说、改编诊断或季纲，不补造这些来源、不重写或覆盖原稿。" : "来源的正式季纲、唯一策略与已批准 Story Bible 是约束，不把待确认规划当作已发生事实。"}仅生成候选，不自动采用或生成媒体。${basis.sourceBasis ? `\n本轮${request.episodeNarrativeContext ? "明确独立重选本集实际表达；不改变正式季纲或映射、不据未选章节推定语义无影响，原整季来源禁止链仍是约束" : "明确完整继承整季实际表达"}，不补整章原文，不截取跨集摘要。实际输入覆盖 ${basis.contextChapters!.length} 章；本集映射 ${JSON.stringify(chapters.map(({ id, version }) => ({ id, version })))}。两者不可混为全文阅读或每集来源映射。摘要／片段不是全文已读证明。实际表达身份：${JSON.stringify(adaptationExpressionScope(basis.sourceBasis))}` : ""}\n${
        input.operation === "episode-outline"
          ? `items 恰好一个 kind=episode-outline，data 严格符合 ${JSON.stringify(z.toJSONSchema(EpisodeOutlineContentSchema))}。场景与节拍标识唯一，场景从 0 连续排序，时间总和等于明确本集目标 ${episode.durationSeconds} 秒。${request.direct ? `sourceChapters 必须为空；每个场景的 sourceReferences 必须绑定实际作者 project/原剧本 sourceKind/sourceId/sourceVersion/fieldPath，不使用分集目录、意图或 Bible 的元数据冒充故事正文。真实故事来源身份：${JSON.stringify(references.filter((ref) => (ref.sourceKind === "project" && request.direct?.entryPath === "inspiration") || ref.sourceId === request.direct?.sourceScript?.id).map(({ sourceKind, sourceId, sourceVersion, fieldPath }) => ({ sourceKind, sourceId, sourceVersion, fieldPath })))}。` : `每个场景须有真实 sourceChapters，不填 sourceReferences。${basis.sourceBasis ? "仅引用本集映射章节身份，不把整季上下文或摘要纳入视为原文证据；全部本集映射須有场景对应。" : "只引用本集原文，全部本集来源须有场景对应。"}`}体现目标/冲突/转折/集尾。content 为作者阅读摘要。`
          : input.operation === "episode-script"
            ? `items 恰好一个 kind=episode-script，data 严格符合 ${JSON.stringify(z.toJSONSchema(EpisodeScriptContentSchema))}。blocks 按阅读顺序提供稳定 UUID；content 是由同一 blocks 导出的完整 Fountain。按已采用大纲场景顺序，sceneLinks 对每个场景提供一组连续块，从 scene_heading 开始，含动作/对白，不遗漏、不重叠，所有块恰好归属一个场景。`
            : storyboardRedo
              ? storyboardRedo.scope === "author-frozen-scene-topology-plan-v1"
                ? `items 恰好一个 kind=storyboard-package，data 严格符合 ${JSON.stringify(z.toJSONSchema(StoryboardSceneTopologyPlanPatchSchema))}。协议 selected-scene-topology-plan-v1，只生成明确 mode=generate 场景的冻结新镜头表达、字幕和局部风险，不输出完整包、未选正文或全局资产。冻结作者场景计划：${JSON.stringify(storyboardRedo.topologyPlan)}。每镜 id/orderIndex/durationSeconds/assetIds 必须与计划完全一致；sourceBlockIds 只来自对应新正式场景连续块组，完整覆盖，不跨场或复活旧块。字幕逐字取对应 dialogue，每块恰好一次，时码在所属镜头内，不输出退役镜头字幕或风险。旧实际身份不能改解释或跨场迁移，新增身份不能复用历史。content 是局部候选摘要，不是媒体、语义安全、权利通过或费用报价。`
                : storyboardRedo.scope === "author-frozen-scene-shot-plan-v1"
                  ? `items 恰好一个 kind=storyboard-package，data 严格符合 ${JSON.stringify(z.toJSONSchema(StoryboardSceneShotPlanPatchSchema))}。协议 selected-scene-shot-plan-v1，仅按作者冻结的新镜头计划生成表达、完整对应字幕及局部成本风险，不生成完整包、全局资产或未选场景。冻结计划：${JSON.stringify(storyboardRedo.scenePlans)}。新旧身份不可混同；输出恰好这些新镜头，逐镜保留 id、orderIndex、durationSeconds、assetIds，不能复活退役镜头或自行增减／换资产。sourceBlockIds 仅引用所属原场景当前正式连续块组，完整覆盖，不跨场或保留已删块。原／新块映射：${JSON.stringify(storyboardRedo.sceneMappings)}。字幕逐字取当前正式 dialogue，每块恰好一次、时码在所属镜头内，不输出退役镜头字幕或风险。content 为局部候选摘要。没有媒体生成、语义安全、权利通过或费用报价。`
                  : `items 恰好一个 kind=storyboard-package，data 严格符合 ${JSON.stringify(z.toJSONSchema(storyboardRedo.scope === "confirmed-block-structure-fixed-shots-duration-assets-v1" ? StoryboardBlockStructurePatchSchema : StoryboardShotPatchSchema))}。协议 ${storyboardRedo.scope === "confirmed-block-structure-fixed-shots-duration-assets-v1" ? "selected-storyboard-block-structure-v1" : "selected-storyboard-shots-v1"}，只生成冻结选中镜头的替换表达、对应完整字幕与局部成本风险；不生成完整分镜包，不重做未选镜头，不改变全局资产／视觉方向／外部依赖。选中身份和版本：${JSON.stringify(storyboardRedo.shots)}。保留镜头稳定 id、orderIndex、durationSeconds 和 assetIds。${storyboardRedo.scope === "confirmed-block-structure-fixed-shots-duration-assets-v1" ? `sourceBlockIds 仅引用所属原场景的新正式连续块组，完整覆盖新映射，不保留已删除块、不跨场；原／新冻结映射：${JSON.stringify(storyboardRedo.sceneMappings)}。场景和镜头身份／数量／顺序不变。` : "sourceBlockIds 原样保留。"}对白字幕逐字取当前正式剧本，局部每块恰好出现一次，时码在镜头内。content 为局部重做摘要。结构核对不是语义安全、权利通过或费用报价。`
              : `items 恰好一个 kind=storyboard-package，data 严格符合 ${JSON.stringify(z.toJSONSchema(StoryboardPackageContentSchema))}。content 是完整方案摘要。按正式大纲/剧本顺序逐场提供镜头，scriptBlockIds 完全等于正式 sceneLinks 的连续块组，镜头覆盖全部稳定块，不跨场。镜头从 0 排序、时长总和匹配对应正式场景。资产引用实际已批准 Bible ID。字幕逐字取正式 dialogue 块、每块恰好出现一次，相对镜头时码在该镜头内。提供视觉动作、构图、机位/运动、声音、正负 Prompt、实际镜头对应的成本风险/缓解与外部依赖，不捏造货币报价、已锁定资产、权利通过或已生成媒体。`
      }${request.sourceEvidenceFormat && input.operation === "episode-outline" ? `\n逐场引文协议 exact-expression-quotes-v1：每场 sourceEvidence 引用实际冻结表达中的逐字 quote、唯一 id 和模型声明 rationale；不得回读未选整章或用标题／意图／Bible／目录当正文。source 只取以下实际故事表达身份（不含 contentHash），valuePath 仅 chapter=/content、knowledge=/summary、project=/content/synopsis 或 /content/productionBrief、原剧本=/content 或实际 action/dialogue 的 /blocks/索引/text。章节或摘要覆盖须与本场 sourceChapters 对应；直写须完整对应本场 sourceReferences。重复引文保留全部匹配位置，规则匹配不证明语义归因正确。逐场可引用身份：${JSON.stringify(sceneStoryReferences(basis).map(({ contentHash: _hash, ...ref }) => ref))}。` : ""}`,
    };
  };
  const inspect = (
    output: CreationContent,
    basis: EpisodeDevelopmentBasis,
    operation: Operation,
    workflow: CreationWorkflow,
  ) => {
    if (
      output.items.length !== 1 ||
      output.items[0]?.kind !== operation ||
      !output.content.trim()
    )
      fail("候选必须只有一个本操作强类型条目和非空正文/摘要。");
    if (operation === "episode-outline") {
      const content = inspectEpisodeOutlineContent(output.items[0].data, basis);
      return { kind: operation, value: content } as const;
    }
    const snapshot = readSourceSnapshot(workflow.sourceSnapshotId!);
    const outlineValue = snapshot?.entries.find(
      (entry) =>
        entry.included &&
        entry.sourceKind === "production" &&
        entry.sourceId === basis.request.outline!.id,
    )?.value as { content?: { kind: string; value: unknown } } | undefined;
    if (outlineValue?.content?.kind !== "episode-outline")
      fail("冻结快照中缺少正式单集大纲。");
    const outline = EpisodeOutlineContentSchema.parse(
      outlineValue.content.value,
    );
    if (operation === "storyboard-package") {
      const scriptValue = snapshot?.entries.find(
        (entry) =>
          entry.included &&
          entry.sourceKind === "production" &&
          entry.sourceId === basis.request.script!.id,
      )?.value as { content?: { kind: string; value: unknown } } | undefined;
      if (scriptValue?.content?.kind !== "episode-script")
        fail("冻结快照缺少正式标准剧本。");
      if (basis.storyboardRedo) {
        const receipt = basis.storyboardRedo;
        const base = context.uow.execute((tx) => read(tx, receipt.base.id));
        if (
          !base ||
          base.content.kind !== "storyboard-package" ||
          base.version !== receipt.base.version ||
          base.projectId !== workflow.input.projectId ||
          base.episodeId !== basis.episode.id ||
          hash(base.content.value) !== receipt.baseContentHash
        )
          fail("局部重做冻结原包未核全，不从模型输出补造基准。");
        return {
          kind: operation,
          value: inspectStoryboardRedo(
            output.items[0].data,
            base.content.value,
            receipt,
            outline,
            EpisodeScriptContentSchema.parse(scriptValue.content.value),
            episodeBibleReferences(basis).map((item) => item.sourceId),
          ),
        } as const;
      }
      return {
        kind: operation,
        value: inspectStoryboardContent(
          output.items[0].data,
          outline,
          EpisodeScriptContentSchema.parse(scriptValue.content.value),
          episodeBibleReferences(basis).map((item) => item.sourceId),
        ),
      } as const;
    }
    const content = inspectEpisodeScriptContent(
      output.items[0].data,
      outline,
      output.content,
    );
    return { kind: operation, value: content } as const;
  };
  const sourceEvidence = (
    content: Stored["content"],
    basis: EpisodeDevelopmentBasis,
    workflow: CreationWorkflow,
  ) => {
    const entries =
      readSourceSnapshot(workflow.sourceSnapshotId!)?.entries ?? [];
    if (content.kind === "episode-outline")
      return inspectSceneSourceEvidence(content.value, basis, entries);
    const frozenOutline = entries.find(
      (entry) =>
        entry.included &&
        entry.sourceKind === "production" &&
        entry.sourceId === basis.request.outline!.id,
    )?.value as
      | {
          content?: { kind: string; value: unknown };
          sourceEvidence?: unknown;
          origin?: EpisodeDevelopmentResult["origin"];
        }
      | undefined;
    if (frozenOutline?.content?.kind !== "episode-outline")
      fail("冻结快照缺少正式大纲来源证据。");
    const verified = inspectSceneSourceEvidence(
      EpisodeOutlineContentSchema.parse(frozenOutline.content.value),
      basis,
      entries,
      frozenOutline.origin === "human-topology-revision" ||
        frozenOutline.origin === "human-source-revision"
        ? "human-declared"
        : "model-declared",
    );
    if (verified) {
      const inherited = z
        .array(EpisodeSceneEvidenceSchema)
        .min(1)
        .max(6000)
        .parse(frozenOutline.sourceEvidence);
      if (hash(inherited) !== hash(verified))
        fail("正式大纲来源证据与实际冻结表达不一致，不能自报或补造下游归因。");
      return inherited;
    }
    if (frozenOutline.sourceEvidence)
      fail("历史大纲不能被自动补上逐场引文证据。");
    return undefined;
  };
  const validate = (
    input: CreationInput,
    output: CreationContent,
    workflow?: CreationWorkflow,
  ): CreationIssue[] => {
    try {
      const basis = workflow?.episodeDevelopmentBasis;
      const snapshot = workflow?.sourceSnapshotId
        ? readSourceSnapshot(workflow.sourceSnapshotId)
        : undefined;
      if (
        !basis ||
        !snapshot ||
        snapshot.projectId !== input.projectId ||
        hash(basis.request) !== hash(input.episodeDevelopmentRequest) ||
        workflow?.authorIntent?.state !== "adopted" ||
        workflow.authorIntent.id !== basis.authorIntent.id ||
        workflow.authorIntent.version !== basis.authorIntent.version
      )
        fail("单集开发缺少可核对的冻结基准。");
      for (const source of basis.references)
        if (
          !snapshot.entries.some(
            (entry) =>
              entry.included &&
              entry.sourceKind === source.sourceKind &&
              entry.sourceId === source.sourceId &&
              entry.sourceVersion === source.sourceVersion &&
              entry.fieldPath === source.fieldPath &&
              hash(entry.value) === source.contentHash,
          )
        )
          fail(
            "本集来源、正式季纲/大纲、意图或 Story Bible 未完整纳入冻结快照。",
          );
      const content = inspect(
        output,
        basis,
        input.operation as Operation,
        workflow!,
      );
      if (workflow?.recordMergeSource) {
        const merged = recordMergeDetails(workflow);
        for (const reference of merged!.references)
          if (
            !snapshot.entries.some(
              (entry) =>
                entry.included &&
                entry.sourceKind === reference.sourceKind &&
                entry.sourceId === reference.sourceId &&
                entry.sourceVersion === reference.sourceVersion &&
                entry.fieldPath === reference.fieldPath &&
                hash(entry.value) === hash(reference.value),
            )
          )
            fail("明确字段选择未完整冻结，不能按原上下文复检新人工文字。");
      }
      sourceEvidence(content, basis, workflow!);
      return [];
    } catch (error) {
      if (error instanceof EpisodeError && error.status === 503) throw error;
      return [
        {
          severity: "error",
          source: "rule",
          location: "单集开发",
          evidence: "",
          message: error instanceof Error ? error.message : "单集结构无效。",
          suggestion: "核对实际采用版本、完整冻结来源与本集结构。",
        },
      ];
    }
  };
  const inspectRecordMerge = (workflow: CreationWorkflow) => {
    const basis = workflow.episodeDevelopmentBasis;
    const receipt = basis?.storyboardRedo;
    if (
      workflow.input.operation !== "storyboard-package" ||
      workflow.stage !== "awaiting-review" ||
      !workflow.output ||
      !basis ||
      !receipt ||
      !workflow.sourceSnapshotId ||
      (receipt.scope ===
      "confirmed-block-structure-fixed-shots-duration-assets-v1"
        ? basis.request.redoMode !== "confirmed-block-structure"
        : receipt.scope === "author-frozen-scene-topology-plan-v1"
          ? basis.request.redoMode !== "scene-topology-plan"
          : receipt.scope === "author-frozen-scene-shot-plan-v1"
            ? basis.request.redoMode !== "scene-shot-plan"
            : Boolean(basis.request.redoMode)) ||
      validate(workflow.input, workflow.output, workflow).length
    )
      fail(
        "仅未处理、冻结基准完整且明确绑定原重做模式的选中镜头候选可比较实际创作字段。原候选保留。",
      );
    const content = inspect(
      workflow.output,
      basis,
      "storyboard-package",
      workflow,
    );
    if (content.kind !== "storyboard-package") fail("候选类型不符。");
    // Read the same formal sources without re-running selected-record version
    // admission. Actual changes are compared below, never silently rebound.
    const { base: originalBoard, script: originalScript } = context.uow.execute(
      (tx) => ({
        base: read(tx, receipt.base.id),
        script: read(tx, basis.request.script!.id),
      }),
    );
    if (!originalBoard || !originalScript)
      fail("原分镜／当前正式剧本不可核对。");
    if (receipt.sourceReview) {
      const fresh = captureSourceReview(originalBoard, basis.request);
      if (!fresh || hash(fresh.receipt) !== hash(receipt.sourceReview))
        fail("本次完整来源影响观察已变化，不能用字段合并静默重绑原审阅。");
    }
    reviewedRedoDependencies(
      originalBoard,
      originalScript,
      receipt.sourceReview,
      {
        sourceConfirmedOnly: !receipt.sourceReview,
      },
    );
    const request = { ...basis.request };
    delete request.redoShots;
    delete request.redoMode;
    delete request.redoShotPlan;
    delete request.redoTopologyPlan;
    delete request.redoSourceReview;
    const prepared = prepare({
      ...workflow.input,
      episodeDevelopmentRequest: request,
    });
    const sourceBasis = (value: EpisodeDevelopmentBasis) => {
      const result = structuredClone(value);
      delete result.request.redoShots;
      delete result.request.redoMode;
      delete result.request.redoShotPlan;
      delete result.request.redoTopologyPlan;
      delete result.request.redoSourceReview;
      delete result.storyboardRedo;
      delete result.baseStoryboardRecords;
      result.references = result.references.filter(
        (item) =>
          !(
            item.sourceKind === "production" &&
            item.sourceId === receipt.base.id &&
            item.fieldPath === `/production/${receipt.base.id}`
          ),
      );
      return result;
    };
    // Typed optional keys serialize as absent; actual-row hashing remains
    // stricter and never drops private/raw fields to get a successful hash.
    const typedHash = (value: unknown) =>
      productionRecordFieldHash(JSON.parse(JSON.stringify(value)));
    if (
      typedHash(sourceBasis(prepared.episodeDevelopmentBasis)) !==
        typedHash(sourceBasis(basis)) ||
      typedHash(prepared.authorIntent) !== typedHash(workflow.authorIntent)
    )
      fail("正式来源、意图或上下文已变化，不将字段比较当作自动换源。");
    const contextHash = typedHash(
      sourceBasis(prepared.episodeDevelopmentBasis),
    );
    return context.uow.execute((tx) => {
      const base = read(tx, receipt.base.id);
      const script = read(tx, basis.request.script!.id);
      const document = script?.scriptId
        ? tx.get<{ version: number; blocks_json: string }>(
            "SELECT version, blocks_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
            script.scriptId,
            workflow.input.projectId,
          )
        : undefined;
      if (
        !base ||
        base.projectId !== workflow.input.projectId ||
        base.episodeId !== basis.episode.id ||
        base.version !== receipt.base.version ||
        base.content.kind !== "storyboard-package" ||
        hash(base.content.value) !== receipt.baseContentHash ||
        head(tx, base.projectId, base.episodeId, "storyboard-package") !==
          base.id ||
        head(tx, base.projectId, base.episodeId, "episode-script") !==
          script?.id ||
        head(tx, base.projectId, base.episodeId, "episode-outline") !==
          basis.request.outline!.id ||
        !script?.scriptId ||
        base.scriptId !== script.scriptId ||
        script.content.kind !== "episode-script" ||
        !document ||
        document.version !== basis.request.baseScriptDocumentVersion ||
        hash(JSON.parse(document.blocks_json)) !==
          hash(script.content.value.blocks)
      )
        fail("实际正式包、剧本或稳定块已变化，不能比较并推定旧结构仍有效。");
      const bindings = base.productionRecords ?? [];
      const frozen = new Map(
        (basis.baseStoryboardRecords ?? []).map((item) => [
          item.id,
          item.version,
        ]),
      );
      const bindingById = new Map(bindings.map((item) => [item.id, item]));
      const selected = new Map(
        receipt.shots.map((item) => [item.recordId, item]),
      );
      if (
        frozen.size !== bindings.length ||
        frozen.size !== basis.baseStoryboardRecords?.length ||
        selected.size !== receipt.shots.length ||
        bindings.some((item) => frozen.get(item.id) !== item.version) ||
        receipt.shots.some((item) => {
          const binding = bindingById.get(item.recordId);
          return (
            !binding ||
            binding.kind !== "shots" ||
            binding.stableId !== item.shotId ||
            binding.version !== item.version
          );
        })
      )
        fail("冻结候选与实际原记录绑定不完整，不补最新版本。");
      // A valid hash alone is not provenance. Resolve each original capture
      // against this owner's immutable history, including retained baselines.
      const history = new Map<
        string,
        | {
            value: Stored;
            baselines: Map<string, ProductionRecordBaseline>;
            bindings: Map<string, (typeof bindings)[number]>;
          }
        | undefined
      >();
      for (const baseline of base.recordBaselines ?? []) {
        if (!baseline?.capturedResult)
          fail("实际原字段捕获来源缺失，不重建旧人工内容。");
        const id = baseline.capturedResult.id;
        if (!history.has(id)) {
          const value = read(tx, id);
          const baselines = value?.recordBaselines ?? [],
            sourceBindings = value?.productionRecords ?? [];
          const byId = new Map(baselines.map((item) => [item.id, item])),
            sourceById = new Map(sourceBindings.map((item) => [item.id, item]));
          history.set(
            id,
            value &&
              byId.size === baselines.length &&
              sourceById.size === sourceBindings.length
              ? { value, baselines: byId, bindings: sourceById }
              : undefined,
          );
        }
        const capture = history.get(id),
          captured = capture?.value;
        const original = capture?.baselines.get(baseline.id),
          capturedBinding = capture?.bindings.get(baseline.id);
        if (
          !captured ||
          captured.projectId !== base.projectId ||
          captured.episodeId !== base.episodeId ||
          captured.operation !== "storyboard-package" ||
          captured.version !== baseline.capturedResult.version ||
          !original ||
          productionRecordFieldHash(original) !==
            productionRecordFieldHash(baseline) ||
          !capturedBinding ||
          capturedBinding.kind !== baseline.kind ||
          capturedBinding.stableId !== baseline.stableId ||
          capturedBinding.version !== baseline.version
        )
          fail("实际原字段捕获来源与不可变本域记录不符，不补造历史基准。");
      }
      const rows = bindings.flatMap((binding) => {
        const row = tx.get<BaselineRecordRow>(
          "SELECT id, project_id, kind, version, title, parent_id, order_index, payload_json FROM production_records WHERE id = ? AND project_id = ? AND kind = ? AND retired_result_id IS NULL",
          binding.id,
          base.projectId,
          binding.kind,
        );
        return row ? [row] : [];
      });
      const confirmed =
        receipt.scope === "author-frozen-scene-topology-plan-v1"
          ? undefined
          : inspectRedoScript(
              tx,
              base,
              script,
              basis.request.redoMode,
              receipt.sourceReview,
            );
      const structure =
        receipt.scope ===
        "confirmed-block-structure-fixed-shots-duration-assets-v1"
          ? {
              receipt,
              script: basis.request.script!,
              scriptRecordId: script.scriptId,
              documentVersion: document.version,
            }
          : undefined;
      const shotPlan =
        receipt.scope === "author-frozen-scene-shot-plan-v1"
          ? {
              receipt,
              script: basis.request.script!,
              scriptRecordId: script.scriptId,
              documentVersion: document.version,
            }
          : undefined;
      const topologyPlan =
        receipt.scope === "author-frozen-scene-topology-plan-v1"
          ? {
              receipt,
              script: basis.request.script!,
              scriptRecordId: script.scriptId,
              documentVersion: document.version,
            }
          : undefined;
      if (
        topologyPlan &&
        typedHash(
          freezeTopologyReceipt(
            tx,
            base,
            script,
            basis.request.redoTopologyPlan,
            receipt.sourceReview,
          ),
        ) !== typedHash(receipt)
      )
        fail("场景拓扑原双正式祖先、身份或冻结计划已变化，不以字段比较换源。");
      if (shotPlan) {
        const outline = read(tx, basis.request.outline!.id);
        if (outline?.content.kind !== "episode-outline")
          fail("原镜头计划正式大纲不可核对。");
        const frozen = freezeStoryboardShotPlan({
          request: basis.request.redoShotPlan,
          base: base.content.value,
          bindings,
          outline: outline.content.value,
          script: script.content.value,
          reservedShotIds: reservedStoryboardShotIds(tx, base.projectId),
        });
        if (
          typedHash(frozen.scenePlans) !==
            typedHash(shotPlan.receipt.scenePlans) ||
          typedHash(frozen.selectedShots) !== typedHash(shotPlan.receipt.shots)
        )
          fail("原作者镜头计划或原实际身份变化，不自动替换冻结结构。");
      }
      const protectedStructure = structure ?? shotPlan;
      if (
        protectedStructure &&
        typedHash(confirmed?.sceneMappings) !==
          typedHash(protectedStructure.receipt.sceneMappings)
      )
        fail("原人工确认链或原／新场内块映射已变化，不替换冻结结构。");
      if (!topologyPlan) {
        const mechanical = inspectEpisodeImpact({
          frozenScript: confirmed!.old.content.value,
          currentBlocks: script.content.value.blocks,
          storyboard: base.content.value,
          bindings,
          records: rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            version: row.version,
            parentId: row.parent_id,
            stableId: JSON.parse(row.payload_json).stableId,
          })),
          scriptId: script.scriptId,
          globalReviewReasons: [],
        });
        if (
          mechanical.globalReviewReasons.length ||
          mechanical.shots.some(
            (shot) =>
              shot.associationImpact === "unresolved" ||
              (!selected.has(shot.record!.id) &&
                shot.reasonCodes.some(
                  (reason) =>
                    !["shot-record-changed", "scene-record-changed"].includes(
                      reason,
                    ),
                )),
          )
        )
          fail(
            "原／新剧本的机械受影响范围未完整选中，不借字段合并覆盖未选范围。",
          );
      }
      const plan = planProductionRecordFields({
        projectId: base.projectId,
        scriptId: script.scriptId,
        bindings,
        baselines: base.recordBaselines,
        rows,
        selectedRecordIds: [...selected.keys()],
        candidate: content.value,
        confirmedStructure: structure,
        confirmedShotPlan: shotPlan,
        confirmedTopologyPlan: topologyPlan,
      });
      const comparison = {
        ...(topologyPlan
          ? {
              format: "storyboard-record-field-comparison-v4" as const,
              structure: topologyPlan,
              structureHash: typedHash(topologyPlan),
            }
          : shotPlan
            ? {
                format: "storyboard-record-field-comparison-v3" as const,
                structure: shotPlan,
                structureHash: typedHash(shotPlan),
              }
            : structure
              ? {
                  format: "storyboard-record-field-comparison-v2" as const,
                  structure,
                  structureHash: typedHash(structure),
                }
              : { format: "storyboard-record-field-comparison-v1" as const }),
        projectId: base.projectId,
        episodeId: base.episodeId,
        workflow: { id: workflow.id, version: workflow.version },
        base: receipt.base,
        candidateHash: typedHash(workflow.output),
        frozenBasisHash: typedHash(basis),
        contextHash,
        records: plan.records,
        units: plan.units,
        semanticVerification: "unverified" as const,
        automaticCommit: false as const,
      };
      const report = ProductionRecordMergeComparisonSchema.parse({
        ...comparison,
        comparisonHash: productionRecordFieldHash(comparison),
      });
      return { report, plan, content };
    });
  };
  const compareRecords = (workflow: CreationWorkflow) =>
    inspectRecordMerge(workflow).report;
  const mergeRecords = (
    workflow: CreationWorkflow,
    raw: ProductionRecordMergeRequest,
  ) => {
    const request = ProductionRecordMergeRequestSchema.parse(raw);
    if (
      request.workflow.id !== workflow.id ||
      request.workflow.version !== workflow.version ||
      request.projectId !== workflow.input.projectId ||
      request.episodeId !== workflow.episodeDevelopmentBasis?.episode.id
    )
      fail("字段合并不属于原候选的实际身份／版本。");
    const { report, plan } = inspectRecordMerge(workflow);
    if (
      request.base.id !== report.base.id ||
      request.base.version !== report.base.version ||
      request.comparisonHash !== report.comparisonHash ||
      (report.format === "storyboard-record-field-comparison-v4"
        ? request.format !== "storyboard-record-field-merge-request-v4" ||
          request.structureHash !== report.structureHash
        : report.format === "storyboard-record-field-comparison-v3"
          ? request.format !== "storyboard-record-field-merge-request-v3" ||
            request.structureHash !== report.structureHash
          : report.format === "storyboard-record-field-comparison-v2"
            ? request.format !== "storyboard-record-field-merge-request-v2" ||
              request.structureHash !== report.structureHash
            : request.format !== "storyboard-record-field-merge-request-v1") ||
      Object.keys(request.choices).length !== plan.units.length ||
      plan.units.some((unit) => !Object.hasOwn(request.choices, unit.id))
    )
      fail("完整字段选择或实际比较已变化，请重新核对，不补新版本或默认冲突。");
    const fields = resolveProductionRecordFields(plan, request.choices);
    const output = structuredClone(workflow.output!);
    const patch = StoryboardRedoPatchSchema.parse(output.items[0]!.data);
    const shotRecords = new Map(
      report.records
        .filter((item) => item.kind === "shots")
        .map((item) => [item.stableId, item]),
    );
    const fieldMap = {
      visualAction: "镜头描述",
      composition: "构图",
      camera: "机位",
      movement: "运镜",
      prompt: "生成提示",
      negativePrompt: "负面提示",
      sound: "声音",
    } as const;
    for (const shot of patch.shots) {
      const record = shotRecords.get(shot.id);
      if (
        report.format === "storyboard-record-field-comparison-v4" &&
        report.structure.receipt.topologyPlan.scenes.some(
          (scene) =>
            scene.mode === "generate" &&
            scene.shots.some(
              (planned) => planned.id === shot.id && !planned.retains,
            ),
        )
      )
        continue;
      if (
        report.format === "storyboard-record-field-comparison-v3" &&
        report.structure.receipt.scenePlans.some((scene) =>
          scene.shots.some(
            (planned) => planned.id === shot.id && !planned.retains,
          ),
        )
      )
        continue;
      if (!record?.editable) fail("冻结局部候选包含未选实际镜头。");
      const selected = fields.get(record.id)!;
      for (const [field, key] of Object.entries(fieldMap)) {
        const text = selected.payload[key] as string;
        // Formal storyboard text trims. Never silently trim an author's value.
        if (text !== text.trim())
          fail(
            "所选人工镜头文字含正式协议会裁剪的边界空白；原稿保留，请先明确修订该字段。",
          );
        Object.defineProperty(shot, field, {
          value: text,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    output.items[0]!.data = StoryboardRedoPatchSchema.parse(patch);
    if (validate(workflow.input, output, workflow).length)
      fail("所选字段未组成有效正式候选，不生成替代选择。");
    const source = ProductionRecordMergeSourceSchema.parse({
      format:
        report.format === "storyboard-record-field-comparison-v4"
          ? "storyboard-record-field-merge-v4"
          : report.format === "storyboard-record-field-comparison-v3"
            ? "storyboard-record-field-merge-v3"
            : report.format === "storyboard-record-field-comparison-v2"
              ? "storyboard-record-field-merge-v2"
              : "storyboard-record-field-merge-v1",
      request,
      comparison: report,
      outputHash: productionRecordFieldHash(JSON.parse(JSON.stringify(output))),
    });
    const snapshot = readSourceSnapshot(workflow.sourceSnapshotId!);
    if (!snapshot || snapshot.projectId !== workflow.input.projectId)
      fail("原字段合并上下文不可用。");
    // Only selected creative values, never the three-sided diff or arbitrary
    // current payload. Retain original policy ancestry and actual parent IDs.
    const dependencies = [
      ...new Map(
        snapshot.entries
          .filter((entry) => entry.included)
          .flatMap((entry) => [
            {
              sourceId: entry.sourceId,
              sourceVersion: entry.sourceVersion,
              fieldPath: entry.fieldPath,
            },
            ...(entry.policyDependencies ?? []),
          ])
          .map((entry) => [
            `${entry.sourceId}:${entry.sourceVersion}:${entry.fieldPath}`,
            entry,
          ]),
      ).values(),
    ];
    const byRecord = new Map<string, Record<string, string>>();
    const policyFields = new Map<
      string,
      Array<{ sourceId: string; sourceVersion: number; fieldPath: string }>
    >();
    const recordById = new Map(
      report.records.map((record) => [record.id, record]),
    );
    for (const unit of plan.units) {
      const selected =
        request.choices[unit.id] === "main" ? unit.current : unit.candidate;
      if (selected.state !== "text") fail("所选字段不是有效文本。");
      const values = byRecord.get(unit.recordId) ?? {};
      Object.defineProperty(values, unit.field, {
        value: selected.text,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      byRecord.set(unit.recordId, values);
      const policies = policyFields.get(unit.recordId) ?? [];
      policies.push({
        sourceId: unit.recordId,
        sourceVersion: recordById.get(unit.recordId)!.currentVersion,
        fieldPath: `/production/${unit.recordId}/${unit.field === "title" ? "title" : `payload/${unit.field}`}`,
      });
      policyFields.set(unit.recordId, policies);
    }
    const parentVersions = context.uow.execute(
      (tx) =>
        new Map(
          report.records
            .filter(
              (record) => record.editable && !recordById.has(record.parentId),
            )
            .map((record) => {
              const row = tx.get<{ version: number }>(
                "SELECT version FROM production_records WHERE id = ? AND project_id = ?",
                record.parentId,
                workflow.input.projectId,
              );
              if (!row) fail("实际记录父级未核全，不能补造隐私来源版本。");
              return [record.parentId, row.version] as const;
            }),
        ),
    );
    const references = report.records
      .filter((record) => record.editable)
      .map((record) => ({
        ...creationReference("record-field-merge", {
          id: record.id,
          version: record.currentVersion,
          projectId: request.projectId,
          title: "作者明确选择的实际创作字段（待复检／非已采用事实）",
          format: source.format,
          comparisonHash: report.comparisonHash,
          kind: record.kind,
          stableId: record.stableId,
          selectedFields: byRecord.get(record.id),
        }),
        policyDependencies: [
          ...dependencies,
          ...(policyFields.get(record.id) ?? []),
          {
            sourceId: record.parentId,
            sourceVersion:
              recordById.get(record.parentId)?.currentVersion ??
              parentVersions.get(record.parentId)!,
            fieldPath: `/production/${record.parentId}`,
          },
        ],
      }));
    return { source, output, references };
  };
  const recordMergeDetails = (workflow: CreationWorkflow) => {
    const source = workflow.recordMergeSource;
    if (!source) return undefined;
    const original = optionalService(context, CREATION_WORKFLOW_SERVICE)?.get(
      source.request.workflow.id,
    );
    if (
      !original ||
      original.recordMergeSource ||
      !workflow.output ||
      hash(original.episodeDevelopmentBasis) !==
        hash(workflow.episodeDevelopmentBasis) ||
      hash(original.authorIntent) !== hash(workflow.authorIntent) ||
      hash(original.input.episodeDevelopmentRequest) !==
        hash(workflow.input.episodeDevelopmentRequest)
    )
      fail("原字段合并候选、正式来源或实际归属不可核对，不升级冻结协议。");
    const merged = mergeRecords(original, source.request);
    if (
      productionRecordFieldHash(merged.source) !==
        productionRecordFieldHash(source) ||
      productionRecordFieldHash(JSON.parse(JSON.stringify(workflow.output))) !==
        source.outputHash
    )
      fail("冻结字段选择、原请求或结果已变化，不重新生成替代作者选择。");
    const content = inspect(
      original.output!,
      original.episodeDevelopmentBasis!,
      "storyboard-package",
      original,
    );
    if (content.kind !== "storyboard-package") fail("原字段合并类型不符。");
    return { ...merged, original, content };
  };
  const apply = (workflow: CreationWorkflow) => {
    if (
      context.uow.execute((tx) =>
        tx.get(
          "SELECT id FROM production_episode_results WHERE workflow_id = ?",
          workflow.id,
        ),
      )
    )
      return;
    if (
      !workflow.output ||
      !workflow.episodeDevelopmentBasis ||
      !workflow.sourceSnapshotId ||
      validate(workflow.input, workflow.output, workflow).length
    )
      fail("候选或冻结基准不完整。");
    const fieldMerge = recordMergeDetails(workflow);
    const prepared = fieldMerge ? undefined : prepare(workflow.input);
    if (
      prepared &&
      hash(prepared.episodeDevelopmentBasis) !==
        hash(workflow.episodeDevelopmentBasis)
    )
      fail("正式来源或当前采用头已变化；原候选保留，不覆盖作者新稿。");
    const operation = workflow.input.operation as Operation;
    const basis = workflow.episodeDevelopmentBasis;
    const content = inspect(workflow.output, basis, operation, workflow);
    const continuation =
      operation === "episode-script"
        ? continuationTarget(workflow.input.projectId, basis)
        : undefined;
    const evidence = sourceEvidence(content, basis, workflow);
    const sourceSnapshot = readSourceSnapshot(workflow.sourceSnapshotId);
    const integrity = workflow.sourceContextIntegrity;
    if (
      !integrity ||
      !sourceSnapshot ||
      sourceSnapshot.id !== integrity.snapshotId ||
      sourceSnapshot.projectId !== workflow.input.projectId ||
      sourceSnapshot.manifestSha256 !== integrity.manifestSha256 ||
      sourceSnapshot.finalPromptSha256 !== integrity.finalPromptSha256 ||
      createHash("sha256").update(sourceSnapshot.finalPrompt).digest("hex") !==
        integrity.finalPromptSha256 ||
      createHash("sha256")
        .update(
          agentContextManifestJSON({
            projectId: sourceSnapshot.projectId,
            destination: sourceSnapshot.destination,
            tokenBudget: sourceSnapshot.tokenBudget,
            entries: sourceSnapshot.entries,
          }),
        )
        .digest("hex") !== integrity.manifestSha256
    )
      fail("原模型上下文的独立冻结摘要未核全，不采用改写快照或补造旧证据。");
    const oldScript = current(
      workflow.input.projectId,
      basis.episode.id,
      "episode-script",
    );
    context.uow.execute((tx) => {
      if (
        tx.get(
          "SELECT id FROM production_episode_results WHERE workflow_id = ?",
          workflow.id,
        )
      )
        return;
      const expected =
        operation === "episode-outline"
          ? basis.request.baseOutlineId
          : operation === "episode-script"
            ? basis.request.baseScriptId
            : basis.request.baseStoryboardId;
      if (
        head(tx, workflow.input.projectId, basis.episode.id, operation) !==
        expected
      )
        fail("当前单集采用头已变化。");
      if (
        operation !== "episode-outline" &&
        head(
          tx,
          workflow.input.projectId,
          basis.episode.id,
          "episode-outline",
        ) !== basis.request.outline!.id
      )
        fail("单集大纲采用头已变化。");
      if (
        operation === "storyboard-package" &&
        head(
          tx,
          workflow.input.projectId,
          basis.episode.id,
          "episode-script",
        ) !== basis.request.script!.id
      )
        fail("正式标准剧本采用头已变化。");
      if (basis.storyboardRedo?.sourceReview)
        assertSourceReview(tx, basis.storyboardRedo.sourceReview);
      const at = new Date().toISOString();
      const version = tx.get<{ next: number }>(
        "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM production_episode_results WHERE project_id = ? AND episode_key = ? AND operation = ?",
        workflow.input.projectId,
        basis.episode.id,
        operation,
      )!.next;
      const value: Stored = {
        id: crypto.randomUUID(),
        projectId: workflow.input.projectId,
        workflowId: workflow.id,
        episodeId: basis.episode.id,
        operation,
        version,
        basis,
        content,
        ...(basis.storyboardRedo
          ? { storyboardRedo: basis.storyboardRedo }
          : {}),
        sourceSnapshotId: workflow.sourceSnapshotId!,
        sourceContextIntegrity: integrity,
        ...(evidence ? { sourceEvidence: evidence } : {}),
        runIds: workflow.runIds,
        adoptedAt: at,
        model: workflow.input.model
          ? Object.fromEntries(
              ["modelId", "providerId", "protocol"].flatMap((key) =>
                typeof workflow.input.model?.[key] === "string"
                  ? [[key, workflow.input.model[key] as string]]
                  : [],
              ),
            )
          : undefined,
      };
      if (content.kind === "episode-script") {
        // This owner writes its AST directly. Never parse/regenerate stable IDs
        // or overwrite old scripts/scenes/shots during a new adoption.
        const insert = (
          kind: string,
          title: string,
          payload: unknown,
          parentId?: string,
        ) => {
          const id = crypto.randomUUID();
          tx.run(
            "INSERT INTO production_records(id,kind,project_id,parent_id,title,payload_json,order_index,version,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
            id,
            kind,
            value.projectId,
            parentId ?? null,
            title,
            JSON.stringify(payload),
            basis.episode.orderIndex,
            at,
            at,
          );
          return id;
        };
        const oldEpisode =
          oldScript?.episodeRecordId &&
          !basis.request.direct &&
          oldScript.basis.request.seasonPlan?.id ===
            basis.request.seasonPlan?.id
            ? tx.get<{ id: string }>(
                "SELECT id FROM production_records WHERE id = ? AND project_id = ? AND kind = 'episodes'",
                oldScript.episodeRecordId,
                value.projectId,
              )
            : undefined;
        const episodeId =
          basis.request.direct?.episode.id ??
          oldEpisode?.id ??
          insert(
            "episodes",
            basis.episode.title,
            {
              seasonPlanId: basis.request.seasonPlan!.id,
              stableEpisodeId: basis.episode.id,
            },
            insert("adaptations", "已采用季纲的分集开发", {
              seasonPlanId: basis.request.seasonPlan!.id,
            }),
          );
        const scriptId = insert(
          "scripts",
          workflow.output!.title || basis.episode.title,
          {
            剧本内容: workflow.output!.content,
            sourceWorkflowId: workflow.id,
            episodeResultId: value.id,
          },
          episodeId,
        );
        tx.run(
          "INSERT INTO screenplay_documents(id,script_record_id,project_id,title,source_format,blocks_json,loss_report_json,version,created_at,updated_at) VALUES (?, ?, ?, ?, 'native', ?, ?, 0, ?, ?)",
          crypto.randomUUID(),
          scriptId,
          value.projectId,
          workflow.output!.title || basis.episode.title,
          JSON.stringify(content.value.blocks),
          JSON.stringify({
            unsupported: [],
            warnings: [],
            preserved: ["稳定剧本块与单集场景映射"],
          }),
          at,
          at,
        );
        value.scriptId = scriptId;
        value.episodeRecordId = episodeId;
        value.scriptDocumentVersion = 0;
      }
      if (content.kind === "storyboard-package") {
        const script = read(tx, basis.request.script!.id);
        const actualDocument = script?.scriptId
          ? tx.get<{ version: number; blocks_json: string }>(
              "SELECT version, blocks_json FROM screenplay_documents WHERE script_record_id = ? AND project_id = ?",
              script.scriptId,
              value.projectId,
            )
          : undefined;
        if (
          !script?.scriptId ||
          !script.episodeRecordId ||
          !actualDocument ||
          actualDocument?.version !== basis.request.baseScriptDocumentVersion ||
          ((fieldMerge ||
            basis.storyboardRedo?.scope ===
              "author-frozen-scene-shot-plan-v1" ||
            basis.storyboardRedo?.scope ===
              "author-frozen-scene-topology-plan-v1") &&
            (script.content.kind !== "episode-script" ||
              hash(JSON.parse(actualDocument.blocks_json)) !==
                hash(script.content.value.blocks)))
        )
          fail("正式剧本或实际文档版本已变化，分镜不会写入。");
        value.scriptId = script.scriptId;
        value.episodeRecordId = script.episodeRecordId;
        value.scriptDocumentVersion = script.scriptDocumentVersion;
        const redo = basis.storyboardRedo;
        const selected = new Set(redo?.shots.map((item) => item.shotId));
        const base = redo ? read(tx, redo.base.id) : undefined;
        const shotPlan =
          redo?.scope === "author-frozen-scene-shot-plan-v1" ? redo : undefined;
        const topologyPlan =
          redo?.scope === "author-frozen-scene-topology-plan-v1"
            ? redo
            : undefined;
        if (topologyPlan) {
          if (!base) fail("原场景拓扑分镜正式包不可核对。");
          const frozen = freezeTopologyReceipt(
            tx,
            base,
            script,
            basis.request.redoTopologyPlan,
            topologyPlan.sourceReview,
          );
          if (hash(frozen) !== hash(topologyPlan))
            fail("采用事务内双正式祖先、实际选择或作者计划变化，不覆盖新稿。");
        }
        if (shotPlan) {
          const outline = read(tx, basis.request.outline!.id);
          if (
            !base ||
            base.content.kind !== "storyboard-package" ||
            script.content.kind !== "episode-script" ||
            outline?.content.kind !== "episode-outline"
          )
            fail("采用事务内原分镜／正式大纲／剧本不可核对。");
          const confirmed = inspectRedoScript(
            tx,
            base,
            script,
            basis.request.redoMode,
            shotPlan.sourceReview,
          );
          const frozen = freezeStoryboardShotPlan({
            request: basis.request.redoShotPlan,
            base: base.content.value,
            bindings: base.productionRecords ?? [],
            outline: outline.content.value,
            script: script.content.value,
            reservedShotIds: reservedStoryboardShotIds(tx, base.projectId),
          });
          if (
            hash(frozen.scenePlans) !== hash(shotPlan.scenePlans) ||
            hash(frozen.selectedShots) !== hash(shotPlan.shots) ||
            hash(confirmed.sceneMappings) !== hash(shotPlan.sceneMappings)
          )
            fail("采用事务内作者镜头计划、旧身份或确认映射变化，不覆盖新稿。");
        }
        if (fieldMerge && !base) fail("字段合并的原正式包在采用事务中缺失。");
        const confirmedStructure =
          fieldMerge?.source.comparison.format ===
          "storyboard-record-field-comparison-v2"
            ? fieldMerge.source.comparison.structure
            : undefined;
        const confirmedShotPlan =
          fieldMerge?.source.comparison.format ===
          "storyboard-record-field-comparison-v3"
            ? fieldMerge.source.comparison.structure
            : undefined;
        const confirmedTopologyPlan =
          fieldMerge?.source.comparison.format ===
          "storyboard-record-field-comparison-v4"
            ? fieldMerge.source.comparison.structure
            : undefined;
        if (
          confirmedTopologyPlan &&
          (!topologyPlan ||
            hash(confirmedTopologyPlan.receipt) !== hash(topologyPlan))
        )
          fail("采用事务字段合并不是原冻结场景拓扑回执。");
        if (
          confirmedShotPlan &&
          (!shotPlan || hash(confirmedShotPlan.receipt) !== hash(shotPlan))
        )
          fail("采用事务内字段合并与原作者镜头计划不符。");
        if (confirmedStructure && base) {
          const confirmed = inspectRedoScript(
            tx,
            base,
            script,
            basis.request.redoMode,
            redo?.sourceReview,
          );
          if (
            hash(confirmed.sceneMappings) !==
            hash(confirmedStructure.receipt.sceneMappings)
          )
            fail("采用事务内人工确认链或场内块映射变化，不覆盖保护结构。");
        }
        const mergePlan =
          fieldMerge && base && content.kind === "storyboard-package"
            ? planProductionRecordFields({
                projectId: base.projectId,
                scriptId: script.scriptId,
                bindings: base.productionRecords ?? [],
                baselines: base.recordBaselines,
                rows: (base.productionRecords ?? []).flatMap((binding) => {
                  const row = tx.get<BaselineRecordRow>(
                    "SELECT id, project_id, kind, version, title, parent_id, order_index, payload_json FROM production_records WHERE id = ? AND project_id = ? AND kind = ?",
                    binding.id,
                    base.projectId,
                    binding.kind,
                  );
                  return row ? [row] : [];
                }),
                selectedRecordIds: redo!.shots.map((item) => item.recordId),
                candidate: fieldMerge.content.value,
                confirmedStructure,
                confirmedShotPlan,
                confirmedTopologyPlan,
              })
            : undefined;
        if (
          mergePlan &&
          productionRecordFieldHash(mergePlan.records) !==
            productionRecordFieldHash(fieldMerge!.source.comparison.records)
        )
          fail("采用事务内实际字段指纹或版本再次变化，不覆盖新稿。");
        const mergedFields = mergePlan
          ? resolveProductionRecordFields(
              mergePlan,
              fieldMerge!.source.request.choices,
            )
          : undefined;
        const actualVersions = new Map(
          mergePlan?.records.map((item) => [item.id, item.currentVersion]),
        );
        if (
          redo &&
          !fieldMerge &&
          base?.recordBaselines !== undefined &&
          recordBaselineObservations(tx, base).records.some(
            (item) => item.state !== "unchanged",
          )
        )
          fail("局部重做实际字段或原基准已变化，不覆盖作者新修改。");
        value.productionRecords = redo
          ? (base?.productionRecords ?? []).map((item) => ({ ...item }))
          : [];
        // Preserve unselected historic bindings exactly. Only rows actually
        // written in this transaction acquire a new baseline; no old human
        // fields are reconstructed from formal model content.
        value.recordBaselines = redo ? [...(base?.recordBaselines ?? [])] : [];
        const recordBaselineById = new Map(
          value.recordBaselines.map((item) => [item.id, item]),
        );
        const insertRecord = (
          kind: "scenes" | "shots",
          stableId: string,
          title: string,
          parentId: string,
          order: number,
          payload: Record<string, unknown>,
        ) => {
          const binding = redo
            ? value.productionRecords!.find(
                (item) => item.kind === kind && item.stableId === stableId,
              )
            : undefined;
          const id = binding?.id ?? crypto.randomUUID();
          const expectedVersion = binding
            ? (actualVersions.get(id) ?? binding.version)
            : undefined;
          const version =
            expectedVersion === undefined ? 0 : expectedVersion + 1;
          const merged = mergedFields?.get(id);
          const row = binding
            ? tx.get<{
                version: number;
                parent_id: string | null;
                payload_json: string;
              }>(
                "SELECT version, parent_id, payload_json FROM production_records WHERE id = ? AND project_id = ? AND kind = ? AND retired_result_id IS NULL",
                id,
                value.projectId,
                kind,
              )
            : undefined;
          const data = JSON.stringify({
            ...((shotPlan || topologyPlan) && row
              ? (JSON.parse(row.payload_json) as Record<string, unknown>)
              : {}),
            ...(merged?.payload ?? payload),
            storyboardResultId: value.id,
            sourceWorkflowId: workflow.id,
            stableId,
          });
          if (redo && binding) {
            if (
              !row ||
              row.version !== expectedVersion ||
              row.parent_id !== parentId
            )
              fail("局部重做实际记录版本或归属冲突，不覆盖新修改。");
            if (merged && (shotPlan || topologyPlan))
              tx.run(
                "UPDATE production_records SET title = ?, payload_json = ?, order_index = ?, version = ?, updated_at = ? WHERE id = ? AND version = ? AND retired_result_id IS NULL",
                merged.title,
                data,
                order,
                version,
                at,
                id,
                expectedVersion!,
              );
            else if (merged)
              tx.run(
                "UPDATE production_records SET title = ?, payload_json = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?",
                merged.title,
                data,
                version,
                at,
                id,
                expectedVersion!,
              );
            else if (shotPlan || topologyPlan)
              tx.run(
                "UPDATE production_records SET payload_json = ?, order_index = ?, version = ?, updated_at = ? WHERE id = ? AND version = ? AND retired_result_id IS NULL",
                data,
                order,
                version,
                at,
                id,
                expectedVersion!,
              );
            else
              tx.run(
                "UPDATE production_records SET payload_json = ?, version = ?, updated_at = ? WHERE id = ? AND version = ? AND retired_result_id IS NULL",
                data,
                version,
                at,
                id,
                expectedVersion!,
              );
            if (
              tx.get<{ count: number }>("SELECT changes() AS count")!.count !==
              1
            )
              fail("实际记录采用 CAS 变化，整个事务回滚。");
            binding.version = version;
          } else {
            if (
              redo &&
              !(topologyPlan
                ? topologyPlan.topologyPlan.scenes.some(
                    (scene) =>
                      scene.mode === "generate" &&
                      (kind === "scenes"
                        ? scene.sceneId === stableId && !scene.retains
                        : scene.shots.some(
                            (shot) => shot.id === stableId && !shot.retains,
                          )),
                  )
                : shotPlan &&
                  kind === "shots" &&
                  shotPlan.scenePlans.some((scene) =>
                    scene.shots.some(
                      (shot) => shot.id === stableId && !shot.retains,
                    ),
                  ))
            )
              fail(
                "新实际记录必须属于作者明确冻结的新场景／镜头，不能补造旧绑定。",
              );
            tx.run(
              "INSERT INTO production_records(id,kind,project_id,parent_id,title,payload_json,order_index,version,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
              id,
              kind,
              value.projectId,
              parentId,
              title,
              data,
              order,
              at,
              at,
            );
            value.productionRecords!.push({ id, stableId, kind, version });
          }
          const actual = tx.get<BaselineRecordRow>(
            "SELECT id, project_id, kind, version, title, parent_id, order_index, payload_json FROM production_records WHERE id = ? AND project_id = ? AND kind = ?",
            id,
            value.projectId,
            kind,
          );
          if (!actual) fail("实际采用记录未保存，不能补造字段基准。");
          const baseline = captureProductionRecordBaseline({
            row: actual,
            binding: { id, stableId, kind, version },
            projectId: value.projectId,
            result: { id: value.id, version: value.version },
          });
          recordBaselineById.set(id, baseline);
          tx.append({
            type: binding ? "production.updated.v1" : "production.created.v1",
            pluginId: "production",
            aggregateType: kind,
            aggregateId: id,
            aggregateVersion: version,
            payload: {
              id,
              projectId: value.projectId,
              kind,
              parentId,
              version,
            },
          });
          return id;
        };
        for (const [index, scene] of content.value.scenes.entries()) {
          if (
            redo &&
            !(topologyPlan
              ? topologyPlan.topologyPlan.scenes.some(
                  (plan) =>
                    plan.sceneId === scene.sceneId && plan.mode === "generate",
                )
              : shotPlan
                ? shotPlan.scenePlans.some(
                    (plan) => plan.sceneId === scene.sceneId,
                  )
                : scene.shots.some((shot) => selected.has(shot.id)))
          )
            continue;
          const sceneId = insertRecord(
            "scenes",
            scene.sceneId,
            `场景 ${index + 1}`,
            script.scriptId,
            index,
            {
              scriptBlockIds: scene.scriptBlockIds,
              场景动作: scene.shots.map((shot) => shot.visualAction).join("\n"),
              视觉方向: content.value.visualDirection,
            },
          );
          for (const shot of scene.shots.filter(
            (item) =>
              !redo ||
              Boolean(shotPlan || topologyPlan) ||
              selected.has(item.id),
          ))
            insertRecord(
              "shots",
              shot.id,
              `镜头 ${shot.orderIndex + 1}`,
              sceneId,
              shot.orderIndex,
              {
                sourceBlockIds: shot.sourceBlockIds,
                镜头序号: shot.orderIndex + 1,
                镜头描述: shot.visualAction,
                构图: shot.composition,
                机位: shot.camera,
                运镜: shot.movement,
                生成提示: shot.prompt,
                负面提示: shot.negativePrompt,
                时长: shot.durationSeconds,
                声音: shot.sound,
                assetIds: shot.assetIds,
                角色: shot.assetIds
                  .flatMap((id) =>
                    content.value.assets
                      .filter(
                        (asset) =>
                          asset.id === id && asset.kind === "character",
                      )
                      .map((asset) => asset.title),
                  )
                  .join("、"),
              },
            );
        }
        if (shotPlan) {
          const desired = new Set(
            shotPlan.scenePlans.flatMap((scene) =>
              scene.shots.map((shot) => shot.id),
            ),
          );
          for (const old of shotPlan.shots.filter(
            (shot) => !desired.has(shot.shotId),
          )) {
            const expectedVersion =
              actualVersions.get(old.recordId) ?? old.version;
            const row = tx.get<{ version: number; parent_id: string | null }>(
              "SELECT version, parent_id FROM production_records WHERE id = ? AND project_id = ? AND kind = 'shots' AND retired_result_id IS NULL",
              old.recordId,
              value.projectId,
            );
            const scene = shotPlan.scenePlans.find(
              (plan) =>
                base!.content.kind === "storyboard-package" &&
                base!.content.value.scenes
                  .find((entry) => entry.sceneId === plan.sceneId)
                  ?.shots.some((shot) => shot.id === old.shotId),
            );
            if (
              !row ||
              row.version !== expectedVersion ||
              !scene ||
              row.parent_id !== scene.recordId
            )
              fail("将退役镜头的实际版本／父级变化，整个采用事务回滚。");
            tx.run(
              "UPDATE production_records SET retired_result_id = ?, retired_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND retired_result_id IS NULL",
              value.id,
              at,
              at,
              old.recordId,
              expectedVersion,
            );
            value.productionRecords = value.productionRecords!.filter(
              (record) => record.id !== old.recordId,
            );
            recordBaselineById.delete(old.recordId);
            tx.append({
              type: "production.updated.v1",
              pluginId: "production",
              aggregateType: "shots",
              aggregateId: old.recordId,
              aggregateVersion: expectedVersion + 1,
              payload: {
                id: old.recordId,
                projectId: value.projectId,
                kind: "shots",
                parentId: row.parent_id,
                version: expectedVersion + 1,
                retiredByResultId: value.id,
              },
            });
          }
        }
        if (topologyPlan) {
          // Explicit retirements keep original title/payload/parent/order and
          // immutable media/result history. Retire children before scenes.
          const retire = (
            kind: "shots" | "scenes",
            old: { recordId: string; version: number },
            parentId: string,
          ) => {
            const expectedVersion =
                actualVersions.get(old.recordId) ?? old.version,
              row = tx.get<{ version: number; parent_id: string | null }>(
                "SELECT version, parent_id FROM production_records WHERE id = ? AND project_id = ? AND kind = ? AND retired_result_id IS NULL",
                old.recordId,
                value.projectId,
                kind,
              );
            if (
              !row ||
              row.version !== expectedVersion ||
              row.parent_id !== parentId
            )
              fail("拓扑退役实际身份、版本或父级变化，整个采用事务回滚。");
            if (
              kind === "scenes" &&
              tx.get(
                "SELECT id FROM production_records WHERE project_id = ? AND parent_id = ? AND kind = 'shots' AND retired_result_id IS NULL",
                value.projectId,
                old.recordId,
              )
            )
              fail("退役场景仍有未明确退役实际镜头，不能隐式退役其他数据。");
            tx.run(
              "UPDATE production_records SET retired_result_id = ?, retired_at = ?, retired_reason = 'author-scene-topology-plan', version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND retired_result_id IS NULL",
              value.id,
              at,
              at,
              old.recordId,
              expectedVersion,
            );
            if (
              tx.get<{ count: number }>("SELECT changes() AS count")!.count !==
              1
            )
              fail("场景拓扑退役 CAS 变化，回滚全部采用。");
            value.productionRecords = value.productionRecords!.filter(
              (binding) => binding.id !== old.recordId,
            );
            recordBaselineById.delete(old.recordId);
            tx.append({
              type: "production.updated.v1",
              pluginId: "production",
              aggregateType: kind,
              aggregateId: old.recordId,
              aggregateVersion: expectedVersion + 1,
              payload: {
                id: old.recordId,
                projectId: value.projectId,
                kind,
                parentId,
                version: expectedVersion + 1,
                retiredByResultId: value.id,
              },
            });
          };
          for (const old of topologyPlan.topologyPlan.retiredShots) {
            if (base?.content.kind !== "storyboard-package")
              fail("原退役镜头历史不可核对。");
            const scene = base.content.value.scenes.find((scene) =>
                scene.shots.some((shot) => shot.id === old.shotId),
              ),
              binding = base.productionRecords?.find(
                (entry) =>
                  entry.kind === "scenes" && entry.stableId === scene?.sceneId,
              );
            if (!binding) fail("原退役镜头实际场景不可核对。");
            retire("shots", old, binding.id);
          }
          for (const old of topologyPlan.topologyPlan.retiredScenes)
            retire("scenes", old, script.scriptId);
        }
        value.recordBaselines = [...recordBaselineById.values()];
        if (redo)
          tx.append({
            type: "production.storyboard-shots-redone.v1",
            pluginId: "production",
            aggregateType: "episode-result",
            aggregateId: value.id,
            aggregateVersion: version,
            payload: {
              id: value.id,
              projectId: value.projectId,
              episodeId: value.episodeId,
              baseResultId: redo.base.id,
              shots: redo.shots.map((item) => ({
                id: item.recordId,
                stableId: item.shotId,
                previousVersion:
                  actualVersions.get(item.recordId) ?? item.version,
                version:
                  (actualVersions.get(item.recordId) ?? item.version) + 1,
              })),
            },
          });
      }
      tx.run(
        "INSERT INTO production_episode_results(id,project_id,episode_key,operation,adoption_key,version,value_json,adopted_at,workflow_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        value.id,
        value.projectId,
        value.episodeId,
        operation,
        workflow.id,
        version,
        JSON.stringify(value),
        at,
        workflow.id,
      );
      tx.run(
        "INSERT INTO production_episode_result_heads VALUES (?, ?, ?, ?) ON CONFLICT(project_id,episode_key,operation) DO UPDATE SET result_id = excluded.result_id",
        value.projectId,
        value.episodeId,
        operation,
        value.id,
      );
      tx.run(
        "INSERT INTO production_creation_adoptions VALUES (?, ?, ?, ?)",
        workflow.id,
        JSON.stringify({ episodeResultId: value.id, scriptId: value.scriptId }),
        JSON.stringify({ episodeResultId: expected ?? null }),
        at,
      );
      tx.append({
        type: `production.${operation}-adopted.v1`,
        pluginId: "production",
        aggregateType: "episode-result",
        aggregateId: value.id,
        aggregateVersion: version,
        payload: {
          id: value.id,
          projectId: value.projectId,
          workflowId: workflow.id,
          episodeId: value.episodeId,
          operation,
          version,
          ...(value.scriptId ? { scriptId: value.scriptId } : {}),
        },
      });
      if (operation === "episode-script")
        tx.append({
          type: "production.script-result-adopted.v1",
          pluginId: "production",
          aggregateType: "episode-result",
          aggregateId: value.id,
          aggregateVersion: version,
          payload: CreativeOutcomeFactSchema.parse({
            eventVersion: 1,
            kind: "adaptation.script-adopted",
            workflowPath: "adaptation",
            projectId: value.projectId,
            objectId: value.id,
            workflowId: workflow.id,
            ...(continuation ? { continuationTarget: continuation } : {}),
            ...(workflow.previewId && content.kind === "episode-script"
              ? {
                  candidate: {
                    id: workflow.previewId,
                    contentFingerprint: createHash("sha256")
                      .update(canonicalCreativeMetricJSON(content.value))
                      .digest("hex"),
                  },
                }
              : {}),
            formalVersions: [{ kind: "episode-script", id: value.id, version }],
            sourceVersions: workflow.sources.map(
              ({ id, version: sourceVersion }) => ({
                id,
                version: sourceVersion,
              }),
            ),
            evidenceKind: "human",
            modelEvidence: "unknown",
            qualityState: "unverified",
            resultStatus: "adopted",
          }),
        });
    });
  };
  const result = (workflowId: string) =>
    context.uow.execute(
      (tx) =>
        tx.get<{ id: string }>(
          "SELECT id FROM production_episode_results WHERE workflow_id = ?",
          workflowId,
        )?.id,
    );
  context.effect(
    () =>
      provideService(context, PRODUCTION_EPISODE_DEVELOPMENT_SERVICE, {
        prepare,
        validate,
        apply,
        compareRecords,
        mergeRecords,
        result,
        get,
        observeStoryboardShot,
        current: (projectId, episodeId, operation) => {
          const value = current(projectId, episodeId, operation);
          return value ? decode(value) : undefined;
        },
      }),
    `service:${PRODUCTION_EPISODE_DEVELOPMENT_SERVICE.id}`,
  );
  const pageQuery = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  // An explicit later author edit may replace the actual document/record
  // fingerprint, not its adopted source history. Capture owner ancestry first,
  // then read all original Agents snapshots and current policy outside our UOW.
  // The transient metadata-only probe creates no preview, snapshot or model run.
  const revisionSourceStatus = (source: Stored): 200 | 409 | 503 => {
    try {
      const captured = context.uow.execute((tx) => {
        const outlineRef = source.basis.request.outline;
        const outline = outlineRef && read(tx, outlineRef.id);
        if (!outline || outline.version !== outlineRef?.version)
          throw new EpisodeFormalAncestryError(
            "Original paired outline unavailable",
          );
        if (
          (source.origin === undefined || source.origin === "model") &&
          (outline.origin === undefined || outline.origin === "model")
        )
          return undefined;
        const raw = <T>(table: string, id: string): T | undefined => {
          const row = tx.get<{ value_json: string }>(
            `SELECT value_json FROM ${table} WHERE id=?`,
            id,
          );
          return row ? (JSON.parse(row.value_json) as T) : undefined;
        };
        const ancestry = inspectEpisodeFormalAncestry({
          script: source,
          outline,
          read: (id) => read(tx, id),
          readScriptRevision: (id) =>
            raw<EpisodeScriptRevision>(
              "production_episode_script_revisions",
              id,
            ),
          readTopologyRevision: (id) =>
            raw<EpisodeTopologyRevision>(
              "production_episode_topology_revisions",
              id,
            ),
          readSourceRevision: (id) =>
            raw<EpisodeSourceRevision>(
              "production_episode_source_revisions",
              id,
            ),
          formalReference: (value) => frozenRef(resultReference(value)),
        });
        if (!ancestry.sourcePreviews.length) return undefined;
        const document = tx.get<{ id: string }>(
          "SELECT id FROM screenplay_documents WHERE script_record_id=? AND project_id=?",
          source.scriptId,
          source.projectId,
        );
        if (
          !document ||
          (ancestry.documentId && ancestry.documentId !== document.id)
        )
          throw new EpisodeFormalAncestryError(
            "Actual original manuscript unavailable",
          );
        for (const branch of ancestry.branches) {
          if (!branch.documentId) continue;
          const originalDocument = tx.get<{ id: string }>(
            "SELECT id FROM screenplay_documents WHERE script_record_id=? AND project_id=?",
            branch.scriptId,
            source.projectId,
          );
          if (originalDocument?.id !== branch.documentId)
            throw new EpisodeFormalAncestryError(
              "Original provenance manuscript unavailable",
            );
        }
        const records = [
          ...new Set(ancestry.branches.map((branch) => branch.scriptId)),
        ].map((id) => {
          const record = tx.get<{
            id: string;
            version: number;
            parent_id: string | null;
          }>(
            "SELECT id,version,parent_id FROM production_records WHERE id=? AND project_id=? AND kind='scripts' AND retired_at IS NULL",
            id,
            source.projectId,
          );
          if (!record || record.parent_id !== source.episodeRecordId)
            throw new EpisodeFormalAncestryError(
              "Actual source record unavailable",
            );
          return {
            sourceId: record.id,
            sourceVersion: record.version,
            fieldPath: `/production/${record.id}`,
          };
        });
        return { ancestry, records };
      });
      // Keep ordinary historical manuscript confirmation compatible. This
      // additional policy gate is for an actual adopted source-revision chain.
      if (!captured) return 200;
      const service = optionalService(context, AGENT_CONTEXT_SERVICE);
      if (!service?.previewCreation) return 503;
      const dependencies = [
        ...new Map(
          [
            ...episodeAncestryPolicyDependencies(captured.ancestry, (id) =>
              service.getSnapshot(id),
            ),
            ...captured.records,
          ].map((value) => [JSON.stringify(value), value]),
        ).values(),
      ];
      if (dependencies.length > 2000) return 409;
      const checked = service.previewCreation(
        {
          projectId: source.projectId,
          runIntent: "author-manuscript-confirmation",
          basePrompt:
            "Verify original author-source policy; no model or content generation.",
          tokenBudget: 1024,
          destination: { kind: "local", provider: "author-manuscript-review" },
          temporaryOverrides: [],
        },
        [
          {
            sourceKind: "production",
            sourceId: source.id,
            sourceVersion: source.version,
            fieldPath: `/production/${source.id}`,
            value: { id: source.id, version: source.version },
            sensitivity: "project",
            policyDependencies: dependencies,
          },
        ],
      );
      return checked.entries.length === 1 &&
        checked.entries[0]?.included === true
        ? 200
        : 409;
    } catch (error) {
      return error instanceof EpisodeFormalAncestryError ? 409 : 503;
    }
  };
  registerEpisodeScriptRevisions(context, {
    read,
    head,
    sourceReasons,
    continuationTarget,
    revisionSourceStatus,
  });
  registerEpisodeSourceRevisions(context, {
    read,
    head,
    continuationTarget,
    resultReference,
    frozenRef,
    freshSources: (projectId, request) => {
      const origin = request.direct
        ? directSources(projectId, request.direct)
        : adaptationSources({ projectId }, request);
      const approved = bible(projectId);
      if (!approved.length)
        fail("来源确认须保留实际已批准Story Bible，不补造设定。");
      const references = [...origin.references, ...approved];
      const basis = EpisodeDevelopmentBasisSchema.parse({
        request,
        diagnosis: origin.diagnosis,
        strategy: "strategy" in origin ? origin.strategy : undefined,
        authorIntent: origin.authorIntent,
        episode: origin.episode,
        chapters: origin.chapters,
        references: references.map(frozenRef),
        ...("sourceBasis" in origin
          ? {
              sourceBasis: origin.sourceBasis,
              contextChapters: origin.contextChapters,
            }
          : {}),
      });
      return { basis, references };
    },
  });
  const attributionImpactReader = registerStoryboardAttributions(context, {
    read,
    head,
    sourceReasons,
  });
  registerEpisodeTopologyRevisions(context, {
    read,
    head,
    sourceReasons,
    continuationTarget,
    resultReference,
    frozenRef,
    revisionSourceStatus,
  });
  type HttpContext = {
    req: {
      param(name: string): string;
      query(name: string): string | undefined;
      header(name: string): string | undefined;
    };
    json(value: unknown): Response;
    body(value: null, status: 304): Response;
    header(name: string, value: string): void;
  };
  const add = (
    path: `/api/v2/${string}`,
    operationId: string,
    schema: z.ZodType,
    handler: (c: HttpContext) => unknown,
    paged = false,
    querySchema?: typeof StoryboardAttributionImpactQuerySchema,
  ) => {
    const route = defineRouteContribution({
      id: `production:${operationId}`,
      pluginId: "production",
      method: "get",
      path,
      operationId,
      declaration: createRoute({
        method: "get",
        path,
        operationId,
        tags: ["episode-development"],
        request: {
          params: path.includes("{projectId}")
            ? z.object({ projectId: z.string().uuid() })
            : z.object({ id: z.string().uuid() }),
          ...(querySchema
            ? { query: querySchema }
            : paged
              ? { query: pageQuery }
              : {}),
        },
        responses: {
          200: {
            description: "Explicitly adopted episode development",
            content: { "application/json": { schema } },
          },
          ...(operationId === "episodeDevelopments.summaries"
            ? { 304: { description: "Adoption and source metadata unchanged" } }
            : {}),
          ...Object.fromEntries(
            [
              400,
              404,
              409,
              ...(operationId === "episodeDevelopments.impact" ? [503] : []),
            ].map((status) => [
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
      handler: (c: HttpContext) => {
        try {
          const value = handler(c);
          if (operationId === "episodeDevelopments.summaries") {
            const etag = `"${hash(value)}"`;
            c.header("ETag", etag);
            if (c.req.header("If-None-Match") === etag)
              return c.body(null, 304);
          }
          if (value && typeof value === "object" && "version" in value)
            c.header("ETag", `"${value.version}"`);
          return c.json(value);
        } catch (error) {
          const status =
            error instanceof EpisodeError
              ? error.status
              : error instanceof z.ZodError
                ? 400
                : 409;
          const detail =
            error instanceof Error ? error.message : "单集读取未完成。";
          return new Response(
            JSON.stringify({
              type: "https://dramaip.local/problems/episode-development",
              title: detail,
              detail,
              status,
              code:
                status === 404
                  ? "NOT_FOUND"
                  : status === 400
                    ? "VALIDATION_ERROR"
                    : "CONFLICT",
              traceId: crypto.randomUUID(),
            }),
            { status, headers: { "Content-Type": "application/problem+json" } },
          );
        }
      },
    });
    context.effect(() => context.http.register(route), `route:${route.id}`);
  };
  add(
    "/api/v2/projects/{projectId}/episode-development-sources",
    "episodeDevelopments.sources",
    EpisodeDevelopmentCatalogSchema,
    (c) => catalog(c.req.param("projectId")),
  );
  add(
    "/api/v2/episode-development/{id}",
    "episodeDevelopments.get",
    EpisodeDevelopmentResultSchema,
    (c) => {
      const value = get(c.req.param("id"));
      if (!value) throw new EpisodeError(404, "单集正式结果不存在。");
      return value;
    },
  );
  add(
    "/api/v2/episode-development/{id}/impact",
    "episodeDevelopments.impact",
    EpisodeDevelopmentImpactSchema,
    (c) => {
      const selected = StoryboardAttributionImpactQuerySchema.parse({
        attributionId: c.req.query("attributionId"),
        attributionVersion: c.req.query("attributionVersion"),
      });
      const value = impact(
        c.req.param("id"),
        selected.attributionId === undefined
          ? undefined
          : {
              id: selected.attributionId,
              version: selected.attributionVersion!,
            },
      );
      c.header("ETag", `"${value.snapshotHash}"`);
      return value;
    },
    false,
    StoryboardAttributionImpactQuerySchema,
  );
  const listResults = (c: HttpContext, summary = false) => {
    const id = c.req.param("projectId");
    project(id);
    const query = pageQuery.parse({
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    const rows = context.uow.execute((tx) => {
      const cursor = query.cursor ? read(tx, query.cursor) : undefined;
      if (query.cursor && (!cursor || cursor.projectId !== id))
        throw new EpisodeError(400, "游标不属于本项目。");
      return cursor
        ? tx.all<{ value_json: string }>(
            "SELECT value_json FROM production_episode_results WHERE project_id = ? AND (adopted_at < ? OR (adopted_at = ? AND id < ?)) ORDER BY adopted_at DESC, id DESC LIMIT ?",
            id,
            cursor.adoptedAt,
            cursor.adoptedAt,
            cursor.id,
            query.limit + 1,
          )
        : tx.all<{ value_json: string }>(
            "SELECT value_json FROM production_episode_results WHERE project_id = ? ORDER BY adopted_at DESC, id DESC LIMIT ?",
            id,
            query.limit + 1,
          );
    });
    const items = rows
      .slice(0, query.limit)
      .map((row) => decode(JSON.parse(row.value_json) as Stored));
    return {
      items: summary
        ? items.map((item) =>
            EpisodeDevelopmentSummarySchema.parse({
              id: item.id,
              projectId: item.projectId,
              workflowId: item.workflowId,
              origin: item.origin ?? "model",
              episodeId: item.episodeId,
              operation: item.operation,
              version: item.version,
              adoptedAt: item.adoptedAt,
              isCurrent: item.isCurrent,
              sourceState: item.sourceState,
              staleReasonCount: item.staleReasons.length,
            }),
          )
        : items,
      ...(rows.length > query.limit ? { nextCursor: items.at(-1)!.id } : {}),
    };
  };
  add(
    "/api/v2/projects/{projectId}/episode-development",
    "episodeDevelopments.list",
    EpisodeDevelopmentPageSchema,
    (c) => listResults(c),
    true,
  );
  add(
    "/api/v2/projects/{projectId}/episode-development-summaries",
    "episodeDevelopments.summaries",
    EpisodeDevelopmentSummaryPageSchema,
    (c) => listResults(c, true),
    true,
  );
}
