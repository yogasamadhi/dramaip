import type { StudioClient } from "@dramaip/client";
import {
  ProviderActionPreviewSummaryPageSchema,
  type ProviderActionPreviewSummary,
  type RevisionPreviewSummary,
} from "@dramaip/contracts/automation";
import type { PilotPackageRecord } from "@dramaip/contracts/delivery";
import {
  providerEstimate,
  providerReviewStatusLabel,
} from "./provider-action-review";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type {
  NarrativeQualitySummary,
  NarrativeLocalQualitySummary,
} from "@dramaip/contracts/creative-quality";
import type { ManuscriptRecord } from "@dramaip/contracts/delivery";
import type {
  StoryBibleChangeSet,
  NarrativeSummaryStatus,
} from "@dramaip/contracts/knowledge";
import type {
  MediaSourceReviewSummary,
  AudioRevisionSummary,
} from "@dramaip/contracts/media";
import type { AudioResolutionSummary } from "@dramaip/contracts/timeline";
import type {
  ImportExtractionChangeSet,
  AuthorIntentSummary,
} from "@dramaip/contracts/workspace";
import type { Project, Task } from "@dramaip/contracts/product";
import type {
  DiagnosisSummary,
  SeasonPlanSummary,
  AdaptationStrategySummary,
  EpisodeScriptRevisionSummary,
  EpisodeTopologyRevisionSummary,
  EpisodeSourceRevisionSummary,
  EpisodeDevelopmentSummary,
} from "@dramaip/contracts/production";
import { EpisodeSourceRevisionSummaryPageSchema } from "@dramaip/contracts/production";

export type ConfirmationCategory = "waiting" | "running" | "attention";
export type ConfirmationItem = {
  key: string;
  kind:
    | "creation"
    | "revision"
    | "story-bible"
    | "story-declaration"
    | "story-assertion"
    | "import"
    | "manuscript"
    | "pilot-package"
    | "provider-action"
    | "task"
    | "author-intent"
    | "author-script-revision"
    | "author-topology-revision"
    | "author-source-revision"
    | "media-source-review"
    | "audio-revision"
    | "audio-resolution"
    | "narrative-local-review";
  objectId: string;
  projectId?: string;
  projectTitle: string;
  title: string;
  status: string;
  category: ConfirmationCategory;
  detail: string;
  updatedAt: string;
  to: string;
};
export type ConfirmationEvidence = {
  projects: Project[];
  items: ConfirmationItem[];
  unavailable: Array<{ source: string; projectId?: string }>;
};
export type ConfirmationClient = {
  providerActionPreviews?: Pick<
    StudioClient["providerActionPreviews"],
    "summaries"
  >;
  pilotPackages?: Pick<StudioClient["pilotPackages"], "list">;
  episodeDevelopments?: Pick<
    StudioClient["episodeDevelopments"],
    "scriptRevisionSummaries"
  > &
    Partial<
      Pick<
        StudioClient["episodeDevelopments"],
        "summaries" | "topologyRevisionSummaries" | "sourceRevisionSummaries"
      >
    >;
  narrativeSummaries?: Pick<StudioClient["narrativeSummaries"], "summaries">;
  narrativeQuality?: Partial<
    Pick<StudioClient["narrativeQuality"], "summaries" | "localSummaries">
  >;
  diagnoses?: Pick<StudioClient["diagnoses"], "summaries">;
  seasonPlans?: Pick<StudioClient["seasonPlans"], "summaries">;
  adaptationStrategies?: Pick<
    StudioClient["adaptationStrategies"],
    "summaries"
  >;
  mediaSources?: Pick<StudioClient["mediaSources"], "summaries">;
  audioRevisions?: Pick<StudioClient["audioRevisions"], "summaries">;
  audioResolutions?: Pick<StudioClient["audioResolutions"], "summaries">;
  storyDeclarations?: Pick<StudioClient["storyDeclarations"], "list">;
  storyAssertions?: Pick<StudioClient["storyAssertions"], "list">;
} & {
  [
    Key in
      | "projects"
      | "tasks"
      | "creation"
      | "storyBible"
      | "importExtractions"
      | "manuscripts"
      | "revisions"
      | "authorIntents"
  ]: Pick<StudioClient[Key], "list">;
};

type SourceNodeSummary = Awaited<
  ReturnType<StudioClient["storyDeclarations"]["list"]>
>["items"][number];
type SourceAssertionSummary = Awaited<
  ReturnType<StudioClient["storyAssertions"]["list"]>
>["items"][number];

const CREATION_NAMES: Record<CreationWorkflow["input"]["operation"], string> = {
  "author-intent": "作者意图建议",
  chapter: "本章正文",
  characters: "人物方案",
  "book-outline": "全书大纲",
  "chapter-outline": "章节大纲",
  "story-arc": "卷与单元方案",
  episode: "本集剧本与分镜（旧 episode 兼容）",
  "adaptation-diagnosis": "改编诊断",
  "adaptation-strategy": "独立改编策略",
  "season-plan": "整季分集方案",
  "episode-outline": "单集大纲",
  "episode-script": "单集标准剧本",
  "storyboard-package": "单集分镜包",
  "quality-review": "版本绑定的质量报告",
  "script-revision": "剧本修订",
  "review-check": "采用后审片复检",
  "shot-prompt": "镜头提示词",
  "delivery-copy": "交付文案",
  localization: "字幕与译文",
  "creator-content": "选题与内容脚本",
  "chapter-memory": "故事记忆",
  "knowledge-plan": "故事与视觉设定",
  "narrative-summary": "卷／故事弧／全书摘要",
};

function route(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, value);
  return `${path}?${search}`;
}

