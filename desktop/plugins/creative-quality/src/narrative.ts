import { createHash } from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import { ProblemDetailsSchema } from "@dramaip/contracts";
import { CreativeQualityAdoptionFactSchema } from "@dramaip/contracts/insights";
import {
  AGENT_CONTEXT_SERVICE,
  type AgentContextReference,
} from "@dramaip/contracts/agent-context";
import {
  creationReference,
  creationAuthorIntent,
  AUTHOR_INTENT_CREATION_PROMPT,
  CREATION_KNOWLEDGE_SERVICE,
  type CreationAdapter,
  type CreationContent,
  type CreationWorkflow,
  WRITING_NARRATIVE_SOURCE_SERVICE,
  NarrativeSourceBasisSchema,
} from "@dramaip/contracts/creation";
import {
  CREATION_NARRATIVE_QUALITY_SERVICE,
  NARRATIVE_QUALITY_SERVICE,
  NarrativeQualityCommitError,
  NarrativeQualityRequestSchema,
  NarrativeQualityReportSchema,
  NarrativeQualityPageSchema,
  NarrativeQualityDispositionSchema,
  NarrativeQualitySummaryPageSchema,
  NarrativeQualityCatalogSchema,
  type NarrativeQualityRequest,
  type NarrativeQualityBasis,
  type NarrativeQualityReport,
} from "@dramaip/contracts/creative-quality";
import {
  WORKSPACE_PROJECT_SERVICE,
  WORKSPACE_AUTHOR_INTENT_SERVICE,
} from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import {
  PRODUCTION_DIAGNOSIS_SERVICE,
  PRODUCTION_SEASON_PLAN_SERVICE,
  PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
  PRODUCTION_QUALITY_SOURCE_SERVICE,
  ProductionQualitySourcePageSchema,
} from "@dramaip/contracts/production";
import {
  optionalService,
  provideService,
  defineRouteContribution,
  type PluginContext,
  type PluginMigration,
  type UnitOfWorkTransaction,
} from "@dramaip/plugin-api/internal";
import { inspectNarrativeContent } from "./narrative-content.js";
import {
  assessNarrativeReports,
  summarizeNarrativeReport,
} from "./narrative-assessment.js";
import { freezeProductionQualitySource } from "./narrative-production-source.js";
import { registerNarrativeLocalQuality } from "./narrative-local.js";

export const narrativeQualityMigration: PluginMigration = {
  id: "creative-quality.0004.narrative-reports",
  pluginId: "creative-quality",
  version: "3.0.0-alpha.4",
  dependsOn: ["creative-quality.0003.intelligence"],
  sql: `CREATE TABLE narrative_quality_reports (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workflow_id TEXT NOT NULL UNIQUE, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    value_json TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE INDEX narrative_quality_page ON narrative_quality_reports(project_id, created_at DESC, id DESC);
  CREATE TABLE narrative_quality_heads (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    report_id TEXT NOT NULL REFERENCES narrative_quality_reports(id),
    PRIMARY KEY(project_id,target_kind,target_id)
  ); CREATE TABLE narrative_quality_requests (
    request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL, report_id TEXT NOT NULL, created_at TEXT NOT NULL
  );`,
};
type Stored = Omit<
  NarrativeQualityReport,
  "isCurrent" | "sourceState" | "staleReasons" | "blockers"
>;
class QualityError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const chapterDirectoryFingerprint = (
  chapters: ReadonlyArray<{
    id: string;
    version: number;
    orderIndex: number;
    content: string;
  }>,
) =>
  hash(
    chapters.map(({ id, version, orderIndex, content }) => ({
      id,
      version,
      orderIndex,
      hasContent: Boolean(content.trim()),
    })),
  );
