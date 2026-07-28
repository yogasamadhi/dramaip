// window.api 类型契约（由 preload 经 contextBridge 暴露）
import type {
  AdaptationProject,
  AnimaticDraft,
  AudioTrack,
  EpisodeRenderArchive,
  EpisodeRenderPreflight,
  EpisodeQualityReport,
  ComplianceRuleProfile,
  EpisodeComplianceArchive,
  EpisodeCompliancePreflight,
  DeliveryCreativeVariant,
  PlatformDeliveryExport,
  PlatformDeliveryPreflight,
  PlatformDeliveryProfile,
  FeedbackComment,
  FeedbackCommentCluster,
  FeedbackImportBatch,
  FeedbackImportPreview,
  FeedbackImportResult,
  FeedbackMetric,
  LocalizationVariant,
  VoiceProfile,
  AgentProfile,
  AiRun,
  AiContextPreview,
  AiBudgetSettings,
  AiVideoFeasibilityReport,
  AntiTropeVariant,
  AssetRightsRecord,
  AudienceSimulation,
  Beat,
  Chapter,
  ChapterMemory,
  Character,
  CharacterState,
  CharacterVisualProfile,
  CaseStudyChapter,
  CaseStudyChapterStatus,
  CaseStudyDocumentWithChapters,
  ContentVersion,
  CreativeCaseStudy,
  DramaTrendReport,
  Episode,
  EpisodeAnalysis,
  Evaluation,
  Foreshadowing,
  FreshnessReport,
  GenerationCostEntry,
  GenerationLineage,
  GenrePreset,
  GenreMarketSnapshot,
  GlobalSearchResponse,
  HighlightAnalysis,
  InspirationFavorite,
  MobileInspirationImportInput,
  MobileInspirationImportSummary,
  LongTask,
  ModelConfig,
  NarrativeCurveReport,
  NovelTaskType,
  Outline,
  Project,
  ProjectDeletionPreview,
  ProjectHomeSummary,
  ProjectAsset,
  ProjectAssetSourceKind,
  ProjectAgentScheme,
  ProjectSkill,
  PromptVersion,
  QualityGateReport,
  QualityIssueAcknowledgement,
  RevisionTask,
  RevisionTaskAdoptResult,
  RevisionTaskPreviewUpdateResult,
  RevisionTaskUndoResult,
  RightsPreflightInput,
  RightsPreflightResult,
  Scene,
  Script,
  ScriptReview,
  Shot,
  ShotReview,
  StoryArc,
  StoryBibleChangeSet,
  StoryBibleSettings,
  StoryEvent,
  TaskModelBinding,
  AiRunUsageSummaryRow,
  AiContextControls,
  Template,
  TemplateRun,
  TrashedProject,
  TextDiffPreviewPayload,
  TtsProviderConfigRecord,
  VideoGenerationTask,
  VideoProviderConfig,
  VideoResult,
  VisualSetting,
  VisualAssetOwnerKind,
  VisualAssetVersion,
  ShotVisualAssetLock,
  ShotStillCandidate,
  ImageProviderConfigRecord,
  AssetCoverageItem,
  FeatureFlagMap,
  GenerationMode,
  GenerationPolicyProfile,
  GenerationRouteDecision,
  ProductionGraphSnapshot,
  ProductionImpact,
  ProductionNodeRef,
  ProviderDataPolicy,
  RetakeOperation,
  RetakeRequest,
  EditorTimelineManifest,
  ReviewComment,
  ReviewDecision,
  ReviewPackageRecord,
  WritingRoomResult,
  WritingRoomTargetKind,
  WorkflowRun,
} from '@sdns/core'

export interface AiTaskInput {
  projectId?: string
  chapterId?: string
  /** 本次章节正文生成的目标字数；允许范围为目标字数 ±300。 */
  chapterWordGoal?: number
  characterId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  taskType: NovelTaskType
  userInstruction?: string
  /** 对话式项目设定的多轮历史 */
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 生成前上下文控制：固定或排除上下文实体 */
  contextControls?: AiContextControls
  /** v0.8 模板驱动生成：渲染后的模板正文（仅 taskType='template_run' 使用） */
  templateContent?: string
  /** v0.8 模板驱动生成：实际复用的生成类 taskType（如 generate_project） */
  templateScope?: NovelTaskType
}

export interface TimelineScopeInput {
  projectId: string
  adaptationProjectId: string
  episodeId: string
  frameRate?: 24 | 25 | 30
  width?: number
  height?: number
}

export interface AiTaskResult {
  ok: boolean
  error?: string
  result?: { kind: string; data: unknown | TextDiffPreviewPayload }
  aiRunId?: string
  longTaskId?: string
}

/** v0.8 编剧室运行结果 */
export interface WritingRoomRunResult {
  ok: boolean
  error?: string
  result?: WritingRoomResult
  aiRunIds?: Record<string, string>
}

/** v0.8 编剧室运行输入 */
export interface WritingRoomRunInput {
  targetKind: WritingRoomTargetKind
  targetId: string
  projectId?: string
  chapterId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  agentIds?: string[]
  userInstruction?: string
}

/** v0.8 模板运行返回（渲染 + 记录 + 可选 ai 输入） */
export interface TemplateRunResult {
  ok: boolean
  error?: string
  templateRunId?: string
  scope?: string
  /** 若 scope 为生成类任务，返回供前端调用 ai.run 的入参 */
  aiInput?: {
    projectId?: string
    taskType: 'template_run'
    templateScope: NovelTaskType
    templateContent: string
    userInstruction?: string
  }
}

export interface ApplyArtifactInput {
  projectId?: string
  taskType: string
  data: unknown
  characterId?: string
  adaptationProjectId?: string
  /** 结构化生成仅采用部分条目时，保留未涉及的已有数据。 */
  partialAdopt?: boolean
}

export interface ApplyArtifactResult {
  ok: boolean
  error?: string
  result?: { kind: string; created: unknown }
}

export interface ExportResult {
  saved: boolean
  path?: string
  /** v1.0：结构化错误（实体未找到 / 写盘失败等），不再抛异常 */
  error?: string
}

export interface DiagnosticExportOptions {
  includeContent?: boolean
}

export interface DiagnosticExportResult extends ExportResult {
  summary?: {
    includeContent: boolean
    logLines: number
    errorLines: number
    appliedMigrationVersion: number
    latestMigrationVersion: number
  }
}

/** v1.0 项目包导入结果 */
export interface ProjectImportResult {
  ok: boolean
  canceled?: boolean
  error?: string
  project?: Project
}

export type SourceImportStrategy = 'append' | 'merge' | 'replace'

export interface SourceImportChapter {
  key: string
  title: string
  content: string
  orderIndex: number
  wordCount: number
  warning?: string
}

