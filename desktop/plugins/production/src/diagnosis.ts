import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
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
  assertReviewedNarrativeSources,
  assertDiagnosisMixedEvidence,
  adaptationExpressionScope,
} from "./narrative-sources.js";
import {
  PRODUCTION_DIAGNOSIS_SERVICE,
  AdaptationDiagnosisSchema,
  DiagnosisContentSchema,
  DiagnosisRequestSchema,
  DiagnosisCatalogSchema,
  DiagnosisPageSchema,
  DiagnosisSummarySchema,
  DiagnosisSummaryPageSchema,
  DiagnosisAdoptInputSchema,
  type AdaptationDiagnosis,
  type DiagnosisBasis,
  type DiagnosisCatalog,
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

export const diagnosisMigration: PluginMigration = {
  id: "production.0005.adaptation-diagnoses",
  pluginId: "production",
  version: "3.0.0-alpha.4",
  dependsOn: ["production.0004.creation-adoption"],
  sql: `CREATE TABLE production_diagnoses (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL UNIQUE, version INTEGER NOT NULL, state_version INTEGER NOT NULL,
    status TEXT NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(project_id, version)
  );
  CREATE INDEX production_diagnoses_page ON production_diagnoses(project_id, created_at DESC, id DESC);
  CREATE TABLE production_diagnosis_heads (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, diagnosis_id TEXT NOT NULL REFERENCES production_diagnoses(id));
  CREATE TABLE production_diagnosis_requests (request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, diagnosis_id TEXT NOT NULL REFERENCES production_diagnoses(id), status INTEGER NOT NULL, detail TEXT);`,
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bodyHash = (content: string) =>
  createHash("sha256").update(content).digest("hex");
type Stored = Omit<
  AdaptationDiagnosis,
  "isCurrent" | "sourceState" | "staleReasons"
>;
class DiagnosisError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type Row = { value_json: string };
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

export function registerDiagnosis(context: PluginContext) {
  const project = (id: string) => {
    const value = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(id);
    if (!value) throw new DiagnosisError(404, "项目不存在。");
    return value;
  };
  const chapterInventory = (id: string) => {
    const service = optionalService(context, WRITING_CHAPTER_SERVICE);
    if (!service) throw new DiagnosisError(409, "来源章节服务未启用。");
    return service.list(id);
  };
  const chapters = (id: string) =>
    chapterInventory(id)
      .filter((item) => item.content.trim())
      .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  const metadata = (items: ReturnType<typeof chapters>) =>
    items.map((item) => ({
      id: item.id,
      version: item.version,
      title: item.title,
      orderIndex: item.orderIndex,
      contentHash: bodyHash(item.content),
      characters: item.content.length,
    }));
  const head = (tx: UnitOfWorkTransaction, projectId: string) =>
    tx.get<{ diagnosis_id: string }>(
      "SELECT diagnosis_id FROM production_diagnosis_heads WHERE project_id = ?",
      projectId,
    )?.diagnosis_id;
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<Row>(
      "SELECT value_json FROM production_diagnoses WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const catalog = (id: string): DiagnosisCatalog => {
    project(id);
    const inventory = metadata(chapters(id));
    const intentService = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    );
    if (!intentService)
      throw new DiagnosisError(409, "正式作者意图服务未启用。");
    const intent = intentService.current(id);
    return {
      projectId: id,
      chapters: inventory,
      inventoryFingerprint: hash(inventory),
      ...(intent
        ? { authorIntent: { id: intent.id, version: intent.version } }
        : {}),
      adoptedDiagnosisId: context.uow.execute((tx) => head(tx, id)),
    };
  };
  const sourceReview = (value: Stored) => {
    const reasons: string[] = [];
    const intent = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    )?.current(value.projectId);
    if (
      !intent ||
      intent.id !== value.authorIntent.id ||
      intent.version !== value.authorIntent.version
    )
      reasons.push("正式作者意图已变化");
    const currentChapters = chapterInventory(value.projectId);
    const current = metadata(
      currentChapters.filter((item) => item.content.trim()),
    );
    const chapterCollection = observedCreativeWholeBookCollection(
      value.projectId,
      value.basis,
      currentChapters,
    );
    const changes = [
      ...observedCreativeSourceChange(
        "author_intent",
        value.authorIntent,
        intent?.projectId === value.projectId ? intent : undefined,
      ),
      ...observedCreativeChapterChanges(value.basis.chapters, currentChapters),
    ];
    for (const source of value.basis.chapters) {
      const item = current.find((item) => item.id === source.id);
      if (
        !item ||
        item.version !== source.version ||
        item.contentHash !== source.contentHash ||
        item.orderIndex !== source.orderIndex
      )
        reasons.push(`来源章节「${source.title}」已变化或移除`);
    }
    if (
      value.basis.scope === "whole-book" &&
      (current.length !== value.basis.chapters.length ||
        current.some(
          (item) =>
            !value.basis.chapters.some((source) => source.id === item.id),
        ))
    )
      reasons.push("全书章节范围已变化");
    if (value.basis.sourceBasis) {
      try {
        const compiler = optionalService(
          context,
          WRITING_NARRATIVE_SOURCE_SERVICE,
        );
        if (!compiler) throw new Error("明确改编来源服务未启用");
        const compiled = compiler.compile(
          value.projectId,
          value.basis.chapters.map(({ id, version }) => ({ id, version })),
          narrativeSourceSelection(value.basis.sourceBasis),
        );
        if (
          narrativeSourceIdentity(compiled.basis) !==
          narrativeSourceIdentity(value.basis.sourceBasis)
        )
          reasons.push("诊断的实际来源表达已变化");
      } catch (error) {
        reasons.push(
          error instanceof Error ? error.message : "诊断的混合来源未核全",
        );
      }
    }
    return { reasons, changes, chapterCollection };
  };
  const decode = (value: Stored): AdaptationDiagnosis => {
    const currentId = context.uow.execute((tx) => head(tx, value.projectId));
    const staleReasons = sourceReview(value).reasons;
    const workflow = optionalService(context, CREATION_WORKFLOW_SERVICE)?.get(
      value.workflowId,
    );
    if (
      value.status === "pending" &&
      workflow &&
      ["discarded", "failed", "canceled"].includes(workflow.stage)
    )
      staleReasons.push("对应工作流已处理或未完成审阅");
    if (value.status === "pending" && currentId !== value.basis.baseAdoptedId)
      staleReasons.push("当前已采用诊断已变化");
    return AdaptationDiagnosisSchema.parse({
      ...value,
      isCurrent: currentId === value.id,
      sourceState: staleReasons.length ? "stale" : "current",
      staleReasons,
    });
  };
  const get = (id: string) => {
    const value = context.uow.execute((tx) => read(tx, id));
    return value ? decode(value) : undefined;
  };
  const event = (tx: UnitOfWorkTransaction, value: Stored) =>
    tx.append({
      type: `production.diagnosis-${value.status === "pending" ? "previewed" : value.status}.v1`,
      pluginId: "production",
      aggregateType: "adaptation-diagnosis",
      aggregateId: value.id,
      aggregateVersion: value.stateVersion,
      payload: {
        id: value.id,
        projectId: value.projectId,
        workflowId: value.workflowId,
        version: value.version,
        status: value.status,
        ...(value.selectedStrategyId
          ? { strategyId: value.selectedStrategyId }
          : {}),
      },
    });
  const prepare = (input: CreationInput) => {
    const request = DiagnosisRequestSchema.parse(input.diagnosisRequest);
    if (input.targetId || input.sourceIds.length)
      throw new DiagnosisError(
        409,
        "诊断只使用显式诊断范围，不使用旧目标或隐式来源。",
      );
    const available = catalog(input.projectId);
    if (
      available.inventoryFingerprint !== request.inventoryFingerprint ||
      available.adoptedDiagnosisId !== request.baseAdoptedId
    )
      throw new DiagnosisError(
        409,
        "来源目录或当前诊断已变化，请重新确认范围。",
      );
    if (
      !available.authorIntent ||
      available.authorIntent.id !== request.authorIntent.id ||
      available.authorIntent.version !== request.authorIntent.version
    )
      throw new DiagnosisError(409, "请先采用并确认当前正式作者意图。");
    if (
      new Set(request.chapters.map((item) => item.id)).size !==
      request.chapters.length
    )
      throw new DiagnosisError(409, "诊断范围有重复章节。");
    const selected = available.chapters.filter((item) =>
      request.chapters.some(
        (source) => source.id === item.id && source.version === item.version,
      ),
    );
    if (
      selected.length !== request.chapters.length ||
      (request.scope === "whole-book" &&
        selected.length !== available.chapters.length)
    )
      throw new DiagnosisError(
        409,
        "章节归属、版本或全书范围不完整，请重新确认。",
      );
    const basis: DiagnosisBasis = {
      scope: request.scope,
      chapters: selected,
      omittedChapters: available.chapters.filter(
        (item) => !selected.some((source) => source.id === item.id),
      ),
      rightsDeclared: true,
      target: request.target,
      baseAdoptedId: request.baseAdoptedId,
    };
    const intent = creationAuthorIntent(
      input.projectId,
      optionalService(context, WORKSPACE_AUTHOR_INTENT_SERVICE)!.current(
        input.projectId,
      ),
    );
    const bodies = chapters(input.projectId).filter((item) =>
      selected.some((source) => source.id === item.id),
    );
    const compiled = request.context
      ? (() => {
          const compiler = optionalService(
            context,
            WRITING_NARRATIVE_SOURCE_SERVICE,
          );
          if (!compiler)
            throw new DiagnosisError(409, "明确改编来源服务未启用。");
          const result = compiler.compile(
            input.projectId,
            selected.map(({ id, version }) => ({ id, version })),
            request.context,
          );
          if (result.basis.omitted.length || !result.references.length)
            throw new DiagnosisError(
              409,
              "诊断确认范围存在没有明确表达的章节，不会补原文或裁剪摘要。",
            );
          return result;
        })()
      : undefined;
    if (compiled) {
      basis.sourceBasis = compiled.basis;
      basis.chapters = basis.chapters.map((chapter) => ({
        ...chapter,
        narrativeContentHash: hash(
          bodies.find((item) => item.id === chapter.id)!.content,
        ),
      }));
    }
    const sourceReferences =
      compiled?.references ??
      bodies.map((item) =>
        creationReference("chapter", {
          id: item.id,
          version: item.version,
          title: item.title,
          orderIndex: item.orderIndex,
          content: item.content,
        }),
      );
    // The local basis preserves omitted metadata for the author's coverage
    // audit. Do not bypass context policy by embedding unselected titles or
    // content fingerprints in a model prompt outside the selected references.
    const modelScope = {
      scope: basis.scope,
      chapters: basis.chapters.map(({ id, version }) => ({ id, version })),
      omittedChapterCount: basis.omittedChapters.length,
      rightsDeclared: basis.rightsDeclared,
      target: basis.target,
      ...(compiled
        ? { actualExpressions: adaptationExpressionScope(compiled.basis) }
        : {}),
    };
    return {
      authorIntent: intent.authorIntent,
      diagnosisBasis: basis,
      references: [...intent.references, ...sourceReferences],
      sources: [
        ...intent.sources,
        ...sourceReferences.map((item) => ({
          kind: item.sourceKind,
          id: item.sourceId,
          version: item.sourceVersion,
        })),
      ],
      prompt: `${AUTHOR_INTENT_CREATION_PROMPT}\n独立改编诊断，不生成季纲、分集、剧本、分镜或媒体。只评估以下实际选择范围，未覆盖章节不可推断为已读全书。权利仅为用户声明，不是授权证明核验。模型观点与原著事实分开；成本只给风险等级，不虚构价格或已生成媒体。\n冻结范围：${JSON.stringify(modelScope)}\nitems 必须恰好一个 kind=adaptation-diagnosis 的条目，data 为严格 JSON：${JSON.stringify(z.toJSONSchema(DiagnosisContentSchema))}\n${compiled ? "本轮使用明确混合表达，不是全文原文诊断。reviewedSources 必须完整列明 actualExpressions 中实际引用；每项 finding 的 evidence 保留 chapterId/chapterVersion，并带 source={sourceId,sourceVersion,fieldPath,valuePath}，逐字 quote 只来自该章实际所选 /content 或高层／章节 /summary；高层仅指其完整原冻结范围，不能引用未提供的原文或元数据。" : "每项 finding 使用所选章节的 chapterId/chapterVersion 和原文逐字 quote；不填写混合 reviewedSources 或 source。"}策略 findingIds 引用这些证据。给出 2–3 个真正可比较的策略，解释保留、合并、删减、前置/重排、重构、节奏及制作风险。content 为供作者阅读的诊断摘要，不代替结构化 data。`,
    };
  };
  const content = (output: CreationContent) => {
    if (
      output.items.length !== 1 ||
      output.items[0]?.kind !== "adaptation-diagnosis" ||
      !output.content.trim()
    )
      throw new Error(
        "诊断必须只有一个独立结构化条目和非空摘要，不能混入剧本或分镜。",
      );
    const value = DiagnosisContentSchema.parse(output.items[0].data);
    for (const items of [value.findings, value.strategies])
      if (new Set(items.map((item) => item.id)).size !== items.length)
        throw new Error("问题或策略标识重复。");
    for (const strategy of value.strategies)
      if (
        strategy.findingIds.some(
          (id) => !value.findings.some((item) => item.id === id),
        )
      )
        throw new Error("策略引用了不存在的问题证据。");
    const strategies = value.strategies.map((strategy) =>
      hash({
        preserve: strategy.preserve,
        merge: strategy.merge,
        remove: strategy.remove,
        reorder: strategy.reorder,
        restructure: strategy.restructure,
        rhythm: strategy.rhythm,
      }),
    );
    if (new Set(strategies).size !== strategies.length)
      throw new Error(
        "策略只有标题或标识不同，缺少可比较的叙事动作与节奏差异。",
      );
    return value;
  };
  const validate = (
    _input: CreationInput,
    output: CreationContent,
    workflow?: CreationWorkflow,
  ): CreationIssue[] => {
    try {
      const value = content(output);
      if (workflow) {
        const basis = workflow.diagnosisBasis;
        const snapshot = workflow.sourceSnapshotId
          ? optionalService(context, AGENT_CONTEXT_SERVICE)?.getSnapshot(
              workflow.sourceSnapshotId,
            )
          : undefined;
        if (
          !basis ||
          !snapshot ||
          snapshot.projectId !== workflow.input.projectId
        )
          throw new Error("诊断缺少可核对的冻结来源。");
        if (basis.sourceBasis) {
          assertAdaptationSourceSnapshot(
            basis,
            workflow.input.projectId,
            snapshot.entries,
          );
          assertDiagnosisMixedEvidence(basis, value, snapshot.entries);
          return [];
        }
        assertReviewedNarrativeSources(undefined, value.reviewedSources);
        if (
          value.findings.some((finding) =>
            finding.evidence.some((item) => item.source),
          )
        )
          throw new Error("原文历史诊断不能伪造混合表达证据。");
        for (const item of basis.chapters) {
          const entry = snapshot.entries.find(
            (entry) =>
              entry.included &&
              entry.sourceKind === "chapter" &&
              entry.sourceId === item.id &&
              entry.sourceVersion === item.version &&
              entry.fieldPath === `/chapters/${item.id}`,
          );
          const body = entry?.value as { content?: unknown } | undefined;
          if (
            typeof body?.content !== "string" ||
            bodyHash(body.content) !== item.contentHash
          )
            throw new Error(
              "选定章节未完整纳入冻结上下文，不能声明该覆盖范围。",
            );
        }
        for (const finding of value.findings)
          for (const evidence of finding.evidence) {
            const source = basis.chapters.find(
              (item) =>
                item.id === evidence.chapterId &&
                item.version === evidence.chapterVersion,
            );
            const entry = snapshot.entries.find(
              (entry) =>
                entry.included &&
                entry.sourceKind === "chapter" &&
                entry.sourceId === evidence.chapterId &&
                entry.sourceVersion === evidence.chapterVersion &&
                entry.fieldPath === `/chapters/${evidence.chapterId}`,
            );
            const body = entry?.value as { content?: unknown } | undefined;
            if (
              !source ||
              typeof body?.content !== "string" ||
              !body.content.includes(evidence.quote)
            )
              throw new Error(
                `问题「${finding.id}」的引文不在实际冻结的选定章节中。`,
              );
          }
      }
      return [];
    } catch (error) {
      return [
        {
          severity: "error",
          source: "rule",
          message: error instanceof Error ? error.message : "诊断结构无效。",
          evidence: "",
          location: "改编诊断",
          suggestion:
            "使用完整冻结来源和可核对引文，修正独立诊断结构与 2–3 个策略。",
        },
      ];
    }
  };
  const preview = (workflow: CreationWorkflow): { diagnosisId: string } => {
    const existing = context.uow.execute((tx) =>
      tx.get<{ id: string }>(
        "SELECT id FROM production_diagnoses WHERE workflow_id = ?",
        workflow.id,
      ),
    );
    if (existing) return { diagnosisId: existing.id };
    if (
      !workflow.output ||
      !workflow.diagnosisBasis ||
      workflow.authorIntent?.state !== "adopted" ||
      !workflow.sourceSnapshotId ||
      validate(workflow.input, workflow.output, workflow).length
    )
      throw new Error("诊断的结构、意图或冻结来源不完整。");
    const candidate = content(workflow.output);
    return context.uow.execute((tx) => {
      const duplicate = tx.get<{ id: string }>(
        "SELECT id FROM production_diagnoses WHERE workflow_id = ?",
        workflow.id,
      );
      if (duplicate) return { diagnosisId: duplicate.id };
      const version = tx.get<{ next: number }>(
        "SELECT COALESCE(MAX(version), 0) + 1 AS next FROM production_diagnoses WHERE project_id = ?",
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
        title: workflow.output!.title,
        content: candidate,
        basis: workflow.diagnosisBasis!,
        authorIntent: {
          id:
            workflow.authorIntent!.state === "adopted"
              ? workflow.authorIntent!.id
              : "",
          version:
            workflow.authorIntent!.state === "adopted"
              ? workflow.authorIntent!.version
              : 0,
        },
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
        assessmentSource: "model",
        createdAt: at,
        updatedAt: at,
      };
      tx.run(
        "INSERT INTO production_diagnoses VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?)",
        value.id,
        value.projectId,
        value.workflowId,
        version,
        JSON.stringify(value),
        at,
        at,
      );
      event(tx, value);
      return { diagnosisId: value.id };
    });
  };
  const reviewState = (workflow: CreationWorkflow) =>
    context.uow.execute((tx) => {
      const row = tx.get<{ status: string }>(
        "SELECT status FROM production_diagnoses WHERE workflow_id = ?",
        workflow.id,
      );
      return row?.status === "adopted" || row?.status === "discarded"
        ? row.status
        : undefined;
    });
  const transition = (
    id: string,
    action: "adopt" | "discard",
    stateVersion: number,
    key: string,
    strategyId?: string,
  ) => {
    const digest = hash({ id, action, stateVersion, strategyId });
    const replay = context.uow.execute((tx) =>
      tx.get<{ request_hash: string; status: number; detail: string | null }>(
        "SELECT request_hash, status, detail FROM production_diagnosis_requests WHERE request_key = ?",
        key,
      ),
    );
    if (replay) {
      if (replay.request_hash !== digest)
        throw new DiagnosisError(
          409,
          "同一幂等键不能用于不同对象、策略或操作。",
        );
      if (replay.status !== 200)
        throw new DiagnosisError(replay.status, replay.detail!);
      optionalService(context, CREATION_WORKFLOW_SERVICE)?.syncReview(
        get(id)!.workflowId,
      );
      return get(id)!;
    }
    const value = context.uow.execute((tx) => read(tx, id));
    if (!value) throw new DiagnosisError(404, "诊断候选不存在。");
    project(value.projectId);
    const workflowService = optionalService(context, CREATION_WORKFLOW_SERVICE);
    if (!workflowService)
      throw new DiagnosisError(409, "创作工作流服务未启用。");
    const workflow = workflowService.get(value.workflowId);
    if (
      action === "adopt" &&
      strategyId !== undefined &&
      !value.content.strategies.some((item) => item.id === strategyId)
    )
      throw new DiagnosisError(400, "兼容路径只能选择该候选中的一个策略。");
    const review = sourceReview(value);
    const result = context.uow.execute((tx) => {
      const current = read(tx, id)!;
      const remember = (status: number, detail?: string) => {
        tx.run(
          "INSERT INTO production_diagnosis_requests VALUES (?, ?, ?, ?, ?)",
          key,
          digest,
          id,
          status,
          detail ?? null,
        );
        return { status, detail };
      };
      if (current.status === (action === "adopt" ? "adopted" : "discarded")) {
        if (action === "adopt" && current.selectedStrategyId !== strategyId)
          throw new DiagnosisError(
            409,
            "已采用策略不可静默更换，请生成新诊断版本。",
          );
        return remember(200);
      }
      if (current.stateVersion !== stateVersion)
        throw new DiagnosisError(412, "诊断状态已变化，请刷新后继续。");
      if (
        action === "adopt"
          ? current.status !== "pending"
          : !["pending", "conflicted"].includes(current.status)
      )
        throw new DiagnosisError(409, "此历史状态不允许该操作。");
      if (
        action === "adopt" &&
        workflow?.issues.some((issue) => issue.severity === "error")
      )
        throw new DiagnosisError(
          409,
          "候选仍有未解决的严重问题，请保持原来源修订复检；原记录未改变。",
        );
      const conflict =
        action === "adopt" &&
        (review.reasons.length > 0 ||
          head(tx, current.projectId) !== current.basis.baseAdoptedId ||
          workflow?.stage !== "awaiting-review");
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
          ? { selectedStrategyId: strategyId, adoptedAt: at }
          : {}),
      };
      tx.run(
        "UPDATE production_diagnoses SET status = ?, state_version = ?, value_json = ?, updated_at = ? WHERE id = ? AND state_version = ?",
        updated.status,
        updated.stateVersion,
        JSON.stringify(updated),
        at,
        id,
        current.stateVersion,
      );
      if (updated.status === "adopted") {
        tx.run(
          "INSERT INTO production_diagnosis_heads VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET diagnosis_id = excluded.diagnosis_id",
          current.projectId,
          id,
        );
        tx.run(
          "INSERT INTO production_creation_adoptions VALUES (?, ?, ?, ?)",
          current.workflowId,
          JSON.stringify({ diagnosisId: id, strategyId }),
          JSON.stringify({ diagnosisId: current.basis.baseAdoptedId ?? null }),
          at,
        );
        tx.append({
          type: "production.diagnosis-result-adopted.v1",
          pluginId: "production",
          aggregateType: "adaptation-diagnosis",
          aggregateId: id,
          aggregateVersion: updated.version,
          payload: CreativeOutcomeFactSchema.parse({
            eventVersion: 1,
            kind: "adaptation.diagnosis-adopted",
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
              { kind: "diagnosis", id, version: updated.version },
            ],
            sourceVersions: current.basis.chapters.map(
              ({ id: sourceId, version }) => ({ id: sourceId, version }),
            ),
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
          "adaptation.diagnosis",
          updated,
          review.changes,
          { chapterCollection: review.chapterCollection },
        );
      event(tx, updated);
      return conflict
        ? remember(
            409,
            "来源、正式意图、当前诊断或工作流已变化；旧候选未覆盖正式内容。",
          )
        : remember(200);
    });
    if (result.status !== 200)
      throw new DiagnosisError(result.status, result.detail!);
    workflowService.syncReview(value.workflowId);
    return get(id)!;
  };
  const service = {
    prepare,
    validate,
    preview,
    reviewState,
    get: (projectId: string, id: string) => {
      const value = get(id);
      return value?.projectId === projectId ? value : undefined;
    },
    current: (projectId: string) => {
      const id = context.uow.execute((tx) => head(tx, projectId));
      return id ? get(id) : undefined;
    },
  };
  context.effect(
    () => provideService(context, PRODUCTION_DIAGNOSIS_SERVICE, service),
    `service:${PRODUCTION_DIAGNOSIS_SERVICE.id}`,
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
          tags: ["adaptation-diagnoses"],
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
              description: "Diagnosis result",
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
              error instanceof DiagnosisError
                ? error.status
                : error instanceof z.ZodError
                  ? 400
                  : 409;
            const detail =
              error instanceof z.ZodError
                ? "诊断请求参数不完整或无效。"
                : error instanceof Error
                  ? error.message
                  : "诊断操作未完成。";
            return new Response(
              JSON.stringify({
                type: "https://dramaip.local/problems/diagnosis",
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
    "/api/v2/projects/{projectId}/diagnosis-sources",
    "diagnoses.sources",
    DiagnosisCatalogSchema,
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
        throw new DiagnosisError(400, "游标不属于此项目。");
      return cursor
        ? tx.all<Row>(
            "SELECT value_json FROM production_diagnoses WHERE project_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?",
            id,
            cursor.createdAt,
            cursor.createdAt,
            cursor.id,
            query.limit + 1,
          )
        : tx.all<Row>(
            "SELECT value_json FROM production_diagnoses WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
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
    "/api/v2/projects/{projectId}/diagnoses",
    "diagnoses.list",
    DiagnosisPageSchema,
    readPage,
    undefined,
    pageQuery,
  );
  add(
    "get",
    "/api/v2/projects/{projectId}/diagnosis-previews",
    "diagnoses.summaries",
    DiagnosisSummaryPageSchema,
    (c) => {
      const page = readPage(c);
      return {
        ...page,
        items: page.items.map((item) => DiagnosisSummarySchema.parse(item)),
      };
    },
    undefined,
    pageQuery,
  );
  add(
    "get",
    "/api/v2/diagnoses/{id}",
    "diagnoses.get",
    AdaptationDiagnosisSchema,
    (c) => {
      const value = get(c.req.param("id"));
      if (!value) throw new DiagnosisError(404, "诊断不存在。");
      return value;
    },
  );
  for (const action of ["adopt", "discard"] as const)
    add(
      "post",
      `/api/v2/diagnoses/{id}/${action}`,
      `diagnoses.${action}`,
      AdaptationDiagnosisSchema,
      async (c) => {
        const key = c.req.header("Idempotency-Key");
        const match = c.req.header("If-Match")?.match(/^"(\d+)"$/u);
        if (!key?.trim() || key.length > 200 || !match)
          throw new DiagnosisError(428, "请提供幂等键和精确状态 ETag。");
        const input =
          action === "adopt"
            ? DiagnosisAdoptInputSchema.parse(await c.req.json())
            : z.object({}).parse(await c.req.json());
        return transition(
          c.req.param("id"),
          action,
          Number(match[1]),
          key,
          "strategyId" in input ? input.strategyId : undefined,
        );
      },
      action === "adopt" ? DiagnosisAdoptInputSchema : z.object({}),
    );
  for (const route of routes)
    context.effect(() => context.http.register(route), `route:${route.id}`);
}
