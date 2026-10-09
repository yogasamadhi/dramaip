import { createHash } from "node:crypto";
import { z } from "zod";
import { createRoute } from "@hono/zod-openapi";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import {
  observedCreativeSourceChange,
  observedCreativeChapterChanges,
  observedCreativeWholeBookCollection,
  recordProductionCreativeRejection,
} from "./creative-rejections.js";
import {
  CreativeOutcomeFactSchema,
  canonicalCreativeMetricJSON,
} from "@dramaip/contracts/insights";
import { AGENT_CONTEXT_SERVICE } from "@dramaip/contracts/agent-context";
import {
  WORKSPACE_PROJECT_SERVICE,
  WORKSPACE_AUTHOR_INTENT_SERVICE,
} from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import {
  AUTHOR_INTENT_CREATION_PROMPT,
  CREATION_WORKFLOW_SERVICE,
  WRITING_NARRATIVE_SOURCE_SERVICE,
  creationAuthorIntent,
  creationReference,
  narrativeSourceSelection,
  narrativeSourceIdentity,
  type CreationInput,
  type CreationWorkflow,
  type CreationContent,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import {
  PRODUCTION_DIAGNOSIS_SERVICE,
  PRODUCTION_ADAPTATION_STRATEGY_SERVICE,
  AdaptationStrategyRequestSchema,
  AdaptationStrategyContentSchema,
  AdaptationStrategySchema,
  AdaptationStrategyPageSchema,
  AdaptationStrategySummarySchema,
  AdaptationStrategySummaryPageSchema,
  AdaptationStrategyCatalogSchema,
  AdaptationStrategyAdoptSchema,
  type AdaptationStrategy,
  type AdaptationStrategyBasis,
  type DiagnosisContent,
} from "@dramaip/contracts/production";
import {
  optionalService,
  provideService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";
import {
  assertAdaptationSourceSnapshot,
  adaptationExpressionScope,
} from "./narrative-sources.js";
import {
  strategyHash as hash,
  strategyDiagnosisReference,
  inspectAdaptationStrategy,
} from "./adaptation-strategy-content.js";

export const adaptationStrategyMigration: PluginMigration = {
  id: "production.0011.adaptation-strategies",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: [
    "production.0010.author-script-revisions",
    "production.0005.adaptation-diagnoses",
  ],
  sql: `CREATE TABLE production_adaptation_strategies (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL, state_version INTEGER NOT NULL,
    status TEXT NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(project_id, version));
  CREATE INDEX production_adaptation_strategy_page ON production_adaptation_strategies(project_id, created_at DESC, id DESC);
  CREATE TABLE production_adaptation_strategy_heads (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, strategy_id TEXT NOT NULL REFERENCES production_adaptation_strategies(id));
  CREATE TABLE production_adaptation_strategy_requests (request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, strategy_id TEXT NOT NULL REFERENCES production_adaptation_strategies(id), status INTEGER NOT NULL, detail TEXT);`,
};
type Stored = Omit<
  AdaptationStrategy,
  "isCurrent" | "sourceState" | "staleReasons"
>;
type Row = { value_json: string };
class StrategyError extends Error {
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
const bodyHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function registerAdaptationStrategies(context: PluginContext) {
  const project = (id: string) => {
    const value = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(id);
    if (!value) throw new StrategyError(404, "项目不存在。");
    return value;
  };
  const head = (tx: UnitOfWorkTransaction, projectId: string) =>
    tx.get<{ strategy_id: string }>(
      "SELECT strategy_id FROM production_adaptation_strategy_heads WHERE project_id = ?",
      projectId,
    )?.strategy_id;
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<Row>(
      "SELECT value_json FROM production_adaptation_strategies WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const diagnosis = (id: string) =>
    optionalService(context, PRODUCTION_DIAGNOSIS_SERVICE)?.current(id);
  const sourceReview = (value: Stored) => {
    const source = diagnosis(value.projectId);
    const result: string[] = [];
    if (
      !source ||
      source.id !== value.basis.diagnosis.id ||
      source.version !== value.basis.diagnosis.version ||
      source.status !== "adopted" ||
      !source.isCurrent
    )
      result.push("当前采用诊断已变化");
    else {
      if (source.sourceState !== "current") result.push(...source.staleReasons);
      if (
        hash(strategyDiagnosisReference(source).value) !==
        value.basis.diagnosisContentHash
      )
        result.push("冻结诊断内容不符");
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
      result.push("正式作者意图已变化");
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
        source?.projectId === value.projectId &&
          source.status === "adopted" &&
          source.isCurrent
          ? source
          : undefined,
      ),
      ...observedCreativeSourceChange(
        "author_intent",
        value.basis.authorIntent,
        intent?.projectId === value.projectId ? intent : undefined,
      ),
      ...observedCreativeChapterChanges(value.basis.chapters, currentChapters),
    ];
    if ((changes.length || chapterCollection) && !result.length)
      result.push("已核对冻结来源版本已变化");
    return { reasons: [...new Set(result)], changes, chapterCollection };
  };
  const decode = (value: Stored): AdaptationStrategy => {
    const current = context.uow.execute((tx) => head(tx, value.projectId));
    const staleReasons = sourceReview(value).reasons;
    if (value.status === "pending" && current !== value.basis.baseAdoptedId)
      staleReasons.push("当前独立策略采用头已变化");
    const workflow = optionalService(context, CREATION_WORKFLOW_SERVICE)?.get(
      value.workflowId,
    );
    if (
      value.status === "pending" &&
      (!workflow || !["awaiting-review", "applied"].includes(workflow.stage))
    )
      staleReasons.push("原工作流尚未完成或已处理");
    return AdaptationStrategySchema.parse({
      ...value,
      isCurrent: value.id === current,
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
    return {
      projectId: id,
      ...(current?.status === "adopted" &&
      current.isCurrent &&
      current.sourceState === "current"
        ? { diagnosis: { id: current.id, version: current.version } }
        : {}),
      adoptedStrategyId: context.uow.execute((tx) => head(tx, id)),
    };
  };
  const event = (tx: UnitOfWorkTransaction, value: Stored) =>
    tx.append({
      type:
        value.status === "pending"
          ? "production.adaptation-strategy-previewed.v1"
          : value.status === "adopted"
            ? "production.adaptation-strategy-adopted.v1"
            : value.status === "discarded"
              ? "production.adaptation-strategy-discarded.v1"
              : "production.adaptation-strategy-conflicted.v1",
      pluginId: "production",
      aggregateType: "adaptation-strategy",
      aggregateId: value.id,
      aggregateVersion: value.stateVersion,
      payload: {
        id: value.id,
        projectId: value.projectId,
        workflowId: value.workflowId,
        version: value.version,
        status: value.status,
        ...(value.selectedOptionId ? { optionId: value.selectedOptionId } : {}),
      },
    });
  const prepare = (input: CreationInput) => {
    const request = AdaptationStrategyRequestSchema.parse(
      input.adaptationStrategyRequest,
    );
    if (
      input.operation !== "adaptation-strategy" ||
      input.targetId ||
      input.baseVersion !== undefined ||
      input.sourceIds.length ||
      input.diagnosisRequest ||
      input.seasonPlanRequest ||
      input.episodeDevelopmentRequest ||
      input.authorIntentRequest ||
      input.qualityReviewRequest ||
      input.narrativeContextRequest ||
      input.narrativeSummaryRequest ||
      input.reviewPackageId ||
      input.feedbackClusterId ||
      input.wordGoal ||
      input.language
    )
      throw new StrategyError(
        409,
        "独立策略只能继承已确认的诊断基准，不使用其他目标或另行扩张来源。",
      );
    const available = catalog(input.projectId);
    if (
      !available.diagnosis ||
      hash(available.diagnosis) !== hash(request.diagnosis) ||
      available.adoptedStrategyId !== request.baseAdoptedId
    )
      throw new StrategyError(409, "采用诊断或独立策略头已变化，请重新确认。");
    const source = diagnosis(input.projectId)!;
    const intent = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    )?.current(input.projectId);
    if (
      !intent ||
      intent.id !== source.authorIntent.id ||
      intent.version !== source.authorIntent.version
    )
      throw new StrategyError(409, "诊断引用的正式作者意图已变化。");
    const { baseAdoptedId: _legacyHead, ...scope } = source.basis;
    const reference = strategyDiagnosisReference(source);
    const basis: AdaptationStrategyBasis = {
      ...scope,
      diagnosis: request.diagnosis,
      diagnosisContentHash: hash(reference.value),
      authorIntent: source.authorIntent,
      baseAdoptedId: request.baseAdoptedId,
    };
    const chapterService = optionalService(context, WRITING_CHAPTER_SERVICE);
    if (!chapterService) throw new StrategyError(409, "来源章节服务未启用。");
    const references = basis.sourceBasis
      ? (() => {
          const compiler = optionalService(
            context,
            WRITING_NARRATIVE_SOURCE_SERVICE,
          );
          if (!compiler)
            throw new StrategyError(409, "实际表达编译服务未启用。");
          const result = compiler.compile(
            input.projectId,
            basis.chapters.map(({ id, version }) => ({ id, version })),
            narrativeSourceSelection(basis.sourceBasis),
          );
          if (
            narrativeSourceIdentity(result.basis) !==
            narrativeSourceIdentity(basis.sourceBasis)
          )
            throw new StrategyError(
              409,
              "诊断的原冻结表达已变化，不能换源生成策略。",
            );
          return result.references;
        })()
      : basis.chapters.map((source) => {
          const item = chapterService.get(source.id);
          if (
            !item ||
            item.projectId !== input.projectId ||
            item.version !== source.version ||
            item.orderIndex !== source.orderIndex ||
            bodyHash(item.content) !== source.contentHash
          )
            throw new StrategyError(409, "诊断的已读来源已变化，请重新诊断。");
          return creationReference("chapter", {
            id: item.id,
            version: item.version,
            title: item.title,
            orderIndex: item.orderIndex,
            content: item.content,
          });
        });
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
    const author = creationAuthorIntent(input.projectId, intent);
    const modelScope = {
      diagnosis: basis.diagnosis,
      scope: basis.scope,
      chapters: basis.chapters.map(({ id, version }) => ({ id, version })),
      omittedChapterCount: basis.omittedChapters.length,
      target: basis.target,
      ...(basis.sourceBasis
        ? { actualExpressions: adaptationExpressionScope(basis.sourceBasis) }
        : {}),
    };
    return {
      authorIntent: author.authorIntent,
      adaptationStrategyBasis: basis,
      references: [...author.references, reference, ...references],
      sources: [
        ...author.sources,
        {
          kind: "adaptation-diagnosis",
          id: source.id,
          version: source.version,
        },
        ...references.map((item) => ({
          kind: item.sourceKind,
          id: item.sourceId,
          version: item.sourceVersion,
        })),
      ],
      prompt: `${AUTHOR_INTENT_CREATION_PROMPT}\n独立提出 2–3 个可比较的改编策略，不生成季纲、剧本、分镜或媒体，不自动选择。策略是建议不是作者决定或已发生事实。只继承诊断实际阅读表达，不添加未选原文、不扩大局部为全书。每项明确保留／合并／删减／重排／重构动作，至少一种动作有真实差别，不能只换标题。findingIds 必须指向冻结诊断的真实发现。制作风险不是价格。${basis.sourceBasis ? "reviewedSources 完整列出 actualExpressions 的实际引用；摘要／段落不冒充全文。" : "沿用原完整已读章节，不填写混合 reviewedSources。"}\n冻结基准：${JSON.stringify(modelScope)}\nitems 恰好一个 kind=adaptation-strategy，无 parentRef，data 严格符合 ${JSON.stringify(z.toJSONSchema(AdaptationStrategyContentSchema))}；content 为可读摘要。`,
    };
  };
  const validate = (
    _input: CreationInput,
    output: CreationContent,
    workflow?: CreationWorkflow,
  ): CreationIssue[] => {
    try {
      const basis = workflow?.adaptationStrategyBasis;
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
        throw new Error("独立策略缺少可核对的冻结基准与正式意图。");
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
            throw new Error("实际已读章节未完整冻结。");
        }
      const frozen = snapshot.entries.find(
        (item) =>
          item.included &&
          item.sourceKind === "production" &&
          item.sourceId === basis.diagnosis.id &&
          item.sourceVersion === basis.diagnosis.version &&
          item.fieldPath === `/production/${basis.diagnosis.id}`,
      );
      if (!frozen || hash(frozen.value) !== basis.diagnosisContentHash)
        throw new Error("已采用诊断未完整冻结。");
      if (
        !snapshot.entries.some(
          (item) =>
            item.included &&
            item.sourceKind === "author_intent" &&
            item.sourceId === basis.authorIntent.id &&
            item.sourceVersion === basis.authorIntent.version &&
            item.fieldPath === "/author-intents/current",
        )
      )
        throw new Error("正式作者意图未完整冻结。");
      inspectAdaptationStrategy(
        output,
        basis,
        frozen.value as { content: Pick<DiagnosisContent, "findings"> },
      );
      return [];
    } catch {
      return [
        {
          severity: "error",
          source: "rule",
          location: "独立改编策略",
          evidence: "",
          message: "策略结构、不同叙事动作、真实发现或完整冻结来源不符。",
          suggestion:
            "核对原范围、诊断与 2–3 个不同策略；保留原稿和已采用方向。",
        },
      ];
    }
  };
  const preview = (workflow: CreationWorkflow) => {
    const existing = context.uow.execute((tx) =>
      tx.get<{ id: string }>(
        "SELECT id FROM production_adaptation_strategies WHERE workflow_id = ?",
        workflow.id,
      ),
    );
    if (existing) return { adaptationStrategyId: existing.id };
    if (
      !workflow.output ||
      !workflow.adaptationStrategyBasis ||
      !workflow.sourceSnapshotId ||
      validate(workflow.input, workflow.output, workflow).length
    )
      throw new Error("独立策略或冻结来源不完整。");
    const content = AdaptationStrategyContentSchema.parse(
      workflow.output.items[0]!.data,
    );
    return context.uow.execute((tx) => {
      const duplicate = tx.get<{ id: string }>(
        "SELECT id FROM production_adaptation_strategies WHERE workflow_id = ?",
        workflow.id,
      );
      if (duplicate) return { adaptationStrategyId: duplicate.id };
      const version = tx.get<{ next: number }>(
        "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM production_adaptation_strategies WHERE project_id = ?",
        workflow.input.projectId,
      )!.next;
      const at = new Date().toISOString();
      const value: Stored = {
        id: crypto.randomUUID(),
        projectId: workflow.input.projectId,
        workflowId: workflow.id,
        version,
        stateVersion: 0,
        status: "pending",
        content,
        basis: workflow.adaptationStrategyBasis!,
        sourceSnapshotId: workflow.sourceSnapshotId!,
        runIds: workflow.runIds,
        engineKind: workflow.input.engineKind,
        ...(workflow.input.model
          ? {
              model: Object.fromEntries(
                ["modelId", "providerId", "protocol"].flatMap((key) =>
                  typeof workflow.input.model?.[key] === "string"
                    ? [[key, workflow.input.model[key]]]
                    : [],
                ),
              ),
            }
          : {}),
        createdAt: at,
        updatedAt: at,
      };
      tx.run(
        "INSERT INTO production_adaptation_strategies VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?)",
        value.id,
        value.projectId,
        value.workflowId,
        version,
        JSON.stringify(value),
        at,
        at,
      );
      event(tx, value);
      return { adaptationStrategyId: value.id };
    });
  };
  const transition = (
    id: string,
    action: "adopt" | "discard",
    version: number,
    key: string,
    optionId?: string,
    synchronizeWorkflow = true,
  ) => {
    const digest = hash({ id, action, version, optionId });
    const workflowService = optionalService(context, CREATION_WORKFLOW_SERVICE);
    if (!workflowService)
      throw new StrategyError(409, "创作工作流服务未启用。");
    const receipt = context.uow.execute((tx) =>
      tx.get<{
        request_hash: string;
        strategy_id: string;
        status: number;
        detail: string | null;
      }>(
        "SELECT request_hash, strategy_id, status, detail FROM production_adaptation_strategy_requests WHERE request_key = ?",
        key,
      ),
    );
    if (receipt) {
      if (receipt.request_hash !== digest)
        throw new StrategyError(
          409,
          "同一幂等键不能用于另一策略、选项或状态。",
        );
      if (receipt.status !== 200)
        throw new StrategyError(receipt.status, receipt.detail!);
      const result = get(receipt.strategy_id)!;
      if (synchronizeWorkflow) workflowService.syncReview(result.workflowId);
      return get(result.id)!;
    }
    const value = context.uow.execute((tx) => read(tx, id));
    if (!value) throw new StrategyError(404, "策略候选不存在。");
    project(value.projectId);
    if (
      action === "adopt" &&
      !value.content.options.some((item) => item.id === optionId)
    )
      throw new StrategyError(400, "必须明确选择本候选中的一个策略。");
    const review = sourceReview(value);
    const workflow = workflowService.get(value.workflowId);
    const result = context.uow.execute((tx) => {
      const current = read(tx, id)!;
      const remember = (status: number, detail?: string) => {
        tx.run(
          "INSERT INTO production_adaptation_strategy_requests VALUES (?, ?, ?, ?, ?)",
          key,
          digest,
          id,
          status,
          detail ?? null,
        );
        return { status, detail };
      };
      if (current.status === (action === "adopt" ? "adopted" : "discarded")) {
        if (action === "adopt" && current.selectedOptionId !== optionId)
          throw new StrategyError(
            409,
            "已采用内容不可重选；请生成新策略版本。",
          );
        return remember(200);
      }
      if (current.stateVersion !== version)
        throw new StrategyError(412, "策略状态已变化，请刷新。");
      if (
        action === "adopt"
          ? current.status !== "pending"
          : !["pending", "conflicted"].includes(current.status)
      )
        throw new StrategyError(409, "此历史状态不允许该操作。");
      if (
        action === "adopt" &&
        workflow?.issues.some((issue) => issue.severity === "error")
      )
        throw new StrategyError(
          409,
          "候选仍有未解决的严重问题，请保持原来源修订复检；原记录未改变。",
        );
      const conflict =
        action === "adopt" &&
        (review.reasons.length > 0 ||
          workflow?.stage !== "awaiting-review" ||
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
        ...(action === "adopt" && !conflict
          ? { selectedOptionId: optionId, adoptedAt: at }
          : {}),
      };
      tx.run(
        "UPDATE production_adaptation_strategies SET status = ?, state_version = ?, value_json = ?, updated_at = ? WHERE id = ? AND state_version = ?",
        updated.status,
        updated.stateVersion,
        JSON.stringify(updated),
        at,
        id,
        current.stateVersion,
      );
      if (updated.status === "adopted") {
        tx.run(
          "INSERT INTO production_adaptation_strategy_heads VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET strategy_id = excluded.strategy_id",
          current.projectId,
          id,
        );
        tx.run(
          "INSERT OR IGNORE INTO production_creation_adoptions VALUES (?, ?, ?, ?)",
          current.workflowId,
          JSON.stringify({ adaptationStrategyId: id, optionId }),
          JSON.stringify({
            adaptationStrategyId: current.basis.baseAdoptedId ?? null,
          }),
          at,
        );
        const fingerprint = (material: unknown) =>
          createHash("sha256")
            .update(canonicalCreativeMetricJSON(material))
            .digest("hex");
        const selected = current.content.options.find(
          (option) => option.id === optionId,
        )!;
        tx.append({
          type: "production.adaptation-strategy-result-adopted.v1",
          pluginId: "production",
          aggregateType: "adaptation-strategy",
          aggregateId: id,
          aggregateVersion: updated.version,
          payload: CreativeOutcomeFactSchema.parse({
            eventVersion: 1,
            kind: "adaptation.strategy-adopted",
            workflowPath: "adaptation",
            projectId: current.projectId,
            objectId: id,
            workflowId: current.workflowId,
            candidate: {
              id,
              contentFingerprint: fingerprint(current.content),
              selectionOptions: current.content.options.map((option) => ({
                id: option.id,
                contentFingerprint: fingerprint(option),
              })),
            },
            selectedOption: {
              id: selected.id,
              contentFingerprint: fingerprint(selected),
            },
            formalVersions: [
              { kind: "adaptation-strategy", id, version: updated.version },
            ],
            sourceVersions: [
              current.basis.diagnosis,
              ...current.basis.chapters.map(({ id, version }) => ({
                id,
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
          "adaptation.strategy",
          updated,
          review.changes,
          {
            selectionOptions: current.content.options,
            chapterCollection: review.chapterCollection,
          },
        );
      event(tx, updated);
      return remember(
        conflict ? 409 : 200,
        conflict
          ? "来源、诊断、意图或策略头已变化；旧候选未覆盖正式方向。"
          : undefined,
      );
    });
    if (result.status !== 200)
      throw new StrategyError(result.status, result.detail!);
    if (synchronizeWorkflow) workflowService.syncReview(value.workflowId);
    return get(id)!;
  };
  context.effect(
    () =>
      provideService(context, PRODUCTION_ADAPTATION_STRATEGY_SERVICE, {
        prepare,
        validate,
        preview,
        get: (projectId, id) => {
          const value = get(id);
          return value?.projectId === projectId ? value : undefined;
        },
        current: (projectId) => {
          const id = context.uow.execute((tx) => head(tx, projectId));
          return id ? get(id) : undefined;
        },
        reviewState: (workflow) => {
          const value = context.uow.execute((tx) =>
            tx.get<{ status: string }>(
              "SELECT status FROM production_adaptation_strategies WHERE workflow_id = ?",
              workflow.id,
            ),
          );
          return value &&
            (value.status === "adopted" || value.status === "discarded")
            ? value.status
            : undefined;
        },
        discard: (workflow) => {
          const row = context.uow.execute((tx) =>
            tx.get<{ id: string }>(
              "SELECT id FROM production_adaptation_strategies WHERE workflow_id = ?",
              workflow.id,
            ),
          );
          const value = row ? get(row.id) : undefined;
          if (!value || value.projectId !== workflow.input.projectId)
            throw new StrategyError(409, "没有本次运行的实际策略候选。");
          transition(
            value.id,
            "discard",
            value.stateVersion,
            `creation-strategy-discard:${workflow.id}`,
            undefined,
            // Automation is already reconciling this discarded preview and
            // owns its state CAS. Do not recursively advance the same workflow.
            false,
          );
        },
      }),
    `service:${PRODUCTION_ADAPTATION_STRATEGY_SERVICE.id}`,
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
          tags: ["adaptation-strategies"],
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
              description: "Independent adaptation strategy",
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
              error instanceof StrategyError
                ? error.status
                : error instanceof z.ZodError
                  ? 400
                  : 409;
            const detail =
              error instanceof StrategyError
                ? error.message
                : "独立策略请求无效或不能完成。";
            return new Response(
              JSON.stringify({
                type: "https://dramaip.local/problems/adaptation-strategy",
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
  const page = (c: HttpContext) => {
    const id = c.req.param("projectId");
    project(id);
    const query = pageQuery.parse({
      cursor: c.req.query("cursor"),
      limit: c.req.query("limit"),
    });
    const rows = context.uow.execute((tx) => {
      const cursor = query.cursor ? read(tx, query.cursor) : undefined;
      if (query.cursor && (!cursor || cursor.projectId !== id))
        throw new StrategyError(400, "游标不属于此项目。");
      return cursor
        ? tx.all<Row>(
            "SELECT value_json FROM production_adaptation_strategies WHERE project_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
            id,
            cursor.createdAt,
            cursor.createdAt,
            cursor.id,
            query.limit + 1,
          )
        : tx.all<Row>(
            "SELECT value_json FROM production_adaptation_strategies WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
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
    "/api/v2/projects/{projectId}/adaptation-strategy-sources",
    "adaptationStrategies.sources",
    AdaptationStrategyCatalogSchema,
    (c) => catalog(c.req.param("projectId")),
  );
  add(
    "get",
    "/api/v2/projects/{projectId}/adaptation-strategies",
    "adaptationStrategies.list",
    AdaptationStrategyPageSchema,
    page,
    undefined,
    pageQuery,
  );
  add(
    "get",
    "/api/v2/projects/{projectId}/adaptation-strategy-previews",
    "adaptationStrategies.summaries",
    AdaptationStrategySummaryPageSchema,
    (c) => {
      const result = page(c);
      return {
        ...result,
        items: result.items.map((item) =>
          AdaptationStrategySummarySchema.parse(item),
        ),
      };
    },
    undefined,
    pageQuery,
  );
  add(
    "get",
    "/api/v2/adaptation-strategies/{id}",
    "adaptationStrategies.get",
    AdaptationStrategySchema,
    (c) => {
      const value = get(c.req.param("id"));
      if (!value) throw new StrategyError(404, "独立策略不存在。");
      return value;
    },
  );
  for (const action of ["adopt", "discard"] as const) {
    const body =
      action === "adopt"
        ? AdaptationStrategyAdoptSchema
        : z.object({}).strict();
    add(
      "post",
      `/api/v2/adaptation-strategies/{id}/${action}`,
      `adaptationStrategies.${action}`,
      AdaptationStrategySchema,
      async (c) => {
        const key = c.req.header("Idempotency-Key");
        const match = c.req.header("If-Match")?.match(/^"(\d+)"$/u);
        if (!key?.trim() || key.length > 200 || !match)
          throw new StrategyError(428, "请提供幂等键和精确状态 ETag。");
        const raw = body.parse(await c.req.json());
        return transition(
          c.req.param("id"),
          action,
          Number(match[1]),
          key,
          "optionId" in raw ? (raw.optionId as string) : undefined,
        );
      },
      body,
    );
  }
  for (const route of routes)
    context.effect(() => context.http.register(route), `route:${route.id}`);
}
