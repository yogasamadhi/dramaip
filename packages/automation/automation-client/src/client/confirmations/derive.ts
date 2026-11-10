import { providerEstimate, providerStatusText } from "./provider-review.ts";
import {
  fields,
  type AdaptationStrategy,
  type AudioResolution,
  type AudioRevision,
  type AuthorIntent,
  type CreationWorkflow,
  type Diagnosis,
  type EpisodeResult,
  type ImportExtraction,
  type LocalReview,
  type Manuscript,
  type MediaSourceReview,
  type NarrativeReport,
  type NarrativeSummary,
  type PilotPackage,
  type Project,
  type ProviderActionSummary,
  type RevisionSummary,
  type ScriptRevision,
  type SeasonPlan,
  type SourceRevision,
  type StoryAssertion,
  type StoryBibleChange,
  type StoryDeclaration,
  type Task,
  type TopologyRevision,
  type Translate,
} from "./remote.ts";

/** Which tab of the pending confirmation center an item sits in. */
export type ConfirmationCategory = "waiting" | "running" | "attention";

/** One record waiting for the author, as its owning domain reports it. */
export interface ConfirmationItem {
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
  projectId: string | undefined;
  projectTitle: string;
  title: string;
  status: string;
  category: ConfirmationCategory;
  detail: string;
  updatedAt: string;
  /** The route of the owning record, where the author decides. */
  to: string;
}

/** Every source the center derives its items from. */
export interface ConfirmationSources {
  projects: readonly Project[];
  workflows: readonly CreationWorkflow[];
  storyBible: readonly StoryBibleChange[];
  imports: readonly ImportExtraction[];
  manuscripts: readonly Manuscript[];
  providerActions: readonly ProviderActionSummary[];
  pilotPackages: readonly PilotPackage[];
  revisions: readonly RevisionSummary[];
  authorIntents: readonly AuthorIntent[];
  diagnoses: readonly Diagnosis[];
  seasonPlans: readonly SeasonPlan[];
  adaptationStrategies: readonly AdaptationStrategy[];
  narrativeReports: readonly NarrativeReport[];
  localReviews: readonly LocalReview[];
  scriptRevisions: readonly ScriptRevision[];
  topologyRevisions: readonly TopologyRevision[];
  sourceRevisions: readonly SourceRevision[];
  narrativeSummaries: readonly NarrativeSummary[];
  episodeResults: readonly EpisodeResult[];
  mediaSourceReviews: readonly MediaSourceReview[];
  audioRevisions: readonly AudioRevision[];
  audioResolutions: readonly AudioResolution[];
  storyDeclarations: readonly StoryDeclaration[];
  storyAssertions: readonly StoryAssertion[];
  tasks: readonly Task[];
}

/**
 * A route of the existing app with its query; empty values are left out.
 * @param path - the route path.
 * @param params - the query.
 */
export function route(
  path: string,
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, value);
  return `${path}?${search}`;
}

const tool = (projectId: string, name: string) =>
  `/projects/${encodeURIComponent(projectId)}/tools/${name}`;

const REVIEWED_STAGES = ["awaiting-review", "applied", "discarded"];
const RUNNING_STAGES = [
  "preparing",
  "generating",
  "checking",
  "revising",
  "rechecking",
];

/**
 * The records waiting for the author, newest first. There is no pending
 * table of its own: every item stays owned by its domain, and nothing here
 * adopts content or authorizes a cost.
 * @param input - the records each domain reported.
 * @param t - the confirmation copy.
 */