// There is no new authoritative "pending" table: every item remains owned by
// its original domain. The read model never adopts content or authorizes cost.
export function deriveConfirmations(input: {
  projects: readonly Project[];
  workflows: readonly CreationWorkflow[];
  storyBible: readonly StoryBibleChangeSet[];
  imports: readonly ImportExtractionChangeSet[];
  manuscripts: readonly ManuscriptRecord[];
  providerActions?: readonly ProviderActionPreviewSummary[];
  pilotPackages?: readonly PilotPackageRecord[];
  revisions?: readonly (RevisionPreviewSummary & { projectId: string })[];
  authorIntents?: readonly AuthorIntentSummary[];
  diagnoses?: readonly DiagnosisSummary[];
  seasonPlans?: readonly SeasonPlanSummary[];
  adaptationStrategies?: readonly AdaptationStrategySummary[];
  narrativeReports?: readonly NarrativeQualitySummary[];
  localReviews?: readonly NarrativeLocalQualitySummary[];
  scriptRevisions?: readonly EpisodeScriptRevisionSummary[];
  topologyRevisions?: readonly EpisodeTopologyRevisionSummary[];
  sourceRevisions?: readonly EpisodeSourceRevisionSummary[];
  narrativeSummaries?: readonly NarrativeSummaryStatus[];
  episodeResults?: readonly EpisodeDevelopmentSummary[];
  mediaSourceReviews?: readonly MediaSourceReviewSummary[];
  audioRevisions?: readonly AudioRevisionSummary[];
  audioResolutions?: readonly AudioResolutionSummary[];
  storyDeclarations?: readonly SourceNodeSummary[];
  storyAssertions?: readonly SourceAssertionSummary[];
  tasks: readonly Task[];
}): ConfirmationItem[] {
  const items: ConfirmationItem[] = [];
  const representedTasks = new Set<string>();
  const title = (id?: string) =>
    id
      ? (input.projects.find((project) => project.id === id)?.title ??
        "项目不可用")
      : "全局任务";
  const declarations = [
    ...(input.storyDeclarations ?? []).map((value) => ({
      ...value,
      confirmationKind: "story-declaration" as const,
      queryKey: "storyDeclarationId",
      label: "来源节点",
      bound: Boolean(value.adoptedNode),
    })),
    ...(input.storyAssertions ?? []).map((value) => ({
      ...value,
      confirmationKind: "story-assertion" as const,
      queryKey: "storyAssertionId",
      label: value.kind === "relationship" ? "来源关系" : "来源认知",
      bound: Boolean(value.adoptedRecord),
    })),
  ];
  for (const value of declarations) {
    if (value.lifecycle && value.lifecycle.state !== "active") continue;
    if (!input.projects.some((project) => project.id === value.projectId))
      continue;
    const attention = value.sourceStatus.state !== "current";
    const adopted = value.status === "adopted" && value.bound;
    if (value.status !== "pending" && !(adopted && attention)) continue;
    items.push({
      key: `${value.confirmationKind}:${value.id}`,
      kind: value.confirmationKind,
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: `${adopted ? "已采用" : ""}${value.label}${adopted ? "复核" : "候选"} · ${value.title}`,
      category: attention ? "attention" : "waiting",
      status:
        value.sourceStatus.state === "unavailable"
          ? "原来源无法核对"
          : attention
            ? "原来源已变化"
            : "等待独立双重审阅",
      detail: `声明 v${value.version} · ${value.sourceStatus.reasons.length} 项来源核对提示；返回原记录核对原文与作者解释，不展示冻结正文、不自动审阅、采用或更换声明。`,
      updatedAt: value.updatedAt,
      to: route("/create", {
        projectId: value.projectId,
        [value.queryKey]: value.id,
      }),
    });
  }
  for (const value of input.narrativeSummaries ?? []) {
    if (!input.projects.some((project) => project.id === value.projectId))
      continue;
    const linked = input.workflows.find(
      (workflow) =>
        workflow.id === value.workflowId &&
        workflow.input.projectId === value.projectId &&
        workflow.input.operation === "narrative-summary" &&
        workflow.narrativeSummaryId === value.id,
    );
    if (linked) representedTasks.add(linked.taskId);
    const candidate = value.status === "awaiting-review";
    const staleHead =
      value.status === "adopted" &&
      value.isHead &&
      (value.sourceState === "stale" ||
        value.contextEligibility.state === "ineligible");
    if (!candidate && !staleHead) continue;
    const attention = value.sourceState === "stale" || staleHead;
    items.push({
      key: `narrative-summary:${value.id}`,
      kind: "creation",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: candidate ? "分层摘要候选" : "已采用分层摘要范围与来源复核",
      status: candidate
        ? attention
          ? "摘要来源已变化"
          : "等待审阅采用摘要"
        : value.contextEligibility.state === "eligible"
          ? "完整范围已变化，原冻结范围仍可使用"
          : "冻结摘要来源不可用，需复核",
      category: attention ? "attention" : "waiting",
      detail: `摘要 v${value.version} · ${value.coveredChapterCount} 章冻结范围 · ${value.staleReasonCount} 项范围／来源变化；不复制摘要或引文，不自动扩展范围或重新采用。`,
      updatedAt: value.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(value.projectId)}/tools/quality-review`,
        {
          summaryId: value.id,
          summaryWorkflowId: value.workflowId,
        },
      ),
    });
  }
  for (const value of input.episodeResults ?? []) {
    if (
      !input.projects.some((project) => project.id === value.projectId) ||
      !value.isCurrent ||
      value.sourceState !== "stale"
    )
      continue;
    const linked = input.workflows.find(
      (workflow) =>
        workflow.id === value.workflowId &&
        workflow.input.projectId === value.projectId &&
        workflow.input.operation === value.operation &&
        workflow.episodeResultId === value.id,
    );
    if (linked) representedTasks.add(linked.taskId);
    items.push({
      key: `episode-result:${value.id}`,
      kind: "creation",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: `正式${CREATION_NAMES[value.operation]}来源复核`,
      status: "已采用单集来源已变化，保留正式快照",
      category: "attention",
      detail: `正式 v${value.version} · ${value.staleReasonCount} 项来源变化 · ${value.origin === "human-script-revision" || value.origin === "human-topology-revision" || value.origin === "human-source-revision" ? "人工确认版本，无模型工作流" : "模型候选明确采用版本"}；不复制剧本、镜头或提示，不自动重做或采用。`,
      updatedAt: value.adoptedAt,
      to: route(
        `/projects/${encodeURIComponent(value.projectId)}/tools/episode-development`,
        {
          resultId: value.id,
          episodeId: value.episodeId,
          operation: value.operation,
        },
      ),
    });
  }
  for (const value of input.mediaSourceReviews ?? []) {
    if (value.state !== "pending") continue;
    const attention = value.sourceState === "stale";
    items.push({
      key: `media-source-review:${value.id}`,
      kind: "media-source-review",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: "素材来源复核",
      status: attention ? "素材或镜头来源已变化" : "等待逐项复核来源",
      category: attention ? "attention" : "waiting",
      detail: `素材 v${value.recordVersion} · 镜头 v${value.shotVersion} · ${value.reasonCount} 项来源变化；不复制素材内容，来源复核不等于采用素材。`,
      updatedAt: value.updatedAt,
      to: route("/produce", {
        projectId: value.projectId,
        mediaSourceReviewId: value.id,
        recordId: value.recordId,
      }),
    });
  }
  for (const value of input.audioRevisions ?? []) {
    const candidate = value.state === "pending";
    const draft =
      value.state === "confirmed" &&
      value.isCurrent &&
      (value.targetStatus === "draft" || value.targetStatus === "missing");
    if (!candidate && !draft) continue;
    const attention =
      value.sourceState === "stale" || value.targetStatus === "missing";
    items.push({
      key: `audio-revision:${value.id}`,
      kind: "audio-revision",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: draft ? "音轨修订新草稿待采用" : "人工音轨修订",
      status: attention
        ? "音轨或实际来源已变化"
        : draft
          ? "已确认差异，仍需另行采用新草稿"
          : "等待确认新旧差异",
      category: attention ? "attention" : "waiting",
      detail: `原轨 v${value.originalVersion} · 候选 ${value.candidateClipCount} 段 · 映射 ${value.mappedCount}、删除 ${value.removedCount}、新增 ${value.addedCount}；不复制文本／音频，不自动换时间线来源。`,
      updatedAt: value.updatedAt,
      to: route("/produce", {
        projectId: value.projectId,
        episodeId: value.episodeId,
        audioRevisionId: value.id,
        sourceTrackId: value.sourceTrackId,
      }),
    });
  }
  for (const value of input.audioResolutions ?? []) {
    if (value.state !== "pending") continue;
    const attention = value.sourceState === "stale";
    items.push({
      key: `audio-resolution:${value.id}`,
      kind: "audio-resolution",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: "人工时间线换源／移除",
      status: attention ? "时间线或实际来源已变化" : "等待确认具体片段改动",
      category: attention ? "attention" : "waiting",
      detail: `时间线 v${value.timelineVersion} · 替换 ${value.replaceCount}、移除 ${value.removeCount} · ${value.protectedCount} 项人工／锁定片段；不复制字幕或素材，不自动采用新轨。`,
      updatedAt: value.updatedAt,
      to: route("/produce", {
        projectId: value.projectId,
        episodeId: value.episodeId,
        audioResolutionId: value.id,
        timelineId: value.timelineId,
      }),
    });
  }
  for (const revision of input.sourceRevisions ?? []) {
    if (revision.status !== "pending") continue;
    items.push({
      key: `author-source-revision:${revision.id}`,
      kind: "author-source-revision",
      objectId: revision.id,
      projectId: revision.projectId,
      projectTitle: title(revision.projectId),
      title: "上游新来源双正式确认",
      status:
        revision.sourceState === "stale"
          ? "本次来源或实际原稿已变化"
          : "等待五项独立审阅与新来源采用",
      category: revision.sourceState === "stale" ? "attention" : "waiting",
      detail: `实际文档 v${revision.document.version} · 原大纲 v${revision.sourceOutline.version}、剧本 v${revision.sourceScript.version}；保留原稿与旧采用，不读取正文或私人理由，不自动重做分镜。`,
      updatedAt: revision.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(revision.projectId)}/tools/episode-development`,
        {
          episodeId: revision.episodeId,
          operation: "episode-script",
          resultId: revision.sourceScript.id,
          sourceRevisionId: revision.id,
        },
      ),
    });
  }
  for (const revision of input.topologyRevisions ?? []) {
    if (revision.status !== "pending") continue;
    items.push({
      key: `author-topology-revision:${revision.id}`,
      kind: "author-topology-revision",
      objectId: revision.id,
      projectId: revision.projectId,
      projectTitle: title(revision.projectId),
      title: "作者场景拓扑双正式确认",
      status:
        revision.sourceState === "stale"
          ? "实际文档或正式来源已变化"
          : "等待作者确认新大纲与剧本",
      category: revision.sourceState === "stale" ? "attention" : "waiting",
      detail: `实际文档 v${revision.document.version} · 原大纲 v${revision.sourceOutline.version}、剧本 v${revision.sourceScript.version}；两份正式版本一起提交，无模型运行，不自动重做分镜。`,
      updatedAt: revision.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(revision.projectId)}/tools/episode-development`,
        {
          episodeId: revision.episodeId,
          operation: "episode-script",
          resultId: revision.sourceScript.id,
          topologyRevisionId: revision.id,
        },
      ),
    });
  }
  for (const revision of input.scriptRevisions ?? []) {
    if (revision.status !== "pending") continue;
    items.push({
      key: `author-script-revision:${revision.id}`,
      kind: "author-script-revision",
      objectId: revision.id,
      projectId: revision.projectId,
      projectTitle: title(revision.projectId),
      title: "人工标准剧本修订",
      status:
        revision.sourceState === "stale"
          ? "实际文档或正式来源已变化"
          : "等待作者确认正式版本",
      category: revision.sourceState === "stale" ? "attention" : "waiting",
      detail: `实际文档 v${revision.document.version} · 原正式剧本 v${revision.sourceResult.version}；无模型运行，不自动重做分镜。`,
      updatedAt: revision.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(revision.projectId)}/tools/episode-development`,
        {
          episodeId: revision.episodeId,
          operation: "episode-script",
          scriptRevisionId: revision.id,
        },
      ),
    });
  }
  for (const intent of input.authorIntents ?? []) {
    if (!["pending", "conflicted"].includes(intent.status)) continue;
    const attention =
      intent.status === "conflicted" || intent.sourceState === "stale";
    items.push({
      key: `author-intent:${intent.id}`,
      kind: "author-intent",
      objectId: intent.id,
      projectId: intent.projectId,
      projectTitle: title(intent.projectId),
      title: "作者意图候选",
      status: attention ? "意图来源或正式版本已变化" : "等待审阅采用",
      category: attention ? "attention" : "waiting",
      detail: `意图 v${intent.version} · 项目来源 v${intent.sourceProjectVersion}；旧字段与候选不等于正式采用。`,
      updatedAt: intent.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(intent.projectId)}/tools/author-intent`,
        { intentId: intent.id, intentWorkflowId: intent.workflowId },
      ),
    });
  }
  for (const value of input.localReviews ?? []) {
    if (!input.projects.some((project) => project.id === value.projectId))
      continue;
    const candidate = value.status === "awaiting-review";
    // A new clean head does not erase older known adopted issues. Unknown
    // source validity must remain visible, not become an empty success.
    const needsReview =
      value.status === "adopted" &&
      (value.openIssueCount > 0 ||
        (value.isCurrent && value.sourceState !== "current"));
    if (!candidate && !needsReview) continue;
    const origin = value.origin === "human-declared" ? "人工声明" : "逐字规则";
    items.push({
      key: `narrative-local-review:${value.id}`,
      kind: "narrative-local-review",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: `${origin}${candidate ? "评议候选" : "评议问题与复核"}`,
      status:
        value.sourceState === "unverified"
          ? "原来源无法核对，质量未认证"
          : value.sourceState === "stale"
            ? "原来源已变化，需要复核"
            : candidate
              ? "等待独立审阅，质量未认证"
              : "本地评议问题待处理，质量未认证",
      category:
        !candidate || value.sourceState !== "current" ? "attention" : "waiting",
      detail: `目标 v${value.request.target.version} · 本地评议 v${value.version} · ${value.openIssueCount} 项待处理、${value.blockerCount} 项错误、${value.acceptedRiskCount} 项明确接受风险；无模型运行，不复制正文、引文或备注，不自动修正文。`,
      updatedAt: value.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(value.projectId)}/tools/quality-review`,
        { localReviewId: value.id },
      ),
    });
  }
  for (const report of input.narrativeReports ?? []) {
    const candidate = report.status === "awaiting-review";
    const staleHead =
      report.status === "adopted" &&
      report.isCurrent &&
      report.sourceState === "stale";
    const unresolved =
      report.status === "adopted" &&
      report.sourceState === "current" &&
      report.openIssueCount > 0;
    if (!candidate && !staleHead && !unresolved) continue;
    const linked = input.workflows.find(
      (workflow) =>
        workflow.input.operation === "quality-review" &&
        workflow.id === report.workflowId &&
        workflow.narrativeReportId === report.id &&
        workflow.input.projectId === report.projectId,
    );
    if (linked) representedTasks.add(linked.taskId);
    const attention = report.sourceState === "stale" || !candidate;
    items.push({
      key: `narrative-report:${report.id}`,
      kind: "creation",
      objectId: report.id,
      projectId: report.projectId,
      projectTitle: title(report.projectId),
      title: candidate ? "质量报告候选" : "质量问题与复检",
      status:
        report.sourceState === "stale"
          ? "报告来源已变化，需要复检"
          : candidate
            ? "等待审阅采用报告"
            : "质量问题待处理",
      category: attention ? "attention" : "waiting",
      detail: `目标 v${report.request.target.version} · 报告 v${report.version} · ${report.openIssueCount} 项待处理、${report.blockerCount} 项错误、${report.acceptedRiskCount} 项明确接受风险；不复制引文或备注，不自动修正文。`,
      updatedAt: report.updatedAt,
      to: route(`/projects/${report.projectId}/tools/quality-review`, {
        reportId: report.id,
        workflowId: report.workflowId,
      }),
    });
  }
  for (const workflow of input.workflows) {
    if (
      workflow.input.operation === "narrative-summary" &&
      ["awaiting-review", "applied", "discarded"].includes(workflow.stage) &&
      input.narrativeSummaries?.some(
        (item) =>
          item.id === workflow.narrativeSummaryId &&
          item.workflowId === workflow.id &&
          item.projectId === workflow.input.projectId,
      )
    ) {
      representedTasks.add(workflow.taskId);
      continue;
    }
    if (workflow.input.operation === "adaptation-strategy") {
      const strategy = input.adaptationStrategies?.find(
        (item) =>
          item.id === workflow.adaptationStrategyId &&
          item.workflowId === workflow.id &&
          item.projectId === workflow.input.projectId,
      );
      if (
        strategy &&
        ["awaiting-review", "applied", "discarded"].includes(workflow.stage)
      ) {
        representedTasks.add(workflow.taskId);
        if (["pending", "conflicted"].includes(strategy.status))
          items.push({
            key: `adaptation-strategy:${strategy.id}`,
            kind: "creation",
            objectId: strategy.id,
            projectId: strategy.projectId,
            projectTitle: title(strategy.projectId),
            title: `独立策略 v${strategy.version}`,
            status:
              strategy.sourceState === "stale" ||
              strategy.status === "conflicted"
                ? "策略来源冲突"
                : "等待明确选择一个策略",
            category:
              strategy.sourceState === "stale" ||
              strategy.status === "conflicted"
                ? "attention"
                : "waiting",
            detail:
              "比较原候选的 2–3 个叙事动作；不复制内容、不默认选择或生成季纲。",
            updatedAt: strategy.updatedAt,
            to: route(
              `/projects/${strategy.projectId}/tools/adaptation-strategy`,
              { workflowId: workflow.id, strategyId: strategy.id },
            ),
          });
        continue;
      }
    }
    if (
      workflow.input.operation === "author-intent" &&
      input.authorIntents?.some(
        (intent) =>
          intent.id === workflow.authorIntentId &&
          intent.workflowId === workflow.id &&
          intent.projectId === workflow.input.projectId,
      )
    ) {
      representedTasks.add(workflow.taskId);
      continue;
    }
    if (
      workflow.input.operation === "quality-review" &&
      input.narrativeReports?.some(
        (report) =>
          report.id === workflow.narrativeReportId &&
          report.workflowId === workflow.id &&
          report.projectId === workflow.input.projectId,
      )
    ) {
      representedTasks.add(workflow.taskId);
      continue;
    }
    if (workflow.input.operation === "season-plan") {
      const plans = (input.seasonPlans ?? []).filter(
        (item) =>
          item.projectId === workflow.input.projectId &&
          item.workflowId === workflow.id,
      );
      const linked = new Set(
        plans
          .filter((item) => item.id === workflow.seasonPlanId)
          .map((item) => item.id),
      );
      // Follow actual parent links in both directions. A fabricated/unrelated
      // summary must not acquire this workflow merely by sharing its id.
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of plans) {
          if (
            linked.has(item.id) &&
            item.sourcePlanId &&
            plans.some((parent) => parent.id === item.sourcePlanId) &&
            !linked.has(item.sourcePlanId)
          ) {
            linked.add(item.sourcePlanId);
            changed = true;
          }
          if (
            item.sourcePlanId &&
            linked.has(item.sourcePlanId) &&
            !linked.has(item.id)
          ) {
            linked.add(item.id);
            changed = true;
          }
        }
      }
      if (
        linked.size &&
        ["awaiting-review", "applied", "discarded"].includes(workflow.stage)
      ) {
        representedTasks.add(workflow.taskId);
        for (const plan of plans.filter(
          (item) =>
            linked.has(item.id) &&
            ["pending", "conflicted"].includes(item.status),
        )) {
          const attention =
            plan.status === "conflicted" || plan.sourceState === "stale";
          items.push({
            key: `season-plan:${plan.id}`,
            kind: "creation",
            objectId: plan.id,
            projectId: plan.projectId,
            projectTitle: title(plan.projectId),
            title: `整季方案 v${plan.version}${plan.origin === "human-reorder" ? " · 人工重排" : ""}`,
            status: attention ? "季纲来源冲突" : "等待审阅采用",
            category: attention ? "attention" : "waiting",
            detail: "核对本版本的真实来源覆盖与完整顺序；候选不等于正式采用。",
            updatedAt: plan.updatedAt,
            to: route(`/projects/${plan.projectId}/tools/season-plan`, {
              workflowId: workflow.id,
              seasonPlanId: plan.id,
            }),
          });
        }
        continue;
      }
    }
    const diagnosis = input.diagnoses?.find(
      (item) =>
        item.workflowId === workflow.id &&
        item.projectId === workflow.input.projectId &&
        item.id === workflow.diagnosisId,
    );
    if (diagnosis && ["adopted", "discarded"].includes(diagnosis.status)) {
      representedTasks.add(workflow.taskId);
      continue;
    }
    let category: ConfirmationCategory;
    let status: string;
    if (workflow.stage === "awaiting-review") {
      const stale =
        diagnosis &&
        (diagnosis.sourceState === "stale" ||
          diagnosis.status === "conflicted");
      category = stale ? "attention" : "waiting";
      status = stale ? "诊断来源冲突" : "等待审阅采用";
    } else if (["failed", "interrupted"].includes(workflow.stage)) {
      if (
        input.tasks.some(
          (task) =>
            task.id === workflow.taskId &&
            task.attentionStatus === "acknowledged",
        )
      )
        continue;
      category = "attention";
      status = workflow.stage === "failed" ? "需要处理" : "运行已中断";
    } else if (
      [
        "preparing",
        "generating",
        "checking",
        "revising",
        "rechecking",
      ].includes(workflow.stage)
    ) {
      category = "running";
      status = "创作运行中";
    } else continue;
    representedTasks.add(workflow.taskId);
    const blockers = workflow.issues.filter(
      (issue) => issue.severity === "error",
    );
    items.push({
      key: `creation:${workflow.id}`,
      kind: "creation",
      objectId: workflow.id,
      projectId: workflow.input.projectId,
      projectTitle: title(workflow.input.projectId),
      title: CREATION_NAMES[workflow.input.operation],
      status,
      category,
      detail: `${workflow.input.targetId ? "已绑定实际目标" : "项目级方案"} · 工作流 v${workflow.version}${blockers.length ? ` · ${blockers.length} 项检查错误需复核` : ""}；候选不等于正式采用。`,
      updatedAt: workflow.updatedAt,
      to:
        workflow.input.operation === "author-intent"
          ? route(`/projects/${workflow.input.projectId}/tools/author-intent`, {
              intentWorkflowId: workflow.id,
              intentId: workflow.authorIntentId,
            })
          : workflow.input.operation === "narrative-summary"
            ? route(
                `/projects/${workflow.input.projectId}/tools/quality-review`,
                {
                  summaryWorkflowId: workflow.id,
                  summaryId: workflow.narrativeSummaryId,
                },
              )
            : workflow.input.operation === "quality-review"
              ? route(
                  `/projects/${workflow.input.projectId}/tools/quality-review`,
                  {
                    workflowId: workflow.id,
                    reportId: workflow.narrativeReportId,
                  },
                )
              : [
                    "episode-outline",
                    "episode-script",
                    "storyboard-package",
                  ].includes(workflow.input.operation)
                ? route(
                    `/projects/${workflow.input.projectId}/tools/episode-development`,
                    {
                      workflowId: workflow.id,
                      operation: workflow.input.operation,
                      episodeId:
                        workflow.input.episodeDevelopmentRequest?.episodeId,
                    },
                  )
                : workflow.input.operation === "season-plan"
                  ? route(
                      `/projects/${workflow.input.projectId}/tools/season-plan`,
                      {
                        workflowId: workflow.id,
                        seasonPlanId: workflow.seasonPlanId,
                      },
                    )
                  : workflow.input.operation === "adaptation-strategy"
                    ? route(
                        `/projects/${workflow.input.projectId}/tools/adaptation-strategy`,
                        {
                          workflowId: workflow.id,
                          strategyId: workflow.adaptationStrategyId,
                        },
                      )
                    : workflow.input.operation === "adaptation-diagnosis"
                      ? route(
                          `/projects/${workflow.input.projectId}/tools/adaptation-diagnosis`,
                          {
                            workflowId: workflow.id,
                            diagnosisId: workflow.diagnosisId,
                          },
                        )
                      : route("/tasks", {
                          projectId: workflow.input.projectId,
                          workflowId: workflow.id,
                          taskId: workflow.taskId,
                        }),
    });
  }
  for (const change of input.storyBible) {
    if (["applied", "discarded", "skipped"].includes(change.status)) continue;
    const sourceChanged =
      change.sourceState === "stale" || change.sourceState === "missing";
    const category = sourceChanged
      ? "attention"
      : change.status === "queued"
        ? "running"
        : ["stale", "failed"].includes(change.status)
          ? "attention"
          : "waiting";
    if (change.taskId) representedTasks.add(change.taskId);
    items.push({
      key: `story-bible:${change.id}`,
      kind: "story-bible",
      objectId: change.id,
      projectId: change.projectId,
      projectTitle: title(change.projectId),
      title: "Story Bible 变更",
      status:
        change.sourceState === "missing"
          ? "来源章节不可用"
          : change.sourceState === "stale"
            ? "来源版本已变化"
            : category === "attention"
              ? "来源或变更需要复核"
              : category === "running"
                ? "排队整理"
                : change.status === "paused"
                  ? "已暂停，等待决定"
                  : "等待审阅采用",
      category,
      detail: `章节来源 v${change.sourceVersion}；采用前不写入正式记忆。`,
      updatedAt: change.updatedAt,
      to: route("/create", {
        projectId: change.projectId,
        chapterId: change.chapterId,
        changeSetId: change.id,
      }),
    });
  }
  for (const change of input.imports) {
    if (change.status === "discarded") continue;
    const draftCount = change.candidates.filter(
      (item) => item.status === "draft",
    ).length;
    const conflicts = change.candidates.some(
      (item) => item.status === "conflict",
    );
    const attention = ["stale", "failed"].includes(change.status) || conflicts;
    if (!attention && !draftCount) continue;
    items.push({
      key: `import:${change.id}`,
      kind: "import",
      objectId: change.id,
      projectId: change.projectId,
      projectTitle: title(change.projectId),
      title: "导入资料候选",
      status: attention ? "来源或候选需要复核" : "等待审阅采用",
      category: attention ? "attention" : "waiting",
      detail: `${draftCount} 条候选尚未采用；部分采用不等于全部完成。`,
      updatedAt: change.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(change.projectId)}/tools/review`,
        {
          extractionId: change.id,
        },
      ),
    });
  }
  for (const manuscript of input.manuscripts) {
    // Canceled/saved records are historical facts, not new pending decisions.
    if (["saved", "canceled"].includes(manuscript.status)) continue;
    const category =
      manuscript.sourceState === "stale" || manuscript.status === "failed"
        ? "attention"
        : manuscript.status === "saving"
          ? "running"
          : "waiting";
    items.push({
      key: `manuscript:${manuscript.id}`,
      kind: "manuscript",
      objectId: manuscript.id,
      projectId: manuscript.manifest.projectId,
      projectTitle: title(manuscript.manifest.projectId),
      title: "稿件范围与权利确认",
      status:
        manuscript.sourceState === "stale"
          ? "来源版本已变化"
          : manuscript.status === "failed"
            ? "保存未核验成功"
            : manuscript.status === "saving"
              ? "保存中或等待核验"
              : "范围与权利待确认",
      category,
      detail: `${manuscript.manifest.scope === "whole-project" ? "完整稿件" : "所选范围"} · ${manuscript.manifest.chapters.length} 章 · ${manuscript.manifest.format.toUpperCase()}；作者声明不等于授权证明。`,
      updatedAt: manuscript.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(manuscript.manifest.projectId)}`,
        {
          manuscriptId: manuscript.id,
        },
      ),
    });
  }
  for (const preview of input.revisions ?? []) {
    if (!["pending", "conflicted"].includes(preview.status)) continue;
    for (const task of input.tasks) {
      const result =
        task.result && typeof task.result === "object"
          ? (task.result as Record<string, unknown>)
          : {};
      const embedded = result.revisionPreview;
      if (
        embedded &&
        typeof embedded === "object" &&
        (embedded as Record<string, unknown>).id === preview.id
      )
        representedTasks.add(task.id);
    }
    items.push({
      key: `revision:${preview.id}`,
      kind: "revision",
      objectId: preview.id,
      projectId: preview.projectId,
      projectTitle: title(preview.projectId),
      title: "章节修订候选",
      status: preview.status === "conflicted" ? "来源版本冲突" : "等待审阅采用",
      category: preview.status === "conflicted" ? "attention" : "waiting",
      detail: `章节来源 v${preview.baseVersion}；旧修订候选保留独立的采用与放弃记录。`,
      updatedAt: preview.committedAt ?? preview.createdAt,
      to: route("/tasks", {
        projectId: preview.projectId,
        revisionId: preview.id,
      }),
    });
  }
  for (const task of input.tasks) {
    if (representedTasks.has(task.id)) continue;
    const resultPointer =
      task.result &&
      typeof task.result === "object" &&
      !Array.isArray(task.result)
        ? (task.result as Record<string, unknown>)
        : {};
    const embedded = resultPointer.providerActionPreview;
    const embeddedId =
      embedded && typeof embedded === "object" && !Array.isArray(embedded)
        ? (embedded as Record<string, unknown>).id
        : undefined;
    const previewId =
      resultPointer.providerActionPreviewId ??
      (embedded && typeof embedded === "object" && !Array.isArray(embedded)
        ? (embedded as Record<string, unknown>).id
        : undefined);
    if (
      typeof previewId === "string" &&
      (embeddedId === undefined || embeddedId === previewId) &&
      input.providerActions?.some(
        (value) =>
          value.id === previewId &&
          value.projectId === task.projectId &&
          (value.status === "executed" ||
            !value.taskId ||
            value.taskId === task.id),
      ) &&
      task.resultStatus === "pending"
    )
      continue;
    let category: ConfirmationCategory;
    if (task.resultStatus === "pending") category = "waiting";
    else if (["queued", "running"].includes(task.status)) category = "running";
    else if (
      task.resultStatus === "conflicted" ||
      (["failed", "interrupted"].includes(task.status) &&
        task.attentionStatus === "open")
    )
      category = "attention";
    else continue;
    const result =
      task.result &&
      typeof task.result === "object" &&
      !Array.isArray(task.result)
        ? (task.result as Record<string, unknown>)
        : {};
    const provider =
      typeof result.providerActionPreviewId === "string" ||
      (result.providerActionPreview !== null &&
        typeof result.providerActionPreview === "object");
    items.push({
      key: `task:${task.id}`,
      kind: "task",
      objectId: task.id,
      projectId: task.projectId,
      projectTitle: title(task.projectId),
      title: task.title,
      status:
        category === "waiting"
          ? provider
            ? "费用与外部调用待确认"
            : "等待审阅采用"
          : category === "running"
            ? "任务进行中"
            : "需要处理",
      category,
      detail: provider
        ? "返回实际调用预览核对 Provider、费用与权利；打开列表不会执行外部调用。"
        : "执行状态与正式采用分别记录；任务成功不等于内容已采用。",
      updatedAt: task.updatedAt,
      to: route("/tasks", {
        projectId: task.projectId,
        taskId: task.id,
        scope: task.projectId ? undefined : "all",
      }),
    });
  }
  for (const preview of input.providerActions ?? []) {
    if (preview.status !== "pending") continue;
    const estimate = providerEstimate(preview);
    items.push({
      key: `provider-action:${preview.id}`,
      kind: "provider-action",
      objectId: preview.id,
      projectId: preview.projectId,
      projectTitle: title(preview.projectId),
      title: "费用与外部调用确认",
      status: estimate.known
        ? providerReviewStatusLabel(preview.status)
        : "预估费用或币种未知，调用已阻断",
      category: estimate.known ? "waiting" : "attention",
      detail: `${estimate.label}；预估不是账单、内容采用不是费用或权利授权。列表不读取参数、不执行调用，返回原预览另行确认。`,
      updatedAt: preview.createdAt,
      to: route("/pending", {
        projectId: preview.projectId,
        providerActionPreviewId: preview.id,
        category: estimate.known ? "waiting" : "attention",
      }),
    });
  }
  for (const record of input.pilotPackages ?? []) {
    if (record.status === "saved" || record.status === "canceled") continue;
    const attention =
      record.sourceState !== "current" || record.status === "failed";
    items.push({
      key: `pilot-package:${record.id}`,
      kind: "pilot-package",
      objectId: record.id,
      projectId: record.manifest.projectId,
      projectTitle: title(record.manifest.projectId),
      title: "内部试制包范围与权利确认",
      status: attention
        ? "来源或保存结果需要复核"
        : record.status === "saving"
          ? "保存中或等待核验"
          : "范围与权利待确认",
      category: attention
        ? "attention"
        : record.status === "saving"
          ? "running"
          : "waiting",
      detail: `分镜 v${record.manifest.adopted.storyboard.version} · ZIP；范围和作者声明不等于授权证明、实际费用或发行就绪。打开列表不保存文件。`,
      updatedAt: record.updatedAt,
      to: route(
        `/projects/${encodeURIComponent(record.manifest.projectId)}/tools/episode-development`,
        {
          episodeId: record.manifest.episodeId,
          operation: "storyboard-package",
          pilotPackageId: record.id,
        },
      ),
    });
  }
  return [...new Map(items.map((item) => [item.key, item])).values()].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.key.localeCompare(right.key),
  );
}

