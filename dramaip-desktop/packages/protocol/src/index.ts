import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from "effect/unstable/httpapi";
import { Schema } from "effect";
import {
  ApiError,
  AgentRunInput,
  AgentRun,
  AgentItem,
  AgentEngineDescriptor,
  AgentTaskDescriptor,
  GlobalAgentSettings,
  GlobalAgentSettingsInput,
  AgentSession,
  AgentSessionInput,
  ProjectAgentSettings,
  ProjectAgentSettingsInput,
  AgentExperiment,
  AgentExperimentInput,
  AgentExperimentReviewInput,
  ChangePreview,
  ProviderActionPreview,
  CodexAuthStatus,
  CodexLoginInput,
  CodexLoginResult,
  Chapter,
  ChapterInput,
  ChapterPatch,
  ChapterReorderInput,
  Project,
  ProjectInput,
  ProjectPatch,
  RevisionInput,
  RevisionPreview,
  Task,
  TaskInput,
  TaskRetryInput,
  DomainEntity,
  DomainEntityInput,
  DomainEntityPatch,
  AssetCenter,
  AssetCenterActionInput,
  AssetCenterPreviewMedia,
  GlobalSearchResponse,
  BackupRecord,
  ExportDocument,
  SourceImportPreviewInput,
  SourceImportPreviewResponse,
  SourceImportCommitInput,
  SourceImportCommitResult,
  ImportExtractionChangeSet,
  ImportExtractionCandidatePatch,
  ImportExtractionAdoptInput,
  PilotPlan,
  PilotPlanCreateInput,
  PilotPlanActionInput,
  EpisodeWorkflowInput,
  EpisodeWorkflowResult,
  FeedbackPreviewInput,
  FeedbackPreview,
  FeedbackCommitInput,
  FeedbackBatch,
  FeedbackDashboard,
  FeedbackClusterInput,
  FeedbackCluster,
  DiagnosticReport,
  ProductionGraph,
  ProductionImpact,
  ProductionImpactInput,
  GenerationRecord,
  GenerationRecordPatch,
  ContentVersionRestoreResult,
  TemplateRunInput,
  TemplateRunResult,
  ProviderConnectionResult,
  AgentProviderActivationResult,
  StoryBibleChangeSet,
  StoryBibleChangeSetInput,
  StoryBibleSettings,
  StoryBibleStaleMark,
  ProjectPackageCommitInput,
  ProjectPackageCommitResult,
  ProjectPackagePreview,
  ProjectPackagePreviewInput,
  ChapterAnalysisRunResult,
  CurrentAdaptationInput,
  DomainChildrenReorderInput,
  DomainChildrenReorderResult,
  PromptVersion,
  PromptVersionInput,
  ScriptReview,
  ShotReview,
  EpisodeAnalysis,
  PlatformDeliveryProfile,
  DeliveryCreativeVariant,
  DeliveryCreativeVariantInput,
  PlatformDeliveryPreflight,
  PlatformDeliveryPreflightInput,
  PlatformDeliveryArchive,
  EditorTimelineManifest,
  EditorExportPreflight,
  ReviewPackage,
  ReviewComment,
  ReviewCommentInput,
  ReviewDecision,
  ReviewDecisionInput,
  OfflineReviewImportInput,
  OfflineReviewImportResult,
  ComplianceRuleProfile,
  CompliancePreflightInput,
  EpisodeCompliancePreflight,
  VoiceProfile,
  VoiceProfileInput,
  AudioTrack,
  AudioTrackInput,
  AnimaticInitialization,
  AnimaticDraft,
  AnimaticDraftInput,
  AnimaticReviewInput,
  EpisodeRenderPreflight,
  ImageGenerationInput,
  ImageGenerationRun,
  TtsGenerationInput,
  TtsGenerationRun,
  VideoGenerationInput,
  VideoGenerationPreflight,
  VideoGenerationBatchPreflightInput,
  VideoGenerationBatchPreflight,
  VideoGenerationJob,
  VideoGenerationRetryInput,
  CreativeCaseStudy,
  CreativeCaseStudyInput,
  CreativeCaseStudyPatch,
  CreativeDiagnostic,
  CreativeDiagnosticInput,
  CreativeDiagnosticRunResult,
  CreativeIssueAcknowledgement,
  CreativeIssueAcknowledgementInput,
} from "@sdns/schema";

export const API_PREFIX = "/api/v1";

