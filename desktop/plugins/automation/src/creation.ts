import {
  CREATION_PROJECT_LINEAGE_SERVICE,
  CreationProjectLineagePageSchema,
} from "@dramaip/contracts/creation-project-lineage";
import { projectCreationLineage } from "./project-lineage.js";
import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import {
  PRODUCTION_RECORD_SERVICE,
  PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
  ProductionRecordMergeComparisonSchema,
  ProductionRecordMergeRequestSchema,
  type ProductionRecordMergeSource,
} from "@dramaip/contracts/production";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import {
  AGENT_CONTEXT_SERVICE,
  agentContextManifestJSON,
  type AgentContextReference,
} from "@dramaip/contracts/agent-context";
import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  AGENT_TASK_RUNNER_SERVICE,
  ProblemDetailsSchema,
} from "@dramaip/contracts";
import { AUTOMATION_PREVIEW_SERVICE } from "@dramaip/contracts/automation";
import {
  CreationInputSchema,
  AUTHOR_INTENT_CONTEXT_PATH,
  CreationWorkflowSchema,
  CreationExecutionReceiptSchema,
  type CreationExecutionReceipt,
  CreationSourceConflictError,
  type CreationSourceConflict,
  CreationActionSchema,
  CreationMergeSchema,
  CreationRebaseRequestSchema,
  NarrativePlanningOperationSchema,
  CREATION_QUALITY_SERVICE,
  CREATION_REVIEW_SERVICE,
  CREATION_INSIGHTS_SERVICE,
  parseCreationContent,
  CREATION_WORKFLOW_SERVICE,
  CREATION_WRITING_SERVICE,
  CREATION_AUTHOR_INTENT_SERVICE,
  CREATION_PRODUCTION_SERVICE,
  CREATION_DELIVERY_SERVICE,
  CREATION_KNOWLEDGE_SERVICE,
  type CreationWorkflow,
  type CreationInput,
  type CreationAdapter,
  type CreationPrepareOptions,
} from "@dramaip/contracts/creation";
import {
  CREATION_NARRATIVE_QUALITY_SERVICE,
  NarrativeQualityCommitError,
} from "@dramaip/contracts/creative-quality";
import {
  canonicalCreativeMetricJSON as canonicalCreativeMergeJSON,
  CreativePlanningCommitError,
} from "@dramaip/contracts/insights";
import {
  creativeMetricMigration,
  recordCreativeRequest,
  recordCreativeCandidate,
  recordCreativeMetricState,
  recordCreativeSourceConflict,
} from "./creative-metrics.js";
import {
  creativeContinuationMigration,
  recordContinuationRequest,
  recordContinuationStarted,
} from "./creative-continuation.js";
import {
  planningMetricMigration,
  recordPlanningRequest,
  recordPlanningCandidate,
  recordPlanningMetricState,
  recordPlanningSourceConflict,
} from "./planning-metrics.js";
import {
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type RouteContribution,
} from "@dramaip/plugin-api/internal";

export const creationMigrations: PluginMigration[] = [
  {
    id: "automation.0007.creation-workflows",
    pluginId: "automation",
    version: "3.0.0-alpha.4",
    dependsOn: ["automation.0006.task-attention"],
    sql: `CREATE TABLE automation_creation_workflows (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_id TEXT, stage TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
    request_key TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
    value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX automation_creation_target ON automation_creation_workflows(project_id, target_id, created_at DESC, id);
  CREATE INDEX automation_creation_stage ON automation_creation_workflows(stage, created_at, id);`,
  },
  creativeMetricMigration,
  creativeContinuationMigration,
  planningMetricMigration,
];

const ACTIVE = [
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
];
const CONTENT_FORMAT = `只返回 JSON，不要 Markdown 围栏。结构为 {"title":"标题","content":"完整正文或方案","items":[{"ref":"候选内部唯一标识","parentRef":"可选父项 ref","kind":"业务条目类型","title":"条目名称","data":{}}]}。仅使用任务要求的条目类型。正文放 content，结构化资料放 items；brief 放一段供用户审阅的任务书，概括剧情推进、人物动机、视角、节奏、事实约束、伏笔与字数目标，不包含推理过程。严禁把计划当作已经发生的事实。`;

function adapter(
  context: PluginContext,
  input: CreationInput,
): CreationAdapter {
  const contract =
    input.operation === "author-intent"
      ? CREATION_AUTHOR_INTENT_SERVICE
      : input.operation === "quality-review"
        ? CREATION_NARRATIVE_QUALITY_SERVICE
        : [
              "chapter",
              "characters",
              "book-outline",
              "chapter-outline",
              "story-arc",
              "creator-content",
            ].includes(input.operation)
          ? CREATION_WRITING_SERVICE
          : ["chapter-memory", "knowledge-plan", "narrative-summary"].includes(
                input.operation,
              )
            ? CREATION_KNOWLEDGE_SERVICE
            : ["delivery-copy", "localization"].includes(input.operation)
              ? CREATION_DELIVERY_SERVICE
              : CREATION_PRODUCTION_SERVICE;
  const service = optionalService(context, contract);
  if (!service) throw new Error("当前业务插件未启用，无法执行该创作操作。");
  return service;
}