async function pages<T>(
  readPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
) {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await readPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("待确认资料分页未完成。");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return items;
}

// Owner SDKs validate each page; this also validates the complete scan. A
// repeated record (even with a different version) is not a coherent full list.
// Reject the whole affected source rather than retaining its earlier pages.
async function declarationPages<T extends { id: string; projectId: string }>(
  projectId: string,
  readPage: (cursor?: string) => Promise<{
    projectId: string;
    items: T[];
    nextCursor?: string;
  }>,
  validAdoption: (item: T) => boolean,
) {
  const identities = new Set<string>();
  return pages(async (cursor) => {
    const page = await readPage(cursor);
    if (
      page.projectId !== projectId ||
      (page.nextCursor && page.nextCursor !== page.items.at(-1)?.id) ||
      page.items.some((item) => {
        if (
          item.projectId !== projectId ||
          identities.has(item.id) ||
          !validAdoption(item)
        )
          return true;
        identities.add(item.id);
        return false;
      })
    )
      throw new Error("来源声明归属、采用记录或完整分页无法核对。");
    return page;
  });
}

export async function loadConfirmations(
  client: ConfirmationClient,
  projectId?: string,
): Promise<ConfirmationEvidence> {
  const projects = await client.projects.list();
  if (projectId && !projects.some((project) => project.id === projectId))
    throw new Error("指定项目已不存在，不能显示为没有待确认项。");
  const selected = projectId
    ? projects.filter((project) => project.id === projectId)
    : projects;
  const unavailable: ConfirmationEvidence["unavailable"] = [];
  async function read<T>(
    source: string,
    id: string | undefined,
    readSource: () => Promise<T[]>,
  ): Promise<T[]> {
    try {
      return await readSource();
    } catch {
      unavailable.push({ source, ...(id ? { projectId: id } : {}) });
      return [];
    }
  }
  // The existing route returns all tasks, including acknowledged failures.
  const tasks = await read("任务", projectId, () => client.tasks.list());
  const workflows: CreationWorkflow[] = [];
  const storyBible: StoryBibleChangeSet[] = [];
  const imports: ImportExtractionChangeSet[] = [];
  const manuscripts: ManuscriptRecord[] = [];
  const providerActions: ProviderActionPreviewSummary[] = [];
  const pilotPackages: PilotPackageRecord[] = [];
  const revisions: Array<RevisionPreviewSummary & { projectId: string }> = [];
  const authorIntents: AuthorIntentSummary[] = [];
  const diagnoses: DiagnosisSummary[] = [];
  const seasonPlans: SeasonPlanSummary[] = [];
  const adaptationStrategies: AdaptationStrategySummary[] = [];
  const narrativeReports: NarrativeQualitySummary[] = [];
  const localReviews: NarrativeLocalQualitySummary[] = [];
  const scriptRevisions: EpisodeScriptRevisionSummary[] = [];
  const topologyRevisions: EpisodeTopologyRevisionSummary[] = [];
  const sourceRevisions: EpisodeSourceRevisionSummary[] = [];
  const narrativeSummaries: NarrativeSummaryStatus[] = [];
  const episodeResults: EpisodeDevelopmentSummary[] = [];
  const mediaSourceReviews: MediaSourceReviewSummary[] = [];
  const audioRevisions: AudioRevisionSummary[] = [];
  const audioResolutions: AudioResolutionSummary[] = [];
  const storyDeclarations: SourceNodeSummary[] = [];
  const storyAssertions: SourceAssertionSummary[] = [];
  // Bound parallel requests across a large project library, without truncating it.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, selected.length) }, async () => {
      while (next < selected.length) {
        const project = selected[next++]!;
        const [runs, changes, extractions, records, oldRevisions, intents] =
          await Promise.all([
            read("创作候选", project.id, () =>
              pages((cursor) =>
                client.creation.list(project.id, undefined, cursor),
              ),
            ),
            read("Story Bible", project.id, () =>
              client.storyBible.list(project.id),
            ),
            read("导入候选", project.id, () =>
              client.importExtractions.list(project.id),
            ),
            read("稿件确认", project.id, () =>
              pages((cursor) => client.manuscripts.list(project.id, cursor)),
            ),
            read("章节修订候选", project.id, () =>
              pages((cursor) => client.revisions.list(project.id, cursor)),
            ),
            read("作者意图", project.id, () =>
              pages((cursor) => client.authorIntents.list(project.id, cursor)),
            ),
          ]);
        workflows.push(
          ...runs.filter((run) => run.input.projectId === project.id),
        );
        providerActions.push(
          ...(await read("费用与外部调用确认", project.id, () => {
            if (!client.providerActionPreviews)
              throw new Error("费用确认摘要能力不可用。");
            return declarationPages(
              project.id,
              async (cursor) =>
                ProviderActionPreviewSummaryPageSchema.parse(
                  await client.providerActionPreviews!.summaries(
                    project.id,
                    cursor,
                    100,
                  ),
                ),
              () => true,
            );
          })),
        );
        pilotPackages.push(
          ...(await read("内部试制包权利确认", project.id, async () => {
            if (!client.pilotPackages)
              throw new Error("试制包元数据能力不可用。");
            const seen = new Set<string>();
            return pages(async (cursor) => {
              const page = await client.pilotPackages!.list(
                project.id,
                cursor,
                100,
              );
              if (
                (page.nextCursor &&
                  page.nextCursor !== page.items.at(-1)?.id) ||
                page.items.some((value) => {
                  if (
                    value.manifest.projectId !== project.id ||
                    seen.has(value.id)
                  )
                    return true;
                  seen.add(value.id);
                  return false;
                })
              )
                throw new Error("试制包归属、完整分页或重复身份不符。");
              return page;
            });
          })),
        );
        // These are independent author candidates, not model-run projections.
        // Only request owner list metadata; never fetch the frozen detail here.
        const [sourceNodes, sourceAssertions] = await Promise.all([
          read("原文来源节点声明", project.id, () => {
            if (!client.storyDeclarations)
              throw new Error("来源节点声明能力不可用。");
            return declarationPages(
              project.id,
              (cursor) =>
                client.storyDeclarations!.list(project.id, {
                  cursor,
                  limit: 100,
                }),
              (item) =>
                (item.status === "adopted") === Boolean(item.adoptedNode),
            );
          }),
          read("原文来源关系与认知声明", project.id, () => {
            if (!client.storyAssertions)
              throw new Error("来源关系与认知声明能力不可用。");
            return declarationPages(
              project.id,
              (cursor) =>
                client.storyAssertions!.list(project.id, {
                  cursor,
                  limit: 100,
                }),
              (item) =>
                (item.status === "adopted") === Boolean(item.adoptedRecord) &&
                (!item.adoptedRecord ||
                  item.adoptedRecord.kind ===
                    (item.kind === "relationship" ? "edge" : "cognition")),
            );
          }),
        ]);
        storyDeclarations.push(...sourceNodes);
        storyAssertions.push(...sourceAssertions);
        // Read owner projections for every project, even with no model runs:
        // adopted summaries and human formal scripts must not disappear.
        const [summaryStates, episodeStates] = await Promise.all([
          read("分层摘要范围与来源", project.id, () => {
            if (!client.narrativeSummaries)
              throw new Error("摘要状态能力不可用。");
            return pages((cursor) =>
              client.narrativeSummaries!.summaries(project.id, cursor, 100),
            );
          }),
          read("正式单集来源", project.id, () => {
            if (!client.episodeDevelopments?.summaries)
              throw new Error("单集状态能力不可用。");
            return pages((cursor) =>
              client.episodeDevelopments!.summaries!(project.id, cursor, 100),
            );
          }),
        ]);
        narrativeSummaries.push(
          ...summaryStates.filter((value) => value.projectId === project.id),
        );
        episodeResults.push(
          ...episodeStates.filter((value) => value.projectId === project.id),
        );
        const [media, audio, timeline] = await Promise.all([
          read("素材来源复核", project.id, () => {
            if (!client.mediaSources)
              throw new Error("素材来源摘要能力不可用。");
            return pages((cursor) =>
              client.mediaSources!.summaries(project.id, cursor, 100),
            );
          }),
          read("音轨修订与新草稿", project.id, () => {
            if (!client.audioRevisions)
              throw new Error("音轨修订摘要能力不可用。");
            return pages((cursor) =>
              client.audioRevisions!.summaries(project.id, cursor, 100),
            );
          }),
          read("时间线换源确认", project.id, () => {
            if (!client.audioResolutions)
              throw new Error("时间线换源摘要能力不可用。");
            return pages((cursor) =>
              client.audioResolutions!.summaries(project.id, cursor, 100),
            );
          }),
        ]);
        mediaSourceReviews.push(
          ...media.filter((value) => value.projectId === project.id),
        );
        audioRevisions.push(
          ...audio.filter((value) => value.projectId === project.id),
        );
        audioResolutions.push(
          ...timeline.filter((value) => value.projectId === project.id),
        );
        if (client.episodeDevelopments) {
          sourceRevisions.push(
            ...(await read("上游新来源确认", project.id, () => {
              if (!client.episodeDevelopments!.sourceRevisionSummaries)
                throw new Error("新来源确认摘要能力不可用。");
              const seen = new Set<string>();
              return pages(async (cursor) => {
                const page = EpisodeSourceRevisionSummaryPageSchema.parse(
                  await client.episodeDevelopments!.sourceRevisionSummaries!(
                    project.id,
                    cursor,
                  ),
                );
                if (
                  (page.nextCursor &&
                    page.nextCursor !== page.items.at(-1)?.id) ||
                  page.items.some((value) => {
                    if (value.projectId !== project.id || seen.has(value.id))
                      return true;
                    seen.add(value.id);
                    return false;
                  })
                )
                  throw new Error("新来源确认归属、完整分页或重复身份不符。");
                return page;
              });
            })),
          );
          const topology = await read("作者场景拓扑确认", project.id, () => {
            if (!client.episodeDevelopments!.topologyRevisionSummaries)
              throw new Error("场景拓扑摘要能力不可用。");
            return pages((cursor) =>
              client.episodeDevelopments!.topologyRevisionSummaries!(
                project.id,
                cursor,
              ),
            );
          });
          topologyRevisions.push(
            ...topology.filter((value) => value.projectId === project.id),
          );
          const values = await read("人工剧本确认", project.id, () =>
            pages((cursor) =>
              client.episodeDevelopments!.scriptRevisionSummaries(
                project.id,
                cursor,
              ),
            ),
          );
          scriptRevisions.push(
            ...values.filter((value) => value.projectId === project.id),
          );
        }
        if (
          client.narrativeQuality?.summaries ||
          runs.some(
            (run) =>
              run.input.projectId === project.id &&
              run.input.operation === "quality-review",
          )
        ) {
          const summaries = await read("质量报告与问题", project.id, () => {
            if (!client.narrativeQuality?.summaries)
              throw new Error("质量摘要能力不可用。");
            return pages((cursor) =>
              client.narrativeQuality!.summaries!(project.id, cursor, 100),
            );
          });
          narrativeReports.push(
            ...summaries.filter((report) => report.projectId === project.id),
          );
        }
        localReviews.push(
          ...(await read("本地人工／规则评议", project.id, () => {
            if (!client.narrativeQuality?.localSummaries)
              throw new Error("本地评议摘要能力不可用。");
            return declarationPages(
              project.id,
              (cursor) =>
                client.narrativeQuality!.localSummaries!(
                  project.id,
                  cursor,
                  100,
                ),
              () => true,
            );
          })),
        );
        if (
          runs.some(
            (run) =>
              run.input.projectId === project.id &&
              run.input.operation === "adaptation-diagnosis",
          )
        ) {
          const summaries = await read("诊断来源", project.id, () => {
            if (!client.diagnoses) throw new Error("诊断摘要能力不可用。");
            return pages((cursor) =>
              client.diagnoses!.summaries(project.id, cursor),
            );
          });
          diagnoses.push(
            ...summaries.filter((item) => item.projectId === project.id),
          );
        }
        if (
          runs.some(
            (run) =>
              run.input.projectId === project.id &&
              run.input.operation === "adaptation-strategy",
          )
        ) {
          const summaries = await read("独立策略来源", project.id, () => {
            if (!client.adaptationStrategies)
              throw new Error("独立策略摘要能力不可用。");
            return pages((cursor) =>
              client.adaptationStrategies!.summaries(project.id, cursor),
            );
          });
          adaptationStrategies.push(
            ...summaries.filter((item) => item.projectId === project.id),
          );
        }
        storyBible.push(
          ...changes.filter((change) => change.projectId === project.id),
        );
        if (
          runs.some(
            (run) =>
              run.input.projectId === project.id &&
              run.input.operation === "season-plan",
          )
        ) {
          const summaries = await read("季纲来源", project.id, () => {
            if (!client.seasonPlans) throw new Error("季纲摘要能力不可用。");
            return pages((cursor) =>
              client.seasonPlans!.summaries(project.id, cursor),
            );
          });
          seasonPlans.push(
            ...summaries.filter((item) => item.projectId === project.id),
          );
        }
        imports.push(
          ...extractions.filter((change) => change.projectId === project.id),
        );
        manuscripts.push(
          ...records.filter(
            (record) => record.manifest.projectId === project.id,
          ),
        );
        revisions.push(
          ...oldRevisions.map((preview) => ({
            ...preview,
            projectId: project.id,
          })),
        );
        authorIntents.push(
          ...intents.filter((intent) => intent.projectId === project.id),
        );
      }
    }),
  );
  return {
    projects,
    unavailable,
    items: deriveConfirmations({
      projects,
      tasks: tasks.filter((task) => !projectId || task.projectId === projectId),
      workflows,
      storyBible,
      imports,
      manuscripts,
      providerActions,
      pilotPackages,
      revisions,
      authorIntents,
      diagnoses,
      seasonPlans,
      adaptationStrategies,
      narrativeReports,
      localReviews,
      scriptRevisions,
      topologyRevisions,
      sourceRevisions,
      narrativeSummaries,
      episodeResults,
      mediaSourceReviews,
      audioRevisions,
      audioResolutions,
      storyDeclarations,
      storyAssertions,
    }),
  };
}
