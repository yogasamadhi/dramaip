/* 此文件封装由四引擎 alpha.3 OpenAPI 快照生成的第一方 Client。 */
import {
  type DomainEvent,
  type JsonValue,
  type RealtimeEvent,
  type RuntimeInfo,
} from "@dramaip/contracts";
import type { RuntimeTransport } from "@dramaip/server-connection";
import {
  createGeneratedOpenApiClient,
  requestGeneratedApi,
} from "./openapi-client.js";
import { createEventSubscription } from "./events.js";
import { asApiError, StudioClientError } from "./errors.js";

import type {
  AgentRunInput,
  AgentRun,
  AgentItem,
  AgentEngineDescriptor,
  AgentTaskDescriptor,
  AgentExperiment,
  AgentExperimentInput,
  AgentExperimentReviewInput,
  AgentSession,
  AgentSessionInput,
  AssistantConversationPatch,
  AssistantConversationBindInput,
  AssistantConversationDetail,
  AssistantWebResearchConsentInput,
  AssistantWebResearchSettings,
  AssistantMessageInput,
  AssistantSurface,
  AssistantTurnStart,
  CreativeMemory,
  CreativeMemoryPatch,
  CreativeMemorySettings,
  CreativeMemorySettingsInput,
  InspirationCard,
  InspirationCardInput,
  InspirationCardPatch,
  InspirationMemoryJob,
  InspirationProjectCommitResult,
  InspirationProjectPreview,
  InspirationProjectPreviewInput,
  ChangePreview,
  ChangePreviewContentInput,
  CodexAuthStatus,
  CodexLoginInput,
  CodexLoginResult,
  BackupRecord,
  Chapter,
  CreatorContentRecord,
  ChapterInput,
  ChapterPatch,
  ChapterReorderInput,
  NovelWorkspace,
  ChapterAgentRunInput,
  ChapterAgentRunStart,
  ContinueChapterAgentRunInput,
  ContinueChapterAgentRunStart,
  ChapterVersionRestoreInput,
  DomainEntity,
  DomainEntityInput,
  DomainEntityPatch,
  AssetCenter,
  AssetCenterActionInput,
  AssetCenterPreviewMedia,
  ExportDocument,
  GlobalSearchResponse,
  GlobalAgentSettings,
  GlobalAgentSettingsInput,
  Project,
  ProjectCreationResult,
  ProjectDerivationCommitResult,
  ProjectDerivationInput,
  ProjectDerivationPreview,
  ProjectInitialization,
  ProjectInput,
  ProjectPatch,
  LikenessSubject,
  LikenessPhoto,
  LikenessReferencePreflight,
  ResearchTopic,
  ResearchSearchResponse,
  Series,
  SeriesInput,
  ProjectSeriesInput,
  SeriesLibrary,
  SeriesStoryBible,
  SeriesStoryBibleInput,
  SeriesStoryBibleOverrideInput,
  SeriesStoryBibleUpgradeInput,
  SeriesAssetLink,
  SeriesAssetTransferInput,
  ProjectAgentSettings,
  ProjectAgentSettingsInput,
  ProviderActionPreview,
  RevisionInput,
  RevisionPreview,
  SourceImportCommitInput,
  SourceImportCommitResult,
  SourceImportPreviewInput,
  SourceImportPreviewResponse,
  ImportExtractionAdoptInput,
  ImportExtractionCandidatePatch,
  ImportExtractionChangeSet,
  PilotPlan,
  PilotPlanCreateInput,
  PilotPlanActionInput,
  EpisodeWorkflowInput,
  EpisodeWorkflowResult,
  FeedbackBatch,
  FeedbackCluster,
  FeedbackClusterInput,
  FeedbackCommitInput,
  FeedbackDashboard,
  FeedbackPreview,
  FeedbackPreviewInput,
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
  StoryBibleChangeSetApplyInput,
  StoryBibleChangeSetInput,
  StoryBibleChangeSetStatus,
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
  TimelineManifest,
  TimelineCommandInput,
  TimelineHistoryAvailability,
  TimelineMediaPreview,
  TimelineDeliveryManifest,
  TimelineDeliveryExportFormat,
  AudioAssemblyPreview,
  AudioAssemblyApplyInput,
  EditorExportPreflight,
  ReviewPackage,
  ReviewComment,
  ReviewCommentInput,
  ReviewDecision,
  ReviewDecisionInput,
  ReviewRevisionPreviewInput,
  OfflineReviewImportInput,
  OfflineReviewImportResult,
  CloudReviewConnection,
  CloudReviewConnectionInput,
  CloudReviewPublishInput,
  CloudReviewPublishPreview,
  CloudReviewPublishResult,
  CloudReviewSyncResult,
  CloudReviewBinding,
  CloudReviewDeleteResult,
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
  Task,
  TaskInput,
  TaskRetryInput,
} from "@dramaip/contracts/product";
import type {
  AudienceKnowledgeState,
  CorpusCollectionItem,
  CorpusItem,
  CorpusItemInput,
  CorpusItemPatch,
  CreativeExperiment,
  CreativeFingerprint,
  IPTwinSnapshot,
  OriginalityRisk,
  ProvenanceEdge,
  ScenarioRun,
  StoryCausalEdge,
  StoryCausalNode,
} from "@dramaip/contracts";

export type StudioClientOptions = RuntimeTransport;