function fail(message: string): never {
  throw new QualityError(409, message);
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

export function registerNarrativeQuality(context: PluginContext) {
  const read = (tx: UnitOfWorkTransaction, id: string): Stored | undefined => {
    const row = tx.get<{ value_json: string }>(
      "SELECT value_json FROM narrative_quality_reports WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.value_json) as Stored) : undefined;
  };
  const getStored = (id: string) => context.uow.execute((tx) => read(tx, id));
  const head = (
    tx: UnitOfWorkTransaction,
    projectId: string,
    target: NarrativeQualityRequest["target"],
  ) =>
    tx.get<{ report_id: string }>(
      "SELECT report_id FROM narrative_quality_heads WHERE project_id = ? AND target_kind = ? AND target_id = ?",
      projectId,
      target.kind,
      target.id,
    )?.report_id;
  const collect = (projectId: string, raw: NarrativeQualityRequest) => {
    const request = NarrativeQualityRequestSchema.parse(raw);
    const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
      projectId,
    );
    if (!project) throw new QualityError(404, "项目不存在。");
    if (new Set(request.dimensions).size !== request.dimensions.length)
      fail("检查维度不能重复。");
    const target = request.target;
    let targetReferences: AgentContextReference[];
    let chapterCoverage: NarrativeQualityBasis["chapterCoverage"];
    let sourceBasis: NarrativeQualityBasis["sourceBasis"];
    let productionSourceBasis: NarrativeQualityBasis["productionSourceBasis"];
    if (target.kind === "chapter-set") {
      const writing = optionalService(context, WRITING_CHAPTER_SERVICE);
      if (!writing)
        throw new QualityError(503, "章节服务未启用，跨章来源未核全。");
      if (target.id !== projectId || target.version !== project.version)
        fail("请明确确认本项目当前版本的跨章目标。");
      const chapters = writing.list(projectId);
      const scope = request.chapterScope!;
      const selected = chapters.filter((chapter) =>
        scope.chapters.some((ref) => ref.id === chapter.id),
      );
      if (
        selected.length !== scope.chapters.length ||
        selected.some(
          (chapter, index) =>
            chapter.id !== scope.chapters[index]?.id ||
            chapter.version !== scope.chapters[index]?.version ||
            !chapter.content.trim(),
        )
      )
        fail(
          "跨章范围必须按实际目录顺序选择本项目当前非空章节；目录、来源版本或正文已变化，请重新确认。",
        );
      if (
        scope.mode === "full" &&
        (scope.directoryFingerprint !== chapterDirectoryFingerprint(chapters) ||
          selected.length !==
            chapters.filter((chapter) => chapter.content.trim()).length)
      )
        fail(
          "全书范围必须匹配完整当前目录并纳入全部非空正文；不能用开头或部分章节冒充全书。",
        );
      targetReferences = selected.map((chapter) =>
        creationReference("chapter", {
          id: chapter.id,
          version: chapter.version,
          projectId,
          title: chapter.title,
          orderIndex: chapter.orderIndex,
          content: chapter.content,
        }),
      );
      if (request.context) {
        const compiler = optionalService(
          context,
          WRITING_NARRATIVE_SOURCE_SERVICE,
        );
        if (!compiler) fail("明确来源编译服务未启用，不能把未知摘要当成正文。");
        try {
          const compiled = compiler.compile(
            projectId,
            scope.chapters,
            request.context,
          );
          if (compiled.basis.omitted.length || !compiled.references.length)
            fail(
              "每个已确认章节必须有明确表达；不能隐式补入原文或用局部摘要冒充完整范围。",
            );
          sourceBasis = compiled.basis;
          targetReferences = compiled.references;
        } catch (error) {
          fail(error instanceof Error ? error.message : "明确质量来源未核全。");
        }
      }
      chapterCoverage = {
        mode: scope.mode,
        included: selected.map(({ id, version, title }) => ({
          id,
          version,
          title,
          ...(sourceBasis
            ? {
                representations: [
                  ...sourceBasis.chapters
                    .filter((chapter) => chapter.id === id)
                    .map((chapter) => chapter.representation),
                  ...(sourceBasis.summaries?.some((summary) =>
                    summary.chapters.some((chapter) => chapter.id === id),
                  )
                    ? ["hierarchical-summary" as const]
                    : []),
                ],
              }
            : {}),
        })),
        excluded: chapters
          .filter((chapter) => !selected.some((ref) => ref.id === chapter.id))
          .map(({ id, version, content }) => ({
            id,
            version,
            reason: content.trim()
              ? ("not-selected" as const)
              : ("empty" as const),
          })),
        totalChapterCount: chapters.length,
        nonEmptyChapterCount: chapters.filter((chapter) =>
          chapter.content.trim(),
        ).length,
      };
    } else if (target.kind === "chapter") {
      const chapter = optionalService(context, WRITING_CHAPTER_SERVICE)?.get(
        target.id,
      );
      if (
        !chapter ||
        chapter.projectId !== projectId ||
        chapter.version !== target.version ||
        !chapter.content.trim()
      )
        fail("请使用本项目当前且非空的正式章节版本。");
      targetReferences = [
        creationReference("chapter", {
          id: chapter.id,
          version: chapter.version,
          projectId,
          title: chapter.title,
          content: chapter.content,
        }),
      ];
    } else if (target.kind === "diagnosis") {
      const value = optionalService(context, PRODUCTION_DIAGNOSIS_SERVICE)?.get(
        projectId,
        target.id,
      );
      if (
        !value ||
        value.version !== target.version ||
        value.status !== "adopted" ||
        !value.isCurrent ||
        value.sourceState !== "current"
      )
        fail("请使用当前且来源有效的正式诊断。");
      targetReferences = [
        creationReference("production", {
          id: value.id,
          version: value.version,
          projectId,
          title: "已采用诊断",
          content: value.content,
          selectedStrategyId: value.selectedStrategyId,
        }),
      ];
    } else if (target.kind === "season-plan") {
      const value = optionalService(
        context,
        PRODUCTION_SEASON_PLAN_SERVICE,
      )?.get(projectId, target.id);
      if (
        !value ||
        value.version !== target.version ||
        value.status !== "adopted" ||
        !value.isCurrent ||
        value.sourceState !== "current"
      )
        fail("请使用当前且来源有效的正式季纲。");
      targetReferences = [
        creationReference("production", {
          id: value.id,
          version: value.version,
          projectId,
          title: "已采用季纲",
          content: value.content,
        }),
      ];
    } else if (target.kind === "episode-result") {
      const value = optionalService(
        context,
        PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
      )?.get(target.id);
      if (
        !value ||
        value.projectId !== projectId ||
        value.version !== target.version ||
        !value.isCurrent ||
        value.sourceState !== "current"
      )
        fail("请使用本项目当前且来源有效的正式单集大纲、剧本或分镜。");
      targetReferences = [
        creationReference("production", {
          id: value.id,
          version: value.version,
          projectId,
          title: `已采用${value.operation}`,
          content: value.content.value,
          operation: value.operation,
        }),
      ];
    } else if (target.kind === "script" || target.kind === "scene") {
      const service = optionalService(
        context,
        PRODUCTION_QUALITY_SOURCE_SERVICE,
      );
      if (!service)
        throw new QualityError(503, "实际保存剧本／场景来源服务未启用。");
      const source = service.get(projectId, target.id);
      if (!source) fail("实际保存剧本／场景不存在或不属于本项目。");
      try {
        const frozen = freezeProductionQualitySource(projectId, target, source);
        targetReferences = [frozen.reference];
        productionSourceBasis = frozen.productionSourceBasis;
      } catch {
        fail(
          "实际保存剧本／场景来源、版本或指纹已变化或未核全，请重新确认，不自动换稿。",
        );
      }
    } else {
      fail("未知质量目标，不能回退为单集成果。");
    }
    const intents = optionalService(context, WORKSPACE_AUTHOR_INTENT_SERVICE);
    const knowledge = optionalService(context, CREATION_KNOWLEDGE_SERVICE);
    if (!intents || !knowledge?.approvedStoryBible)
      throw new QualityError(503, "正式作者意图或可信知识服务未启用。");
    const intent = creationAuthorIntent(projectId, intents.current(projectId));
    const references = [
      ...targetReferences,
      ...intent.references,
      ...knowledge.approvedStoryBible(projectId),
    ];
    return {
      request,
      authorIntent: intent.authorIntent,
      references,
      chapterCoverage,
      sourceBasis,
      productionSourceBasis,
    };
  };
  const frozenReferences = (
    references: AgentContextReference[],
  ): NarrativeQualityBasis["references"] =>
    references.map((reference) => ({
      sourceKind:
        reference.sourceKind as NarrativeQualityBasis["references"][number]["sourceKind"],
      sourceId: reference.sourceId,
      sourceVersion: reference.sourceVersion,
      fieldPath: reference.fieldPath,
      contentHash: hash(reference.value),
    }));
  registerNarrativeLocalQuality(context, {
    hasProject: (projectId) =>
      Boolean(
        optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(projectId),
      ),
    collect(projectId, request) {
      const source = collect(projectId, request);
      return {
        basis: {
          request: source.request,
          references: frozenReferences(source.references),
          ...(source.chapterCoverage
            ? { chapterCoverage: source.chapterCoverage }
            : {}),
          ...(source.sourceBasis ? { sourceBasis: source.sourceBasis } : {}),
          ...(source.productionSourceBasis
            ? { productionSourceBasis: source.productionSourceBasis }
            : {}),
        },
        references: source.references,
      };
    },
  });
  const sourceReasons = (value: Stored): string[] => {
    try {
      const current = collect(value.projectId, value.basis.request);
      const stableSources = (basis: NarrativeQualityBasis["sourceBasis"]) => {
        const parsed = basis
          ? NarrativeSourceBasisSchema.parse(basis)
          : undefined;
        return parsed
          ? {
              ...parsed,
              summaries: parsed.summaries?.map(
                ({ scopeState: _state, ...summary }) => summary,
              ),
            }
          : null;
      };
      return hash(frozenReferences(current.references)) ===
        hash(value.basis.references) &&
        hash(stableSources(current.sourceBasis)) ===
          hash(stableSources(value.basis.sourceBasis)) &&
        hash(current.productionSourceBasis ?? null) ===
          hash(value.basis.productionSourceBasis ?? null)
        ? []
        : ["目标、正式作者意图或可信知识集合/版本已变化。"];
    } catch (error) {
      return [
        error instanceof QualityError
          ? error.message
          : "当前质量来源读取未完成，不能证明旧报告仍有效。",
      ];
    }
  };
  const decode = (value: Stored): NarrativeQualityReport => {
    const staleReasons = sourceReasons(value);
    const currentId = context.uow.execute((tx) =>
      head(tx, value.projectId, value.basis.request.target),
    );
    const blockers = value.content.issues
      .filter(
        (issue) =>
          issue.severity === "error" &&
          !value.dispositions.some(
            (decision) =>
              decision.issueId === issue.id && decision.state !== "open",
          ),
      )
      .map((issue) => issue.id);
    return NarrativeQualityReportSchema.parse({
      ...value,
      isCurrent: value.status === "adopted" && currentId === value.id,
      sourceState: staleReasons.length ? "stale" : "current",
      staleReasons,
      blockers,
    });
  };
  const append = (tx: UnitOfWorkTransaction, value: Stored) =>
    tx.append({
      type: "creative-quality.narrative-report-changed.v1",
      pluginId: "creative-quality",
      aggregateType: "narrative-quality-report",
      aggregateId: value.id,
      aggregateVersion: value.version,
      payload: {
        id: value.id,
        projectId: value.projectId,
        workflowId: value.workflowId,
        status: value.status,
        target: value.basis.request.target,
        issueCount: value.content.issues.length,
      },
    });
  const persist = (tx: UnitOfWorkTransaction, value: Stored) => {
    tx.run(
      "UPDATE narrative_quality_reports SET value_json = ?, version = ?, updated_at = ? WHERE id = ?",
      JSON.stringify(value),
      value.version,
      value.updatedAt,
      value.id,
    );
    append(tx, value);
  };
  const inspect = (workflow: CreationWorkflow, output: CreationContent) => {
    const basis = workflow.narrativeQualityBasis;
    const snapshot = workflow.sourceSnapshotId
      ? optionalService(context, AGENT_CONTEXT_SERVICE)?.getSnapshot(
          workflow.sourceSnapshotId,
        )
      : undefined;
    if (
      !basis ||
      !snapshot ||
      snapshot.projectId !== workflow.input.projectId ||
      hash(basis.request) !== hash(workflow.input.qualityReviewRequest)
    )
      fail("质量报告缺少可核对的冻结目标和来源基准。");
    const references = snapshot.entries.filter(
      (entry) =>
        entry.included &&
        basis.references.some(
          (ref) =>
            ref.sourceKind === entry.sourceKind &&
            ref.sourceId === entry.sourceId &&
            ref.sourceVersion === entry.sourceVersion &&
            ref.fieldPath === entry.fieldPath &&
            ref.contentHash === hash(entry.value),
        ),
    );
    if (references.length !== basis.references.length)
      fail("质量评议所需来源未完整冻结。");
    if (
      output.items.length !== 1 ||
      output.items[0]?.kind !== "narrative-quality-report"
    )
      fail("候选必须包含且仅包含一份独立质量报告，不得创建或修改正文。");
    return inspectNarrativeContent(output.items[0].data, basis, references);
  };
  const candidate = (workflow: CreationWorkflow): Stored => {
    const content = inspect(workflow, workflow.output!);
    const existing = context.uow.execute((tx) => {
      const row = tx.get<{ id: string }>(
        "SELECT id FROM narrative_quality_reports WHERE workflow_id = ?",
        workflow.id,
      );
      return row ? read(tx, row.id) : undefined;
    });
    if (existing) {
      if (
        hash(existing.content) !== hash(content) ||
        hash(existing.basis) !== hash(workflow.narrativeQualityBasis)
      )
        fail("已持久化的质量候选不可被同一工作流改写。");
      return existing;
    }
    const now = new Date().toISOString();
    const snapshot = optionalService(
      context,
      AGENT_CONTEXT_SERVICE,
    )?.getSnapshot(workflow.sourceSnapshotId!);
    if (!snapshot) fail("冻结上下文不存在，不能记录跨章覆盖或预算。");
    const value: Stored = {
      id: crypto.randomUUID(),
      projectId: workflow.input.projectId,
      workflowId: workflow.id,
      version: 0,
      status: "awaiting-review",
      basis: workflow.narrativeQualityBasis!,
      content,
      dispositions: [],
      sourceSnapshotId: workflow.sourceSnapshotId!,
      runIds: workflow.runIds,
      engineKind: workflow.input.engineKind,
      model: workflow.input.model
        ? Object.fromEntries(
            Object.entries(workflow.input.model).filter(
              (pair): pair is [string, string] =>
                ["provider", "model", "modelId", "name"].includes(pair[0]) &&
                typeof pair[1] === "string",
            ),
          )
        : undefined,
      usage: { state: "unknown" },
      contextBudget: {
        source: "estimate",
        estimatedTokens: snapshot.estimatedTokens,
        tokenBudget: snapshot.tokenBudget,
      },
      createdAt: now,
      updatedAt: now,
    };
    context.uow.execute((tx) => {
      tx.run(
        "INSERT INTO narrative_quality_reports(id,project_id,workflow_id,target_kind,target_id,value_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,0,?,?)",
        value.id,
        value.projectId,
        value.workflowId,
        value.basis.request.target.kind,
        value.basis.request.target.id,
        JSON.stringify(value),
        now,
        now,
      );
      append(tx, value);
    });
    return value;
  };
  const adapter: CreationAdapter = {
    prepare(input) {
      if (!input.qualityReviewRequest)
        fail("请选择明确的质量目标版本与检查维度。");
      const source = collect(input.projectId, input.qualityReviewRequest);
      if (
        input.targetId !== source.request.target.id ||
        input.baseVersion !== source.request.target.version
      )
        fail("质量目标与创作输入版本不一致。");
      const baseReportId =
        context.uow.execute((tx) =>
          head(tx, input.projectId, source.request.target),
        ) ?? null;
      const productionPrompt = source.productionSourceBasis
        ? `本轮仅评议实际保存的${source.productionSourceBasis.kind === "script" ? "完整剧本文档／稳定块" : "场景动作、对白与备注、地点与时间"}，不据 AST 证明叙事语义。实际来源指纹和父记录／保存文档身份为 ${JSON.stringify(source.productionSourceBasis)}。data 必须提供 reviewedSources:[{sourceId:"${source.request.target.id}",sourceVersion:${source.request.target.version},fieldPath:"/production/${source.request.target.id}"}]；这是模型覆盖声明，不证明阅读理解。剧本引文只能逐字来自 /content/blocks/实际索引/text，保留原块 ID／顺序，不引用 lossReport、标题或 ID；场景引文只来自 /content/场景动作、/content/对白与备注、/content/地点与时间，不引用来源标签或父正文。不能补造小说、意图或未读上游内容，不自动改稿／采用。`
        : "";
      return {
        authorIntent: source.authorIntent,
        narrativeQualityBasis: {
          request: source.request,
          baseReportId,
          references: frozenReferences(source.references),
          chapterCoverage: source.chapterCoverage,
          sourceBasis: source.sourceBasis,
          productionSourceBasis: source.productionSourceBasis,
        },
        references: source.references,
        sources: source.references.map((entry) => ({
          kind: entry.sourceKind,
          id: entry.sourceId,
          version: entry.sourceVersion,
        })),
        prompt: `独立质量评议，不改写正文，不自动采用或代表文学质量保证。${AUTHOR_INTENT_CREATION_PROMPT}\n目标：${JSON.stringify(source.request)}\n${productionPrompt}\n逐项核对所选维度，只报告有证据的问题。小说不强制爽点、短剧化、机械反转或视觉化；production-risk 对小说只可说明可选改编风险，不阻断小说自身完成。${source.sourceBasis ? `本轮明确混合表达：${JSON.stringify(source.sourceBasis)}。只评议实际纳入的完整原文、实际段落及派生概括，不能声称摘要/段落是整章原文。data 必须提供 reviewedChapters:[{id,version}] 列明全部表达覆盖章节，以及 reviewedSources:[{sourceId,sourceVersion,fieldPath}] 精确列明以下全部目标表达：${JSON.stringify(source.sourceBasis.references.map(({ sourceId, sourceVersion, fieldPath }) => ({ sourceId, sourceVersion, fieldPath })))}。问题必须至少引用一个目标表达，原文/段落引用 /content，章节及高层摘要引用 /summary；摘要证据标识摘要自身，不伪称来自未读原文。检查摘要不证明全书连续性、对白或文风已完整评议。` : source.chapterCoverage ? "跨章目标：按冻结目录顺序阅读全部所选章节，核对人物认知/关系、因果与时序、伏笔、重复和声音变化；data 还必须提供 reviewedChapters:[{id,version}]，完整列明本轮全部已读章节。问题至少引用所选章节正文，跨章矛盾引用相关各章。未选章节和空章没有正文证据，不得宣称已检查或替它们作判断。局部范围不是全书；目录声明不是语义质量保证。" : ""}\n仅一个 items 条目，kind=narrative-quality-report，data 为 {summary,reviewedDimensions,issues}。每项 issue 为 {id,category,severity,message,suggestion,source:"model",evidence:[{sourceId,sourceVersion,fieldPath,valuePath,quote}]}；valuePath 是引用 value 内字符串的精确 JSON Pointer，quote 必须逐字匹配且每条问题至少引用目标自身。不要虚构事实、位置、规则/人工判断或分数；无问题时 issues=[]，summary 说明模型评议范围与局限。`,
      };
    },
    validate(_input, output, workflow) {
      try {
        if (!workflow) fail("缺少质量冻结基准。");
        inspect(workflow, output);
        return [];
      } catch (error) {
        return [
          {
            severity: "error",
            source: "rule",
            message:
              error instanceof Error
                ? error.message
                : "质量报告结构或证据无效。",
            evidence: "",
            location: "quality-review/items",
            suggestion: "只修正报告结构、逐字证据与检查范围；不修改源文本。",
          },
        ];
      }
    },
    review(workflow) {
      return { narrativeReportId: candidate(workflow).id };
    },
    reviewState(workflow) {
      const value = workflow.narrativeReportId
        ? getStored(workflow.narrativeReportId)
        : undefined;
      return value?.status === "adopted" || value?.status === "discarded"
        ? value.status
        : undefined;
    },
    discard(workflow) {
      if (!workflow.narrativeReportId) return;
      context.uow.execute((tx) => {
        const value = read(tx, workflow.narrativeReportId!);
        if (!value || value.status === "discarded") return;
        if (value.status !== "awaiting-review")
          fail("正式报告不能作为未采用候选放弃。");
        persist(tx, {
          ...value,
          status: "discarded",
          version: value.version + 1,
          updatedAt: new Date().toISOString(),
        });
      });
    },
    apply(workflow) {
      const value = candidate(workflow);
      if (value.status === "adopted") return;
      if (value.status !== "awaiting-review" || sourceReasons(value).length)
        fail("质量报告来源已变化或已放弃，不能作为当前采用报告。");
      const commitReport = () =>
        context.uow.execute((tx) => {
          const actual = read(tx, value.id)!;
          if (actual.status === "adopted") return;
          if (
            actual.status !== "awaiting-review" ||
            actual.version !== value.version ||
            (head(tx, value.projectId, value.basis.request.target) ?? null) !==
              value.basis.baseReportId
          )
            fail("质量报告状态或当前采用头已变化，请重新评议。");
          const now = new Date().toISOString();
          persist(tx, {
            ...actual,
            status: "adopted",
            version: actual.version + 1,
            adoptedAt: now,
            updatedAt: now,
          });
          tx.run(
            "INSERT INTO narrative_quality_heads(project_id,target_kind,target_id,report_id) VALUES (?,?,?,?) ON CONFLICT(project_id,target_kind,target_id) DO UPDATE SET report_id = excluded.report_id",
            value.projectId,
            value.basis.request.target.kind,
            value.basis.request.target.id,
            value.id,
          );
          const coverage = actual.basis.chapterCoverage;
          tx.append({
            type: "creative-quality.narrative-report-adopted.v1",
            pluginId: "creative-quality",
            aggregateType: "narrative-quality-report",
            aggregateId: actual.id,
            aggregateVersion: actual.version + 1,
            payload: CreativeQualityAdoptionFactSchema.parse({
              eventVersion: 1,
              projectId: actual.projectId,
              workflowId: actual.workflowId,
              report: { id: actual.id, version: actual.version + 1 },
              target: actual.basis.request.target,
              requestedDimensions: actual.basis.request.dimensions,
              ...(coverage
                ? {
                    chapterScope: {
                      mode: coverage.mode,
                      included: coverage.included.map(
                        ({ id, version, representations }) => ({
                          id,
                          version,
                          representations:
                            representations ??
                            (actual.basis.request.context
                              ? ["unknown"]
                              : ["original"]),
                        }),
                      ),
                      totalChapterCount: coverage.totalChapterCount,
                      nonEmptyChapterCount: coverage.nonEmptyChapterCount,
                    },
                  }
                : {}),
              evidenceKind: "explicit-report-adoption",
              modelEvidence: "unknown",
              qualityState: "unverified",
              currentValidity: "unknown",
            }),
          });
        });
      try {
        commitReport();
      } catch (error) {
        if (error instanceof QualityError) throw error;
        throw new NarrativeQualityCommitError();
      }
    },
  };
  context.effect(
    () => provideService(context, CREATION_NARRATIVE_QUALITY_SERVICE, adapter),
    `service:${CREATION_NARRATIVE_QUALITY_SERVICE}`,
  );
  context.effect(
    () =>
      provideService(context, NARRATIVE_QUALITY_SERVICE, {
        get(id) {
          const value = getStored(id);
          return value ? decode(value) : undefined;
        },
        current(projectId, target) {
          const value = context.uow.execute((tx) => {
            const id = head(tx, projectId, target);
            return id ? read(tx, id) : undefined;
          });
          return value &&
            value.basis.request.target.version === target.version &&
            value.basis.request.target.sourceFingerprint ===
              target.sourceFingerprint
            ? decode(value)
            : undefined;
        },
        assess(projectId, target, dimensions) {
          // All peer reads happen in decode, outside this owner's transaction.
          const values = context.uow.execute((tx) =>
            tx
              .all<{ value_json: string }>(
                "SELECT value_json FROM narrative_quality_reports WHERE project_id = ? AND target_kind = ? AND target_id = ? ORDER BY created_at,id",
                projectId,
                target.kind,
                target.id,
              )
              .map((row) => JSON.parse(row.value_json) as Stored),
          );
          return assessNarrativeReports(target, dimensions, values.map(decode));
        },
      }),
    `service:${NARRATIVE_QUALITY_SERVICE}`,
  );
  const ids = z.object({ id: z.string().uuid() });
  const route = (
    method: "get" | "post",
    path: `/${string}`,
    operationId: string,
    schema: z.ZodType,
    handler: (http: HttpContext) => unknown,
    body?: z.ZodType,
  ) =>
    defineRouteContribution({
      id: `creative-quality:${operationId}`,
      pluginId: "creative-quality",
      method,
      path: `/api/v2${path}`,
      operationId,
      declaration: createRoute({
        method,
        path: `/api/v2${path}`,
        operationId,
        tags: ["creative-quality"],
        request: {
          params: ids,
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
            description:
              "Version-bound narrative review; not a quality guarantee",
            content: { "application/json": { schema } },
          },
          409: {
            description: "Conflict",
            content: {
              "application/problem+json": { schema: ProblemDetailsSchema },
            },
          },
        },
      }),
      policy: {
        idempotency: method === "post" ? "required" : "forbidden",
        concurrency: method === "post" ? "if-match-required" : "optional",
        ...(method === "post" ? { idempotencyReplay: "handler" as const } : {}),
      },
      handler: async (http: HttpContext) => {
        try {
          return await handler(http);
        } catch (error) {
          const status =
            error instanceof QualityError
              ? error.status
              : error instanceof z.ZodError
                ? 400
                : 500;
          const message =
            error instanceof QualityError
              ? error.message
              : status === 400
                ? "质量报告请求不符合契约。"
                : "质量报告读取或处理失败；未声明质量通过。";
          return new Response(
            JSON.stringify({
              type: "https://dramaip.local/problems/narrative-quality",
              status,
              code: "NARRATIVE_QUALITY",
              title: message,
              detail: message,
              traceId: crypto.randomUUID(),
            }),
            { status, headers: { "Content-Type": "application/problem+json" } },
          );
        }
      },
    });
  const routes = [
    route(
      "get",
      "/narrative-quality-reports/{id}",
      "narrativeQuality.get",
      NarrativeQualityReportSchema,
      (http) => {
        const value = getStored(http.req.param("id"));
        if (!value) throw new QualityError(404, "质量报告不存在。");
        http.header("ETag", `"${value.version}"`);
        return http.json(decode(value));
      },
    ),
    route(
      "get",
      "/projects/{id}/narrative-quality-reports",
      "narrativeQuality.list",
      NarrativeQualityPageSchema,
      (http) => {
        const projectId = http.req.param("id");
        const project = optionalService(
          context,
          WORKSPACE_PROJECT_SERVICE,
        )?.get(projectId);
        if (!project) throw new QualityError(404, "项目不存在。");
        const cursor = http.req.query("cursor");
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(http.req.query("limit") ?? 30);
        const values = context.uow.execute((tx) => {
          const anchor = cursor
            ? read(tx, z.string().uuid().parse(cursor))
            : undefined;
          if (cursor && (!anchor || anchor.projectId !== projectId))
            throw new QualityError(400, "报告游标不属于当前项目。");
          return tx
            .all<{ value_json: string }>(
              `SELECT value_json FROM narrative_quality_reports WHERE project_id = ?${anchor ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
              projectId,
              ...(anchor
                ? [anchor.createdAt, anchor.createdAt, anchor.id]
                : []),
              limit + 1,
            )
            .map((row) => JSON.parse(row.value_json) as Stored);
        });
        return http.json({
          items: values.slice(0, limit).map(decode),
          nextCursor: values.length > limit ? values[limit - 1]!.id : undefined,
        });
      },
    ),
    route(
      "get",
      "/projects/{id}/narrative-quality-summaries",
      "narrativeQuality.summaries",
      NarrativeQualitySummaryPageSchema,
      (http) => {
        const projectId = http.req.param("id");
        const project = optionalService(
          context,
          WORKSPACE_PROJECT_SERVICE,
        )?.get(projectId);
        if (!project) throw new QualityError(404, "项目不存在。");
        const cursor = http.req.query("cursor");
        const limit = z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(http.req.query("limit") ?? 30);
        const values = context.uow.execute((tx) => {
          const anchor = cursor
            ? read(tx, z.string().uuid().parse(cursor))
            : undefined;
          if (cursor && (!anchor || anchor.projectId !== projectId))
            throw new QualityError(400, "报告游标不属于当前项目。");
          return tx
            .all<{ value_json: string }>(
              `SELECT value_json FROM narrative_quality_reports WHERE project_id = ?${anchor ? " AND (created_at < ? OR (created_at = ? AND id < ?))" : ""} ORDER BY created_at DESC,id DESC LIMIT ?`,
              projectId,
              ...(anchor
                ? [anchor.createdAt, anchor.createdAt, anchor.id]
                : []),
              limit + 1,
            )
            .map((row) => JSON.parse(row.value_json) as Stored);
        });
        return http.json({
          items: values
            .slice(0, limit)
            .map((value) => summarizeNarrativeReport(decode(value))),
          nextCursor: values.length > limit ? values[limit - 1]!.id : undefined,
        });
      },
    ),
    route(
      "get",
      "/projects/{id}/narrative-quality-sources",
      "narrativeQuality.sources",
      NarrativeQualityCatalogSchema,
      (http) => {
        const projectId = http.req.param("id");
        const project = optionalService(
          context,
          WORKSPACE_PROJECT_SERVICE,
        )?.get(projectId);
        if (!project) throw new QualityError(404, "项目不存在。");
        const writing = optionalService(context, WRITING_CHAPTER_SERVICE);
        if (!writing)
          throw new QualityError(503, "章节能力不可用，目标目录未核全。");
        const chapters = writing.list(projectId);
        const targets: z.infer<
          typeof NarrativeQualityCatalogSchema
        >["targets"] = chapters
          .filter((chapter) => chapter.content.trim())
          .map((chapter) => ({
            target: {
              kind: "chapter",
              id: chapter.id,
              version: chapter.version,
            },
            title: chapter.title,
          }));
        const chapterSet = targets.length
          ? {
              target: {
                kind: "chapter-set" as const,
                id: projectId,
                version: project.version,
              },
              chapters: chapters.map(({ id, version, title, content }) => ({
                id,
                version,
                title,
                hasContent: Boolean(content.trim()),
              })),
              directoryFingerprint: chapterDirectoryFingerprint(chapters),
            }
          : undefined;
        if (chapterSet)
          targets.unshift({
            target: chapterSet.target,
            title: "小说跨章与全书",
          });
        const diagnoses = optionalService(
          context,
          PRODUCTION_DIAGNOSIS_SERVICE,
        );
        const seasons = optionalService(
          context,
          PRODUCTION_SEASON_PLAN_SERVICE,
        );
        const episodes = optionalService(
          context,
          PRODUCTION_EPISODE_DEVELOPMENT_SERVICE,
        );
        const productionSources = optionalService(
          context,
          PRODUCTION_QUALITY_SOURCE_SERVICE,
        );
        const unavailable: string[] = [];
        if (!productionSources)
          unavailable.push(
            "实际保存剧本／场景来源能力未启用，未列为可检查目标。",
          );
        else {
          const seen = new Set<string>();
          let cursor: string | undefined;
          do {
            let page;
            try {
              page = ProductionQualitySourcePageSchema.parse(
                productionSources.list(projectId, { cursor, limit: 100 }),
              );
            } catch {
              throw new QualityError(
                503,
                "实际保存剧本／场景目录读取失败，未核全，不以旧缓存或空目录替代。",
              );
            }
            if (
              page.projectId !== projectId ||
              (page.nextCursor && page.nextCursor !== page.items.at(-1)?.id)
            )
              throw new QualityError(503, "实际保存来源目录身份或游标未核全。");
            for (const item of page.items) {
              if (item.projectId !== projectId || seen.has(item.id))
                throw new QualityError(503, "实际保存来源目录重复或归属不符。");
              seen.add(item.id);
              if (item.state === "unavailable") {
                unavailable.push(
                  `${item.kind === "script" ? "保存剧本" : "独立／关联场景"} ${item.title}（${item.id}）来源未核全，不能生成报告。`,
                );
                continue;
              }
              const detail = productionSources.get(projectId, item.id);
              if (
                !detail ||
                detail.kind !== item.kind ||
                detail.version !== item.version ||
                detail.title !== item.title ||
                detail.parentId !== item.parentId ||
                detail.source.state !== "available"
              )
                throw new QualityError(
                  503,
                  "实际保存来源在读取中变化或未核全，请重新读取目录。",
                );
              const target = {
                kind: item.kind,
                id: item.id,
                version: item.version,
                sourceFingerprint: detail.source.contentHash,
              };
              freezeProductionQualitySource(projectId, target, detail);
              targets.push({
                target,
                title: `${item.kind === "script" ? "保存剧本" : "独立／关联场景"} · ${item.title}`,
              });
            }
            cursor = page.nextCursor;
            if (cursor && seen.has(cursor) && !page.items.length)
              throw new QualityError(503, "实际保存来源目录游标未推进。");
          } while (cursor);
        }
        const diagnosis = diagnoses?.current(projectId);
        if (diagnosis?.sourceState === "current")
          targets.push({
            target: {
              kind: "diagnosis",
              id: diagnosis.id,
              version: diagnosis.version,
            },
            title: "正式改编诊断",
          });
        const season = seasons?.current(projectId);
        if (season?.sourceState === "current") {
          targets.push({
            target: {
              kind: "season-plan",
              id: season.id,
              version: season.version,
            },
            title: "正式整季方案",
          });
          for (const episode of season.content.episodes)
            for (const operation of [
              "episode-outline",
              "episode-script",
              "storyboard-package",
            ] as const) {
              const value = episodes?.current(projectId, episode.id, operation);
              if (value?.sourceState === "current")
                targets.push({
                  target: {
                    kind: "episode-result",
                    id: value.id,
                    version: value.version,
                  },
                  title: `${episode.title} · ${operation === "episode-outline" ? "单集大纲" : operation === "episode-script" ? "标准剧本" : "分镜方案"}`,
                });
            }
        }
        return http.json({
          targets,
          chapterSet,
          unavailable: [
            ...unavailable,
            ...(diagnoses && seasons && episodes
              ? []
              : ["正式诊断、季纲或单集结果能力未启用；目录仅列已读取的目标。"]),
          ],
        });
      },
    ),
    route(
      "post",
      "/narrative-quality-reports/{id}/dispositions",
      "narrativeQuality.disposition",
      NarrativeQualityReportSchema,
      async (http) => {
        const id = http.req.param("id"),
          input = NarrativeQualityDispositionSchema.parse(
            await http.req.json(),
          );
        const key = http.req.header("Idempotency-Key");
        if (!key) throw new QualityError(400, "需要幂等标识。");
        const requestHash = hash({ id, input });
        const replay = context.uow.execute((tx) =>
          tx.get<{ request_hash: string; report_id: string }>(
            "SELECT request_hash,report_id FROM narrative_quality_requests WHERE request_key = ?",
            key,
          ),
        );
        if (replay) {
          if (replay.request_hash !== requestHash || replay.report_id !== id)
            fail("幂等标识不能用于不同的问题决定。");
          return http.json(decode(getStored(id)!));
        }
        const value = getStored(id);
        if (!value) throw new QualityError(404, "质量报告不存在。");
        if (http.req.header("If-Match") !== `"${input.version}"`)
          throw new QualityError(412, "需要当前报告版本 If-Match。");
        if (
          value.status !== "adopted" ||
          value.version !== input.version ||
          sourceReasons(value).length
        )
          fail("请处理来源有效的正式报告；旧报告不改为当前质量证据。");
        if (!value.content.issues.some((issue) => issue.id === input.issueId))
          throw new QualityError(404, "该报告没有此问题。");
        if (input.state === "resolved") {
          const recheck = input.recheckReportId
            ? getStored(input.recheckReportId)
            : undefined;
          const oldIssue = value.content.issues.find(
            (issue) => issue.id === input.issueId,
          )!;
          if (
            !recheck ||
            recheck.id === value.id ||
            recheck.projectId !== value.projectId ||
            recheck.status !== "adopted" ||
            hash(recheck.basis.request) !== hash(value.basis.request) ||
            sourceReasons(recheck).length ||
            context.uow.execute((tx) =>
              head(tx, value.projectId, value.basis.request.target),
            ) !== recheck.id ||
            recheck.content.issues.some(
              (issue) =>
                issue.category === oldIssue.category &&
                (issue.id === oldIssue.id ||
                  hash(issue.evidence) === hash(oldIssue.evidence)),
            )
          )
            fail(
              "解决问题需要同目标/范围的当前已采用复检报告且该问题不再出现；不能凭人工勾选冒充复检。",
            );
        } else if (input.recheckReportId)
          throw new QualityError(400, "仅解决状态可引用复检报告。");
        context.uow.execute((tx) => {
          const actual = read(tx, id)!;
          if (actual.version !== input.version) fail("报告已变化。");
          const now = new Date().toISOString();
          persist(tx, {
            ...actual,
            version: actual.version + 1,
            updatedAt: now,
            dispositions: [
              ...actual.dispositions.filter(
                (decision) => decision.issueId !== input.issueId,
              ),
              {
                issueId: input.issueId,
                state: input.state,
                note: input.note,
                source: "human",
                recheckReportId: input.recheckReportId,
                decidedAt: now,
              },
            ],
          });
          tx.run(
            "INSERT INTO narrative_quality_requests(request_key,request_hash,report_id,created_at) VALUES (?,?,?,?)",
            key,
            requestHash,
            id,
            now,
          );
        });
        return http.json(decode(getStored(id)!));
      },
      NarrativeQualityDispositionSchema,
    ),
  ];
  for (const contribution of routes)
    context.effect(
      () => context.http.register(contribution),
      `route:${contribution.id}`,
    );
}