function assertPreparedContext(
  prepared: ReturnType<CreationAdapter["prepare"]>,
  frozen?: {
    snapshot: Pick<
      import("@dramaip/contracts/agent-context").AgentContextSnapshot,
      "entries" | "estimatedTokens" | "tokenBudget"
    >;
  },
  input?: Pick<CreationInput, "operation">,
) {
  if (frozen && prepared.productionNarrativeBasis) {
    if (frozen.snapshot.estimatedTokens > frozen.snapshot.tokenBudget)
      throw new Error(
        "明确制作的完整首次提示超过硬预算，不裁剪所选来源或约束。",
      );
    for (const reference of prepared.productionNarrativeBasis.references)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === reference.sourceKind &&
            entry.sourceId === reference.sourceId &&
            entry.sourceVersion === reference.sourceVersion &&
            entry.fieldPath === reference.fieldPath &&
            createHash("sha256")
              .update(JSON.stringify(entry.value))
              .digest("hex") === reference.contentHash,
        )
      )
        throw new Error(
          "明确制作的实际表达、简报、作者意图或保存对象未完整冻结；请调整隐私／范围／预算，不漏读或换源生成。",
        );
  }
  if (frozen && prepared.authorIntentBasis) {
    if (frozen.snapshot.estimatedTokens > frozen.snapshot.tokenBudget)
      throw new Error("作者意图完整首轮提示超过硬预算，不会裁剪所选来源。");
    for (const source of prepared.authorIntentBasis.references)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === source.sourceKind &&
            entry.sourceId === source.sourceId &&
            entry.sourceVersion === source.sourceVersion &&
            entry.fieldPath === source.fieldPath &&
            createHash("sha256")
              .update(JSON.stringify(entry.value))
              .digest("hex") === source.contentHash,
        )
      )
        throw new Error(
          "作者意图的简报、当前正式意图或明确来源未完整冻结；请调整隐私或预算，不会漏读后宣称完成。",
        );
  }
  if (
    frozen &&
    input &&
    ["episode", "script-revision", "review-check", "shot-prompt"].includes(
      input.operation,
    )
  ) {
    if (frozen.snapshot.estimatedTokens > frozen.snapshot.tokenBudget)
      throw new Error(
        "兼容生产操作的完整首轮提示超过硬预算，不会裁剪明确选择的章节。",
      );
    for (const source of prepared.references ?? [])
      if (
        source.sourceKind === "chapter" &&
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === source.sourceKind &&
            entry.sourceId === source.sourceId &&
            entry.sourceVersion === source.sourceVersion &&
            entry.fieldPath === source.fieldPath &&
            JSON.stringify(entry.value) === JSON.stringify(source.value),
        )
      )
        throw new Error(
          "明确选择的章节未完整纳入兼容生产上下文；请调整隐私策略、范围或预算，不会补入开头几章。",
        );
  }
  const authorIntent = prepared.authorIntent;
  const scopeBasis =
    prepared.episodeDevelopmentBasis ??
    prepared.seasonPlanBasis ??
    prepared.adaptationStrategyBasis ??
    prepared.diagnosisBasis;
  const sourceBasis =
    prepared.episodeDevelopmentBasis?.sourceBasis ??
    prepared.seasonPlanBasis?.sourceBasis ??
    prepared.adaptationStrategyBasis?.sourceBasis ??
    prepared.diagnosisBasis?.sourceBasis;
  if (
    frozen &&
    (prepared.diagnosisBasis ||
      prepared.adaptationStrategyBasis ||
      prepared.seasonPlanBasis ||
      prepared.episodeDevelopmentBasis) &&
    frozen.snapshot.estimatedTokens > frozen.snapshot.tokenBudget
  )
    throw new Error(
      "诊断／季纲／单集完整首轮提示超过上下文硬预算，不会裁剪所选表达。",
    );
  if (frozen && sourceBasis) {
    for (const source of sourceBasis.references)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === source.sourceKind &&
            entry.sourceId === source.sourceId &&
            entry.sourceVersion === source.sourceVersion &&
            entry.fieldPath === source.fieldPath &&
            createHash("sha256")
              .update(JSON.stringify(entry.value))
              .digest("hex") === source.contentHash,
        )
      )
        throw new Error(
          `${prepared.episodeDevelopmentBasis ? "单集" : "诊断／季纲"}的明确混合表达未完整纳入冻结上下文，不会补原文或绕过隐私／预算。`,
        );
  } else if (frozen && scopeBasis) {
    for (const chapter of scopeBasis.chapters)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === "chapter" &&
            entry.sourceId === chapter.id &&
            entry.sourceVersion === chapter.version &&
            entry.fieldPath === `/chapters/${chapter.id}` &&
            typeof (entry.value as { content?: unknown })?.content ===
              "string" &&
            createHash("sha256")
              .update((entry.value as { content: string }).content)
              .digest("hex") === chapter.contentHash,
        )
      )
        throw new Error(
          "选定章节未完整纳入冻结上下文，请调整隐私策略、范围或预算；不会用开头几章冒充全书诊断。",
        );
  }
  if (frozen && prepared.episodeDevelopmentBasis) {
    for (const source of prepared.episodeDevelopmentBasis.references)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === source.sourceKind &&
            entry.sourceId === source.sourceId &&
            entry.sourceVersion === source.sourceVersion &&
            entry.fieldPath === source.fieldPath &&
            createHash("sha256")
              .update(JSON.stringify(entry.value))
              .digest("hex") === source.contentHash,
        )
      )
        throw new Error(
          "正式单集故事来源、上游成果、作者意图或 Story Bible 未完整纳入上下文；请调整隐私/预算，不会绕过来源约束生成单集。",
        );
  }
  if (frozen && prepared.narrativeQualityBasis) {
    if (frozen.snapshot.estimatedTokens > frozen.snapshot.tokenBudget)
      throw new Error(
        "质量评议完整冻结提示超过上下文硬预算，不会裁剪所选表达。",
      );
    for (const source of prepared.narrativeQualityBasis.references)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === source.sourceKind &&
            entry.sourceId === source.sourceId &&
            entry.sourceVersion === source.sourceVersion &&
            entry.fieldPath === source.fieldPath &&
            createHash("sha256")
              .update(JSON.stringify(entry.value))
              .digest("hex") === source.contentHash,
        )
      )
        throw new Error(
          "质量评议的目标、作者意图或可信知识未完整纳入冻结上下文；请调整隐私策略或预算，不会对未读内容宣称完成检查。",
        );
  }
  if (frozen && prepared.narrativeContextBasis) {
    if (frozen.snapshot.estimatedTokens > frozen.snapshot.tokenBudget)
      throw new Error(
        "明确小说来源的完整冻结提示（含引用标识）超过上下文硬预算；不会静默裁剪来源。",
      );
    for (const reference of prepared.narrativeContextBasis.references)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === reference.sourceKind &&
            entry.sourceId === reference.sourceId &&
            entry.sourceVersion === reference.sourceVersion &&
            entry.fieldPath === reference.fieldPath &&
            createHash("sha256")
              .update(JSON.stringify(entry.value))
              .digest("hex") === reference.contentHash,
        )
      )
        throw new Error(
          "明确选择的小说原文、摘要或段落未完整纳入冻结上下文；请调整范围、隐私或预算，不会静默裁剪或改用旧摘要。",
        );
  }
  if (frozen && prepared.narrativePlanningBasis) {
    if (frozen.snapshot.estimatedTokens > frozen.snapshot.tokenBudget)
      throw new Error(
        "明确规划来源的完整首次提示超过上下文硬预算，不会静默裁剪。",
      );
    for (const reference of prepared.narrativePlanningBasis.references)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === reference.sourceKind &&
            entry.sourceId === reference.sourceId &&
            entry.sourceVersion === reference.sourceVersion &&
            entry.fieldPath === reference.fieldPath &&
            createHash("sha256")
              .update(JSON.stringify(entry.value))
              .digest("hex") === reference.contentHash,
        )
      )
        throw new Error(
          "规划的明确来源、项目简报或作者意图未完整纳入冻结上下文；请调整范围、隐私或预算，不会漏读或换源生成。",
        );
  }
  if (frozen && prepared.narrativeSummaryBasis) {
    if (frozen.snapshot.estimatedTokens > frozen.snapshot.tokenBudget)
      throw new Error(
        "分层摘要的完整冻结提示超过硬预算，不会静默裁成开头几章。",
      );
    for (const source of prepared.narrativeSummaryBasis.references)
      if (
        !frozen.snapshot.entries.some(
          (entry) =>
            entry.included &&
            entry.sourceKind === source.sourceKind &&
            entry.sourceId === source.sourceId &&
            entry.sourceVersion === source.sourceVersion &&
            entry.fieldPath === source.fieldPath &&
            createHash("sha256")
              .update(JSON.stringify(entry.value))
              .digest("hex") === source.contentHash,
        )
      )
        throw new Error(
          "分层摘要的所选来源因隐私或预算未完整冻结；不会漏章、回退旧摘要或声称完整覆盖。",
        );
  }
  if (
    frozen &&
    (prepared.seasonPlanBasis || prepared.adaptationStrategyBasis)
  ) {
    const basis = (prepared.seasonPlanBasis ??
      prepared.adaptationStrategyBasis)!;
    if (
      !frozen.snapshot.entries.some(
        (entry) =>
          entry.included &&
          entry.sourceKind === "production" &&
          entry.sourceId === basis.diagnosis.id &&
          entry.sourceVersion === basis.diagnosis.version &&
          entry.fieldPath === `/production/${basis.diagnosis.id}` &&
          createHash("sha256")
            .update(JSON.stringify(entry.value))
            .digest("hex") === basis.diagnosisContentHash,
      )
    )
      throw new Error(
        "已采用诊断与唯一策略未完整纳入冻结上下文，请调整隐私策略或预算；不会绕过来源检查生成季纲。",
      );
    const strategy = prepared.seasonPlanBasis?.strategy;
    if (
      strategy &&
      !frozen.snapshot.entries.some(
        (entry) =>
          entry.included &&
          entry.sourceKind === "production" &&
          entry.sourceId === strategy.id &&
          entry.sourceVersion === strategy.version &&
          entry.fieldPath === `/production/${strategy.id}` &&
          createHash("sha256")
            .update(JSON.stringify(entry.value))
            .digest("hex") === prepared.seasonPlanBasis!.strategyContentHash,
      )
    )
      throw new Error(
        "已采用独立策略未完整纳入冻结上下文，不会改用诊断内旧策略。",
      );
  }
  if (
    frozen &&
    authorIntent?.state === "adopted" &&
    !frozen.snapshot.entries.some(
      (entry) =>
        entry.sourceKind === "author_intent" &&
        entry.included &&
        entry.sourceId === authorIntent.id &&
        entry.sourceVersion === authorIntent.version &&
        entry.fieldPath === AUTHOR_INTENT_CONTEXT_PATH,
    )
  )
    throw new Error(
      "正式作者意图未完整纳入冻结上下文，请调整隐私策略或上下文预算后重试。",
    );
}

function creationStagePrompt(
  input: CreationInput,
  preparedPrompt: string,
  suffix: string,
): string {
  return `${preparedPrompt}\n\n用户要求：${input.instruction}\n${input.wordGoal ? `目标字数：${input.wordGoal}，允许上下浮动 15%。` : ""}\n${suffix}`;
}

