import { optionalService, provideService } from "@dramaip/plugin-api/internal";
import { createHash } from "node:crypto";
import {
  CreativeOutcomeFactSchema,
  CreativePlanningAdoptionFactSchema,
  CreativePlanningCommitError,
  creativePlanningMaterial,
  canonicalCreativeMetricJSON,
  creativeContinuationIdentity,
} from "@dramaip/contracts/insights";
import {
  assertCreationReferencesCurrent,
  assertCreationAuthorIntentCurrent,
  assertCreationSourceVersionCurrent,
  creationAuthorIntent,
  AUTHOR_INTENT_CREATION_PROMPT,
  WRITING_NARRATIVE_SOURCE_SERVICE,
  NarrativePlanningOperationSchema,
  NarrativePlanningBasisSchema,
  ProductionNarrativeRequestSchema,
  ProductionNarrativeBasisSchema,
  type ProductionNarrativeBasis,
  type NarrativePlanningBasis,
  narrativePlanningIdentity,
} from "@dramaip/contracts/creation";
import {
  KNOWLEDGE_RESEARCH_SERVICE,
  KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
  KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
  KNOWLEDGE_NARRATIVE_STORY_INDEX_SERVICE,
  type NarrativeStorySelection,
} from "@dramaip/contracts/knowledge";
import {
  prepareNovelContext,
  prepareNarrativeSources,
} from "./narrative-context.js";
import { mergeChapterText } from "./text-merge.js";
import {
  prepareNarrativePlanning,
  prepareProductionNarrative,
} from "./narrative-planning.js";
import {
  creationReference,
  CREATION_WRITING_SERVICE,
  CREATION_KNOWLEDGE_SERVICE,
  type CreationAdapter,
  type CreationIssue,
} from "@dramaip/contracts/creation";
import {
  WORKSPACE_PROJECT_SERVICE,
  WORKSPACE_AUTHOR_INTENT_SERVICE,
} from "@dramaip/contracts/workspace";
import {
  WRITING_CHAPTER_SERVICE,
  WRITING_RESOURCE_SERVICE,
} from "@dramaip/contracts/writing";
import type {
  PluginContext,
  PluginMigration,
} from "@dramaip/plugin-api/internal";