export interface StudioClient {
  runtime: { info(): Promise<RuntimeInfo> };
  projects: {
    list(): Promise<Project[]>;
    get(id: string): Promise<Project>;
    create(input: ProjectInput): Promise<ProjectCreationResult>;
    update(id: string, input: ProjectPatch): Promise<Project>;
    initialization(id: string): Promise<ProjectInitialization>;
    retryInitialization(id: string): Promise<ProjectInitialization>;
    previewDerivation(
      id: string,
      input: ProjectDerivationInput,
    ): Promise<ProjectDerivationPreview>;
    commitDerivation(
      id: string,
      previewId: string,
    ): Promise<ProjectDerivationCommitResult>;
    listTrash(): Promise<Project[]>;
    trash(id: string): Promise<Project>;
    restore(id: string): Promise<Project>;
    purge(id: string, confirmationTitle: string): Promise<void>;
  };
  series: {
    list(): Promise<Series[]>;
    create(input: SeriesInput): Promise<Series>;
    library(projectId: string): Promise<SeriesLibrary>;
    setProjectSeries(
      projectId: string,
      input: ProjectSeriesInput,
    ): Promise<Project>;
    createStoryBible(
      seriesId: string,
      input: SeriesStoryBibleInput,
    ): Promise<SeriesStoryBible>;
    overrideStoryBible(
      projectId: string,
      storyBibleId: string,
      input: SeriesStoryBibleOverrideInput,
    ): Promise<SeriesStoryBible>;
    upgradeStoryBible(
      projectId: string,
      storyBibleId: string,
      input: SeriesStoryBibleUpgradeInput,
    ): Promise<SeriesStoryBible>;
    transferAsset(
      projectId: string,
      input: SeriesAssetTransferInput,
    ): Promise<SeriesAssetLink>;
  };
  chapters: {
    list(projectId: string): Promise<Chapter[]>;
    get(id: string): Promise<Chapter>;
    create(input: ChapterInput): Promise<Chapter>;
    update(id: string, input: ChapterPatch): Promise<Chapter>;
    reorder(projectId: string, input: ChapterReorderInput): Promise<Chapter[]>;
    remove(id: string): Promise<void>;
  };
  likenessSubjects: {
    list(projectId: string): Promise<LikenessSubject[]>;
    create(
      projectId: string,
      input: {
        displayName: string;
        relationship: "self" | "adult_relative_or_friend" | "minor";
        ageBand: "adult" | "minor_14_to_17" | "under_14";
        contentRestrictions?: string;
      },
    ): Promise<LikenessSubject>;
    consent(
      id: string,
      input: {
        purposeScopes: string[];
        validUntil: string;
        participantConfirmed: boolean;
        guardianConfirmed?: boolean;
        under14SeparateConsentConfirmed?: boolean;
      },
    ): Promise<LikenessSubject>;
    attachPhoto(id: string, grantId: string): Promise<LikenessPhoto>;
    preflight(
      projectId: string,
      subjectIds: string[],
    ): Promise<LikenessReferencePreflight>;
    revoke(id: string): Promise<LikenessSubject>;
  };
  creatorContent: {
    list(
      kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar",
      projectId: string,
    ): Promise<{ items: CreatorContentRecord[]; nextCursor?: string }>;
    create(
      kind: "profile" | "column" | "idea" | "draft" | "variant" | "calendar",
      input: {
        projectId: string;
        title: string;
        parentId?: string;
        status?:
          | "draft"
          | "researching"
          | "review_required"
          | "ready"
          | "scheduled"
          | "archived";
        payload?: Record<string, unknown>;
      },
    ): Promise<CreatorContentRecord>;
  };
  research: {
    listTopics(
      projectId: string,
    ): Promise<{ items: ResearchTopic[]; nextCursor?: string }>;
    createTopic(
      projectId: string,
      input: {
        title: string;
        query: string;
        riskDomain?: "general" | "finance" | "health" | "legal";
      },
    ): Promise<ResearchTopic>;
    search(id: string, query?: string): Promise<ResearchSearchResponse>;
  };
  novelWorkspace: {
    get(projectId: string): Promise<NovelWorkspace>;
    runChapterAgent(
      chapterId: string,
      input: ChapterAgentRunInput,
      idempotencyKey: string,
    ): Promise<ChapterAgentRunStart>;
    continueChapter(
      projectId: string,
      input: ContinueChapterAgentRunInput,
      idempotencyKey: string,
    ): Promise<ContinueChapterAgentRunStart>;
    listChapterVersions(chapterId: string): Promise<DomainEntity[]>;
    restoreChapterVersion(
      chapterId: string,
      versionId: string,
      input: ChapterVersionRestoreInput,
    ): Promise<Chapter>;
  };
  tasks: {
    list(): Promise<Task[]>;
    create(input: TaskInput, idempotencyKey: string): Promise<Task>;
    cancel(id: string): Promise<Task>;
    retry(id: string, input: TaskRetryInput): Promise<Task>;
  };
  revisions: {
    create(
      input: RevisionInput,
      idempotencyKey: string,
    ): Promise<RevisionPreview>;
    get(id: string): Promise<RevisionPreview>;
    commit(id: string, version: number, idempotencyKey: string): Promise<void>;
    discard(id: string, idempotencyKey: string): Promise<RevisionPreview>;
  };
  agentSessions: {
    create(input: AgentSessionInput): Promise<AgentSession>;
    get(id: string): Promise<AgentSession>;
    run(
      id: string,
      input?: AgentRunInput,
      idempotencyKey?: string,
    ): Promise<{ taskId: string; sessionId: string; runId: string }>;
    getRun(id: string): Promise<AgentRun>;
    listItems(id: string): Promise<AgentItem[]>;
    interrupt(id: string): Promise<AgentRun>;
    resume(id: string): Promise<AgentRun>;
    fork(id: string): Promise<AgentSession>;
    dispose(id: string): Promise<void>;
    abort(id: string): Promise<{ ok: true }>;
  };
  assistantConversations: {
    getWebResearchSettings(): Promise<AssistantWebResearchSettings>;
    updateWebResearchSettings(
      input: AssistantWebResearchConsentInput,
    ): Promise<AssistantWebResearchSettings>;
    list(input?: {
      surface?: AssistantSurface;
      projectId?: string;
      archived?: boolean;
    }): Promise<AgentSession[]>;
    create(input: AgentSessionInput): Promise<AgentSession>;
    get(id: string): Promise<AssistantConversationDetail>;
    update(
      id: string,
      input: AssistantConversationPatch,
    ): Promise<AgentSession>;
    bindProject(
      id: string,
      input: AssistantConversationBindInput,
    ): Promise<AgentSession>;
    sendMessage(
      id: string,
      input: AssistantMessageInput,
    ): Promise<AssistantTurnStart>;
    remove(id: string): Promise<void>;
  };
  inspiration: {
    listCards(conversationId: string): Promise<InspirationCard[]>;
    createCard(input: InspirationCardInput): Promise<InspirationCard>;
    updateCard(
      id: string,
      input: InspirationCardPatch,
    ): Promise<InspirationCard>;
    removeCard(id: string): Promise<void>;
    getMemorySettings(): Promise<CreativeMemorySettings>;
    updateMemorySettings(
      input: CreativeMemorySettingsInput,
    ): Promise<CreativeMemorySettings>;
    listMemories(): Promise<CreativeMemory[]>;
    listMemoryJobs(conversationId: string): Promise<InspirationMemoryJob[]>;
    updateMemory(
      id: string,
      input: CreativeMemoryPatch,
    ): Promise<CreativeMemory>;
    removeMemory(id: string): Promise<void>;
    clearMemories(): Promise<void>;
    rebuildMemories(conversationId: string): Promise<{ queued: true }>;
    createProjectPreview(
      input: InspirationProjectPreviewInput,
    ): Promise<InspirationProjectPreview>;
    getProjectPreview(id: string): Promise<InspirationProjectPreview>;
    commitProjectPreview(id: string): Promise<InspirationProjectCommitResult>;
  };
  creativeCorpus: {
    list(input?: {
      query?: string;
      visibility?: "public" | "private";
      limit?: number;
    }): Promise<CorpusItem[]>;
    create(input: CorpusItemInput): Promise<CorpusItem>;
    update(id: string, input: CorpusItemPatch): Promise<CorpusItem>;
    listCollections(): Promise<CorpusCollectionItem[]>;
    collect(input: {
      corpusItemId?: string;
      title: string;
      mechanism: string;
      notes?: string;
      tags?: string[];
    }): Promise<CorpusCollectionItem>;
  };
  creativeFingerprint: {
    get(): Promise<CreativeFingerprint>;
    setEnabled(enabled: boolean): Promise<CreativeFingerprint>;
    update(input: {
      version: number;
      dimensions?: {
        key: CreativeFingerprint["dimensions"][number]["key"];
        score?: number;
        frozen?: boolean;
      }[];
      avoidances?: string[];
      goals?: string[];
    }): Promise<CreativeFingerprint>;
    clear(): Promise<void>;
  };
  creativeExperiments: {
    list(projectId?: string): Promise<CreativeExperiment[]>;
    create(input: {
      originType: CreativeExperiment["originType"];
      originId?: string;
      projectId?: string;
      prompt: string;
    }): Promise<CreativeExperiment>;
    review(
      id: string,
      input: {
        version: number;
        selectedVariantId?: string;
        rejected?: boolean;
      },
    ): Promise<CreativeExperiment>;
  };
  provenance: {
    list(projectId?: string): Promise<ProvenanceEdge[]>;
    create(
      input: Omit<ProvenanceEdge, "id" | "version" | "createdAt">,
    ): Promise<ProvenanceEdge>;
  };
  storyIntelligence: {
    graph(projectId: string): Promise<{
      nodes: StoryCausalNode[];
      edges: StoryCausalEdge[];
      audienceStates: AudienceKnowledgeState[];
    }>;
    createNode(
      projectId: string,
      input: Omit<
        StoryCausalNode,
        "id" | "projectId" | "version" | "createdAt" | "updatedAt"
      >,
    ): Promise<StoryCausalNode>;
    createEdge(
      projectId: string,
      input: Omit<
        StoryCausalEdge,
        "id" | "projectId" | "version" | "createdAt" | "updatedAt"
      >,
    ): Promise<StoryCausalEdge>;
    createAudienceState(
      projectId: string,
      input: Omit<
        AudienceKnowledgeState,
        "id" | "projectId" | "version" | "createdAt" | "updatedAt"
      >,
    ): Promise<AudienceKnowledgeState>;
    buildTwin(projectId: string): Promise<IPTwinSnapshot>;
    createSimulation(
      projectId: string,
      input: { snapshotId: string; hypothesis: string },
    ): Promise<ScenarioRun>;
    originalityRisks(projectId: string): Promise<OriginalityRisk[]>;
  };
  agentEngines: {
    list(): Promise<AgentEngineDescriptor[]>;
    listTasks(): Promise<AgentTaskDescriptor[]>;
    getGlobalSettings(): Promise<GlobalAgentSettings>;
    updateGlobalSettings(
      input: GlobalAgentSettingsInput,
    ): Promise<GlobalAgentSettings>;
    getProjectSettings(projectId: string): Promise<ProjectAgentSettings>;
    updateProjectSettings(
      projectId: string,
      input: ProjectAgentSettingsInput,
    ): Promise<ProjectAgentSettings>;
    codexAuthStatus(): Promise<CodexAuthStatus>;
    codexLogin(input: CodexLoginInput): Promise<CodexLoginResult>;
    codexLogout(): Promise<CodexAuthStatus>;
  };
  agentExperiments: {
    create(
      input: AgentExperimentInput,
      idempotencyKey: string,
    ): Promise<AgentExperiment>;
    get(id: string): Promise<AgentExperiment>;
    review(
      id: string,
      input: AgentExperimentReviewInput,
    ): Promise<AgentExperiment>;
    reveal(id: string): Promise<AgentExperiment>;
  };
  changePreviews: {
    get(id: string): Promise<ChangePreview>;
    updateContent(
      id: string,
      input: ChangePreviewContentInput,
    ): Promise<ChangePreview>;
    commit(id: string, idempotencyKey: string): Promise<ChangePreview>;
    discard(id: string, idempotencyKey: string): Promise<ChangePreview>;
  };
  providerActionPreviews: {
    get(id: string): Promise<ProviderActionPreview>;
    execute(id: string, idempotencyKey: string): Promise<Task>;
    discard(id: string, idempotencyKey: string): Promise<ProviderActionPreview>;
  };
  providers: {
    testConnection(id: string): Promise<ProviderConnectionResult>;
    activateForAgent(id: string): Promise<AgentProviderActivationResult>;
  };
  storyBible: {
    settings(projectId: string): Promise<StoryBibleSettings>;
    updateSettings(
      projectId: string,
      input: { autoSuggest: boolean },
    ): Promise<StoryBibleSettings>;
    list(projectId: string): Promise<StoryBibleChangeSet[]>;
    stale(projectId: string): Promise<StoryBibleStaleMark[]>;
    queue(input: StoryBibleChangeSetInput): Promise<StoryBibleChangeSet>;
    apply(
      id: string,
      input: StoryBibleChangeSetApplyInput,
    ): Promise<StoryBibleChangeSet>;
    undo(id: string): Promise<StoryBibleChangeSet>;
    setStatus(
      id: string,
      status: Extract<
        StoryBibleChangeSetStatus,
        "queued" | "paused" | "skipped" | "discarded"
      >,
    ): Promise<StoryBibleChangeSet>;
  };
  importExtractions: {
    list(projectId: string): Promise<ImportExtractionChangeSet[]>;
    updateCandidate(
      id: string,
      candidateId: string,
      input: ImportExtractionCandidatePatch,
    ): Promise<ImportExtractionChangeSet>;
    adopt(
      id: string,
      input?: ImportExtractionAdoptInput,
    ): Promise<ImportExtractionChangeSet>;
    undo(id: string): Promise<ImportExtractionChangeSet>;
  };
  pilotPlans: {
    list(projectId: string): Promise<PilotPlan[]>;
    create(input: PilotPlanCreateInput): Promise<PilotPlan>;
    action(id: string, input: PilotPlanActionInput): Promise<PilotPlan>;
  };
  projectPackages: {
    preview(input: ProjectPackagePreviewInput): Promise<ProjectPackagePreview>;
    commit(
      id: string,
      input?: ProjectPackageCommitInput,
    ): Promise<ProjectPackageCommitResult>;
    discard(id: string): Promise<void>;
  };
  localization: {
    adopt(id: string): Promise<DomainEntity>;
    subtitles(id: string, format: "srt" | "vtt"): Promise<ExportDocument>;
  };
  delivery: { export(id: string): Promise<ExportDocument> };
  platformDelivery: {
    listProfiles(): Promise<PlatformDeliveryProfile[]>;
    listVariants(adaptationId: string): Promise<DeliveryCreativeVariant[]>;
    createVariant(
      adaptationId: string,
      input: DeliveryCreativeVariantInput,
    ): Promise<DeliveryCreativeVariant>;
    adoptVariant(id: string): Promise<DeliveryCreativeVariant>;
    listArchives(episodeId: string): Promise<PlatformDeliveryArchive[]>;
    preflight(
      episodeId: string,
      input: PlatformDeliveryPreflightInput,
    ): Promise<PlatformDeliveryPreflight>;
    createArchive(
      episodeId: string,
      input: PlatformDeliveryPreflightInput,
    ): Promise<PlatformDeliveryArchive>;
    exportArchive(id: string): Promise<ExportDocument>;
  };
  timeline: {
    get(episodeId: string): Promise<TimelineManifest>;
    command(id: string, input: TimelineCommandInput): Promise<TimelineManifest>;
    undo(id: string): Promise<TimelineManifest>;
    redo(id: string): Promise<TimelineManifest>;
    history(id: string): Promise<TimelineHistoryAvailability>;
    preview(id: string): Promise<TimelineMediaPreview>;
    deliveryManifest(episodeId: string): Promise<TimelineDeliveryManifest>;
    exportDelivery(
      episodeId: string,
      format: TimelineDeliveryExportFormat,
    ): Promise<ExportDocument>;
    audioAssemblyPreview(episodeId: string): Promise<AudioAssemblyPreview>;
    applyAudioAssembly(
      episodeId: string,
      input: AudioAssemblyApplyInput,
    ): Promise<TimelineManifest>;
  };
  reviewEditor: {
    timeline(episodeId: string): Promise<EditorTimelineManifest>;
    preflight(episodeId: string): Promise<EditorExportPreflight>;
    exportTimeline(
      episodeId: string,
      format: "json" | "edl" | "fcpxml" | "srt",
    ): Promise<ExportDocument>;
    listPackages(episodeId: string): Promise<ReviewPackage[]>;
    createPackage(episodeId: string): Promise<ReviewPackage>;
    exportPackage(id: string): Promise<ExportDocument>;
    listComments(packageId: string): Promise<ReviewComment[]>;
    createComment(
      packageId: string,
      input: ReviewCommentInput,
    ): Promise<ReviewComment>;
    resolveComment(id: string, resolved: boolean): Promise<ReviewComment>;
    listDecisions(packageId: string): Promise<ReviewDecision[]>;
    createDecision(
      packageId: string,
      input: ReviewDecisionInput,
    ): Promise<ReviewDecision>;
    createRevisionPreview(
      packageId: string,
      input: ReviewRevisionPreviewInput,
    ): Promise<ChangePreview>;
    importOffline(
      packageId: string,
      input: OfflineReviewImportInput,
    ): Promise<OfflineReviewImportResult>;
  };
  cloudReview: {
    connection(): Promise<CloudReviewConnection>;
    saveConnection(
      input: CloudReviewConnectionInput,
    ): Promise<CloudReviewConnection>;
    preview(
      packageId: string,
      input: CloudReviewPublishInput,
    ): Promise<CloudReviewPublishPreview>;
    publish(
      packageId: string,
      input: CloudReviewPublishInput,
    ): Promise<CloudReviewPublishResult>;
    sync(packageId: string): Promise<CloudReviewSyncResult>;
    binding(packageId: string): Promise<CloudReviewBinding>;
    delete(packageId: string): Promise<CloudReviewDeleteResult>;
  };
  compliance: {
    listProfiles(): Promise<ComplianceRuleProfile[]>;
    activateProfile(id: string): Promise<ComplianceRuleProfile>;
    preflight(
      episodeId: string,
      input: CompliancePreflightInput,
    ): Promise<EpisodeCompliancePreflight>;
  };
  episodeMedia: {
    listVoiceProfiles(projectId: string): Promise<VoiceProfile[]>;
    createVoiceProfile(input: VoiceProfileInput): Promise<VoiceProfile>;
    adoptVoiceProfile(id: string): Promise<VoiceProfile>;
    listAudioTracks(episodeId: string): Promise<AudioTrack[]>;
    createAudioTrack(input: AudioTrackInput): Promise<AudioTrack>;
    adoptAudioTrack(id: string): Promise<AudioTrack>;
    initializeAnimatic(episodeId: string): Promise<AnimaticInitialization>;
    listAnimatics(episodeId: string): Promise<AnimaticDraft[]>;
    createAnimatic(input: AnimaticDraftInput): Promise<AnimaticDraft>;
    reviewAnimatic(
      id: string,
      input: AnimaticReviewInput,
    ): Promise<AnimaticDraft>;
    renderPreflight(episodeId: string): Promise<EpisodeRenderPreflight>;
  };
  imageGeneration: {
    run(
      input: ImageGenerationInput,
      idempotencyKey: string,
    ): Promise<ImageGenerationRun>;
  };
  ttsGeneration: {
    run(
      input: TtsGenerationInput,
      idempotencyKey: string,
    ): Promise<TtsGenerationRun>;
  };
  videoGeneration: {
    batchPreflight(
      projectId: string,
      input: VideoGenerationBatchPreflightInput,
    ): Promise<VideoGenerationBatchPreflight>;
    preflight(
      shotId: string,
      input: VideoGenerationInput,
    ): Promise<VideoGenerationPreflight>;
    create(
      input: VideoGenerationInput,
      idempotencyKey: string,
    ): Promise<VideoGenerationJob>;
    listByShot(shotId: string): Promise<VideoGenerationJob[]>;
    get(id: string): Promise<VideoGenerationJob>;
    refresh(id: string): Promise<VideoGenerationJob>;
    cancel(id: string): Promise<VideoGenerationJob>;
    retry(
      id: string,
      input: VideoGenerationRetryInput,
      idempotencyKey: string,
    ): Promise<VideoGenerationJob>;
  };
  analysis: { runChapter(id: string): Promise<ChapterAnalysisRunResult> };
  events: {
    subscribe(
      onEvent: (event: DomainEvent | RealtimeEvent) => void,
    ): () => void;
  };
  search: { global(query: string): Promise<GlobalSearchResponse> };
  backups: {
    list(): Promise<BackupRecord[]>;
    create(): Promise<BackupRecord>;
    restore(id: string): Promise<BackupRecord>;
  };
  exports: {
    project(
      id: string,
      format:
        | "json"
        | "markdown"
        | "submission-markdown"
        | "submission-json"
        | "script"
        | "storyboard"
        | "delivery",
    ): Promise<ExportDocument>;
  };
  sourceImports: {
    preview(
      input: SourceImportPreviewInput,
    ): Promise<SourceImportPreviewResponse>;
    commit(
      id: string,
      input: SourceImportCommitInput,
    ): Promise<SourceImportCommitResult>;
    discard(id: string): Promise<void>;
  };
  workflows: {
    runEpisode(
      input: EpisodeWorkflowInput,
      idempotencyKey: string,
    ): Promise<EpisodeWorkflowResult>;
  };
  feedback: {
    preview(input: FeedbackPreviewInput): Promise<FeedbackPreview>;
    commit(id: string, input: FeedbackCommitInput): Promise<FeedbackBatch>;
    dashboard(projectId: string): Promise<FeedbackDashboard>;
    cluster(input: FeedbackClusterInput): Promise<FeedbackCluster[]>;
    createRevisionTask(
      clusterId: string,
      idempotencyKey: string,
    ): Promise<Task>;
  };
  support: {
    createDemoProject(): Promise<Project>;
    diagnostics(): Promise<DiagnosticReport>;
  };
  visuals: {
    adoptStill(id: string): Promise<DomainEntity>;
    adoptVisualAsset(id: string): Promise<DomainEntity>;
    lockVisualAsset(id: string): Promise<DomainEntity>;
    adoptVideo(id: string): Promise<DomainEntity>;
  };
  assetCenter: {
    get(projectId: string): Promise<AssetCenter>;
    preview(id: string): Promise<AssetCenterPreviewMedia>;
    action(id: string, input: AssetCenterActionInput): Promise<AssetCenter>;
  };
  production: {
    graph(projectId: string): Promise<ProductionGraph>;
    impact(input: ProductionImpactInput): Promise<ProductionImpact>;
  };
  generation: {
    list(projectId: string): Promise<GenerationRecord[]>;
    update(id: string, patch: GenerationRecordPatch): Promise<GenerationRecord>;
  };
  contentVersions: {
    list(projectId: string): Promise<DomainEntity[]>;
    restore(id: string): Promise<ContentVersionRestoreResult>;
  };
  templates: {
    run(id: string, input: TemplateRunInput): Promise<TemplateRunResult>;
  };
  productionStructure: {
    selectCurrentAdaptation(
      projectId: string,
      input: CurrentAdaptationInput,
    ): Promise<Project>;
    reorderEpisodes(
      adaptationId: string,
      input: DomainChildrenReorderInput,
    ): Promise<DomainChildrenReorderResult>;
    reorderScenes(
      scriptId: string,
      input: DomainChildrenReorderInput,
    ): Promise<DomainChildrenReorderResult>;
    reorderShots(
      sceneId: string,
      input: DomainChildrenReorderInput,
    ): Promise<DomainChildrenReorderResult>;
  };
  productionReviews: {
    getScript(id: string): Promise<ScriptReview | undefined>;
    runScript(id: string): Promise<ScriptReview>;
    removeScript(id: string): Promise<void>;
    getShot(id: string): Promise<ShotReview | undefined>;
    runShot(id: string): Promise<ShotReview>;
    removeShot(id: string): Promise<void>;
    listPromptVersions(shotId: string): Promise<PromptVersion[]>;
    appendPromptVersion(
      shotId: string,
      input: PromptVersionInput,
    ): Promise<PromptVersion>;
  };
  adaptationAnalysis: {
    get(adaptationId: string): Promise<EpisodeAnalysis | undefined>;
    run(adaptationId: string): Promise<EpisodeAnalysis>;
    remove(adaptationId: string): Promise<void>;
  };
  creative: {
    listCaseStudies(): Promise<CreativeCaseStudy[]>;
    createCaseStudy(input: CreativeCaseStudyInput): Promise<CreativeCaseStudy>;
    updateCaseStudy(
      id: string,
      input: CreativeCaseStudyPatch,
    ): Promise<CreativeCaseStudy>;
    removeCaseStudy(id: string): Promise<void>;
    listDiagnostics(projectId: string): Promise<CreativeDiagnostic[]>;
    runDiagnostics(
      input: CreativeDiagnosticInput,
    ): Promise<CreativeDiagnosticRunResult>;
    listIssueAcknowledgements(
      projectId: string,
    ): Promise<CreativeIssueAcknowledgement[]>;
    acknowledgeIssue(
      input: CreativeIssueAcknowledgementInput,
    ): Promise<CreativeIssueAcknowledgement>;
  };
  resources: {
    list(
      domain: string,
      projectId?: string,
      parentId?: string,
    ): Promise<DomainEntity[]>;
    get(domain: string, id: string): Promise<DomainEntity>;
    create(domain: string, input: DomainEntityInput): Promise<DomainEntity>;
    update(
      domain: string,
      id: string,
      input: DomainEntityPatch,
    ): Promise<DomainEntity>;
    remove(domain: string, id: string): Promise<void>;
  };
  host: {
    pickFiles(options?: {
      multiple?: boolean;
      extensions?: string[];
    }): Promise<Array<{
      grantId: string;
      kind: "file" | "directory";
      displayName: string;
      expiresAt: string;
      generation: number;
    }> | null>;
    saveTextFile(input: {
      suggestedName: string;
      content: string;
    }): Promise<{ saved: boolean; artifactRef?: string }>;
    openExternal(url: string): Promise<void>;
    revealGrant(grantId: string): Promise<void>;
    revealArtifact(artifactRef: string): Promise<void>;
    captureCredential(input: {
      purpose: string;
      label?: string;
      policyId?: string;
      allowedOrigin?: string;
    }): Promise<{ credentialRef: string }>;
    removeCredential(credentialRef: string): Promise<void>;
    getCredentialStorageStatus(): Promise<{
      available: boolean;
      storage: "local_encrypted_file";
      message?: string;
    }>;
    setWindowTheme(theme: "light" | "dark"): Promise<void>;
  };
  extensions: {
    installed(): Promise<unknown[]>;
    catalog(input: {
      registryId: string;
      url: string;
      keyId: string;
      rootPublicKey: string;
    }): Promise<unknown>;
    installPreview(input: {
      registryId: string;
      pluginId: string;
      version?: string;
    }): Promise<unknown>;
    installCommit(
      input: {
        previewId: string;
        approvedPermissions: string[];
        approvedPublisherChange?: boolean;
        approvedScopes?: Record<string, JsonValue>;
      },
      idempotencyKey: string,
    ): Promise<unknown>;
    enable(pluginId: string): Promise<unknown>;
    disable(pluginId: string): Promise<void>;
    retry(pluginId: string): Promise<unknown>;
    rollback(pluginId: string, idempotencyKey: string): Promise<unknown>;
    uninstall(
      pluginId: string,
      data: "delete" | "export" | "keep",
      idempotencyKey: string,
    ): Promise<unknown>;
    uiContributions(): Promise<unknown[]>;
    invokeCommand(
      pluginId: string,
      commandId: string,
      payload: unknown,
    ): Promise<unknown>;
  };
}