export function creationRuntime(context: PluginContext) {
  const get = (id: string): CreationWorkflow | undefined =>
    context.uow.execute((tx) => {
      const row = tx.get<{ value_json: string }>(
        "SELECT value_json FROM automation_creation_workflows WHERE id = ?",
        id,
      );
      return row
        ? CreationWorkflowSchema.parse(JSON.parse(row.value_json))
        : undefined;
    });
  const save = (
    value: CreationWorkflow,
    patch: Partial<CreationWorkflow>,
    accepted?: { runId: string; sessionId: string },
    sourceConflict?: CreationSourceConflict,
  ): CreationWorkflow => {
    const next = CreationWorkflowSchema.parse({
      ...value,
      ...patch,
      version: value.version + 1,
      updatedAt: new Date().toISOString(),
    });
    context.uow.execute((tx) => {
      const current = tx.get<{ version: number }>(
        "SELECT version FROM automation_creation_workflows WHERE id = ?",
        value.id,
      );
      if (current?.version !== value.version)
        throw new Error("创作状态已变化，请刷新后继续。");
      tx.run(
        "UPDATE automation_creation_workflows SET stage = ?, version = ?, value_json = ?, updated_at = ? WHERE id = ? AND version = ?",
        next.stage,
        next.version,
        JSON.stringify(next),
        next.updatedAt,
        next.id,
        value.version,
      );
      if (accepted) recordContinuationStarted(tx, next, accepted);
      const status =
        next.stage === "failed"
          ? "failed"
          : next.stage === "canceled"
            ? "canceled"
            : next.stage === "interrupted"
              ? "interrupted"
              : ACTIVE.includes(next.stage)
                ? "running"
                : "succeeded";
      tx.run(
        "UPDATE automation_tasks SET status = ?, progress = ?, result_json = ?, error = ?, updated_at = ? WHERE id = ?",
        status,
        ["awaiting-review", "applied", "discarded"].includes(next.stage)
          ? 1
          : next.stage === "generating"
            ? 0.2
            : next.stage === "checking"
              ? 0.5
              : 0.75,
        JSON.stringify({
          creationWorkflowId: next.id,
          stage: next.stage,
          previewId: next.previewId,
          operation: next.input.operation,
          targetId: next.input.targetId,
          issues: next.issues,
        }),
        next.error ?? null,
        next.updatedAt,
        next.taskId,
      );
      if (
        next.sourceWorkflowId &&
        ["awaiting-review", "applied"].includes(next.stage)
      ) {
        tx.run(
          "UPDATE automation_tasks SET attention_status = 'acknowledged', updated_at = ? WHERE id IN (SELECT json_extract(value_json, '$.taskId') FROM automation_creation_workflows WHERE id = ?)",
          next.updatedAt,
          next.sourceWorkflowId,
        );
      }
      tx.append({
        type: "automation.task-updated.v1",
        pluginId: "automation",
        aggregateType: "task",
        aggregateId: next.taskId,
        aggregateVersion: next.version,
        payload: { id: next.taskId, status, projectId: next.input.projectId },
      });
      tx.append({
        type: "automation.creation-updated.v1",
        pluginId: "automation",
        aggregateType: "creation",
        aggregateId: next.id,
        aggregateVersion: next.version,
        payload: {
          id: next.id,
          projectId: next.input.projectId,
          stage: next.stage,
          taskId: next.taskId,
        },
      });
      if (
        next.stage === "awaiting-review" &&
        value.stage !== "awaiting-review"
      ) {
        recordCreativeCandidate(tx, next);
        recordPlanningCandidate(tx, next);
      }
      if (
        next.stage !== value.stage &&
        ["failed", "canceled", "discarded", "interrupted"].includes(next.stage)
      ) {
        recordCreativeMetricState(tx, next, next.stage);
        recordPlanningMetricState(tx, next, next.stage);
      }
      if (next.stage === "awaiting-review" && patch.error) {
        recordCreativeMetricState(tx, next, "adoption-rejected");
        recordPlanningMetricState(tx, next, "adoption-rejected");
      }
      if (next.stage === "awaiting-review" && patch.error && sourceConflict) {
        recordCreativeSourceConflict(tx, next, sourceConflict);
        recordPlanningSourceConflict(tx, next, sourceConflict);
      }
      // Only reconcile a formal review whose authoritative owner has accepted
      // the decision. No peer SQL; the workflow and its preview belong here.
      if (
        [
          "adaptation-diagnosis",
          "adaptation-strategy",
          "season-plan",
          "quality-review",
        ].includes(next.input.operation) &&
        next.previewId &&
        ["applied", "discarded"].includes(next.stage)
      ) {
        const status = next.stage === "applied" ? "committed" : "discarded";
        const preview = tx.get<{ status: string }>(
          "SELECT status FROM automation_change_previews WHERE id = ? AND task_id = ?",
          next.previewId,
          next.taskId,
        );
        if (preview && preview.status !== status) {
          tx.run(
            "UPDATE automation_change_previews SET status = ?, committed_at = ? WHERE id = ? AND task_id = ?",
            status,
            status === "committed" ? next.updatedAt : null,
            next.previewId,
            next.taskId,
          );
          tx.append({
            type: `automation.change-preview-${status}.v1`,
            pluginId: "automation",
            aggregateType: "change-preview",
            aggregateId: next.previewId,
            aggregateVersion: next.version,
            payload: {
              id: next.previewId,
              projectId: next.input.projectId,
              workflowId: next.id,
              status,
            },
          });
        }
      }
    });
    if (next.input.operation === "chapter-memory") {
      const parents = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE json_extract(value_json, '$.memoryWorkflowId') = ?",
          next.id,
        ),
      );
      const memoryState =
        next.stage === "applied"
          ? "synced"
          : next.stage === "awaiting-review"
            ? "review-required"
            : ACTIVE.includes(next.stage)
              ? "running"
              : "failed";
      for (const row of parents) {
        const parent = get(row.id);
        if (
          parent &&
          (parent.memoryState !== memoryState ||
            parent.memoryError !== next.error)
        )
          save(parent, { memoryState, memoryError: next.error });
      }
    }
    return next;
  };
  const preflight = (
    raw: CreationInput,
    options?: CreationPrepareOptions,
  ): void => {
    const input = CreationInputSchema.parse(raw);
    if (input.authorIntentRequest && input.operation !== "author-intent")
      throw new Error("作者意图来源只适用于独立意图操作，不能静默忽略。");
    if (
      input.adaptationStrategyRequest &&
      input.operation !== "adaptation-strategy"
    )
      throw new Error("独立策略基准只适用于独立策略操作，不能静默忽略。");
    if (input.operation !== "chapter")
      throw new Error("无写入预检当前仅用于小说续章目标。");
    if (!optionalService(context, CREATION_QUALITY_SERVICE))
      throw new Error("创作检查插件未启用。");
    const prepared = adapter(context, input).prepare(input, options);
    const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
    if (!runner?.previewCreation)
      throw new Error("当前引擎执行器不支持无写入创作预检。");
    const { preview } = runner.previewCreation({
      projectId: input.projectId,
      chapterId: input.targetId,
      engineKind: input.engineKind,
      model: input.model,
      prompt: creationStagePrompt(input, prepared.prompt, CONTENT_FORMAT),
      references: prepared.references ?? [],
    });
    assertPreparedContext(prepared, { snapshot: preview }, input);
  };
  const start = (
    raw: CreationInput,
    key: string,
    sourceWorkflowId?: string,
    rebaseSource?: CreationWorkflow["rebaseSource"],
    mergedOutput?: CreationWorkflow["output"],
    recordMerge?: {
      source: ProductionRecordMergeSource;
      references: AgentContextReference[];
    },
  ): CreationWorkflow => {
    const input = CreationInputSchema.parse(raw);
    if (input.authorIntentRequest && input.operation !== "author-intent")
      throw new Error("作者意图来源只适用于独立意图操作，不能静默忽略。");
    if (
      input.adaptationStrategyRequest &&
      input.operation !== "adaptation-strategy"
    )
      throw new Error("独立策略基准只适用于独立策略操作，不能静默忽略。");
    if (input.narrativeContextRequest && input.operation !== "chapter")
      throw new Error(
        "明确小说上下文只适用于本章正文操作，其他操作不能静默忽略范围。",
      );
    if (
      input.narrativePlanningRequest &&
      (!NarrativePlanningOperationSchema.safeParse(input.operation).success ||
        input.targetId ||
        input.baseVersion !== undefined ||
        input.sourceIds.length ||
        input.reviewPackageId ||
        input.feedbackClusterId)
    )
      throw new Error(
        "独立规划来源只用于人物、大纲、故事弧与知识规划，不能混入兼容目标、来源或审片要求。",
      );
    if (
      input.narrativeSummaryRequest &&
      input.operation !== "narrative-summary"
    )
      throw new Error("分层摘要范围只适用于独立摘要操作，不能静默忽略。");
    if (!key) throw new Error("缺少幂等标识。");
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          input,
          sourceWorkflowId,
          rebaseSource,
          ...(recordMerge ? { recordMergeSource: recordMerge.source } : {}),
        }),
      )
      .digest("hex");
    const existing = context.uow.execute((tx) =>
      tx.get<{ request_hash: string; value_json: string }>(
        "SELECT request_hash, value_json FROM automation_creation_workflows WHERE request_key = ?",
        key,
      ),
    );
    if (existing) {
      if (existing.request_hash !== hash)
        throw new Error("同一幂等标识不能用于不同创作要求。");
      return CreationWorkflowSchema.parse(JSON.parse(existing.value_json));
    }
    const owner = adapter(context, input);
    if (!optionalService(context, CREATION_QUALITY_SERVICE))
      throw new Error("创作检查插件未启用。");
    const source = sourceWorkflowId ? get(sourceWorkflowId) : undefined;
    if (
      sourceWorkflowId &&
      (!source || source.input.projectId !== input.projectId)
    )
      throw new Error("原创作运行不存在。");
    const effectiveRebaseSource = rebaseSource ?? source?.rebaseSource;
    const effectiveRecordMergeSource =
      recordMerge?.source ?? source?.recordMergeSource;
    if (effectiveRecordMergeSource) {
      const original = get(effectiveRecordMergeSource.request.workflow.id);
      const owner = optionalService(
        context,
        PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
      );
      if (
        !original ||
        !owner ||
        input.operation !== "storyboard-package" ||
        effectiveRebaseSource
      )
        throw new Error("原字段合并候选或本域服务不可核对，不升级为重新生成。");
      const checked = owner.mergeRecords(
        original,
        effectiveRecordMergeSource.request,
      );
      if (
        canonicalCreativeMergeJSON(checked.source) !==
        canonicalCreativeMergeJSON(effectiveRecordMergeSource)
      )
        throw new Error("原字段合并冻结来源已变化，不创建替代运行。");
    }
    const rebaseParent = rebaseSource ? get(rebaseSource.id) : undefined;
    const frozenMergeOutput =
      mergedOutput ??
      (source?.rebaseSource || source?.recordMergeSource
        ? source.output
        : undefined);
    if (effectiveRecordMergeSource && !frozenMergeOutput)
      throw new Error("字段合并缺少原冻结结果，不重新生成。");
    if (
      effectiveRebaseSource &&
      (!frozenMergeOutput ||
        (rebaseSource &&
          (!rebaseParent ||
            rebaseParent.input.projectId !== input.projectId ||
            rebaseParent.input.targetId !== input.targetId)))
    )
      throw new Error(
        "原合并缺少冻结结果或实际归属，不能重新生成替代作者选择。",
      );
    const originalSnapshot =
      recordMerge && source?.sourceSnapshotId
        ? optionalService(context, AGENT_CONTEXT_SERVICE)?.getSnapshot(
            source.sourceSnapshotId,
          )
        : undefined;
    if (
      recordMerge &&
      (!source ||
        !originalSnapshot ||
        originalSnapshot.projectId !== input.projectId)
    )
      throw new Error("原字段合并快照缺失，不重读最新文字替代。");
    const prepared: ReturnType<CreationAdapter["prepare"]> = source
      ? {
          prompt:
            source.preparedPrompt +
            (recordMerge
              ? "\n新增 record-field-merge 引用是作者明确选择的待采用字段，标题与场景动作独立于镜头文字。只复检此冻结选择及其一致性，不重新生成、不替换字段；不是已采用事实或已验证语义安全。"
              : ""),
          sources: [
            ...source.sources,
            ...(recordMerge?.references.map((entry) => ({
              id: entry.sourceId,
              kind: entry.sourceKind,
              title: "作者明确选择的实际创作字段",
              version: entry.sourceVersion,
            })) ?? []),
          ],
          ...(recordMerge
            ? {
                references: [
                  ...originalSnapshot!.entries
                    .filter((entry) => entry.included)
                    .map(
                      ({
                        mode: _mode,
                        included: _included,
                        reason: _reason,
                        estimatedTokens: _tokens,
                        ...entry
                      }) => entry,
                    ),
                  ...recordMerge.references,
                ],
              }
            : {}),
          authorIntent: source.authorIntent,
          authorIntentBasis: source.authorIntentBasis,
          continuationBasis: source.continuationBasis,
          diagnosisBasis: source.diagnosisBasis,
          adaptationStrategyBasis: source.adaptationStrategyBasis,
          seasonPlanBasis: source.seasonPlanBasis,
          episodeDevelopmentBasis: source.episodeDevelopmentBasis,
          narrativeQualityBasis: source.narrativeQualityBasis,
          narrativeContextBasis: source.narrativeContextBasis,
          narrativePlanningBasis: source.narrativePlanningBasis,
          productionNarrativeBasis: source.productionNarrativeBasis,
          narrativeSummaryBasis: source.narrativeSummaryBasis,
        }
      : owner.prepare(input);
    const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
    if (!runner?.prepareCreation)
      throw new Error("当前引擎执行器不支持冻结创作上下文。");
    const feedbackReferences = source
      ? []
      : [
          ...(input.reviewPackageId
            ? (optionalService(context, CREATION_REVIEW_SERVICE)?.references(
                input.projectId,
                input.reviewPackageId,
                input.targetId ?? "",
              ) ??
              (() => {
                throw new Error("审片插件未启用。");
              })())
            : []),
          ...(input.feedbackClusterId
            ? (optionalService(context, CREATION_INSIGHTS_SERVICE)?.references(
                input.projectId,
                input.feedbackClusterId,
                input.targetId ?? "",
              ) ??
              (() => {
                throw new Error("反馈插件未启用。");
              })())
            : []),
        ];
    const freezeRequest = {
      projectId: input.projectId,
      conversationId: input.conversationId,
      chapterId:
        input.operation === "chapter" || input.operation === "chapter-memory"
          ? input.targetId
          : undefined,
      engineKind: input.engineKind,
      model: input.model,
      prompt: recordMerge
        ? creationStagePrompt(
            input,
            prepared.prompt,
            `${optionalService(context, CREATION_QUALITY_SERVICE)!.promptFor(input.operation)}\n候选：${JSON.stringify(frozenMergeOutput)}`,
          )
        : prepared.narrativePlanningBasis ||
            input.operation === "author-intent" ||
            input.operation === "chapter" ||
            input.operation === "quality-review" ||
            input.operation === "adaptation-diagnosis" ||
            input.operation === "adaptation-strategy" ||
            input.operation === "season-plan" ||
            input.operation === "episode-outline" ||
            input.operation === "episode-script" ||
            input.operation === "storyboard-package" ||
            [
              "episode",
              "script-revision",
              "review-check",
              "shot-prompt",
            ].includes(input.operation)
          ? creationStagePrompt(input, prepared.prompt, CONTENT_FORMAT)
          : prepared.prompt,
      references: [
        ...("references" in prepared ? (prepared.references ?? []) : []),
        ...feedbackReferences,
      ],
    };
    // Rejected author-selected narrative/adaptation input must not leave context records behind.
    // This is the same policy/budget/compiler path, but without persistence.
    if (
      (!source || recordMerge) &&
      (prepared.narrativePlanningBasis ||
        prepared.narrativeContextBasis ||
        input.operation === "author-intent" ||
        input.operation === "adaptation-diagnosis" ||
        input.operation === "adaptation-strategy" ||
        input.operation === "season-plan" ||
        ["episode-outline", "episode-script", "storyboard-package"].includes(
          input.operation,
        ) ||
        ["episode", "script-revision", "review-check", "shot-prompt"].includes(
          input.operation,
        ))
    ) {
      if (!runner.previewCreation)
        throw new Error("当前引擎执行器不支持无写入创作预检。");
      const { preview } = runner.previewCreation(freezeRequest);
      assertPreparedContext(prepared, { snapshot: preview }, input);
      if (recordMerge)
        for (const reference of prepared.references ?? [])
          if (
            !preview.entries.some(
              (entry) =>
                entry.included &&
                entry.sourceId === reference.sourceId &&
                entry.sourceVersion === reference.sourceVersion &&
                entry.fieldPath === reference.fieldPath &&
                canonicalCreativeMergeJSON(entry.value) ===
                  canonicalCreativeMergeJSON(reference.value),
            )
          )
            throw new Error(
              "字段合并完整选择及原来源未通过隐私／预算；不创建快照、任务或模型调用。",
            );
    }
    const frozen =
      source && !recordMerge
        ? undefined
        : runner.prepareCreation(freezeRequest);
    assertPreparedContext(prepared, frozen, input);
    const authorIntent = prepared.authorIntent;
    if (frozen) input.model = frozen.model;
    const targetContent =
      "references" in prepared
        ? (
            prepared.references?.find(
              (entry) => entry.sourceId === input.targetId,
            )?.value as { content?: unknown } | undefined
          )?.content
        : undefined;
    const task = { id: crypto.randomUUID() };
    const at = new Date().toISOString();
    const value = CreationWorkflowSchema.parse({
      id: crypto.randomUUID(),
      taskId: task.id,
      creationRequestReceipt: {
        format: "creation-request-receipt-v1",
        key,
        requestHash: hash,
      },
      input,
      stage: "preparing",
      version: 0,
      sourceWorkflowId: sourceWorkflowId ?? rebaseParent?.id,
      authorIntent,
      authorIntentBasis: prepared.authorIntentBasis,
      continuationBasis: prepared.continuationBasis,
      diagnosisBasis: prepared.diagnosisBasis,
      adaptationStrategyBasis: prepared.adaptationStrategyBasis,
      seasonPlanBasis: prepared.seasonPlanBasis,
      episodeDevelopmentBasis: prepared.episodeDevelopmentBasis,
      narrativeQualityBasis: prepared.narrativeQualityBasis,
      narrativeSummaryBasis: prepared.narrativeSummaryBasis,
      productionNarrativeBasis: prepared.productionNarrativeBasis
        ? {
            ...prepared.productionNarrativeBasis,
            ...(frozen
              ? {
                  contextBudget: {
                    source: "estimate",
                    tokenBudget: frozen.snapshot.tokenBudget,
                    estimatedTokens: frozen.snapshot.estimatedTokens,
                  },
                }
              : {}),
          }
        : undefined,
      narrativePlanningBasis: prepared.narrativePlanningBasis
        ? {
            ...prepared.narrativePlanningBasis,
            ...(frozen
              ? {
                  contextBudget: {
                    source: "estimate",
                    tokenBudget: frozen.snapshot.tokenBudget,
                    estimatedTokens: frozen.snapshot.estimatedTokens,
                  },
                }
              : {}),
          }
        : undefined,
      narrativeContextBasis: prepared.narrativeContextBasis
        ? {
            ...prepared.narrativeContextBasis,
            ...(frozen
              ? {
                  contextBudget: {
                    source: "estimate",
                    tokenBudget: frozen.snapshot.tokenBudget,
                    estimatedTokens: frozen.snapshot.estimatedTokens,
                  },
                }
              : {}),
          }
        : undefined,
      rebaseSource: effectiveRebaseSource,
      recordMergeSource: effectiveRecordMergeSource,
      runIds: [],
      contextSnapshotIds: frozen
        ? [...(source?.contextSnapshotIds ?? []), frozen.snapshot.id]
        : [...(source?.contextSnapshotIds ?? [])],
      sourceSnapshotId: frozen?.snapshot.id ?? source?.sourceSnapshotId,
      sourceContextIntegrity: frozen
        ? {
            snapshotId: frozen.snapshot.id,
            manifestSha256: frozen.snapshot.manifestSha256,
            finalPromptSha256: frozen.snapshot.finalPromptSha256,
          }
        : source?.sourceContextIntegrity,
      contextEntries:
        frozen?.snapshot.entries.map((entry) => ({
          title: String(
            (entry.value as { title?: string })?.title ?? entry.fieldPath,
          ),
          included: entry.included,
          reason: entry.reason,
          estimatedTokens: entry.estimatedTokens,
          fieldPath: entry.fieldPath,
          sourceId: entry.sourceId,
          sourceVersion: entry.sourceVersion,
        })) ??
        source?.contextEntries ??
        [],
      referenceVersions:
        frozen?.snapshot.entries
          .filter(
            (entry) =>
              entry.included &&
              "references" in prepared &&
              prepared.references?.some(
                (reference) =>
                  reference.sourceId === entry.sourceId &&
                  reference.fieldPath === entry.fieldPath,
              ),
          )
          .map((entry) => ({
            sourceId: entry.sourceId,
            sourceVersion: entry.sourceVersion,
            fieldPath: entry.fieldPath,
          })) ??
        source?.referenceVersions ??
        [],
      sources: frozen
        ? prepared.sources.filter((source) =>
            frozen.snapshot.entries.some(
              (entry) => entry.sourceId === source.id && entry.included,
            ),
          )
        : prepared.sources,
      baseText:
        source?.baseText ??
        (typeof targetContent === "string" ? targetContent : undefined),
      baseBlocks:
        source?.baseBlocks ??
        ("baseBlocks" in prepared ? prepared.baseBlocks : undefined),
      preparedPrompt: prepared.prompt,
      output:
        frozenMergeOutput ??
        ("checkContent" in prepared ? prepared.checkContent : undefined),
      issues: [],
      createdAt: at,
      updatedAt: at,
    });
    context.uow.execute((tx) => {
      tx.run(
        "INSERT INTO automation_tasks(id,kind,status,title,progress,project_id,parent_task_id,payload_json,result_json,error,created_at,updated_at) VALUES (?, 'creation.workflow', 'running', ?, 0, ?, ?, ?, ?, NULL, ?, ?)",
        task.id,
        `AI 创作 · ${input.instruction.slice(0, 60)}`,
        input.projectId,
        source?.taskId ?? rebaseParent?.taskId ?? null,
        JSON.stringify(input),
        JSON.stringify({
          creationWorkflowId: value.id,
          stage: value.stage,
          targetId: input.targetId,
        }),
        at,
        at,
      );
      tx.run(
        "INSERT INTO automation_creation_workflows(id, project_id, target_id, stage, version, request_key, request_hash, value_json, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
        value.id,
        input.projectId,
        input.targetId ?? null,
        value.stage,
        key,
        hash,
        JSON.stringify(value),
        at,
        at,
      );
      tx.append({
        type: "automation.creation-created.v1",
        pluginId: "automation",
        aggregateType: "creation",
        aggregateId: value.id,
        aggregateVersion: 0,
        payload: { id: value.id, projectId: input.projectId, taskId: task.id },
      });
      recordCreativeRequest(tx, value);
      recordPlanningRequest(tx, value);
      recordContinuationRequest(tx, value);
    });
    if (source?.input.operation === "chapter-memory") {
      const parents = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE json_extract(value_json, '$.memoryWorkflowId') = ?",
          source.id,
        ),
      );
      for (const row of parents) {
        const parent = get(row.id);
        if (parent)
          save(parent, {
            memoryWorkflowId: value.id,
            memoryState: "running",
            memoryError: undefined,
          });
      }
    }
    return value;
  };
  const ready = (value: CreationWorkflow) => {
    if (!value.output) throw new Error("没有可审阅的候选。");
    if (value.input.operation === "review-check") {
      if (
        value.input.productionNarrativeRequest ||
        value.productionNarrativeBasis
      ) {
        const owner = adapter(context, value.input);
        if (!owner.assertSourcesCurrent)
          throw new Error(
            "当前制作服务不支持原明确来源的结束核对，不能宣称复检完成。",
          );
        owner.assertSourcesCurrent(value);
      }
      save(value, { stage: "applied" });
      return;
    }
    if (value.issues.some((issue) => issue.severity === "error"))
      throw new Error(
        value.issues.some(
          (issue) => issue.source === "rule" && issue.severity === "error",
        )
          ? "复检后候选仍有结构问题；内容与问题已保留，请补充要求后重试。"
          : "复检后候选仍有严重质量问题；内容与问题已保留，请保持原来源修订复检。",
      );
    if (
      value.input.operation === "chapter-memory" &&
      value.issues.length === 0 &&
      // Only factual sync derived from an already explicitly adopted chapter
      // inherits that adoption. A standalone author-requested memory run is a
      // candidate and must be reviewed/committed, even with no model issues.
      context.uow.execute((tx) =>
        tx.get(
          "SELECT id FROM automation_creation_workflows WHERE stage = 'applied' AND json_extract(value_json, '$.input.operation') = 'chapter' AND json_extract(value_json, '$.memoryWorkflowId') = ? AND json_extract(value_json, '$.input.projectId') = ? AND json_extract(value_json, '$.input.targetId') = ?",
          value.id,
          value.input.projectId,
          value.input.targetId,
        ),
      )
    ) {
      adapter(context, value.input).apply(value);
      save(value, { stage: "applied" });
      return;
    }
    const previews = optionalService(context, AUTOMATION_PREVIEW_SERVICE);
    if (!previews) throw new Error("候选预览服务未启用。");
    const review = adapter(context, value.input).review?.(value) ?? {};
    const existing = context.uow.execute((tx) =>
      tx.get<{ id: string }>(
        "SELECT id FROM automation_change_previews WHERE task_id = ? ORDER BY created_at DESC LIMIT 1",
        value.taskId,
      ),
    );
    if (existing) {
      save(value, {
        stage: "awaiting-review",
        previewId: existing.id,
        ...review,
      });
      return;
    }
    const preview = previews.createChange({
      projectId: value.input.projectId,
      taskId: value.taskId,
      runId: value.runId,
      sessionId: value.sessionId,
      engineKind: value.input.engineKind,
      taskType: `creation.${value.input.operation}`,
      targets:
        value.input.operation === "chapter" &&
        value.input.targetId &&
        value.input.baseVersion !== undefined
          ? [
              {
                kind: "chapter",
                id: value.input.targetId,
                baseVersion: value.input.baseVersion,
                patch: { content: value.output.content },
                displayDiff: {
                  candidate: value.output.content,
                  before: value.baseText ?? "",
                  creationWorkflowId: value.id,
                },
              },
            ]
          : [
              {
                kind: "creation",
                id: value.id,
                baseVersion: value.version,
                patch: { workflowId: value.id },
                displayDiff: { candidate: value.output },
              },
            ],
      rationale: value.issues.length
        ? `已完成生成与检查，仍有 ${value.issues.length} 项审阅意见；请核对后采用。`
        : "已完成生成与检查，请审阅候选。",
    });
    save(value, {
      stage: "awaiting-review",
      previewId: preview.id,
      error: undefined,
      ...review,
    });
  };
  const dispatch = async (
    value: CreationWorkflow,
    stage: "generating" | "checking" | "revising" | "rechecking",
  ) => {
    const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
    if (!runner?.get || !runner.cancel)
      throw new Error("当前引擎执行器不支持可恢复创作工作流。");
    const quality = optionalService(context, CREATION_QUALITY_SERVICE);
    if (!quality) throw new Error("创作检查插件未启用。");
    const suffix =
      stage === "generating"
        ? CONTENT_FORMAT
        : stage === "revising"
          ? `${CONTENT_FORMAT}\n仅修正列出的问题，保留其他内容及候选 ref。问题：${JSON.stringify(value.issues)}\n候选：${JSON.stringify(value.output)}`
          : `${quality.promptFor(value.input.operation)}\n候选：${JSON.stringify(value.output)}`;
    if (value.sourceContextIntegrity) {
      let snapshot;
      try {
        snapshot = optionalService(context, AGENT_CONTEXT_SERVICE)?.getSnapshot(
          value.sourceSnapshotId!,
        );
      } catch {
        throw new Error(
          "原创建上下文本次读取暂不可用；不使用替代快照或泄露内部读取错误。",
        );
      }
      if (
        !snapshot ||
        snapshot.id !== value.sourceContextIntegrity.snapshotId ||
        snapshot.projectId !== value.input.projectId ||
        snapshot.manifestSha256 !==
          value.sourceContextIntegrity.manifestSha256 ||
        snapshot.finalPromptSha256 !==
          value.sourceContextIntegrity.finalPromptSha256 ||
        createHash("sha256").update(snapshot.finalPrompt).digest("hex") !==
          value.sourceContextIntegrity.finalPromptSha256 ||
        createHash("sha256")
          .update(
            agentContextManifestJSON({
              projectId: snapshot.projectId,
              destination: snapshot.destination,
              tokenBudget: snapshot.tokenBudget,
              entries: snapshot.entries,
            }),
          )
          .digest("hex") !== value.sourceContextIntegrity.manifestSha256
      )
        throw new Error(
          "原创建上下文与独立冻结摘要不符，不使用改写快照或替代来源。",
        );
    }
    const runId = crypto.randomUUID();
    const pending = save(value, {
      stage,
      runId,
      runIds: [...value.runIds, runId],
    });
    const started = await runner.start({
      projectId: value.input.projectId,
      chapterId:
        value.input.operation === "chapter" ||
        value.input.operation === "chapter-memory"
          ? value.input.targetId
          : undefined,
      baseVersion: value.input.baseVersion,
      taskType: `creation_${stage}`,
      managed: true,
      contextSnapshotId: value.sourceSnapshotId,
      deriveContext: true,
      runId,
      engineKind: value.input.engineKind,
      model: value.input.model,
      prompt: creationStagePrompt(value.input, value.preparedPrompt, suffix),
    });
    const current = get(value.id);
    if (!current || current.stage === "canceled") {
      await runner.cancel(started.runId);
      return;
    }
    if (current.version === pending.version) {
      const actual = runner.get(started.runId);
      const accepted =
        actual &&
        started.runId === runId &&
        actual.sessionId === started.sessionId
          ? started
          : undefined;
      save(
        current,
        { sessionId: started.sessionId },
        stage === "generating" ? accepted : undefined,
      );
    }
  };
  const step = async (id: string) => {
    let value = get(id);
    if (!value || !ACTIVE.includes(value.stage)) return;
    try {
      if (value.stage === "preparing") {
        if (
          value.rebaseSource &&
          (!value.output || value.input.operation !== "script-revision")
        )
          throw new Error("原合并缺少冻结剧本结果，不自动重新生成或升级协议。");
        if (
          value.recordMergeSource &&
          (!value.output || value.input.operation !== "storyboard-package")
        )
          throw new Error("原字段合并缺少冻结结果，不重新生成替代作者选择。");
        await dispatch(
          value,
          value.rebaseSource || value.recordMergeSource
            ? "rechecking"
            : value.input.operation === "review-check"
              ? "checking"
              : "generating",
        );
        return;
      }
      const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
      if (!runner?.get || !value.runId)
        throw new Error("缺少可恢复的引擎运行。");
      const run = runner.get(value.runId);
      if (!run) throw new Error("引擎提交在保存前中断，请重试当前创作操作。");
      if (
        [
          "failed",
          "canceled",
          "interrupted",
          "orphaned",
          "recoverable",
        ].includes(run.status)
      )
        throw new Error(run.error ?? "原运行已中断，请重试。");
      if (run.status !== "completed") return;
      value = save(
        value,
        {
          sessionId: run.sessionId,
          contextSnapshotIds:
            run.contextSnapshotId &&
            !value.contextSnapshotIds.includes(run.contextSnapshotId)
              ? [...value.contextSnapshotIds, run.contextSnapshotId]
              : value.contextSnapshotIds,
        },
        { runId: value.runId, sessionId: run.sessionId },
      );
      if (!run.content) throw new Error("引擎没有返回可验证的内容。");
      if (value.stage === "generating" || value.stage === "revising") {
        const output = parseCreationContent(run.content);
        const issues = adapter(context, value.input).validate(
          value.input,
          output,
          value,
        );
        const previousStage = value.stage;
        value = save(value, { output, issues });
        await dispatch(
          value,
          previousStage === "generating" ? "checking" : "rechecking",
        );
      } else {
        const quality = optionalService(context, CREATION_QUALITY_SERVICE);
        if (!quality) throw new Error("创作检查插件未启用。");
        const issues = quality.collect(
          run.content,
          adapter(context, value.input).validate(
            value.input,
            value.output!,
            value,
          ),
          value.output!,
        );
        const stage = value.stage;
        value = save(value, { issues });
        if (
          stage === "checking" &&
          value.input.operation !== "review-check" &&
          issues.some((issue) => issue.severity !== "suggestion")
        )
          await dispatch(value, "revising");
        else ready(value);
      }
    } catch (error) {
      const current = get(id);
      if (current && ACTIVE.includes(current.stage))
        save(current, {
          stage: "failed",
          error:
            error instanceof Error
              ? error.message
              : "创作执行失败；已保存的候选仍保留。",
        });
    }
  };
  // Public immediate launch, explicit recheck, and the periodic worker share
  // one lease. A persisted runId precedes async Host session allocation; a
  // concurrent step must not treat that still-in-flight allocation as a
  // missing durable run. After restart there is no lease, so a genuinely
  // missing run still follows the existing interrupted/failed path.
  const busy = new Map<string, Promise<void>>();
  let stopping = false;
  const advance = (
    id: string,
    action: () => Promise<void> = () => step(id),
  ): Promise<void> => {
    if (stopping) return Promise.reject(new Error("创作推进器正在关闭。"));
    const pending = busy.get(id);
    if (pending) return pending;
    const work = Promise.resolve()
      .then(action)
      .finally(() => {
        if (busy.get(id) === work) busy.delete(id);
      });
    busy.set(id, work);
    return work;
  };
  const apply = (
    id: string,
    chapterPatch?: {
      previewId: string;
      id: string;
      version: number;
      content: string;
    },
  ):
    | "updated"
    | "conflict"
    | "unsupported"
    | "unavailable"
    | "quality-blocked" => {
    let value = get(id);
    if (!value) return "unsupported";
    if (value.stage === "applied")
      return chapterPatch && chapterPatch.previewId !== value.previewId
        ? "conflict"
        : "updated";
    if (value.stage !== "awaiting-review" || !value.output) return "conflict";
    // Historical pending candidates must pass the same gate as new ones. A
    // quality blocker is not evidence that their source or preview changed.
    if (value.issues.some((issue) => issue.severity === "error"))
      return "quality-blocked";
    try {
      if (chapterPatch) {
        if (
          value.input.operation !== "chapter" ||
          value.input.targetId !== chapterPatch.id
        )
          return "conflict";
        value = {
          ...value,
          input: { ...value.input, baseVersion: chapterPatch.version },
          output: { ...value.output!, content: chapterPatch.content },
          sources: value.sources.map((source) =>
            source.kind === "chapter" && source.id === chapterPatch.id
              ? { ...source, version: chapterPatch.version }
              : source,
          ),
          referenceVersions: value.referenceVersions.map((source) =>
            source.sourceId === chapterPatch.id
              ? { ...source, sourceVersion: chapterPatch.version }
              : source,
          ),
          previewId: chapterPatch.previewId,
        };
      }
      adapter(context, value.input).apply(value);
      const review = [
        "author-intent",
        "adaptation-strategy",
        "season-plan",
        "episode-outline",
        "episode-script",
        "storyboard-package",
        "quality-review",
      ].includes(value.input.operation)
        ? adapter(context, value.input).review?.(value)
        : undefined;
      save(value, { stage: "applied", error: undefined, ...review });
      return "updated";
    } catch (error) {
      if (
        error instanceof NarrativeQualityCommitError ||
        error instanceof CreativePlanningCommitError
      )
        throw error;
      // A temporary authoritative read failure is not observed source change.
      // Preserve the exact pending workflow/candidate without an error write,
      // conflict fact, new context, model call or automatic retry.
      if (error instanceof Error && "status" in error && error.status === 503)
        return "unavailable";
      save(
        value,
        {
          error:
            error instanceof Error
              ? error.message
              : "采用未完成，请检查来源版本。",
        },
        undefined,
        error instanceof CreationSourceConflictError
          ? error.sourceConflict
          : undefined,
      );
      return "conflict";
    }
  };
  const action = async (
    id: string,
    operation: "cancel" | "retry" | "continue",
    key: string,
  ): Promise<CreationWorkflow> => {
    const value = get(id);
    if (!value) throw new Error("创作运行不存在。");
    if (!key) throw new Error("缺少幂等标识。");
    if (operation === "cancel") {
      if (value.stage === "canceled") return value;
      if (!ACTIVE.includes(value.stage))
        throw new Error("当前运行已经结束；候选可单独放弃。");
      const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
      if (value.runId) {
        if (!runner?.cancel) throw new Error("执行器不支持取消。");
        await runner.cancel(value.runId);
      }
      const current = get(id)!;
      return ACTIVE.includes(current.stage)
        ? save(current, { stage: "canceled" })
        : current;
    }
    if (!["failed", "interrupted", "canceled"].includes(value.stage))
      throw new Error("当前运行无需重试。");
    if (operation === "continue" && !value.output)
      throw new Error("当前没有可继续检查的候选。");
    let continued = start(value.input, key, value.id);
    if (operation === "continue" && continued.stage === "preparing") {
      continued = save(continued, {
        output: value.output,
        issues: value.issues,
      });
      await advance(continued.id, () => dispatch(continued, "rechecking"));
    }
    return get(continued.id)!;
  };
  const syncReview = (id: string): CreationWorkflow | undefined => {
    const value = get(id);
    if (
      !value ||
      ![
        "author-intent",
        "adaptation-diagnosis",
        "adaptation-strategy",
        "season-plan",
        "quality-review",
      ].includes(value.input.operation) ||
      !["awaiting-review", "applied"].includes(value.stage)
    )
      return value;
    const decision = adapter(context, value.input).reviewState?.(value);
    if (value.stage === "applied") {
      if (value.input.operation === "season-plan" && decision === "adopted") {
        const review = adapter(context, value.input).review?.(value);
        if (review?.seasonPlanId && review.seasonPlanId !== value.seasonPlanId)
          save(value, { seasonPlanId: review.seasonPlanId });
      }
      return get(id);
    }
    if (decision === "adopted") apply(id);
    if (decision === "discarded")
      save(value, { stage: "discarded", error: undefined });
    return get(id);
  };
  context.effect(
    () =>
      provideService(context, CREATION_PROJECT_LINEAGE_SERVICE, {
        list: (
          projectId: string,
          options: { cursor?: string; limit: number },
        ) => {
          z.string().uuid().parse(projectId);
          const limit = z.number().int().min(1).max(100).parse(options.limit);
          const [cursorAt, cursorId, extra] = options.cursor?.split("|") ?? [];
          if (
            options.cursor &&
            (extra !== undefined ||
              !z.string().datetime().safeParse(cursorAt).success ||
              !z.string().uuid().safeParse(cursorId).success)
          )
            throw new Error("谱系分页身份无效。");
          return context.uow.execute((tx) => {
            const rows = tx.all<{
              id: string;
              project_id: string;
              version: number;
              stage: string;
              created_at: string;
              value_json: string;
            }>(
              "SELECT id, project_id, version, stage, created_at, value_json FROM automation_creation_workflows WHERE project_id = ? AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
              projectId,
              cursorAt ?? null,
              cursorAt ?? null,
              cursorAt ?? null,
              cursorId ?? null,
              limit + 1,
            );
            const items = rows.slice(0, limit).map((row) => {
              const receipt = projectCreationLineage(
                JSON.parse(row.value_json),
                projectId,
              );
              if (
                receipt.id !== row.id ||
                receipt.projectId !== row.project_id ||
                receipt.version !== row.version ||
                receipt.stage !== row.stage ||
                receipt.createdAt !== row.created_at
              )
                throw new Error("谱系原持久身份不一致。");
              return receipt;
            });
            return CreationProjectLineagePageSchema.parse({
              items,
              ...(rows.length > limit
                ? {
                    nextCursor: `${rows[limit - 1]!.created_at}|${rows[limit - 1]!.id}`,
                  }
                : {}),
            });
          });
        },
      }),
    `service:${CREATION_PROJECT_LINEAGE_SERVICE}`,
  );

  // Public metadata-only owner read. It deliberately completes Automation and
  // Agents reads before a consumer opens its own transaction; no peer SQL,
  // synchronization, launch, latest fallback or historical fact upgrade.
  const execution = (
    id: string,
    projectId: string,
  ): CreationExecutionReceipt | undefined => {
    z.string().uuid().parse(id);
    z.string().uuid().parse(projectId);
    const value = get(id);
    if (!value || value.input.projectId !== projectId) return undefined;
    const runner = optionalService(context, AGENT_TASK_RUNNER_SERVICE);
    if (!runner?.execution)
      throw new Error("Actual execution owner unavailable");
    const runs = value.runIds.map((runId) => {
      const recorded = runner.execution!(runId, projectId);
      if (!recorded) return { state: "missing" as const, runId };
      if (recorded.engineKind !== value.input.engineKind)
        throw new Error("Actual engine mismatch");
      const phase = recorded.taskType.slice("creation_".length);
      return { state: "recorded" as const, runId, phase, execution: recorded };
    });
    return CreationExecutionReceiptSchema.parse({
      format: "creation-execution-receipt-v1",
      workflowId: value.id,
      projectId,
      version: value.version,
      operation: value.input.operation,
      ...(value.sourceWorkflowId
        ? { sourceWorkflowId: value.sourceWorkflowId }
        : {}),
      runs,
      coverage: "exact-workflow-attempt",
      billingStatus: "unknown",
    });
  };
  const service = {
    preflight,
    start,
    get,
    execution,
    apply,
    syncReview,
    action,
    launch: async (id: string) => {
      await advance(id);
      const value = get(id);
      if (!value) throw new Error("创作运行不存在。");
      return value;
    },
  };
  context.effect(
    () => provideService(context, CREATION_WORKFLOW_SERVICE, service),
    `service:${CREATION_WORKFLOW_SERVICE}`,
  );
  context.effect(() => {
    const tick = () => {
      if (stopping) return;
      const rows = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE stage IN ('preparing','generating','checking','revising','rechecking') ORDER BY created_at LIMIT 20",
        ),
      );
      for (const { id } of rows)
        if (!busy.has(id)) {
          void advance(id).catch(() => undefined);
        }
      const ownerReviews = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE (stage = 'awaiting-review' AND json_extract(value_json, '$.input.operation') IN ('author-intent','adaptation-diagnosis','adaptation-strategy','season-plan','quality-review')) OR (stage = 'applied' AND json_extract(value_json, '$.input.operation') = 'season-plan') ORDER BY created_at",
        ),
      );
      for (const { id } of ownerReviews) syncReview(id);
      const revisions = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE stage = 'applied' AND json_extract(value_json, '$.input.operation') = 'script-revision' AND json_extract(value_json, '$.input.reviewPackageId') IS NOT NULL AND json_extract(value_json, '$.adoptionCheckId') IS NULL AND json_extract(value_json, '$.adoptionCheckError') IS NULL LIMIT 20",
        ),
      );
      for (const row of revisions) {
        const value = get(row.id)!;
        try {
          const target = optionalService(
            context,
            PRODUCTION_RECORD_SERVICE,
          )?.get(value.input.targetId!);
          if (!target) throw new Error("原剧本已删除。");
          const check = start(
            {
              ...value.input,
              operation: "review-check",
              baseVersion: target.version,
              instruction:
                "重新核对已采用版本与本次审片原问题，列出仍需用户处理的意见；不关闭问题。",
            },
            `adoption-check:${value.id}:${target.version}`,
          );
          save(value, { adoptionCheckId: check.id });
        } catch (error) {
          save(value, {
            adoptionCheckError:
              error instanceof Error ? error.message : "原问题复检未完成。",
          });
        }
      }
      const adopted = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE stage = 'applied' AND json_extract(value_json, '$.input.operation') = 'chapter' AND json_extract(value_json, '$.memoryState') IS NULL LIMIT 20",
        ),
      );
      for (const row of adopted) {
        const value = get(row.id)!;
        try {
          const chapter = optionalService(
            context,
            WRITING_CHAPTER_SERVICE,
          )?.get(value.input.targetId!);
          if (!chapter) throw new Error("章节已删除。");
          const memory = start(
            {
              projectId: chapter.projectId,
              operation: "chapter-memory",
              targetId: chapter.id,
              baseVersion: chapter.version,
              instruction:
                "从已采用正文提取摘要、事件、人物状态与伏笔，仅记录有原文证据的事实。",
              engineKind: value.input.engineKind,
              model: value.input.model,
              sourceIds: [],
            },
            `memory:${value.id}:${chapter.version}`,
          );
          save(value, { memoryState: "running", memoryWorkflowId: memory.id });
        } catch (error) {
          save(value, {
            memoryState: "failed",
            memoryError:
              error instanceof Error ? error.message : "派生资料更新未完成。",
          });
        }
      }
      const memoryParents = context.uow.execute((tx) =>
        tx.all<{ id: string }>(
          "SELECT id FROM automation_creation_workflows WHERE json_extract(value_json, '$.memoryState') = 'running' LIMIT 20",
        ),
      );
      for (const row of memoryParents) {
        const parent = get(row.id)!;
        const memory = parent.memoryWorkflowId
          ? get(parent.memoryWorkflowId)
          : undefined;
        if (memory && !ACTIVE.includes(memory.stage))
          save(parent, {
            memoryState:
              memory.stage === "applied"
                ? "synced"
                : memory.stage === "awaiting-review"
                  ? "review-required"
                  : "failed",
            memoryError: memory.error,
          });
      }
      const rebased = context.uow.execute((tx) =>
        tx.all<{ id: string; preview_id: string }>(
          "SELECT w.id, p.id AS preview_id FROM automation_creation_workflows w JOIN automation_change_previews p ON p.task_id = json_extract(w.value_json, '$.taskId') WHERE w.stage = 'awaiting-review' AND p.status = 'pending' AND p.id != json_extract(w.value_json, '$.previewId') AND p.created_at = (SELECT MAX(latest.created_at) FROM automation_change_previews latest WHERE latest.task_id = p.task_id)",
        ),
      );
      for (const row of rebased) {
        const value = get(row.id);
        if (value) save(value, { previewId: row.preview_id });
      }
      const reviewed = context.uow.execute((tx) =>
        tx.all<{ id: string; status: string }>(
          "SELECT w.id, p.status FROM automation_creation_workflows w JOIN automation_change_previews p ON p.id = json_extract(w.value_json, '$.previewId') WHERE w.stage = 'awaiting-review' AND p.status IN ('committed','discarded')",
        ),
      );
      for (const row of reviewed) {
        const value = get(row.id);
        if (value && row.status === "discarded") {
          try {
            adapter(context, value.input).discard?.(value);
          } catch (error) {
            save(value, {
              error:
                error instanceof Error ? error.message : "业务候选放弃未完成。",
            });
            continue;
          }
        }
        if (value)
          save(value, {
            stage: row.status === "committed" ? "applied" : "discarded",
          });
      }
    };
    const timer = setInterval(tick, 500);
    return async () => {
      stopping = true;
      clearInterval(timer);
      await Promise.allSettled(busy.values());
    };
  }, "worker:creation-workflows");

  type Request = {
    req: {
      param(name: string): string;
      query(name: string): string | undefined;
      header(name: string): string | undefined;
      json(): Promise<unknown>;
    };
    json(value: unknown, status?: number): Response;
  };
  const errorResponse = (
    _request: Request,
    error: unknown,
    status = error instanceof z.ZodError
      ? 400
      : error instanceof Error && "status" in error && error.status === 503
        ? 503
        : 409,
  ) => {
    const code =
      status === 400
        ? "VALIDATION_ERROR"
        : status === 404
          ? "NOT_FOUND"
          : status === 503
            ? "SERVICE_UNAVAILABLE"
            : "CONFLICT";
    return new Response(
      JSON.stringify({
        type: `https://dramaip.local/problems/${code.toLowerCase()}`,
        title: "创作操作未完成",
        status,
        code,
        traceId: crypto.randomUUID(),
        detail:
          status === 503
            ? "本次权威来源读取暂不可用；不采用旧缓存、替代来源或推定已知变化。"
            : error instanceof Error
              ? error.message
              : "请检查当前对象后重试。",
      }),
      {
        status,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      },
    );
  };
  const routes: RouteContribution[] = [];
  const add = (
    method: "get" | "post",
    path: `/api/v2/${string}`,
    operation: string,
    response: z.ZodType,
    handler: (request: Request) => unknown,
    body?: z.ZodType,
  ) => {
    const declaration = createRoute({
      method,
      path,
      operationId: `creation.${operation}`,
      tags: ["creation"],
      request: {
        ...(operation === "execution"
          ? { query: z.object({ projectId: z.string().uuid() }) }
          : {}),
        ...(path.includes("{id}")
          ? { params: z.object({ id: z.string().uuid() }) }
          : {}),
        ...(body
          ? {
              body: {
                content: { "application/json": { schema: body } },
                required: true,
              },
            }
          : {}),
      },
      responses: {
        ...(operation === "execution"
          ? {
              304: { description: "Exact execution receipt unchanged" },
              400: {
                description: "Invalid exact project scope",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
              404: {
                description: "Original workflow absent from project",
                content: {
                  "application/problem+json": { schema: ProblemDetailsSchema },
                },
              },
            }
          : {}),
        200: {
          description: "Success",
          content: { "application/json": { schema: response } },
        },
        409: {
          description: "Conflict",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
        503: {
          description: "Authoritative owner read temporarily unavailable",
          content: {
            "application/problem+json": { schema: ProblemDetailsSchema },
          },
        },
      },
    });
    routes.push(
      defineRouteContribution({
        id: `automation:creation-${operation}`,
        pluginId: "automation",
        method,
        path,
        operationId: `creation.${operation}`,
        ...(operation === "start"
          ? {
              // The durable original-request receipt is authoritative. In
              // particular, a refused privacy/source preflight must not be
              // cached by HTTP after the author restores its prerequisites.
              policy: {
                idempotency: "required" as const,
                concurrency: "optional" as const,
                idempotencyReplay: "handler" as const,
              },
            }
          : operation === "recordRebase"
            ? {
                policy: {
                  idempotency: "required" as const,
                  concurrency: "if-match-required" as const,
                  idempotencyReplay: "handler" as const,
                },
              }
            : {}),
        declaration,
        handler: handler as never,
      }),
    );
  };
  add(
    "post",
    "/api/v2/workflows/creation",
    "start",
    CreationWorkflowSchema,
    async (request) => {
      try {
        return request.json(
          start(
            CreationInputSchema.parse(await request.req.json()),
            request.req.header("Idempotency-Key") ?? "",
          ),
        );
      } catch (error) {
        return errorResponse(request, error);
      }
    },
    CreationInputSchema,
  );
  add(
    "get",
    "/api/v2/workflows/creation",
    "list",
    z.object({
      items: z.array(CreationWorkflowSchema),
      nextCursor: z.string().optional(),
    }),
    (request) => {
      const projectId = request.req.query("projectId");
      const targetId = request.req.query("targetId");
      const cursor = request.req.query("cursor");
      const [cursorAt, cursorId] = cursor?.split("|") ?? [];
      if (
        !projectId ||
        !z.string().uuid().safeParse(projectId).success ||
        (targetId && !z.string().uuid().safeParse(targetId).success) ||
        (cursor &&
          (!z.string().datetime().safeParse(cursorAt).success ||
            !z.string().uuid().safeParse(cursorId).success))
      )
        return errorResponse(
          request,
          new Error("项目、对象或分页游标无效。"),
          400,
        );
      const rows = context.uow.execute((tx) =>
        tx.all<{ id: string; created_at: string; value_json: string }>(
          "SELECT id, created_at, value_json FROM automation_creation_workflows WHERE project_id = ? AND (? IS NULL OR target_id = ?) AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 26",
          projectId,
          targetId ?? null,
          targetId ?? null,
          cursorAt ?? null,
          cursorAt ?? null,
          cursorAt ?? null,
          cursorId ?? null,
        ),
      );
      return request.json({
        items: rows
          .slice(0, 25)
          .map((row) =>
            CreationWorkflowSchema.parse(JSON.parse(row.value_json)),
          ),
        ...(rows.length > 25
          ? { nextCursor: `${rows[24]!.created_at}|${rows[24]!.id}` }
          : {}),
      });
    },
  );
  add(
    "get",
    "/api/v2/workflows/creation/{id}",
    "get",
    CreationWorkflowSchema,
    (request) => {
      const value = get(request.req.param("id"));
      return value
        ? new Response(JSON.stringify(value), {
            headers: {
              "Content-Type": "application/json",
              ETag: `"${value.version}"`,
            },
          })
        : errorResponse(request, new Error("创作运行不存在。"), 404);
    },
  );
  add(
    "get",
    "/api/v2/workflows/creation/{id}/execution",
    "execution",
    CreationExecutionReceiptSchema,
    (request) => {
      const project = z
        .string()
        .uuid()
        .safeParse(request.req.query("projectId"));
      if (!project.success)
        return errorResponse(request, new Error("缺少原项目范围。"), 400);
      try {
        const receipt = execution(request.req.param("id"), project.data);
        if (!receipt)
          return errorResponse(
            request,
            new Error("原项目未找到该创作工作流。"),
            404,
          );
        const body = JSON.stringify(receipt);
        const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
        return new Response(
          request.req.header("If-None-Match") === etag ? null : body,
          {
            status: request.req.header("If-None-Match") === etag ? 304 : 200,
            headers: {
              "Content-Type": "application/json",
              ETag: etag,
              "Cache-Control": "no-store",
            },
          },
        );
      } catch {
        // A failed authoritative read is not a missing run, zero usage or a reason to change the original workflow.
        return errorResponse(
          request,
          new Error("Execution owner read unavailable"),
          503,
        );
      }
    },
  );
  add(
    "post",
    "/api/v2/workflows/creation/{id}/actions",
    "action",
    CreationWorkflowSchema,
    async (request) => {
      try {
        const { action } = CreationActionSchema.parse(await request.req.json());
        const match = request.req.header("If-Match");
        if (match && match !== `"${get(request.req.param("id"))?.version}"`)
          throw new Error("运行状态已更新，请刷新后重试当前操作。");
        return request.json(
          await service.action(
            request.req.param("id"),
            action,
            request.req.header("Idempotency-Key") ?? "",
          ),
        );
      } catch (error) {
        return errorResponse(request, error);
      }
    },
    CreationActionSchema,
  );
  add(
    "get",
    "/api/v2/workflows/creation/{id}/merge",
    "merge",
    CreationMergeSchema,
    (request) => {
      try {
        const value = get(request.req.param("id"));
        if (!value)
          return errorResponse(request, new Error("候选不存在。"), 404);
        const merge = adapter(context, value.input).merge;
        if (!merge) throw new Error("该内容请使用所属领域的版本合并入口。");
        return request.json(merge(value));
      } catch (error) {
        return errorResponse(request, error);
      }
    },
  );
  const mergeInput = CreationRebaseRequestSchema;
  add(
    "get",
    "/api/v2/workflows/creation/{id}/record-merge",
    "recordMerge",
    ProductionRecordMergeComparisonSchema,
    (request) => {
      try {
        const value = get(request.req.param("id"));
        if (!value)
          return errorResponse(request, new Error("指定候选不存在。"), 404);
        const owner = optionalService(
          context,
          PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
        );
        if (!owner) throw new Error("实际记录字段比较服务未启用。");
        const report = owner.compareRecords(value);
        const response = request.json(report);
        response.headers.set("ETag", `"${report.comparisonHash}"`);
        return response;
      } catch (error) {
        return errorResponse(request, error);
      }
    },
  );
  add(
    "post",
    "/api/v2/workflows/creation/{id}/record-rebase",
    "recordRebase",
    CreationWorkflowSchema,
    async (request) => {
      try {
        const input = ProductionRecordMergeRequestSchema.parse(
          await request.req.json(),
        );
        const id = request.req.param("id"),
          key = request.req.header("Idempotency-Key") ?? "";
        if (
          !key ||
          input.workflow.id !== id ||
          request.req.header("If-Match") !== `"${input.workflow.version}"`
        )
          throw new Error("字段合并须提供原候选版本和幂等标识。");
        const existing = context.uow.execute((tx) =>
          tx.get<{ value_json: string }>(
            "SELECT value_json FROM automation_creation_workflows WHERE request_key = ?",
            key,
          ),
        );
        if (existing) {
          const flow = CreationWorkflowSchema.parse(
            JSON.parse(existing.value_json),
          );
          if (
            !flow.recordMergeSource ||
            canonicalCreativeMergeJSON(flow.recordMergeSource.request) !==
              canonicalCreativeMergeJSON(input)
          )
            throw new Error("同一幂等标识不能用于不同字段合并选择。");
          return request.json(flow);
        }
        const value = get(id);
        const owner = optionalService(
          context,
          PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
        );
        if (!value || value.recordMergeSource || !owner)
          throw new Error("原字段合并候选或本域服务不可用。");
        const merged = owner.mergeRecords(value, input);
        const next = start(
          value.input,
          key,
          value.id,
          undefined,
          merged.output,
          { source: merged.source, references: merged.references },
        );
        if (next.stage === "preparing")
          await advance(next.id, () => dispatch(next, "rechecking"));
        return request.json(get(next.id));
      } catch (error) {
        return errorResponse(request, error);
      }
    },
    ProductionRecordMergeRequestSchema,
  );
  add(
    "post",
    "/api/v2/workflows/creation/{id}/rebase",
    "rebase",
    CreationWorkflowSchema,
    async (request) => {
      try {
        const input = mergeInput.parse(await request.req.json());
        const rebaseSource = { id: request.req.param("id"), ...input };
        const key = request.req.header("Idempotency-Key") ?? "";
        if (!key) throw new Error("缺少幂等标识。");
        const existing = context.uow.execute((tx) =>
          tx.get<{ value_json: string }>(
            "SELECT value_json FROM automation_creation_workflows WHERE request_key = ?",
            key,
          ),
        );
        if (existing) {
          const flow = CreationWorkflowSchema.parse(
            JSON.parse(existing.value_json),
          );
          if (
            JSON.stringify(flow.rebaseSource) !== JSON.stringify(rebaseSource)
          )
            throw new Error("同一幂等标识不能用于不同合并选择。");
          return request.json(flow);
        }
        const value = get(request.req.param("id"));
        if (!value || value.stage !== "awaiting-review")
          throw new Error("原候选已处理或不存在。");
        const merge = adapter(context, value.input).merge;
        if (!merge) throw new Error("当前业务不支持此合并方式。");
        const result = merge(value, input.choices, {
          basis: input.basis,
          blockOrder: input.blockOrder,
        });
        if (result.currentVersion !== input.baseVersion)
          throw new Error("合并期间版本再次变化，请重新打开比较。");
        if (!result.output) throw new Error("请明确选择全部冲突块。");
        let next = start(
          { ...value.input, baseVersion: result.currentVersion },
          key,
          undefined,
          rebaseSource,
          result.output,
        );
        if (next.stage === "preparing") {
          await advance(next.id, () => dispatch(next, "rechecking"));
        }
        return request.json(get(next.id));
      } catch (error) {
        return errorResponse(request, error);
      }
    },
    mergeInput,
  );
  return { routes, service, step: advance };
}
