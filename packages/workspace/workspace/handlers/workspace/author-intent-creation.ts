import { createHash } from "node:crypto";
import type { AgentContextReference } from "@dramaip/contracts/agent-context";
import {
  CREATION_AUTHOR_INTENT_SERVICE,
  creationAuthorIntent,
  creationReference,
  type CreationAdapter,
  type CreationContent,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import {
  AuthorIntentContentSchema,
  AuthorIntentCreationRequestSchema,
  AuthorIntentCreationBasisSchema,
  AuthorIntentSourceCatalogSchema,
  sameAuthorIntentCreationSource,
  PRODUCTION_AUTHOR_INTENT_SOURCE_SERVICE,
  WORKSPACE_AUTHOR_INTENT_SERVICE,
  WORKSPACE_PROJECT_SERVICE,
  type AuthorIntentCreationBasis,
  type AuthorIntentCreationSource,
} from "@dramaip/contracts/workspace";
import { WRITING_CHAPTER_SERVICE } from "@dramaip/contracts/writing";
import {
  WRITING_NARRATIVE_SOURCE_SERVICE,
  narrativeSourceIdentity,
} from "@dramaip/contracts/creation";
import {
  KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
  KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
  KNOWLEDGE_NARRATIVE_STORY_INDEX_SERVICE,
} from "@dramaip/contracts/knowledge";
import type { AuthorIntentCreationRequest } from "@dramaip/contracts/workspace";
import {
  optionalService,
  provideService,
  type PluginContext,
} from "@dramaip/plugin-api/internal";
import type { createAuthorIntentService } from "./author-intent.js";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A failed public owner read cannot certify drift, absence, or an empty scope. */
export class AuthorIntentSourcesUnavailableError extends Error {
  constructor() {
    super("原作者意图来源暂未能核对，旧候选与冻结基准保持不变。");
    this.name = "AuthorIntentSourcesUnavailableError";
  }
}

export function authorIntentSourceReader(context: PluginContext) {
  const chapter = (projectId: string, id: string) => {
    const value = optionalService(context, WRITING_CHAPTER_SERVICE)?.get(id);
    if (!value || value.projectId !== projectId || !value.content.trim())
      return undefined;
    const reference = creationReference("chapter", value);
    return {
      title: value.title,
      source: {
        kind: "chapter" as const,
        id,
        version: value.version,
        contentHash: hash(reference.value),
      },
      reference,
    };
  };
  const read = (projectId: string, source: AuthorIntentCreationSource) =>
    source.kind === "chapter"
      ? chapter(projectId, source.id)
      : optionalService(context, PRODUCTION_AUTHOR_INTENT_SOURCE_SERVICE)?.get(
          projectId,
          source.id,
        );
  const compile = (projectId: string, request: AuthorIntentCreationRequest) => {
    if (!request.context) return undefined;
    const service = optionalService(context, WRITING_NARRATIVE_SOURCE_SERVICE);
    if (!service)
      throw new Error("作者意图原表达编译服务未能核对，未认定来源变化或为空。");
    const allowed = request.sources.filter(
      (source) => source.kind === "chapter",
    );
    const compiled = service.compile(
      projectId,
      allowed.map(({ id, version }) => ({ id, version })),
      request.context,
    );
    if (compiled.basis.omitted.length || !compiled.references.length)
      throw new Error(
        "每个允许章节须明确表达；不能自动补整章或让解释身份冒充整章已读。",
      );
    const chapters = allowed.map((source) => {
      const current = chapter(projectId, source.id);
      if (!current || !sameAuthorIntentCreationSource(current.source, source))
        throw new Error("原确认范围已变化，未换源或添加未选正文。");
      return { id: source.id, version: source.version, title: current.title };
    });
    return { ...compiled, chapters };
  };
  const inspectSourcesCurrent = (
    projectId: string,
    basis: AuthorIntentCreationBasis,
  ) => {
    if (
      !basis.request.sources.every((source) => {
        const current = read(projectId, source)?.source;
        return Boolean(
          current && sameAuthorIntentCreationSource(current, source),
        );
      })
    )
      return false;
    if (!basis.request.context) return true;
    if (!basis.sourceBasis || basis.sourceBasis.projectId !== projectId)
      return false;
    // Missing peer service / failed owner read is an error, never fabricated stale.
    for (const selected of basis.sourceBasis.chapters) {
      if (selected.representation !== "summary") continue;
      const service = optionalService(
        context,
        KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
      );
      if (!service) throw new Error("原章节摘要来源服务未能读取。");
      const detail = service.chapter(projectId, selected.id);
      if (
        !detail ||
        detail.projectId !== projectId ||
        detail.chapter.id !== selected.id
      )
        throw new Error("原章节摘要目录未能核对，不认定为空或来源变化。");
      if (
        !detail.summaries.some(
          (record) =>
            record.id === selected.record.id &&
            record.version === selected.record.version,
        )
      )
        return false;
    }
    for (const selected of basis.sourceBasis.summaries ?? []) {
      const service = optionalService(
        context,
        KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
      );
      if (!service) throw new Error("原高层摘要来源服务未能读取。");
      const current = service.get(projectId, selected.id);
      if (
        !current ||
        current.version !== selected.version ||
        current.status !== "adopted" ||
        !current.isHead ||
        current.contextEligibility.state !== "eligible"
      )
        return false;
    }
    if (basis.sourceBasis.story?.length) {
      const service = optionalService(
        context,
        KNOWLEDGE_NARRATIVE_STORY_INDEX_SERVICE,
      );
      if (!service) throw new Error("原叙事解释来源服务未能读取。");
      const catalog = service.catalog(projectId);
      if (catalog.projectId !== projectId)
        throw new Error("原叙事目录归属未能核对。");
      for (const selected of basis.sourceBasis.story) {
        const entry = catalog.entries.find(
          (entry) =>
            entry.selection.kind === selected.selection.kind &&
            entry.selection.id === selected.selection.id &&
            entry.selection.version === selected.selection.version,
        );
        if (entry?.sourceState === "unavailable")
          throw new Error("原叙事解释来源暂不可核对，未伪造来源变化。");
        if (!entry || entry.eligibility.state !== "eligible") return false;
      }
    }
    const current = compile(projectId, basis.request);
    return Boolean(
      current &&
      narrativeSourceIdentity(current.basis) ===
        narrativeSourceIdentity(basis.sourceBasis),
    );
  };
  const sourcesCurrent = (
    projectId: string,
    basis: AuthorIntentCreationBasis,
  ) => {
    try {
      return inspectSourcesCurrent(projectId, basis);
    } catch {
      throw new AuthorIntentSourcesUnavailableError();
    }
  };
  const catalog = (projectId: string) => {
    const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
      projectId,
    );
    if (!project) return undefined;
    const chapters = optionalService(context, WRITING_CHAPTER_SERVICE);
    const scripts = optionalService(
      context,
      PRODUCTION_AUTHOR_INTENT_SOURCE_SERVICE,
    );
    const current = optionalService(
      context,
      WORKSPACE_AUTHOR_INTENT_SERVICE,
    )?.current(projectId);
    return AuthorIntentSourceCatalogSchema.parse({
      projectVersion: project.version,
      ...(current ? { baseAdoptedId: current.id } : {}),
      chapterAvailable: Boolean(chapters),
      scriptAvailable: Boolean(scripts),
      items: [
        ...(chapters?.list(projectId).flatMap((value) => {
          const entry = chapter(projectId, value.id);
          return entry ? [{ title: entry.title, source: entry.source }] : [];
        }) ?? []),
        ...(scripts
          ?.list(projectId)
          .map(({ title, source }) => ({ title, source })) ?? []),
      ],
    });
  };
  return { read, sourcesCurrent, catalog, compile };
}

