// window.api 类型契约（由 preload 经 contextBridge 暴露）
import type {
  AdaptationProject,
  AgentProfile,
  AiRun,
  AiVideoFeasibilityReport,
  AntiTropeVariant,
  AudienceSimulation,
  Beat,
  Chapter,
  ChapterMemory,
  Character,
  CharacterState,
  CharacterVisualProfile,
  ContentVersion,
  CreativeCaseStudy,
  DramaTrendReport,
  Episode,
  EpisodeAnalysis,
  Evaluation,
  Foreshadowing,
  FreshnessReport,
  GenrePreset,
  HighlightAnalysis,
  ModelConfig,
  NarrativeCurveReport,
  NovelTaskType,
  Outline,
  Project,
  PromptVersion,
  QualityGateReport,
  RevisionTask,
  Scene,
  Script,
  ScriptReview,
  Shot,
  ShotReview,
  StoryEvent,
  TaskModelBinding,
  Template,
  TemplateRun,
  TextDiffPreviewPayload,
  VideoGenerationTask,
  VideoProviderConfig,
  VideoResult,
  VisualSetting,
  WritingRoomResult,
  WritingRoomTargetKind,
  WorkflowRun,
} from '@sdns/core'

export interface AiTaskInput {
  projectId?: string
  chapterId?: string
  characterId?: string
  adaptationProjectId?: string
  episodeId?: string
  sceneId?: string
  shotId?: string
  taskType: NovelTaskType
  userInstruction?: string
  /** 对话式项目设定的多轮历史 */
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** v0.8 模板驱动生成：渲染后的模板正文（仅 taskType='template_run' 使用） */
  templateContent?: string
  /** v0.8 模板驱动生成：实际复用的生成类 taskType（如 generate_project） */
  templateScope?: NovelTaskType
}

export interface AiTaskResult {
  ok: boolean
  error?: string
  result?: { kind: string; data: unknown | TextDiffPreviewPayload }
  aiRunId?: string
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

/** v1.0 项目包导入结果 */
export interface ProjectImportResult {
  ok: boolean
  canceled?: boolean
  error?: string
  project?: Project
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

/** v0.7 视频任务操作返回（提交/查询/重试共用） */
export interface VideoTaskOpResult {
  ok: boolean
  error?: string
  task?: VideoGenerationTask
  results?: VideoResult[]
}

export interface CaseStudyImportDocument {
  fileName: string
  path: string
  text: string
  truncated: boolean
  error?: string
}

export interface CaseStudyImportResult {
  ok: boolean
  canceled?: boolean
  error?: string
  documents: CaseStudyImportDocument[]
}

export interface SecretStorageStatus {
  encryptionAvailable: boolean
  mode: 'encrypted' | 'unsafe_plaintext_unavailable'
}

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

export interface StudioApi {
  security: {
    getSecretStorageStatus(): Promise<SecretStorageStatus>
  }
  project: {
    list(): Promise<Project[]>
    get(id: string): Promise<Project | undefined>
    create(data: Partial<Project> & { title: string; shortDramaType: string }): Promise<Project>
    update(id: string, patch: Partial<Project>): Promise<Project | undefined>
    remove(id: string): Promise<boolean>
    /** v1.0：导入完整项目包 */
    importPackage(): Promise<ProjectImportResult>
  }
  chapter: {
    list(projectId: string): Promise<Chapter[]>
    get(id: string): Promise<Chapter | undefined>
    create(data: { projectId: string; title: string } & Partial<Chapter>): Promise<Chapter>
    update(id: string, patch: Partial<Chapter>): Promise<Chapter | undefined>
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
  evaluation: {
    list(projectId: string): Promise<Evaluation[]>
  }
  aiRun: {
    list(projectId: string): Promise<AiRun[]>
    summarize(): Promise<AiRunSummaryRow[]>
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
    testConnection(config: ModelConfig): Promise<ModelConnectionTestResult>
  }
  ai: {
    run(input: AiTaskInput): Promise<AiTaskResult>
    runStream(input: AiTaskInput, onChunk: (chunk: string) => void): Promise<AiTaskResult>
    applyResult(input: ApplyArtifactInput): Promise<ApplyArtifactResult>
  }
  // v0.2 长篇一致性与视觉记忆系统
  chapterMemory: {
    list(projectId: string): Promise<ChapterMemory[]>
    get(id: string): Promise<ChapterMemory | undefined>
    create(data: unknown): Promise<ChapterMemory>
    update(id: string, patch: unknown): Promise<ChapterMemory | undefined>
    remove(id: string): Promise<boolean>
  }
  characterState: {
    list(projectId: string): Promise<CharacterState[]>
    listByCharacter(characterId: string): Promise<CharacterState[]>
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
    create(data: unknown): Promise<StoryEvent>
    update(id: string, patch: unknown): Promise<StoryEvent | undefined>
    remove(id: string): Promise<boolean>
  }
  foreshadowing: {
    list(projectId: string): Promise<Foreshadowing[]>
    create(data: unknown): Promise<Foreshadowing>
    update(id: string, patch: unknown): Promise<Foreshadowing | undefined>
    remove(id: string): Promise<boolean>
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
    create(data: unknown): Promise<HighlightAnalysis>
    remove(id: string): Promise<boolean>
  }
  feasibility: {
    list(projectId: string): Promise<AiVideoFeasibilityReport[]>
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
    projectPackage(projectId: string): Promise<ExportResult>
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
  templateRun: {
    list(): Promise<TemplateRun[]>
    listByTemplate(templateId: string): Promise<TemplateRun[]>
  }
  // v1.1 创意诊断与反套路迭代系统
  caseStudy: {
    list(): Promise<CreativeCaseStudy[]>
    importDocuments(): Promise<CaseStudyImportResult>
    create(data: Partial<CreativeCaseStudy> & { title: string }): Promise<CreativeCaseStudy>
    update(id: string, patch: Partial<CreativeCaseStudy>): Promise<CreativeCaseStudy | undefined>
    remove(id: string): Promise<boolean>
  }
  creative: {
    listFreshness(projectId?: string): Promise<FreshnessReport[]>
    listFreshnessByTarget(targetKind: string, targetId?: string): Promise<FreshnessReport[]>
    listAntiTropeByTarget(targetKind: string, targetId?: string): Promise<AntiTropeVariant[]>
    listQualityGates(projectId?: string): Promise<QualityGateReport[]>
    listAudienceSimulations(projectId?: string): Promise<AudienceSimulation[]>
    listNarrativeCurves(projectId?: string): Promise<NarrativeCurveReport[]>
  }
  revisionTask: {
    list(projectId?: string): Promise<RevisionTask[]>
    listByTarget(targetKind: string, targetId?: string): Promise<RevisionTask[]>
    create(data: Partial<RevisionTask> & { targetKind: RevisionTask['targetKind']; title: string; description: string; suggestedAction: string }): Promise<RevisionTask>
    update(id: string, patch: Partial<RevisionTask>): Promise<RevisionTask | undefined>
    apply(id: string): Promise<{ ok: boolean; error?: string; result?: ContentVersion }>
  }
  contentVersion: {
    listByTarget(targetKind: string, targetId: string): Promise<ContentVersion[]>
    create(data: Partial<ContentVersion> & { targetKind: ContentVersion['targetKind']; targetId: string; label: string; source: ContentVersion['source']; content: string }): Promise<ContentVersion>
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
    }): Promise<{ ok: boolean; error?: string; result?: WorkflowRun }>
  }
}

declare global {
  interface Window {
    api: StudioApi
  }
}

export const ipc: StudioApi = window.api
