import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { PRODUCTION_ADAPTATION_STRATEGY_SERVICE } from "@dramaip/contracts/production";
import {
  strategyDiagnosisReference,
  selectedAdaptationStrategyReference,
} from "./adaptation-strategy-content.js";
import {
  CreativeOutcomeFactSchema,
  canonicalCreativeMetricJSON,
} from "@dramaip/contracts/insights";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  observedCreativeSourceChange,
  observedCreativeChapterChanges,
  observedCreativeWholeBookCollection,
  recordProductionCreativeRejection,
} from "./creative-rejections.js";
import { AGENT_CONTEXT_SERVICE } from "@dramaip/contracts/agent-context";
import {
  WORKSPACE_PROJECT_SERVICE,
  WORKSPACE_AUTHOR_INTENT_SERVICE,
} from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import {
  AUTHOR_INTENT_CREATION_PROMPT,
  CREATION_WORKFLOW_SERVICE,
  creationAuthorIntent,
  creationReference,
  type CreationInput,
  type CreationContent,
  type CreationWorkflow,
  type CreationIssue,
  WRITING_NARRATIVE_SOURCE_SERVICE,
  narrativeSourceSelection,
  narrativeSourceIdentity,
} from "@dramaip/contracts/creation";
import {
  assertAdaptationSourceSnapshot,
  adaptationExpressionScope,
} from "./narrative-sources.js";
import {
  PRODUCTION_DIAGNOSIS_SERVICE,
  PRODUCTION_SEASON_PLAN_SERVICE,
  SeasonPlanSchema,
  SeasonPlanContentSchema,
  SeasonPlanRequestSchema,
  SeasonPlanCatalogSchema,
  SeasonPlanPageSchema,
  SeasonPlanSummarySchema,
  SeasonPlanSummaryPageSchema,
  SeasonPlanAdoptInputSchema,
  SeasonPlanReorderInputSchema,
  type AdaptationDiagnosis,
  type SeasonPlan,
  type SeasonPlanBasis,
} from "@dramaip/contracts/production";
import {
  optionalService,
  provideService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import {
  inspectSeasonPlanContent,
  reorderSeasonPlanContent,
} from "./season-plan-content.js";

export const seasonPlanMigration: PluginMigration = {
  id: "production.0006.season-plans",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0005.adaptation-diagnoses"],
  sql: `CREATE TABLE production_season_plans (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL, origin TEXT NOT NULL, version INTEGER NOT NULL,
    state_version INTEGER NOT NULL, status TEXT NOT NULL, value_json TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, version)
  );
  CREATE UNIQUE INDEX production_season_plan_model ON production_season_plans(workflow_id) WHERE origin = 'model';
  CREATE INDEX production_season_plan_page ON production_season_plans(project_id, created_at DESC, id DESC);
  CREATE INDEX production_season_plan_workflow ON production_season_plans(workflow_id, version DESC);
  CREATE TABLE production_season_plan_heads (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, plan_id TEXT NOT NULL REFERENCES production_season_plans(id));
  CREATE TABLE production_season_plan_requests (request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES production_season_plans(id), status INTEGER NOT NULL, detail TEXT);`,
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bodyHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Stored = Omit<SeasonPlan, "isCurrent" | "sourceState" | "staleReasons">;
type Row = { value_json: string };
class PlanError extends Error {
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
    query(name: string): string | undefined;
    header(name: string): string | undefined;
    json(): Promise<unknown>;
  };
  header(name: string, value: string): void;
  json(value: unknown, status?: number): Response;
};

// Only the adopted strategy and narrative evidence enter this separately
// policy-controlled reference. Local omitted chapter metadata never enters it.
function diagnosisReference(value: AdaptationDiagnosis) {
  const { strategies, ...narrative } = value.content;
  return creationReference("adaptation-diagnosis", {
    id: value.id,
    version: value.version,
    projectId: value.projectId,
    title: "已采用改编诊断与唯一策略",
    content: {
      ...narrative,
      strategy: strategies.find(
        (item) => item.id === value.selectedStrategyId,
      )!,
    },
  });
}

export function registerSeasonPlans(context: PluginContext) {
  const project = (id: string) => {
    const value = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(id);
    if (!value) throw new PlanError(404, "项目不存在。");
    return value;
  };
  const head = (tx: UnitOfWorkTransaction, projectId: string) =>
    tx.get<{ plan_id: string }>(
      "SELECT plan_id FROM production_season_plan_heads WHERE project_id = ?",
      projectId,
    )?.plan_id;
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<Row>(
      "SELECT value_json FROM production_season_plans WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const diagnosis = (projectId: string) =>
    optionalService(context, PRODUCTION_DIAGNOSIS_SERVICE)?.current(projectId);
  const strategy = (projectId: string) =>
    optionalService(context, PRODUCTION_ADAPTATION_STRATEGY_SERVICE)?.current(
      projectId,
    );
  // Peer service reads must happen outside the Production UnitOfWork.
  const sourceReview = (value: Stored) => {
    const current = diagnosis(value.projectId);
    const selected = strategy(value.projectId);
    const reasons: string[] = [];
    if (value.basis.strategy) {
      if (
        !selected ||
        selected.status !== "adopted" ||
        !selected.isCurrent ||
        selected.sourceState !== "current" ||
        selected.id !== value.basis.strategy.id ||
        selected.version !== value.basis.strategy.version ||
        selected.selectedOptionId !== value.basis.strategy.optionId
      )
        reasons.push("当前独立策略已变化或来源已失效");
      else if (
        hash(selectedAdaptationStrategyReference(selected).value) !==
        value.basis.strategyContentHash
      )
        reasons.push("独立策略内容与冻结基准不符");
    } else if (selected)
      reasons.push("已有正式独立策略；旧诊断内策略仅代表历史基准");
    if (
      !current ||
      current.status !== "adopted" ||
      !current.isCurrent ||
      current.id !== value.basis.diagnosis.id ||
      current.version !== value.basis.diagnosis.version ||
      (!value.basis.strategy &&
        current.selectedStrategyId !== value.basis.diagnosis.strategyId)
    )
      reasons.push("当前采用诊断或唯一策略已变化");
    else {
      if (current.sourceState !== "current")
        reasons.push(...current.staleReasons);
      if (
        hash(
          (value.basis.strategy
            ? strategyDiagnosisReference(current)
            : diagnosisReference(current)
          ).value,
        ) !== value.basis.diagnosisContentHash
      )
        reasons.push("已采用诊断内容与冻结基准不符");
    }
    const intent = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    )?.current(value.projectId);
    if (
      !intent ||
      intent.id !== value.basis.authorIntent.id ||
      intent.version !== value.basis.authorIntent.version
    )
      reasons.push("正式作者意图已变化");
    const currentChapters = optionalService(
      context,
      WRITING_CHAPTER_SERVICE,
    )?.list(value.projectId);
    const chapterCollection = observedCreativeWholeBookCollection(
      value.projectId,
      value.basis,
      currentChapters,
    );
    const changes = [
      ...observedCreativeSourceChange(
        "production",
        value.basis.diagnosis,
        current?.projectId === value.projectId &&
          current.status === "adopted" &&
          current.isCurrent
          ? current
          : undefined,
      ),
      ...(value.basis.strategy
        ? observedCreativeSourceChange(
            "production",
            value.basis.strategy,
            selected?.projectId === value.projectId &&
              selected.status === "adopted" &&
              selected.isCurrent
              ? selected
              : undefined,
          )
        : []),
      ...observedCreativeSourceChange(
        "author_intent",
        value.basis.authorIntent,
        intent?.projectId === value.projectId ? intent : undefined,
      ),
      ...observedCreativeChapterChanges(value.basis.chapters, currentChapters),
    ];
    if ((changes.length || chapterCollection) && !reasons.length)
      reasons.push("已核对冻结来源版本已变化");
    return { reasons: [...new Set(reasons)], changes, chapterCollection };
  };
  const decode = (value: Stored): SeasonPlan => {
    const currentId = context.uow.execute((tx) => head(tx, value.projectId));
    const staleReasons = sourceReview(value).reasons;
    if (value.status === "pending" && currentId !== value.basis.baseAdoptedId)
      staleReasons.push("当前已采用整季方案已变化");
    const workflow = optionalService(context, CREATION_WORKFLOW_SERVICE)?.get(
      value.workflowId,
    );
    if (
      value.status === "pending" &&
      (!workflow || !["awaiting-review", "applied"].includes(workflow.stage))
    )
      staleReasons.push("对应工作流已处理或未完成审阅");
    return SeasonPlanSchema.parse({
      ...value,
      isCurrent: value.id === currentId,
      sourceState: staleReasons.length ? "stale" : "current",
      staleReasons,
    });
  };
  const get = (id: string) => {
    const value = context.uow.execute((tx) => read(tx, id));
    return value ? decode(value) : undefined;
  };
  const catalog = (id: string) => {
    project(id);
    const current = diagnosis(id);
    const selected = strategy(id);
    const independent =
      selected?.status === "adopted" &&
      selected.isCurrent &&
      selected.sourceState === "current" &&
      selected.selectedOptionId &&
      selected.basis.diagnosis.id === current?.id &&
      selected.basis.diagnosis.version === current?.version;
    return {
      projectId: id,
      ...(current?.status === "adopted" &&
      current.isCurrent &&
      current.sourceState === "current" &&
      (independent || current.selectedStrategyId) &&
      (!selected || independent)
        ? {
            diagnosis: {
              id: current.id,
              version: current.version,
              strategyId: independent
                ? selected!.selectedOptionId!
                : current.selectedStrategyId,
            },
          }
        : {}),
      ...(independent
        ? {
            strategy: {
              id: selected!.id,
              version: selected!.version,
              optionId: selected!.selectedOptionId!,
            },
          }
        : {}),
      strategyPath:
        selected || !current?.selectedStrategyId
          ? ("independent" as const)
          : ("legacy-diagnosis" as const),
      adoptedPlanId: context.uow.execute((tx) => head(tx, id)),
    };
  };
  const event = (tx: UnitOfWorkTransaction, value: Stored) =>
    tx.append({
      type: `production.season-plan-${value.status === "pending" ? "previewed" : value.status}.v1`,
      pluginId: "production",
      aggregateType: "season-plan",
      aggregateId: value.id,
      aggregateVersion: value.stateVersion,
      payload: {
        id: value.id,
        projectId: value.projectId,
        workflowId: value.workflowId,
        version: value.version,
        status: value.status,
        origin: value.origin,
        ...(value.sourcePlanId ? { sourcePlanId: value.sourcePlanId } : {}),
      },
    });
  const prepare = (input: CreationInput) => {
    const request = SeasonPlanRequestSchema.parse(input.seasonPlanRequest);
    if (input.targetId || input.sourceIds.length || input.diagnosisRequest)
      throw new PlanError(
        409,
        "整季方案只继承已采用诊断，不使用旧目标或另行扩张来源。",
      );
    const available = catalog(input.projectId);
    if (
      !available.diagnosis ||
      hash(available.diagnosis) !== hash(request.diagnosis) ||
      hash(available.strategy ?? null) !== hash(request.strategy ?? null) ||
      available.adoptedPlanId !== request.baseAdoptedId
    )
      throw new PlanError(
        409,
        "已采用诊断、策略或整季方案已变化，请重新确认。",
      );
    const source = diagnosis(input.projectId)!;
    const intentService = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    );
    const currentIntent = intentService?.current(input.projectId);
    if (
      !currentIntent ||
      currentIntent.id !== source.authorIntent.id ||
      currentIntent.version !== source.authorIntent.version
    )
      throw new PlanError(409, "诊断引用的正式作者意图已变化。");
    const intent = creationAuthorIntent(input.projectId, currentIntent);
    const selected = request.strategy ? strategy(input.projectId)! : undefined;
    const reference = selected
      ? strategyDiagnosisReference(source)
      : diagnosisReference(source);
    const strategyReference = selected
      ? selectedAdaptationStrategyReference(selected)
      : undefined;
    const { baseAdoptedId: _oldDiagnosisHead, ...scope } = source.basis;
    const basis: SeasonPlanBasis = {
      ...scope,
      diagnosis: request.diagnosis,
      diagnosisContentHash: hash(reference.value),
      ...(strategyReference
        ? {
            strategy: request.strategy,
            strategyContentHash: hash(strategyReference.value),
          }
        : {}),
      authorIntent: source.authorIntent,
      baseAdoptedId: request.baseAdoptedId,
    };
    const chapterService = optionalService(context, WRITING_CHAPTER_SERVICE);
    if (!chapterService) throw new PlanError(409, "来源章节服务未启用。");
    const chapters = chapterService.list(input.projectId);
    const references = basis.sourceBasis
      ? (() => {
          const compiler = optionalService(
            context,
            WRITING_NARRATIVE_SOURCE_SERVICE,
          );
          if (!compiler) throw new PlanError(409, "明确改编来源服务未启用。");
          const result = compiler.compile(
            input.projectId,
            basis.chapters.map(({ id, version }) => ({ id, version })),
            narrativeSourceSelection(basis.sourceBasis),
          );
          if (
            narrativeSourceIdentity(result.basis) !==
            narrativeSourceIdentity(basis.sourceBasis)
          )
            throw new PlanError(
              409,
              "诊断采用的实际表达已变化，不能换源生成季纲。",
            );
          return result.references;
        })()
      : basis.chapters.map((source) => {
          const item = chapters.find((item) => item.id === source.id);
          if (
            !item ||
            item.version !== source.version ||
            item.orderIndex !== source.orderIndex ||
            bodyHash(item.content) !== source.contentHash
          )
            throw new PlanError(409, "诊断的已读来源已变化，请重新诊断。");
          return creationReference("chapter", {
            id: item.id,
            version: item.version,
            title: item.title,
            orderIndex: item.orderIndex,
            content: item.content,
          });
        });
    if (basis.sourceBasis)
      reference.policyDependencies = [
        ...new Map(
          references
            .flatMap((item) => [
              {
                sourceId: item.sourceId,
                sourceVersion: item.sourceVersion,
                fieldPath: item.fieldPath,
              },
              ...(item.policyDependencies ?? []),
            ])
            .map((item) => [item.fieldPath, item]),
        ).values(),
      ];
    const modelScope = {
      scope: basis.scope,
      chapters: basis.chapters.map(({ id, version }) => ({ id, version })),
      omittedChapterCount: basis.omittedChapters.length,
      diagnosis: basis.diagnosis,
      target: basis.target,
      ...(basis.sourceBasis
        ? { actualExpressions: adaptationExpressionScope(basis.sourceBasis) }
        : {}),
    };
    return {
      authorIntent: intent.authorIntent,
      seasonPlanBasis: basis,
      references: [
        ...intent.references,
        reference,
        ...(strategyReference ? [strategyReference] : []),
        ...references,
      ],
      sources: [
        ...intent.sources,
        {
          kind: "adaptation-diagnosis",
          id: source.id,
          version: source.version,
        },
        ...(selected
          ? [
              {
                kind: "adaptation-strategy",
                id: selected.id,
                version: selected.version,
              },
            ]
          : []),
        ...references.map((item) => ({
          kind: item.sourceKind,
          id: item.sourceId,
          version: item.sourceVersion,
        })),
      ],
      prompt: `${AUTHOR_INTENT_CREATION_PROMPT}\n从已采用诊断及唯一策略生成独立整季分集方案，不生成剧本、场景、分镜或媒体。只用冻结实际表达范围；局部不能冒充全书。${basis.sourceBasis ? "本轮继承诊断的明确混合表达，不补整章原文；摘要／片段不是全文阅读。reviewedSources 必须完整列明 actualExpressions 的实际引用 ID／版本／路径。章节覆盖仅代表方案引用的原章节身份，不证明全文已读。" : "本轮沿用诊断完整原文，不填写混合 reviewedSources。"}覆盖由实际分集引用派生，不自报覆盖率。每个范围内章节须引用或明确删减理由；人物推进及伏笔为方案，不冒充已发生事实。制作字段是风险估计，不是价格。\n冻结基准：${JSON.stringify(modelScope)}\nitems 恰好一个 kind=season-plan，data 严格符合 ${JSON.stringify(z.toJSONSchema(SeasonPlanContentSchema))}。分集 id 必须稳定且唯一，orderIndex 从 0 连续排列，集数与时长遵守冻结目标；每集有真正不同的剧情推进。content 为作者阅读的摘要。`,
    };
  };
  const inspect = (output: CreationContent, basis: SeasonPlanBasis) => {
    if (
      output.items.length !== 1 ||
      output.items[0]?.kind !== "season-plan" ||
      !output.content.trim()
    )
      throw new Error("整季方案必须只有一个独立结构化条目和非空摘要。");
    return inspectSeasonPlanContent(output.items[0].data, basis);
  };
  const validate = (
    _input: CreationInput,
    output: CreationContent,
    workflow?: CreationWorkflow,
  ): CreationIssue[] => {
    try {
      const basis = workflow?.seasonPlanBasis;
      const snapshot = workflow?.sourceSnapshotId
        ? optionalService(context, AGENT_CONTEXT_SERVICE)?.getSnapshot(
            workflow.sourceSnapshotId,
          )
        : undefined;
      if (
        !basis ||
        !snapshot ||
        snapshot.projectId !== workflow!.input.projectId ||
        workflow?.authorIntent?.state !== "adopted" ||
        workflow.authorIntent.id !== basis.authorIntent.id ||
        workflow.authorIntent.version !== basis.authorIntent.version
      )
        throw new Error("整季方案缺少可核对的冻结基准与正式意图。");
      if (basis.sourceBasis)
        assertAdaptationSourceSnapshot(
          basis,
          workflow!.input.projectId,
          snapshot.entries,
        );
      else
        for (const source of basis.chapters) {
          const entry = snapshot.entries.find(
            (item) =>
              item.included &&
              item.sourceKind === "chapter" &&
              item.sourceId === source.id &&
              item.sourceVersion === source.version &&
              item.fieldPath === `/chapters/${source.id}`,
          );
          const body = (entry?.value as { content?: unknown } | undefined)
            ?.content;
          if (typeof body !== "string" || bodyHash(body) !== source.contentHash)
            throw new Error("已读章节未完整纳入冻结快照，不能声明该季纲覆盖。");
        }
      const frozenDiagnosis = snapshot.entries.find(
        (item) =>
          item.included &&
          item.sourceKind === "production" &&
          item.sourceId === basis.diagnosis.id &&
          item.sourceVersion === basis.diagnosis.version &&
          item.fieldPath === `/production/${basis.diagnosis.id}`,
      );
      if (
        !frozenDiagnosis ||
        hash(frozenDiagnosis.value) !== basis.diagnosisContentHash
      )
        throw new Error("已采用诊断与唯一策略未完整纳入冻结快照。");
      if (
        basis.strategy &&
        (!basis.strategyContentHash ||
          !snapshot.entries.some(
            (item) =>
              item.included &&
              item.sourceKind === "production" &&
              item.sourceId === basis.strategy!.id &&
              item.sourceVersion === basis.strategy!.version &&
              item.fieldPath === `/production/${basis.strategy!.id}` &&
              hash(item.value) === basis.strategyContentHash,
          ))
      )
        throw new Error("已采用独立策略未完整纳入冻结快照。");
      const frozenIntent = snapshot.entries.find(
        (item) =>
          item.included &&
          item.sourceKind === "author_intent" &&
          item.sourceId === basis.authorIntent.id &&
          item.sourceVersion === basis.authorIntent.version &&
          item.fieldPath === "/author-intents/current",
      );
      if (!frozenIntent) throw new Error("正式作者意图未完整纳入冻结快照。");
      return inspect(output, basis).issues;
    } catch (error) {
      return [
        {
          severity: "error",
          source: "rule",
          location: "整季方案",
          evidence: "",
          message:
            error instanceof Error ? error.message : "整季方案结构无效。",
          suggestion: "核对完整冻结来源、采用诊断与结构；不要修改已采用内容。",
        },
      ];
    }
  };
  const saveNew = (
    tx: UnitOfWorkTransaction,
    value: Omit<
      Stored,
      "id" | "version" | "createdAt" | "updatedAt" | "stateVersion" | "status"
    >,
  ): Stored => {
    const version = tx.get<{ next: number }>(
      "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM production_season_plans WHERE project_id = ?",
      value.projectId,
    )!.next;
    const at = new Date().toISOString();
    const stored: Stored = {
      ...value,
      id: crypto.randomUUID(),
      version,
      stateVersion: 0,
      status: "pending",
      createdAt: at,
      updatedAt: at,
    };
    tx.run(
      "INSERT INTO production_season_plans VALUES (?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?)",
      stored.id,
      stored.projectId,
      stored.workflowId,
      stored.origin,
      version,
      JSON.stringify(stored),
      at,
      at,
    );
    event(tx, stored);
    return stored;
  };
  const preview = (workflow: CreationWorkflow): { seasonPlanId: string } => {
    const existing = context.uow.execute((tx) =>
      tx.get<{ id: string }>(
        "SELECT id FROM production_season_plans WHERE workflow_id = ? AND (origin = 'model' OR status = 'adopted') ORDER BY CASE WHEN status = 'adopted' THEN 0 ELSE 1 END, version DESC LIMIT 1",
        workflow.id,
      ),
    );
    if (existing) return { seasonPlanId: existing.id };
    if (
      !workflow.output ||
      !workflow.seasonPlanBasis ||
      !workflow.sourceSnapshotId ||
      validate(workflow.input, workflow.output, workflow).length
    )
      throw new Error("整季方案或冻结来源不完整。");
    const result = inspect(workflow.output, workflow.seasonPlanBasis);
    return context.uow.execute((tx) => {
      const duplicate = tx.get<{ id: string }>(
        "SELECT id FROM production_season_plans WHERE workflow_id = ? AND origin = 'model'",
        workflow.id,
      );
      if (duplicate) return { seasonPlanId: duplicate.id };
      const value = saveNew(tx, {
        projectId: workflow.input.projectId,
        workflowId: workflow.id,
        origin: "model",
        content: result.content!,
        coverage: result.coverage,
        basis: workflow.seasonPlanBasis!,
        sourceSnapshotId: workflow.sourceSnapshotId!,
        runIds: workflow.runIds,
        model: workflow.input.model
          ? Object.fromEntries(
              ["modelId", "providerId", "protocol"].flatMap((key) =>
                typeof workflow.input.model?.[key] === "string"
                  ? [[key, workflow.input.model[key]]]
                  : [],
              ),
            )
          : undefined,
      });
      return { seasonPlanId: value.id };
    });
  };
  const reviewState = (
    workflow: CreationWorkflow,
  ): "adopted" | "discarded" | undefined =>
    context.uow.execute((tx) => {
      const rows = tx.all<{ status: string }>(
        "SELECT status FROM production_season_plans WHERE workflow_id = ?",
        workflow.id,
      );
      if (rows.some((item) => item.status === "adopted")) return "adopted";
      return rows.length && rows.every((item) => item.status === "discarded")
        ? "discarded"
        : undefined;
    });
  const receipt = (key: string, digest: string) => {
    const row = context.uow.execute((tx) =>
      tx.get<{
        request_hash: string;
        plan_id: string;
        status: number;
        detail: string | null;
      }>(
        "SELECT request_hash, plan_id, status, detail FROM production_season_plan_requests WHERE request_key = ?",
        key,
      ),
    );
    if (!row) return undefined;
    if (row.request_hash !== digest)
      throw new PlanError(409, "同一幂等键不能用于不同方案、顺序或操作。");
    if (row.status !== 200) throw new PlanError(row.status, row.detail!);
    return row.plan_id;
  };
  const remember = (
    tx: UnitOfWorkTransaction,
    key: string,
    digest: string,
    id: string,
    status: number,
    detail?: string,
  ) => {
    tx.run(
      "INSERT INTO production_season_plan_requests VALUES (?, ?, ?, ?, ?)",
      key,
      digest,
      id,
      status,
      detail ?? null,
    );
    return { status, detail };
  };
  const transition = (
    id: string,
    action: "adopt" | "discard",
    stateVersion: number,
    key: string,
  ) => {
    const digest = hash({ id, action, stateVersion });
    const replay = receipt(key, digest);
    const workflowService = optionalService(context, CREATION_WORKFLOW_SERVICE);
    if (!workflowService) throw new PlanError(409, "创作工作流服务未启用。");
    if (replay) {
      workflowService.syncReview(get(replay)!.workflowId);
      return get(replay)!;
    }
    const value = context.uow.execute((tx) => read(tx, id));
    if (!value) throw new PlanError(404, "整季候选不存在。");
    project(value.projectId);
    const review = sourceReview(value);
    const workflow = workflowService.get(value.workflowId);
    const result = context.uow.execute((tx) => {
      const current = read(tx, id)!;
      if (current.status === (action === "adopt" ? "adopted" : "discarded"))
        return remember(tx, key, digest, id, 200);
      if (current.stateVersion !== stateVersion)
        throw new PlanError(412, "方案状态已变化，请刷新。");
      if (
        action === "adopt"
          ? current.status !== "pending"
          : !["pending", "conflicted"].includes(current.status)
      )
        throw new PlanError(409, "此历史状态不允许该操作。");
      const ready =
        workflow?.stage === "awaiting-review" ||
        (current.origin === "human-reorder" && workflow?.stage === "applied");
      if (
        action === "adopt" &&
        workflow?.issues.some((issue) => issue.severity === "error")
      )
        throw new PlanError(
          409,
          "候选仍有未解决的严重问题，请保持原来源修订复检；原记录未改变。",
        );
      const conflict =
        action === "adopt" &&
        (review.reasons.length > 0 ||
          !ready ||
          head(tx, current.projectId) !== current.basis.baseAdoptedId);
      const at = new Date().toISOString();
      const updated: Stored = {
        ...current,
        status: conflict
          ? "conflicted"
          : action === "adopt"
            ? "adopted"
            : "discarded",
        stateVersion: current.stateVersion + 1,
        updatedAt: at,
        ...(action === "adopt" && !conflict ? { adoptedAt: at } : {}),
      };
      tx.run(
        "UPDATE production_season_plans SET status = ?, state_version = ?, value_json = ?, updated_at = ? WHERE id = ? AND state_version = ?",
        updated.status,
        updated.stateVersion,
        JSON.stringify(updated),
        at,
        id,
        current.stateVersion,
      );
      if (updated.status === "adopted") {
        tx.run(
          "INSERT INTO production_season_plan_heads VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET plan_id = excluded.plan_id",
          current.projectId,
          id,
        );
        // The first accepted AI workflow receipt stays immutable. Later human
        // order revisions have their own immutable candidates and request receipts.
        tx.run(
          "INSERT OR IGNORE INTO production_creation_adoptions VALUES (?, ?, ?, ?)",
          current.workflowId,
          JSON.stringify({ seasonPlanId: id }),
          JSON.stringify({ seasonPlanId: current.basis.baseAdoptedId ?? null }),
          at,
        );
        tx.append({
          type: "production.season-plan-result-adopted.v1",
          pluginId: "production",
          aggregateType: "season-plan",
          aggregateId: id,
          aggregateVersion: updated.version,
          payload: CreativeOutcomeFactSchema.parse({
            eventVersion: 1,
            kind: "adaptation.season-plan-adopted",
            workflowPath: "adaptation",
            projectId: current.projectId,
            objectId: id,
            workflowId: current.workflowId,
            candidate: {
              id,
              contentFingerprint: createHash("sha256")
                .update(canonicalCreativeMetricJSON(current.content))
                .digest("hex"),
            },
            formalVersions: [
              { kind: "season-plan", id, version: updated.version },
            ],
            sourceVersions: [
              ...(current.basis.strategy
                ? [
                    {
                      id: current.basis.strategy.id,
                      version: current.basis.strategy.version,
                    },
                  ]
                : []),
              {
                id: current.basis.diagnosis.id,
                version: current.basis.diagnosis.version,
              },
              ...current.basis.chapters.map(({ id: sourceId, version }) => ({
                id: sourceId,
                version,
              })),
            ],
            evidenceKind: "human",
            modelEvidence: "unknown",
            qualityState: "unverified",
            resultStatus: "adopted",
          }),
        });
      }
      if (conflict)
        recordProductionCreativeRejection(
          tx,
          "adaptation.season-plan",
          updated,
          review.changes,
          { chapterCollection: review.chapterCollection },
        );
      event(tx, updated);
      return remember(
        tx,
        key,
        digest,
        id,
        conflict ? 409 : 200,
        conflict
          ? "来源、意图、诊断或当前季纲已变化；旧候选未覆盖正式内容。"
          : undefined,
      );
    });
    if (result.status !== 200)
      throw new PlanError(result.status, result.detail!);
    workflowService.syncReview(value.workflowId);
    return get(id)!;
  };
  const reorder = (
    id: string,
    episodeIds: string[],
    stateVersion: number,
    key: string,
  ) => {
    const digest = hash({ id, action: "reorder", stateVersion, episodeIds });
    const replay = receipt(key, digest);
    if (replay) return get(replay)!;
    const source = get(id);
    if (!source) throw new PlanError(404, "整季方案不存在。");
    if (source.stateVersion !== stateVersion)
      throw new PlanError(412, "方案状态已变化，请刷新。");
    if (
      source.sourceState !== "current" ||
      !["pending", "adopted"].includes(source.status) ||
      (source.status === "adopted" && !source.isCurrent)
    )
      throw new PlanError(409, "仅当前来源的候选或当前正式方案可重排。");
    if (
      episodeIds.every(
        (id, index) => source.content.episodes[index]?.id === id,
      ) &&
      episodeIds.length === source.content.episodes.length
    )
      throw new PlanError(400, "顺序没有变化，不创建重复版本。");
    let content;
    try {
      content = reorderSeasonPlanContent(source.content, episodeIds);
    } catch {
      throw new PlanError(
        400,
        "请提交完整、不重复且属于该版本的分集标识列表。",
      );
    }
    const result = inspectSeasonPlanContent(content, source.basis);
    if (result.issues.length)
      throw new PlanError(409, "重排后的完整方案不符合冻结目标。");
    const workflow = optionalService(context, CREATION_WORKFLOW_SERVICE)?.get(
      source.workflowId,
    );
    if (!workflow || !["awaiting-review", "applied"].includes(workflow.stage))
      throw new PlanError(409, "对应工作流不允许重排。");
    return get(
      context.uow.execute((tx) => {
        const current = read(tx, id)!;
        if (current.stateVersion !== stateVersion)
          throw new PlanError(412, "方案状态已变化。");
        if (
          head(tx, source.projectId) !==
          (source.status === "adopted" ? source.id : source.basis.baseAdoptedId)
        )
          throw new PlanError(409, "当前正式方案已变化，请刷新后重排。");
        const value = saveNew(tx, {
          projectId: source.projectId,
          workflowId: source.workflowId,
          origin: "human-reorder",
          sourcePlanId: source.id,
          content: result.content!,
          coverage: result.coverage,
          basis: { ...source.basis, baseAdoptedId: head(tx, source.projectId) },
          sourceSnapshotId: source.sourceSnapshotId,
          runIds: source.runIds,
          model: source.model,
        });
        remember(tx, key, digest, value.id, 200);
        return value.id;
      }),
    )!;
  };
  context.effect(
    () =>
      provideService(context, PRODUCTION_SEASON_PLAN_SERVICE, {
        prepare,
        validate,
        preview,
        reviewState,
        get: (projectId, id) => {
          const value = get(id);
          return value?.projectId === projectId ? value : undefined;
        },
        current: (projectId) => {
          const id = context.uow.execute((tx) => head(tx, projectId));
          return id ? get(id) : undefined;
        },
      }),
    `service:${PRODUCTION_SEASON_PLAN_SERVICE.id}`,
  );

  const routes: RouteContribution[] = [];
  const params = z.object({ id: z.string().uuid() });
  const projectParams = z.object({ projectId: z.string().uuid() });
  const pageQuery = z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  });
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operationId: string,
    response: z.ZodType,
    handler: (c: HttpContext) => unknown | Promise<unknown>,
    body?: z.ZodType,
    query?: typeof pageQuery,
  ) =>
    routes.push(
      defineRouteContribution({
        id: `production:${operationId}`,
        pluginId: "production",
        method,
        path,
        operationId,
        ...(method === "post"
          ? {
              policy: {
                idempotency: "required",
                idempotencyReplay: "handler",
                concurrency: "if-match-required",
              } as const,
            }
          : {}),
        declaration: createRoute({
          method,
          path,
          operationId,
          tags: ["season-plans"],
          request: {
            params: path.includes("{projectId}") ? projectParams : params,
            ...(query ? { query } : {}),
            ...(method === "post"
              ? {
                  headers: z.object({
                    "idempotency-key": z.string(),
                    "if-match": z.string(),
                  }),
                }
              : {}),
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
            200: {
              description: "Season plan result",
              content: { "application/json": { schema: response } },
            },
            ...Object.fromEntries(
              [400, 404, 409, 412, 428].map((status) => [
                status,
                {
                  description: "Request cannot be completed",
                  content: {
                    "application/problem+json": {
                      schema: ProblemDetailsSchema,
                    },
                  },
                },
              ]),
            ),
          },
        }),
        handler: async (c: HttpContext) => {
          try {
            const value = await handler(c);
            if (value && typeof value === "object" && "stateVersion" in value)
              c.header("ETag", `"${value.stateVersion}"`);
            return c.json(value);
          } catch (error) {
            const status =
              error instanceof PlanError
                ? error.status
                : error instanceof z.ZodError
                  ? 400
                  : 409;
            const detail =
              error instanceof z.ZodError
                ? "整季方案请求参数无效。"
                : error instanceof Error
                  ? error.message
                  : "操作未完成。";
            return new Response(
              JSON.stringify({
                type: "https://dramaip.local/problems/season-plan",
                title: detail,
                detail,
                status,
                code:
                  status === 412
                    ? "PRECONDITION_FAILED"
                    : status === 404
                      ? "NOT_FOUND"
                      : status === 400
                        ? "VALIDATION_ERROR"
                        : "CONFLICT",
                traceId: crypto.randomUUID(),
              }),
              {
                status,
                headers: { "Content-Type": "application/problem+json" },
              },
            );
          }
        },
      }),
    );
  add(
    "get",
    "/api/v2/projects/{projectId}/season-plan-sources",
    "seasonPlans.sources",
    SeasonPlanCatalogSchema,
    (c) => catalog(c.req.param("projectId")),
  );
  const readPage = (c: HttpContext) => {
    const id = c.req.param("projectId");
    project(id);
    const query = pageQuery.parse({
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    const rows = context.uow.execute((tx) => {
      const cursor = query.cursor ? read(tx, query.cursor) : undefined;
      if (query.cursor && (!cursor || cursor.projectId !== id))
        throw new PlanError(400, "游标不属于此项目。");
      return cursor
        ? tx.all<Row>(
            "SELECT value_json FROM production_season_plans WHERE project_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
            id,
            cursor.createdAt,
            cursor.createdAt,
            cursor.id,
            query.limit + 1,
          )
        : tx.all<Row>(
            "SELECT value_json FROM production_season_plans WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
            id,
            query.limit + 1,
          );
    });
    const items = rows
      .slice(0, query.limit)
      .map((row) => decode(JSON.parse(row.value_json) as Stored));
    return {
      items,
      ...(rows.length > query.limit ? { nextCursor: items.at(-1)!.id } : {}),
    };
  };
  add(
    "get",
    "/api/v2/projects/{projectId}/season-plans",
    "seasonPlans.list",
    SeasonPlanPageSchema,
    readPage,
    undefined,
    pageQuery,
  );
  add(
    "get",
    "/api/v2/projects/{projectId}/season-plan-previews",
    "seasonPlans.summaries",
    SeasonPlanSummaryPageSchema,
    (c) => {
      const page = readPage(c);
      return {
        ...page,
        items: page.items.map((item) => SeasonPlanSummarySchema.parse(item)),
      };
    },
    undefined,
    pageQuery,
  );
  add(
    "get",
    "/api/v2/season-plans/{id}",
    "seasonPlans.get",
    SeasonPlanSchema,
    (c) => {
      const value = get(c.req.param("id"));
      if (!value) throw new PlanError(404, "整季方案不存在。");
      return value;
    },
  );
  for (const action of ["adopt", "discard", "reorder"] as const) {
    const body =
      action === "adopt"
        ? SeasonPlanAdoptInputSchema
        : action === "reorder"
          ? SeasonPlanReorderInputSchema
          : z.object({});
    add(
      "post",
      `/api/v2/season-plans/{id}/${action}`,
      `seasonPlans.${action}`,
      SeasonPlanSchema,
      async (c) => {
        const key = c.req.header("Idempotency-Key");
        const match = c.req.header("If-Match")?.match(/^"(\d+)"$/u);
        if (!key?.trim() || key.length > 200 || !match)
          throw new PlanError(428, "请提供幂等键和精确状态 ETag。");
        const raw = await c.req.json();
        body.parse(raw);
        return action === "reorder"
          ? reorder(
              c.req.param("id"),
              SeasonPlanReorderInputSchema.parse(raw).episodeIds,
              Number(match[1]),
              key,
            )
          : transition(c.req.param("id"), action, Number(match[1]), key);
      },
      body,
    );
  }
  for (const route of routes)
    context.effect(() => context.http.register(route), `route:${route.id}`);
}