function parseCandidate(content: CreationContent) {
  const item = content.items[0];
  if (
    content.items.length !== 1 ||
    !item ||
    item.ref !== "author-intent" ||
    item.kind !== "author-intent" ||
    item.parentRef !== undefined ||
    item.title.length > 160 ||
    content.title.length > 160 ||
    content.content.trim()
  )
    throw new Error(
      "作者意图必须是唯一结构化八字段候选，不能混入正文、剧本或其他业务条目。",
    );
  return AuthorIntentContentSchema.strict().parse(item.data);
}

export function registerAuthorIntentCreation(
  context: PluginContext,
  intents: ReturnType<typeof createAuthorIntentService>,
  reader: ReturnType<typeof authorIntentSourceReader>,
) {
  const candidate = (workflow: CreationWorkflow) =>
    intents.byWorkflow(workflow.input.projectId, workflow.id);
  const adapter: CreationAdapter = {
    prepare: (input) => {
      if (input.operation !== "author-intent" || !input.authorIntentRequest)
        throw new Error("作者意图生成必须明确确认项目、当前意图头和可选来源。");
      if (
        input.targetId ||
        input.baseVersion !== undefined ||
        input.sourceIds.length ||
        input.wordGoal ||
        input.language ||
        input.reviewPackageId ||
        input.feedbackClusterId ||
        input.diagnosisRequest ||
        input.seasonPlanRequest ||
        input.episodeDevelopmentRequest ||
        input.qualityReviewRequest ||
        input.narrativeContextRequest ||
        input.narrativeSummaryRequest
      )
        throw new Error(
          "作者意图不能携带正文目标、另一种来源通道或其他工作流要求。",
        );
      const request = AuthorIntentCreationRequestSchema.parse(
        input.authorIntentRequest,
      );
      const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
        input.projectId,
      );
      const intentService = optionalService(
        context,
        WORKSPACE_AUTHOR_INTENT_SERVICE,
      );
      if (!project || !intentService)
        throw new Error("项目或正式意图服务未启用。");
      const current = intentService.current(project.id);
      if (
        project.version !== request.projectVersion ||
        current?.id !== request.baseAdoptedId
      )
        throw new Error("项目简报或当前意图头已变化，请明确重新核对来源。");
      const binding = creationAuthorIntent(project.id, current);
      const references: AgentContextReference[] = [
        creationReference("project", project),
        ...binding.references,
      ];
      const mixed = reader.compile(project.id, request);
      for (const source of request.sources) {
        const value = reader.read(project.id, source);
        if (!value || !sameAuthorIntentCreationSource(value.source, source))
          throw new Error(
            "所选章节或剧本已变化、缺失、为空或不属于此项目；不会替换来源。",
          );
        if (!mixed || source.kind === "script")
          references.push(value.reference);
      }
      if (mixed) references.push(...mixed.references);
      const basis = AuthorIntentCreationBasisSchema.parse({
        request,
        ...(mixed
          ? { sourceBasis: mixed.basis, chapters: mixed.chapters }
          : {}),
        references: references.map((reference) => ({
          sourceKind: reference.sourceKind,
          sourceId: reference.sourceId,
          sourceVersion: reference.sourceVersion,
          fieldPath: reference.fieldPath,
          contentHash: hash(reference.value),
        })),
      });
      return {
        prompt: `生成供作者审阅的作者意图建议，而不是已确认方向。只基于冻结项目简报${mixed ? "及原确认范围内的所选原文／摘要／段落／叙事解释与明确剧本；允许范围不等于完整原文已读，解释不是作者思想认证" : request.sources.length ? `及明确选择的 ${request.sources.length} 份完整来源` : "，未读任何章节或剧本"}；未选材料不代表已覆盖全书。已有正式意图是本次比较基准；仅提出用户要求的替代建议，不能自行采用、改写正文或强制小说改编。不得声称知道未表达的作者思想；不确定的结局可留空，约束可为空数组。\n只返回一个 items 条目，ref 与 kind 都为 author-intent，parentRef 省略，title 为意图建议，content 为空字符串。data 必须恰好包含八字段：themeStatement、emotionalPromise、targetAudience、mustKeep（字符串数组）、mayChange（数组）、mustAvoid（数组）、endingContract、toneAndVoice。主题、情绪、受众、声音为非空字符串；结局可空。不要返回项目 ID、采用状态、评分、模型证明、小说正文、剧本或场景。`,
        authorIntent: binding.authorIntent,
        authorIntentBasis: basis,
        references,
        sources: references.map((reference) => ({
          kind: reference.sourceKind,
          id: reference.sourceId,
          version: reference.sourceVersion,
        })),
      };
    },
    validate: (_input, content) => {
      try {
        parseCandidate(content);
        return [];
      } catch {
        return [
          {
            source: "rule",
            severity: "error",
            message: "作者意图候选结构不完整或混入其他业务内容。",
            evidence: "八字段结构校验未通过",
            location: "items",
            suggestion:
              "只修复唯一 author-intent 条目的八字段，不生成正文或采用状态。",
          },
        ];
      }
    },
    review: (workflow) => {
      if (!workflow.output) throw new Error("没有作者意图候选。");
      const value = intents.generated(
        workflow,
        parseCandidate(workflow.output),
      );
      return { authorIntentId: value.id };
    },
    reviewState: (workflow) => {
      const value = candidate(workflow);
      return value?.status === "adopted" || value?.status === "discarded"
        ? value.status
        : undefined;
    },
    discard: (workflow) => {
      const value = candidate(workflow);
      if (!value) throw new Error("没有实际意图候选。");
      const result = intents.transition(
        value.id,
        "discard",
        value.stateVersion,
        `creation-discard:${workflow.id}`,
      );
      if (!("value" in result)) throw new Error(result.detail);
    },
    apply: (workflow) => {
      // Generic Preview/Commit cannot adopt on behalf of the author. The
      // dedicated Workspace adoption route owns its CAS and durable event.
      if (candidate(workflow)?.status !== "adopted")
        throw new Error(
          "请在作者意图差异预览中明确采用；通用创作提交不能代替作者确认。",
        );
    },
  };
  context.effect(
    () => provideService(context, CREATION_AUTHOR_INTENT_SERVICE, adapter),
    `service:${CREATION_AUTHOR_INTENT_SERVICE}`,
  );
}
