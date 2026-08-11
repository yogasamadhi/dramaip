import { Schema } from "effect";

export * from "./provider-catalog";

/** Effect Schema is the wire-contract authority; interfaces provide ergonomic React types. */
export const Id = Schema.String.pipe(Schema.brand("DramaIP.Id"));
export type Id = string;
export const IsoDateTime = Schema.String.pipe(
  Schema.brand("DramaIP.IsoDateTime"),
);
export type IsoDateTime = string;

const RequiredText = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
);
export const Project = Schema.Struct({
  id: Id,
  title: RequiredText,
  shortDramaType: RequiredText,
  targetAudience: Schema.optionalKey(Schema.String),
  targetWordCount: Schema.optionalKey(Schema.Int),
  targetEpisodeCount: Schema.optionalKey(Schema.Int),
  coreHook: Schema.optionalKey(Schema.String),
  emotionalCore: Schema.optionalKey(Schema.String),
  coreSellingPoint: Schema.optionalKey(Schema.String),
  synopsis: Schema.String,
  styleGuide: Schema.optionalKey(Schema.String),
  visualStyleDirection: Schema.optionalKey(Schema.String),
  genreOpportunity: Schema.optionalKey(Schema.String),
  productionBrief: Schema.optionalKey(Schema.String),
  currentAdaptationId: Schema.optionalKey(Id),
  deletedAt: Schema.optionalKey(IsoDateTime),
  version: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface Project {
  id: Id;
  title: string;
  shortDramaType: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  /** 当前在改编工作台中采用的改编方案；只由专用选择接口更新。 */
  currentAdaptationId?: Id;
  deletedAt?: IsoDateTime;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const ProjectInput = Schema.Struct({
  title: RequiredText,
  shortDramaType: RequiredText,
  targetAudience: Schema.optionalKey(Schema.String),
  targetWordCount: Schema.optionalKey(Schema.Int),
  targetEpisodeCount: Schema.optionalKey(Schema.Int),
  coreHook: Schema.optionalKey(Schema.String),
  emotionalCore: Schema.optionalKey(Schema.String),
  coreSellingPoint: Schema.optionalKey(Schema.String),
  synopsis: Schema.optionalKey(Schema.String),
  styleGuide: Schema.optionalKey(Schema.String),
  visualStyleDirection: Schema.optionalKey(Schema.String),
  genreOpportunity: Schema.optionalKey(Schema.String),
  productionBrief: Schema.optionalKey(Schema.String),
});
export interface ProjectInput {
  title: string;
  shortDramaType: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis?: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
}
export const ProjectPatch = Schema.Struct({
  title: Schema.optionalKey(RequiredText),
  shortDramaType: Schema.optionalKey(RequiredText),
  targetAudience: Schema.optionalKey(Schema.String),
  targetWordCount: Schema.optionalKey(Schema.Int),
  targetEpisodeCount: Schema.optionalKey(Schema.Int),
  coreHook: Schema.optionalKey(Schema.String),
  emotionalCore: Schema.optionalKey(Schema.String),
  coreSellingPoint: Schema.optionalKey(Schema.String),
  synopsis: Schema.optionalKey(Schema.String),
  styleGuide: Schema.optionalKey(Schema.String),
  visualStyleDirection: Schema.optionalKey(Schema.String),
  genreOpportunity: Schema.optionalKey(Schema.String),
  productionBrief: Schema.optionalKey(Schema.String),
  version: Schema.Int,
});
export interface ProjectPatch {
  title?: string;
  shortDramaType?: string;
  targetAudience?: string;
  targetWordCount?: number;
  targetEpisodeCount?: number;
  coreHook?: string;
  emotionalCore?: string;
  coreSellingPoint?: string;
  synopsis?: string;
  styleGuide?: string;
  visualStyleDirection?: string;
  genreOpportunity?: string;
  productionBrief?: string;
  version: number;
}

export const Chapter = Schema.Struct({
  id: Id,
  projectId: Id,
  title: RequiredText,
  orderIndex: Schema.Int,
  summary: Schema.String,
  outline: Schema.optionalKey(Schema.String),
  content: Schema.String,
  mainConflict: Schema.optionalKey(Schema.String),
  hook: Schema.optionalKey(Schema.String),
  highlight: Schema.optionalKey(Schema.String),
  reversal: Schema.optionalKey(Schema.String),
  cliffhanger: Schema.optionalKey(Schema.String),
  shortDramaNote: Schema.optionalKey(Schema.String),
  aiVideoNote: Schema.optionalKey(Schema.String),
  version: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface Chapter {
  id: Id;
  projectId: Id;
  title: string;
  orderIndex: number;
  summary: string;
  outline?: string;
  content: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const ChapterInput = Schema.Struct({
  projectId: Id,
  title: RequiredText,
  summary: Schema.optionalKey(Schema.String),
  outline: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  mainConflict: Schema.optionalKey(Schema.String),
  hook: Schema.optionalKey(Schema.String),
  highlight: Schema.optionalKey(Schema.String),
  reversal: Schema.optionalKey(Schema.String),
  cliffhanger: Schema.optionalKey(Schema.String),
  shortDramaNote: Schema.optionalKey(Schema.String),
  aiVideoNote: Schema.optionalKey(Schema.String),
});
export interface ChapterInput {
  projectId: Id;
  title: string;
  summary?: string;
  outline?: string;
  content?: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
}
export const ChapterPatch = Schema.Struct({
  title: Schema.optionalKey(RequiredText),
  summary: Schema.optionalKey(Schema.String),
  outline: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  mainConflict: Schema.optionalKey(Schema.String),
  hook: Schema.optionalKey(Schema.String),
  highlight: Schema.optionalKey(Schema.String),
  reversal: Schema.optionalKey(Schema.String),
  cliffhanger: Schema.optionalKey(Schema.String),
  shortDramaNote: Schema.optionalKey(Schema.String),
  aiVideoNote: Schema.optionalKey(Schema.String),
  version: Schema.Int,
});
export interface ChapterPatch {
  title?: string;
  summary?: string;
  outline?: string;
  content?: string;
  mainConflict?: string;
  hook?: string;
  highlight?: string;
  reversal?: string;
  cliffhanger?: string;
  shortDramaNote?: string;
  aiVideoNote?: string;
  version: number;
}

export const ChapterReorderInput = Schema.Struct({
  chapterIds: Schema.Array(Id),
});
export interface ChapterReorderInput {
  chapterIds: Id[];
}

export const TaskStatus = Schema.Union([
  Schema.Literal("queued"),
  Schema.Literal("running"),
  Schema.Literal("succeeded"),
  Schema.Literal("failed"),
  Schema.Literal("canceled"),
  Schema.Literal("interrupted"),
]);
export type TaskStatus =
  "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
export const Task = Schema.Struct({
  id: Id,
  kind: Schema.String,
  status: TaskStatus,
  title: Schema.String,
  progress: Schema.Number,
  projectId: Schema.optionalKey(Id),
  parentTaskId: Schema.optionalKey(Id),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface Task {
  id: Id;
  kind: string;
  status: TaskStatus;
  title: string;
  progress: number;
  projectId?: Id;
  parentTaskId?: Id;
  result?: unknown;
  error?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const TaskInput = Schema.Struct({
  kind: RequiredText,
  title: RequiredText,
  projectId: Schema.optionalKey(Id),
  payload: Schema.optionalKey(Schema.Unknown),
});
export interface TaskInput {
  kind: string;
  title: string;
  projectId?: Id;
  payload?: unknown;
}

export const AgentEngineKind = Schema.Literals([
  "opencode",
  "codex",
  "langgraph",
]);
export type AgentEngineKind = "opencode" | "codex" | "langgraph";

export const TaskRetryInput = Schema.Struct({
  engineKind: AgentEngineKind,
});
export interface TaskRetryInput {
  engineKind: AgentEngineKind;
}

export const AGENT_TASK_TYPES = [
  "chapter_diagnostic",
  "chapter_revision",
  "generate_project",
  "generate_characters",
  "generate_book_outline",
  "generate_chapter_outline",
  "generate_story_arc_outline",
  "generate_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
  "expand_chapter",
  "enhance_conflict",
  "enhance_highlight",
  "enhance_ai_drama_feel",
  "enhance_author_style",
  "evaluate_ai_drama_fit",
  "summarize_chapter",
  "propose_story_bible_changes",
  "update_character_state",
  "extract_story_events",
  "extract_foreshadowing",
  "generate_character_visual_profile",
  "generate_visual_setting",
  "check_consistency",
  "build_long_context",
  "analyze_beats",
  "analyze_highlights",
  "analyze_ai_video_feasibility",
  "analyze_project_ai_drama_trend",
  "enhance_hook",
  "enhance_reversal",
  "enhance_cliffhanger",
  "rewrite_as_ai_drama_novel",
  "chat_project",
  "create_adaptation_strategy",
  "convert_novel_to_episodes",
  "rewrite_episode_outline",
  "enhance_episode_hook",
  "enhance_episode_visuals",
  "analyze_first_10_episodes",
  "generate_ai_drama_script",
  "split_script_to_scenes",
  "review_ai_drama_script",
  "rewrite_ai_drama_script",
  "enhance_dialogue_conflict",
  "enhance_script_dialogue_voice",
  "enhance_episode_cliffhanger",
  "enhance_script_visuality",
  "split_scene_to_shots",
  "generate_shot_prompt",
  "generate_negative_prompt",
  "review_shot_prompt",
  "rewrite_shot_prompt",
  "optimize_prompt_for_video_platform",
  "generate_video_asset_drafts",
  "plan_image_generation",
  "plan_audio_generation",
  "plan_video_generation",
  "plan_remote_render",
  "analyze_trope_freshness",
  "generate_anti_trope_variants",
  "analyze_narrative_curve",
  "generate_revision_tasks",
  "run_quality_gate",
  "simulate_audience_reaction",
  "analyze_video_cost_risk",
  "analyze_text_quality",
  "extract_case_structure",
  "generate_inspiration_schemes",
  "writing_room_review",
  "writing_room_consolidate",
  "template_run",
] as const;
export const AgentTaskType = Schema.Literals(AGENT_TASK_TYPES);
export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];

export const AgentSessionStatus = Schema.Literals([
  "idle",
  "running",
  "failed",
  "interrupted",
  "disposed",
]);
export type AgentSessionStatus =
  "idle" | "running" | "failed" | "interrupted" | "disposed";
export const AgentModelSelection = Schema.Struct({
  providerId: Schema.optionalKey(Schema.String),
  modelId: Schema.optionalKey(Schema.String),
  profileId: Schema.optionalKey(Schema.String),
});
export interface AgentModelSelection {
  providerId?: string;
  modelId?: string;
  profileId?: string;
}
export const AgentSession = Schema.Struct({
  id: Id,
  engineSessionId: Schema.String,
  engineKind: AgentEngineKind,
  projectId: Id,
  chapterId: Schema.optionalKey(Id),
  taskType: Schema.optionalKey(AgentTaskType),
  title: Schema.optionalKey(Schema.String),
  status: AgentSessionStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface AgentSession {
  id: Id;
  engineSessionId: string;
  engineKind: AgentEngineKind;
  projectId: Id;
  chapterId?: Id;
  taskType?: AgentTaskType;
  title?: string;
  status: AgentSessionStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const AgentSessionInput = Schema.Struct({
  projectId: Id,
  chapterId: Schema.optionalKey(Id),
  engineKind: Schema.optionalKey(AgentEngineKind),
  taskType: Schema.optionalKey(AgentTaskType),
  title: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(AgentModelSelection),
});
export interface AgentSessionInput {
  projectId: Id;
  chapterId?: Id;
  engineKind?: AgentEngineKind;
  taskType?: AgentTaskType;
  title?: string;
  model?: AgentModelSelection;
}
export const AgentRunOperation = Schema.Union([
  Schema.Literal("diagnostic"),
  Schema.Literal("revision"),
]);
export type AgentRunOperation = "diagnostic" | "revision";
export const AgentRunInput = Schema.Struct({
  /** Optional user constraints. The server still owns the safety prompt. */
  prompt: Schema.optionalKey(Schema.String),
  /** Compatibility field for the first v3 chapter workflow. */
  operation: Schema.optionalKey(AgentRunOperation),
  taskType: Schema.optionalKey(AgentTaskType),
  model: Schema.optionalKey(AgentModelSelection),
  target: Schema.optionalKey(Schema.Unknown),
});
export interface AgentRunInput {
  prompt?: string;
  operation?: AgentRunOperation;
  taskType?: AgentTaskType;
  model?: AgentModelSelection;
  target?: unknown;
}

export const AgentRunStatus = Schema.Literals([
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
]);
export type AgentRunStatus =
  "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";

export const AgentRun = Schema.Struct({
  id: Id,
  sessionId: Id,
  taskId: Id,
  taskType: AgentTaskType,
  engineKind: AgentEngineKind,
  status: AgentRunStatus,
  model: Schema.optionalKey(AgentModelSelection),
  contextSnapshotId: Schema.optionalKey(Id),
  error: Schema.optionalKey(Schema.String),
  inputTokens: Schema.optionalKey(Schema.Int),
  outputTokens: Schema.optionalKey(Schema.Int),
  cachedTokens: Schema.optionalKey(Schema.Int),
  estimatedCost: Schema.optionalKey(Schema.Number),
  currency: Schema.optionalKey(Schema.String),
  startedAt: Schema.optionalKey(IsoDateTime),
  completedAt: Schema.optionalKey(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface AgentRun {
  id: Id;
  sessionId: Id;
  taskId: Id;
  taskType: AgentTaskType;
  engineKind: AgentEngineKind;
  status: AgentRunStatus;
  model?: AgentModelSelection;
  contextSnapshotId?: Id;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCost?: number;
  currency?: string;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const AgentItemType = Schema.Literals([
  "message",
  "reasoning_summary",
  "tool_call",
  "tool_result",
  "structured_output",
  "usage",
  "error",
]);
export type AgentItemType =
  | "message"
  | "reasoning_summary"
  | "tool_call"
  | "tool_result"
  | "structured_output"
  | "usage"
  | "error";
export const AgentItem = Schema.Struct({
  id: Id,
  runId: Id,
  sequence: Schema.Int,
  type: AgentItemType,
  status: Schema.Literals(["started", "streaming", "completed", "failed"]),
  content: Schema.optionalKey(Schema.String),
  payload: Schema.optionalKey(Schema.Unknown),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface AgentItem {
  id: Id;
  runId: Id;
  sequence: number;
  type: AgentItemType;
  status: "started" | "streaming" | "completed" | "failed";
  content?: string;
  payload?: unknown;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const AgentEngineCapabilities = Schema.Struct({
  streaming: Schema.Boolean,
  interrupt: Schema.Boolean,
  resume: Schema.Boolean,
  fork: Schema.Boolean,
  readOnlyMcp: Schema.Boolean,
  structuredOutput: Schema.Boolean,
  chatGptLogin: Schema.Boolean,
  apiKeyLogin: Schema.Boolean,
});
export interface AgentEngineCapabilities {
  streaming: boolean;
  interrupt: boolean;
  resume: boolean;
  fork: boolean;
  readOnlyMcp: boolean;
  structuredOutput: boolean;
  chatGptLogin: boolean;
  apiKeyLogin: boolean;
}
export const AgentEngineDescriptor = Schema.Struct({
  kind: AgentEngineKind,
  name: Schema.String,
  version: Schema.String,
  status: Schema.Literals(["starting", "available", "degraded", "unavailable"]),
  isDefault: Schema.Boolean,
  isBeta: Schema.Boolean,
  statusMessage: Schema.optionalKey(Schema.String),
  capabilities: AgentEngineCapabilities,
});
export interface AgentEngineDescriptor {
  kind: AgentEngineKind;
  name: string;
  version: string;
  status: "starting" | "available" | "degraded" | "unavailable";
  isDefault: boolean;
  isBeta: boolean;
  statusMessage?: string;
  capabilities: AgentEngineCapabilities;
}

export const AgentTaskDescriptor = Schema.Struct({
  id: AgentTaskType,
  label: Schema.String,
  category: Schema.String,
  promptVersion: Schema.String,
  writePolicy: Schema.Literals([
    "readonly",
    "change-preview",
    "provider-action-preview",
  ]),
  allowedTools: Schema.Array(Schema.String),
});
export interface AgentTaskDescriptor {
  id: AgentTaskType;
  label: string;
  category: string;
  promptVersion: string;
  writePolicy: "readonly" | "change-preview" | "provider-action-preview";
  allowedTools: readonly string[];
}

export const GlobalAgentSettings = Schema.Struct({
  defaultEngineKind: AgentEngineKind,
  defaultModel: Schema.optionalKey(AgentModelSelection),
  updatedAt: IsoDateTime,
});
export interface GlobalAgentSettings {
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
  updatedAt: IsoDateTime;
}
export const GlobalAgentSettingsInput = Schema.Struct({
  defaultEngineKind: AgentEngineKind,
  defaultModel: Schema.optionalKey(AgentModelSelection),
});
export interface GlobalAgentSettingsInput {
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
}

export const ProjectAgentSettings = Schema.Struct({
  projectId: Id,
  defaultEngineKind: AgentEngineKind,
  defaultModel: Schema.optionalKey(AgentModelSelection),
  assistantMode: Schema.Literals(["simple", "advanced"]),
  updatedAt: IsoDateTime,
});
export interface ProjectAgentSettings {
  projectId: Id;
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
  assistantMode: "simple" | "advanced";
  updatedAt: IsoDateTime;
}
export const ProjectAgentSettingsInput = Schema.Struct({
  defaultEngineKind: AgentEngineKind,
  defaultModel: Schema.optionalKey(AgentModelSelection),
  assistantMode: Schema.optionalKey(Schema.Literals(["simple", "advanced"])),
});
export interface ProjectAgentSettingsInput {
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
  assistantMode?: "simple" | "advanced";
}

export const DomainEntity = Schema.Struct({
  id: Id,
  domain: Schema.String,
  projectId: Schema.optionalKey(Id),
  parentId: Schema.optionalKey(Id),
  title: Schema.String,
  payload: Schema.Unknown,
  version: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface DomainEntity {
  id: Id;
  domain: string;
  projectId?: Id;
  parentId?: Id;
  title: string;
  payload: unknown;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const DomainEntityInput = Schema.Struct({
  projectId: Schema.optionalKey(Id),
  parentId: Schema.optionalKey(Id),
  title: Schema.String,
  payload: Schema.optionalKey(Schema.Unknown),
  capabilityToken: Schema.optionalKey(Schema.String),
});
export interface DomainEntityInput {
  projectId?: Id;
  parentId?: Id;
  title: string;
  payload?: unknown;
  capabilityToken?: string;
}
export const DomainEntityPatch = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  payload: Schema.optionalKey(Schema.Unknown),
  version: Schema.Int,
});
export interface DomainEntityPatch {
  title?: string;
  payload?: unknown;
  version: number;
}

/** P1 资产中心只读取既有 domain_entities，不复制本地媒体二进制或路径。 */
export const AssetCenterCategory = Schema.Literals([
  "character",
  "scene",
  "prop",
  "voice",
]);
export type AssetCenterCategory = "character" | "scene" | "prop" | "voice";
export const AssetCenterPreview = Schema.Struct({
  kind: Schema.Literals(["image", "audio", "none"]),
  status: Schema.Literals(["available", "missing", "unattached"]),
  label: Schema.optionalKey(Schema.String),
});
export interface AssetCenterPreview {
  kind: "image" | "audio" | "none";
  status: "available" | "missing" | "unattached";
  label?: string;
}
export const AssetCenterPreviewMedia = Schema.Struct({
  id: Id,
  kind: Schema.Literals(["image", "audio"]),
  dataUrl: Schema.String,
});
export interface AssetCenterPreviewMedia {
  id: Id;
  kind: "image" | "audio";
  dataUrl: string;
}
export const AssetCenterUsage = Schema.Struct({
  shotId: Id,
  shotTitle: Schema.String,
  sceneTitle: Schema.optionalKey(Schema.String),
});
export interface AssetCenterUsage {
  shotId: Id;
  shotTitle: string;
  sceneTitle?: string;
}
export const AssetCenterAsset = Schema.Struct({
  id: Id,
  title: Schema.String,
  category: AssetCenterCategory,
  subject: Schema.String,
  assetVersion: Schema.String,
  adopted: Schema.Boolean,
  lockStatus: Schema.Literals(["locked", "unlocked"]),
  stale: Schema.Boolean,
  preview: AssetCenterPreview,
  rightsStatus: Schema.Literals(["verified", "restricted", "unknown"]),
  costStatus: Schema.Literals(["known", "unknown"]),
  providerStatus: Schema.Literals(["available", "unavailable", "not-required"]),
  usages: Schema.Array(AssetCenterUsage),
  version: Schema.Int,
});
export interface AssetCenterAsset {
  id: Id;
  title: string;
  category: AssetCenterCategory;
  subject: string;
  assetVersion: string;
  adopted: boolean;
  lockStatus: "locked" | "unlocked";
  stale: boolean;
  preview: AssetCenterPreview;
  rightsStatus: "verified" | "restricted" | "unknown";
  costStatus: "known" | "unknown";
  providerStatus: "available" | "unavailable" | "not-required";
  usages: AssetCenterUsage[];
  version: number;
}
export const AssetCenter = Schema.Struct({
  projectId: Id,
  assets: Schema.Array(AssetCenterAsset),
});
export interface AssetCenter {
  projectId: Id;
  assets: AssetCenterAsset[];
}
export const AssetCenterActionInput = Schema.Struct({
  action: Schema.Literals([
    "adopt",
    "lock",
    "unlock",
    "assign-shot",
    "remove-shot",
  ]),
  version: Schema.Int,
  shotId: Schema.optionalKey(Id),
});
export interface AssetCenterActionInput {
  action: "adopt" | "lock" | "unlock" | "assign-shot" | "remove-shot";
  version: number;
  shotId?: Id;
}

/**
 * 对有序制作条目执行原子重排。每一项携带当前版本，避免陈旧界面覆盖
 * 其他协作者刚刚调整过的顺序。
 */
export const OrderedDomainEntity = Schema.Struct({
  id: Id,
  version: Schema.Int,
});
export interface OrderedDomainEntity {
  id: Id;
  version: number;
}
export const DomainChildrenReorderInput = Schema.Struct({
  items: Schema.Array(OrderedDomainEntity),
});
export interface DomainChildrenReorderInput {
  items: OrderedDomainEntity[];
}
export const DomainChildrenReorderResult = Schema.Struct({
  records: Schema.Array(DomainEntity),
});
export interface DomainChildrenReorderResult {
  records: DomainEntity[];
}
export const CurrentAdaptationInput = Schema.Struct({
  adaptationId: Id,
});
export interface CurrentAdaptationInput {
  adaptationId: Id;
}

export const ScriptReview = Schema.Struct({
  id: Id,
  scriptId: Id,
  hookStrengthScore: Schema.Number,
  dialogueScore: Schema.Number,
  conflictScore: Schema.Number,
  visualClarityScore: Schema.Number,
  sceneClarityScore: Schema.Number,
  characterFitScore: Schema.Number,
  shotReadinessScore: Schema.Number,
  aiVideoFeasibilityScore: Schema.Number,
  cliffhangerScore: Schema.Number,
  overallScore: Schema.Number,
  issues: Schema.Array(Schema.String),
  suggestions: Schema.Array(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface ScriptReview {
  id: Id;
  scriptId: Id;
  hookStrengthScore: number;
  dialogueScore: number;
  conflictScore: number;
  visualClarityScore: number;
  sceneClarityScore: number;
  characterFitScore: number;
  shotReadinessScore: number;
  aiVideoFeasibilityScore: number;
  cliffhangerScore: number;
  overallScore: number;
  issues: string[];
  suggestions: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const AiVideoDifficulty = Schema.Union([
  Schema.Literal("low"),
  Schema.Literal("medium"),
  Schema.Literal("high"),
]);
export type AiVideoDifficulty = "low" | "medium" | "high";
export const ShotReview = Schema.Struct({
  id: Id,
  shotId: Id,
  lengthScore: Schema.Number,
  characterCountScore: Schema.Number,
  actionComplexityScore: Schema.Number,
  visualClarityScore: Schema.Number,
  characterConsistencyScore: Schema.Number,
  sceneContinuityScore: Schema.Number,
  promptControllabilityScore: Schema.Number,
  verticalSuitabilityScore: Schema.Number,
  overallScore: Schema.Number,
  aiVideoDifficulty: AiVideoDifficulty,
  issues: Schema.Array(Schema.String),
  suggestions: Schema.Array(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface ShotReview {
  id: Id;
  shotId: Id;
  lengthScore: number;
  characterCountScore: number;
  actionComplexityScore: number;
  visualClarityScore: number;
  characterConsistencyScore: number;
  sceneContinuityScore: number;
  promptControllabilityScore: number;
  verticalSuitabilityScore: number;
  overallScore: number;
  aiVideoDifficulty: AiVideoDifficulty;
  issues: string[];
  suggestions: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const PromptVersion = Schema.Struct({
  id: Id,
  shotId: Id,
  version: Schema.Int,
  taskType: Schema.String,
  videoPrompt: Schema.String,
  negativePrompt: Schema.optionalKey(Schema.String),
  imagePrompt: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
});
export interface PromptVersion {
  id: Id;
  shotId: Id;
  version: number;
  taskType: string;
  videoPrompt: string;
  negativePrompt?: string;
  imagePrompt?: string;
  note?: string;
  createdAt: IsoDateTime;
}
export const PromptVersionInput = Schema.Struct({
  taskType: Schema.String,
  videoPrompt: Schema.optionalKey(Schema.String),
  negativePrompt: Schema.optionalKey(Schema.String),
  imagePrompt: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
});
export interface PromptVersionInput {
  taskType: string;
  videoPrompt?: string;
  negativePrompt?: string;
  imagePrompt?: string;
  note?: string;
}

/** 项目改编中分集结构的可重建分析，不包含模型生成的虚假结论。 */
export const EpisodeAnalysis = Schema.Struct({
  id: Id,
  adaptationId: Id,
  episodeCount: Schema.Int,
  hookCoverage: Schema.Number,
  cliffhangerCoverage: Schema.Number,
  outlineCoverage: Schema.Number,
  overallScore: Schema.Number,
  summary: Schema.String,
  suggestions: Schema.Array(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface EpisodeAnalysis {
  id: Id;
  adaptationId: Id;
  episodeCount: number;
  hookCoverage: number;
  cliffhangerCoverage: number;
  outlineCoverage: number;
  overallScore: number;
  summary: string;
  suggestions: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** 平台交付档案只描述应用可在本地核验的规格；平台实时要求仍须人工确认。 */
export const PlatformDeliveryProfile = Schema.Struct({
  id: Id,
  version: Schema.String,
  title: Schema.String,
  platform: Schema.String,
  region: Schema.String,
  sourceUrl: Schema.String,
  sourceStatus: Schema.Union([
    Schema.Literal("internal_master"),
    Schema.Literal("platform_portal"),
    Schema.Literal("unknown"),
  ]),
  checkedAt: IsoDateTime,
  filenamePrefix: Schema.String,
  video: Schema.Struct({
    width: Schema.Int,
    height: Schema.Int,
    videoCodec: Schema.String,
    audioCodec: Schema.String,
  }),
  duration: Schema.Struct({
    status: Schema.Union([
      Schema.Literal("verified"),
      Schema.Literal("manual"),
    ]),
    minSeconds: Schema.optionalKey(Schema.Int),
    maxSeconds: Schema.optionalKey(Schema.Int),
    note: Schema.String,
  }),
  subtitleSafeZone: Schema.Struct({
    bottomMarginPx: Schema.Int,
    note: Schema.String,
  }),
  requiredListingFields: Schema.Array(Schema.String),
  manualFields: Schema.Array(Schema.String),
});
export interface PlatformDeliveryProfile {
  id: Id;
  version: string;
  title: string;
  platform: string;
  region: string;
  sourceUrl: string;
  sourceStatus: "internal_master" | "platform_portal" | "unknown";
  checkedAt: IsoDateTime;
  filenamePrefix: string;
  video: {
    width: number;
    height: number;
    videoCodec: string;
    audioCodec: string;
  };
  duration: {
    status: "verified" | "manual";
    minSeconds?: number;
    maxSeconds?: number;
    note: string;
  };
  subtitleSafeZone: { bottomMarginPx: number; note: string };
  requiredListingFields: string[];
  manualFields: string[];
}
export const DeliveryCreativeVariant = Schema.Struct({
  id: Id,
  projectId: Id,
  adaptationId: Id,
  label: Schema.String,
  title: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  coverAssetId: Schema.optionalKey(Id),
  source: Schema.Union([Schema.Literal("manual"), Schema.Literal("ai_draft")]),
  status: Schema.Union([
    Schema.Literal("candidate"),
    Schema.Literal("adopted"),
    Schema.Literal("archived"),
  ]),
  versionNumber: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface DeliveryCreativeVariant {
  id: Id;
  projectId: Id;
  adaptationId: Id;
  label: string;
  title: string;
  description: string;
  tags: string[];
  coverAssetId?: Id;
  source: "manual" | "ai_draft";
  status: "candidate" | "adopted" | "archived";
  versionNumber: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const DeliveryCreativeVariantInput = Schema.Struct({
  label: RequiredText,
  title: RequiredText,
  description: RequiredText,
  tags: Schema.Array(RequiredText),
  coverAssetId: Schema.optionalKey(Id),
  source: Schema.optionalKey(
    Schema.Union([Schema.Literal("manual"), Schema.Literal("ai_draft")]),
  ),
});
export interface DeliveryCreativeVariantInput {
  label: string;
  title: string;
  description: string;
  tags: string[];
  coverAssetId?: Id;
  source?: "manual" | "ai_draft";
}
export const PlatformDeliveryPreflightInput = Schema.Struct({
  profileId: Id,
  creativeVariantId: Id,
  manualFieldsConfirmed: Schema.Boolean,
});
export interface PlatformDeliveryPreflightInput {
  profileId: Id;
  creativeVariantId: Id;
  manualFieldsConfirmed: boolean;
}
export const PlatformDeliveryPreflight = Schema.Struct({
  ok: Schema.Boolean,
  profile: Schema.optionalKey(PlatformDeliveryProfile),
  blockers: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
  expectedFiles: Schema.Array(Schema.String),
  finalBaseName: Schema.optionalKey(Schema.String),
  sourceFingerprint: Schema.optionalKey(Schema.String),
});
export interface PlatformDeliveryPreflight {
  ok: boolean;
  profile?: PlatformDeliveryProfile;
  blockers: string[];
  warnings: string[];
  expectedFiles: string[];
  finalBaseName?: string;
  sourceFingerprint?: string;
}
export const PlatformDeliveryArchive = Schema.Struct({
  id: Id,
  projectId: Id,
  adaptationId: Id,
  episodeId: Id,
  profileId: Id,
  profileVersion: Schema.String,
  creativeVariantId: Id,
  deliveryVersion: Schema.Int,
  sourceFingerprint: Schema.String,
  createdAt: IsoDateTime,
});
export interface PlatformDeliveryArchive {
  id: Id;
  projectId: Id;
  adaptationId: Id;
  episodeId: Id;
  profileId: Id;
  profileVersion: string;
  creativeVariantId: Id;
  deliveryVersion: number;
  sourceFingerprint: string;
  createdAt: IsoDateTime;
}

/** 可交给剪辑工具人工重链接的纯数据时间线，不包含本地绝对路径。 */
export const EditorTimelineClip = Schema.Struct({
  id: Id,
  shotId: Id,
  orderIndex: Schema.Int,
  name: Schema.String,
  startSeconds: Schema.Number,
  durationSeconds: Schema.Number,
  subtitle: Schema.optionalKey(Schema.String),
  transition: Schema.Union([
    Schema.Literal("cut"),
    Schema.Literal("dissolve"),
    Schema.Literal("fade"),
  ]),
  mediaKind: Schema.Union([
    Schema.Literal("video"),
    Schema.Literal("still"),
    Schema.Literal("slate"),
  ]),
  mediaStatus: Schema.Union([
    Schema.Literal("referenced"),
    Schema.Literal("needs_relink"),
  ]),
});
export interface EditorTimelineClip {
  id: Id;
  shotId: Id;
  orderIndex: number;
  name: string;
  startSeconds: number;
  durationSeconds: number;
  subtitle?: string;
  transition: "cut" | "dissolve" | "fade";
  mediaKind: "video" | "still" | "slate";
  mediaStatus: "referenced" | "needs_relink";
}
export const EditorTimelineManifest = Schema.Struct({
  format: Schema.Literal("dramaip-editor-timeline"),
  version: Schema.Literal(1),
  projectId: Id,
  adaptationId: Id,
  episodeId: Id,
  title: Schema.String,
  frameRate: Schema.Union([
    Schema.Literal(24),
    Schema.Literal(25),
    Schema.Literal(30),
  ]),
  width: Schema.Int,
  height: Schema.Int,
  clips: Schema.Array(EditorTimelineClip),
  createdAt: IsoDateTime,
});
export interface EditorTimelineManifest {
  format: "dramaip-editor-timeline";
  version: 1;
  projectId: Id;
  adaptationId: Id;
  episodeId: Id;
  title: string;
  frameRate: 24 | 25 | 30;
  width: number;
  height: number;
  clips: EditorTimelineClip[];
  createdAt: IsoDateTime;
}
export const EditorExportPreflight = Schema.Struct({
  canExport: Schema.Boolean,
  blockers: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
  referencedClipCount: Schema.Int,
  relinkRequiredCount: Schema.Int,
});
export interface EditorExportPreflight {
  canExport: boolean;
  blockers: string[];
  warnings: string[];
  referencedClipCount: number;
  relinkRequiredCount: number;
}
export const ReviewPackage = Schema.Struct({
  id: Id,
  projectId: Id,
  adaptationId: Id,
  episodeId: Id,
  kind: Schema.Literal("offline"),
  status: Schema.Literal("exported"),
  title: Schema.String,
  manifest: EditorTimelineManifest,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface ReviewPackage {
  id: Id;
  projectId: Id;
  adaptationId: Id;
  episodeId: Id;
  kind: "offline";
  status: "exported";
  title: string;
  manifest: EditorTimelineManifest;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const ReviewComment = Schema.Struct({
  id: Id,
  packageId: Id,
  shotId: Schema.optionalKey(Id),
  timecodeSeconds: Schema.optionalKey(Schema.Number),
  authorAlias: Schema.optionalKey(Schema.String),
  body: Schema.String,
  resolved: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface ReviewComment {
  id: Id;
  packageId: Id;
  shotId?: Id;
  timecodeSeconds?: number;
  authorAlias?: string;
  body: string;
  resolved: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const ReviewCommentInput = Schema.Struct({
  shotId: Schema.optionalKey(Id),
  timecodeSeconds: Schema.optionalKey(Schema.Number),
  authorAlias: Schema.optionalKey(Schema.String),
  body: RequiredText,
});
export interface ReviewCommentInput {
  shotId?: Id;
  timecodeSeconds?: number;
  authorAlias?: string;
  body: string;
}
export const ReviewDecision = Schema.Struct({
  id: Id,
  packageId: Id,
  shotId: Schema.optionalKey(Id),
  decision: Schema.Union([
    Schema.Literal("approve"),
    Schema.Literal("return"),
    Schema.Literal("request_changes"),
    Schema.Literal("note"),
  ]),
  authorAlias: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
});
export interface ReviewDecision {
  id: Id;
  packageId: Id;
  shotId?: Id;
  decision: "approve" | "return" | "request_changes" | "note";
  authorAlias?: string;
  note?: string;
  createdAt: IsoDateTime;
}
export const ReviewDecisionInput = Schema.Struct({
  shotId: Schema.optionalKey(Id),
  decision: Schema.Union([
    Schema.Literal("approve"),
    Schema.Literal("return"),
    Schema.Literal("request_changes"),
    Schema.Literal("note"),
  ]),
  authorAlias: Schema.optionalKey(Schema.String),
  note: Schema.optionalKey(Schema.String),
});
export interface ReviewDecisionInput {
  shotId?: Id;
  decision: "approve" | "return" | "request_changes" | "note";
  authorAlias?: string;
  note?: string;
}
export const OfflineReviewImportInput = Schema.Struct({
  capabilityToken: Schema.String,
});
export interface OfflineReviewImportInput {
  capabilityToken: string;
}
export const OfflineReviewImportResult = Schema.Struct({
  packageId: Id,
  commentCount: Schema.Int,
  decisionCount: Schema.Int,
});
export interface OfflineReviewImportResult {
  packageId: Id;
  commentCount: number;
  decisionCount: number;
}

/** 版本化离线合规规则是本地证据，不构成法律意见或平台审核结果。 */
export const ComplianceRuleProfile = Schema.Struct({
  id: Id,
  version: Schema.String,
  title: Schema.String,
  sourceUrl: Schema.String,
  sourceStatus: Schema.Union([
    Schema.Literal("official"),
    Schema.Literal("consultation"),
    Schema.Literal("platform_guidance"),
    Schema.Literal("unknown"),
  ]),
  publishedAt: IsoDateTime,
  effectiveAt: Schema.optionalKey(IsoDateTime),
  regions: Schema.Array(Schema.String),
  platforms: Schema.Array(Schema.String),
  requiredVisibleLabel: Schema.String,
  requiredMetadataKeys: Schema.Array(Schema.String),
  contentChecksum: Schema.String,
  integrityStatus: Schema.Union([
    Schema.Literal("verified"),
    Schema.Literal("unchecked"),
    Schema.Literal("invalid"),
  ]),
  active: Schema.Boolean,
  builtIn: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface ComplianceRuleProfile {
  id: Id;
  version: string;
  title: string;
  sourceUrl: string;
  sourceStatus: "official" | "consultation" | "platform_guidance" | "unknown";
  publishedAt: IsoDateTime;
  effectiveAt?: IsoDateTime;
  regions: string[];
  platforms: string[];
  requiredVisibleLabel: string;
  requiredMetadataKeys: string[];
  contentChecksum: string;
  integrityStatus: "verified" | "unchecked" | "invalid";
  active: boolean;
  builtIn: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const CompliancePreflightInput = Schema.Struct({
  title: RequiredText,
  subtitleLanguage: RequiredText,
  targetPlatform: Schema.optionalKey(Schema.String),
  targetRegion: Schema.optionalKey(Schema.String),
  deliveryDate: RequiredText,
  aigcDeclared: Schema.Boolean,
  manualContentReviewConfirmed: Schema.Boolean,
});
export interface CompliancePreflightInput {
  title: string;
  subtitleLanguage: string;
  targetPlatform?: string;
  targetRegion?: string;
  deliveryDate: string;
  aigcDeclared: boolean;
  manualContentReviewConfirmed: boolean;
}
export const EpisodeCompliancePreflight = Schema.Struct({
  ok: Schema.Boolean,
  profile: Schema.optionalKey(ComplianceRuleProfile),
  blockers: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
  visibleLabel: Schema.optionalKey(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.String),
  sourceFingerprint: Schema.String,
});
export interface EpisodeCompliancePreflight {
  ok: boolean;
  profile?: ComplianceRuleProfile;
  blockers: string[];
  warnings: string[];
  visibleLabel?: string;
  metadata: Record<string, string>;
  sourceFingerprint: string;
}

/** A non-sensitive summary of an OpenAI-compatible provider connection check. */
export const ProviderConnectionResult = Schema.Struct({
  providerId: Id,
  ok: Schema.Boolean,
  checkedAt: IsoDateTime,
  statusCode: Schema.optionalKey(Schema.Int),
  models: Schema.Array(Schema.String),
  message: Schema.String,
});
export interface ProviderConnectionResult {
  providerId: Id;
  ok: boolean;
  checkedAt: IsoDateTime;
  statusCode?: number;
  models: string[];
  message: string;
}

/** Non-sensitive result of activating a saved provider for the OpenCode sidecar. */
export const AgentProviderActivationResult = Schema.Struct({
  providerId: Id,
  engineAvailable: Schema.Boolean,
  providerKind: Schema.String,
  model: Schema.String,
  activatedAt: IsoDateTime,
  message: Schema.String,
});
export interface AgentProviderActivationResult {
  providerId: Id;
  engineAvailable: boolean;
  providerKind: string;
  model: string;
  activatedAt: IsoDateTime;
  message: string;
}

export const StoryBibleChangeSetStatus = Schema.Union([
  Schema.Literal("queued"),
  Schema.Literal("draft"),
  Schema.Literal("applied"),
  Schema.Literal("paused"),
  Schema.Literal("skipped"),
  Schema.Literal("discarded"),
  Schema.Literal("stale"),
  Schema.Literal("failed"),
]);
export type StoryBibleChangeSetStatus =
  | "queued"
  | "draft"
  | "applied"
  | "paused"
  | "skipped"
  | "discarded"
  | "stale"
  | "failed";
export const StoryBibleSettings = Schema.Struct({
  projectId: Id,
  autoSuggest: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export interface StoryBibleSettings {
  projectId: Id;
  autoSuggest: boolean;
  updatedAt: IsoDateTime;
}
export const StoryBibleChangeSet = Schema.Struct({
  id: Id,
  projectId: Id,
  chapterId: Id,
  sourceVersion: Schema.Int,
  status: StoryBibleChangeSetStatus,
  summary: Schema.String,
  taskId: Schema.optionalKey(Id),
  conflictNotes: Schema.Array(Schema.String),
  appliedAt: Schema.optionalKey(IsoDateTime),
  undoneAt: Schema.optionalKey(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface StoryBibleChangeSet {
  id: Id;
  projectId: Id;
  chapterId: Id;
  sourceVersion: number;
  status: StoryBibleChangeSetStatus;
  summary: string;
  taskId?: Id;
  conflictNotes: string[];
  appliedAt?: IsoDateTime;
  undoneAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const StoryBibleStaleMark = Schema.Struct({
  id: Id,
  projectId: Id,
  chapterId: Id,
  reason: Schema.String,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface StoryBibleStaleMark {
  id: Id;
  projectId: Id;
  chapterId: Id;
  reason: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const StoryBibleChangeSetInput = Schema.Struct({
  projectId: Id,
  chapterId: Id,
});
export interface StoryBibleChangeSetInput {
  projectId: Id;
  chapterId: Id;
}

export const ProjectPackagePreview = Schema.Struct({
  id: Id,
  sourceName: Schema.String,
  projectTitle: Schema.String,
  shortDramaType: Schema.String,
  chapterCount: Schema.Int,
  resourceCount: Schema.Int,
  warnings: Schema.Array(Schema.String),
  expiresAt: IsoDateTime,
});
export interface ProjectPackagePreview {
  id: Id;
  sourceName: string;
  projectTitle: string;
  shortDramaType: string;
  chapterCount: number;
  resourceCount: number;
  warnings: string[];
  expiresAt: IsoDateTime;
}
export const ProjectPackagePreviewInput = Schema.Struct({
  capabilityToken: Schema.String,
});
export interface ProjectPackagePreviewInput {
  capabilityToken: string;
}
export const ProjectPackageCommitInput = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
});
export interface ProjectPackageCommitInput {
  title?: string;
}
export const ProjectPackageCommitResult = Schema.Struct({
  project: Project,
  chaptersCreated: Schema.Int,
  resourcesCreated: Schema.Int,
});
export interface ProjectPackageCommitResult {
  project: Project;
  chaptersCreated: number;
  resourcesCreated: number;
}

export const ChapterAnalysisRunResult = Schema.Struct({
  task: Task,
  records: Schema.Array(DomainEntity),
});
export interface ChapterAnalysisRunResult {
  task: Task;
  records: DomainEntity[];
}

export const GlobalSearchResult = Schema.Struct({
  kind: Schema.String,
  id: Id,
  title: Schema.String,
  excerpt: Schema.optionalKey(Schema.String),
  projectId: Schema.optionalKey(Id),
  updatedAt: IsoDateTime,
});
export interface GlobalSearchResult {
  kind: string;
  id: Id;
  title: string;
  excerpt?: string;
  projectId?: Id;
  updatedAt: IsoDateTime;
}
export const GlobalSearchResponse = Schema.Struct({
  query: Schema.String,
  results: Schema.Array(GlobalSearchResult),
});
export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
}

export const BackupRecord = Schema.Struct({
  id: Id,
  name: Schema.String,
  size: Schema.Int,
  createdAt: IsoDateTime,
});
export interface BackupRecord {
  id: Id;
  name: string;
  size: number;
  createdAt: IsoDateTime;
}

export const ExportDocument = Schema.Struct({
  fileName: Schema.String,
  mimeType: Schema.String,
  content: Schema.String,
});
export interface ExportDocument {
  fileName: string;
  mimeType: string;
  content: string;
}

/** A source import is always previewed before it can write to a project. */
export const SourceImportStrategy = Schema.Union([
  Schema.Literal("append"),
  Schema.Literal("merge"),
  Schema.Literal("replace"),
]);
export type SourceImportStrategy = "append" | "merge" | "replace";

export const SourceImportChapter = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  content: Schema.String,
  orderIndex: Schema.Int,
  wordCount: Schema.Int,
  warning: Schema.optionalKey(Schema.String),
});
export interface SourceImportChapter {
  key: string;
  title: string;
  content: string;
  orderIndex: number;
  wordCount: number;
  warning?: string;
}

export const SourceImportScene = Schema.Struct({
  key: Schema.String,
  title: Schema.String,
  location: Schema.String,
  timeOfDay: Schema.optionalKey(Schema.String),
  visualDescription: Schema.String,
  characters: Schema.Array(Schema.String),
  summary: Schema.String,
  content: Schema.String,
  orderIndex: Schema.Int,
  dialogueCount: Schema.Int,
  actionCount: Schema.Int,
});
export interface SourceImportScene {
  key: string;
  title: string;
  location: string;
  timeOfDay?: string;
  visualDescription: string;
  characters: string[];
  summary: string;
  content: string;
  orderIndex: number;
  dialogueCount: number;
  actionCount: number;
}

export const SourceImportEpisode = Schema.Struct({
  key: Schema.String,
  episodeNumber: Schema.Int,
  title: Schema.String,
  content: Schema.String,
  scenes: Schema.Array(SourceImportScene),
});
export interface SourceImportEpisode {
  key: string;
  episodeNumber: number;
  title: string;
  content: string;
  scenes: SourceImportScene[];
}

export const SourceImportPreview = Schema.Struct({
  fileName: Schema.String,
  sourceType: Schema.Union([
    Schema.Literal("txt"),
    Schema.Literal("markdown"),
    Schema.Literal("docx"),
    Schema.Literal("epub"),
    Schema.Literal("script-json"),
    Schema.Literal("draft"),
  ]),
  contentKind: Schema.Union([
    Schema.Literal("novel"),
    Schema.Literal("script"),
    Schema.Literal("draft"),
  ]),
  title: Schema.String,
  charCount: Schema.Int,
  chapters: Schema.Array(SourceImportChapter),
  episodes: Schema.Array(SourceImportEpisode),
  warnings: Schema.Array(Schema.String),
});
export interface SourceImportPreview {
  fileName: string;
  sourceType: "txt" | "markdown" | "docx" | "epub" | "script-json" | "draft";
  contentKind: "novel" | "script" | "draft";
  title: string;
  charCount: number;
  chapters: SourceImportChapter[];
  episodes: SourceImportEpisode[];
  warnings: string[];
}

export const SourceImportPreviewInput = Schema.Struct({
  projectId: Id,
  capabilityToken: Schema.String,
});
export interface SourceImportPreviewInput {
  projectId: Id;
  capabilityToken: string;
}

export const SourceImportPreviewResponse = Schema.Struct({
  importId: Id,
  preview: SourceImportPreview,
  duplicates: Schema.Struct({
    chapters: Schema.Array(Schema.String),
    episodes: Schema.Array(Schema.Int),
  }),
  expiresAt: IsoDateTime,
});
export interface SourceImportPreviewResponse {
  importId: Id;
  preview: SourceImportPreview;
  duplicates: { chapters: string[]; episodes: number[] };
  expiresAt: IsoDateTime;
}

export const SourceImportCommitInput = Schema.Struct({
  projectId: Id,
  strategy: SourceImportStrategy,
  rightsConfirmed: Schema.Boolean,
  destructiveConfirmed: Schema.Boolean,
  preview: SourceImportPreview,
});
export interface SourceImportCommitInput {
  projectId: Id;
  strategy: SourceImportStrategy;
  rightsConfirmed: boolean;
  destructiveConfirmed: boolean;
  preview: SourceImportPreview;
}

/** A traceable text range used by the post-import review workflow. */
export const ImportExtractionSourceRef = Schema.Struct({
  sourceKey: Schema.String,
  chapterTitle: Schema.String,
  start: Schema.Int,
  end: Schema.Int,
  excerpt: Schema.String,
  sourceVersion: Schema.Int,
});
export interface ImportExtractionSourceRef {
  sourceKey: string;
  chapterTitle: string;
  start: number;
  end: number;
  excerpt: string;
  sourceVersion: number;
}

export const ImportExtractionCandidateType = Schema.Union([
  Schema.Literal("character"),
  Schema.Literal("scene"),
  Schema.Literal("prop"),
  Schema.Literal("chapter-summary"),
  Schema.Literal("adaptation"),
]);
export type ImportExtractionCandidateType =
  "character" | "scene" | "prop" | "chapter-summary" | "adaptation";

export const ImportExtractionCandidateStatus = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("rejected"),
  Schema.Literal("adopted"),
  Schema.Literal("conflict"),
]);
export type ImportExtractionCandidateStatus =
  "draft" | "rejected" | "adopted" | "conflict";

export const ImportExtractionCandidate = Schema.Struct({
  id: Id,
  type: ImportExtractionCandidateType,
  title: Schema.String,
  summary: Schema.String,
  confidence: Schema.Number,
  sourceRefs: Schema.Array(ImportExtractionSourceRef),
  status: ImportExtractionCandidateStatus,
  conflictNote: Schema.optionalKey(Schema.String),
});
export interface ImportExtractionCandidate {
  id: Id;
  type: ImportExtractionCandidateType;
  title: string;
  summary: string;
  confidence: number;
  sourceRefs: ImportExtractionSourceRef[];
  status: ImportExtractionCandidateStatus;
  conflictNote?: string;
}

export const ImportExtractionChangeSetStatus = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("applied"),
  Schema.Literal("stale"),
  Schema.Literal("discarded"),
  Schema.Literal("failed"),
]);
export type ImportExtractionChangeSetStatus =
  "draft" | "applied" | "stale" | "discarded" | "failed";

export const ImportExtractionChangeSet = Schema.Struct({
  id: Id,
  projectId: Id,
  sourceFingerprint: Schema.String,
  sourceTitle: Schema.String,
  status: ImportExtractionChangeSetStatus,
  summary: Schema.String,
  candidates: Schema.Array(ImportExtractionCandidate),
  appliedAt: Schema.optionalKey(IsoDateTime),
  undoneAt: Schema.optionalKey(IsoDateTime),
  errorMessage: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface ImportExtractionChangeSet {
  id: Id;
  projectId: Id;
  sourceFingerprint: string;
  sourceTitle: string;
  status: ImportExtractionChangeSetStatus;
  summary: string;
  candidates: ImportExtractionCandidate[];
  appliedAt?: IsoDateTime;
  undoneAt?: IsoDateTime;
  errorMessage?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const ImportExtractionCandidatePatch = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(
    Schema.Union([Schema.Literal("draft"), Schema.Literal("rejected")]),
  ),
});
export interface ImportExtractionCandidatePatch {
  title?: string;
  summary?: string;
  status?: "draft" | "rejected";
}

export const ImportExtractionAdoptInput = Schema.Struct({
  candidateIds: Schema.optionalKey(Schema.Array(Id)),
});
export interface ImportExtractionAdoptInput {
  candidateIds?: Id[];
}

export const SourceImportCommitResult = Schema.Struct({
  createdChapters: Schema.Int,
  updatedChapters: Schema.Int,
  createdEpisodes: Schema.Int,
  createdScripts: Schema.Int,
  updatedScripts: Schema.Int,
  createdScenes: Schema.Int,
  adaptationProjectId: Schema.optionalKey(Id),
  checkpointCount: Schema.Int,
  extractionChangeSet: Schema.optionalKey(ImportExtractionChangeSet),
});
export interface SourceImportCommitResult {
  createdChapters: number;
  updatedChapters: number;
  createdEpisodes: number;
  createdScripts: number;
  updatedScripts: number;
  createdScenes: number;
  adaptationProjectId?: Id;
  checkpointCount: number;
  extractionChangeSet?: ImportExtractionChangeSet;
}

export const PilotPlanStatus = Schema.Union([
  Schema.Literal("draft"),
  Schema.Literal("active"),
  Schema.Literal("stale"),
  Schema.Literal("ready-for-review"),
  Schema.Literal("canceled"),
]);
export type PilotPlanStatus =
  "draft" | "active" | "stale" | "ready-for-review" | "canceled";

export const PilotPlanStage = Schema.Union([
  Schema.Literal("confirm-source"),
  Schema.Literal("script"),
  Schema.Literal("scenes"),
  Schema.Literal("shots"),
  Schema.Literal("assets"),
  Schema.Literal("review"),
]);
export type PilotPlanStage =
  "confirm-source" | "script" | "scenes" | "shots" | "assets" | "review";

export const PilotPlan = Schema.Struct({
  id: Id,
  projectId: Id,
  chapterIds: Schema.Array(Id),
  episodeCount: Schema.Int,
  status: PilotPlanStatus,
  stage: PilotPlanStage,
  sourceConfirmed: Schema.Boolean,
  adaptationId: Schema.optionalKey(Id),
  episodeIds: Schema.Array(Id),
  coverage: Schema.Struct({
    episodes: Schema.Int,
    scripts: Schema.Int,
    scenes: Schema.Int,
    shots: Schema.Int,
    assets: Schema.Int,
  }),
  blocker: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface PilotPlan {
  id: Id;
  projectId: Id;
  chapterIds: Id[];
  episodeCount: number;
  status: PilotPlanStatus;
  stage: PilotPlanStage;
  sourceConfirmed: boolean;
  adaptationId?: Id;
  episodeIds: Id[];
  coverage: {
    episodes: number;
    scripts: number;
    scenes: number;
    shots: number;
    assets: number;
  };
  blocker?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const PilotPlanCreateInput = Schema.Struct({
  projectId: Id,
  chapterIds: Schema.Array(Id),
  episodeCount: Schema.Int,
});
export interface PilotPlanCreateInput {
  projectId: Id;
  chapterIds: Id[];
  episodeCount: number;
}

export const PilotPlanActionInput = Schema.Struct({
  action: Schema.Union([
    Schema.Literal("confirm-source"),
    Schema.Literal("return-source"),
    Schema.Literal("cancel"),
    Schema.Literal("resume"),
  ]),
});
export interface PilotPlanActionInput {
  action: "confirm-source" | "return-source" | "cancel" | "resume";
}

export const EpisodeWorkflowKind = Schema.Union([
  Schema.Literal("quality-check"),
  Schema.Literal("compliance-check"),
  Schema.Literal("delivery-preflight"),
  Schema.Literal("render-preflight"),
  Schema.Literal("animatic-draft"),
  Schema.Literal("minimal-redo-plan"),
  Schema.Literal("review-package"),
]);
export type EpisodeWorkflowKind =
  | "quality-check"
  | "compliance-check"
  | "delivery-preflight"
  | "render-preflight"
  | "animatic-draft"
  | "minimal-redo-plan"
  | "review-package";

export const EpisodeWorkflowInput = Schema.Struct({
  projectId: Id,
  episodeId: Id,
  kind: EpisodeWorkflowKind,
});
export interface EpisodeWorkflowInput {
  projectId: Id;
  episodeId: Id;
  kind: EpisodeWorkflowKind;
}

export const EpisodeWorkflowResult = Schema.Struct({
  task: Task,
  record: Schema.optionalKey(DomainEntity),
  summary: Schema.String,
});
export interface EpisodeWorkflowResult {
  task: Task;
  record?: DomainEntity;
  summary: string;
}

/** 受控音频制作。音轨片段只引用项目台账中的素材和当前分集的分镜。 */
export const AudioTrackKind = Schema.Union([
  Schema.Literal("dialogue"),
  Schema.Literal("narration"),
  Schema.Literal("bgm"),
  Schema.Literal("sfx"),
]);
export type AudioTrackKind = "dialogue" | "narration" | "bgm" | "sfx";

export const VoiceProfile = Schema.Struct({
  id: Id,
  projectId: Id,
  title: Schema.String,
  characterId: Schema.optionalKey(Id),
  sampleAssetId: Schema.optionalKey(Id),
  providerVoice: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  status: Schema.Union([Schema.Literal("draft"), Schema.Literal("adopted")]),
  version: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface VoiceProfile {
  id: Id;
  projectId: Id;
  title: string;
  characterId?: Id;
  sampleAssetId?: Id;
  providerVoice?: string;
  description?: string;
  status: "draft" | "adopted";
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const VoiceProfileInput = Schema.Struct({
  projectId: Id,
  title: Schema.String,
  characterId: Schema.optionalKey(Id),
  sampleAssetId: Schema.optionalKey(Id),
  providerVoice: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
});
export interface VoiceProfileInput {
  projectId: Id;
  title: string;
  characterId?: Id;
  sampleAssetId?: Id;
  providerVoice?: string;
  description?: string;
}

export const AudioTrackClip = Schema.Struct({
  id: Id,
  shotId: Schema.optionalKey(Id),
  assetId: Schema.optionalKey(Id),
  voiceProfileId: Schema.optionalKey(Id),
  startSeconds: Schema.Number,
  durationSeconds: Schema.Number,
  text: Schema.optionalKey(Schema.String),
});
export interface AudioTrackClip {
  id: Id;
  shotId?: Id;
  assetId?: Id;
  voiceProfileId?: Id;
  startSeconds: number;
  durationSeconds: number;
  text?: string;
}

export const AudioTrackClipInput = Schema.Struct({
  shotId: Schema.optionalKey(Id),
  assetId: Schema.optionalKey(Id),
  voiceProfileId: Schema.optionalKey(Id),
  startSeconds: Schema.Number,
  durationSeconds: Schema.Number,
  text: Schema.optionalKey(Schema.String),
});
export interface AudioTrackClipInput {
  shotId?: Id;
  assetId?: Id;
  voiceProfileId?: Id;
  startSeconds: number;
  durationSeconds: number;
  text?: string;
}

export const AudioTrack = Schema.Struct({
  id: Id,
  projectId: Id,
  episodeId: Id,
  kind: AudioTrackKind,
  label: Schema.String,
  sourceFingerprint: Schema.String,
  clips: Schema.Array(AudioTrackClip),
  status: Schema.Union([Schema.Literal("draft"), Schema.Literal("adopted")]),
  stale: Schema.Boolean,
  staleReason: Schema.optionalKey(Schema.String),
  version: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface AudioTrack {
  id: Id;
  projectId: Id;
  episodeId: Id;
  kind: AudioTrackKind;
  label: string;
  sourceFingerprint: string;
  clips: AudioTrackClip[];
  status: "draft" | "adopted";
  stale: boolean;
  staleReason?: string;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const AudioTrackInput = Schema.Struct({
  projectId: Id,
  episodeId: Id,
  kind: AudioTrackKind,
  label: Schema.String,
  clips: Schema.Array(AudioTrackClipInput),
});
export interface AudioTrackInput {
  projectId: Id;
  episodeId: Id;
  kind: AudioTrackKind;
  label: string;
  clips: AudioTrackClipInput[];
}

export const AnimaticClip = Schema.Struct({
  shotId: Id,
  title: Schema.String,
  startSeconds: Schema.Number,
  durationSeconds: Schema.Number,
  mediaAssetId: Schema.optionalKey(Id),
  mediaKind: Schema.Union([
    Schema.Literal("video"),
    Schema.Literal("still"),
    Schema.Literal("missing"),
  ]),
});
export interface AnimaticClip {
  shotId: Id;
  title: string;
  startSeconds: number;
  durationSeconds: number;
  mediaAssetId?: Id;
  mediaKind: "video" | "still" | "missing";
}

export const AnimaticInitialization = Schema.Struct({
  projectId: Id,
  episodeId: Id,
  sourceFingerprint: Schema.String,
  clips: Schema.Array(AnimaticClip),
});
export interface AnimaticInitialization {
  projectId: Id;
  episodeId: Id;
  sourceFingerprint: string;
  clips: AnimaticClip[];
}

export const AnimaticDraft = Schema.Struct({
  id: Id,
  projectId: Id,
  episodeId: Id,
  sourceFingerprint: Schema.String,
  clips: Schema.Array(AnimaticClip),
  annotations: Schema.String,
  status: Schema.Union([
    Schema.Literal("draft"),
    Schema.Literal("approved"),
    Schema.Literal("returned"),
  ]),
  reviewNote: Schema.optionalKey(Schema.String),
  version: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface AnimaticDraft {
  id: Id;
  projectId: Id;
  episodeId: Id;
  sourceFingerprint: string;
  clips: AnimaticClip[];
  annotations: string;
  status: "draft" | "approved" | "returned";
  reviewNote?: string;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const AnimaticDraftInput = Schema.Struct({
  projectId: Id,
  episodeId: Id,
  sourceFingerprint: Schema.String,
  clips: Schema.Array(AnimaticClip),
  annotations: Schema.optionalKey(Schema.String),
});
export interface AnimaticDraftInput {
  projectId: Id;
  episodeId: Id;
  sourceFingerprint: string;
  clips: AnimaticClip[];
  annotations?: string;
}

export const AnimaticReviewInput = Schema.Struct({
  status: Schema.Union([
    Schema.Literal("approved"),
    Schema.Literal("returned"),
  ]),
  reviewNote: Schema.optionalKey(Schema.String),
  version: Schema.Int,
});
export interface AnimaticReviewInput {
  status: "approved" | "returned";
  reviewNote?: string;
  version: number;
}

export const EpisodeRenderPreflight = Schema.Struct({
  projectId: Id,
  episodeId: Id,
  sourceFingerprint: Schema.String,
  ok: Schema.Boolean,
  blockers: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
  animaticId: Schema.optionalKey(Id),
  audioTrackIds: Schema.Array(Id),
  durationSeconds: Schema.Number,
});
export interface EpisodeRenderPreflight {
  projectId: Id;
  episodeId: Id;
  sourceFingerprint: string;
  ok: boolean;
  blockers: string[];
  warnings: string[];
  animaticId?: Id;
  audioTrackIds: Id[];
  durationSeconds: number;
}

export const ImageGenerationKind = Schema.Union([
  Schema.Literal("still"),
  Schema.Literal("first_frame"),
  Schema.Literal("last_frame"),
  Schema.Literal("cover"),
]);
export type ImageGenerationKind =
  "still" | "first_frame" | "last_frame" | "cover";

export const ImageGenerationInput = Schema.Struct({
  providerId: Id,
  projectId: Id,
  shotId: Id,
  kind: ImageGenerationKind,
  prompt: Schema.String,
  negativePrompt: Schema.optionalKey(Schema.String),
  size: Schema.optionalKey(Schema.String),
  quality: Schema.optionalKey(Schema.String),
  outputFormat: Schema.optionalKey(
    Schema.Union([
      Schema.Literal("png"),
      Schema.Literal("jpeg"),
      Schema.Literal("webp"),
    ]),
  ),
});
export interface ImageGenerationInput {
  providerId: Id;
  projectId: Id;
  shotId: Id;
  kind: ImageGenerationKind;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  quality?: string;
  outputFormat?: "png" | "jpeg" | "webp";
}

export const ImageGenerationRun = Schema.Struct({
  task: Task,
  assets: Schema.Array(DomainEntity),
  candidates: Schema.Array(DomainEntity),
});
export interface ImageGenerationRun {
  task: Task;
  assets: DomainEntity[];
  candidates: DomainEntity[];
}

export const TtsGenerationInput = Schema.Struct({
  providerId: Id,
  projectId: Id,
  episodeId: Id,
  shotId: Schema.optionalKey(Id),
  voiceProfileId: Schema.optionalKey(Id),
  kind: Schema.Union([Schema.Literal("dialogue"), Schema.Literal("narration")]),
  input: Schema.String,
  voice: Schema.String,
  instructions: Schema.optionalKey(Schema.String),
  speed: Schema.optionalKey(Schema.Number),
  responseFormat: Schema.optionalKey(
    Schema.Union([
      Schema.Literal("mp3"),
      Schema.Literal("opus"),
      Schema.Literal("aac"),
      Schema.Literal("flac"),
      Schema.Literal("wav"),
      Schema.Literal("pcm"),
    ]),
  ),
});
export interface TtsGenerationInput {
  providerId: Id;
  projectId: Id;
  episodeId: Id;
  shotId?: Id;
  voiceProfileId?: Id;
  kind: "dialogue" | "narration";
  input: string;
  voice: string;
  instructions?: string;
  speed?: number;
  responseFormat?: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
}

export const TtsGenerationRun = Schema.Struct({
  task: Task,
  asset: DomainEntity,
});
export interface TtsGenerationRun {
  task: Task;
  asset: DomainEntity;
}

export const VideoGenerationInput = Schema.Struct({
  providerId: Id,
  projectId: Id,
  episodeId: Schema.optionalKey(Id),
  shotId: Schema.optionalKey(Id),
  prompt: Schema.String,
  negativePrompt: Schema.optionalKey(Schema.String),
  seconds: Schema.optionalKey(Schema.Int),
  size: Schema.optionalKey(Schema.String),
});
export interface VideoGenerationInput {
  providerId: Id;
  projectId: Id;
  episodeId?: Id;
  shotId?: Id;
  prompt: string;
  negativePrompt?: string;
  seconds?: number;
  size?: string;
}

export const VideoGenerationJob = Schema.Struct({
  id: Id,
  taskId: Id,
  projectId: Id,
  episodeId: Schema.optionalKey(Id),
  shotId: Schema.optionalKey(Id),
  providerId: Id,
  remoteJobId: Id,
  prompt: Schema.String,
  status: Schema.Union([
    Schema.Literal("queued"),
    Schema.Literal("running"),
    Schema.Literal("succeeded"),
    Schema.Literal("failed"),
    Schema.Literal("canceled"),
  ]),
  results: Schema.Array(DomainEntity),
  error: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface VideoGenerationJob {
  id: Id;
  taskId: Id;
  projectId: Id;
  episodeId?: Id;
  shotId?: Id;
  providerId: Id;
  remoteJobId: Id;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  results: DomainEntity[];
  error?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const VideoGenerationRetryInput = Schema.Struct({
  providerId: Schema.optionalKey(Id),
});
export interface VideoGenerationRetryInput {
  providerId?: Id;
}

export const FeedbackKind = Schema.Union([
  Schema.Literal("metrics"),
  Schema.Literal("comments"),
]);
export type FeedbackKind = "metrics" | "comments";

export const FeedbackPreviewInput = Schema.Struct({
  projectId: Id,
  kind: FeedbackKind,
  capabilityToken: Schema.String,
});
export interface FeedbackPreviewInput {
  projectId: Id;
  kind: FeedbackKind;
  capabilityToken: string;
}

export const FeedbackPreview = Schema.Struct({
  importId: Id,
  projectId: Id,
  kind: FeedbackKind,
  sourceName: Schema.String,
  validCount: Schema.Int,
  warnings: Schema.Array(Schema.String),
  sample: Schema.Array(Schema.Unknown),
  expiresAt: IsoDateTime,
});
export interface FeedbackPreview {
  importId: Id;
  projectId: Id;
  kind: FeedbackKind;
  sourceName: string;
  validCount: number;
  warnings: string[];
  sample: unknown[];
  expiresAt: IsoDateTime;
}

export const FeedbackCommitInput = Schema.Struct({ projectId: Id });
export interface FeedbackCommitInput {
  projectId: Id;
}

export const FeedbackBatch = Schema.Struct({
  id: Id,
  projectId: Id,
  kind: FeedbackKind,
  sourceName: Schema.String,
  rowCount: Schema.Int,
  createdAt: IsoDateTime,
});
export interface FeedbackBatch {
  id: Id;
  projectId: Id;
  kind: FeedbackKind;
  sourceName: string;
  rowCount: number;
  createdAt: IsoDateTime;
}

export const FeedbackMetric = Schema.Struct({
  id: Id,
  batchId: Id,
  name: Schema.String,
  value: Schema.Number,
  occurredAt: Schema.optionalKey(IsoDateTime),
  dimensions: Schema.Unknown,
  createdAt: IsoDateTime,
});
export interface FeedbackMetric {
  id: Id;
  batchId: Id;
  name: string;
  value: number;
  occurredAt?: IsoDateTime;
  dimensions: unknown;
  createdAt: IsoDateTime;
}

export const FeedbackComment = Schema.Struct({
  id: Id,
  batchId: Id,
  content: Schema.String,
  author: Schema.optionalKey(Schema.String),
  occurredAt: Schema.optionalKey(IsoDateTime),
  category: Schema.String,
  createdAt: IsoDateTime,
});
export interface FeedbackComment {
  id: Id;
  batchId: Id;
  content: string;
  author?: string;
  occurredAt?: IsoDateTime;
  category: string;
  createdAt: IsoDateTime;
}

export const FeedbackCluster = Schema.Struct({
  id: Id,
  projectId: Id,
  batchId: Id,
  title: Schema.String,
  summary: Schema.String,
  commentCount: Schema.Int,
  createdAt: IsoDateTime,
});
export interface FeedbackCluster {
  id: Id;
  projectId: Id;
  batchId: Id;
  title: string;
  summary: string;
  commentCount: number;
  createdAt: IsoDateTime;
}

export const FeedbackDashboard = Schema.Struct({
  batches: Schema.Array(FeedbackBatch),
  metrics: Schema.Array(FeedbackMetric),
  comments: Schema.Array(FeedbackComment),
  clusters: Schema.Array(FeedbackCluster),
});
export interface FeedbackDashboard {
  batches: FeedbackBatch[];
  metrics: FeedbackMetric[];
  comments: FeedbackComment[];
  clusters: FeedbackCluster[];
}

export const FeedbackClusterInput = Schema.Struct({
  projectId: Id,
  batchId: Id,
});
export interface FeedbackClusterInput {
  projectId: Id;
  batchId: Id;
}

export const DiagnosticReport = Schema.Struct({
  generatedAt: IsoDateTime,
  serverVersion: Schema.String,
  engineAvailable: Schema.Boolean,
  database: Schema.Struct({
    projectCount: Schema.Int,
    chapterCount: Schema.Int,
    taskCount: Schema.Int,
    backupCount: Schema.Int,
  }),
});
export interface DiagnosticReport {
  generatedAt: IsoDateTime;
  serverVersion: string;
  engineAvailable: boolean;
  database: {
    projectCount: number;
    chapterCount: number;
    taskCount: number;
    backupCount: number;
  };
}

export const ProductionGraphNode = Schema.Struct({
  id: Id,
  kind: Schema.String,
  title: Schema.String,
  status: Schema.String,
});
export interface ProductionGraphNode {
  id: Id;
  kind: string;
  title: string;
  status: string;
}

export const ProductionGraphEdge = Schema.Struct({
  sourceId: Id,
  targetId: Id,
  relation: Schema.String,
});
export interface ProductionGraphEdge {
  sourceId: Id;
  targetId: Id;
  relation: string;
}

export const ProductionGraph = Schema.Struct({
  projectId: Id,
  nodes: Schema.Array(ProductionGraphNode),
  edges: Schema.Array(ProductionGraphEdge),
  coverage: Schema.Struct({
    episodes: Schema.Int,
    scripts: Schema.Int,
    scenes: Schema.Int,
    shots: Schema.Int,
    assets: Schema.Int,
    stills: Schema.Int,
    adoptedStills: Schema.Int,
  }),
});
export interface ProductionGraph {
  projectId: Id;
  nodes: ProductionGraphNode[];
  edges: ProductionGraphEdge[];
  coverage: {
    episodes: number;
    scripts: number;
    scenes: number;
    shots: number;
    assets: number;
    stills: number;
    adoptedStills: number;
  };
}

export const ProductionImpactInput = Schema.Struct({
  projectId: Id,
  sourceId: Id,
});
export interface ProductionImpactInput {
  projectId: Id;
  sourceId: Id;
}

export const ProductionImpact = Schema.Struct({
  sourceId: Id,
  affected: Schema.Array(ProductionGraphNode),
  summary: Schema.String,
});
export interface ProductionImpact {
  sourceId: Id;
  affected: ProductionGraphNode[];
  summary: string;
}

export const GenerationRecord = Schema.Struct({
  id: Id,
  projectId: Id,
  taskId: Schema.optionalKey(Id),
  kind: Schema.String,
  title: Schema.String,
  status: Schema.String,
  summary: Schema.String,
  actualCost: Schema.optionalKey(Schema.Number),
  currency: Schema.String,
  costNote: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface GenerationRecord {
  id: Id;
  projectId: Id;
  taskId?: Id;
  kind: string;
  title: string;
  status: string;
  summary: string;
  actualCost?: number;
  currency: string;
  costNote?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const GenerationRecordPatch = Schema.Struct({
  actualCost: Schema.optionalKey(Schema.Number),
  currency: Schema.optionalKey(Schema.String),
  costNote: Schema.optionalKey(Schema.String),
});
export interface GenerationRecordPatch {
  actualCost?: number;
  currency?: string;
  costNote?: string;
}

export const ContentVersionRestoreResult = Schema.Struct({
  targetKind: Schema.String,
  targetId: Id,
  restoredFromId: Id,
});
export interface ContentVersionRestoreResult {
  targetKind: string;
  targetId: Id;
  restoredFromId: Id;
}

export const TemplateRunInput = Schema.Struct({
  projectId: Schema.optionalKey(Id),
  variables: Schema.optionalKey(Schema.Unknown),
});
export interface TemplateRunInput {
  projectId?: Id;
  variables?: unknown;
}

export const TemplateRunResult = Schema.Struct({
  run: DomainEntity,
  rendered: Schema.String,
  variables: Schema.Array(Schema.String),
  missing: Schema.Array(Schema.String),
});
export interface TemplateRunResult {
  run: DomainEntity;
  rendered: string;
  variables: string[];
  missing: string[];
}

/** 创意诊断只产生可审阅的本地报告，不会直接改写任何创作内容。 */
export const CreativeTargetKind = Schema.Union([
  Schema.Literal("project"),
  Schema.Literal("chapter"),
  Schema.Literal("adaptation"),
  Schema.Literal("episode"),
  Schema.Literal("script"),
  Schema.Literal("scene"),
  Schema.Literal("shot"),
]);
export type CreativeTargetKind =
  | "project"
  | "chapter"
  | "adaptation"
  | "episode"
  | "script"
  | "scene"
  | "shot";
export const CreativeDiagnosticKind = Schema.Union([
  Schema.Literal("freshness"),
  Schema.Literal("anti_trope"),
  Schema.Literal("quality_gate"),
  Schema.Literal("audience"),
  Schema.Literal("narrative_curve"),
]);
export type CreativeDiagnosticKind =
  "freshness" | "anti_trope" | "quality_gate" | "audience" | "narrative_curve";
export const CreativeScore = Schema.Struct({
  label: Schema.String,
  value: Schema.Number,
});
export interface CreativeScore {
  label: string;
  value: number;
}
export const CreativeDiagnostic = Schema.Struct({
  id: Id,
  projectId: Id,
  targetKind: CreativeTargetKind,
  targetId: Schema.optionalKey(Id),
  targetTitle: Schema.String,
  kind: CreativeDiagnosticKind,
  title: Schema.String,
  summary: Schema.String,
  scores: Schema.Array(CreativeScore),
  findings: Schema.Array(Schema.String),
  recommendations: Schema.Array(Schema.String),
  curve: Schema.optionalKey(Schema.Array(Schema.Number)),
  sourceFingerprint: Schema.String,
  createdAt: IsoDateTime,
});
export interface CreativeDiagnostic {
  id: Id;
  projectId: Id;
  targetKind: CreativeTargetKind;
  targetId?: Id;
  targetTitle: string;
  kind: CreativeDiagnosticKind;
  title: string;
  summary: string;
  scores: CreativeScore[];
  findings: string[];
  recommendations: string[];
  curve?: number[];
  sourceFingerprint: string;
  createdAt: IsoDateTime;
}
export const CreativeDiagnosticInput = Schema.Struct({
  projectId: Id,
  targetKind: Schema.optionalKey(CreativeTargetKind),
  targetId: Schema.optionalKey(Id),
  kinds: Schema.Array(CreativeDiagnosticKind),
  caseStudyIds: Schema.optionalKey(Schema.Array(Id)),
});
export interface CreativeDiagnosticInput {
  projectId: Id;
  targetKind?: CreativeTargetKind;
  targetId?: Id;
  kinds: CreativeDiagnosticKind[];
  caseStudyIds?: Id[];
}
export const CreativeDiagnosticRunResult = Schema.Struct({
  task: Task,
  diagnostics: Schema.Array(CreativeDiagnostic),
});
export interface CreativeDiagnosticRunResult {
  task: Task;
  diagnostics: CreativeDiagnostic[];
}
export const CreativeCaseStudy = Schema.Struct({
  id: Id,
  title: RequiredText,
  sourceType: Schema.optionalKey(Schema.String),
  genre: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  relationshipPatterns: Schema.Array(Schema.String),
  openingHooks: Schema.Array(Schema.String),
  highlightBeats: Schema.Array(Schema.String),
  reversalMechanisms: Schema.Array(Schema.String),
  cliffhangers: Schema.Array(Schema.String),
  visualPatterns: Schema.Array(Schema.String),
  rhythmCurve: Schema.Array(Schema.Number),
  riskTags: Schema.Array(Schema.String),
  notes: Schema.optionalKey(Schema.String),
  version: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface CreativeCaseStudy {
  id: Id;
  title: string;
  sourceType?: string;
  genre?: string;
  summary?: string;
  relationshipPatterns: string[];
  openingHooks: string[];
  highlightBeats: string[];
  reversalMechanisms: string[];
  cliffhangers: string[];
  visualPatterns: string[];
  rhythmCurve: number[];
  riskTags: string[];
  notes?: string;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const CreativeCaseStudyInput = Schema.Struct({
  title: RequiredText,
  sourceType: Schema.optionalKey(Schema.String),
  genre: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  relationshipPatterns: Schema.optionalKey(Schema.Array(Schema.String)),
  openingHooks: Schema.optionalKey(Schema.Array(Schema.String)),
  highlightBeats: Schema.optionalKey(Schema.Array(Schema.String)),
  reversalMechanisms: Schema.optionalKey(Schema.Array(Schema.String)),
  cliffhangers: Schema.optionalKey(Schema.Array(Schema.String)),
  visualPatterns: Schema.optionalKey(Schema.Array(Schema.String)),
  rhythmCurve: Schema.optionalKey(Schema.Array(Schema.Number)),
  riskTags: Schema.optionalKey(Schema.Array(Schema.String)),
  notes: Schema.optionalKey(Schema.String),
});
export interface CreativeCaseStudyInput {
  title: string;
  sourceType?: string;
  genre?: string;
  summary?: string;
  relationshipPatterns?: string[];
  openingHooks?: string[];
  highlightBeats?: string[];
  reversalMechanisms?: string[];
  cliffhangers?: string[];
  visualPatterns?: string[];
  rhythmCurve?: number[];
  riskTags?: string[];
  notes?: string;
}
export const CreativeCaseStudyPatch = Schema.Struct({
  title: Schema.optionalKey(RequiredText),
  sourceType: Schema.optionalKey(Schema.String),
  genre: Schema.optionalKey(Schema.String),
  summary: Schema.optionalKey(Schema.String),
  relationshipPatterns: Schema.optionalKey(Schema.Array(Schema.String)),
  openingHooks: Schema.optionalKey(Schema.Array(Schema.String)),
  highlightBeats: Schema.optionalKey(Schema.Array(Schema.String)),
  reversalMechanisms: Schema.optionalKey(Schema.Array(Schema.String)),
  cliffhangers: Schema.optionalKey(Schema.Array(Schema.String)),
  visualPatterns: Schema.optionalKey(Schema.Array(Schema.String)),
  rhythmCurve: Schema.optionalKey(Schema.Array(Schema.Number)),
  riskTags: Schema.optionalKey(Schema.Array(Schema.String)),
  notes: Schema.optionalKey(Schema.String),
  version: Schema.Int,
});
export interface CreativeCaseStudyPatch extends Partial<CreativeCaseStudyInput> {
  version: number;
}
export const CreativeIssueAcknowledgement = Schema.Struct({
  id: Id,
  projectId: Id,
  diagnosticId: Id,
  issueKey: Schema.String,
  disposition: Schema.Union([
    Schema.Literal("accepted"),
    Schema.Literal("fixed"),
    Schema.Literal("not_applicable"),
  ]),
  note: Schema.optionalKey(Schema.String),
  actorLabel: Schema.optionalKey(Schema.String),
  createdAt: IsoDateTime,
});
export interface CreativeIssueAcknowledgement {
  id: Id;
  projectId: Id;
  diagnosticId: Id;
  issueKey: string;
  disposition: "accepted" | "fixed" | "not_applicable";
  note?: string;
  actorLabel?: string;
  createdAt: IsoDateTime;
}
export const CreativeIssueAcknowledgementInput = Schema.Struct({
  projectId: Id,
  diagnosticId: Id,
  issueKey: RequiredText,
  disposition: Schema.Union([
    Schema.Literal("accepted"),
    Schema.Literal("fixed"),
    Schema.Literal("not_applicable"),
  ]),
  note: Schema.optionalKey(Schema.String),
  actorLabel: Schema.optionalKey(Schema.String),
});
export interface CreativeIssueAcknowledgementInput {
  projectId: Id;
  diagnosticId: Id;
  issueKey: string;
  disposition: "accepted" | "fixed" | "not_applicable";
  note?: string;
  actorLabel?: string;
}

export const RevisionPreview = Schema.Struct({
  id: Id,
  chapterId: Id,
  baseVersion: Schema.Int,
  proposedContent: Schema.String,
  rationale: Schema.String,
  status: Schema.Union([
    Schema.Literal("pending"),
    Schema.Literal("committed"),
    Schema.Literal("discarded"),
    Schema.Literal("conflicted"),
  ]),
  createdAt: IsoDateTime,
  committedAt: Schema.optionalKey(IsoDateTime),
});
export interface RevisionPreview {
  id: Id;
  chapterId: Id;
  baseVersion: number;
  proposedContent: string;
  rationale: string;
  status: "pending" | "committed" | "discarded" | "conflicted";
  createdAt: IsoDateTime;
  committedAt?: IsoDateTime;
}
export const RevisionInput = Schema.Struct({
  chapterId: Id,
  proposedContent: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  rationale: Schema.optionalKey(Schema.String),
});
export interface RevisionInput {
  chapterId: Id;
  proposedContent: string;
  rationale?: string;
}

export const ChangeTargetKind = Schema.Literals([
  "project",
  "chapter",
  "character",
  "outline",
  "story_bible",
  "episode",
  "script",
  "scene",
  "shot",
]);
export type ChangeTargetKind =
  | "project"
  | "chapter"
  | "character"
  | "outline"
  | "story_bible"
  | "episode"
  | "script"
  | "scene"
  | "shot";
export const ChangePreviewStatus = Schema.Literals([
  "pending",
  "committed",
  "discarded",
  "conflicted",
]);
export type ChangePreviewStatus =
  "pending" | "committed" | "discarded" | "conflicted";
export const ChangePreviewTarget = Schema.Struct({
  kind: ChangeTargetKind,
  id: Id,
  baseVersion: Schema.Int,
  patch: Schema.Unknown,
  displayDiff: Schema.optionalKey(Schema.Unknown),
});
export interface ChangePreviewTarget {
  kind: ChangeTargetKind;
  id: Id;
  baseVersion: number;
  patch: unknown;
  displayDiff?: unknown;
}
export const ChangePreview = Schema.Struct({
  id: Id,
  projectId: Id,
  sessionId: Schema.optionalKey(Id),
  runId: Schema.optionalKey(Id),
  taskId: Schema.optionalKey(Id),
  engineKind: Schema.optionalKey(AgentEngineKind),
  taskType: Schema.optionalKey(AgentTaskType),
  targets: Schema.Array(ChangePreviewTarget),
  rationale: Schema.String,
  status: ChangePreviewStatus,
  contentHash: Schema.String,
  createdAt: IsoDateTime,
  committedAt: Schema.optionalKey(IsoDateTime),
});
export interface ChangePreview {
  id: Id;
  projectId: Id;
  sessionId?: Id;
  runId?: Id;
  taskId?: Id;
  engineKind?: AgentEngineKind;
  taskType?: AgentTaskType;
  targets: readonly ChangePreviewTarget[];
  rationale: string;
  status: ChangePreviewStatus;
  contentHash: string;
  createdAt: IsoDateTime;
  committedAt?: IsoDateTime;
}

export const ProviderActionKind = Schema.Literals([
  "image",
  "audio",
  "video",
  "remote_render",
]);
export type ProviderActionKind = "image" | "audio" | "video" | "remote_render";
export const ProviderActionPreview = Schema.Struct({
  id: Id,
  projectId: Id,
  sessionId: Schema.optionalKey(Id),
  runId: Schema.optionalKey(Id),
  taskId: Schema.optionalKey(Id),
  kind: ProviderActionKind,
  providerId: Id,
  modelId: Schema.optionalKey(Schema.String),
  parameters: Schema.Unknown,
  estimatedCost: Schema.optionalKey(Schema.Number),
  currency: Schema.optionalKey(Schema.String),
  status: Schema.Literals(["pending", "executed", "discarded", "expired"]),
  createdAt: IsoDateTime,
  executedAt: Schema.optionalKey(IsoDateTime),
});
export interface ProviderActionPreview {
  id: Id;
  projectId: Id;
  sessionId?: Id;
  runId?: Id;
  taskId?: Id;
  kind: ProviderActionKind;
  providerId: Id;
  modelId?: string;
  parameters: unknown;
  estimatedCost?: number;
  currency?: string;
  status: "pending" | "executed" | "discarded" | "expired";
  createdAt: IsoDateTime;
  executedAt?: IsoDateTime;
}

export const AgentExperimentStatus = Schema.Literals([
  "queued",
  "running",
  "ready_for_review",
  "completed",
  "failed",
  "canceled",
]);
export type AgentExperimentStatus =
  | "queued"
  | "running"
  | "ready_for_review"
  | "completed"
  | "failed"
  | "canceled";
export const AgentExperiment = Schema.Struct({
  id: Id,
  projectId: Id,
  taskType: AgentTaskType,
  contextSnapshotId: Id,
  status: AgentExperimentStatus,
  comparisonMode: Schema.Literals(["recommended", "same_model"]),
  model: Schema.optionalKey(AgentModelSelection),
  estimatedCost: Schema.optionalKey(Schema.Number),
  currency: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  revealed: Schema.Boolean,
  candidates: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        candidate: Schema.Literals(["one", "two", "three"]),
        runId: Id,
        status: AgentRunStatus,
        output: Schema.optionalKey(Schema.Unknown),
        engineKind: Schema.optionalKey(AgentEngineKind),
        engineVersion: Schema.optionalKey(Schema.String),
        metrics: Schema.optionalKey(
          Schema.Struct({
            completed: Schema.Boolean,
            formatError: Schema.Boolean,
            toolViolation: Schema.Boolean,
            latencyMs: Schema.Number,
            inputTokens: Schema.Number,
            outputTokens: Schema.Number,
            cachedTokens: Schema.Number,
            estimatedCost: Schema.optionalKey(Schema.Number),
            currency: Schema.optionalKey(Schema.String),
            adopted: Schema.Boolean,
          }),
        ),
      }),
    ),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface AgentExperiment {
  id: Id;
  projectId: Id;
  taskType: AgentTaskType;
  contextSnapshotId: Id;
  status: AgentExperimentStatus;
  comparisonMode: "recommended" | "same_model";
  model?: AgentModelSelection;
  estimatedCost?: number;
  currency?: string;
  error?: string;
  revealed: boolean;
  candidates?: ReadonlyArray<{
    candidate: "one" | "two" | "three";
    runId: Id;
    status: AgentRunStatus;
    output?: unknown;
    engineKind?: AgentEngineKind;
    engineVersion?: string;
    metrics?: {
      completed: boolean;
      formatError: boolean;
      toolViolation: boolean;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      estimatedCost?: number;
      currency?: string;
      adopted: boolean;
    };
  }>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const AgentExperimentInput = Schema.Struct({
  projectId: Id,
  chapterId: Schema.optionalKey(Id),
  taskType: AgentTaskType,
  prompt: Schema.optionalKey(Schema.String),
  comparisonMode: Schema.optionalKey(
    Schema.Literals(["recommended", "same_model"]),
  ),
  model: Schema.optionalKey(AgentModelSelection),
  confirmedEstimatedCost: Schema.Boolean,
});
export interface AgentExperimentInput {
  projectId: Id;
  chapterId?: Id;
  taskType: AgentTaskType;
  prompt?: string;
  comparisonMode?: "recommended" | "same_model";
  model?: AgentModelSelection;
  confirmedEstimatedCost: boolean;
}
export const AgentExperimentReviewInput = Schema.Struct({
  preferredCandidate: Schema.Literals(["one", "two", "three", "tie"]),
  notes: Schema.optionalKey(Schema.String),
});
export interface AgentExperimentReviewInput {
  preferredCandidate: "one" | "two" | "three" | "tie";
  notes?: string;
}

export const CodexAuthStatus = Schema.Struct({
  available: Schema.Boolean,
  authenticated: Schema.Boolean,
  mode: Schema.optionalKey(Schema.Literals(["api_key", "chatgpt"])),
  accountLabel: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
});
export interface CodexAuthStatus {
  available: boolean;
  authenticated: boolean;
  mode?: "api_key" | "chatgpt";
  accountLabel?: string;
  message?: string;
}
export const CodexLoginInput = Schema.Struct({
  mode: Schema.Literals(["api_key", "chatgpt_browser", "chatgpt_device_code"]),
  credentialRef: Schema.optionalKey(Schema.String),
});
export interface CodexLoginInput {
  mode: "api_key" | "chatgpt_browser" | "chatgpt_device_code";
  credentialRef?: string;
}
export const CodexLoginResult = Schema.Struct({
  status: Schema.Literals(["authenticated", "pending", "unavailable"]),
  verificationUrl: Schema.optionalKey(Schema.String),
  userCode: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.String),
});
export interface CodexLoginResult {
  status: "authenticated" | "pending" | "unavailable";
  verificationUrl?: string;
  userCode?: string;
  message?: string;
}

export const ApiErrorCode = Schema.Union([
  Schema.Literal("VALIDATION_ERROR"),
  Schema.Literal("NOT_FOUND"),
  Schema.Literal("CONFLICT"),
  Schema.Literal("UNAUTHORIZED"),
  Schema.Literal("ENGINE_UNAVAILABLE"),
  Schema.Literal("TASK_REJECTED"),
  Schema.Literal("INTERNAL_ERROR"),
]);
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "ENGINE_UNAVAILABLE"
  | "TASK_REJECTED"
  | "INTERNAL_ERROR";
export const ApiError = Schema.Struct({
  code: ApiErrorCode,
  message: Schema.String,
  requestId: Schema.String,
  details: Schema.optionalKey(Schema.Unknown),
});
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: unknown;
}

export const EventEnvelope = Schema.Struct({
  id: Schema.Int,
  type: Schema.String,
  occurredAt: IsoDateTime,
  payload: Schema.Unknown,
});
export interface EventEnvelope {
  id: number;
  type: string;
  occurredAt: IsoDateTime;
  payload: unknown;
}