export function deriveConfirmations(
  input: ConfirmationSources,
  t: Translate,
): ConfirmationItem[] {
  const items: ConfirmationItem[] = [];
  const representedTasks = new Set<string>();
  const known = (projectId: string) =>
    input.projects.some((project) => project.id === projectId);
  const title = (id?: string) =>
    id
      ? (input.projects.find((project) => project.id === id)?.title ??
        t("project.unavailable"))
      : t("project.global");
  const operation = (name: CreationWorkflow["input"]["operation"]) =>
    t(`operation.${name}`);

  const declarations = [
    ...input.storyDeclarations.map((value) => ({
      ...value,
      confirmationKind: "story-declaration" as const,
      queryKey: "storyDeclarationId",
      label: t("declaration.label.node"),
      bound: Boolean(value.adoptedNode),
    })),
    ...input.storyAssertions.map((value) => ({
      ...value,
      confirmationKind: "story-assertion" as const,
      queryKey: "storyAssertionId",
      label: t(
        value.kind === "relationship"
          ? "declaration.label.relationship"
          : "declaration.label.cognition",
      ),
      bound: Boolean(value.adoptedRecord),
    })),
  ];
  for (const value of declarations) {
    if (value.lifecycle && value.lifecycle.state !== "active") continue;
    if (!known(value.projectId)) continue;
    const attention = value.sourceStatus.state !== "current";
    const adopted = value.status === "adopted" && value.bound;
    if (value.status !== "pending" && !(adopted && attention)) continue;
    items.push({
      key: `${value.confirmationKind}:${value.id}`,
      kind: value.confirmationKind,
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: t(
        adopted ? "declaration.title.adopted" : "declaration.title.pending",
        { label: value.label, title: value.title },
      ),
      category: attention ? "attention" : "waiting",
      status: t(
        value.sourceStatus.state === "unavailable"
          ? "declaration.status.unavailable"
          : attention
            ? "declaration.status.changed"
            : "declaration.status.waiting",
      ),
      detail: t("declaration.detail", {
        version: value.version,
        reasons: value.sourceStatus.reasons.length,
      }),
      updatedAt: value.updatedAt,
      to: route("/create", {
        projectId: value.projectId,
        [value.queryKey]: value.id,
      }),
    });
  }

  for (const value of input.narrativeSummaries) {
    if (!known(value.projectId)) continue;
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
      title: t(candidate ? "summary.title.candidate" : "summary.title.adopted"),
      status: t(
        candidate
          ? attention
            ? "summary.status.changed"
            : "summary.status.waiting"
          : value.contextEligibility.state === "eligible"
            ? "summary.status.scopeChanged"
            : "summary.status.unavailable",
      ),
      category: attention ? "attention" : "waiting",
      detail: t("summary.detail", {
        version: value.version,
        chapters: value.coveredChapterCount,
        reasons: value.staleReasonCount,
      }),
      updatedAt: value.updatedAt,
      to: route(tool(value.projectId, "quality-review"), {
        summaryId: value.id,
        summaryWorkflowId: value.workflowId,
      }),
    });
  }

  for (const value of input.episodeResults) {
    if (
      !known(value.projectId) ||
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
    const human =
      value.origin === "human-script-revision" ||
      value.origin === "human-topology-revision" ||
      value.origin === "human-source-revision";
    items.push({
      key: `episode-result:${value.id}`,
      kind: "creation",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: t("episode.title", { operation: operation(value.operation) }),
      status: t("episode.status"),
      category: "attention",
      detail: t("episode.detail", {
        version: value.version,
        reasons: value.staleReasonCount,
        origin: t(human ? "episode.origin.human" : "episode.origin.model"),
      }),
      updatedAt: value.adoptedAt,
      to: route(tool(value.projectId, "episode-development"), {
        resultId: value.id,
        episodeId: value.episodeId,
        operation: value.operation,
      }),
    });
  }

  for (const value of input.mediaSourceReviews) {
    if (value.state !== "pending") continue;
    const attention = value.sourceState === "stale";
    items.push({
      key: `media-source-review:${value.id}`,
      kind: "media-source-review",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: t("media.title"),
      status: t(attention ? "media.status.changed" : "media.status.waiting"),
      category: attention ? "attention" : "waiting",
      detail: t("media.detail", {
        record: value.recordVersion,
        shot: value.shotVersion,
        reasons: value.reasonCount,
      }),
      updatedAt: value.updatedAt,
      to: route("/produce", {
        projectId: value.projectId,
        mediaSourceReviewId: value.id,
        recordId: value.recordId,
      }),
    });
  }

  for (const value of input.audioRevisions) {
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
      title: t(draft ? "audio.title.draft" : "audio.title.candidate"),
      status: t(
        attention
          ? "audio.status.changed"
          : draft
            ? "audio.status.draft"
            : "audio.status.waiting",
      ),
      category: attention ? "attention" : "waiting",
      detail: t("audio.detail", {
        version: value.originalVersion,
        clips: value.candidateClipCount,
        mapped: value.mappedCount,
        removed: value.removedCount,
        added: value.addedCount,
      }),
      updatedAt: value.updatedAt,
      to: route("/produce", {
        projectId: value.projectId,
        episodeId: value.episodeId,
        audioRevisionId: value.id,
        sourceTrackId: value.sourceTrackId,
      }),
    });
  }

  for (const value of input.audioResolutions) {
    if (value.state !== "pending") continue;
    const attention = value.sourceState === "stale";
    items.push({
      key: `audio-resolution:${value.id}`,
      kind: "audio-resolution",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: t("resolution.title"),
      status: t(
        attention ? "resolution.status.changed" : "resolution.status.waiting",
      ),
      category: attention ? "attention" : "waiting",
      detail: t("resolution.detail", {
        version: value.timelineVersion,
        replaced: value.replaceCount,
        removed: value.removeCount,
        protected: value.protectedCount,
      }),
      updatedAt: value.updatedAt,
      to: route("/produce", {
        projectId: value.projectId,
        episodeId: value.episodeId,
        audioResolutionId: value.id,
        timelineId: value.timelineId,
      }),
    });
  }

  for (const revision of input.sourceRevisions) {
    if (revision.status !== "pending") continue;
    const stale = revision.sourceState === "stale";
    items.push({
      key: `author-source-revision:${revision.id}`,
      kind: "author-source-revision",
      objectId: revision.id,
      projectId: revision.projectId,
      projectTitle: title(revision.projectId),
      title: t("sourceRevision.title"),
      status: t(
        stale
          ? "sourceRevision.status.changed"
          : "sourceRevision.status.waiting",
      ),
      category: stale ? "attention" : "waiting",
      detail: t("sourceRevision.detail", {
        document: revision.document.version,
        outline: revision.sourceOutline.version,
        script: revision.sourceScript.version,
      }),
      updatedAt: revision.updatedAt,
      to: route(tool(revision.projectId, "episode-development"), {
        episodeId: revision.episodeId,
        operation: "episode-script",
        resultId: revision.sourceScript.id,
        sourceRevisionId: revision.id,
      }),
    });
  }

  for (const revision of input.topologyRevisions) {
    if (revision.status !== "pending") continue;
    const stale = revision.sourceState === "stale";
    items.push({
      key: `author-topology-revision:${revision.id}`,
      kind: "author-topology-revision",
      objectId: revision.id,
      projectId: revision.projectId,
      projectTitle: title(revision.projectId),
      title: t("topology.title"),
      status: t(stale ? "authorRevision.status.changed" : "topology.waiting"),
      category: stale ? "attention" : "waiting",
      detail: t("topology.detail", {
        document: revision.document.version,
        outline: revision.sourceOutline.version,
        script: revision.sourceScript.version,
      }),
      updatedAt: revision.updatedAt,
      to: route(tool(revision.projectId, "episode-development"), {
        episodeId: revision.episodeId,
        operation: "episode-script",
        resultId: revision.sourceScript.id,
        topologyRevisionId: revision.id,
      }),
    });
  }

  for (const revision of input.scriptRevisions) {
    if (revision.status !== "pending") continue;
    const stale = revision.sourceState === "stale";
    items.push({
      key: `author-script-revision:${revision.id}`,
      kind: "author-script-revision",
      objectId: revision.id,
      projectId: revision.projectId,
      projectTitle: title(revision.projectId),
      title: t("script.title"),
      status: t(stale ? "authorRevision.status.changed" : "script.waiting"),
      category: stale ? "attention" : "waiting",
      detail: t("script.detail", {
        document: revision.document.version,
        script: revision.sourceResult.version,
      }),
      updatedAt: revision.updatedAt,
      to: route(tool(revision.projectId, "episode-development"), {
        episodeId: revision.episodeId,
        operation: "episode-script",
        scriptRevisionId: revision.id,
      }),
    });
  }

  for (const intent of input.authorIntents) {
    if (!["pending", "conflicted"].includes(intent.status)) continue;
    const attention =
      intent.status === "conflicted" || intent.sourceState === "stale";
    items.push({
      key: `author-intent:${intent.id}`,
      kind: "author-intent",
      objectId: intent.id,
      projectId: intent.projectId,
      projectTitle: title(intent.projectId),
      title: t("intent.title"),
      status: t(attention ? "intent.status.changed" : "status.waitingReview"),
      category: attention ? "attention" : "waiting",
      detail: t("intent.detail", {
        version: intent.version,
        source: intent.sourceProjectVersion,
      }),
      updatedAt: intent.updatedAt,
      to: route(tool(intent.projectId, "author-intent"), {
        intentId: intent.id,
        intentWorkflowId: intent.workflowId,
      }),
    });
  }

  for (const value of input.localReviews) {
    if (!known(value.projectId)) continue;
    const candidate = value.status === "awaiting-review";
    // A new clean head does not erase older known adopted issues. Unknown
    // source validity must remain visible, not become an empty success.
    const needsReview =
      value.status === "adopted" &&
      (value.openIssueCount > 0 ||
        (value.isCurrent && value.sourceState !== "current"));
    if (!candidate && !needsReview) continue;
    const origin = t(
      value.origin === "human-declared"
        ? "local.origin.human"
        : "local.origin.rule",
    );
    items.push({
      key: `narrative-local-review:${value.id}`,
      kind: "narrative-local-review",
      objectId: value.id,
      projectId: value.projectId,
      projectTitle: title(value.projectId),
      title: t(candidate ? "local.title.candidate" : "local.title.issues", {
        origin,
      }),
      status: t(
        value.sourceState === "unverified"
          ? "local.status.unverified"
          : value.sourceState === "stale"
            ? "local.status.changed"
            : candidate
              ? "local.status.waiting"
              : "local.status.issues",
      ),
      category:
        !candidate || value.sourceState !== "current" ? "attention" : "waiting",
      detail: t("local.detail", {
        target: value.request.target.version,
        version: value.version,
        open: value.openIssueCount,
        blockers: value.blockerCount,
        accepted: value.acceptedRiskCount,
      }),
      updatedAt: value.updatedAt,
      to: route(tool(value.projectId, "quality-review"), {
        localReviewId: value.id,
      }),
    });
  }

  for (const report of input.narrativeReports) {
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
      title: t(candidate ? "report.title.candidate" : "report.title.issues"),
      status: t(
        report.sourceState === "stale"
          ? "report.status.changed"
          : candidate
            ? "report.status.waiting"
            : "report.status.issues",
      ),
      category: attention ? "attention" : "waiting",
      detail: t("report.detail", {
        target: report.request.target.version,
        version: report.version,
        open: report.openIssueCount,
        blockers: report.blockerCount,
        accepted: report.acceptedRiskCount,
      }),
      updatedAt: report.updatedAt,
      to: route(`/projects/${report.projectId}/tools/quality-review`, {
        reportId: report.id,
        workflowId: report.workflowId,
      }),
    });
  }

  for (const workflow of input.workflows) {
    const projectId = workflow.input.projectId;
    if (
      workflow.input.operation === "narrative-summary" &&
      REVIEWED_STAGES.includes(workflow.stage) &&
      input.narrativeSummaries.some(
        (item) =>
          item.id === workflow.narrativeSummaryId &&
          item.workflowId === workflow.id &&
          item.projectId === projectId,
      )
    ) {
      representedTasks.add(workflow.taskId);
      continue;
    }
    if (workflow.input.operation === "adaptation-strategy") {
      const strategy = input.adaptationStrategies.find(
        (item) =>
          item.id === workflow.adaptationStrategyId &&
          item.workflowId === workflow.id &&
          item.projectId === projectId,
      );
      if (strategy && REVIEWED_STAGES.includes(workflow.stage)) {
        representedTasks.add(workflow.taskId);
        if (["pending", "conflicted"].includes(strategy.status)) {
          const conflicted =
            strategy.sourceState === "stale" ||
            strategy.status === "conflicted";
          items.push({
            key: `adaptation-strategy:${strategy.id}`,
            kind: "creation",
            objectId: strategy.id,
            projectId: strategy.projectId,
            projectTitle: title(strategy.projectId),
            title: t("strategy.title", { version: strategy.version }),
            status: t(
              conflicted
                ? "strategy.status.conflict"
                : "strategy.status.waiting",
            ),
            category: conflicted ? "attention" : "waiting",
            detail: t("strategy.detail"),
            updatedAt: strategy.updatedAt,
            to: route(
              `/projects/${strategy.projectId}/tools/adaptation-strategy`,
              { workflowId: workflow.id, strategyId: strategy.id },
            ),
          });
        }
        continue;
      }
    }
    if (
      workflow.input.operation === "author-intent" &&
      input.authorIntents.some(
        (intent) =>
          intent.id === workflow.authorIntentId &&
          intent.workflowId === workflow.id &&
          intent.projectId === projectId,
      )
    ) {
      representedTasks.add(workflow.taskId);
      continue;
    }
    if (
      workflow.input.operation === "quality-review" &&
      input.narrativeReports.some(
        (report) =>
          report.id === workflow.narrativeReportId &&
          report.workflowId === workflow.id &&
          report.projectId === projectId,
      )
    ) {
      representedTasks.add(workflow.taskId);
      continue;
    }
    if (workflow.input.operation === "season-plan") {
      const plans = input.seasonPlans.filter(
        (item) =>
          item.projectId === projectId && item.workflowId === workflow.id,
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
      if (linked.size && REVIEWED_STAGES.includes(workflow.stage)) {
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
            title: t(
              plan.origin === "human-reorder"
                ? "season.title.reordered"
                : "season.title",
              { version: plan.version },
            ),
            status: t(
              attention ? "season.status.conflict" : "status.waitingReview",
            ),
            category: attention ? "attention" : "waiting",
            detail: t("season.detail"),
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
    const diagnosis = input.diagnoses.find(
      (item) =>
        item.workflowId === workflow.id &&
        item.projectId === projectId &&
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
      status = t(stale ? "diagnosis.conflict" : "status.waitingReview");
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
      status = t(
        workflow.stage === "failed" ? "status.attention" : "run.interrupted",
      );
    } else if (RUNNING_STAGES.includes(workflow.stage)) {
      category = "running";
      status = t("run.running");
    } else continue;
    representedTasks.add(workflow.taskId);
    const blockers = workflow.issues.filter(
      (issue) => issue.severity === "error",
    ).length;
    const op = workflow.input.operation;
    items.push({
      key: `creation:${workflow.id}`,
      kind: "creation",
      objectId: workflow.id,
      projectId,
      projectTitle: title(projectId),
      title: operation(op),
      status,
      category,
      detail: t(blockers ? "run.detail.blockers" : "run.detail", {
        target: t(workflow.input.targetId ? "run.target" : "run.project"),
        version: workflow.version,
        blockers,
      }),
      updatedAt: workflow.updatedAt,
      to:
        op === "author-intent"
          ? route(`/projects/${projectId}/tools/author-intent`, {
              intentWorkflowId: workflow.id,
              intentId: workflow.authorIntentId,
            })
          : op === "narrative-summary"
            ? route(`/projects/${projectId}/tools/quality-review`, {
                summaryWorkflowId: workflow.id,
                summaryId: workflow.narrativeSummaryId,
              })
            : op === "quality-review"
              ? route(`/projects/${projectId}/tools/quality-review`, {
                  workflowId: workflow.id,
                  reportId: workflow.narrativeReportId,
                })
              : [
                    "episode-outline",
                    "episode-script",
                    "storyboard-package",
                  ].includes(op)
                ? route(`/projects/${projectId}/tools/episode-development`, {
                    workflowId: workflow.id,
                    operation: op,
                    episodeId:
                      workflow.input.episodeDevelopmentRequest?.episodeId,
                  })
                : op === "season-plan"
                  ? route(`/projects/${projectId}/tools/season-plan`, {
                      workflowId: workflow.id,
                      seasonPlanId: workflow.seasonPlanId,
                    })
                  : op === "adaptation-strategy"
                    ? route(
                        `/projects/${projectId}/tools/adaptation-strategy`,
                        {
                          workflowId: workflow.id,
                          strategyId: workflow.adaptationStrategyId,
                        },
                      )
                    : op === "adaptation-diagnosis"
                      ? route(
                          `/projects/${projectId}/tools/adaptation-diagnosis`,
                          {
                            workflowId: workflow.id,
                            diagnosisId: workflow.diagnosisId,
                          },
                        )
                      : route("/tasks", {
                          projectId,
                          workflowId: workflow.id,
                          taskId: workflow.taskId,
                        }),
    });
  }

  for (const change of input.storyBible) {
    if (["applied", "discarded", "skipped"].includes(change.status)) continue;
    const sourceChanged =
      change.sourceState === "stale" || change.sourceState === "missing";
    const category: ConfirmationCategory = sourceChanged
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
      title: t("bible.title"),
      status: t(
        change.sourceState === "missing"
          ? "bible.status.missing"
          : change.sourceState === "stale"
            ? "status.sourceChanged"
            : category === "attention"
              ? "bible.status.review"
              : category === "running"
                ? "bible.status.queued"
                : change.status === "paused"
                  ? "bible.status.paused"
                  : "status.waitingReview",
      ),
      category,
      detail: t("bible.detail", { version: change.sourceVersion }),
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
    const drafts = change.candidates.filter(
      (item) => item.status === "draft",
    ).length;
    const conflicts = change.candidates.some(
      (item) => item.status === "conflict",
    );
    const attention = ["stale", "failed"].includes(change.status) || conflicts;
    if (!attention && !drafts) continue;
    items.push({
      key: `import:${change.id}`,
      kind: "import",
      objectId: change.id,
      projectId: change.projectId,
      projectTitle: title(change.projectId),
      title: t("import.title"),
      status: t(attention ? "import.status.review" : "status.waitingReview"),
      category: attention ? "attention" : "waiting",
      detail: t("import.detail", { count: drafts }),
      updatedAt: change.updatedAt,
      to: route(tool(change.projectId, "review"), { extractionId: change.id }),
    });
  }

  for (const manuscript of input.manuscripts) {
    // Canceled/saved records are historical facts, not new pending decisions.
    if (["saved", "canceled"].includes(manuscript.status)) continue;
    const category: ConfirmationCategory =
      manuscript.sourceState === "stale" || manuscript.status === "failed"
        ? "attention"
        : manuscript.status === "saving"
          ? "running"
          : "waiting";
    const projectId = manuscript.manifest.projectId;
    items.push({
      key: `manuscript:${manuscript.id}`,
      kind: "manuscript",
      objectId: manuscript.id,
      projectId,
      projectTitle: title(projectId),
      title: t("manuscript.title"),
      status: t(
        manuscript.sourceState === "stale"
          ? "status.sourceChanged"
          : manuscript.status === "failed"
            ? "manuscript.status.failed"
            : manuscript.status === "saving"
              ? "status.saving"
              : "status.rights",
      ),
      category,
      detail: t("manuscript.detail", {
        scope: t(
          manuscript.manifest.scope === "whole-project"
            ? "manuscript.scope.whole"
            : "manuscript.scope.selected",
        ),
        chapters: manuscript.manifest.chapters.length,
        format: manuscript.manifest.format.toUpperCase(),
      }),
      updatedAt: manuscript.updatedAt,
      to: route(`/projects/${encodeURIComponent(projectId)}`, {
        manuscriptId: manuscript.id,
      }),
    });
  }

  for (const preview of input.revisions) {
    if (!["pending", "conflicted"].includes(preview.status)) continue;
    for (const task of input.tasks)
      if (fields(fields(task.result).revisionPreview).id === preview.id)
        representedTasks.add(task.id);
    const conflicted = preview.status === "conflicted";
    items.push({
      key: `revision:${preview.id}`,
      kind: "revision",
      objectId: preview.id,
      projectId: preview.projectId,
      projectTitle: title(preview.projectId),
      title: t("revision.title"),
      status: t(
        conflicted ? "revision.status.conflict" : "status.waitingReview",
      ),
      category: conflicted ? "attention" : "waiting",
      detail: t("revision.detail", { version: preview.baseVersion }),
      updatedAt: preview.committedAt ?? preview.createdAt,
      to: route("/tasks", {
        projectId: preview.projectId,
        revisionId: preview.id,
      }),
    });
  }

  for (const task of input.tasks) {
    if (representedTasks.has(task.id)) continue;
    const result = fields(task.result);
    const embedded = result.providerActionPreview;
    const embeddedId = fields(embedded).id;
    const previewId = result.providerActionPreviewId ?? embeddedId;
    if (
      typeof previewId === "string" &&
      (embeddedId === undefined || embeddedId === previewId) &&
      input.providerActions.some(
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
      status: t(
        category === "waiting"
          ? provider
            ? "task.status.provider"
            : "status.waitingReview"
          : category === "running"
            ? "task.status.running"
            : "status.attention",
      ),
      category,
      detail: t(provider ? "task.detail.provider" : "task.detail"),
      updatedAt: task.updatedAt,
      to: route("/tasks", {
        projectId: task.projectId,
        taskId: task.id,
        scope: task.projectId ? undefined : "all",
      }),
    });
  }

  for (const preview of input.providerActions) {
    if (preview.status !== "pending") continue;
    const estimate = providerEstimate(preview, t);
    items.push({
      key: `provider-action:${preview.id}`,
      kind: "provider-action",
      objectId: preview.id,
      projectId: preview.projectId,
      projectTitle: title(preview.projectId),
      title: t("provider.title"),
      status: estimate.known
        ? providerStatusText(t, preview.status)
        : t("provider.status.unknown"),
      category: estimate.known ? "waiting" : "attention",
      detail: t("provider.detail", { estimate: estimate.label }),
      updatedAt: preview.createdAt,
      to: route("/pending", {
        projectId: preview.projectId,
        providerActionPreviewId: preview.id,
        category: estimate.known ? "waiting" : "attention",
      }),
    });
  }

  for (const record of input.pilotPackages) {
    if (record.status === "saved" || record.status === "canceled") continue;
    const attention =
      record.sourceState !== "current" || record.status === "failed";
    const projectId = record.manifest.projectId;
    items.push({
      key: `pilot-package:${record.id}`,
      kind: "pilot-package",
      objectId: record.id,
      projectId,
      projectTitle: title(projectId),
      title: t("pilot.title"),
      status: t(
        attention
          ? "pilot.status.review"
          : record.status === "saving"
            ? "status.saving"
            : "status.rights",
      ),
      category: attention
        ? "attention"
        : record.status === "saving"
          ? "running"
          : "waiting",
      detail: t("pilot.detail", {
        version: record.manifest.adopted.storyboard.version,
      }),
      updatedAt: record.updatedAt,
      to: route(tool(projectId, "episode-development"), {
        episodeId: record.manifest.episodeId,
        operation: "storyboard-package",
        pilotPackageId: record.id,
      }),
    });
  }

  return [...new Map(items.map((item) => [item.key, item])).values()].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.key.localeCompare(right.key),
  );
}