export interface SourceImportScene {
  key: string
  title: string
  location: string
  timeOfDay?: string
  visualDescription: string
  characters: string[]
  summary: string
  content: string
  orderIndex: number
  dialogueCount: number
  actionCount: number
}

export interface SourceImportEpisode {
  key: string
  episodeNumber: number
  title: string
  content: string
  scenes: SourceImportScene[]
}

export interface SourceImportPreview {
  fileName: string
  sourceType: 'txt' | 'markdown' | 'docx' | 'epub' | 'script-json' | 'draft'
  contentKind: 'novel' | 'script' | 'draft'
  title: string
  charCount: number
  chapters: SourceImportChapter[]
  episodes: SourceImportEpisode[]
  warnings: string[]
}

export interface SourceImportChooseResult {
  ok: boolean
  canceled?: boolean
  error?: string
  importId?: string
  preview?: SourceImportPreview
  duplicates?: { chapters: string[]; episodes: number[] }
  note?: string
}

export interface SourceImportCommitResult {
  ok: boolean
  error?: string
  result?: {
    createdChapters: number
    updatedChapters: number
    createdEpisodes: number
    createdScripts: number
    updatedScripts: number
    createdScenes: number
    adaptationProjectId?: string
    checkpointCount: number
  }
}

export interface CloudProjectSnapshot {
  id: string
  encryptedBytes: number
  encryptedSha256: string
  createdAt: string
  expiresAt: string
  recoveryKeyAvailable: boolean
}

export interface CreatedCloudProjectSnapshot extends CloudProjectSnapshot {
  recoveryKey: string
}

/** v1.0 模型连接测试结果 */
export interface ModelConnectionTestResult {
  ok: boolean
  error?: string
  latencyMs?: number
  sample?: string
  tokenUsage?: number
}

/** v1.0 Token / 耗用统计行（按模型汇总） */
export interface AiRunSummaryRow {
  model: string
  provider: string
  successCount: number
  failedCount: number
  totalTokens: number
  totalLatencyMs: number
}

export interface AiContextPreviewResult {
  ok: boolean
  error?: string
  preview?: AiContextPreview
}

export interface RevisionTaskPreviewResult {
  ok: boolean
  error?: string
  preview?: TextDiffPreviewPayload
  aiRunId?: string
}

export interface RevisionTaskCompleteResult {
  ok: boolean
  error?: string
  result?: ContentVersion
}

/** v0.7 视频任务操作返回（提交/查询/重试共用） */
export interface VideoTaskOpResult {
  ok: boolean
  error?: string
  longTaskId?: string
  task?: VideoGenerationTask
  results?: VideoResult[]
}

export interface CaseStudyImportDocument {
  fileName: string
  path: string
  sourceType?: string
  text: string
  truncated: boolean
  chapters: CaseStudyImportChapter[]
  parseWarnings: string[]
  error?: string
}

export interface CaseStudyImportChapter {
  orderIndex: number
  title: string
  content: string
  charCount: number
  wordCount: number
  status: CaseStudyChapterStatus
  warning?: string
}

export interface CaseStudyImportResult {
  ok: boolean
  canceled?: boolean
  error?: string
  documents: CaseStudyImportDocument[]
}

export interface SecretStorageStatus {
  /** Compatibility field: this now reflects the local credential file state. */
  encryptionAvailable: boolean
  /** Compatibility field: no operating-system Keychain is accessed. */
  keychainAvailable: boolean
  mode: 'local_file' | 'local_file_unavailable'
  health?: SecretStorageHealth
  lastMigration?: SecretMigrationSummary
  unavailableReason?: string
}

export interface CloudAuthUser {
  id: string
  email: string
  name: string
  emailVerified?: boolean
}

export interface CloudAuthStatus {
  enabled: boolean
  configured: boolean
  signedIn: boolean
  expiresAt?: string
  user?: CloudAuthUser
  error?: string
}

export interface CloudContext {
  user: CloudAuthUser
  subscription: { id: string; plan: string; status: string }
  tokenBalance: { plan: string; quotaTokens: number; usedTokens: number; remainingTokens: number }
}

export interface CloudAIModel {
  provider: string
  model: string
  isDefault: boolean
}

export interface CloudMobileDraft {
  id: string
  clientId: string
  kind: 'inspiration' | 'character' | 'project'
  captureMode: 'text' | 'voice'
  title: string
  content: string
  aiExpansion: string
  createdAt: string
  updatedAt: string
  adoptionCount: number
  lastAdoptedAt: string
  currentProjectAdopted?: boolean
  adoptedInOtherProject?: boolean
}

export interface SecretStateCounts {
  total: number
  empty: number
  localFile: number
  keychain: number
  encrypted: number
  unsafePlaintext: number
  masked: number
  legacyPlaintext: number
  unreadableEncrypted: number
}

export interface SecretStorageHealth {
  checkedAt: string
  encryptionAvailable: boolean
  keychainAvailable: boolean
  modelConfigs: SecretStateCounts
  videoProviderConfigs: SecretStateCounts
  imageProviderConfigs: SecretStateCounts
  ttsProviderConfigs: SecretStateCounts
  totals: SecretStateCounts
}

export interface SecretMigrationSummary {
  checkedAt: string
  keychainAvailable: boolean
  attempted: number
  migrated: number
  skipped: number
  failed: number
  before: SecretStorageHealth
  after: SecretStorageHealth
}

export interface DatabaseBackupInfo {
  fileName: string
  path: string
  sizeBytes: number
  createdAt: string
  kind: 'auto' | 'manual' | 'pre_restore' | 'unknown'
}

export interface DatabaseBackupResult {
  ok: boolean
  error?: string
  backup?: DatabaseBackupInfo
  safetyBackup?: DatabaseBackupInfo
  backups?: DatabaseBackupInfo[]
}

export interface ContentVersionRestoreResult {
  ok: boolean
  error?: string
  result?: ContentVersion
}

export interface LongTaskCancelResult {
  ok: boolean
  error?: string
  task?: LongTask
}

export interface LongTaskRetryResult {
  ok: boolean
  error?: string
  longTaskId?: string
  task?: LongTask
}

export interface BatchTaskRunInput {
  kind: 'scripts' | 'shots'
  projectId?: string
  adaptationProjectId: string
  episodeIds?: string[]
  sceneIds?: string[]
  limit?: number
}

export interface BatchTaskRunResult {
  ok: boolean
  error?: string
  longTaskId?: string
  task?: LongTask
}

export type RendererLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** v0.7 提交视频生成任务的输入 */
export interface CreateVideoTaskInput {
  providerConfigId: string
  projectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  prompt: string
  negativePrompt?: string
  referenceImageUrls?: string[]
  note?: string
}