const Empty = Schema.Void;
const ProjectGroup = HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("list", `${API_PREFIX}/projects`, {
      success: Schema.Array(Project),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/projects`, {
      payload: ProjectInput,
      success: Project,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/projects/:id`, {
      params: { id: Schema.String },
      success: Project,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("update", `${API_PREFIX}/projects/:id`, {
      params: { id: Schema.String },
      payload: ProjectPatch,
      success: Project,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("listTrash", `${API_PREFIX}/projects/trash`, {
      success: Schema.Array(Project),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("trash", `${API_PREFIX}/projects/:id/trash`, {
      params: { id: Schema.String },
      success: Project,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("restore", `${API_PREFIX}/projects/:id/restore`, {
      params: { id: Schema.String },
      success: Project,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("purge", `${API_PREFIX}/projects/:id`, {
      params: { id: Schema.String },
      payload: Schema.Struct({ confirmationTitle: Schema.String }),
      success: Empty,
      error: ApiError,
    }),
  );

const ChapterGroup = HttpApiGroup.make("chapters")
  .add(
    HttpApiEndpoint.get("list", `${API_PREFIX}/projects/:projectId/chapters`, {
      params: { projectId: Schema.String },
      success: Schema.Array(Chapter),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/chapters`, {
      payload: ChapterInput,
      success: Chapter,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/chapters/:id`, {
      params: { id: Schema.String },
      success: Chapter,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("update", `${API_PREFIX}/chapters/:id`, {
      params: { id: Schema.String },
      payload: ChapterPatch,
      success: Chapter,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "reorder",
      `${API_PREFIX}/projects/:projectId/chapters/reorder`,
      {
        params: { projectId: Schema.String },
        payload: ChapterReorderInput,
        success: Schema.Array(Chapter),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete("remove", `${API_PREFIX}/chapters/:id`, {
      params: { id: Schema.String },
      success: Empty,
      error: ApiError,
    }),
  );

const TaskGroup = HttpApiGroup.make("tasks")
  .add(
    HttpApiEndpoint.get("list", `${API_PREFIX}/tasks`, {
      success: Schema.Array(Task),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/tasks`, {
      payload: TaskInput,
      success: Task,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("cancel", `${API_PREFIX}/tasks/:id/cancel`, {
      params: { id: Schema.String },
      success: Task,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("retry", `${API_PREFIX}/tasks/:id/retry`, {
      params: { id: Schema.String },
      payload: TaskRetryInput,
      success: Task,
      error: ApiError,
    }),
  );

const RevisionGroup = HttpApiGroup.make("revisions")
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/revisions`, {
      payload: RevisionInput,
      success: RevisionPreview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/revisions/:id`, {
      params: { id: Schema.String },
      success: RevisionPreview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("commit", `${API_PREFIX}/revisions/:id/commit`, {
      params: { id: Schema.String },
      payload: Schema.Struct({ version: Schema.Number }),
      success: Empty,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("discard", `${API_PREFIX}/revisions/:id/discard`, {
      params: { id: Schema.String },
      success: RevisionPreview,
      error: ApiError,
    }),
  );

const AgentGroup = HttpApiGroup.make("agent-sessions")
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/agent-sessions`, {
      payload: AgentSessionInput,
      success: AgentSession,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("run", `${API_PREFIX}/agent-sessions/:id/runs`, {
      params: { id: Schema.String },
      payload: AgentRunInput,
      success: Schema.Struct({
        taskId: Schema.String,
        sessionId: Schema.String,
        runId: Schema.String,
      }),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("abort", `${API_PREFIX}/agent-sessions/:id/abort`, {
      params: { id: Schema.String },
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/agent-sessions/:id`, {
      params: { id: Schema.String },
      success: AgentSession,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("getRun", `${API_PREFIX}/agent-runs/:id`, {
      params: { id: Schema.String },
      success: AgentRun,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("listItems", `${API_PREFIX}/agent-runs/:id/items`, {
      params: { id: Schema.String },
      success: Schema.Array(AgentItem),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "interrupt",
      `${API_PREFIX}/agent-runs/:id/interrupt`,
      {
        params: { id: Schema.String },
        success: AgentRun,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("resume", `${API_PREFIX}/agent-runs/:id/resume`, {
      params: { id: Schema.String },
      success: AgentRun,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("fork", `${API_PREFIX}/agent-sessions/:id/fork`, {
      params: { id: Schema.String },
      success: AgentSession,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("dispose", `${API_PREFIX}/agent-sessions/:id`, {
      params: { id: Schema.String },
      success: Empty,
      error: ApiError,
    }),
  );

const AgentEngineGroup = HttpApiGroup.make("agent-engines")
  .add(
    HttpApiEndpoint.get("listTasks", `${API_PREFIX}/agent-tasks`, {
      success: Schema.Array(AgentTaskDescriptor),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("list", `${API_PREFIX}/agent-engines`, {
      success: Schema.Array(AgentEngineDescriptor),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("getGlobalSettings", `${API_PREFIX}/agent-settings`, {
      success: GlobalAgentSettings,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.put(
      "updateGlobalSettings",
      `${API_PREFIX}/agent-settings`,
      {
        payload: GlobalAgentSettingsInput,
        success: GlobalAgentSettings,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "getProjectSettings",
      `${API_PREFIX}/projects/:id/agent-settings`,
      {
        params: { id: Schema.String },
        success: ProjectAgentSettings,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.put(
      "updateProjectSettings",
      `${API_PREFIX}/projects/:id/agent-settings`,
      {
        params: { id: Schema.String },
        payload: ProjectAgentSettingsInput,
        success: ProjectAgentSettings,
        error: ApiError,
      },
    ),
  );

const AgentExperimentGroup = HttpApiGroup.make("agent-experiments")
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/agent-experiments`, {
      payload: AgentExperimentInput,
      success: AgentExperiment,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/agent-experiments/:id`, {
      params: { id: Schema.String },
      success: AgentExperiment,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "review",
      `${API_PREFIX}/agent-experiments/:id/review`,
      {
        params: { id: Schema.String },
        payload: AgentExperimentReviewInput,
        success: AgentExperiment,
        error: ApiError,
      },
    ),
  );

const ChangePreviewGroup = HttpApiGroup.make("change-previews")
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/change-previews/:id`, {
      params: { id: Schema.String },
      success: ChangePreview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("commit", `${API_PREFIX}/change-previews/:id/commit`, {
      params: { id: Schema.String },
      success: ChangePreview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "discard",
      `${API_PREFIX}/change-previews/:id/discard`,
      {
        params: { id: Schema.String },
        success: ChangePreview,
        error: ApiError,
      },
    ),
  );

const ProviderActionPreviewGroup = HttpApiGroup.make("provider-action-previews")
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/provider-action-previews/:id`, {
      params: { id: Schema.String },
      success: ProviderActionPreview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "execute",
      `${API_PREFIX}/provider-action-previews/:id/execute`,
      {
        params: { id: Schema.String },
        success: Task,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "discard",
      `${API_PREFIX}/provider-action-previews/:id/discard`,
      {
        params: { id: Schema.String },
        success: ProviderActionPreview,
        error: ApiError,
      },
    ),
  );

const CodexAuthGroup = HttpApiGroup.make("codex-auth")
  .add(
    HttpApiEndpoint.get("status", `${API_PREFIX}/agent-engines/codex/auth`, {
      success: CodexAuthStatus,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("login", `${API_PREFIX}/agent-engines/codex/login`, {
      payload: CodexLoginInput,
      success: CodexLoginResult,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("logout", `${API_PREFIX}/agent-engines/codex/logout`, {
      success: CodexAuthStatus,
      error: ApiError,
    }),
  );

const SearchGroup = HttpApiGroup.make("search").add(
  HttpApiEndpoint.get("global", `${API_PREFIX}/search/:query`, {
    params: { query: Schema.String },
    success: GlobalSearchResponse,
    error: ApiError,
  }),
);

const ProviderGroup = HttpApiGroup.make("providers")
  .add(
    HttpApiEndpoint.post(
      "testConnection",
      `${API_PREFIX}/providers/:id/test-connection`,
      {
        params: { id: Schema.String },
        success: ProviderConnectionResult,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "activateForAgent",
      `${API_PREFIX}/providers/:id/activate-for-agent`,
      {
        params: { id: Schema.String },
        success: AgentProviderActivationResult,
        error: ApiError,
      },
    ),
  );

const StoryBibleGroup = HttpApiGroup.make("story-bible")
  .add(
    HttpApiEndpoint.get(
      "settings",
      `${API_PREFIX}/projects/:id/story-bible/settings`,
      {
        params: { id: Schema.String },
        success: StoryBibleSettings,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.put(
      "updateSettings",
      `${API_PREFIX}/projects/:id/story-bible/settings`,
      {
        params: { id: Schema.String },
        payload: Schema.Struct({ autoSuggest: Schema.Boolean }),
        success: StoryBibleSettings,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "list",
      `${API_PREFIX}/projects/:id/story-bible/change-sets`,
      {
        params: { id: Schema.String },
        success: Schema.Array(StoryBibleChangeSet),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "stale",
      `${API_PREFIX}/projects/:id/story-bible/stale`,
      {
        params: { id: Schema.String },
        success: Schema.Array(StoryBibleStaleMark),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("queue", `${API_PREFIX}/story-bible/change-sets`, {
      payload: StoryBibleChangeSetInput,
      success: StoryBibleChangeSet,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "apply",
      `${API_PREFIX}/story-bible/change-sets/:id/apply`,
      {
        params: { id: Schema.String },
        success: StoryBibleChangeSet,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "undo",
      `${API_PREFIX}/story-bible/change-sets/:id/undo`,
      {
        params: { id: Schema.String },
        success: StoryBibleChangeSet,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "setStatus",
      `${API_PREFIX}/story-bible/change-sets/:id/status`,
      {
        params: { id: Schema.String },
        payload: Schema.Struct({
          status: Schema.Union([
            Schema.Literal("queued"),
            Schema.Literal("paused"),
            Schema.Literal("skipped"),
            Schema.Literal("discarded"),
          ]),
        }),
        success: StoryBibleChangeSet,
        error: ApiError,
      },
    ),
  );

const ProjectPackageGroup = HttpApiGroup.make("project-packages")
  .add(
    HttpApiEndpoint.post("preview", `${API_PREFIX}/project-packages/preview`, {
      payload: ProjectPackagePreviewInput,
      success: ProjectPackagePreview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "commit",
      `${API_PREFIX}/project-packages/:id/commit`,
      {
        params: { id: Schema.String },
        payload: ProjectPackageCommitInput,
        success: ProjectPackageCommitResult,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete("discard", `${API_PREFIX}/project-packages/:id`, {
      params: { id: Schema.String },
      success: Empty,
      error: ApiError,
    }),
  );

const LocalizationGroup = HttpApiGroup.make("localization")
  .add(
    HttpApiEndpoint.post("adopt", `${API_PREFIX}/localization/:id/adopt`, {
      params: { id: Schema.String },
      success: DomainEntity,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "subtitles",
      `${API_PREFIX}/localization/:id/subtitles/:format`,
      {
        params: {
          id: Schema.String,
          format: Schema.Union([Schema.Literal("srt"), Schema.Literal("vtt")]),
        },
        success: ExportDocument,
        error: ApiError,
      },
    ),
  );

const DeliveryGroup = HttpApiGroup.make("delivery").add(
  HttpApiEndpoint.get("export", `${API_PREFIX}/delivery/:id/export`, {
    params: { id: Schema.String },
    success: ExportDocument,
    error: ApiError,
  }),
);

/**
 * 平台交付采用独立的档案、候选与预检契约，不能用通用“交付资料”条目
 * 冒充候选采用、版本归档或提交前核验。
 */
const PlatformDeliveryGroup = HttpApiGroup.make("platform-delivery")
  .add(
    HttpApiEndpoint.get(
      "listProfiles",
      `${API_PREFIX}/platform-delivery/profiles`,
      {
        success: Schema.Array(PlatformDeliveryProfile),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listVariants",
      `${API_PREFIX}/adaptations/:id/delivery-variants`,
      {
        params: { id: Schema.String },
        success: Schema.Array(DeliveryCreativeVariant),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "createVariant",
      `${API_PREFIX}/adaptations/:id/delivery-variants`,
      {
        params: { id: Schema.String },
        payload: DeliveryCreativeVariantInput,
        success: DeliveryCreativeVariant,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "adoptVariant",
      `${API_PREFIX}/delivery-variants/:id/adopt`,
      {
        params: { id: Schema.String },
        success: DeliveryCreativeVariant,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listArchives",
      `${API_PREFIX}/episodes/:id/platform-deliveries`,
      {
        params: { id: Schema.String },
        success: Schema.Array(PlatformDeliveryArchive),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "preflight",
      `${API_PREFIX}/episodes/:id/platform-delivery/preflight`,
      {
        params: { id: Schema.String },
        payload: PlatformDeliveryPreflightInput,
        success: PlatformDeliveryPreflight,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "createArchive",
      `${API_PREFIX}/episodes/:id/platform-deliveries`,
      {
        params: { id: Schema.String },
        payload: PlatformDeliveryPreflightInput,
        success: PlatformDeliveryArchive,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "exportArchive",
      `${API_PREFIX}/platform-deliveries/:id/export`,
      {
        params: { id: Schema.String },
        success: ExportDocument,
        error: ApiError,
      },
    ),
  );

const ReviewEditorGroup = HttpApiGroup.make("review-editor")
  .add(
    HttpApiEndpoint.get(
      "timeline",
      `${API_PREFIX}/episodes/:id/editor-timeline`,
      {
        params: { id: Schema.String },
        success: EditorTimelineManifest,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "editorPreflight",
      `${API_PREFIX}/episodes/:id/editor-timeline/preflight`,
      {
        params: { id: Schema.String },
        success: EditorExportPreflight,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "editorExport",
      `${API_PREFIX}/episodes/:id/editor-timeline/export/:format`,
      {
        params: {
          id: Schema.String,
          format: Schema.Union([
            Schema.Literal("json"),
            Schema.Literal("edl"),
            Schema.Literal("fcpxml"),
            Schema.Literal("srt"),
          ]),
        },
        success: ExportDocument,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listPackages",
      `${API_PREFIX}/episodes/:id/review-packages`,
      {
        params: { id: Schema.String },
        success: Schema.Array(ReviewPackage),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "createPackage",
      `${API_PREFIX}/episodes/:id/review-packages`,
      {
        params: { id: Schema.String },
        success: ReviewPackage,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "exportPackage",
      `${API_PREFIX}/review-packages/:id/export`,
      {
        params: { id: Schema.String },
        success: ExportDocument,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listComments",
      `${API_PREFIX}/review-packages/:id/comments`,
      {
        params: { id: Schema.String },
        success: Schema.Array(ReviewComment),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "createComment",
      `${API_PREFIX}/review-packages/:id/comments`,
      {
        params: { id: Schema.String },
        payload: ReviewCommentInput,
        success: ReviewComment,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "resolveComment",
      `${API_PREFIX}/review-comments/:id`,
      {
        params: { id: Schema.String },
        payload: Schema.Struct({ resolved: Schema.Boolean }),
        success: ReviewComment,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listDecisions",
      `${API_PREFIX}/review-packages/:id/decisions`,
      {
        params: { id: Schema.String },
        success: Schema.Array(ReviewDecision),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "createDecision",
      `${API_PREFIX}/review-packages/:id/decisions`,
      {
        params: { id: Schema.String },
        payload: ReviewDecisionInput,
        success: ReviewDecision,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "importOffline",
      `${API_PREFIX}/review-packages/:id/import-offline`,
      {
        params: { id: Schema.String },
        payload: OfflineReviewImportInput,
        success: OfflineReviewImportResult,
        error: ApiError,
      },
    ),
  );

const ComplianceGroup = HttpApiGroup.make("compliance")
  .add(
    HttpApiEndpoint.get("listProfiles", `${API_PREFIX}/compliance/profiles`, {
      success: Schema.Array(ComplianceRuleProfile),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "activateProfile",
      `${API_PREFIX}/compliance/profiles/:id/activate`,
      {
        params: { id: Schema.String },
        success: ComplianceRuleProfile,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "preflight",
      `${API_PREFIX}/episodes/:id/compliance-preflight`,
      {
        params: { id: Schema.String },
        payload: CompliancePreflightInput,
        success: EpisodeCompliancePreflight,
        error: ApiError,
      },
    ),
  );

const AnalysisGroup = HttpApiGroup.make("analysis").add(
  HttpApiEndpoint.post("runChapter", `${API_PREFIX}/chapters/:id/analysis`, {
    params: { id: Schema.String },
    success: ChapterAnalysisRunResult,
    error: ApiError,
  }),
);

const BackupGroup = HttpApiGroup.make("backups")
  .add(
    HttpApiEndpoint.get("list", `${API_PREFIX}/backups`, {
      success: Schema.Array(BackupRecord),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/backups`, {
      success: BackupRecord,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("restore", `${API_PREFIX}/backups/:id/restore`, {
      params: { id: Schema.String },
      success: BackupRecord,
      error: ApiError,
    }),
  );

const ExportGroup = HttpApiGroup.make("exports").add(
  HttpApiEndpoint.get("project", `${API_PREFIX}/exports/projects/:id/:format`, {
    params: { id: Schema.String, format: Schema.String },
    success: ExportDocument,
    error: ApiError,
  }),
);

const SourceImportGroup = HttpApiGroup.make("source-imports")
  .add(
    HttpApiEndpoint.post("preview", `${API_PREFIX}/source-imports/preview`, {
      payload: SourceImportPreviewInput,
      success: SourceImportPreviewResponse,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("commit", `${API_PREFIX}/source-imports/:id/commit`, {
      params: { id: Schema.String },
      payload: SourceImportCommitInput,
      success: SourceImportCommitResult,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("discard", `${API_PREFIX}/source-imports/:id`, {
      params: { id: Schema.String },
      success: Empty,
      error: ApiError,
    }),
  );

const ImportExtractionGroup = HttpApiGroup.make("import-extractions")
  .add(
    HttpApiEndpoint.get(
      "list",
      `${API_PREFIX}/projects/:id/import-extractions/change-sets`,
      {
        params: { id: Schema.String },
        success: Schema.Array(ImportExtractionChangeSet),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "updateCandidate",
      `${API_PREFIX}/import-extractions/change-sets/:id/candidates/:candidateId`,
      {
        params: { id: Schema.String, candidateId: Schema.String },
        payload: ImportExtractionCandidatePatch,
        success: ImportExtractionChangeSet,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "adopt",
      `${API_PREFIX}/import-extractions/change-sets/:id/adopt`,
      {
        params: { id: Schema.String },
        payload: ImportExtractionAdoptInput,
        success: ImportExtractionChangeSet,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "undo",
      `${API_PREFIX}/import-extractions/change-sets/:id/undo`,
      {
        params: { id: Schema.String },
        success: ImportExtractionChangeSet,
        error: ApiError,
      },
    ),
  );

const PilotPlanGroup = HttpApiGroup.make("pilot-plans")
  .add(
    HttpApiEndpoint.get("list", `${API_PREFIX}/projects/:id/pilot-plans`, {
      params: { id: Schema.String },
      success: Schema.Array(PilotPlan),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/pilot-plans`, {
      payload: PilotPlanCreateInput,
      success: PilotPlan,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("action", `${API_PREFIX}/pilot-plans/:id/action`, {
      params: { id: Schema.String },
      payload: PilotPlanActionInput,
      success: PilotPlan,
      error: ApiError,
    }),
  );

const WorkflowGroup = HttpApiGroup.make("workflows").add(
  HttpApiEndpoint.post("runEpisode", `${API_PREFIX}/workflows/episodes/run`, {
    payload: EpisodeWorkflowInput,
    success: EpisodeWorkflowResult,
    error: ApiError,
  }),
);

/**
 * 音轨、动态分镜和渲染预检是生产链路的权威接口，不能退回为通用
 * domain_entities 编辑器；服务端据此校验项目归属、镜头版本和素材谱系。
 */
const EpisodeMediaGroup = HttpApiGroup.make("episode-media")
  .add(
    HttpApiEndpoint.get(
      "listVoiceProfiles",
      `${API_PREFIX}/projects/:id/voice-profiles`,
      {
        params: { id: Schema.String },
        success: Schema.Array(VoiceProfile),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("createVoiceProfile", `${API_PREFIX}/voice-profiles`, {
      payload: VoiceProfileInput,
      success: VoiceProfile,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "adoptVoiceProfile",
      `${API_PREFIX}/voice-profiles/:id/adopt`,
      {
        params: { id: Schema.String },
        success: VoiceProfile,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listAudioTracks",
      `${API_PREFIX}/episodes/:id/audio-tracks`,
      {
        params: { id: Schema.String },
        success: Schema.Array(AudioTrack),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("createAudioTrack", `${API_PREFIX}/audio-tracks`, {
      payload: AudioTrackInput,
      success: AudioTrack,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "adoptAudioTrack",
      `${API_PREFIX}/audio-tracks/:id/adopt`,
      {
        params: { id: Schema.String },
        success: AudioTrack,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "initializeAnimatic",
      `${API_PREFIX}/episodes/:id/animatic-initialization`,
      {
        params: { id: Schema.String },
        success: AnimaticInitialization,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listAnimatics",
      `${API_PREFIX}/episodes/:id/animatics`,
      {
        params: { id: Schema.String },
        success: Schema.Array(AnimaticDraft),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("createAnimatic", `${API_PREFIX}/animatics`, {
      payload: AnimaticDraftInput,
      success: AnimaticDraft,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "reviewAnimatic",
      `${API_PREFIX}/animatics/:id/review`,
      {
        params: { id: Schema.String },
        payload: AnimaticReviewInput,
        success: AnimaticDraft,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "renderPreflight",
      `${API_PREFIX}/episodes/:id/render-preflight`,
      {
        params: { id: Schema.String },
        success: EpisodeRenderPreflight,
        error: ApiError,
      },
    ),
  );

const ImageGenerationGroup = HttpApiGroup.make("image-generation").add(
  HttpApiEndpoint.post("run", `${API_PREFIX}/image-generation/runs`, {
    payload: ImageGenerationInput,
    success: ImageGenerationRun,
    error: ApiError,
  }),
);

const TtsGenerationGroup = HttpApiGroup.make("tts-generation").add(
  HttpApiEndpoint.post("run", `${API_PREFIX}/tts-generation/runs`, {
    payload: TtsGenerationInput,
    success: TtsGenerationRun,
    error: ApiError,
  }),
);

const VideoGenerationGroup = HttpApiGroup.make("video-generation")
  .add(
    HttpApiEndpoint.post(
      "batchPreflight",
      `${API_PREFIX}/projects/:id/video-generation/batch-preflight`,
      {
        params: { id: Schema.String },
        payload: VideoGenerationBatchPreflightInput,
        success: VideoGenerationBatchPreflight,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "preflight",
      `${API_PREFIX}/shots/:id/video-generation/preflight`,
      {
        params: { id: Schema.String },
        payload: VideoGenerationInput,
        success: VideoGenerationPreflight,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/video-generation/runs`, {
      payload: VideoGenerationInput,
      success: VideoGenerationJob,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listByShot",
      `${API_PREFIX}/shots/:id/video-generation/runs`,
      {
        params: { id: Schema.String },
        success: Schema.Array(VideoGenerationJob),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/video-generation/runs/:id`, {
      params: { id: Schema.String },
      success: VideoGenerationJob,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "refresh",
      `${API_PREFIX}/video-generation/runs/:id/refresh`,
      {
        params: { id: Schema.String },
        success: VideoGenerationJob,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "cancel",
      `${API_PREFIX}/video-generation/runs/:id/cancel`,
      {
        params: { id: Schema.String },
        success: VideoGenerationJob,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "retry",
      `${API_PREFIX}/video-generation/runs/:id/retry`,
      {
        params: { id: Schema.String },
        payload: VideoGenerationRetryInput,
        success: VideoGenerationJob,
        error: ApiError,
      },
    ),
  );

const FeedbackGroup = HttpApiGroup.make("feedback")
  .add(
    HttpApiEndpoint.post("preview", `${API_PREFIX}/feedback/preview`, {
      payload: FeedbackPreviewInput,
      success: FeedbackPreview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("commit", `${API_PREFIX}/feedback/:id/commit`, {
      params: { id: Schema.String },
      payload: FeedbackCommitInput,
      success: FeedbackBatch,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("dashboard", `${API_PREFIX}/projects/:id/feedback`, {
      params: { id: Schema.String },
      success: FeedbackDashboard,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("cluster", `${API_PREFIX}/feedback/clusters`, {
      payload: FeedbackClusterInput,
      success: Schema.Array(FeedbackCluster),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "createRevisionTask",
      `${API_PREFIX}/feedback/clusters/:id/revision-task`,
      {
        params: { id: Schema.String },
        success: Task,
        error: ApiError,
      },
    ),
  );

const DesktopSupportGroup = HttpApiGroup.make("desktop-support")
  .add(
    HttpApiEndpoint.post("createDemo", `${API_PREFIX}/demo/projects`, {
      success: Project,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("diagnostics", `${API_PREFIX}/diagnostics`, {
      success: DiagnosticReport,
      error: ApiError,
    }),
  );

const VisualGroup = HttpApiGroup.make("visuals")
  .add(
    HttpApiEndpoint.post("adoptStill", `${API_PREFIX}/shot-stills/:id/adopt`, {
      params: { id: Schema.String },
      success: DomainEntity,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "adoptVisualAsset",
      `${API_PREFIX}/visual-assets/:id/adopt`,
      {
        params: { id: Schema.String },
        success: DomainEntity,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "lockVisualAsset",
      `${API_PREFIX}/visual-assets/:id/lock`,
      {
        params: { id: Schema.String },
        success: DomainEntity,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("adoptVideo", `${API_PREFIX}/videos/:id/adopt`, {
      params: { id: Schema.String },
      success: DomainEntity,
      error: ApiError,
    }),
  );

const AssetCenterGroup = HttpApiGroup.make("asset-center")
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/projects/:id/asset-center`, {
      params: { id: Schema.String },
      success: AssetCenter,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("preview", `${API_PREFIX}/asset-center/:id/preview`, {
      params: { id: Schema.String },
      success: AssetCenterPreviewMedia,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("action", `${API_PREFIX}/asset-center/:id/action`, {
      params: { id: Schema.String },
      payload: AssetCenterActionInput,
      success: AssetCenter,
      error: ApiError,
    }),
  );

const ProductionGroup = HttpApiGroup.make("production")
  .add(
    HttpApiEndpoint.get(
      "graph",
      `${API_PREFIX}/projects/:id/production-graph`,
      {
        params: { id: Schema.String },
        success: ProductionGraph,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post("impact", `${API_PREFIX}/production/impact`, {
      payload: ProductionImpactInput,
      success: ProductionImpact,
      error: ApiError,
    }),
  );

const GenerationGroup = HttpApiGroup.make("generation")
  .add(
    HttpApiEndpoint.get(
      "list",
      `${API_PREFIX}/projects/:id/generation-ledger`,
      {
        params: { id: Schema.String },
        success: Schema.Array(GenerationRecord),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch("update", `${API_PREFIX}/generation-ledger/:id`, {
      params: { id: Schema.String },
      payload: GenerationRecordPatch,
      success: GenerationRecord,
      error: ApiError,
    }),
  );

const ContentVersionGroup = HttpApiGroup.make("content-versions")
  .add(
    HttpApiEndpoint.get("list", `${API_PREFIX}/projects/:id/content-versions`, {
      params: { id: Schema.String },
      success: Schema.Array(DomainEntity),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post(
      "restore",
      `${API_PREFIX}/content-versions/:id/restore`,
      {
        params: { id: Schema.String },
        success: ContentVersionRestoreResult,
        error: ApiError,
      },
    ),
  );

const TemplateGroup = HttpApiGroup.make("templates").add(
  HttpApiEndpoint.post("run", `${API_PREFIX}/templates/:id/run`, {
    params: { id: Schema.String },
    payload: TemplateRunInput,
    success: TemplateRunResult,
    error: ApiError,
  }),
);

/**
 * 专用改编生产结构接口。不能用通用资料更新时间冒充排序：这些端点会
 * 校验父级、完整 sibling 集合和每一项乐观锁版本，并在一个事务内完成。
 */
const ProductionStructureGroup = HttpApiGroup.make("production-structure")
  .add(
    HttpApiEndpoint.post(
      "selectCurrentAdaptation",
      `${API_PREFIX}/projects/:projectId/current-adaptation`,
      {
        params: { projectId: Schema.String },
        payload: CurrentAdaptationInput,
        success: Project,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "reorderEpisodes",
      `${API_PREFIX}/adaptations/:id/episodes/reorder`,
      {
        params: { id: Schema.String },
        payload: DomainChildrenReorderInput,
        success: DomainChildrenReorderResult,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "reorderScenes",
      `${API_PREFIX}/scripts/:id/scenes/reorder`,
      {
        params: { id: Schema.String },
        payload: DomainChildrenReorderInput,
        success: DomainChildrenReorderResult,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "reorderShots",
      `${API_PREFIX}/scenes/:id/shots/reorder`,
      {
        params: { id: Schema.String },
        payload: DomainChildrenReorderInput,
        success: DomainChildrenReorderResult,
        error: ApiError,
      },
    ),
  );

const ProductionReviewGroup = HttpApiGroup.make("production-reviews")
  .add(
    HttpApiEndpoint.get("getScript", `${API_PREFIX}/scripts/:id/review`, {
      params: { id: Schema.String },
      success: Schema.optional(ScriptReview),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("runScript", `${API_PREFIX}/scripts/:id/review`, {
      params: { id: Schema.String },
      success: ScriptReview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeScript", `${API_PREFIX}/scripts/:id/review`, {
      params: { id: Schema.String },
      success: Empty,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("getShot", `${API_PREFIX}/shots/:id/review`, {
      params: { id: Schema.String },
      success: Schema.optional(ShotReview),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("runShot", `${API_PREFIX}/shots/:id/review`, {
      params: { id: Schema.String },
      success: ShotReview,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("removeShot", `${API_PREFIX}/shots/:id/review`, {
      params: { id: Schema.String },
      success: Empty,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get(
      "listPromptVersions",
      `${API_PREFIX}/shots/:id/prompt-versions`,
      {
        params: { id: Schema.String },
        success: Schema.Array(PromptVersion),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "appendPromptVersion",
      `${API_PREFIX}/shots/:id/prompt-versions`,
      {
        params: { id: Schema.String },
        payload: PromptVersionInput,
        success: PromptVersion,
        error: ApiError,
      },
    ),
  );

const AdaptationAnalysisGroup = HttpApiGroup.make("adaptation-analysis")
  .add(
    HttpApiEndpoint.get(
      "get",
      `${API_PREFIX}/adaptations/:id/episode-analysis`,
      {
        params: { id: Schema.String },
        success: Schema.optional(EpisodeAnalysis),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "run",
      `${API_PREFIX}/adaptations/:id/episode-analysis`,
      {
        params: { id: Schema.String },
        success: EpisodeAnalysis,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "remove",
      `${API_PREFIX}/adaptations/:id/episode-analysis`,
      {
        params: { id: Schema.String },
        success: Empty,
        error: ApiError,
      },
    ),
  );

const CreativeGroup = HttpApiGroup.make("creative")
  .add(
    HttpApiEndpoint.get(
      "listCaseStudies",
      `${API_PREFIX}/creative/case-studies`,
      {
        success: Schema.Array(CreativeCaseStudy),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "createCaseStudy",
      `${API_PREFIX}/creative/case-studies`,
      {
        payload: CreativeCaseStudyInput,
        success: CreativeCaseStudy,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.patch(
      "updateCaseStudy",
      `${API_PREFIX}/creative/case-studies/:id`,
      {
        params: { id: Schema.String },
        payload: CreativeCaseStudyPatch,
        success: CreativeCaseStudy,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.delete(
      "removeCaseStudy",
      `${API_PREFIX}/creative/case-studies/:id`,
      {
        params: { id: Schema.String },
        success: Empty,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listDiagnostics",
      `${API_PREFIX}/projects/:id/creative-diagnostics`,
      {
        params: { id: Schema.String },
        success: Schema.Array(CreativeDiagnostic),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "runDiagnostics",
      `${API_PREFIX}/creative/diagnostics`,
      {
        payload: CreativeDiagnosticInput,
        success: CreativeDiagnosticRunResult,
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.get(
      "listIssueAcknowledgements",
      `${API_PREFIX}/projects/:id/creative-issue-acknowledgements`,
      {
        params: { id: Schema.String },
        success: Schema.Array(CreativeIssueAcknowledgement),
        error: ApiError,
      },
    ),
  )
  .add(
    HttpApiEndpoint.post(
      "acknowledgeIssue",
      `${API_PREFIX}/creative/issue-acknowledgements`,
      {
        payload: CreativeIssueAcknowledgementInput,
        success: CreativeIssueAcknowledgement,
        error: ApiError,
      },
    ),
  );

/**
 * All remaining product domains use this versioned resource envelope.  Individual
 * editors may add domain-specific endpoints later, but every route is still
 * contract-first and is served only beneath /api/v1.
 */
const ResourceGroup = HttpApiGroup.make("resources")
  .add(
    HttpApiEndpoint.get("list", `${API_PREFIX}/:domain`, {
      params: { domain: Schema.String },
      success: Schema.Array(DomainEntity),
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.post("create", `${API_PREFIX}/:domain`, {
      params: { domain: Schema.String },
      payload: DomainEntityInput,
      success: DomainEntity,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.get("get", `${API_PREFIX}/:domain/:id`, {
      params: { domain: Schema.String, id: Schema.String },
      success: DomainEntity,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.patch("update", `${API_PREFIX}/:domain/:id`, {
      params: { domain: Schema.String, id: Schema.String },
      payload: DomainEntityPatch,
      success: DomainEntity,
      error: ApiError,
    }),
  )
  .add(
    HttpApiEndpoint.delete("remove", `${API_PREFIX}/:domain/:id`, {
      params: { domain: Schema.String, id: Schema.String },
      success: Empty,
      error: ApiError,
    }),
  );

export const StudioApi = HttpApi.make("dramaip")
  .add(ProjectGroup)
  .add(ChapterGroup)
  .add(TaskGroup)
  .add(RevisionGroup)
  .add(AgentGroup)
  .add(AgentEngineGroup)
  .add(AgentExperimentGroup)
  .add(ChangePreviewGroup)
  .add(ProviderActionPreviewGroup)
  .add(CodexAuthGroup)
  .add(ProviderGroup)
  .add(StoryBibleGroup)
  .add(ProjectPackageGroup)
  .add(LocalizationGroup)
  .add(DeliveryGroup)
  .add(PlatformDeliveryGroup)
  .add(ReviewEditorGroup)
  .add(ComplianceGroup)
  .add(AnalysisGroup)
  .add(SearchGroup)
  .add(BackupGroup)
  .add(ExportGroup)
  .add(SourceImportGroup)
  .add(ImportExtractionGroup)
  .add(PilotPlanGroup)
  .add(WorkflowGroup)
  .add(EpisodeMediaGroup)
  .add(ImageGenerationGroup)
  .add(TtsGenerationGroup)
  .add(VideoGenerationGroup)
  .add(FeedbackGroup)
  .add(DesktopSupportGroup)
  .add(VisualGroup)
  .add(AssetCenterGroup)
  .add(ProductionGroup)
  .add(GenerationGroup)
  .add(ContentVersionGroup)
  .add(TemplateGroup)
  .add(ProductionStructureGroup)
  .add(ProductionReviewGroup)
  .add(AdaptationAnalysisGroup)
  .add(CreativeGroup)
  .add(ResourceGroup)
  .annotateMerge(
    OpenApi.annotations({ title: "DramaIP API", version: "1.0.0" }),
  );

export type StudioApi = typeof StudioApi;