export function createStudioClient(options: StudioClientOptions): StudioClient {
  const generatedClient = createGeneratedOpenApiClient(options);
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const { response, data, error } = await requestGeneratedApi(
      generatedClient,
      path,
      init,
    );
    if (response.status === 204) return undefined as T;
    if (!response.ok)
      throw new StudioClientError(response.status, asApiError(error));
    return data as T;
  };
  const subscribe = createEventSubscription(options);
  return {
    runtime: { info: () => request("/api/v2/runtime") },
    host: {
      pickFiles: (options = {}) =>
        request("/api/v2/system/host/files/pick", {
          method: "POST",
          body: JSON.stringify(options),
        }),
      saveTextFile: (input) =>
        request("/api/v2/system/host/files/save-text", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      openExternal: (url) =>
        request("/api/v2/system/host/open-external", {
          method: "POST",
          body: JSON.stringify({ url }),
        }),
      revealGrant: (grantId) =>
        request("/api/v2/system/host/reveal-grant", {
          method: "POST",
          body: JSON.stringify({ grantId }),
        }),
      revealArtifact: (artifactRef) =>
        request("/api/v2/system/host/reveal-artifact", {
          method: "POST",
          body: JSON.stringify({ artifactRef }),
        }),
      captureCredential: async (input) => {
        const session = await request<{
          captureSessionId: string;
          status: "pending" | "completed" | "canceled" | "expired";
          credentialRef?: string;
          expiresAt: string;
        }>("/api/v2/system/host/credentials/capture-sessions", {
          method: "POST",
          body: JSON.stringify(input),
        });
        while (Date.parse(session.expiresAt) > Date.now()) {
          const current = await request<typeof session>(
            `/api/v2/system/host/credentials/capture-sessions/${encodeURIComponent(session.captureSessionId)}`,
          );
          if (current.status === "completed" && current.credentialRef)
            return { credentialRef: current.credentialRef };
          if (current.status !== "pending")
            throw new Error("凭据输入已取消或过期。");
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error("凭据输入已过期。");
      },
      removeCredential: (credentialRef) =>
        request(
          `/api/v2/system/host/credentials/${encodeURIComponent(credentialRef)}`,
          { method: "DELETE" },
        ),
      getCredentialStorageStatus: () =>
        request("/api/v2/system/host/credentials/status"),
      setWindowTheme: (theme) =>
        request("/api/v2/system/host/window/theme", {
          method: "POST",
          body: JSON.stringify({ theme }),
        }),
    },
    projects: {
      list: () => request("/api/v2/projects"),
      get: (id) => request(`/api/v2/projects/${id}`),
      create: (input) =>
        request("/api/v2/projects", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(input),
        }),
      update: (id, input) =>
        request(`/api/v2/projects/${id}`, {
          method: "PATCH",
          headers: { "If-Match": `"${input.version}"` },
          body: JSON.stringify(input),
        }),
      initialization: (id) =>
        request(`/api/v2/projects/${encodeURIComponent(id)}/initialization`),
      retryInitialization: (id) =>
        request(
          `/api/v2/projects/${encodeURIComponent(id)}/initialization/retry`,
          { method: "POST" },
        ),
      previewDerivation: (id, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(id)}/derivations/preview`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
      commitDerivation: (id, previewId) =>
        request(`/api/v2/projects/${encodeURIComponent(id)}/derivations`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ previewId }),
        }),
      listTrash: () => request("/api/v2/projects/trash"),
      trash: (id) =>
        request(`/api/v2/projects/${id}/trash`, { method: "POST" }),
      restore: (id) =>
        request(`/api/v2/projects/${id}/restore`, { method: "POST" }),
      purge: (id, confirmationTitle) =>
        request(`/api/v2/projects/${id}`, {
          method: "DELETE",
          body: JSON.stringify({ confirmationTitle }),
        }),
    },
    series: {
      list: () => request("/api/v2/series"),
      create: (input) =>
        request("/api/v2/series", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      library: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/series-library`,
        ),
      setProjectSeries: (projectId, input) =>
        request(`/api/v2/projects/${encodeURIComponent(projectId)}/series`, {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      createStoryBible: (seriesId, input) =>
        request(`/api/v2/series/${encodeURIComponent(seriesId)}/story-bible`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      overrideStoryBible: (projectId, storyBibleId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/series-story-bible/${encodeURIComponent(storyBibleId)}/override`,
          { method: "PUT", body: JSON.stringify(input) },
        ),
      upgradeStoryBible: (projectId, storyBibleId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/series-story-bible/${encodeURIComponent(storyBibleId)}/upgrade`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      transferAsset: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/series-assets`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
    },
    chapters: {
      list: (projectId) => request(`/api/v2/projects/${projectId}/chapters`),
      get: (id) => request(`/api/v2/chapters/${id}`),
      create: (input) =>
        request("/api/v2/chapters", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      update: (id, input) =>
        request(`/api/v2/chapters/${id}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      reorder: (projectId, input) =>
        request(`/api/v2/projects/${projectId}/chapters/reorder`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      remove: (id) => request(`/api/v2/chapters/${id}`, { method: "DELETE" }),
    },
    likenessSubjects: {
      list: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/likeness-subjects`,
        ),
      create: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/likeness-subjects`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
      consent: (id, input) =>
        request(`/api/v2/likeness-subjects/${encodeURIComponent(id)}/consent`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      attachPhoto: (id, grantId) =>
        request(`/api/v2/likeness-subjects/${encodeURIComponent(id)}/photos`, {
          method: "POST",
          body: JSON.stringify({ grantId }),
        }),
      preflight: (projectId, subjectIds) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/likeness-reference-preflight`,
          {
            method: "POST",
            body: JSON.stringify({ subjectIds, confirmed: true }),
          },
        ),
      revoke: (id) =>
        request(`/api/v2/likeness-subjects/${encodeURIComponent(id)}/revoke`, {
          method: "POST",
        }),
    },
    creatorContent: {
      list: (kind, projectId) =>
        request(
          `/api/v2/creator/${kind}?projectId=${encodeURIComponent(projectId)}`,
        ),
      create: (kind, input) =>
        request(`/api/v2/creator/${kind}`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    research: {
      listTopics: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/research-topics`,
        ),
      createTopic: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/research-topics`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
      search: (id, query) =>
        request(`/api/v2/research-topics/${encodeURIComponent(id)}/search`, {
          method: "POST",
          body: JSON.stringify(query ? { query } : {}),
        }),
    },
    novelWorkspace: {
      get: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/novel-workspace`,
        ),
      runChapterAgent: (chapterId, input, idempotencyKey) =>
        request(
          `/api/v2/chapters/${encodeURIComponent(chapterId)}/agent-runs`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
            body: JSON.stringify(input),
          },
        ),
      continueChapter: (projectId, input, idempotencyKey) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/chapters/continue`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
            body: JSON.stringify(input),
          },
        ),
      listChapterVersions: (chapterId) =>
        request(`/api/v2/chapters/${encodeURIComponent(chapterId)}/versions`),
      restoreChapterVersion: (chapterId, versionId, input) =>
        request(
          `/api/v2/chapters/${encodeURIComponent(chapterId)}/versions/${encodeURIComponent(versionId)}/restore`,
          { method: "POST", body: JSON.stringify(input) },
        ),
    },
    tasks: {
      list: () => request("/api/v2/tasks"),
      create: (input, idempotencyKey) =>
        request("/api/v2/tasks", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
      cancel: (id) => request(`/api/v2/tasks/${id}/cancel`, { method: "POST" }),
      retry: (id, input) =>
        request(`/api/v2/tasks/${id}/retry`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    revisions: {
      create: (input, idempotencyKey) =>
        request("/api/v2/revisions", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
      get: (id) => request(`/api/v2/revisions/${id}`),
      commit: (id, version, idempotencyKey) =>
        request(`/api/v2/revisions/${id}/commit`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ version }),
        }),
      discard: (id, idempotencyKey) =>
        request(`/api/v2/revisions/${id}/discard`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        }),
    },
    agentSessions: {
      create: (input) =>
        request("/api/v2/agent-sessions", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      get: (id) => request(`/api/v2/agent-sessions/${encodeURIComponent(id)}`),
      run: (id, input = {}, idempotencyKey = crypto.randomUUID()) =>
        request(`/api/v2/agent-sessions/${id}/runs`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
      getRun: (id) => request(`/api/v2/agent-runs/${encodeURIComponent(id)}`),
      listItems: (id) =>
        request(`/api/v2/agent-runs/${encodeURIComponent(id)}/items`),
      interrupt: (id) =>
        request(`/api/v2/agent-runs/${encodeURIComponent(id)}/interrupt`, {
          method: "POST",
        }),
      resume: (id) =>
        request(`/api/v2/agent-runs/${encodeURIComponent(id)}/resume`, {
          method: "POST",
        }),
      fork: (id) =>
        request(`/api/v2/agent-sessions/${encodeURIComponent(id)}/fork`, {
          method: "POST",
        }),
      dispose: (id) =>
        request(`/api/v2/agent-sessions/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      abort: (id) =>
        request(`/api/v2/agent-sessions/${id}/abort`, { method: "POST" }),
    },
    assistantConversations: {
      getWebResearchSettings: () =>
        request("/api/v2/assistant-web-research-settings"),
      updateWebResearchSettings: (input) =>
        request("/api/v2/assistant-web-research-settings", {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      list: (input = {}) => {
        const query = new URLSearchParams();
        if (input.surface) query.set("surface", input.surface);
        if (input.projectId) query.set("projectId", input.projectId);
        if (input.archived !== undefined)
          query.set("archived", String(input.archived));
        const suffix = query.size > 0 ? `?${query.toString()}` : "";
        return request(`/api/v2/assistant-conversations${suffix}`);
      },
      create: (input) =>
        request("/api/v2/assistant-conversations", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      get: (id) =>
        request(`/api/v2/assistant-conversations/${encodeURIComponent(id)}`),
      update: (id, input) =>
        request(`/api/v2/assistant-conversations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      bindProject: (id, input) =>
        request(
          `/api/v2/assistant-conversations/${encodeURIComponent(id)}/bind-project`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      sendMessage: (id, input) =>
        request(
          `/api/v2/assistant-conversations/${encodeURIComponent(id)}/messages`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      remove: (id) =>
        request(`/api/v2/assistant-conversations/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },
    inspiration: {
      listCards: (conversationId) =>
        request(
          `/api/v2/inspiration-cards?conversationId=${encodeURIComponent(conversationId)}`,
        ),
      createCard: (input) =>
        request("/api/v2/inspiration-cards", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      updateCard: (id, input) =>
        request(`/api/v2/inspiration-cards/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "If-Match": `"${input.version}"` },
          body: JSON.stringify(input),
        }),
      removeCard: (id) =>
        request(`/api/v2/inspiration-cards/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      getMemorySettings: () => request("/api/v2/inspiration-memory-settings"),
      updateMemorySettings: (input) =>
        request("/api/v2/inspiration-memory-settings", {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      listMemories: () => request("/api/v2/inspiration-memories"),
      listMemoryJobs: (conversationId) =>
        request(
          `/api/v2/inspiration-memory-jobs?conversationId=${encodeURIComponent(conversationId)}`,
        ),
      updateMemory: (id, input) =>
        request(`/api/v2/inspiration-memories/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "If-Match": `"${input.version}"` },
          body: JSON.stringify(input),
        }),
      removeMemory: (id) =>
        request(`/api/v2/inspiration-memories/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      clearMemories: () =>
        request("/api/v2/inspiration-memories/clear", { method: "POST" }),
      rebuildMemories: (conversationId) =>
        request("/api/v2/inspiration-memories/rebuild", {
          method: "POST",
          body: JSON.stringify({ conversationId }),
        }),
      createProjectPreview: (input) =>
        request("/api/v2/inspiration-project-previews", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(input),
        }),
      getProjectPreview: (id) =>
        request(
          `/api/v2/inspiration-project-previews/${encodeURIComponent(id)}`,
        ),
      commitProjectPreview: (id) =>
        request(
          `/api/v2/inspiration-project-previews/${encodeURIComponent(id)}/commit`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
          },
        ),
    },
    creativeCorpus: {
      list: (input = {}) => {
        const query = new URLSearchParams();
        if (input.query) query.set("query", input.query);
        if (input.visibility) query.set("visibility", input.visibility);
        if (input.limit) query.set("limit", String(input.limit));
        const suffix = query.size ? `?${query.toString()}` : "";
        return request<{ items: CorpusItem[] }>(
          `/api/v2/creative-corpus/items${suffix}`,
        ).then((value) => value.items);
      },
      create: (input) =>
        request("/api/v2/creative-corpus/items", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(input),
        }),
      update: (id, input) =>
        request(`/api/v2/creative-corpus/items/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "If-Match": `"${input.version}"` },
          body: JSON.stringify(input),
        }),
      listCollections: () =>
        request<{ items: CorpusCollectionItem[] }>(
          "/api/v2/creative-corpus/collections",
        ).then((value) => value.items),
      collect: (input) =>
        request("/api/v2/creative-corpus/collections", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(input),
        }),
    },
    creativeFingerprint: {
      get: () => request("/api/v2/creative-fingerprint"),
      setEnabled: (enabled) =>
        request("/api/v2/creative-fingerprint/settings", {
          method: "PUT",
          body: JSON.stringify({ enabled }),
        }),
      update: (input) =>
        request("/api/v2/creative-fingerprint", {
          method: "PATCH",
          headers: { "If-Match": `"${input.version}"` },
          body: JSON.stringify(input),
        }),
      clear: () =>
        request("/api/v2/creative-fingerprint", { method: "DELETE" }),
    },
    creativeExperiments: {
      list: (projectId) =>
        request<{ items: CreativeExperiment[] }>(
          `/api/v2/creative-experiments${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
        ).then((value) => value.items),
      create: (input) =>
        request("/api/v2/creative-experiments", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(input),
        }),
      review: (id, input) =>
        request(
          `/api/v2/creative-experiments/${encodeURIComponent(id)}/review`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify(input),
          },
        ),
    },
    provenance: {
      list: (projectId) =>
        request<{ items: ProvenanceEdge[] }>(
          `/api/v2/provenance${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
        ).then((value) => value.items),
      create: (input) =>
        request("/api/v2/provenance", {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify(input),
        }),
    },
    storyIntelligence: {
      graph: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/story-graph`,
        ),
      createNode: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/story-graph/nodes`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify(input),
          },
        ),
      createEdge: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/story-graph/edges`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify(input),
          },
        ),
      createAudienceState: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/audience-knowledge`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify(input),
          },
        ),
      buildTwin: (projectId) =>
        request(`/api/v2/projects/${encodeURIComponent(projectId)}/ip-twin`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        }),
      createSimulation: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/story-simulations`,
          {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify(input),
          },
        ),
      originalityRisks: (projectId) =>
        request<{ items: OriginalityRisk[] }>(
          `/api/v2/projects/${encodeURIComponent(projectId)}/originality-risks`,
        ).then((value) => value.items),
    },
    agentEngines: {
      list: () => request("/api/v2/agent-engines"),
      listTasks: () => request("/api/v2/agent-tasks"),
      getGlobalSettings: () => request("/api/v2/agent-settings"),
      updateGlobalSettings: (input) =>
        request("/api/v2/agent-settings", {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      getProjectSettings: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/agent-settings`,
        ),
      updateProjectSettings: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/agent-settings`,
          { method: "PUT", body: JSON.stringify(input) },
        ),
      codexAuthStatus: () => request("/api/v2/agent-engines/codex/auth"),
      codexLogin: (input) =>
        request("/api/v2/agent-engines/codex/login", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      codexLogout: () =>
        request("/api/v2/agent-engines/codex/logout", { method: "POST" }),
    },
    agentExperiments: {
      create: (input, idempotencyKey) =>
        request("/api/v2/agent-experiments", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
      get: (id) =>
        request(`/api/v2/agent-experiments/${encodeURIComponent(id)}`),
      review: (id, input) =>
        request(`/api/v2/agent-experiments/${encodeURIComponent(id)}/review`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      reveal: (id) =>
        request(`/api/v2/agent-experiments/${encodeURIComponent(id)}/reveal`, {
          method: "POST",
        }),
    },
    changePreviews: {
      get: (id) => request(`/api/v2/change-previews/${encodeURIComponent(id)}`),
      updateContent: (id, input) =>
        request(`/api/v2/change-previews/${encodeURIComponent(id)}/content`, {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      commit: (id, idempotencyKey) =>
        request(`/api/v2/change-previews/${encodeURIComponent(id)}/commit`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        }),
      discard: (id, idempotencyKey) =>
        request(`/api/v2/change-previews/${encodeURIComponent(id)}/discard`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
        }),
    },
    providerActionPreviews: {
      get: (id) =>
        request(`/api/v2/provider-action-previews/${encodeURIComponent(id)}`),
      execute: (id, idempotencyKey) =>
        request(
          `/api/v2/provider-action-previews/${encodeURIComponent(id)}/execute`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
          },
        ),
      discard: (id, idempotencyKey) =>
        request(
          `/api/v2/provider-action-previews/${encodeURIComponent(id)}/discard`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
          },
        ),
    },
    providers: {
      testConnection: (id) =>
        request(`/api/v2/providers/${encodeURIComponent(id)}/test-connection`, {
          method: "POST",
        }),
      activateForAgent: (id) =>
        request(
          `/api/v2/providers/${encodeURIComponent(id)}/activate-for-agent`,
          { method: "POST" },
        ),
    },
    storyBible: {
      settings: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/story-bible/settings`,
        ),
      updateSettings: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/story-bible/settings`,
          {
            method: "PUT",
            body: JSON.stringify(input),
          },
        ),
      list: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/story-bible/change-sets`,
        ),
      stale: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/story-bible/stale`,
        ),
      queue: (input) =>
        request("/api/v2/story-bible/change-sets", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      apply: (id, input) =>
        request(
          `/api/v2/story-bible/change-sets/${encodeURIComponent(id)}/apply`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
      undo: (id) =>
        request(
          `/api/v2/story-bible/change-sets/${encodeURIComponent(id)}/undo`,
          {
            method: "POST",
          },
        ),
      setStatus: (id, status) =>
        request(
          `/api/v2/story-bible/change-sets/${encodeURIComponent(id)}/status`,
          {
            method: "PATCH",
            body: JSON.stringify({ status }),
          },
        ),
    },
    importExtractions: {
      list: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/import-extractions/change-sets`,
        ),
      updateCandidate: (id, candidateId, input) =>
        request(
          `/api/v2/import-extractions/change-sets/${encodeURIComponent(id)}/candidates/${encodeURIComponent(candidateId)}`,
          {
            method: "PATCH",
            body: JSON.stringify(input),
          },
        ),
      adopt: (id, input = {}) =>
        request(
          `/api/v2/import-extractions/change-sets/${encodeURIComponent(id)}/adopt`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
      undo: (id) =>
        request(
          `/api/v2/import-extractions/change-sets/${encodeURIComponent(id)}/undo`,
          { method: "POST" },
        ),
    },
    pilotPlans: {
      list: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/pilot-plans`,
        ),
      create: (input) =>
        request("/api/v2/pilot-plans", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      action: (id, input) =>
        request(`/api/v2/pilot-plans/${encodeURIComponent(id)}/action`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    projectPackages: {
      preview: (input) =>
        request("/api/v2/project-packages/preview", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      commit: (id, input = {}) =>
        request(`/api/v2/project-packages/${encodeURIComponent(id)}/commit`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      discard: (id) =>
        request(`/api/v2/project-packages/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },
    localization: {
      adopt: (id) =>
        request(`/api/v2/localization/${encodeURIComponent(id)}/adopt`, {
          method: "POST",
        }),
      subtitles: (id, format) =>
        request(
          `/api/v2/localization/${encodeURIComponent(id)}/subtitles/${format}`,
        ),
    },
    delivery: {
      export: (id) =>
        request(`/api/v2/delivery/${encodeURIComponent(id)}/export`),
    },
    platformDelivery: {
      listProfiles: () => request("/api/v2/platform-delivery/profiles"),
      listVariants: (adaptationId) =>
        request(
          `/api/v2/adaptations/${encodeURIComponent(adaptationId)}/delivery-variants`,
        ),
      createVariant: (adaptationId, input) =>
        request(
          `/api/v2/adaptations/${encodeURIComponent(adaptationId)}/delivery-variants`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      adoptVariant: (id) =>
        request(`/api/v2/delivery-variants/${encodeURIComponent(id)}/adopt`, {
          method: "POST",
        }),
      listArchives: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/platform-deliveries`,
        ),
      preflight: (episodeId, input) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/platform-delivery/preflight`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      createArchive: (episodeId, input) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/platform-deliveries`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      exportArchive: (id) =>
        request(`/api/v2/platform-deliveries/${encodeURIComponent(id)}/export`),
    },
    timeline: {
      get: (episodeId) =>
        request(`/api/v2/episodes/${encodeURIComponent(episodeId)}/timeline`),
      command: (id, input) =>
        request(`/api/v2/timelines/${encodeURIComponent(id)}/commands`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      undo: (id) =>
        request(`/api/v2/timelines/${encodeURIComponent(id)}/undo`, {
          method: "POST",
        }),
      redo: (id) =>
        request(`/api/v2/timelines/${encodeURIComponent(id)}/redo`, {
          method: "POST",
        }),
      history: (id) =>
        request(`/api/v2/timelines/${encodeURIComponent(id)}/history`),
      preview: (id) =>
        request(`/api/v2/timeline-media/${encodeURIComponent(id)}/preview`),
      deliveryManifest: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/timeline-delivery/manifest`,
        ),
      exportDelivery: (episodeId, format) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/timeline-delivery/export/${encodeURIComponent(format)}`,
        ),
      audioAssemblyPreview: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/audio-assembly/preview`,
        ),
      applyAudioAssembly: (episodeId, input) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/audio-assembly/apply`,
          { method: "POST", body: JSON.stringify(input) },
        ),
    },
    reviewEditor: {
      timeline: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/editor-timeline`,
        ),
      preflight: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/editor-timeline/preflight`,
        ),
      exportTimeline: (episodeId, format) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/editor-timeline/export/${format}`,
        ),
      listPackages: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/review-packages`,
        ),
      createPackage: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/review-packages`,
          { method: "POST" },
        ),
      exportPackage: (id) =>
        request(`/api/v2/review-packages/${encodeURIComponent(id)}/export`),
      listComments: (packageId) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/comments`,
        ),
      createComment: (packageId, input) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/comments`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      resolveComment: (id, resolved) =>
        request(`/api/v2/review-comments/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ resolved }),
        }),
      listDecisions: (packageId) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/decisions`,
        ),
      createDecision: (packageId, input) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/decisions`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      createRevisionPreview: (packageId, input) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/revision-preview`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      importOffline: (packageId, input) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/import-offline`,
          { method: "POST", body: JSON.stringify(input) },
        ),
    },
    cloudReview: {
      connection: () => request("/api/v2/cloud-review/connection"),
      saveConnection: (input) =>
        request("/api/v2/cloud-review/connection", {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      preview: (packageId, input) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/cloud-preview`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      publish: (packageId, input) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/cloud-publish`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      sync: (packageId) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/cloud-sync`,
          { method: "POST" },
        ),
      binding: (packageId) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/cloud-review`,
        ),
      delete: (packageId) =>
        request(
          `/api/v2/review-packages/${encodeURIComponent(packageId)}/cloud-review`,
          { method: "DELETE" },
        ),
    },
    compliance: {
      listProfiles: () => request("/api/v2/compliance/profiles"),
      activateProfile: (id) =>
        request(
          `/api/v2/compliance/profiles/${encodeURIComponent(id)}/activate`,
          {
            method: "POST",
          },
        ),
      preflight: (episodeId, input) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/compliance-preflight`,
          { method: "POST", body: JSON.stringify(input) },
        ),
    },
    episodeMedia: {
      listVoiceProfiles: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/voice-profiles`,
        ),
      createVoiceProfile: (input) =>
        request("/api/v2/voice-profiles", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      adoptVoiceProfile: (id) =>
        request(`/api/v2/voice-profiles/${encodeURIComponent(id)}/adopt`, {
          method: "POST",
        }),
      listAudioTracks: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/audio-tracks`,
        ),
      createAudioTrack: (input) =>
        request("/api/v2/audio-tracks", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      adoptAudioTrack: (id) =>
        request(`/api/v2/audio-tracks/${encodeURIComponent(id)}/adopt`, {
          method: "POST",
        }),
      initializeAnimatic: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/animatic-initialization`,
        ),
      listAnimatics: (episodeId) =>
        request(`/api/v2/episodes/${encodeURIComponent(episodeId)}/animatics`),
      createAnimatic: (input) =>
        request("/api/v2/animatics", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      reviewAnimatic: (id, input) =>
        request(`/api/v2/animatics/${encodeURIComponent(id)}/review`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      renderPreflight: (episodeId) =>
        request(
          `/api/v2/episodes/${encodeURIComponent(episodeId)}/render-preflight`,
        ),
    },
    imageGeneration: {
      run: (input, idempotencyKey) =>
        request("/api/v2/image-generation/runs", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
    },
    ttsGeneration: {
      run: (input, idempotencyKey) =>
        request("/api/v2/tts-generation/runs", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
    },
    videoGeneration: {
      batchPreflight: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/video-generation/batch-preflight`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
      preflight: (shotId, input) =>
        request(
          `/api/v2/shots/${encodeURIComponent(shotId)}/video-generation/preflight`,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
      create: (input, idempotencyKey) =>
        request("/api/v2/video-generation/runs", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
      listByShot: (shotId) =>
        request(
          `/api/v2/shots/${encodeURIComponent(shotId)}/video-generation/runs`,
        ),
      get: (id) =>
        request(`/api/v2/video-generation/runs/${encodeURIComponent(id)}`),
      refresh: (id) =>
        request(
          `/api/v2/video-generation/runs/${encodeURIComponent(id)}/refresh`,
          { method: "POST" },
        ),
      cancel: (id) =>
        request(
          `/api/v2/video-generation/runs/${encodeURIComponent(id)}/cancel`,
          { method: "POST" },
        ),
      retry: (id, input, idempotencyKey) =>
        request(
          `/api/v2/video-generation/runs/${encodeURIComponent(id)}/retry`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
            body: JSON.stringify(input),
          },
        ),
    },
    analysis: {
      runChapter: (id) =>
        request(`/api/v2/chapters/${encodeURIComponent(id)}/analysis`, {
          method: "POST",
        }),
    },
    events: { subscribe },
    search: {
      global: (query) => request(`/api/v2/search/${encodeURIComponent(query)}`),
    },
    backups: {
      list: () => request("/api/v2/backups"),
      create: () => request("/api/v2/backups", { method: "POST" }),
      restore: (id) =>
        request(`/api/v2/backups/${id}/restore`, { method: "POST" }),
    },
    exports: {
      project: (id, format) =>
        request(`/api/v2/exports/projects/${encodeURIComponent(id)}/${format}`),
    },
    sourceImports: {
      preview: (input) =>
        request("/api/v2/source-imports/preview", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      commit: (id, input) =>
        request(`/api/v2/source-imports/${encodeURIComponent(id)}/commit`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      discard: (id) =>
        request(`/api/v2/source-imports/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },
    workflows: {
      runEpisode: (input, idempotencyKey) =>
        request("/api/v2/workflows/episodes/run", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
    },
    feedback: {
      preview: (input) =>
        request("/api/v2/feedback/preview", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      commit: (id, input) =>
        request(`/api/v2/feedback/${encodeURIComponent(id)}/commit`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      dashboard: (projectId) =>
        request(`/api/v2/projects/${encodeURIComponent(projectId)}/feedback`),
      cluster: (input) =>
        request("/api/v2/feedback/clusters", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      createRevisionTask: (clusterId, idempotencyKey) =>
        request(
          `/api/v2/feedback/clusters/${encodeURIComponent(clusterId)}/revision-task`,
          {
            method: "POST",
            headers: { "Idempotency-Key": idempotencyKey },
          },
        ),
    },
    support: {
      createDemoProject: () =>
        request("/api/v2/demo/projects", { method: "POST" }),
      diagnostics: () => request("/api/v2/diagnostics"),
    },
    visuals: {
      adoptStill: (id) =>
        request(`/api/v2/shot-stills/${encodeURIComponent(id)}/adopt`, {
          method: "POST",
        }),
      adoptVisualAsset: (id) =>
        request(`/api/v2/visual-assets/${encodeURIComponent(id)}/adopt`, {
          method: "POST",
        }),
      lockVisualAsset: (id) =>
        request(`/api/v2/visual-assets/${encodeURIComponent(id)}/lock`, {
          method: "POST",
        }),
      adoptVideo: (id) =>
        request(`/api/v2/videos/${encodeURIComponent(id)}/adopt`, {
          method: "POST",
        }),
    },
    assetCenter: {
      get: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/asset-center`,
        ),
      preview: (id) =>
        request(`/api/v2/asset-center/${encodeURIComponent(id)}/preview`),
      action: (id, input) =>
        request(`/api/v2/asset-center/${encodeURIComponent(id)}/action`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    production: {
      graph: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/production-graph`,
        ),
      impact: (input) =>
        request("/api/v2/production/impact", {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    generation: {
      list: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/generation-ledger`,
        ),
      update: (id, patch) =>
        request(`/api/v2/generation-ledger/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
    },
    contentVersions: {
      list: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/content-versions`,
        ),
      restore: (id) =>
        request(`/api/v2/content-versions/${encodeURIComponent(id)}/restore`, {
          method: "POST",
        }),
    },
    templates: {
      run: (id, input) =>
        request(`/api/v2/templates/${encodeURIComponent(id)}/run`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    productionStructure: {
      selectCurrentAdaptation: (projectId, input) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/current-adaptation`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      reorderEpisodes: (adaptationId, input) =>
        request(
          `/api/v2/adaptations/${encodeURIComponent(adaptationId)}/episodes/reorder`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      reorderScenes: (scriptId, input) =>
        request(
          `/api/v2/scripts/${encodeURIComponent(scriptId)}/scenes/reorder`,
          { method: "POST", body: JSON.stringify(input) },
        ),
      reorderShots: (sceneId, input) =>
        request(`/api/v2/scenes/${encodeURIComponent(sceneId)}/shots/reorder`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    productionReviews: {
      getScript: (id) =>
        request(`/api/v2/scripts/${encodeURIComponent(id)}/review`),
      runScript: (id) =>
        request(`/api/v2/scripts/${encodeURIComponent(id)}/review`, {
          method: "POST",
        }),
      removeScript: (id) =>
        request(`/api/v2/scripts/${encodeURIComponent(id)}/review`, {
          method: "DELETE",
        }),
      getShot: (id) =>
        request(`/api/v2/shots/${encodeURIComponent(id)}/review`),
      runShot: (id) =>
        request(`/api/v2/shots/${encodeURIComponent(id)}/review`, {
          method: "POST",
        }),
      removeShot: (id) =>
        request(`/api/v2/shots/${encodeURIComponent(id)}/review`, {
          method: "DELETE",
        }),
      listPromptVersions: (shotId) =>
        request(`/api/v2/shots/${encodeURIComponent(shotId)}/prompt-versions`),
      appendPromptVersion: (shotId, input) =>
        request(`/api/v2/shots/${encodeURIComponent(shotId)}/prompt-versions`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    adaptationAnalysis: {
      get: (adaptationId) =>
        request(
          `/api/v2/adaptations/${encodeURIComponent(adaptationId)}/episode-analysis`,
        ),
      run: (adaptationId) =>
        request(
          `/api/v2/adaptations/${encodeURIComponent(adaptationId)}/episode-analysis`,
          { method: "POST" },
        ),
      remove: (adaptationId) =>
        request(
          `/api/v2/adaptations/${encodeURIComponent(adaptationId)}/episode-analysis`,
          { method: "DELETE" },
        ),
    },
    creative: {
      listCaseStudies: () => request("/api/v2/creative/case-studies"),
      createCaseStudy: (input) =>
        request("/api/v2/creative/case-studies", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      updateCaseStudy: (id, input) =>
        request(`/api/v2/creative/case-studies/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      removeCaseStudy: (id) =>
        request(`/api/v2/creative/case-studies/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      listDiagnostics: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/creative-diagnostics`,
        ),
      runDiagnostics: (input) =>
        request("/api/v2/creative/diagnostics", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      listIssueAcknowledgements: (projectId) =>
        request(
          `/api/v2/projects/${encodeURIComponent(projectId)}/creative-issue-acknowledgements`,
        ),
      acknowledgeIssue: (input) =>
        request("/api/v2/creative/issue-acknowledgements", {
          method: "POST",
          body: JSON.stringify(input),
        }),
    },
    resources: {
      list: (domain, projectId, parentId) =>
        request(
          `/api/v2/${encodeURIComponent(domain)}${
            projectId || parentId
              ? `?${new URLSearchParams({
                  ...(projectId ? { projectId } : {}),
                  ...(parentId ? { parentId } : {}),
                }).toString()}`
              : ""
          }`,
        ),
      get: (domain, id) =>
        request(
          `/api/v2/${encodeURIComponent(domain)}/${encodeURIComponent(id)}`,
        ),
      create: (domain, input) =>
        request(`/api/v2/${encodeURIComponent(domain)}`, {
          method: "POST",
          body: JSON.stringify(input),
        }),
      update: (domain, id, input) =>
        request(
          `/api/v2/${encodeURIComponent(domain)}/${encodeURIComponent(id)}`,
          {
            method: "PATCH",
            headers: { "If-Match": `"${input.version}"` },
            body: JSON.stringify(input),
          },
        ),
      remove: (domain, id) =>
        request(
          `/api/v2/${encodeURIComponent(domain)}/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        ),
    },
    extensions: {
      installed: () => request("/api/v2/system/extensions/installed"),
      catalog: (input) =>
        request("/api/v2/system/extensions/catalog", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      installPreview: (input) =>
        request("/api/v2/system/extensions/install-preview", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      installCommit: (input, idempotencyKey) =>
        request("/api/v2/system/extensions/install-commit", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(input),
        }),
      enable: (pluginId) =>
        request(
          `/api/v2/system/extensions/${encodeURIComponent(pluginId)}/enable`,
          {
            method: "POST",
          },
        ),
      disable: (pluginId) =>
        request(
          `/api/v2/system/extensions/${encodeURIComponent(pluginId)}/disable`,
          {
            method: "POST",
          },
        ),
      retry: (pluginId) =>
        request(
          `/api/v2/system/extensions/${encodeURIComponent(pluginId)}/retry`,
          {
            method: "POST",
          },
        ),
      rollback: (pluginId, idempotencyKey) =>
        request(
          `/api/v2/system/extensions/${encodeURIComponent(pluginId)}/rollback`,
          { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
        ),
      uninstall: (pluginId, data, idempotencyKey) =>
        request(`/api/v2/system/extensions/${encodeURIComponent(pluginId)}`, {
          method: "DELETE",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ data }),
        }),
      uiContributions: () =>
        request("/api/v2/system/extensions/ui-contributions"),
      invokeCommand: (pluginId, commandId, payload) =>
        request(
          `/api/v2/system/extensions/${encodeURIComponent(pluginId)}/commands/${encodeURIComponent(commandId)}`,
          { method: "POST", body: JSON.stringify(payload) },
        ),
    },
  };
}