export interface RetakeRendererInput {
  providerConfigId: string
  projectId: string
  shotId: string
  sourceCandidateId: string
  operation: RetakeOperation
  instruction: string
  preserveFields: string[]
  referenceAssetIds?: string[]
  maskAssetId?: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  quality?: 'low' | 'medium' | 'high'
  outputFormat?: 'png' | 'jpeg' | 'webp'
}

export interface StudioApi {
  search: {
    global(input: { query: string; limit?: number }): Promise<GlobalSearchResponse>
  }
  asset: {
    listByProject(projectId: string): Promise<ProjectAsset[]>
    listBySource(sourceEntityKind: ProjectAssetSourceKind, sourceEntityId: string): Promise<ProjectAsset[]>
    create(data: Partial<ProjectAsset> & { projectId: string; kind: ProjectAsset['kind']; title: string }): Promise<ProjectAsset>
    update(id: string, patch: Partial<ProjectAsset>): Promise<ProjectAsset | undefined>
    remove(id: string): Promise<boolean>
    chooseLocalFile(kind: ProjectAsset['kind']): Promise<{ ok: boolean; canceled?: boolean; path?: string; name?: string; error?: string }>
  }
  generation: {
    listLineagesByProject(projectId: string): Promise<GenerationLineage[]>
    listCostsByProject(projectId: string): Promise<GenerationCostEntry[]>
    updateCost(id: string, patch: { actualCost?: number; currency?: string; actualCostNote?: string }): Promise<GenerationCostEntry | undefined>
  }
  rights: {
    listByProject(projectId: string): Promise<AssetRightsRecord[]>
    create(data: Partial<AssetRightsRecord> & { projectId: string; assetId: string }): Promise<AssetRightsRecord>
    update(id: string, patch: Partial<AssetRightsRecord>): Promise<AssetRightsRecord | undefined>
    preflight(input: RightsPreflightInput): Promise<RightsPreflightResult>
  }
  visualAsset: {
    listByProject(projectId: string): Promise<VisualAssetVersion[]>
    listByOwner(ownerKind: VisualAssetOwnerKind, ownerId: string): Promise<VisualAssetVersion[]>
    create(data: Pick<VisualAssetVersion, 'projectId' | 'ownerKind' | 'ownerId' | 'assetId' | 'slot' | 'label'> & Partial<Pick<VisualAssetVersion, 'notes' | 'status'>>): Promise<VisualAssetVersion>
    adopt(id: string): Promise<VisualAssetVersion | undefined>
    listLocksByShot(shotId: string): Promise<ShotVisualAssetLock[]>
    lockShot(data: Pick<ShotVisualAssetLock, 'projectId' | 'shotId' | 'visualAssetVersionId' | 'role'>): Promise<ShotVisualAssetLock>
  }
  shotStill: {
    listByShot(shotId: string): Promise<ShotStillCandidate[]>
    create(data: Pick<ShotStillCandidate, 'projectId' | 'shotId' | 'assetId' | 'kind' | 'label'> & Pick<Partial<ShotStillCandidate>, 'notes'>): Promise<ShotStillCandidate>
    adopt(id: string): Promise<ShotStillCandidate | undefined>
  }
  imageProvider: {
    list(): Promise<ImageProviderConfigRecord[]>
    getDefault(): Promise<ImageProviderConfigRecord | undefined>
    create(data: Omit<ImageProviderConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ImageProviderConfigRecord>
    update(id: string, patch: Partial<Omit<ImageProviderConfigRecord, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ImageProviderConfigRecord | undefined>
    remove(id: string): Promise<boolean>
    setDefault(id: string): Promise<boolean>
  }
  imageTask: {
    create(input: { providerConfigId: string; projectId: string; shotId: string; kind: 'still' | 'first_frame' | 'last_frame' | 'cover'; prompt: string; size?: '1024x1024' | '1024x1536' | '1536x1024'; quality?: 'low' | 'medium' | 'high'; outputFormat?: 'png' | 'jpeg' | 'webp' }): Promise<{ ok: boolean; error?: string; task?: LongTask; assets?: ProjectAsset[]; candidates?: ShotStillCandidate[] }>
  }
  featureFlags: {
    get(): Promise<FeatureFlagMap>
  }
  productionGraph: {
    get(projectId: string): Promise<ProductionGraphSnapshot>
    coverage(projectId: string): Promise<AssetCoverageItem[]>
    previewImpact(projectId: string, source: ProductionNodeRef): Promise<Array<{ target: ProductionNodeRef; relationPath: string[]; severity: 'info' | 'warning' | 'blocker' }>>
    resolveImpact(id: string, status: 'accepted' | 'resolved' | 'waived', note?: string): Promise<ProductionImpact | undefined>
  }
  retake: {
    preflight(input: RetakeRendererInput): Promise<{ canSubmit: boolean; issues: Array<{ code: string; message: string }> }>
    create(input: RetakeRendererInput): Promise<{ ok: boolean; error?: string; request?: RetakeRequest; task?: LongTask; candidate?: ShotStillCandidate; asset?: ProjectAsset; lineageId?: string }>
    list(projectId: string, shotId?: string): Promise<RetakeRequest[]>
    adopt(id: string): Promise<{ request: RetakeRequest; candidate: ShotStillCandidate } | undefined>
    discard(id: string): Promise<RetakeRequest | undefined>
  }
  generationRouting: {
    listPolicies(projectId?: string): Promise<GenerationPolicyProfile[]>
    savePolicy(input: Omit<GenerationPolicyProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<GenerationPolicyProfile>
    listDataPolicies(): Promise<ProviderDataPolicy[]>
    saveDataPolicy(input: Omit<ProviderDataPolicy, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProviderDataPolicy>
    decision(input: { projectId?: string; mode: GenerationMode; allowedProviderConfigIds?: string[]; maximumProviders?: number }): Promise<GenerationRouteDecision>
  }
  analytics: {
    getConsent(): Promise<{ consent: 'unknown' | 'granted' | 'denied'; installationId: string; decidedAt?: string; updatedAt: string }>
    setConsent(consent: 'granted' | 'denied'): Promise<{ consent: 'unknown' | 'granted' | 'denied'; installationId: string; decidedAt?: string; updatedAt: string }>
    record(input: { eventName: 'demo_opened' | 'first_shot_ready' | 'retake_started' | 'retake_succeeded' | 'retake_adopted' | 'review_exported' | 'review_published' | 'editor_exported'; durationBucket?: string; resultCode?: string }): Promise<boolean>
    exportLocal(): Promise<{ settings: Record<string, unknown>; events: Array<Record<string, unknown>> }>
    clearPending(): Promise<number>
  }
  review: {
    exportOffline(input: TimelineScopeInput): Promise<{ saved: boolean; canceled?: boolean; path?: string; packageId?: string; error?: string }>
    importOffline(): Promise<{ imported: boolean; canceled?: boolean; packageId?: string; commentCount?: number; decisionCount?: number; error?: string }>
    publishCloud(): Promise<{ published: boolean; error?: string }>
    sync(projectId: string, episodeId?: string): Promise<{ packages: ReviewPackageRecord[]; comments: ReviewComment[]; decisions: ReviewDecision[] }>
    delete(id: string): Promise<ReviewPackageRecord | undefined>
  }
  editorExport: {
    preflight(input: TimelineScopeInput): Promise<{ manifest: EditorTimelineManifest; preflight: { canExport: boolean; blockers: string[]; warnings: Array<{ code: string; clipId?: string; message: string }>; totalDurationSeconds: number }; openProductionBlockers: number }>
    export(input: TimelineScopeInput): Promise<{ saved: boolean; canceled?: boolean; directory?: string; bundlePath?: string; warnings?: Array<{ code: string; clipId?: string; message: string }>; error?: string }>
  }
  demo: {
    create(): Promise<{ projectId: string; adaptationProjectId: string; episodeId: string; sceneId: string; shotId: string }>
  }
  ttsProvider: {
    list(): Promise<TtsProviderConfigRecord[]>
    getDefault(): Promise<TtsProviderConfigRecord | undefined>
    create(data: Omit<TtsProviderConfigRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<TtsProviderConfigRecord>
    update(id: string, patch: Partial<Omit<TtsProviderConfigRecord, 'id' | 'createdAt' | 'updatedAt'>>): Promise<TtsProviderConfigRecord | undefined>
    remove(id: string): Promise<boolean>
    setDefault(id: string): Promise<boolean>
  }
  ttsTask: {
    create(input: { providerConfigId: string; projectId: string; episodeId: string; shotId?: string; voiceProfileId?: string; kind: 'dialogue' | 'narration'; input: string; voice: string; instructions?: string; speed?: number; responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' }): Promise<{ ok: boolean; error?: string; task?: LongTask; asset?: ProjectAsset }>
  }
  animatic: {
    listByEpisode(episodeId: string): Promise<AnimaticDraft[]>
    initialize(projectId: string, episodeId: string): Promise<Pick<AnimaticDraft, 'projectId' | 'adaptationProjectId' | 'episodeId' | 'sourceFingerprint' | 'clips'>>
    save(data: Pick<AnimaticDraft, 'projectId' | 'adaptationProjectId' | 'episodeId' | 'sourceFingerprint' | 'clips' | 'annotations'>): Promise<AnimaticDraft>
    review(id: string, review: { status: 'approved' | 'returned'; reviewNote?: string }): Promise<AnimaticDraft | undefined>
  }
  audio: {
    listVoiceProfiles(projectId: string): Promise<VoiceProfile[]>
    createVoiceProfile(data: Omit<VoiceProfile, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<VoiceProfile>
    adoptVoiceProfile(id: string): Promise<VoiceProfile | undefined>
    listTracksByEpisode(episodeId: string): Promise<AudioTrack[]>
    saveTrack(data: Pick<AudioTrack, 'projectId' | 'adaptationProjectId' | 'episodeId' | 'kind' | 'label' | 'sourceFingerprint' | 'clips'>): Promise<AudioTrack>
    adoptTrack(id: string): Promise<AudioTrack | undefined>
  }
  episodeRender: {
    listByEpisode(input: { projectId: string; adaptationProjectId: string; episodeId: string; mutedTrackIds?: string[] }): Promise<Array<{ task: LongTask; stale: boolean; staleReason?: string }>>
    preflight(input: { projectId: string; adaptationProjectId: string; episodeId: string; mutedTrackIds?: string[] }): Promise<EpisodeRenderPreflight>
    start(input: { projectId: string; adaptationProjectId: string; episodeId: string; mutedTrackIds?: string[] }): Promise<{ ok: boolean; error?: string; longTaskId?: string; task?: LongTask; archive?: EpisodeRenderArchive }>
  }
  episodeQuality: {
    listByEpisode(input: { projectId: string; adaptationProjectId: string; episodeId: string }): Promise<Array<{ task: LongTask; report?: EpisodeQualityReport; reportPath?: string; stale: boolean; staleReason?: string }>>
    start(input: { projectId: string; adaptationProjectId: string; episodeId: string; renderTaskId: string }): Promise<{ ok: boolean; error?: string; longTaskId?: string; task?: LongTask }>
    createMinimalRedoPlan(input: { projectId: string; adaptationProjectId: string; episodeId: string; qualityTaskId: string }): Promise<{ ok: boolean; error?: string; task?: LongTask }>
  }
  compliance: {
    listProfiles(): Promise<ComplianceRuleProfile[]>
    activateProfile(id: string): Promise<ComplianceRuleProfile | undefined>
  }
  episodeCompliance: {
    listByEpisode(input: { projectId: string; adaptationProjectId: string; episodeId: string }): Promise<Array<{ task: LongTask; stale: boolean; staleReason?: string }>>
    preflight(input: { projectId: string; adaptationProjectId: string; episodeId: string; renderTaskId: string; qualityTaskId: string; profileId: string; title: string; subtitleLanguage: string; targetPlatform?: string; targetRegion?: string; deliveryDate: string; aigcDeclared: boolean; manualContentReviewConfirmed: boolean }): Promise<EpisodeCompliancePreflight>
    start(input: { projectId: string; adaptationProjectId: string; episodeId: string; renderTaskId: string; qualityTaskId: string; profileId: string; title: string; subtitleLanguage: string; targetPlatform?: string; targetRegion?: string; deliveryDate: string; aigcDeclared: boolean; manualContentReviewConfirmed: boolean }): Promise<{ ok: boolean; error?: string; longTaskId?: string; task?: LongTask; archive?: EpisodeComplianceArchive; preflight?: EpisodeCompliancePreflight }>
  }
  platformDelivery: {
    listProfiles(): Promise<PlatformDeliveryProfile[]>
    listVariants(input: { projectId: string; adaptationProjectId: string }): Promise<DeliveryCreativeVariant[]>
    createVariant(input: { projectId: string; adaptationProjectId: string; label: string; title: string; description: string; tags: string[]; coverAssetId?: string; source: 'manual' | 'ai_draft' }): Promise<DeliveryCreativeVariant>
    adoptVariant(input: { projectId: string; adaptationProjectId: string; id: string }): Promise<DeliveryCreativeVariant | undefined>
    listExports(input: { projectId: string; adaptationProjectId: string; episodeId: string }): Promise<PlatformDeliveryExport[]>
    preflight(input: { projectId: string; adaptationProjectId: string; episodeId: string; profileId: string; creativeVariantId: string; complianceTaskId: string; manualFieldsConfirmed: boolean }): Promise<PlatformDeliveryPreflight>
    export(input: { projectId: string; adaptationProjectId: string; episodeId: string; profileId: string; creativeVariantId: string; complianceTaskId: string; manualFieldsConfirmed: boolean }): Promise<{ ok: boolean; error?: string; archive?: PlatformDeliveryExport; preflight: PlatformDeliveryPreflight }>
    openExportDirectory(input: { projectId: string; adaptationProjectId: string; id: string }): Promise<string>
  }
  feedback: {
    chooseAndPreview(kind: 'metrics' | 'comments'): Promise<{ canceled: boolean; token?: string; preview?: FeedbackImportPreview }>
    previewText(input: { kind: 'metrics' | 'comments'; sourceName: string; content: string; platform?: string; sourceVersion?: string }): Promise<{ canceled: false; token: string; preview: FeedbackImportPreview }>
    commitPreview(input: { projectId: string; token: string; privacy: 'local_only' | 'redacted' }): Promise<FeedbackImportResult>
    listBatches(projectId: string): Promise<FeedbackImportBatch[]>
    listMetrics(projectId: string): Promise<FeedbackMetric[]>
    listComments(projectId: string): Promise<FeedbackComment[]>
    listClusters(projectId: string): Promise<FeedbackCommentCluster[]>
    clusterBatch(input: { projectId: string; batchId: string }): Promise<FeedbackCommentCluster[]>
    deleteClusters(input: { projectId: string; batchId: string }): Promise<number>
    deleteBatch(input: { projectId: string; batchId: string }): Promise<boolean>
    createRevisionTask(input: { projectId: string; batchId: string; clusterId?: string; title?: string; suggestedAction?: string }): Promise<RevisionTask>
  }
  localization: {
    listByEpisode(episodeId: string): Promise<LocalizationVariant[]>
    initialize(input: { projectId: string; episodeId: string }): Promise<{ adaptationProjectId: string; episodeId: string; sourceFingerprint: string; cues: LocalizationVariant['cues'] }>
    create(input: Omit<LocalizationVariant, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'staleAt' | 'staleReason'>): Promise<LocalizationVariant>
    update(scope: { projectId: string; id: string }, patch: Partial<LocalizationVariant>): Promise<LocalizationVariant | undefined>
    adopt(scope: { projectId: string; id: string }, reviewNote?: string): Promise<LocalizationVariant | undefined>
    subtitleFiles(scope: { projectId: string; id: string }): Promise<{ srt: string; vtt: string; warnings: string[] }>
    exportPackage(scope: { projectId: string; id: string }): Promise<{ saved: boolean; path?: string }>
  }
  log: {
    renderer(level: RendererLogLevel, scope: string, message: string, meta?: unknown): Promise<boolean>
  }
  diagnostic: {
    exportPackage(options?: DiagnosticExportOptions): Promise<DiagnosticExportResult>
  }
  security: {
    getSecretStorageStatus(): Promise<SecretStorageStatus>
  }
  cloudAuth: {
    status(): Promise<CloudAuthStatus>
    login(): Promise<CloudAuthStatus>
    logout(): Promise<CloudAuthStatus>
    context(): Promise<CloudContext>
  }
  cloudAI: {
    models(): Promise<CloudAIModel[]>
    onBalance(onBalance: (balance: { remainingTokens: number }) => void): () => void
  }
  cloudHandoff: {
    list(input: { projectId: string }): Promise<CloudMobileDraft[]>
    adopt(input: { projectId: string; draftId: string }): Promise<{ draft: CloudMobileDraft; imported: number; skipped: number }>
  }
  cloudSnapshot: {
    list(): Promise<CloudProjectSnapshot[]>
    create(input: { projectId: string }): Promise<CreatedCloudProjectSnapshot>
    restore(input: { snapshotId: string; recoveryKey?: string }): Promise<Project>
    remove(input: { snapshotId: string }): Promise<{ ok: boolean }>
  }
  dataBackup: {
    list(): Promise<DatabaseBackupInfo[]>
    create(): Promise<DatabaseBackupResult>
    restore(path: string): Promise<DatabaseBackupResult>
  }
  longTask: {
    list(projectId?: string): Promise<LongTask[]>
    get(id: string): Promise<LongTask | undefined>
    cancel(id: string): Promise<LongTaskCancelResult>
    retry(id: string): Promise<LongTaskRetryResult>
  }
  batchTask: {
    run(input: BatchTaskRunInput): Promise<BatchTaskRunResult>
  }
  project: {
    list(): Promise<Project[]>
    listHomeSummaries(): Promise<ProjectHomeSummary[]>
    get(id: string): Promise<Project | undefined>
    resolveActiveAdaptation(projectId: string, requestedAdaptationId?: string): Promise<{
      adaptation?: AdaptationProject
      reason: 'requested' | 'persisted' | 'fallback' | 'none'
    }>
    setActiveAdaptation(projectId: string, adaptationId?: string): Promise<Project | undefined>
    create(data: Partial<Project> & { title: string; shortDramaType: string }): Promise<Project>
    update(id: string, patch: Partial<Project>): Promise<Project | undefined>
    trash(id: string): Promise<TrashedProject | undefined>
    listTrash(): Promise<TrashedProject[]>
    restore(id: string): Promise<Project | undefined>
    deletionPreview(id: string): Promise<ProjectDeletionPreview | undefined>
    purge(id: string, confirmationTitle: string): Promise<boolean>
    /** v1.0：导入完整项目包 */
    importPackage(): Promise<ProjectImportResult>
  }
  sourceImport: {
    choose(projectId: string): Promise<SourceImportChooseResult>
    commit(input: {
      importId: string
      projectId: string
      strategy: SourceImportStrategy
      rightsConfirmed: true
      destructiveConfirmed?: boolean
      preview: SourceImportPreview
    }): Promise<SourceImportCommitResult>
    discard(importId: string): Promise<{ ok: boolean }>
  }
  chapter: {
    list(projectId: string): Promise<Chapter[]>
    get(id: string): Promise<Chapter | undefined>
    create(data: { projectId: string; title: string } & Partial<Chapter>): Promise<Chapter>
    update(id: string, patch: Partial<Chapter>): Promise<Chapter | undefined>
    reorder(projectId: string, orderedIds: string[]): Promise<Chapter[]>
    updateContent(id: string, content: string): Promise<Chapter | undefined>
    remove(id: string): Promise<boolean>
  }
  character: {
    list(projectId: string): Promise<Character[]>
    create(data: unknown): Promise<Character>
    update(id: string, patch: unknown): Promise<Character | undefined>
    remove(id: string): Promise<boolean>
  }
  outline: {
    list(projectId: string, type?: 'book' | 'chapter'): Promise<Outline[]>
    create(data: unknown): Promise<Outline>
    update(id: string, patch: unknown): Promise<Outline | undefined>
    remove(id: string): Promise<boolean>
  }
  storyArc: {
    list(projectId: string, kind?: StoryArc['kind']): Promise<StoryArc[]>
    create(data: Partial<StoryArc> & { projectId: string; kind: StoryArc['kind']; title: string }): Promise<StoryArc>
    update(id: string, patch: Partial<StoryArc>): Promise<StoryArc | undefined>
    remove(id: string): Promise<boolean>
  }
  projectSkill: {
    list(projectId: string): Promise<ProjectSkill[]>
    create(data: Partial<ProjectSkill> & { projectId: string; name: string; category: ProjectSkill['category']; content: string }): Promise<ProjectSkill>
    update(id: string, patch: Partial<ProjectSkill>): Promise<ProjectSkill | undefined>
    remove(id: string): Promise<boolean>
  }
  projectAgentScheme: {
    list(projectId: string): Promise<ProjectAgentScheme[]>
    getActive(projectId: string): Promise<ProjectAgentScheme | undefined>
    create(data: Partial<ProjectAgentScheme> & { projectId: string; name: string }): Promise<ProjectAgentScheme>
    update(id: string, patch: Partial<ProjectAgentScheme>): Promise<ProjectAgentScheme | undefined>
    setActive(id: string): Promise<ProjectAgentScheme | undefined>
    remove(id: string): Promise<boolean>
  }
  inspirationFavorite: {
    list(projectId: string): Promise<InspirationFavorite[]>
    upsert(
      data: Partial<InspirationFavorite> & {
        projectId: string
        cardKey: string
        sourceKind: InspirationFavorite['sourceKind']
        kind: InspirationFavorite['kind']
        title: string
        pattern: string
        applyTo: string
      },
    ): Promise<InspirationFavorite>
    importMobile(data: MobileInspirationImportInput): Promise<MobileInspirationImportSummary>
    remove(id: string): Promise<boolean>
    removeByCardKey(projectId: string, cardKey: string): Promise<boolean>
  }
  evaluation: {
    list(projectId: string): Promise<Evaluation[]>
    listByChapter(chapterId: string): Promise<Evaluation[]>
  }
  aiRun: {
    list(projectId: string): Promise<AiRun[]>
    listRecent(projectId?: string): Promise<AiRun[]>
    contextPreview(id: string): Promise<AiContextPreviewResult>
    exportDebugContext(id: string): Promise<ExportResult>
    summarize(): Promise<AiRunSummaryRow[]>
    summarizeUsage(): Promise<AiRunUsageSummaryRow[]>
  }
  model: {
    list(): Promise<ModelConfig[]>
    getDefault(): Promise<ModelConfig | undefined>
    create(
      data: Partial<ModelConfig> & { name: string; provider: string; baseUrl: string; model: string },
    ): Promise<ModelConfig>
    update(id: string, patch: Partial<ModelConfig>): Promise<ModelConfig | undefined>
    remove(id: string): Promise<boolean>
    setDefault(id: string): Promise<boolean>
    // v1.0：按任务组绑定 + 连接测试
    listTaskBindings(): Promise<TaskModelBinding[]>
    upsertTaskBinding(taskGroup: string, modelConfigId: string): Promise<TaskModelBinding>
    deleteTaskBinding(taskGroup: string): Promise<boolean>
    getBudgetSettings(): Promise<AiBudgetSettings>
    updateBudgetSettings(patch: Partial<Omit<AiBudgetSettings, 'id' | 'updatedAt'>>): Promise<AiBudgetSettings>
    testConnection(config: ModelConfig): Promise<ModelConnectionTestResult>
  }
  ai: {
    run(input: AiTaskInput): Promise<AiTaskResult>
    runStream(input: AiTaskInput, onChunk: (chunk: string) => void, onReset?: () => void): Promise<AiTaskResult>
    applyResult(input: ApplyArtifactInput): Promise<ApplyArtifactResult>
  }
  // v0.2 长篇一致性与视觉记忆系统
  chapterMemory: {
    list(projectId: string): Promise<ChapterMemory[]>
    get(id: string): Promise<ChapterMemory | undefined>
    getByChapter(projectId: string, chapterId: string): Promise<ChapterMemory | undefined>
    create(data: unknown): Promise<ChapterMemory>
    update(id: string, patch: unknown): Promise<ChapterMemory | undefined>
    remove(id: string): Promise<boolean>
  }
  characterState: {
    list(projectId: string): Promise<CharacterState[]>
    listByCharacter(characterId: string): Promise<CharacterState[]>
    listByChapter(chapterId: string): Promise<CharacterState[]>
    create(data: unknown): Promise<CharacterState>
    remove(id: string): Promise<boolean>
  }
  visualProfile: {
    list(projectId: string): Promise<CharacterVisualProfile[]>
    getByCharacter(characterId: string): Promise<CharacterVisualProfile | undefined>
    create(data: unknown): Promise<CharacterVisualProfile>
    update(id: string, patch: unknown): Promise<CharacterVisualProfile | undefined>
    remove(id: string): Promise<boolean>
  }
  visualSetting: {
    list(projectId: string): Promise<VisualSetting[]>
    create(data: unknown): Promise<VisualSetting>
    update(id: string, patch: unknown): Promise<VisualSetting | undefined>
    remove(id: string): Promise<boolean>
  }
  storyEvent: {
    list(projectId: string): Promise<StoryEvent[]>
    listByChapter(chapterId: string): Promise<StoryEvent[]>
    create(data: unknown): Promise<StoryEvent>
    update(id: string, patch: unknown): Promise<StoryEvent | undefined>
    remove(id: string): Promise<boolean>
  }
  foreshadowing: {
    list(projectId: string): Promise<Foreshadowing[]>
    listByChapter(chapterId: string): Promise<Foreshadowing[]>
    create(data: unknown): Promise<Foreshadowing>
    update(id: string, patch: unknown): Promise<Foreshadowing | undefined>
    remove(id: string): Promise<boolean>
  }
  storyBible: {
    getSettings(projectId: string): Promise<StoryBibleSettings>
    updateSettings(projectId: string, patch: { autoSuggest: boolean }): Promise<StoryBibleSettings>
    listChangeSets(projectId: string): Promise<StoryBibleChangeSet[]>
    queueChangeSet(input: { projectId: string; chapterId: string }): Promise<StoryBibleChangeSet>
    applyChangeSet(id: string): Promise<StoryBibleChangeSet>
    undoChangeSet(id: string): Promise<StoryBibleChangeSet>
    failChangeSet(id: string, message: string): Promise<StoryBibleChangeSet | undefined>
    setChangeSetStatus(id: string, status: 'paused' | 'queued' | 'skipped' | 'discarded'): Promise<StoryBibleChangeSet | undefined>
    listStaleMarks(projectId: string): Promise<Array<{ id: string; chapterId: string; targetKind: 'story_bible' | 'diagnostic'; reason: string }>>
  }
  // v0.3 AI 短剧小说强化系统
  beat: {
    list(projectId: string): Promise<Beat[]>
    listByChapter(chapterId: string): Promise<Beat[]>
    create(data: unknown): Promise<Beat>
    update(id: string, patch: unknown): Promise<Beat | undefined>
    remove(id: string): Promise<boolean>
  }
  highlight: {
    list(projectId: string): Promise<HighlightAnalysis[]>
    getByChapter(projectId: string, chapterId: string): Promise<HighlightAnalysis | undefined>
    create(data: unknown): Promise<HighlightAnalysis>
    remove(id: string): Promise<boolean>
  }
  feasibility: {
    list(projectId: string): Promise<AiVideoFeasibilityReport[]>
    getByChapter(projectId: string, chapterId: string): Promise<AiVideoFeasibilityReport | undefined>
    create(data: unknown): Promise<AiVideoFeasibilityReport>
    remove(id: string): Promise<boolean>
  }
  dramaTrend: {
    get(projectId: string): Promise<DramaTrendReport | undefined>
    remove(id: string): Promise<boolean>
  }
  // v0.4 改编分集大纲
  adaptationProject: {
    list(): Promise<AdaptationProject[]>
    listByProject(sourceProjectId: string): Promise<AdaptationProject[]>
    get(id: string): Promise<AdaptationProject | undefined>
    create(data: unknown): Promise<AdaptationProject>
    update(id: string, patch: unknown): Promise<AdaptationProject | undefined>
    remove(id: string): Promise<boolean>
  }
  episode: {
    list(adaptationProjectId: string): Promise<Episode[]>
    create(data: unknown): Promise<Episode>
    update(id: string, patch: unknown): Promise<Episode | undefined>
    reorder(orderedIds: string[]): Promise<boolean>
    remove(id: string): Promise<boolean>
  }
  episodeAnalysis: {
    get(adaptationProjectId: string): Promise<EpisodeAnalysis | undefined>
    remove(id: string): Promise<boolean>
  }
  // v0.5 AI 短剧剧本生成
  script: {
    list(adaptationProjectId: string): Promise<Script[]>
    get(id: string): Promise<Script | undefined>
    getByEpisode(episodeId: string): Promise<Script | undefined>
    create(data: unknown): Promise<Script>
    update(id: string, patch: unknown): Promise<Script | undefined>
    updateContent(id: string, content: string): Promise<Script | undefined>
    remove(id: string): Promise<boolean>
  }
  scene: {
    listByScript(scriptId: string): Promise<Scene[]>
    update(id: string, patch: unknown): Promise<Scene | undefined>
    remove(id: string): Promise<boolean>
  }
  scriptReview: {
    get(scriptId: string): Promise<ScriptReview | undefined>
    remove(id: string): Promise<boolean>
  }
  // v0.6 分镜与镜头 Prompt 生成
  shot: {
    listByScene(sceneId: string): Promise<Shot[]>
    listByEpisode(episodeId: string): Promise<Shot[]>
    get(id: string): Promise<Shot | undefined>
    create(data: unknown): Promise<Shot>
    update(id: string, patch: unknown): Promise<Shot | undefined>
    reorder(sceneId: string, orderedIds: string[]): Promise<Shot[]>
    remove(id: string): Promise<boolean>
  }
  shotReview: {
    get(shotId: string): Promise<ShotReview | undefined>
    remove(id: string): Promise<boolean>
  }
  promptVersion: {
    list(shotId: string): Promise<PromptVersion[]>
  }
  // v0.7 AI 视频平台对接
  videoProvider: {
    list(): Promise<VideoProviderConfig[]>
    getDefault(): Promise<VideoProviderConfig | undefined>
    create(data: unknown): Promise<VideoProviderConfig>
    update(id: string, patch: unknown): Promise<VideoProviderConfig | undefined>
    remove(id: string): Promise<boolean>
    setDefault(id: string): Promise<boolean>
  }
  videoTask: {
    list(): Promise<VideoGenerationTask[]>
    listByShot(shotId: string): Promise<VideoGenerationTask[]>
    listByEpisode(episodeId: string): Promise<VideoGenerationTask[]>
    get(id: string): Promise<VideoGenerationTask | undefined>
    create(input: CreateVideoTaskInput): Promise<VideoTaskOpResult>
    checkStatus(taskId: string): Promise<VideoTaskOpResult>
    retry(taskId: string, providerConfigId?: string): Promise<VideoTaskOpResult>
    cancel(taskId: string): Promise<{ ok: boolean; error?: string; task?: VideoGenerationTask; remoteCanceled?: boolean }>
    update(id: string, patch: unknown): Promise<VideoGenerationTask | undefined>
    remove(id: string): Promise<boolean>
  }
  videoResult: {
    listByTask(taskId: string): Promise<VideoResult[]>
    listByShot(shotId: string): Promise<VideoResult[]>
    compare(shotId: string): Promise<VideoResult[]>
    selectBest(resultId: string): Promise<{ ok: boolean; result?: VideoResult }>
    update(id: string, patch: unknown): Promise<VideoResult | undefined>
    remove(id: string): Promise<boolean>
  }
  export: {
    projectMarkdown(projectId: string): Promise<ExportResult>
    projectJson(projectId: string): Promise<ExportResult>
    novelSubmissionMarkdown(projectId: string, options?: { chapterLimit?: number }): Promise<ExportResult>
    novelSubmissionJson(projectId: string, options?: { chapterLimit?: number }): Promise<ExportResult>
    dramaProposalMarkdown(adaptationId: string, options?: { episodeLimit?: number }): Promise<ExportResult>
    dramaProposalJson(adaptationId: string, options?: { episodeLimit?: number }): Promise<ExportResult>
    dramaEpisodeDeliveryMarkdown(adaptationId: string, options?: { episodeLimit?: number }): Promise<ExportResult>
    dramaEpisodeDeliveryJson(adaptationId: string, options?: { episodeLimit?: number }): Promise<ExportResult>
    dramaShotDeliveryMarkdown(adaptationId: string, options?: { episodeLimit?: number }): Promise<ExportResult>
    dramaShotDeliveryJson(adaptationId: string, options?: { episodeLimit?: number }): Promise<ExportResult>
    dramaShotDeliveryCsv(adaptationId: string, options?: { episodeLimit?: number }): Promise<ExportResult>
    chapterMarkdown(chapterId: string): Promise<ExportResult>
    adaptationMarkdown(adaptationId: string): Promise<ExportResult>
    adaptationJson(adaptationId: string): Promise<ExportResult>
    scriptMarkdown(scriptId: string): Promise<ExportResult>
    scriptJson(scriptId: string): Promise<ExportResult>
    scriptsMarkdown(adaptationId: string): Promise<ExportResult>
    scriptsJson(adaptationId: string): Promise<ExportResult>
    shotsMarkdown(sceneId: string): Promise<ExportResult>
    shotsJson(sceneId: string): Promise<ExportResult>
    shotsCsv(sceneId: string): Promise<ExportResult>
    /** v1.0：完整项目包导出 */
    projectPackage(projectId: string, options?: { includeAssets?: boolean; includeFeedback?: boolean }): Promise<ExportResult>
  }
  // v0.8 多 Agent 编剧室与模板系统
  agent: {
    list(): Promise<AgentProfile[]>
    get(id: string): Promise<AgentProfile | undefined>
    create(data: Partial<AgentProfile> & { name: string; role: string; systemPrompt: string }): Promise<AgentProfile>
    update(id: string, patch: Partial<AgentProfile>): Promise<AgentProfile | undefined>
    remove(id: string): Promise<boolean>
  }
  writingRoom: {
    run(input: WritingRoomRunInput): Promise<WritingRoomRunResult>
  }
  template: {
    list(): Promise<Template[]>
    listByType(type: string): Promise<Template[]>
    get(id: string): Promise<Template | undefined>
    create(
      data: Partial<Template> & { name: string; type: string; content: string },
    ): Promise<Template>
    update(id: string, patch: Partial<Template>): Promise<Template | undefined>
    remove(id: string): Promise<boolean>
    extractVariables(content: string): Promise<string[]>
    run(input: {
      templateId: string
      projectId?: string
      variables?: Record<string, string>
      userInstruction?: string
    }): Promise<TemplateRunResult>
  }
  genrePreset: {
    list(): Promise<GenrePreset[]>
    get(id: string): Promise<GenrePreset | undefined>
    create(data: Partial<GenrePreset> & { name: string; visualStyle: string; shotPromptAdvice: string; aiVideoRisks: string }): Promise<GenrePreset>
    update(id: string, patch: Partial<GenrePreset>): Promise<GenrePreset | undefined>
    remove(id: string): Promise<boolean>
  }
  genreMarketSnapshot: {
    list(): Promise<Array<GenreMarketSnapshot & { active: boolean }>>
    getActive(): Promise<(GenreMarketSnapshot & { active: boolean }) | undefined>
    import(snapshot: unknown): Promise<GenreMarketSnapshot & { active: boolean }>
    activate(version: string): Promise<(GenreMarketSnapshot & { active: boolean }) | undefined>
  }
  templateRun: {
    list(): Promise<TemplateRun[]>
    listByTemplate(templateId: string): Promise<TemplateRun[]>
  }
  // v1.1 创意诊断与反套路迭代系统
  caseStudy: {
    list(): Promise<CreativeCaseStudy[]>
    listDocuments(): Promise<CaseStudyDocumentWithChapters[]>
    importDocuments(): Promise<CaseStudyImportResult>
    createDocument(data: {
      title: string
      fileName: string
      sourceType?: string
      truncated?: boolean
      parseWarnings?: string[]
      chapters: CaseStudyImportChapter[]
    }): Promise<CaseStudyDocumentWithChapters>
    updateDocumentChapter(id: string, patch: Partial<CaseStudyChapter>): Promise<CaseStudyChapter | undefined>
    deleteDocument(id: string): Promise<boolean>
    create(data: Partial<CreativeCaseStudy> & { title: string }): Promise<CreativeCaseStudy>
    update(id: string, patch: Partial<CreativeCaseStudy>): Promise<CreativeCaseStudy | undefined>
    remove(id: string): Promise<boolean>
  }
  creative: {
    listFreshness(projectId?: string): Promise<FreshnessReport[]>
    listFreshnessByTarget(targetKind: string, targetId?: string): Promise<FreshnessReport[]>
    listAntiTropeByTarget(targetKind: string, targetId?: string): Promise<AntiTropeVariant[]>
    listQualityGates(projectId?: string): Promise<QualityGateReport[]>
    listQualityIssueAcknowledgements(projectId: string): Promise<QualityIssueAcknowledgement[]>
    acknowledgeQualityIssue(data: Pick<QualityIssueAcknowledgement, 'projectId' | 'adaptationProjectId' | 'issueId' | 'issueKind' | 'issueTitle' | 'issueDetail' | 'disposition' | 'note'>): Promise<QualityIssueAcknowledgement>
    listAudienceSimulations(projectId?: string): Promise<AudienceSimulation[]>
    listNarrativeCurves(projectId?: string): Promise<NarrativeCurveReport[]>
  }
  revisionTask: {
    list(projectId?: string): Promise<RevisionTask[]>
    listByTarget(targetKind: string, targetId?: string): Promise<RevisionTask[]>
    create(data: Partial<RevisionTask> & { targetKind: RevisionTask['targetKind']; title: string; description: string; suggestedAction: string }): Promise<RevisionTask>
    update(id: string, patch: Partial<RevisionTask>): Promise<RevisionTask | undefined>
    preview(id: string): Promise<RevisionTaskPreviewResult>
    updatePreview(id: string, preview: TextDiffPreviewPayload): Promise<RevisionTaskPreviewUpdateResult>
    adopt(id: string): Promise<RevisionTaskAdoptResult>
    undo(id: string): Promise<RevisionTaskUndoResult>
    /** @deprecated 兼容旧调用，等同于 adopt。 */
    complete(id: string): Promise<RevisionTaskAdoptResult>
    /** @deprecated 兼容旧调用，等同于 adopt。 */
    apply(id: string): Promise<RevisionTaskAdoptResult>
  }
  contentVersion: {
    listByTarget(targetKind: string, targetId: string): Promise<ContentVersion[]>
    create(data: Partial<ContentVersion> & { targetKind: ContentVersion['targetKind']; targetId: string; label: string; source: ContentVersion['source']; content: string }): Promise<ContentVersion>
    restore(id: string): Promise<ContentVersionRestoreResult>
  }
  workflow: {
    list(projectId?: string): Promise<WorkflowRun[]>
    run(input: {
      templateKey: string
      projectId?: string
      chapterId?: string
      adaptationProjectId?: string
      episodeId?: string
      sceneId?: string
      shotId?: string
      userInstruction?: string
      pauseAfterStep?: boolean
    }): Promise<{ ok: boolean; error?: string; result?: WorkflowRun }>
    resume(input: { runId: string; pauseAfterStep?: boolean }): Promise<{ ok: boolean; error?: string; result?: WorkflowRun }>
    retryStep(input: { runId: string; stepKey: string; pauseAfterStep?: boolean }): Promise<{ ok: boolean; error?: string; result?: WorkflowRun }>
  }
}

declare global {
  interface Window {
    api: StudioApi
  }
}

export const ipc: StudioApi = window.api