export const writingCreationMigration: PluginMigration = {
  id: "writing.0005.creation-adoption",
  pluginId: "writing",
  version: "3.0.0-alpha.4",
  dependsOn: ["writing.0004.four-mode-content"],
  sql: "CREATE TABLE writing_creation_adoptions (workflow_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at TEXT NOT NULL);",
};
export function registerWritingCreation(context: PluginContext) {
  const chapters = () => optionalService(context, WRITING_CHAPTER_SERVICE)!;
  const resources = () => optionalService(context, WRITING_RESOURCE_SERVICE)!;
  const compileStorySources = (
    projectId: string,
    selections: readonly NarrativeStorySelection[],
  ) => {
    const owner = optionalService(
      context,
      KNOWLEDGE_NARRATIVE_STORY_INDEX_SERVICE,
    );
    if (!owner) throw new Error("正式叙事来源索引不可用，不发送未核对声明。");
    return owner.compile(projectId, selections);
  };
  const assertNarrativeSourcesCurrent = (
    projectId: string,
    workflowId: string,
    basis: Pick<
      NarrativePlanningBasis | ProductionNarrativeBasis,
      "projectId" | "request" | "sourceBasis"
    >,
    purpose: "规划" | "制作",
  ): void => {
    const message = (value: string) => value.replaceAll("规划", purpose);
    if (
      basis.projectId !== projectId ||
      basis.sourceBasis.projectId !== projectId
    )
      throw new Error(message("原规划来源项目无法核对。"));
    const workflow = { id: workflowId, input: { projectId } };
    const scope = new Map(
      basis.request.chapterScope.chapters.map((chapter) => [
        chapter.id,
        chapter.version,
      ]),
    );
    if (
      basis.sourceBasis.chapters.some(
        (chapter) => scope.get(chapter.id) !== chapter.version,
      ) ||
      (basis.sourceBasis.summaries ?? []).some((summary) =>
        summary.chapters.some(
          (chapter) => scope.get(chapter.id) !== chapter.version,
        ),
      )
    )
      throw new Error(
        message("原规划的表达与冻结章节范围无法核对，不补造来源变化。"),
      );
    // Actual owner metadata before compilation can reject stale sources.
    // Never substitute current directory members for the original scope.
    for (const frozen of basis.request.chapterScope.chapters) {
      const current = chapters().get(frozen.id);
      assertCreationSourceVersionCurrent(
        workflow,
        "chapter",
        frozen,
        current?.projectId === projectId ? current : undefined,
        message("原已选规划章节无法核对或版本已变化；保留原候选，不换源采用。"),
      );
    }
    for (const selected of basis.sourceBasis.chapters) {
      if (selected.representation !== "summary") continue;
      const detail = optionalService(
        context,
        KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
      )?.chapter(projectId, selected.id);
      const records =
        detail?.projectId === projectId &&
        detail.chapter.id === selected.id &&
        detail.chapter.version === selected.version
          ? [...detail.summaries, ...detail.excluded]
          : [];
      assertCreationSourceVersionCurrent(
        workflow,
        "knowledge",
        selected.record,
        records.find((record) => record.id === selected.record.id),
        message("原已选规划章摘要记录无法核对或版本已变化；不换源采用。"),
      );
    }
    for (const selected of basis.sourceBasis.summaries ?? []) {
      const head = optionalService(
        context,
        KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
      )?.current?.(projectId, selected.target);
      assertCreationSourceVersionCurrent(
        workflow,
        "knowledge",
        selected,
        head,
        message("原已选规划高层摘要采用头无法核对或已变化；不换源采用。"),
      );
    }
  };
  context.effect(
    () =>
      provideService(context, WRITING_NARRATIVE_SOURCE_SERVICE, {
        assertPlanningCurrent(projectId, workflowId, raw) {
          assertNarrativeSourcesCurrent(
            projectId,
            workflowId,
            NarrativePlanningBasisSchema.parse(raw),
            "规划",
          );
        },
        assertProductionCurrent(projectId, workflowId, raw) {
          assertNarrativeSourcesCurrent(
            projectId,
            workflowId,
            ProductionNarrativeBasisSchema.parse(raw),
            "制作",
          );
        },
        production(projectId, raw) {
          const request = ProductionNarrativeRequestSchema.parse(raw);
          if (
            !optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(projectId)
          )
            throw new Error("制作来源项目不存在。");
          return prepareProductionNarrative(
            projectId,
            request.chapterScope.mode === "none"
              ? []
              : chapters().list(projectId),
            request,
            (id) =>
              optionalService(
                context,
                KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
              )?.chapter(projectId, id),
            (id) =>
              optionalService(
                context,
                KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
              )?.get(projectId, id),
            (selections) => compileStorySources(projectId, selections),
          );
        },
        planning(projectId, request) {
          if (
            !optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(projectId)
          )
            throw new Error("规划来源项目不存在。");
          return prepareNarrativePlanning(
            projectId,
            chapters().list(projectId),
            request,
            (id) =>
              optionalService(
                context,
                KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
              )?.chapter(projectId, id),
            (id) =>
              optionalService(
                context,
                KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
              )?.get(projectId, id),
            (selections) => compileStorySources(projectId, selections),
          );
        },
        compile(projectId, scope, request) {
          const all = chapters().list(projectId);
          const selected = all.filter((chapter) =>
            scope.some((ref) => ref.id === chapter.id),
          );
          if (
            !scope.length ||
            scope.length > 2000 ||
            selected.length !== scope.length ||
            selected.some(
              (chapter, index) =>
                chapter.id !== scope[index]?.id ||
                chapter.version !== scope[index]?.version ||
                !chapter.content.trim(),
            )
          )
            throw new Error(
              "明确来源范围必须按实际目录绑定当前非空章节，不能猜测或换成新版本。",
            );
          return prepareNarrativeSources(
            projectId,
            selected,
            request,
            (id) =>
              optionalService(
                context,
                KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
              )?.chapter(projectId, id),
            (id) =>
              optionalService(
                context,
                KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
              )?.get(projectId, id),
            (selections) => compileStorySources(projectId, selections),
          );
        },
      }),
    `service:${WRITING_NARRATIVE_SOURCE_SERVICE}`,
  );
  const service: CreationAdapter = {
    mergeText: mergeChapterText,
    prepare: (input, options) => {
      if (input.narrativeContextRequest && input.operation !== "chapter")
        throw new Error(
          "分层小说上下文目前仅用于本章正文操作，其他操作不能静默忽略该范围。",
        );
      if (
        input.narrativePlanningRequest &&
        (!NarrativePlanningOperationSchema.safeParse(input.operation).success ||
          input.operation === "knowledge-plan")
      )
        throw new Error(
          "规划来源只用于人物、大纲及故事弧操作，不能静默忽略或伪造正文目标。",
        );
      const project = optionalService(context, WORKSPACE_PROJECT_SERVICE)?.get(
        input.projectId,
      );
      if (!project) throw new Error("项目不存在。");
      const intentService = optionalService(
        context,
        WORKSPACE_AUTHOR_INTENT_SERVICE,
      );
      if (!intentService) throw new Error("正式作者意图服务未启用。");
      const intent = creationAuthorIntent(
        project.id,
        intentService.current(project.id),
      );
      const all = chapters().list(project.id);
      const planning = input.narrativePlanningRequest
        ? optionalService(context, WRITING_NARRATIVE_SOURCE_SERVICE)!.planning(
            project.id,
            input.narrativePlanningRequest,
          )
        : undefined;
      const prospective = options?.prospectiveChapter;
      if (
        prospective &&
        (input.operation !== "chapter" ||
          prospective.projectId !== project.id ||
          prospective.id !== input.targetId ||
          prospective.version !== 0 ||
          prospective.content !== "" ||
          prospective.summary !== "" ||
          chapters().get(prospective.id) ||
          prospective.orderIndex !==
            all.reduce((max, item) => Math.max(max, item.orderIndex), -1) + 1)
      )
        throw new Error(
          "续章预检只能核对本域尚未写入的明确空目标，不能伪造已有正文。",
        );
      const chapter =
        input.operation === "chapter" && input.targetId
          ? (prospective ?? chapters().get(input.targetId))
          : undefined;
      if (
        input.operation === "chapter" &&
        (!chapter ||
          chapter.projectId !== project.id ||
          chapter.version !== input.baseVersion)
      )
        throw new Error("章节不存在、归属不符或版本已变化。");
      const novel = chapter
        ? prepareNovelContext(
            chapter,
            all,
            input.narrativeContextRequest,
            (id) => {
              const index = optionalService(
                context,
                KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
              );
              if (!index)
                throw new Error(
                  "可信来源索引未启用，不能使用未验证摘要或猜测原文段落。",
                );
              return index.chapter(project.id, id);
            },
            (id) =>
              optionalService(
                context,
                KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
              )?.get(project.id, id),
            (selections) => compileStorySources(project.id, selections),
          )
        : undefined;
      const directory = [...all, ...(prospective ? [prospective] : [])].sort(
        (a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id),
      );
      const position = chapter
        ? directory.findIndex((item) => item.id === chapter.id)
        : -1;
      const previous = directory[position - 1];
      const included =
        previous &&
        novel &&
        [
          ...novel.basis.chapters,
          ...(novel.basis.summaries ?? []).flatMap((item) => item.chapters),
        ].some(
          (item) =>
            item.id === previous.id && item.version === previous.version,
        );
      const formalPrevious =
        included &&
        context.uow.execute((tx) =>
          tx.get(
            "SELECT workflow_id FROM writing_creation_adoptions WHERE json_extract(result_json, '$.chapterId') = ? AND json_extract(result_json, '$.version') = ?",
            previous.id,
            previous.version,
          ),
        );
      const targetKey = (id: string) =>
        createHash("sha256")
          .update(creativeContinuationIdentity(project.id, "novel", id))
          .digest("hex");
      const materials = (
        planning ? [] : ["characters", "outlines", "story-arcs"]
      ).flatMap((kind) =>
        resources().list(
          kind as "characters" | "outlines" | "story-arcs",
          project.id,
        ),
      );
      const memory =
        input.operation === "chapter" || planning
          ? undefined
          : optionalService(context, CREATION_KNOWLEDGE_SERVICE)?.references?.(
              input.projectId,
              chapter?.id,
            );
      const research =
        input.operation === "creator-content"
          ? (optionalService(context, KNOWLEDGE_RESEARCH_SERVICE)?.references?.(
              project.id,
            ) ?? [])
          : [];
      const profiles =
        input.operation === "creator-content"
          ? context.uow.execute((tx) =>
              tx.all<{
                id: string;
                title: string;
                payload_json: string;
                version: number;
              }>(
                "SELECT id,title,payload_json,version FROM writing_creator_content WHERE project_id=? AND kind IN ('profile','column') ORDER BY updated_at DESC LIMIT 20",
                project.id,
              ),
            )
          : [];
      const formats: Record<string, string> = {
        chapter:
          "先在内部明确本章任务：剧情推进、人物目标、视角、事实限制、情绪、伏笔与字数。content 只放完整小说正文，title 为章名，items 为空。遵循作者要求，不强制每章反转。",
        characters:
          "items 的 kind 为 characters，data 使用「角色定位、身份背景、性格、欲望与目标、秘密与弱点、人物弧光、视觉描述」。",
        "book-outline":
          "items 的 kind 为 outlines，data 包含「大纲层级」=「全书」及「内容」。",
        "chapter-outline":
          "items 的 kind 为 outlines，data 包含「大纲层级」=「章节」、「排序」及「内容」。",
        "story-arc":
          "items 的 kind 为 story-arcs，data 包含「层级、起始章节、结束章节、核心冲突、高光与伏笔回收」。",
        "creator-content":
          "提出选题、研究计划和完整脚本。items 的 kind 仅为 idea 或 draft，data 包含 content、sources 和 researchPlan。没有来源支持的关键事实写为待核验，不得编造引文或网址。",
      };
      const references = [
        ...intent.references,
        creationReference("project", project),
        ...(planning?.references ?? novel?.references ?? []),
        ...materials.map((item) => creationReference(item.domain, item)),
        ...(memory?.references ?? []),
        ...research,
        ...profiles.map((profile) =>
          creationReference("creator-profile", {
            id: profile.id,
            title: profile.title,
            version: profile.version,
            payload: JSON.parse(profile.payload_json),
          }),
        ),
      ];
      return {
        prompt: `${planning?.basis.sourceBasis.story?.length || novel?.basis.story?.length ? "本轮明确纳入的叙事声明是作者采用的来源锚定解释，含声明文本、实际端点名称／版本和来源身份，不附带原文引文或端点摘要；源指针不证明已提供原文。作者推断不能升级为原文事实，不按声明数量认证连续性或文学质量。\n" : ""}${formats[input.operation]}\n${planning ? `本轮规划来源范围=${planning.basis.request.chapterScope.mode}，实际表达覆盖 ${planning.basis.coverage.included.length} 章，目录未纳入 ${planning.basis.coverage.excluded.length} 章。只有明确原文是权威文本；采用摘要是派生概括，段落是片段，不冒充全文或语义保证。高层摘要仅代表实际冻结范围，未选内容不声称已读；不补整章或旧记忆。人物、大纲、故事弧是待审阅方案，不是已发生事实；无正文可以独立规划，不制造小说目标或改编任务。` : novel ? `本章正文及明确选择的原文是权威文本；已采用摘要是有来源的派生概括，不等于原文或语义保证。高层摘要仅代表其冻结章节范围，不证明当前整卷或全书覆盖；摘要与所选原文片段可重叠，不能重复计算覆盖。大纲与故事弧是未来规划。直接表达 ${novel.basis.chapters.length} 章，高层摘要 ${novel.basis.summaries?.length ?? 0} 条，未纳入 ${novel.basis.omitted.length} 章；未选择的内容不能声称已读、完整连续性或全书覆盖。` : "引用资料中已采用章节与故事记忆是事实；大纲是未来规划，历史设定必须核对。"}${intent.authorIntent.state === "adopted" ? `\n${AUTHOR_INTENT_CREATION_PROMPT}` : ""}`,
        authorIntent: intent.authorIntent,
        ...(formalPrevious && previous && chapter
          ? {
              continuationBasis: {
                workflowPath: "novel" as const,
                source: {
                  kind: "chapter" as const,
                  id: previous.id,
                  version: previous.version,
                  targetKey: targetKey(previous.id),
                  position: position - 1,
                },
                target: { targetKey: targetKey(chapter.id), position },
              },
            }
          : {}),
        narrativeContextBasis: novel?.basis,
        ...(planning
          ? {
              narrativePlanningBasis: NarrativePlanningBasisSchema.parse({
                ...planning.basis,
                operation: input.operation,
                references: references.map((reference) => ({
                  sourceKind: reference.sourceKind,
                  sourceId: reference.sourceId,
                  sourceVersion: reference.sourceVersion,
                  fieldPath: reference.fieldPath,
                  contentHash: createHash("sha256")
                    .update(JSON.stringify(reference.value))
                    .digest("hex"),
                  policyDependencies: reference.policyDependencies,
                })),
              }),
            }
          : {}),
        references,
        sources: [
          ...intent.sources,
          { kind: "project", id: project.id, version: project.version },
          ...(planning?.references ?? novel?.references ?? []).map((item) => ({
            kind: item.sourceKind,
            id: item.sourceId,
            version: item.sourceVersion,
          })),
          ...materials.map((item) => ({
            kind: item.domain,
            id: item.id,
            version: item.version,
          })),
          ...(memory?.sources ?? []),
        ],
      };
    },
    validate: (input, output) => {
      const issues: CreationIssue[] = [];
      const issue = (
        message: string,
        severity: CreationIssue["severity"] = "error",
      ) =>
        issues.push({
          severity,
          message,
          evidence: "",
          location: "候选方案",
          suggestion: "根据本轮目标补全候选。",
          source: "rule",
        });
      if (input.operation === "chapter") {
        if (!output.content.trim()) issue("候选正文为空。");
        const length = output.content.replace(/\s/gu, "").length;
        if (
          input.wordGoal &&
          Math.abs(length - input.wordGoal) > input.wordGoal * 0.15
        )
          issue(`正文 ${length} 字，目标 ${input.wordGoal} 字。`, "warning");
      } else {
        if (!output.items.length) issue("方案未包含可采用的结构化条目。");
        const kinds =
          input.operation === "characters"
            ? ["characters"]
            : input.operation === "story-arc"
              ? ["story-arcs"]
              : input.operation === "creator-content"
                ? ["idea", "draft"]
                : ["outlines"];
        if (output.items.some((item) => !kinds.includes(item.kind)))
          issue("候选条目类型不符合本次操作。");
        if (
          new Set(output.items.map((item) => item.ref)).size !==
          output.items.length
        )
          issue("候选内部标识重复。");
      }
      return issues;
    },
    apply: (workflow) => {
      if (
        context.uow.execute((tx) =>
          tx.get(
            "SELECT workflow_id FROM writing_creation_adoptions WHERE workflow_id = ?",
            workflow.id,
          ),
        )
      )
        return;
      // Preparation itself rejects a stale target. Observe its actual owner
      // version first, without changing the frozen run or rebasing the draft.
      if (workflow.input.operation === "chapter") {
        const chapter = chapters().get(workflow.input.targetId!);
        if (!chapter || chapter.projectId !== workflow.input.projectId)
          throw new Error("章节不存在、归属不符或版本已变化。");
        assertCreationSourceVersionCurrent(
          workflow,
          "chapter",
          {
            id: workflow.input.targetId!,
            version: workflow.input.baseVersion!,
          },
          { id: chapter.id, version: chapter.version },
          "章节不存在、归属不符或版本已变化。",
        );
      }
      if (workflow.narrativeContextBasis) {
        const original = workflow.narrativeContextBasis;
        // Observe only the chapter identities actually frozen in the author's
        // selected representations and adopted higher-summary coverage. A
        // changed directory never expands that historical source scope.
        const seen = new Set<string>();
        for (const frozen of [
          ...original.chapters,
          ...(original.summaries ?? []).flatMap((summary) => summary.chapters),
          ...(original.story ?? []).flatMap((source) => source.sourceChapters),
        ]) {
          if (seen.has(frozen.id)) continue;
          seen.add(frozen.id);
          const chapter = chapters().get(frozen.id);
          assertCreationSourceVersionCurrent(
            workflow,
            "chapter",
            frozen,
            chapter?.projectId === workflow.input.projectId
              ? chapter
              : undefined,
            "明确冻结上下文章节不存在、归属无法核对或版本已变化；保留原候选，不换源采用。",
          );
        }
        for (const selected of original.chapters) {
          if (selected.representation !== "summary") continue;
          const detail = optionalService(
            context,
            KNOWLEDGE_NARRATIVE_INDEX_SERVICE,
          )?.chapter(workflow.input.projectId, selected.id);
          const records =
            detail?.projectId === workflow.input.projectId &&
            detail.chapter.id === selected.id &&
            detail.chapter.version === selected.version
              ? [...detail.summaries, ...detail.excluded]
              : [];
          assertCreationSourceVersionCurrent(
            workflow,
            "knowledge",
            selected.record,
            records.find((record) => record.id === selected.record.id),
            "明确选择的采用章摘要记录无法核对或原版本已变化；保留原候选，不换源采用。",
          );
        }
        for (const selected of original.summaries ?? []) {
          const currentHead = optionalService(
            context,
            KNOWLEDGE_NARRATIVE_SUMMARY_SERVICE,
          )?.current?.(workflow.input.projectId, selected.target);
          assertCreationSourceVersionCurrent(
            workflow,
            "knowledge",
            selected,
            currentHead,
            "明确采用的高层摘要头无法核对或已变化；保留原候选，不换源采用。",
          );
        }
      }
      if (workflow.narrativePlanningBasis)
        optionalService(
          context,
          WRITING_NARRATIVE_SOURCE_SERVICE,
        )!.assertPlanningCurrent(
          workflow.input.projectId,
          workflow.id,
          workflow.narrativePlanningBasis,
        );
      const current = service.prepare(workflow.input);
      assertCreationAuthorIntentCurrent(workflow, current.authorIntent!);
      assertCreationReferencesCurrent(workflow, current.references ?? []);
      if (
        workflow.narrativePlanningBasis &&
        (!current.narrativePlanningBasis ||
          narrativePlanningIdentity(workflow.narrativePlanningBasis) !==
            narrativePlanningIdentity(current.narrativePlanningBasis))
      )
        throw new Error(
          "明确规划来源、实际表达或约束已变化，保留候选但不能换源采用。",
        );
      if (workflow.narrativeContextBasis) {
        for (const source of workflow.narrativeContextBasis.references)
          // Explicit Preview merge may rebase only the target author draft.
          // Keep the generation snapshot untouched; all upstream representations
          // must still match their original hashes and versions.
          if (!(
            source.sourceKind === "chapter" &&
            source.sourceId === workflow.narrativeContextBasis.target.id &&
            source.fieldPath ===
              `/chapters/${workflow.narrativeContextBasis.target.id}` &&
            workflow.input.baseVersion !==
              workflow.narrativeContextBasis.target.version
          ))
            if (
              !current.narrativeContextBasis?.references.some(
                (reference) =>
                  reference.sourceKind === source.sourceKind &&
                  reference.sourceId === source.sourceId &&
                  reference.sourceVersion === source.sourceVersion &&
                  reference.fieldPath === source.fieldPath &&
                  reference.contentHash === source.contentHash,
              )
            )
              throw new Error(
                "明确冻结的原文、摘要或段落已变化；候选保留，但不能换源采用。",
              );
      }
      if (
        !workflow.output ||
        service
          .validate(workflow.input, workflow.output)
          .some((issue) => issue.severity === "error")
      )
        throw new Error("候选结构无效。");
      for (const source of workflow.sources) {
        if (source.kind === "project") {
          const project = optionalService(
            context,
            WORKSPACE_PROJECT_SERVICE,
          )?.get(source.id);
          assertCreationSourceVersionCurrent(
            workflow,
            "project",
            source,
            project?.id === workflow.input.projectId ? project : undefined,
            "项目方向已变化。",
          );
        } else if (source.kind === "chapter") {
          const chapter = chapters().get(source.id);
          assertCreationSourceVersionCurrent(
            workflow,
            "chapter",
            source,
            chapter?.projectId === workflow.input.projectId
              ? chapter
              : undefined,
            "来源正文已变化。",
          );
        } else if (
          ["characters", "outlines", "story-arcs"].includes(source.kind) &&
          resources().get(source.id)?.version !== source.version
        ) {
          const record = resources().get(source.id);
          assertCreationSourceVersionCurrent(
            workflow,
            "writing_resource",
            source,
            record?.projectId === workflow.input.projectId ? record : undefined,
            "来源设定已变化。",
          );
        }
      }
      if (workflow.input.operation === "chapter") {
        const chapter = chapters().get(workflow.input.targetId!);
        if (!chapter || chapter.version !== workflow.input.baseVersion)
          throw new Error("正文版本已变化。");
        context.uow.execute((tx) => {
          const at = new Date().toISOString();
          tx.run(
            "INSERT OR IGNORE INTO writing_chapter_versions(id,chapter_id,version_number,snapshot_json,created_at) VALUES (?, ?, ?, ?, ?)",
            crypto.randomUUID(),
            chapter.id,
            chapter.version,
            JSON.stringify(chapter),
            at,
          );
          tx.run(
            "UPDATE chapters SET content = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
            workflow.output!.content,
            at,
            chapter.id,
            chapter.version,
          );
          tx.run(
            "INSERT INTO writing_creation_adoptions VALUES (?, ?, ?)",
            workflow.id,
            JSON.stringify({
              chapterId: chapter.id,
              version: chapter.version + 1,
            }),
            at,
          );
          tx.append({
            type: "writing.chapter-updated.v1",
            pluginId: "writing",
            aggregateType: "chapter",
            aggregateId: chapter.id,
            aggregateVersion: chapter.version + 1,
            payload: {
              id: chapter.id,
              projectId: chapter.projectId,
              version: chapter.version + 1,
              sourceWorkflowId: workflow.id,
            },
          });
          tx.append({
            type: "writing.chapter-adopted.v1",
            pluginId: "writing",
            aggregateType: "chapter",
            aggregateId: chapter.id,
            aggregateVersion: chapter.version + 1,
            payload: CreativeOutcomeFactSchema.parse({
              eventVersion: 1,
              kind: "novel.chapter-adopted",
              workflowPath: "novel",
              projectId: chapter.projectId,
              objectId: chapter.id,
              workflowId: workflow.id,
              continuationTarget: {
                targetKey: createHash("sha256")
                  .update(
                    creativeContinuationIdentity(
                      chapter.projectId,
                      "novel",
                      chapter.id,
                    ),
                  )
                  .digest("hex"),
                position: tx
                  .all<{ id: string }>(
                    "SELECT id FROM chapters WHERE project_id = ? ORDER BY order_index, id",
                    chapter.projectId,
                  )
                  .findIndex((item) => item.id === chapter.id),
              },
              ...(workflow.previewId
                ? {
                    candidate: {
                      id: workflow.previewId,
                      contentFingerprint: createHash("sha256")
                        .update(
                          canonicalCreativeMetricJSON(workflow.output!.content),
                        )
                        .digest("hex"),
                    },
                  }
                : {}),
              formalVersions: [
                {
                  kind: "chapter",
                  id: chapter.id,
                  version: chapter.version + 1,
                },
              ],
              sourceVersions: workflow.sources.map(({ id, version }) => ({
                id,
                version,
              })),
              evidenceKind: "human",
              modelEvidence: "unknown",
              qualityState: "unverified",
              resultStatus: "adopted",
            }),
          });
        });
        return;
      }
      try {
        context.uow.execute((tx) => {
          if (
            tx.get(
              "SELECT workflow_id FROM writing_creation_adoptions WHERE workflow_id = ?",
              workflow.id,
            )
          )
            return;
          const at = new Date().toISOString();
          const ids: string[] = [];
          for (const item of workflow.output!.items) {
            const id = crypto.randomUUID();
            ids.push(id);
            if (workflow.input.operation === "creator-content") {
              tx.run(
                "INSERT INTO writing_creator_content(id, kind, project_id, title, status, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'review_required', ?, 0, ?, ?)",
                id,
                item.kind,
                workflow.input.projectId,
                item.title,
                JSON.stringify({ ...item.data, sourceWorkflowId: workflow.id }),
                at,
                at,
              );
            } else {
              tx.run(
                "INSERT INTO writing_resources(id, kind, project_id, title, payload_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
                id,
                item.kind,
                workflow.input.projectId,
                item.title,
                JSON.stringify({
                  ...item.data,
                  sourceWorkflowId: workflow.id,
                  ...(workflow.narrativePlanningBasis
                    ? {
                        narrativePlanningBasis: workflow.narrativePlanningBasis,
                      }
                    : {}),
                }),
                at,
                at,
              );
              tx.append({
                type: "writing.planning-adopted.v1",
                pluginId: "writing",
                aggregateType: "resource",
                aggregateId: id,
                aggregateVersion: 0,
                payload: CreativeOutcomeFactSchema.parse({
                  eventVersion: 1,
                  kind: "novel.planning-adopted",
                  workflowPath: "novel",
                  projectId: workflow.input.projectId,
                  objectId: id,
                  workflowId: workflow.id,
                  formalVersions: [{ kind: "planning", id, version: 0 }],
                  sourceVersions: workflow.sources.map(
                    ({ id: sourceId, version }) => ({ id: sourceId, version }),
                  ),
                  evidenceKind: "human",
                  modelEvidence: "unknown",
                  qualityState: "unverified",
                  resultStatus: "adopted",
                }),
              });
            }
          }
          if (
            workflow.narrativePlanningBasis &&
            workflow.previewId &&
            NarrativePlanningOperationSchema.safeParse(workflow.input.operation)
              .success
          ) {
            tx.append({
              type: "writing.planning-batch-adopted.v1",
              pluginId: "writing",
              aggregateType: "creation",
              aggregateId: workflow.id,
              aggregateVersion: 1,
              payload: CreativePlanningAdoptionFactSchema.parse({
                eventVersion: 1,
                kind: "story.planning-batch-adopted",
                workflowPath: "story-planning",
                projectId: workflow.input.projectId,
                workflowId: workflow.id,
                operation: workflow.input.operation,
                candidate: {
                  id: workflow.previewId,
                  contentFingerprint: createHash("sha256")
                    .update(
                      canonicalCreativeMetricJSON(
                        creativePlanningMaterial(workflow.output!.items),
                      ),
                    )
                    .digest("hex"),
                },
                records: ids.map((id, index) => ({
                  id,
                  kind: workflow.output!.items[index]!.kind,
                  version: 0,
                })),
                sourceVersions: workflow.sources.map(({ id, version }) => ({
                  id,
                  version,
                })),
                evidenceKind: "human",
                modelEvidence: "unknown",
                qualityState: "unverified",
                resultStatus: "adopted",
              }),
            });
          }
          tx.run(
            "INSERT INTO writing_creation_adoptions VALUES (?, ?, ?)",
            workflow.id,
            JSON.stringify(ids),
            at,
          );
          tx.append({
            type: "writing.creation-adopted.v1",
            pluginId: "writing",
            aggregateType: "creation",
            aggregateId: workflow.id,
            aggregateVersion: 1,
            payload: {
              projectId: workflow.input.projectId,
              workflowId: workflow.id,
              ids,
            },
          });
        });
      } catch (error) {
        if (workflow.narrativePlanningBasis)
          throw new CreativePlanningCommitError();
        throw error;
      }
    },
  };
  context.effect(
    () => provideService(context, CREATION_WRITING_SERVICE, service),
    `service:${CREATION_WRITING_SERVICE}`,
  );
}
