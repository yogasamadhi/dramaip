import { z } from "zod";
import type { NarrativeContextRequest as TypedNarrativeContextRequest } from "./narrative-context.js";
import type { AgentRunUsageScope } from "./agent-usage.js";

// This transitional surface is owned and built by @dramaip/contracts.
export * from "./provider-catalog.js";

/** Zod validates the product wire contracts; interfaces provide ergonomic React types. */
export const Id = z.string().brand<"DramaIP.Id">();
export type Id = string;
export const IsoDateTime = z.string().brand<"DramaIP.IsoDateTime">();
export type IsoDateTime = string;

const RequiredText = z.string().min(1).max(160);
/** Preserve the transitional contract's JavaScript number domain. */
const NumericValue = z.custom<number>((value) => typeof value === "number");
export const ProjectMode = z.enum([
  "series_longform",
  "single_season",
  "personal_theater",
  "creator_channel",
]);
export type ProjectMode =
  "series_longform" | "single_season" | "personal_theater" | "creator_channel";
export const ProjectLifecycleStatus = z.enum([
  "initializing",
  "ready",
  "failed",
]);
export type ProjectLifecycleStatus = "initializing" | "ready" | "failed";
export type ProjectModeConfig =
  | {
      mode: "series_longform";
      targetChapterCount?: number;
      targetSeasonCount?: number;
      targetEpisodesPerSeason?: number;
    }
  | {
      mode: "single_season";
      entryPath: "novel" | "source-import" | "script" | "inspiration";
      targetEpisodeCount?: number;
    }
  | {
      mode: "personal_theater";
      storyMethod: "template" | "freeform";
      episodeCount?: number;
      episodeDurationMinutes?: number;
    }
  | {
      mode: "creator_channel";
      topic: string;
      positioning?: string;
      audience?: string;
      platforms?: string[];
      riskDomain?: "general" | "finance" | "health" | "legal";
    };
/** Mode-specific validation belongs to the Runtime boundary. This transitional
 * surface keeps the configuration opaque and exposes the renderer interface. */
export const ProjectModeConfig = z.unknown();
export const Project = z.object({
  id: Id,
  title: RequiredText,
  shortDramaType: z.exactOptional(RequiredText),
  mode: ProjectMode,
  modeConfig: ProjectModeConfig,
  lifecycleStatus: ProjectLifecycleStatus,
  derivedFromProjectId: z.exactOptional(Id),
  targetAudience: z.exactOptional(z.string()),
  targetWordCount: z.exactOptional(z.int()),
  targetEpisodeCount: z.exactOptional(z.int()),
  coreHook: z.exactOptional(z.string()),
  emotionalCore: z.exactOptional(z.string()),
  coreSellingPoint: z.exactOptional(z.string()),
  synopsis: z.string(),
  styleGuide: z.exactOptional(z.string()),
  visualStyleDirection: z.exactOptional(z.string()),
  genreOpportunity: z.exactOptional(z.string()),
  productionBrief: z.exactOptional(z.string()),
  seriesId: z.exactOptional(Id),
  seriesTitle: z.exactOptional(z.string()),
  currentAdaptationId: z.exactOptional(Id),
  deletedAt: z.exactOptional(IsoDateTime),
  version: z.int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface Project {
  id: Id;
  title: string;
  shortDramaType?: string;
  mode: ProjectMode;
  modeConfig: ProjectModeConfig;
  lifecycleStatus: ProjectLifecycleStatus;
  derivedFromProjectId?: Id;
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
  /** 可选系列归属；解除关联不会迁移或删除项目内资料。 */
  seriesId?: Id;
  seriesTitle?: string;
  /** 当前在改编工作台中采用的改编方案；只由专用选择接口更新。 */
  currentAdaptationId?: Id;
  deletedAt?: IsoDateTime;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const ProjectInput = z.object({
  title: RequiredText,
  shortDramaType: z.exactOptional(RequiredText),
  mode: z.exactOptional(ProjectMode),
  modeConfig: z.exactOptional(ProjectModeConfig),
  targetAudience: z.exactOptional(z.string()),
  targetWordCount: z.exactOptional(z.int()),
  targetEpisodeCount: z.exactOptional(z.int()),
  coreHook: z.exactOptional(z.string()),
  emotionalCore: z.exactOptional(z.string()),
  coreSellingPoint: z.exactOptional(z.string()),
  synopsis: z.exactOptional(z.string()),
  styleGuide: z.exactOptional(z.string()),
  visualStyleDirection: z.exactOptional(z.string()),
  genreOpportunity: z.exactOptional(z.string()),
  productionBrief: z.exactOptional(z.string()),
});
export interface ProjectInput {
  title: string;
  shortDramaType?: string;
  mode?: ProjectMode;
  modeConfig?: ProjectModeConfig;
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
export const ProjectPatch = z.object({
  title: z.exactOptional(RequiredText),
  shortDramaType: z.exactOptional(RequiredText),
  targetAudience: z.exactOptional(z.string()),
  targetWordCount: z.exactOptional(z.int()),
  targetEpisodeCount: z.exactOptional(z.int()),
  coreHook: z.exactOptional(z.string()),
  emotionalCore: z.exactOptional(z.string()),
  coreSellingPoint: z.exactOptional(z.string()),
  synopsis: z.exactOptional(z.string()),
  styleGuide: z.exactOptional(z.string()),
  visualStyleDirection: z.exactOptional(z.string()),
  genreOpportunity: z.exactOptional(z.string()),
  productionBrief: z.exactOptional(z.string()),
  version: z.int(),
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

export type ProjectInitializationStep = {
  key: string;
  pluginId: string;
  status: "pending" | "running" | "ready" | "failed";
  message?: string;
  error?: string;
  attempts: number;
  updatedAt: IsoDateTime;
};
export const ProjectInitializationStep = z.object({
  key: z.string(),
  pluginId: z.string(),
  status: z.enum(["pending", "running", "ready", "failed"]),
  message: z.exactOptional(z.string()),
  error: z.exactOptional(z.string()),
  attempts: z.int(),
  updatedAt: IsoDateTime,
});
export interface ProjectInitialization {
  projectId: Id;
  status: ProjectLifecycleStatus;
  steps: ProjectInitializationStep[];
  updatedAt: IsoDateTime;
}
export const ProjectInitialization = z.object({
  projectId: Id,
  status: ProjectLifecycleStatus,
  steps: z.array(ProjectInitializationStep),
  updatedAt: IsoDateTime,
});
export interface ProjectCreationResult {
  project: Project;
  initialization: ProjectInitialization;
}
export const ProjectCreationResult = z.object({
  project: Project,
  initialization: ProjectInitialization,
});
export interface ProjectDerivationInput {
  targetMode: ProjectMode;
  title?: string;
  seasonId?: Id;
  targetModeConfig?: ProjectModeConfig;
}
export const ProjectDerivationInput = z.object({
  targetMode: ProjectMode,
  title: z.exactOptional(z.string()),
  seasonId: z.exactOptional(Id),
  targetModeConfig: z.exactOptional(ProjectModeConfig),
});
export interface ProjectDerivationPreview {
  id: Id;
  sourceProjectId: Id;
  targetMode: ProjectMode;
  targetModeConfig: ProjectModeConfig;
  title: string;
  supported: boolean;
  reason?: string;
  expiresAt: IsoDateTime;
}
export const ProjectDerivationPreview = z.object({
  id: Id,
  sourceProjectId: Id,
  targetMode: ProjectMode,
  targetModeConfig: ProjectModeConfig,
  title: z.string(),
  supported: z.boolean(),
  reason: z.exactOptional(z.string()),
  expiresAt: IsoDateTime,
});
export interface ProjectDerivationCommitResult {
  project: Project;
  initialization: ProjectInitialization;
  derivationId: Id;
}
export const ProjectDerivationCommitResult = z.object({
  project: Project,
  initialization: ProjectInitialization,
  derivationId: Id,
});

export const Chapter = z.object({
  id: Id,
  projectId: Id,
  title: RequiredText,
  orderIndex: z.int(),
  summary: z.string(),
  outline: z.exactOptional(z.string()),
  content: z.string(),
  mainConflict: z.exactOptional(z.string()),
  hook: z.exactOptional(z.string()),
  highlight: z.exactOptional(z.string()),
  reversal: z.exactOptional(z.string()),
  cliffhanger: z.exactOptional(z.string()),
  shortDramaNote: z.exactOptional(z.string()),
  aiVideoNote: z.exactOptional(z.string()),
  version: z.int(),
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
export const ChapterInput = z.object({
  projectId: Id,
  title: RequiredText,
  summary: z.exactOptional(z.string()),
  outline: z.exactOptional(z.string()),
  content: z.exactOptional(z.string()),
  mainConflict: z.exactOptional(z.string()),
  hook: z.exactOptional(z.string()),
  highlight: z.exactOptional(z.string()),
  reversal: z.exactOptional(z.string()),
  cliffhanger: z.exactOptional(z.string()),
  shortDramaNote: z.exactOptional(z.string()),
  aiVideoNote: z.exactOptional(z.string()),
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
export const ChapterPatch = z.object({
  title: z.exactOptional(RequiredText),
  summary: z.exactOptional(z.string()),
  outline: z.exactOptional(z.string()),
  content: z.exactOptional(z.string()),
  mainConflict: z.exactOptional(z.string()),
  hook: z.exactOptional(z.string()),
  highlight: z.exactOptional(z.string()),
  reversal: z.exactOptional(z.string()),
  cliffhanger: z.exactOptional(z.string()),
  shortDramaNote: z.exactOptional(z.string()),
  aiVideoNote: z.exactOptional(z.string()),
  version: z.int(),
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

export const ChapterReorderInput = z.object({
  chapterIds: z.array(Id),
});
export interface ChapterReorderInput {
  chapterIds: Id[];
}

export const TaskStatus = z.union([
  z.literal("queued"),
  z.literal("running"),
  z.literal("succeeded"),
  z.literal("failed"),
  z.literal("canceled"),
  z.literal("interrupted"),
]);
export type TaskStatus =
  "queued" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
export const TaskAttentionStatus = z.enum(["open", "acknowledged"]);
export type TaskAttentionStatus = "open" | "acknowledged";
export const TaskResultStatus = z.enum([
  "none",
  "pending",
  "applied",
  "discarded",
  "conflicted",
]);
export type TaskResultStatus =
  "none" | "pending" | "applied" | "discarded" | "conflicted";
export const Task = z.object({
  id: Id,
  kind: z.string(),
  status: TaskStatus,
  attentionStatus: TaskAttentionStatus,
  resultStatus: TaskResultStatus,
  title: z.string(),
  progress: NumericValue,
  projectId: z.exactOptional(Id),
  parentTaskId: z.exactOptional(Id),
  conversationId: z.exactOptional(Id),
  assistantTurnId: z.exactOptional(Id),
  stage: z.exactOptional(z.string()),
  result: z.exactOptional(z.unknown()),
  error: z.exactOptional(z.string()),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface Task {
  id: Id;
  kind: string;
  status: TaskStatus;
  attentionStatus: TaskAttentionStatus;
  resultStatus: TaskResultStatus;
  title: string;
  progress: number;
  projectId?: Id;
  parentTaskId?: Id;
  conversationId?: Id;
  assistantTurnId?: Id;
  stage?: string;
  result?: unknown;
  error?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export type TaskWorklistCategory =
  "pending-result" | "running" | "attention" | "history";
export interface TaskWorklistResponse {
  items: Task[];
  counts: {
    pendingResult: number;
    running: number;
    attention: number;
    history: number;
  };
  nextCursor?: string;
}
export const TaskInput = z.object({
  kind: RequiredText,
  title: RequiredText,
  projectId: z.exactOptional(Id),
  payload: z.exactOptional(z.unknown()),
});
export interface TaskInput {
  kind: string;
  title: string;
  projectId?: Id;
  payload?: unknown;
}

export const AgentEngineKind = z.enum(["pi"]);
export type AgentEngineKind = "pi";

export const TaskRetryInput = z.object({
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
export const AgentTaskType = z.enum(AGENT_TASK_TYPES);
export type AgentTaskType = (typeof AGENT_TASK_TYPES)[number];

export const AgentSessionStatus = z.enum([
  "idle",
  "running",
  "failed",
  "interrupted",
  "disposed",
]);
export type AgentSessionStatus =
  "idle" | "running" | "failed" | "interrupted" | "disposed";
export const AssistantSurface = z.enum([
  "novel",
  "global",
  "inspiration",
  "legacy",
]);
export type AssistantSurface = "novel" | "global" | "inspiration" | "legacy";
export const CreativeMode = z.enum([
  "free",
  "guided",
  "character_interview",
  "world_simulation",
  "conflict_lab",
]);
export type CreativeMode =
  | "free"
  | "guided"
  | "character_interview"
  | "world_simulation"
  | "conflict_lab";
export const InspirationCardKind = z.enum([
  "premise",
  "character",
  "world",
  "conflict",
  "scene",
  "style",
  "question",
]);
export type InspirationCardKind =
  | "premise"
  | "character"
  | "world"
  | "conflict"
  | "scene"
  | "style"
  | "question";
export const CreativeMemoryKind = z.enum([
  "preference",
  "theme",
  "constraint",
  "avoid",
  "goal",
]);
export type CreativeMemoryKind =
  "preference" | "theme" | "constraint" | "avoid" | "goal";
export const AgentModelSelection = z.object({
  providerId: z.exactOptional(z.string()),
  modelId: z.exactOptional(z.string()),
  profileId: z.exactOptional(z.string()),
});
export interface AgentModelSelection {
  providerId?: string;
  modelId?: string;
  profileId?: string;
}
export const AgentSession = z.object({
  id: Id,
  engineSessionId: z.string(),
  engineKind: AgentEngineKind,
  projectId: z.exactOptional(Id),
  surface: AssistantSurface,
  creativeMode: z.exactOptional(CreativeMode),
  parentSessionId: z.exactOptional(Id),
  promptPolicyVersion: z.exactOptional(z.string()),
  webAccessMode: z.enum(["auto", "off"]),
  chapterId: z.exactOptional(Id),
  taskType: z.exactOptional(AgentTaskType),
  title: z.exactOptional(z.string()),
  model: z.exactOptional(AgentModelSelection),
  status: AgentSessionStatus,
  archivedAt: z.exactOptional(IsoDateTime),
  lastOpenedAt: IsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface AgentSession {
  id: Id;
  engineSessionId: string;
  engineKind: AgentEngineKind;
  projectId?: Id;
  surface: AssistantSurface;
  creativeMode?: CreativeMode;
  parentSessionId?: Id;
  promptPolicyVersion?: string;
  webAccessMode: "auto" | "off";
  chapterId?: Id;
  taskType?: AgentTaskType;
  title?: string;
  model?: AgentModelSelection;
  status: AgentSessionStatus;
  archivedAt?: IsoDateTime;
  lastOpenedAt: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const AgentSessionInput = z.object({
  projectId: z.exactOptional(Id),
  surface: z.exactOptional(AssistantSurface),
  creativeMode: z.exactOptional(CreativeMode),
  chapterId: z.exactOptional(Id),
  engineKind: z.exactOptional(AgentEngineKind),
  taskType: z.exactOptional(AgentTaskType),
  title: z.exactOptional(z.string()),
  model: z.exactOptional(AgentModelSelection),
  webAccessMode: z.exactOptional(z.enum(["auto", "off"])),
});
export interface AgentSessionInput {
  projectId?: Id;
  surface?: AssistantSurface;
  creativeMode?: CreativeMode;
  chapterId?: Id;
  engineKind?: AgentEngineKind;
  taskType?: AgentTaskType;
  title?: string;
  model?: AgentModelSelection;
  webAccessMode?: "auto" | "off";
}
export const AgentRunOperation = z.union([
  z.literal("diagnostic"),
  z.literal("revision"),
]);
export type AgentRunOperation = "diagnostic" | "revision";
export const AgentRunInput = z.object({
  /** Optional user constraints. The server still owns the safety prompt. */
  prompt: z.exactOptional(z.string()),
  /** Compatibility field for the first v3 chapter workflow. */
  operation: z.exactOptional(AgentRunOperation),
  taskType: z.exactOptional(AgentTaskType),
  model: z.exactOptional(AgentModelSelection),
  target: z.exactOptional(z.unknown()),
});
export interface AgentRunInput {
  prompt?: string;
  operation?: AgentRunOperation;
  taskType?: AgentTaskType;
  model?: AgentModelSelection;
  target?: unknown;
}

export const AgentRunStatus = z.enum([
  "created",
  "queued",
  "preparing",
  "running",
  "waiting_approval",
  "committing",
  "completed",
  "interrupted",
  "failed",
  "aborted",
  "orphaned",
  "recoverable",
]);
export type AgentRunStatus =
  | "created"
  | "queued"
  | "preparing"
  | "running"
  | "waiting_approval"
  | "committing"
  | "completed"
  | "interrupted"
  | "failed"
  | "aborted"
  | "orphaned"
  | "recoverable";

export const AgentRun = z.object({
  id: Id,
  sessionId: Id,
  taskId: Id,
  taskType: AgentTaskType,
  engineKind: AgentEngineKind,
  status: AgentRunStatus,
  model: z.exactOptional(AgentModelSelection),
  contextSnapshotId: z.exactOptional(Id),
  usageScope: z.exactOptional(
    z.object({
      runId: Id,
      sessionId: Id,
      projectId: z.exactOptional(Id),
      origin: z.enum([
        "frozen-context",
        "first-observation",
        "unreported-session",
      ]),
    }),
  ),
  turnId: z.exactOptional(Id),
  chapterId: z.exactOptional(Id),
  error: z.exactOptional(z.string()),
  inputTokens: z.exactOptional(z.int()),
  outputTokens: z.exactOptional(z.int()),
  cachedTokens: z.exactOptional(z.int()),
  estimatedCost: z.exactOptional(NumericValue),
  currency: z.exactOptional(z.string()),
  engineRunId: z.exactOptional(z.string()),
  lastEngineCursor: z.exactOptional(z.int()),
  engineGeneration: z.exactOptional(z.int()),
  checkpoint: z.exactOptional(z.unknown()),
  recoveryAttempts: z.int(),
  recoveryError: z.exactOptional(z.string()),
  startedAt: z.exactOptional(IsoDateTime),
  completedAt: z.exactOptional(IsoDateTime),
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
  usageScope?: AgentRunUsageScope;
  turnId?: Id;
  chapterId?: Id;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  estimatedCost?: number;
  currency?: string;
  engineRunId?: string;
  lastEngineCursor?: number;
  engineGeneration?: number;
  checkpoint?: unknown;
  recoveryAttempts: number;
  recoveryError?: string;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const AgentItemType = z.enum([
  "stage",
  "message",
  "reasoning_summary",
  "tool_call",
  "tool_result",
  "structured_output",
  "usage",
  "error",
]);
export type AgentItemType =
  | "stage"
  | "message"
  | "reasoning_summary"
  | "tool_call"
  | "tool_result"
  | "structured_output"
  | "usage"
  | "error";
export const AgentItem = z.object({
  id: Id,
  runId: Id,
  sequence: z.int(),
  type: AgentItemType,
  status: z.enum(["started", "streaming", "completed", "failed"]),
  content: z.exactOptional(z.string()),
  payload: z.exactOptional(z.unknown()),
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

export const AssistantTurnStatus = z.enum([
  "routing",
  "queued",
  "running",
  "needs_input",
  "succeeded",
  "failed",
  "interrupted",
  "canceled",
]);
export type AssistantTurnStatus =
  | "routing"
  | "queued"
  | "running"
  | "needs_input"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "canceled";

export const AssistantIntentKind = z.enum(["chat", "task", "clarify"]);
export type AssistantIntentKind = "chat" | "task" | "clarify";
export const AssistantIntentRoute = z.object({
  workflowId: z.exactOptional(Id),
  kind: AssistantIntentKind,
  taskType: z.exactOptional(AgentTaskType),
  confidence: NumericValue,
  source: z.enum(["shortcut", "deterministic", "model", "fallback"]),
  explanation: z.string(),
  clarification: z.exactOptional(z.string()),
});
export interface AssistantIntentRoute {
  workflowId?: Id;
  kind: AssistantIntentKind;
  taskType?: AgentTaskType;
  confidence: number;
  source: "shortcut" | "deterministic" | "model" | "fallback";
  explanation: string;
  clarification?: string;
}

export const AssistantTurn = z.object({
  id: Id,
  sessionId: Id,
  runId: z.exactOptional(Id),
  userMessage: z.string(),
  projectId: z.exactOptional(Id),
  chapterId: z.exactOptional(Id),
  selection: z.exactOptional(z.unknown()),
  route: z.exactOptional(AssistantIntentRoute),
  routingInputTokens: z.exactOptional(z.int()),
  routingOutputTokens: z.exactOptional(z.int()),
  routingCachedTokens: z.exactOptional(z.int()),
  routingEstimatedCost: z.exactOptional(NumericValue),
  status: AssistantTurnStatus,
  error: z.exactOptional(z.string()),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface AssistantTurn {
  id: Id;
  sessionId: Id;
  runId?: Id;
  userMessage: string;
  projectId?: Id;
  chapterId?: Id;
  selection?: unknown;
  route?: AssistantIntentRoute;
  routingInputTokens?: number;
  routingOutputTokens?: number;
  routingCachedTokens?: number;
  routingEstimatedCost?: number;
  status: AssistantTurnStatus;
  error?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const AssistantConversationPatch = z.object({
  title: z.exactOptional(z.string()),
  archived: z.exactOptional(z.boolean()),
  creativeMode: z.exactOptional(CreativeMode),
  webAccessMode: z.exactOptional(z.enum(["auto", "off"])),
});
export interface AssistantConversationPatch {
  title?: string;
  archived?: boolean;
  creativeMode?: CreativeMode;
  webAccessMode?: "auto" | "off";
}

export const AssistantWebResearchSettings = z.object({
  consented: z.boolean(),
  consentedAt: z.exactOptional(IsoDateTime),
  updatedAt: IsoDateTime,
});
export interface AssistantWebResearchSettings {
  consented: boolean;
  consentedAt?: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const AssistantWebResearchConsentInput = z.object({
  consented: z.boolean(),
});
export interface AssistantWebResearchConsentInput {
  consented: boolean;
}

export const AssistantConversationBindInput = z.object({ projectId: Id });
export interface AssistantConversationBindInput {
  projectId: Id;
}

export const AssistantMessageInput = z.object({
  message: z.string(),
  taskType: z.exactOptional(AgentTaskType),
  chapterId: z.exactOptional(Id),
  selection: z.exactOptional(z.unknown()),
  chapterBaseVersion: z.exactOptional(z.int()),
  target: z.exactOptional(z.unknown()),
});
export interface AssistantMessageInput {
  message: string;
  taskType?: AgentTaskType;
  chapterId?: Id;
  selection?: unknown;
  chapterBaseVersion?: number;
  target?: unknown;
}

export const AssistantTurnStart = z.object({
  conversation: AgentSession,
  turn: AssistantTurn,
  run: z.exactOptional(AgentRun),
});
export interface AssistantTurnStart {
  conversation: AgentSession;
  turn: AssistantTurn;
  run?: AgentRun;
}

export const AssistantConversationDetail = z.object({
  conversation: AgentSession,
  turns: z.array(AssistantTurn),
  runs: z.array(AgentRun),
  items: z.array(AgentItem),
  changePreviews: z.array(z.unknown()),
  providerActionPreviews: z.array(z.unknown()),
});
export interface AssistantConversationDetail {
  conversation: AgentSession;
  turns: AssistantTurn[];
  runs: AgentRun[];
  items: AgentItem[];
  changePreviews: unknown[];
  providerActionPreviews: unknown[];
}

export const InspirationCard = z.object({
  id: Id,
  conversationId: Id,
  kind: InspirationCardKind,
  title: z.string(),
  content: z.string(),
  sourceTurnId: z.exactOptional(Id),
  adopted: z.boolean(),
  version: z.int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface InspirationCard {
  id: Id;
  conversationId: Id;
  kind: InspirationCardKind;
  title: string;
  content: string;
  sourceTurnId?: Id;
  adopted: boolean;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const InspirationCardInput = z.object({
  conversationId: Id,
  kind: InspirationCardKind,
  title: RequiredText,
  content: RequiredText,
  sourceTurnId: z.exactOptional(Id),
});
export interface InspirationCardInput {
  conversationId: Id;
  kind: InspirationCardKind;
  title: string;
  content: string;
  sourceTurnId?: Id;
}
export const InspirationCardPatch = z.object({
  kind: z.exactOptional(InspirationCardKind),
  title: z.exactOptional(RequiredText),
  content: z.exactOptional(RequiredText),
  adopted: z.exactOptional(z.boolean()),
  version: z.int(),
});
export interface InspirationCardPatch {
  kind?: InspirationCardKind;
  title?: string;
  content?: string;
  adopted?: boolean;
  version: number;
}

export const CreativeMemorySettings = z.object({
  enabled: z.boolean(),
  consentedAt: z.exactOptional(IsoDateTime),
  updatedAt: IsoDateTime,
});
export interface CreativeMemorySettings {
  enabled: boolean;
  consentedAt?: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const CreativeMemorySettingsInput = z.object({
  enabled: z.boolean(),
});
export interface CreativeMemorySettingsInput {
  enabled: boolean;
}
export const CreativeMemory = z.object({
  id: Id,
  kind: CreativeMemoryKind,
  content: z.string(),
  confidence: NumericValue,
  sourceConversationIds: z.array(Id),
  status: z.enum(["active", "disabled"]),
  version: z.int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface CreativeMemory {
  id: Id;
  kind: CreativeMemoryKind;
  content: string;
  confidence: number;
  sourceConversationIds: Id[];
  status: "active" | "disabled";
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const CreativeMemoryPatch = z.object({
  kind: z.exactOptional(CreativeMemoryKind),
  content: z.exactOptional(RequiredText),
  status: z.exactOptional(z.enum(["active", "disabled"])),
  version: z.int(),
});
export interface CreativeMemoryPatch {
  kind?: CreativeMemoryKind;
  content?: string;
  status?: "active" | "disabled";
  version: number;
}

export const InspirationMemoryJob = z.object({
  id: Id,
  conversationId: Id,
  throughTurnCount: z.int(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  reason: z.enum(["six_turns", "archive", "manual"]),
  error: z.exactOptional(z.string()),
  model: z.exactOptional(z.string()),
  inputTokens: z.exactOptional(z.int()),
  outputTokens: z.exactOptional(z.int()),
  usageRuns: z.exactOptional(
    z.array(z.object({ runId: Id, projectId: z.exactOptional(Id) })),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface InspirationMemoryJob {
  id: Id;
  conversationId: Id;
  throughTurnCount: number;
  status: "pending" | "running" | "completed" | "failed";
  reason: "six_turns" | "archive" | "manual";
  error?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  usageRuns?: readonly { runId: Id; projectId?: Id }[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const InspirationProjectPreviewInput = z.object({
  conversationId: Id,
  project: ProjectInput,
  cardIds: z.array(Id),
});
export interface InspirationProjectPreviewInput {
  conversationId: Id;
  project: ProjectInput;
  cardIds: Id[];
}
export const InspirationProjectPreview = z.object({
  id: Id,
  conversationId: Id,
  project: ProjectInput,
  cards: z.array(InspirationCard),
  status: z.enum([
    "pending",
    "project_created",
    "cards_copied",
    "completed",
    "failed",
  ]),
  projectId: z.exactOptional(Id),
  error: z.exactOptional(z.string()),
  expiresAt: IsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface InspirationProjectPreview {
  id: Id;
  conversationId: Id;
  project: ProjectInput;
  cards: InspirationCard[];
  status:
    "pending" | "project_created" | "cards_copied" | "completed" | "failed";
  projectId?: Id;
  error?: string;
  expiresAt: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const InspirationProjectCommitResult = z.object({
  preview: InspirationProjectPreview,
  project: Project,
  cardsCopied: z.int(),
});
export interface InspirationProjectCommitResult {
  preview: InspirationProjectPreview;
  project: Project;
  cardsCopied: number;
}

export const AgentEngineCapabilities = z.object({
  streaming: z.boolean(),
  interrupt: z.boolean(),
  resume: z.boolean(),
  fork: z.boolean(),
  readOnlyMcp: z.boolean(),
  structuredOutput: z.boolean(),
  chatGptLogin: z.boolean(),
  apiKeyLogin: z.boolean(),
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
export const AgentEngineDescriptor = z.object({
  kind: AgentEngineKind,
  name: z.string(),
  version: z.string(),
  status: z.enum(["starting", "available", "degraded", "unavailable"]),
  runtimeStatus: z.exactOptional(
    z.enum(["starting", "running", "stopped", "crashed"]),
  ),
  configurationStatus: z.exactOptional(
    z.enum([
      "configured",
      "missing_credentials",
      "missing_model",
      "login_required",
    ]),
  ),
  invocationStatus: z.exactOptional(z.enum(["verified", "untested", "failed"])),
  canRun: z.exactOptional(z.boolean()),
  lastCheckedAt: z.exactOptional(IsoDateTime),
  lastFailure: z.exactOptional(
    z.object({
      code: z.string(),
      message: z.string(),
      occurredAt: IsoDateTime,
    }),
  ),
  isDefault: z.boolean(),
  isBeta: z.boolean(),
  statusMessage: z.exactOptional(z.string()),
  capabilities: AgentEngineCapabilities,
});
export interface AgentEngineDescriptor {
  kind: AgentEngineKind;
  name: string;
  version: string;
  status: "starting" | "available" | "degraded" | "unavailable";
  runtimeStatus?: "starting" | "running" | "stopped" | "crashed";
  configurationStatus?:
    "configured" | "missing_credentials" | "missing_model" | "login_required";
  invocationStatus?: "verified" | "untested" | "failed";
  canRun?: boolean;
  lastCheckedAt?: IsoDateTime;
  lastFailure?: { code: string; message: string; occurredAt: IsoDateTime };
  isDefault: boolean;
  isBeta: boolean;
  statusMessage?: string;
  capabilities: AgentEngineCapabilities;
}

export const AgentTaskDescriptor = z.object({
  id: AgentTaskType,
  label: z.string(),
  category: z.string(),
  promptVersion: z.string(),
  writePolicy: z.enum([
    "readonly",
    "change-preview",
    "provider-action-preview",
  ]),
  allowedTools: z.array(z.string()),
});
export interface AgentTaskDescriptor {
  id: AgentTaskType;
  label: string;
  category: string;
  promptVersion: string;
  writePolicy: "readonly" | "change-preview" | "provider-action-preview";
  allowedTools: readonly string[];
}

export const GlobalAgentSettings = z.object({
  defaultEngineKind: AgentEngineKind,
  defaultModel: z.exactOptional(AgentModelSelection),
  activeProviderId: z.exactOptional(Id),
  updatedAt: IsoDateTime,
});
export interface GlobalAgentSettings {
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
  activeProviderId?: Id;
  updatedAt: IsoDateTime;
}
export const GlobalAgentSettingsInput = z.object({
  defaultEngineKind: AgentEngineKind,
  defaultModel: z.exactOptional(AgentModelSelection),
});
export interface GlobalAgentSettingsInput {
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
}

export const ProjectAgentSettings = z.object({
  projectId: Id,
  defaultEngineKind: AgentEngineKind,
  defaultModel: z.exactOptional(AgentModelSelection),
  assistantMode: z.enum(["simple", "advanced"]),
  updatedAt: IsoDateTime,
});
export interface ProjectAgentSettings {
  projectId: Id;
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
  assistantMode: "simple" | "advanced";
  updatedAt: IsoDateTime;
}
export const ProjectAgentSettingsInput = z.object({
  defaultEngineKind: AgentEngineKind,
  defaultModel: z.exactOptional(AgentModelSelection),
  assistantMode: z.exactOptional(z.enum(["simple", "advanced"])),
});
export interface ProjectAgentSettingsInput {
  defaultEngineKind: AgentEngineKind;
  defaultModel?: AgentModelSelection;
  assistantMode?: "simple" | "advanced";
}

export const DomainEntity = z.object({
  id: Id,
  domain: z.string(),
  projectId: z.exactOptional(Id),
  parentId: z.exactOptional(Id),
  title: z.string(),
  payload: z.unknown(),
  version: z.int(),
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
export const DomainEntityInput = z.object({
  projectId: z.exactOptional(Id),
  parentId: z.exactOptional(Id),
  title: z.string(),
  payload: z.exactOptional(z.unknown()),
  capabilityToken: z.exactOptional(z.string()),
});
export interface DomainEntityInput {
  projectId?: Id;
  parentId?: Id;
  title: string;
  payload?: unknown;
  capabilityToken?: string;
}
export const DomainEntityPatch = z.object({
  title: z.exactOptional(z.string()),
  payload: z.exactOptional(z.unknown()),
  version: z.int(),
});
export interface DomainEntityPatch {
  title?: string;
  payload?: unknown;
  version: number;
}

export const NovelChapterStatus = z.object({
  chapterId: Id,
  words: z.int(),
  hasMemory: z.boolean(),
  quality: z.exactOptional(z.enum(["pass", "warn", "block"])),
  latestTaskStatus: z.exactOptional(TaskStatus),
});
export interface NovelChapterStatus {
  chapterId: Id;
  words: number;
  hasMemory: boolean;
  quality?: "pass" | "warn" | "block";
  latestTaskStatus?: TaskStatus;
}

export const NovelWorkspace = z.object({
  project: Project,
  chapters: z.array(Chapter),
  characters: z.array(DomainEntity),
  outlines: z.array(DomainEntity),
  storyArcs: z.array(DomainEntity),
  statuses: z.array(NovelChapterStatus),
});
export interface NovelWorkspace {
  project: Project;
  chapters: Chapter[];
  characters: DomainEntity[];
  outlines: DomainEntity[];
  storyArcs: DomainEntity[];
  statuses: NovelChapterStatus[];
}

export const ChapterTextSelection = z.object({
  text: z.string().min(1),
  from: z.exactOptional(z.int()),
  to: z.exactOptional(z.int()),
});
export interface ChapterTextSelection {
  text: string;
  from?: number;
  to?: number;
}

export const ChapterAgentRunInput = z.object({
  taskType: AgentTaskType,
  engineKind: AgentEngineKind,
  model: z.exactOptional(AgentModelSelection),
  prompt: z.exactOptional(z.string()),
  wordGoal: z.exactOptional(z.int()),
  baseVersion: z.int(),
  selection: z.exactOptional(ChapterTextSelection),
});
export interface ChapterAgentRunInput {
  taskType: AgentTaskType;
  engineKind: AgentEngineKind;
  model?: AgentModelSelection;
  prompt?: string;
  wordGoal?: number;
  baseVersion: number;
  selection?: ChapterTextSelection;
}

export const ChapterAgentRunStart = z.object({
  taskId: Id,
  sessionId: Id,
  runId: Id,
  chapterId: Id,
  autoCommitWhenReady: z.boolean(),
});
export interface ChapterAgentRunStart {
  taskId: Id;
  sessionId: Id;
  runId: Id;
  chapterId: Id;
  autoCommitWhenReady: boolean;
}

export const ContinueChapterAgentRunInput = z.object({
  sourceChapterId: Id,
  engineKind: AgentEngineKind,
  model: z.exactOptional(AgentModelSelection),
  prompt: z.exactOptional(z.string()),
  wordGoal: z.exactOptional(z.int()),
  baseVersion: z.int(),
  narrativeContextRequest: z.exactOptional(
    z.object({
      format: z.literal("narrative-context-v1"),
      chapters: z.array(
        z.union([
          z.object({
            id: Id,
            version: z.int(),
            representation: z.literal("original"),
          }),
          z.object({
            id: Id,
            version: z.int(),
            representation: z.literal("summary"),
            record: z.object({ id: Id, version: z.int() }),
          }),
          z.object({
            id: Id,
            version: z.int(),
            representation: z.literal("paragraphs"),
            paragraphIds: z.array(z.string()),
          }),
        ]),
      ),
    }),
  ),
});
export interface ContinueChapterAgentRunInput {
  sourceChapterId: Id;
  engineKind: AgentEngineKind;
  model?: AgentModelSelection;
  prompt?: string;
  wordGoal?: number;
  baseVersion: number;
  narrativeContextRequest?: TypedNarrativeContextRequest;
}

export const ContinueChapterAgentRunStart = z.object({
  chapter: Chapter,
  run: ChapterAgentRunStart,
});
export interface ContinueChapterAgentRunStart {
  chapter: Chapter;
  run: ChapterAgentRunStart;
}

export const ChapterVersionRestoreInput = z.object({
  baseVersion: z.int(),
});
export interface ChapterVersionRestoreInput {
  baseVersion: number;
}

/** P1 资产中心只读取既有 domain_entities，不复制本地媒体二进制或路径。 */
export const AssetCenterCategory = z.enum([
  "character",
  "scene",
  "prop",
  "voice",
]);
export type AssetCenterCategory = "character" | "scene" | "prop" | "voice";
export const AssetCenterPreview = z.object({
  kind: z.enum(["image", "audio", "none"]),
  status: z.enum(["available", "missing", "unattached"]),
  label: z.exactOptional(z.string()),
});
export interface AssetCenterPreview {
  kind: "image" | "audio" | "none";
  status: "available" | "missing" | "unattached";
  label?: string;
}
export const AssetCenterPreviewMedia = z.object({
  id: Id,
  kind: z.enum(["image", "audio"]),
  dataUrl: z.string(),
});
export interface AssetCenterPreviewMedia {
  id: Id;
  kind: "image" | "audio";
  dataUrl: string;
}
export const AssetCenterUsage = z.object({
  shotId: Id,
  shotTitle: z.string(),
  sceneTitle: z.exactOptional(z.string()),
});
export interface AssetCenterUsage {
  shotId: Id;
  shotTitle: string;
  sceneTitle?: string;
}
export const AssetCenterAsset = z.object({
  id: Id,
  title: z.string(),
  category: AssetCenterCategory,
  subject: z.string(),
  assetVersion: z.string(),
  adopted: z.boolean(),
  lockStatus: z.enum(["locked", "unlocked"]),
  stale: z.boolean(),
  preview: AssetCenterPreview,
  rightsStatus: z.enum(["restricted", "unknown"]),
  costStatus: z.literal("unknown"),
  providerStatus: z.enum(["unavailable", "unknown"]),
  rightsDeclaration: z.enum([
    "user-reported-cleared",
    "user-reported-restricted",
    "not-provided",
  ]),
  costDeclaration: z.enum(["user-reported-known", "not-provided"]),
  providerDeclaration: z.enum([
    "user-reported-available",
    "user-reported-unavailable",
    "user-reported-not-required",
    "not-provided",
  ]),
  usages: z.array(AssetCenterUsage),
  version: z.int(),
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
  rightsStatus: "restricted" | "unknown";
  costStatus: "unknown";
  providerStatus: "unavailable" | "unknown";
  rightsDeclaration:
    "user-reported-cleared" | "user-reported-restricted" | "not-provided";
  costDeclaration: "user-reported-known" | "not-provided";
  providerDeclaration:
    | "user-reported-available"
    | "user-reported-unavailable"
    | "user-reported-not-required"
    | "not-provided";
  usages: AssetCenterUsage[];
  version: number;
}
export const AssetCenter = z.object({
  projectId: Id,
  assets: z.array(AssetCenterAsset),
});
export interface AssetCenter {
  projectId: Id;
  assets: AssetCenterAsset[];
}
export const AssetCenterActionInput = z.object({
  action: z.enum(["adopt", "lock", "unlock", "assign-shot", "remove-shot"]),
  version: z.int(),
  shotId: z.exactOptional(Id),
});
export interface AssetCenterActionInput {
  action: "adopt" | "lock" | "unlock" | "assign-shot" | "remove-shot";
  version: number;
  shotId?: Id;
}

/** 系列是本地、可选的跨项目边界；不承载账号、凭据或云端共享状态。 */
export const Series = z.object({
  id: Id,
  title: z.string(),
  description: z.string(),
  version: z.int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface Series {
  id: Id;
  title: string;
  description: string;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const SeriesInput = z.object({
  title: z.string(),
  description: z.exactOptional(z.string()),
});
export interface SeriesInput {
  title: string;
  description?: string;
}
export const ProjectSeriesInput = z.object({
  seriesId: z.exactOptional(Id),
});
export interface ProjectSeriesInput {
  seriesId?: Id;
}
export const SeriesStoryBible = z.object({
  id: Id,
  seriesId: Id,
  title: z.string(),
  payload: z.unknown(),
  version: z.int(),
  overridden: z.boolean(),
  sourceVersion: z.int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface SeriesStoryBible {
  id: Id;
  seriesId: Id;
  title: string;
  payload: unknown;
  version: number;
  overridden: boolean;
  sourceVersion: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const SeriesStoryBibleInput = z.object({
  title: z.string(),
  payload: z.unknown(),
});
export interface SeriesStoryBibleInput {
  title: string;
  payload: unknown;
}
export const SeriesStoryBibleOverrideInput = z.object({
  title: z.string(),
  payload: z.unknown(),
  sourceVersion: z.int(),
});
export interface SeriesStoryBibleOverrideInput {
  title: string;
  payload: unknown;
  sourceVersion: number;
}
export const SeriesStoryBibleUpgradeInput = z.object({
  sourceVersion: z.int(),
});
export interface SeriesStoryBibleUpgradeInput {
  sourceVersion: number;
}
export const SeriesAssetMode = z.enum(["copy", "fork", "link"]);
export type SeriesAssetMode = "copy" | "fork" | "link";
export const SeriesAssetTransferInput = z.object({
  sourceAssetId: Id,
  sourceVersion: z.int(),
  mode: SeriesAssetMode,
});
export interface SeriesAssetTransferInput {
  sourceAssetId: Id;
  sourceVersion: number;
  mode: SeriesAssetMode;
}
export const SeriesAssetLink = z.object({
  id: Id,
  seriesId: Id,
  sourceAssetId: Id,
  sourceVersion: z.int(),
  targetProjectId: Id,
  targetAssetId: Id,
  mode: SeriesAssetMode,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface SeriesAssetLink {
  id: Id;
  seriesId: Id;
  sourceAssetId: Id;
  sourceVersion: number;
  targetProjectId: Id;
  targetAssetId: Id;
  mode: SeriesAssetMode;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const SeriesLibrary = z.object({
  projectId: Id,
  series: z.exactOptional(Series),
  storyBible: z.array(SeriesStoryBible),
  assets: z.array(SeriesAssetLink),
});
export interface SeriesLibrary {
  projectId: Id;
  series?: Series;
  storyBible: SeriesStoryBible[];
  assets: SeriesAssetLink[];
}

/**
 * 对有序制作条目执行原子重排。每一项携带当前版本，避免陈旧界面覆盖
 * 其他协作者刚刚调整过的顺序。
 */
export const OrderedDomainEntity = z.object({
  id: Id,
  version: z.int(),
});
export interface OrderedDomainEntity {
  id: Id;
  version: number;
}
export const DomainChildrenReorderInput = z.object({
  items: z.array(OrderedDomainEntity),
});
export interface DomainChildrenReorderInput {
  items: OrderedDomainEntity[];
}
export const DomainChildrenReorderResult = z.object({
  records: z.array(DomainEntity),
});
export interface DomainChildrenReorderResult {
  records: DomainEntity[];
}
export const CurrentAdaptationInput = z.object({
  adaptationId: Id,
});
export interface CurrentAdaptationInput {
  adaptationId: Id;
}

export const ScriptReview = z.object({
  id: Id,
  scriptId: Id,
  hookStrengthScore: NumericValue,
  dialogueScore: NumericValue,
  conflictScore: NumericValue,
  visualClarityScore: NumericValue,
  sceneClarityScore: NumericValue,
  characterFitScore: NumericValue,
  shotReadinessScore: NumericValue,
  aiVideoFeasibilityScore: NumericValue,
  cliffhangerScore: NumericValue,
  overallScore: NumericValue,
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
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
export const AiVideoDifficulty = z.union([
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
]);
export type AiVideoDifficulty = "low" | "medium" | "high";
export const ShotReview = z.object({
  id: Id,
  shotId: Id,
  lengthScore: NumericValue,
  characterCountScore: NumericValue,
  actionComplexityScore: NumericValue,
  visualClarityScore: NumericValue,
  characterConsistencyScore: NumericValue,
  sceneContinuityScore: NumericValue,
  promptControllabilityScore: NumericValue,
  verticalSuitabilityScore: NumericValue,
  overallScore: NumericValue,
  aiVideoDifficulty: AiVideoDifficulty,
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
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
export const PromptVersion = z.object({
  id: Id,
  shotId: Id,
  version: z.int(),
  taskType: z.string(),
  videoPrompt: z.string(),
  negativePrompt: z.exactOptional(z.string()),
  imagePrompt: z.exactOptional(z.string()),
  note: z.exactOptional(z.string()),
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
export const PromptVersionInput = z.object({
  taskType: z.string(),
  videoPrompt: z.exactOptional(z.string()),
  negativePrompt: z.exactOptional(z.string()),
  imagePrompt: z.exactOptional(z.string()),
  note: z.exactOptional(z.string()),
});
export interface PromptVersionInput {
  taskType: string;
  videoPrompt?: string;
  negativePrompt?: string;
  imagePrompt?: string;
  note?: string;
}

/** 项目改编中分集结构的可重建分析，不包含模型生成的虚假结论。 */
export const EpisodeAnalysis = z.object({
  id: Id,
  adaptationId: Id,
  episodeCount: z.int(),
  hookCoverage: NumericValue,
  cliffhangerCoverage: NumericValue,
  outlineCoverage: NumericValue,
  overallScore: NumericValue,
  summary: z.string(),
  suggestions: z.array(z.string()),
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
export const PlatformDeliveryProfile = z.object({
  id: Id,
  version: z.string(),
  title: z.string(),
  platform: z.string(),
  region: z.string(),
  sourceUrl: z.string(),
  sourceStatus: z.union([
    z.literal("internal_master"),
    z.literal("platform_portal"),
    z.literal("unknown"),
  ]),
  checkedAt: IsoDateTime,
  filenamePrefix: z.string(),
  video: z.object({
    width: z.int(),
    height: z.int(),
    videoCodec: z.string(),
    audioCodec: z.string(),
  }),
  duration: z.object({
    status: z.union([z.literal("verified"), z.literal("manual")]),
    minSeconds: z.exactOptional(z.int()),
    maxSeconds: z.exactOptional(z.int()),
    note: z.string(),
  }),
  subtitleSafeZone: z.object({
    bottomMarginPx: z.int(),
    note: z.string(),
  }),
  requiredListingFields: z.array(z.string()),
  manualFields: z.array(z.string()),
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
export const DeliveryCreativeVariant = z.object({
  id: Id,
  projectId: Id,
  adaptationId: Id,
  label: z.string(),
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  coverAssetId: z.exactOptional(Id),
  source: z.union([z.literal("manual"), z.literal("ai_draft")]),
  status: z.union([
    z.literal("candidate"),
    z.literal("adopted"),
    z.literal("archived"),
  ]),
  versionNumber: z.int(),
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
export const DeliveryCreativeVariantInput = z.object({
  label: RequiredText,
  title: RequiredText,
  description: RequiredText,
  tags: z.array(RequiredText),
  coverAssetId: z.exactOptional(Id),
  source: z.exactOptional(
    z.union([z.literal("manual"), z.literal("ai_draft")]),
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
export const PlatformDeliveryPreflightInput = z.object({
  profileId: Id,
  creativeVariantId: Id,
  manualFieldsConfirmed: z.boolean(),
});
export interface PlatformDeliveryPreflightInput {
  profileId: Id;
  creativeVariantId: Id;
  manualFieldsConfirmed: boolean;
}
export const PlatformDeliveryPreflight = z.object({
  ok: z.boolean(),
  profile: z.exactOptional(PlatformDeliveryProfile),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  expectedFiles: z.array(z.string()),
  finalBaseName: z.exactOptional(z.string()),
  sourceFingerprint: z.exactOptional(z.string()),
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
export const PlatformDeliveryArchive = z.object({
  id: Id,
  projectId: Id,
  adaptationId: Id,
  episodeId: Id,
  profileId: Id,
  profileVersion: z.string(),
  creativeVariantId: Id,
  deliveryVersion: z.int(),
  sourceFingerprint: z.string(),
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
export const EditorTimelineClip = z.object({
  id: Id,
  shotId: Id,
  orderIndex: z.int(),
  name: z.string(),
  startSeconds: NumericValue,
  durationSeconds: NumericValue,
  subtitle: z.exactOptional(z.string()),
  transition: z.union([
    z.literal("cut"),
    z.literal("dissolve"),
    z.literal("fade"),
  ]),
  mediaKind: z.union([
    z.literal("video"),
    z.literal("still"),
    z.literal("slate"),
  ]),
  mediaStatus: z.union([z.literal("referenced"), z.literal("needs_relink")]),
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
export const EditorTimelineManifest = z.object({
  format: z.literal("dramaip-editor-timeline"),
  version: z.literal(1),
  projectId: Id,
  adaptationId: Id,
  episodeId: Id,
  title: z.string(),
  frameRate: z.union([z.literal(24), z.literal(25), z.literal(30)]),
  width: z.int(),
  height: z.int(),
  clips: z.array(EditorTimelineClip),
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

/**
 * 编辑器唯一权威时间线。它只保存媒体实体引用和时间信息，绝不保存本地绝对路径或修改源媒体。
 * 旧的 EditorTimelineManifest 仍用于审片交接导出；后续 NLE 交付应从此结构读取。
 */
export const TimelineTrackKind = z.enum([
  "video",
  "dialogue",
  "narration",
  "bgm",
  "sfx",
  "subtitle",
]);
export type TimelineTrackKind =
  "video" | "dialogue" | "narration" | "bgm" | "sfx" | "subtitle";

export const TimelineMediaStatus = z.enum([
  "linked",
  "missing",
  "unsupported",
  "proxy",
  "unattached",
]);
export type TimelineMediaStatus =
  "linked" | "missing" | "unsupported" | "proxy" | "unattached";

export const FrameRate = z.object({
  numerator: z.int(),
  denominator: z.int(),
  dropFrame: z.boolean(),
});
export interface FrameRate {
  numerator: number;
  denominator: number;
  dropFrame: boolean;
}

export const TimelineProfile = z.object({
  width: z.int(),
  height: z.int(),
  frameRate: FrameRate,
  audioSampleRate: z.int(),
  channels: z.int(),
});
export interface TimelineProfile {
  width: number;
  height: number;
  frameRate: FrameRate;
  audioSampleRate: number;
  channels: number;
}

export const TimelineClip = z.object({
  id: Id,
  sourceClipId: z.exactOptional(Id),
  shotId: z.exactOptional(Id),
  assetId: z.exactOptional(Id),
  audioTrackId: z.exactOptional(Id),
  audioTrackVersion: z.exactOptional(z.int()),
  audioSourceFingerprint: z.exactOptional(z.string()),
  mediaRef: z.exactOptional(z.string()),
  trackId: Id,
  name: z.string(),
  startFrame: z.int(),
  durationFrames: z.int(),
  sourceOffsetFrame: z.int(),
  mediaStatus: TimelineMediaStatus,
  text: z.exactOptional(z.string()),
  /** 音频片段的非破坏性混音参数；视频和字幕可省略。 */
  volume: z.exactOptional(NumericValue),
  fadeInFrames: z.exactOptional(z.int()),
  fadeOutFrames: z.exactOptional(z.int()),
  /** BGM 在对白 / 旁白存在时采用的相对增益。 */
  duckingGain: z.exactOptional(NumericValue),
  /** 用户显式锁定，自动编排不得替换或删除该片段。 */
  locked: z.exactOptional(z.boolean()),
  manuallyEdited: z.boolean(),
});
export interface TimelineClip {
  id: Id;
  sourceClipId?: Id;
  shotId?: Id;
  assetId?: Id;
  audioTrackId?: Id;
  audioTrackVersion?: number;
  audioSourceFingerprint?: string;
  mediaRef?: string;
  trackId: Id;
  name: string;
  startFrame: number;
  durationFrames: number;
  sourceOffsetFrame: number;
  mediaStatus: TimelineMediaStatus;
  text?: string;
  volume?: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  duckingGain?: number;
  locked?: boolean;
  manuallyEdited: boolean;
}

export const TimelineTrack = z.object({
  id: Id,
  kind: TimelineTrackKind,
  label: z.string(),
  muted: z.boolean(),
  solo: z.boolean(),
  clips: z.array(TimelineClip),
});
export interface TimelineTrack {
  id: Id;
  kind: TimelineTrackKind;
  label: string;
  muted: boolean;
  solo: boolean;
  clips: TimelineClip[];
}

export const TimelineManifest = z.object({
  format: z.literal("dramaip-timeline"),
  schemaVersion: z.literal(2),
  id: Id,
  projectId: Id,
  adaptationId: Id,
  episodeId: Id,
  sourceFingerprint: z.string(),
  profile: TimelineProfile,
  timebase: z.literal("frames"),
  durationFrames: z.int(),
  migrationWarnings: z.array(z.string()),
  tracks: z.array(TimelineTrack),
  version: z.int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface TimelineManifest {
  format: "dramaip-timeline";
  schemaVersion: 2;
  id: Id;
  projectId: Id;
  adaptationId: Id;
  episodeId: Id;
  sourceFingerprint: string;
  profile: TimelineProfile;
  timebase: "frames";
  durationFrames: number;
  migrationWarnings: string[];
  tracks: TimelineTrack[];
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const TimelineEditCommand = z.union([
  z.object({
    type: z.literal("move"),
    clipId: Id,
    startFrame: z.int(),
  }),
  z.object({
    type: z.literal("trim"),
    clipId: Id,
    startFrame: z.exactOptional(z.int()),
    durationFrames: z.int(),
  }),
  z.object({
    type: z.literal("split"),
    clipId: Id,
    atFrame: z.int(),
  }),
  z.object({
    type: z.literal("set-track-audio"),
    trackId: Id,
    muted: z.exactOptional(z.boolean()),
    solo: z.exactOptional(z.boolean()),
  }),
  z.object({
    type: z.literal("relink"),
    clipId: Id,
    assetId: Id,
  }),
  z.object({
    type: z.literal("set-clip-audio"),
    clipId: Id,
    volume: z.exactOptional(NumericValue),
    locked: z.exactOptional(z.boolean()),
  }),
]);
export type TimelineEditCommand =
  | { type: "move"; clipId: Id; startFrame: number }
  | {
      type: "trim";
      clipId: Id;
      startFrame?: number;
      durationFrames: number;
    }
  | { type: "split"; clipId: Id; atFrame: number }
  | {
      type: "set-track-audio";
      trackId: Id;
      muted?: boolean;
      solo?: boolean;
    }
  | { type: "relink"; clipId: Id; assetId: Id }
  | {
      type: "set-clip-audio";
      clipId: Id;
      volume?: number;
      locked?: boolean;
    };

export const TimelineCommandInput = z.object({
  version: z.int(),
  command: TimelineEditCommand,
});
export interface TimelineCommandInput {
  version: number;
  command: TimelineEditCommand;
}

export const TimelineHistoryAvailability = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});
export interface TimelineHistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
}

export const TimelineMediaPreview = z.object({
  id: Id,
  kind: z.enum(["image", "audio", "video"]),
  dataUrl: z.string(),
});
export interface TimelineMediaPreview {
  id: Id;
  kind: "image" | "audio" | "video";
  dataUrl: string;
}

/**
 * NLE 重链接清单区分冻结来源、owner 存档元数据与全字节核验。
 * 相对路径是目标占位，不代表媒体已复制；不携带绝对路径、凭据或授权正文。
 */
export const TimelineDeliveryArchive = z.object({
  artifactRef: Id,
  kind: z.enum(["image", "audio", "video"]),
  mimeType: z.string(),
  extension: z.string(),
  sizeBytes: z.int(),
  sha256: z.string(),
  verification: z.literal("owner-metadata-only"),
});
export interface TimelineDeliveryArchive {
  artifactRef: Id;
  kind: "image" | "audio" | "video";
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  verification: "owner-metadata-only";
}
export const TimelineDeliveryMedia = z.object({
  assetId: Id,
  title: z.string(),
  clipIds: z.array(Id),
  expectedVersions: z.array(z.int()),
  sourceVersion: z.exactOptional(z.int()),
  sourceStatus: z.enum([
    "current",
    "unverified",
    "stale",
    "missing",
    "foreign",
  ]),
  relativePath: z.string(),
  checksum: z.exactOptional(z.string()),
  archive: z.exactOptional(TimelineDeliveryArchive),
  mediaStatus: z.literal("unattached"),
  rightsStatus: z.enum(["unknown", "restricted"]),
  rightsDeclaration: z.enum([
    "not-provided",
    "user-reported-cleared",
    "user-reported-restricted",
  ]),
  lineage: z.array(z.string()),
});
export interface TimelineDeliveryMedia {
  assetId: Id;
  title: string;
  clipIds: Id[];
  expectedVersions: number[];
  sourceVersion?: number;
  sourceStatus: "current" | "unverified" | "stale" | "missing" | "foreign";
  relativePath: string;
  checksum?: string;
  archive?: TimelineDeliveryArchive;
  mediaStatus: "unattached";
  rightsStatus: "unknown" | "restricted";
  rightsDeclaration:
    "not-provided" | "user-reported-cleared" | "user-reported-restricted";
  lineage: string[];
}

export const TimelineDeliveryManifest = z.object({
  format: z.literal("dramaip-timeline-delivery"),
  schemaVersion: z.literal(3),
  timeline: TimelineManifest,
  sourceFingerprint: z.string(),
  media: z.array(TimelineDeliveryMedia),
  sourceBlockers: z.array(
    z.object({
      clipId: Id,
      code: z.enum(["MISSING_MEDIA", "UNVERIFIED_SOURCE", "STALE_SOURCE"]),
      message: z.string(),
    }),
  ),
  unsupportedFeatures: z.array(z.string()),
  warnings: z.array(z.string()),
});
export interface TimelineDeliveryManifest {
  format: "dramaip-timeline-delivery";
  schemaVersion: 3;
  timeline: TimelineManifest;
  sourceFingerprint: string;
  media: TimelineDeliveryMedia[];
  sourceBlockers: {
    clipId: Id;
    code: "MISSING_MEDIA" | "UNVERIFIED_SOURCE" | "STALE_SOURCE";
    message: string;
  }[];
  unsupportedFeatures: string[];
  warnings: string[];
}

export const TimelineDeliveryExportFormat = z.enum([
  "manifest",
  "fcpxml",
  "otio",
  "edl",
  "srt",
  "vtt",
  "relink",
]);
export type TimelineDeliveryExportFormat =
  "manifest" | "fcpxml" | "otio" | "edl" | "srt" | "vtt" | "relink";

/**
 * 自动音频编排只引用已采用的版本化音轨。预览中的每一项都带回到文本、音色、
 * 素材、服务商、成本和权利状态的最小可审查谱系，不暴露凭据或本地绝对路径。
 */
export const AudioAssemblyClip = z.object({
  id: Id,
  audioTrackId: Id,
  audioTrackVersion: z.int(),
  audioSourceFingerprint: z.string(),
  sourceClipId: Id,
  kind: z.enum(["dialogue", "narration", "bgm", "sfx"]),
  name: z.string(),
  shotId: z.exactOptional(Id),
  assetId: z.exactOptional(Id),
  voiceProfileId: z.exactOptional(Id),
  text: z.exactOptional(z.string()),
  startSeconds: NumericValue,
  durationSeconds: NumericValue,
  volume: NumericValue,
  fadeInSeconds: NumericValue,
  fadeOutSeconds: NumericValue,
  duckingGain: z.exactOptional(NumericValue),
  overflowSeconds: NumericValue,
  provider: z.string(),
  cost: z.exactOptional(NumericValue),
  rightsStatus: z.union([
    z.literal("cleared"),
    z.literal("unknown"),
    z.literal("restricted"),
  ]),
});
export interface AudioAssemblyClip {
  id: Id;
  audioTrackId: Id;
  audioTrackVersion: number;
  audioSourceFingerprint: string;
  sourceClipId: Id;
  kind: AudioTrackKind;
  name: string;
  shotId?: Id;
  assetId?: Id;
  voiceProfileId?: Id;
  text?: string;
  startSeconds: number;
  durationSeconds: number;
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  duckingGain?: number;
  overflowSeconds: number;
  provider: string;
  cost?: number;
  rightsStatus: "cleared" | "unknown" | "restricted";
}

export const SubtitleCue = z.object({
  id: Id,
  audioTrackId: Id,
  audioTrackVersion: z.int(),
  audioSourceFingerprint: z.string(),
  sourceClipId: Id,
  shotId: z.exactOptional(Id),
  startSeconds: NumericValue,
  durationSeconds: NumericValue,
  text: z.string(),
});
export interface SubtitleCue {
  id: Id;
  audioTrackId: Id;
  audioTrackVersion: number;
  audioSourceFingerprint: string;
  sourceClipId: Id;
  shotId?: Id;
  startSeconds: number;
  durationSeconds: number;
  text: string;
}

export const AudioAssemblyPreview = z.object({
  timelineId: Id,
  timelineVersion: z.int(),
  sourceFingerprint: z.string(),
  clips: z.array(AudioAssemblyClip),
  subtitleCues: z.array(SubtitleCue),
  srt: z.string(),
  webVtt: z.string(),
  warnings: z.array(z.string()),
  protectedClipIds: z.array(Id),
  staleTrackIds: z.array(Id),
});
export interface AudioAssemblyPreview {
  timelineId: Id;
  timelineVersion: number;
  sourceFingerprint: string;
  clips: AudioAssemblyClip[];
  subtitleCues: SubtitleCue[];
  srt: string;
  webVtt: string;
  warnings: string[];
  protectedClipIds: Id[];
  staleTrackIds: Id[];
}

export const AudioAssemblyApplyInput = z.object({
  timelineId: Id,
  timelineVersion: z.int(),
  sourceFingerprint: z.string(),
  audioTrackIds: z.array(Id),
  includeSubtitles: z.boolean(),
});
export interface AudioAssemblyApplyInput {
  timelineId: Id;
  timelineVersion: number;
  sourceFingerprint: string;
  audioTrackIds: Id[];
  includeSubtitles: boolean;
}
export const EditorExportPreflight = z.object({
  canExport: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  referencedClipCount: z.int(),
  relinkRequiredCount: z.int(),
});
export interface EditorExportPreflight {
  canExport: boolean;
  blockers: string[];
  warnings: string[];
  referencedClipCount: number;
  relinkRequiredCount: number;
}
export const ReviewPackage = z.object({
  id: Id,
  projectId: Id,
  adaptationId: Id,
  episodeId: Id,
  kind: z.literal("offline"),
  status: z.literal("exported"),
  title: z.string(),
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
export const ReviewComment = z.object({
  id: Id,
  packageId: Id,
  shotId: z.exactOptional(Id),
  timecodeSeconds: z.exactOptional(NumericValue),
  authorAlias: z.exactOptional(z.string()),
  body: z.string(),
  resolved: z.boolean(),
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
export const ReviewCommentInput = z.object({
  shotId: z.exactOptional(Id),
  timecodeSeconds: z.exactOptional(NumericValue),
  authorAlias: z.exactOptional(z.string()),
  body: RequiredText,
});
export interface ReviewCommentInput {
  shotId?: Id;
  timecodeSeconds?: number;
  authorAlias?: string;
  body: string;
}
export const ReviewDecision = z.object({
  id: Id,
  packageId: Id,
  shotId: z.exactOptional(Id),
  decision: z.union([
    z.literal("approve"),
    z.literal("return"),
    z.literal("request_changes"),
    z.literal("note"),
  ]),
  authorAlias: z.exactOptional(z.string()),
  note: z.exactOptional(z.string()),
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
export const ReviewDecisionInput = z.object({
  shotId: z.exactOptional(Id),
  decision: z.union([
    z.literal("approve"),
    z.literal("return"),
    z.literal("request_changes"),
    z.literal("note"),
  ]),
  authorAlias: z.exactOptional(z.string()),
  note: z.exactOptional(z.string()),
});
export interface ReviewDecisionInput {
  shotId?: Id;
  decision: "approve" | "return" | "request_changes" | "note";
  authorAlias?: string;
  note?: string;
}
export const ReviewRevisionPreviewInput = z.object({
  scriptId: Id,
  proposedContent: RequiredText,
});
export interface ReviewRevisionPreviewInput {
  scriptId: Id;
  proposedContent: string;
}
export const OfflineReviewImportInput = z.object({
  capabilityToken: z.string(),
});
export interface OfflineReviewImportInput {
  capabilityToken: string;
}
export const OfflineReviewImportResult = z.object({
  packageId: Id,
  commentCount: z.int(),
  decisionCount: z.int(),
});
export interface OfflineReviewImportResult {
  packageId: Id;
  commentCount: number;
  decisionCount: number;
}
/** A platform endpoint and workspace; the access token itself stays in the credential vault. */
export const CloudReviewConnection = z.object({
  baseUrl: z.string(),
  workspaceId: z.string(),
  configured: z.boolean(),
  updatedAt: IsoDateTime,
});
export interface CloudReviewConnection {
  baseUrl: string;
  workspaceId: string;
  configured: boolean;
  updatedAt: IsoDateTime;
}
export const CloudReviewConnectionInput = z.object({
  baseUrl: z.string(),
  workspaceId: z.string(),
  credentialRef: z.string(),
});
export interface CloudReviewConnectionInput {
  baseUrl: string;
  workspaceId: string;
  credentialRef: string;
}
export const CloudReviewMediaInput = z.object({
  id: z.string(),
  shotId: Id,
  relativePath: z.string(),
  mimeType: z.string(),
  capabilityToken: z.string(),
});
export interface CloudReviewMediaInput {
  id: string;
  shotId: Id;
  relativePath: string;
  mimeType: string;
  capabilityToken: string;
}
export const CloudReviewPublishInput = z.object({
  pin: z.exactOptional(z.string()),
  media: z.array(CloudReviewMediaInput),
});
export interface CloudReviewPublishInput {
  pin?: string;
  media: CloudReviewMediaInput[];
}
/** Local-only publish review: storage is known, platform retention and cost are intentionally explicit when unknown. */
export const CloudReviewPublishPreview = z.object({
  packageId: Id,
  workspaceId: z.string(),
  manifestJson: z.string(),
  media: z.array(
    z.object({
      id: z.string(),
      shotId: Id,
      relativePath: z.string(),
      mimeType: z.string(),
      sizeBytes: z.int(),
      sha256: z.string(),
    }),
  ),
  storageBytes: z.int(),
  maxStorageBytes: z.int(),
  retention: z.string(),
  costEstimate: z.string(),
});
export interface CloudReviewPublishPreview {
  packageId: Id;
  workspaceId: string;
  manifestJson: string;
  media: Array<{
    id: string;
    shotId: Id;
    relativePath: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }>;
  storageBytes: number;
  maxStorageBytes: number;
  retention: string;
  costEstimate: string;
}
export const CloudReviewPublishResult = z.object({
  packageId: Id,
  remotePackageId: z.string(),
  shareUrl: z.string(),
  status: z.string(),
  expiresAt: IsoDateTime,
});
export interface CloudReviewPublishResult {
  packageId: Id;
  remotePackageId: string;
  shareUrl: string;
  status: string;
  expiresAt: IsoDateTime;
}
export const CloudReviewSyncResult = z.object({
  packageId: Id,
  nextCursor: z.int(),
  commentCount: z.int(),
  decisionCount: z.int(),
});
export interface CloudReviewSyncResult {
  packageId: Id;
  nextCursor: number;
  commentCount: number;
  decisionCount: number;
}
export const CloudReviewBinding = z.object({
  packageId: Id,
  remotePackageId: z.string(),
  shareUrl: z.string(),
  status: z.string(),
  expiresAt: IsoDateTime,
  syncCursor: z.int(),
  updatedAt: IsoDateTime,
});
export interface CloudReviewBinding {
  packageId: Id;
  remotePackageId: string;
  shareUrl: string;
  status: string;
  expiresAt: IsoDateTime;
  syncCursor: number;
  updatedAt: IsoDateTime;
}
export const CloudReviewDeleteResult = z.object({
  packageId: Id,
  status: z.literal("deleted"),
  localFeedbackPreserved: z.boolean(),
});
export interface CloudReviewDeleteResult {
  packageId: Id;
  status: "deleted";
  localFeedbackPreserved: boolean;
}

/** 版本化离线合规规则是本地证据，不构成法律意见或平台审核结果。 */
export const ComplianceRuleProfile = z.object({
  id: Id,
  version: z.string(),
  title: z.string(),
  sourceUrl: z.string(),
  sourceStatus: z.union([
    z.literal("official"),
    z.literal("consultation"),
    z.literal("platform_guidance"),
    z.literal("unknown"),
  ]),
  publishedAt: IsoDateTime,
  effectiveAt: z.exactOptional(IsoDateTime),
  regions: z.array(z.string()),
  platforms: z.array(z.string()),
  requiredVisibleLabel: z.string(),
  requiredMetadataKeys: z.array(z.string()),
  contentChecksum: z.string(),
  integrityStatus: z.union([
    z.literal("verified"),
    z.literal("unchecked"),
    z.literal("invalid"),
  ]),
  active: z.boolean(),
  builtIn: z.boolean(),
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
export const CompliancePreflightInput = z.object({
  title: RequiredText,
  subtitleLanguage: RequiredText,
  targetPlatform: z.exactOptional(z.string()),
  targetRegion: z.exactOptional(z.string()),
  deliveryDate: RequiredText,
  aigcDeclared: z.boolean(),
  manualContentReviewConfirmed: z.boolean(),
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
export const EpisodeCompliancePreflight = z.object({
  ok: z.boolean(),
  profile: z.exactOptional(ComplianceRuleProfile),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  visibleLabel: z.exactOptional(z.string()),
  metadata: z.record(z.string(), z.string()),
  sourceFingerprint: z.string(),
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
export const ProviderConnectionResult = z.object({
  providerId: Id,
  ok: z.boolean(),
  checkedAt: IsoDateTime,
  statusCode: z.exactOptional(z.int()),
  models: z.array(z.string()),
  message: z.string(),
});
export interface ProviderConnectionResult {
  providerId: Id;
  ok: boolean;
  checkedAt: IsoDateTime;
  statusCode?: number;
  models: string[];
  message: string;
}

/** Non-sensitive result of activating a saved provider for the Pi harness. */
export const AgentProviderActivationResult = z.object({
  providerId: Id,
  engineAvailable: z.boolean(),
  providerKind: z.string(),
  model: z.string(),
  activatedAt: IsoDateTime,
  message: z.string(),
});
export interface AgentProviderActivationResult {
  providerId: Id;
  engineAvailable: boolean;
  providerKind: string;
  model: string;
  activatedAt: IsoDateTime;
  message: string;
}

export const StoryBibleChangeSetStatus = z.union([
  z.literal("queued"),
  z.literal("draft"),
  z.literal("applied"),
  z.literal("paused"),
  z.literal("skipped"),
  z.literal("discarded"),
  z.literal("stale"),
  z.literal("failed"),
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
export const StoryBibleSettings = z.object({
  projectId: Id,
  autoSuggest: z.boolean(),
  updatedAt: IsoDateTime,
});
export interface StoryBibleSettings {
  projectId: Id;
  autoSuggest: boolean;
  updatedAt: IsoDateTime;
}
export const StoryBibleChangePreview = z.object({
  title: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});
export interface StoryBibleChangePreview {
  title: string;
  fields: Array<{ key: string; value: string }>;
}
export const StoryBibleChangeSet = z.object({
  id: Id,
  projectId: Id,
  chapterId: Id,
  sourceVersion: z.int(),
  status: StoryBibleChangeSetStatus,
  sourceState: z.exactOptional(
    z.union([z.literal("current"), z.literal("stale"), z.literal("missing")]),
  ),
  summary: z.string(),
  taskId: z.exactOptional(Id),
  conflictNotes: z.array(z.string()),
  preview: StoryBibleChangePreview,
  appliedAt: z.exactOptional(IsoDateTime),
  undoneAt: z.exactOptional(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export interface StoryBibleChangeSet {
  id: Id;
  projectId: Id;
  chapterId: Id;
  sourceVersion: number;
  status: StoryBibleChangeSetStatus;
  sourceState?: "current" | "stale" | "missing";
  summary: string;
  taskId?: Id;
  conflictNotes: string[];
  preview: StoryBibleChangePreview;
  appliedAt?: IsoDateTime;
  undoneAt?: IsoDateTime;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const StoryBibleStaleMark = z.object({
  id: Id,
  projectId: Id,
  chapterId: Id,
  reason: z.string(),
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
export const StoryBibleChangeSetInput = z.object({
  projectId: Id,
  chapterId: Id,
});
export interface StoryBibleChangeSetInput {
  projectId: Id;
  chapterId: Id;
}
export const StoryBibleChangeSetApplyInput = z.object({
  fields: z.exactOptional(z.array(z.string())),
});
export interface StoryBibleChangeSetApplyInput {
  fields?: string[];
}

export const ProjectPackagePreview = z.object({
  id: Id,
  sourceName: z.string(),
  projectTitle: z.string(),
  shortDramaType: z.string(),
  chapterCount: z.int(),
  resourceCount: z.int(),
  warnings: z.array(z.string()),
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
export const ProjectPackagePreviewInput = z.object({
  capabilityToken: z.string(),
});
export interface ProjectPackagePreviewInput {
  capabilityToken: string;
}
export const ProjectPackageCommitInput = z.object({
  title: z.exactOptional(z.string()),
});
export interface ProjectPackageCommitInput {
  title?: string;
}
export const ProjectPackageCommitResult = z.object({
  project: Project,
  chaptersCreated: z.int(),
  resourcesCreated: z.int(),
});
export interface ProjectPackageCommitResult {
  project: Project;
  chaptersCreated: number;
  resourcesCreated: number;
}

export const ChapterAnalysisRunResult = z.object({
  task: Task,
  records: z.array(DomainEntity),
});
export interface ChapterAnalysisRunResult {
  task: Task;
  records: DomainEntity[];
}

export const GlobalSearchResult = z.object({
  kind: z.string(),
  id: Id,
  title: z.string(),
  excerpt: z.exactOptional(z.string()),
  projectId: z.exactOptional(Id),
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
export const GlobalSearchResponse = z.object({
  query: z.string(),
  results: z.array(GlobalSearchResult),
});
export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
}

export const BackupRecord = z.object({
  id: Id,
  name: z.string(),
  size: z.int(),
  createdAt: IsoDateTime,
});
export interface BackupRecord {
  id: Id;
  name: string;
  size: number;
  createdAt: IsoDateTime;
}

export const ExportDocument = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(),
});
export interface ExportDocument {
  fileName: string;
  mimeType: string;
  content: string;
}

/** A source import is always previewed before it can write to a project. */
export const SourceImportStrategy = z.union([
  z.literal("append"),
  z.literal("merge"),
  z.literal("replace"),
]);
export type SourceImportStrategy = "append" | "merge" | "replace";

export const SourceImportChapter = z.object({
  key: z.string(),
  title: z.string(),
  content: z.string(),
  orderIndex: z.int(),
  wordCount: z.int(),
  warning: z.exactOptional(z.string()),
});
export interface SourceImportChapter {
  key: string;
  title: string;
  content: string;
  orderIndex: number;
  wordCount: number;
  warning?: string;
}

export const SourceImportScene = z.object({
  key: z.string(),
  title: z.string(),
  location: z.string(),
  timeOfDay: z.exactOptional(z.string()),
  visualDescription: z.string(),
  characters: z.array(z.string()),
  summary: z.string(),
  content: z.string(),
  orderIndex: z.int(),
  dialogueCount: z.int(),
  actionCount: z.int(),
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

export const SourceImportEpisode = z.object({
  key: z.string(),
  episodeNumber: z.int(),
  title: z.string(),
  content: z.string(),
  scenes: z.array(SourceImportScene),
});
export interface SourceImportEpisode {
  key: string;
  episodeNumber: number;
  title: string;
  content: string;
  scenes: SourceImportScene[];
}

export const SourceImportPreview = z.object({
  fileName: z.string(),
  sourceType: z.union([
    z.literal("txt"),
    z.literal("markdown"),
    z.literal("docx"),
    z.literal("epub"),
    z.literal("script-json"),
    z.literal("draft"),
  ]),
  contentKind: z.union([
    z.literal("novel"),
    z.literal("script"),
    z.literal("draft"),
  ]),
  title: z.string(),
  charCount: z.int(),
  chapters: z.array(SourceImportChapter),
  episodes: z.array(SourceImportEpisode),
  warnings: z.array(z.string()),
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

export const SourceImportPreviewInput = z.object({
  projectId: z.exactOptional(Id),
  capabilityToken: z.string(),
});
export interface SourceImportPreviewInput {
  projectId?: Id;
  capabilityToken: string;
}

export const SourceImportPreviewResponse = z.object({
  importId: Id,
  preview: SourceImportPreview,
  duplicates: z.object({
    chapters: z.array(z.string()),
    episodes: z.array(z.int()),
  }),
  expiresAt: IsoDateTime,
});
export interface SourceImportPreviewResponse {
  importId: Id;
  preview: SourceImportPreview;
  duplicates: { chapters: string[]; episodes: number[] };
  expiresAt: IsoDateTime;
}

export const SourceImportCommitInput = z.object({
  projectId: Id,
  strategy: SourceImportStrategy,
  rightsConfirmed: z.boolean(),
  destructiveConfirmed: z.boolean(),
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
export const ImportExtractionSourceRef = z.object({
  sourceKey: z.string(),
  chapterTitle: z.string(),
  start: z.int(),
  end: z.int(),
  excerpt: z.string(),
  sourceVersion: z.int(),
});
export interface ImportExtractionSourceRef {
  sourceKey: string;
  chapterTitle: string;
  start: number;
  end: number;
  excerpt: string;
  sourceVersion: number;
}

export const ImportExtractionCandidateType = z.union([
  z.literal("character"),
  z.literal("scene"),
  z.literal("prop"),
  z.literal("chapter-summary"),
  z.literal("adaptation"),
]);
export type ImportExtractionCandidateType =
  "character" | "scene" | "prop" | "chapter-summary" | "adaptation";

export const ImportExtractionCandidateStatus = z.union([
  z.literal("draft"),
  z.literal("rejected"),
  z.literal("adopted"),
  z.literal("conflict"),
]);
export type ImportExtractionCandidateStatus =
  "draft" | "rejected" | "adopted" | "conflict";

export const ImportExtractionCandidate = z.object({
  id: Id,
  type: ImportExtractionCandidateType,
  title: z.string(),
  summary: z.string(),
  confidence: NumericValue,
  sourceRefs: z.array(ImportExtractionSourceRef),
  status: ImportExtractionCandidateStatus,
  conflictNote: z.exactOptional(z.string()),
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

export const ImportExtractionChangeSetStatus = z.union([
  z.literal("draft"),
  z.literal("applied"),
  z.literal("stale"),
  z.literal("discarded"),
  z.literal("failed"),
]);
export type ImportExtractionChangeSetStatus =
  "draft" | "applied" | "stale" | "discarded" | "failed";

export const ImportExtractionChangeSet = z.object({
  id: Id,
  projectId: Id,
  sourceFingerprint: z.string(),
  sourceTitle: z.string(),
  status: ImportExtractionChangeSetStatus,
  summary: z.string(),
  candidates: z.array(ImportExtractionCandidate),
  appliedAt: z.exactOptional(IsoDateTime),
  undoneAt: z.exactOptional(IsoDateTime),
  errorMessage: z.exactOptional(z.string()),
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

export const ImportExtractionCandidatePatch = z.object({
  title: z.exactOptional(z.string()),
  summary: z.exactOptional(z.string()),
  status: z.exactOptional(z.union([z.literal("draft"), z.literal("rejected")])),
});
export interface ImportExtractionCandidatePatch {
  title?: string;
  summary?: string;
  status?: "draft" | "rejected";
}

export const ImportExtractionAdoptInput = z.object({
  candidateIds: z.exactOptional(z.array(Id)),
});
export interface ImportExtractionAdoptInput {
  candidateIds?: Id[];
}

export const SourceImportCommitResult = z.object({
  createdChapters: z.int(),
  updatedChapters: z.int(),
  createdEpisodes: z.int(),
  createdScripts: z.int(),
  updatedScripts: z.int(),
  createdScenes: z.int(),
  adaptationProjectId: z.exactOptional(Id),
  checkpointCount: z.int(),
  extractionChangeSet: z.exactOptional(ImportExtractionChangeSet),
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

export const PilotPlanStatus = z.union([
  z.literal("draft"),
  z.literal("active"),
  z.literal("stale"),
  z.literal("ready-for-review"),
  z.literal("canceled"),
]);
export type PilotPlanStatus =
  "draft" | "active" | "stale" | "ready-for-review" | "canceled";

export const PilotPlanStage = z.union([
  z.literal("confirm-source"),
  z.literal("script"),
  z.literal("scenes"),
  z.literal("shots"),
  z.literal("assets"),
  z.literal("review"),
]);
export type PilotPlanStage =
  "confirm-source" | "script" | "scenes" | "shots" | "assets" | "review";

export const PilotPlan = z.object({
  id: Id,
  projectId: Id,
  chapterIds: z.array(Id),
  episodeCount: z.int(),
  status: PilotPlanStatus,
  stage: PilotPlanStage,
  sourceConfirmed: z.boolean(),
  adaptationId: z.exactOptional(Id),
  episodeIds: z.array(Id),
  coverage: z.object({
    episodes: z.int(),
    scripts: z.int(),
    scenes: z.int(),
    shots: z.int(),
    assets: z.int(),
  }),
  blocker: z.exactOptional(z.string()),
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

export const PilotPlanCreateInput = z.object({
  projectId: Id,
  chapterIds: z.array(Id),
  episodeCount: z.int(),
});
export interface PilotPlanCreateInput {
  projectId: Id;
  chapterIds: Id[];
  episodeCount: number;
}

export const PilotPlanActionInput = z.object({
  action: z.union([
    z.literal("confirm-source"),
    z.literal("return-source"),
    z.literal("cancel"),
    z.literal("resume"),
  ]),
});
export interface PilotPlanActionInput {
  action: "confirm-source" | "return-source" | "cancel" | "resume";
}

export const EpisodeWorkflowKind = z.union([
  z.literal("quality-check"),
  z.literal("compliance-check"),
  z.literal("delivery-preflight"),
  z.literal("render-preflight"),
  z.literal("animatic-draft"),
  z.literal("minimal-redo-plan"),
  z.literal("review-package"),
]);
export type EpisodeWorkflowKind =
  | "quality-check"
  | "compliance-check"
  | "delivery-preflight"
  | "render-preflight"
  | "animatic-draft"
  | "minimal-redo-plan"
  | "review-package";

export const EpisodeWorkflowInput = z.object({
  projectId: Id,
  episodeId: Id,
  kind: EpisodeWorkflowKind,
});
export interface EpisodeWorkflowInput {
  projectId: Id;
  episodeId: Id;
  kind: EpisodeWorkflowKind;
}

export const EpisodeWorkflowResult = z.object({
  task: Task,
  record: z.exactOptional(DomainEntity),
  summary: z.string(),
});
export interface EpisodeWorkflowResult {
  task: Task;
  record?: DomainEntity;
  summary: string;
}

/** 受控音频制作。音轨片段只引用项目台账中的素材和当前分集的分镜。 */
export const AudioTrackKind = z.union([
  z.literal("dialogue"),
  z.literal("narration"),
  z.literal("bgm"),
  z.literal("sfx"),
]);
export type AudioTrackKind = "dialogue" | "narration" | "bgm" | "sfx";

export const VoiceProfile = z.object({
  id: Id,
  projectId: Id,
  title: z.string(),
  characterId: z.exactOptional(Id),
  sampleAssetId: z.exactOptional(Id),
  providerVoice: z.exactOptional(z.string()),
  description: z.exactOptional(z.string()),
  status: z.union([z.literal("draft"), z.literal("adopted")]),
  version: z.int(),
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

export const VoiceProfileInput = z.object({
  projectId: Id,
  title: z.string(),
  characterId: z.exactOptional(Id),
  sampleAssetId: z.exactOptional(Id),
  providerVoice: z.exactOptional(z.string()),
  description: z.exactOptional(z.string()),
});
export interface VoiceProfileInput {
  projectId: Id;
  title: string;
  characterId?: Id;
  sampleAssetId?: Id;
  providerVoice?: string;
  description?: string;
}

export const AudioTrackClip = z.object({
  id: Id,
  shotId: z.exactOptional(Id),
  assetId: z.exactOptional(Id),
  voiceProfileId: z.exactOptional(Id),
  startSeconds: NumericValue,
  durationSeconds: NumericValue,
  text: z.exactOptional(z.string()),
  /** 片段级谱系，避免无关台词修改使整条分集音频全部失效。 */
  sourceFingerprint: z.exactOptional(z.string()),
  sourceVersions: z.exactOptional(
    z.array(
      z.object({
        kind: z.enum([
          "shot",
          "asset",
          "voice-profile",
          "voice-sample",
          "voice-character",
        ]),
        id: Id,
        version: z.int(),
      }),
    ),
  ),
});
export interface AudioTrackClip {
  id: Id;
  shotId?: Id;
  assetId?: Id;
  voiceProfileId?: Id;
  startSeconds: number;
  durationSeconds: number;
  text?: string;
  sourceFingerprint?: string;
  sourceVersions?: {
    kind:
      "shot" | "asset" | "voice-profile" | "voice-sample" | "voice-character";
    id: Id;
    version: number;
  }[];
}

export const AudioTrackClipInput = z.object({
  shotId: z.exactOptional(Id),
  assetId: z.exactOptional(Id),
  voiceProfileId: z.exactOptional(Id),
  startSeconds: NumericValue,
  durationSeconds: NumericValue,
  text: z.exactOptional(z.string()),
});
export interface AudioTrackClipInput {
  shotId?: Id;
  assetId?: Id;
  voiceProfileId?: Id;
  startSeconds: number;
  durationSeconds: number;
  text?: string;
}

export const AudioTrack = z.object({
  id: Id,
  projectId: Id,
  episodeId: Id,
  kind: AudioTrackKind,
  label: z.string(),
  sourceFingerprint: z.string(),
  clips: z.array(AudioTrackClip),
  status: z.union([z.literal("draft"), z.literal("adopted")]),
  stale: z.boolean(),
  staleReason: z.exactOptional(z.string()),
  sourceState: z.enum(["current", "stale", "unverified"]),
  sourceReasons: z.array(z.string()),
  revision: z.exactOptional(
    z.object({
      reviewId: Id,
      sourceTrackId: Id,
      sourceVersion: z.int(),
      clipLinks: z.array(z.object({ previousClipId: Id, nextClipId: Id })),
    }),
  ),
  supersededBy: z.exactOptional(Id),
  version: z.int(),
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
  sourceState: "current" | "stale" | "unverified";
  sourceReasons: string[];
  revision?: {
    reviewId: Id;
    sourceTrackId: Id;
    sourceVersion: number;
    clipLinks: { previousClipId: Id; nextClipId: Id }[];
  };
  supersededBy?: Id;
  version: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const AudioTrackInput = z.object({
  projectId: Id,
  episodeId: Id,
  kind: AudioTrackKind,
  label: z.string(),
  clips: z.array(AudioTrackClipInput),
});
export interface AudioTrackInput {
  projectId: Id;
  episodeId: Id;
  kind: AudioTrackKind;
  label: string;
  clips: AudioTrackClipInput[];
}

export const AnimaticClip = z.object({
  shotId: Id,
  title: z.string(),
  startSeconds: NumericValue,
  durationSeconds: NumericValue,
  mediaAssetId: z.exactOptional(Id),
  mediaKind: z.union([
    z.literal("video"),
    z.literal("still"),
    z.literal("missing"),
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

export const AnimaticInitialization = z.object({
  projectId: Id,
  episodeId: Id,
  sourceFingerprint: z.string(),
  clips: z.array(AnimaticClip),
});
export interface AnimaticInitialization {
  projectId: Id;
  episodeId: Id;
  sourceFingerprint: string;
  clips: AnimaticClip[];
}

export const AnimaticDraft = z.object({
  id: Id,
  projectId: Id,
  episodeId: Id,
  sourceFingerprint: z.string(),
  clips: z.array(AnimaticClip),
  annotations: z.string(),
  status: z.union([
    z.literal("draft"),
    z.literal("approved"),
    z.literal("returned"),
  ]),
  reviewNote: z.exactOptional(z.string()),
  version: z.int(),
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

export const AnimaticDraftInput = z.object({
  projectId: Id,
  episodeId: Id,
  sourceFingerprint: z.string(),
  clips: z.array(AnimaticClip),
  annotations: z.exactOptional(z.string()),
});
export interface AnimaticDraftInput {
  projectId: Id;
  episodeId: Id;
  sourceFingerprint: string;
  clips: AnimaticClip[];
  annotations?: string;
}

export const AnimaticReviewInput = z.object({
  status: z.union([z.literal("approved"), z.literal("returned")]),
  reviewNote: z.exactOptional(z.string()),
  version: z.int(),
});
export interface AnimaticReviewInput {
  status: "approved" | "returned";
  reviewNote?: string;
  version: number;
}

export const EpisodeRenderPreflight = z.object({
  projectId: Id,
  episodeId: Id,
  sourceFingerprint: z.string(),
  ok: z.boolean(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  animaticId: z.exactOptional(Id),
  audioTrackIds: z.array(Id),
  durationSeconds: NumericValue,
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

export const ImageGenerationKind = z.union([
  z.literal("still"),
  z.literal("first_frame"),
  z.literal("last_frame"),
  z.literal("cover"),
]);
export type ImageGenerationKind =
  "still" | "first_frame" | "last_frame" | "cover";

export const ImageGenerationInput = z.object({
  providerId: Id,
  projectId: Id,
  shotId: Id,
  kind: ImageGenerationKind,
  prompt: z.string(),
  negativePrompt: z.exactOptional(z.string()),
  size: z.exactOptional(z.string()),
  quality: z.exactOptional(z.string()),
  outputFormat: z.exactOptional(
    z.union([z.literal("png"), z.literal("jpeg"), z.literal("webp")]),
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

export const ImageGenerationRun = z.object({
  task: Task,
  assets: z.array(DomainEntity),
  candidates: z.array(DomainEntity),
});
export interface ImageGenerationRun {
  task: Task;
  assets: DomainEntity[];
  candidates: DomainEntity[];
}

export const TtsGenerationInput = z.object({
  providerId: Id,
  projectId: Id,
  episodeId: Id,
  shotId: z.exactOptional(Id),
  voiceProfileId: z.exactOptional(Id),
  kind: z.union([z.literal("dialogue"), z.literal("narration")]),
  input: z.string(),
  voice: z.string(),
  instructions: z.exactOptional(z.string()),
  speed: z.exactOptional(NumericValue),
  responseFormat: z.exactOptional(
    z.union([
      z.literal("mp3"),
      z.literal("opus"),
      z.literal("aac"),
      z.literal("flac"),
      z.literal("wav"),
      z.literal("pcm"),
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

export const TtsGenerationRun = z.object({
  task: Task,
  asset: DomainEntity,
});
export interface TtsGenerationRun {
  task: Task;
  asset: DomainEntity;
}

export const VideoGenerationInput = z.object({
  providerId: Id,
  projectId: Id,
  episodeId: z.exactOptional(Id),
  shotId: z.exactOptional(Id),
  prompt: z.string(),
  negativePrompt: z.exactOptional(z.string()),
  seconds: z.exactOptional(z.int()),
  size: z.exactOptional(z.string()),
  readinessHash: z.exactOptional(z.string()),
  confirmUnknownCost: z.exactOptional(z.boolean()),
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
  readinessHash?: string;
  confirmUnknownCost?: boolean;
}

/** A server-derived, short-lived submission snapshot for the still-first gate. */
export const VideoGenerationPreflight = z.object({
  shotId: Id,
  providerId: Id,
  snapshotHash: z.string(),
  ready: z.boolean(),
  adoptedStillId: z.exactOptional(Id),
  lockedAssetIds: z.array(Id),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  costStatus: z.enum(["known", "unknown"]),
  estimatedCost: z.exactOptional(NumericValue),
  currency: z.exactOptional(z.string()),
});
export interface VideoGenerationPreflight {
  shotId: Id;
  providerId: Id;
  snapshotHash: string;
  ready: boolean;
  adoptedStillId?: Id;
  lockedAssetIds: Id[];
  blockers: string[];
  warnings: string[];
  costStatus: "known" | "unknown";
  estimatedCost?: number;
  currency?: string;
}

export const VideoGenerationBatchPreflightInput = z.object({
  projectId: Id,
  submissions: z.array(VideoGenerationInput),
});
export interface VideoGenerationBatchPreflightInput {
  projectId: Id;
  submissions: VideoGenerationInput[];
}

export const VideoGenerationBatchPreflight = z.object({
  projectId: Id,
  ready: z.boolean(),
  items: z.array(VideoGenerationPreflight),
  blockers: z.array(z.string()),
  knownEstimatedCost: NumericValue,
  unknownCostCount: z.int(),
});
export interface VideoGenerationBatchPreflight {
  projectId: Id;
  ready: boolean;
  items: VideoGenerationPreflight[];
  blockers: string[];
  knownEstimatedCost: number;
  unknownCostCount: number;
}

export const VideoGenerationJob = z.object({
  id: Id,
  taskId: Id,
  projectId: Id,
  episodeId: z.exactOptional(Id),
  shotId: z.exactOptional(Id),
  providerId: Id,
  remoteJobId: Id,
  prompt: z.string(),
  status: z.union([
    z.literal("queued"),
    z.literal("running"),
    z.literal("succeeded"),
    z.literal("failed"),
    z.literal("canceled"),
  ]),
  results: z.array(DomainEntity),
  error: z.exactOptional(z.string()),
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

export const VideoGenerationRetryInput = z.object({
  providerId: z.exactOptional(Id),
});
export interface VideoGenerationRetryInput {
  providerId?: Id;
}

export const FeedbackKind = z.union([
  z.literal("metrics"),
  z.literal("comments"),
]);
export type FeedbackKind = "metrics" | "comments";

export const FeedbackPreviewInput = z.object({
  projectId: Id,
  kind: FeedbackKind,
  capabilityToken: z.string(),
});
export interface FeedbackPreviewInput {
  projectId: Id;
  kind: FeedbackKind;
  capabilityToken: string;
}

export const FeedbackPreview = z.object({
  importId: Id,
  projectId: Id,
  kind: FeedbackKind,
  sourceName: z.string(),
  validCount: z.int(),
  warnings: z.array(z.string()),
  sample: z.array(z.unknown()),
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

export const FeedbackCommitInput = z.object({ projectId: Id });
export interface FeedbackCommitInput {
  projectId: Id;
}

export const FeedbackBatch = z.object({
  id: Id,
  projectId: Id,
  kind: FeedbackKind,
  sourceName: z.string(),
  rowCount: z.int(),
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

export const FeedbackMetric = z.object({
  id: Id,
  batchId: Id,
  name: z.string(),
  value: NumericValue,
  occurredAt: z.exactOptional(IsoDateTime),
  dimensions: z.unknown(),
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

export const FeedbackComment = z.object({
  id: Id,
  batchId: Id,
  content: z.string(),
  author: z.exactOptional(z.string()),
  occurredAt: z.exactOptional(IsoDateTime),
  category: z.string(),
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

export const FeedbackCluster = z.object({
  id: Id,
  projectId: Id,
  batchId: Id,
  title: z.string(),
  summary: z.string(),
  commentCount: z.int(),
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

export const FeedbackDashboard = z.object({
  batches: z.array(FeedbackBatch),
  metrics: z.array(FeedbackMetric),
  comments: z.array(FeedbackComment),
  clusters: z.array(FeedbackCluster),
});
export interface FeedbackDashboard {
  batches: FeedbackBatch[];
  metrics: FeedbackMetric[];
  comments: FeedbackComment[];
  clusters: FeedbackCluster[];
}

export const FeedbackClusterInput = z.object({
  projectId: Id,
  batchId: Id,
});
export interface FeedbackClusterInput {
  projectId: Id;
  batchId: Id;
}

export const DiagnosticReport = z.object({
  generatedAt: IsoDateTime,
  serverVersion: z.string(),
  engineAvailable: z.boolean(),
  database: z.object({
    projectCount: z.int(),
    chapterCount: z.int(),
    taskCount: z.int(),
    backupCount: z.int(),
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

export const ProductionGraphNode = z.object({
  id: Id,
  kind: z.string(),
  title: z.string(),
  status: z.string(),
});
export interface ProductionGraphNode {
  id: Id;
  kind: string;
  title: string;
  status: string;
}

export const ProductionGraphEdge = z.object({
  sourceId: Id,
  targetId: Id,
  relation: z.string(),
});
export interface ProductionGraphEdge {
  sourceId: Id;
  targetId: Id;
  relation: string;
}

export const ProductionGraph = z.object({
  projectId: Id,
  nodes: z.array(ProductionGraphNode),
  edges: z.array(ProductionGraphEdge),
  coverage: z.object({
    episodes: z.int(),
    scripts: z.int(),
    scenes: z.int(),
    shots: z.int(),
    assets: z.int(),
    stills: z.int(),
    adoptedStills: z.int(),
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
export interface ProjectProgress {
  projectId: Id;
  scope: { kind: "project" | "episodes"; episodeIds: Id[] };
  sourceVersion: number;
  completion: number;
  steps: Array<{
    id: "source" | "script" | "scenes" | "shots" | "assets" | "review";
    label: string;
    current: number;
    required: number;
    complete: boolean;
    target: string;
  }>;
  blockers: Array<{ code: string; message: string; target: string }>;
  nextAction: { label: string; target: string };
}

export const ProductionImpactInput = z.object({
  projectId: Id,
  sourceId: Id,
});
export interface ProductionImpactInput {
  projectId: Id;
  sourceId: Id;
}

export const ProductionImpact = z.object({
  sourceId: Id,
  affected: z.array(ProductionGraphNode),
  summary: z.string(),
});
export interface ProductionImpact {
  sourceId: Id;
  affected: ProductionGraphNode[];
  summary: string;
}

export const GenerationRecord = z.object({
  id: Id,
  projectId: Id,
  taskId: z.exactOptional(Id),
  kind: z.string(),
  title: z.string(),
  status: z.string(),
  summary: z.string(),
  actualCost: z.exactOptional(NumericValue),
  currency: z.string(),
  costNote: z.exactOptional(z.string()),
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

export const GenerationRecordPatch = z.object({
  actualCost: z.exactOptional(NumericValue),
  currency: z.exactOptional(z.string()),
  costNote: z.exactOptional(z.string()),
});
export interface GenerationRecordPatch {
  actualCost?: number;
  currency?: string;
  costNote?: string;
}

export const ContentVersionRestoreResult = z.object({
  targetKind: z.string(),
  targetId: Id,
  restoredFromId: Id,
});
export interface ContentVersionRestoreResult {
  targetKind: string;
  targetId: Id;
  restoredFromId: Id;
}

export const TemplateRunInput = z.object({
  projectId: z.exactOptional(Id),
  variables: z.exactOptional(z.unknown()),
});
export interface TemplateRunInput {
  projectId?: Id;
  variables?: unknown;
}

export const TemplateRunResult = z.object({
  run: DomainEntity,
  rendered: z.string(),
  variables: z.array(z.string()),
  missing: z.array(z.string()),
});
export interface TemplateRunResult {
  run: DomainEntity;
  rendered: string;
  variables: string[];
  missing: string[];
}

/** 创意诊断只产生可审阅的本地报告，不会直接改写任何创作内容。 */
export const CreativeTargetKind = z.union([
  z.literal("project"),
  z.literal("chapter"),
  z.literal("adaptation"),
  z.literal("episode"),
  z.literal("script"),
  z.literal("scene"),
  z.literal("shot"),
]);
export type CreativeTargetKind =
  | "project"
  | "chapter"
  | "adaptation"
  | "episode"
  | "script"
  | "scene"
  | "shot";
export const CreativeDiagnosticKind = z.union([
  z.literal("freshness"),
  z.literal("anti_trope"),
  z.literal("quality_gate"),
  z.literal("audience"),
  z.literal("narrative_curve"),
]);
export type CreativeDiagnosticKind =
  "freshness" | "anti_trope" | "quality_gate" | "audience" | "narrative_curve";
export const CreativeScore = z.object({
  label: z.string(),
  value: NumericValue,
});
export interface CreativeScore {
  label: string;
  value: number;
}
export const CreativeDiagnostic = z.object({
  id: Id,
  projectId: Id,
  targetKind: CreativeTargetKind,
  targetId: z.exactOptional(Id),
  targetTitle: z.string(),
  kind: CreativeDiagnosticKind,
  title: z.string(),
  summary: z.string(),
  scores: z.array(CreativeScore),
  findings: z.array(z.string()),
  recommendations: z.array(z.string()),
  curve: z.exactOptional(z.array(NumericValue)),
  sourceFingerprint: z.string(),
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
export const CreativeDiagnosticInput = z.object({
  projectId: Id,
  targetKind: z.exactOptional(CreativeTargetKind),
  targetId: z.exactOptional(Id),
  kinds: z.array(CreativeDiagnosticKind),
  caseStudyIds: z.exactOptional(z.array(Id)),
});
export interface CreativeDiagnosticInput {
  projectId: Id;
  targetKind?: CreativeTargetKind;
  targetId?: Id;
  kinds: CreativeDiagnosticKind[];
  caseStudyIds?: Id[];
}
export const CreativeDiagnosticRunResult = z.object({
  task: Task,
  diagnostics: z.array(CreativeDiagnostic),
});
export interface CreativeDiagnosticRunResult {
  task: Task;
  diagnostics: CreativeDiagnostic[];
}
export const CreativeCaseStudy = z.object({
  id: Id,
  title: RequiredText,
  sourceType: z.exactOptional(z.string()),
  genre: z.exactOptional(z.string()),
  summary: z.exactOptional(z.string()),
  relationshipPatterns: z.array(z.string()),
  openingHooks: z.array(z.string()),
  highlightBeats: z.array(z.string()),
  reversalMechanisms: z.array(z.string()),
  cliffhangers: z.array(z.string()),
  visualPatterns: z.array(z.string()),
  rhythmCurve: z.array(NumericValue),
  riskTags: z.array(z.string()),
  notes: z.exactOptional(z.string()),
  version: z.int(),
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
export const CreativeCaseStudyInput = z.object({
  title: RequiredText,
  sourceType: z.exactOptional(z.string()),
  genre: z.exactOptional(z.string()),
  summary: z.exactOptional(z.string()),
  relationshipPatterns: z.exactOptional(z.array(z.string())),
  openingHooks: z.exactOptional(z.array(z.string())),
  highlightBeats: z.exactOptional(z.array(z.string())),
  reversalMechanisms: z.exactOptional(z.array(z.string())),
  cliffhangers: z.exactOptional(z.array(z.string())),
  visualPatterns: z.exactOptional(z.array(z.string())),
  rhythmCurve: z.exactOptional(z.array(NumericValue)),
  riskTags: z.exactOptional(z.array(z.string())),
  notes: z.exactOptional(z.string()),
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
export const CreativeCaseStudyPatch = z.object({
  title: z.exactOptional(RequiredText),
  sourceType: z.exactOptional(z.string()),
  genre: z.exactOptional(z.string()),
  summary: z.exactOptional(z.string()),
  relationshipPatterns: z.exactOptional(z.array(z.string())),
  openingHooks: z.exactOptional(z.array(z.string())),
  highlightBeats: z.exactOptional(z.array(z.string())),
  reversalMechanisms: z.exactOptional(z.array(z.string())),
  cliffhangers: z.exactOptional(z.array(z.string())),
  visualPatterns: z.exactOptional(z.array(z.string())),
  rhythmCurve: z.exactOptional(z.array(NumericValue)),
  riskTags: z.exactOptional(z.array(z.string())),
  notes: z.exactOptional(z.string()),
  version: z.int(),
});
export interface CreativeCaseStudyPatch extends Partial<CreativeCaseStudyInput> {
  version: number;
}
export const CreativeIssueAcknowledgement = z.object({
  id: Id,
  projectId: Id,
  diagnosticId: Id,
  issueKey: z.string(),
  disposition: z.union([
    z.literal("accepted"),
    z.literal("fixed"),
    z.literal("not_applicable"),
  ]),
  note: z.exactOptional(z.string()),
  actorLabel: z.exactOptional(z.string()),
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
export const CreativeIssueAcknowledgementInput = z.object({
  projectId: Id,
  diagnosticId: Id,
  issueKey: RequiredText,
  disposition: z.union([
    z.literal("accepted"),
    z.literal("fixed"),
    z.literal("not_applicable"),
  ]),
  note: z.exactOptional(z.string()),
  actorLabel: z.exactOptional(z.string()),
});
export interface CreativeIssueAcknowledgementInput {
  projectId: Id;
  diagnosticId: Id;
  issueKey: string;
  disposition: "accepted" | "fixed" | "not_applicable";
  note?: string;
  actorLabel?: string;
}

export const RevisionPreview = z.object({
  id: Id,
  chapterId: Id,
  baseVersion: z.int(),
  proposedContent: z.string(),
  rationale: z.string(),
  status: z.union([
    z.literal("pending"),
    z.literal("committed"),
    z.literal("discarded"),
    z.literal("conflicted"),
  ]),
  createdAt: IsoDateTime,
  committedAt: z.exactOptional(IsoDateTime),
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
export const RevisionInput = z.object({
  chapterId: Id,
  proposedContent: z.string().min(1),
  rationale: z.exactOptional(z.string()),
});
export interface RevisionInput {
  chapterId: Id;
  proposedContent: string;
  rationale?: string;
}

export const ChangeTargetKind = z.enum([
  "creation",
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
  | "creation"
  | "project"
  | "chapter"
  | "character"
  | "outline"
  | "story_bible"
  | "episode"
  | "script"
  | "scene"
  | "shot";
export const ChangePreviewStatus = z.enum([
  "pending",
  "committed",
  "discarded",
  "conflicted",
]);
export type ChangePreviewStatus =
  "pending" | "committed" | "discarded" | "conflicted";
export const ChangePreviewTarget = z.object({
  kind: ChangeTargetKind,
  id: Id,
  baseVersion: z.int(),
  patch: z.unknown(),
  displayDiff: z.exactOptional(z.unknown()),
});
export interface ChangePreviewTarget {
  kind: ChangeTargetKind;
  id: Id;
  baseVersion: number;
  patch: unknown;
  displayDiff?: unknown;
}
export const ChangePreview = z.object({
  id: Id,
  projectId: Id,
  sessionId: z.exactOptional(Id),
  runId: z.exactOptional(Id),
  taskId: z.exactOptional(Id),
  engineKind: z.exactOptional(AgentEngineKind),
  taskType: z.exactOptional(AgentTaskType),
  targets: z.array(ChangePreviewTarget),
  rationale: z.string(),
  status: ChangePreviewStatus,
  contentHash: z.string(),
  createdAt: IsoDateTime,
  committedAt: z.exactOptional(IsoDateTime),
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

/** 用户在差异窗口中编辑或逐段采用后的候选正文。 */
export const ChangePreviewContentInput = z.object({
  content: z.string(),
});
export interface ChangePreviewContentInput {
  content: string;
}
export interface ChangePreviewRebaseInput {
  baseVersion: number;
  content: string;
}

export const ProviderActionKind = z.enum([
  "image",
  "audio",
  "video",
  "remote_render",
]);
export type ProviderActionKind = "image" | "audio" | "video" | "remote_render";
export const ProviderActionPreview = z.object({
  id: Id,
  projectId: Id,
  sessionId: z.exactOptional(Id),
  runId: z.exactOptional(Id),
  taskId: z.exactOptional(Id),
  kind: ProviderActionKind,
  providerId: Id,
  modelId: z.exactOptional(z.string()),
  parameters: z.unknown(),
  estimatedCost: z.exactOptional(NumericValue),
  currency: z.exactOptional(z.string()),
  status: z.enum(["pending", "executed", "discarded", "expired"]),
  createdAt: IsoDateTime,
  executedAt: z.exactOptional(IsoDateTime),
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

export const AgentExperimentStatus = z.enum([
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
export const AgentExperimentEngineKind = AgentEngineKind;
export type AgentExperimentEngineKind = AgentEngineKind;
export const AgentExperiment = z.object({
  id: Id,
  projectId: Id,
  taskType: AgentTaskType,
  contextSnapshotId: Id,
  status: AgentExperimentStatus,
  comparisonMode: z.enum(["recommended", "same_model"]),
  model: z.exactOptional(AgentModelSelection),
  estimatedCost: z.exactOptional(NumericValue),
  currency: z.exactOptional(z.string()),
  error: z.exactOptional(z.string()),
  revealed: z.boolean(),
  candidates: z.exactOptional(
    z.array(
      z.object({
        candidate: z.enum(["a", "b", "c"]),
        runId: Id,
        status: AgentRunStatus,
        output: z.exactOptional(z.unknown()),
        engineKind: z.exactOptional(AgentExperimentEngineKind),
        usageRunId: z.exactOptional(Id),
        engineVersion: z.exactOptional(z.string()),
        metrics: z.exactOptional(
          z.object({
            completed: z.boolean(),
            formatError: z.boolean(),
            toolViolation: z.boolean(),
            latencyMs: NumericValue,
            ttftMs: z.exactOptional(NumericValue),
            durationMs: z.exactOptional(NumericValue),
            inputTokens: z.exactOptional(NumericValue),
            outputTokens: z.exactOptional(NumericValue),
            cachedTokens: z.exactOptional(NumericValue),
            estimatedCost: z.exactOptional(NumericValue),
            currency: z.exactOptional(z.string()),
            adopted: z.boolean(),
            toolCalls: z.exactOptional(NumericValue),
            toolErrors: z.exactOptional(NumericValue),
            contextTokens: z.exactOptional(NumericValue),
            retryCount: z.exactOptional(NumericValue),
            failureCode: z.exactOptional(z.string()),
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
    candidate: "a" | "b" | "c";
    runId: Id;
    status: AgentRunStatus;
    output?: unknown;
    engineKind?: AgentExperimentEngineKind;
    usageRunId?: Id;
    engineVersion?: string;
    metrics?: {
      completed: boolean;
      formatError: boolean;
      toolViolation: boolean;
      latencyMs: number;
      ttftMs?: number;
      durationMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      cachedTokens?: number;
      estimatedCost?: number;
      currency?: string;
      adopted: boolean;
      toolCalls?: number;
      toolErrors?: number;
      contextTokens?: number;
      retryCount?: number;
      failureCode?: string;
    };
  }>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
export const AgentExperimentInput = z.object({
  projectId: Id,
  chapterId: z.exactOptional(Id),
  taskType: AgentTaskType,
  prompt: z.exactOptional(z.string()),
  comparisonMode: z.exactOptional(z.enum(["recommended", "same_model"])),
  model: z.exactOptional(AgentModelSelection),
  confirmedEstimatedCost: z.boolean(),
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
export const AgentExperimentReviewInput = z.object({
  preferredCandidate: z.enum(["a", "b", "c", "tie"]),
  notes: z.exactOptional(z.string()),
});
export interface AgentExperimentReviewInput {
  preferredCandidate: "a" | "b" | "c" | "tie";
  notes?: string;
}

export const ApiErrorCode = z.union([
  z.literal("VALIDATION_ERROR"),
  z.literal("NOT_FOUND"),
  z.literal("CONFLICT"),
  z.literal("UNAUTHORIZED"),
  z.literal("ENGINE_UNAVAILABLE"),
  z.literal("TASK_REJECTED"),
  z.literal("SCREENPLAY_INTAKE"),
  z.literal("INTERNAL_ERROR"),
]);
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "ENGINE_UNAVAILABLE"
  | "TASK_REJECTED"
  | "SCREENPLAY_INTAKE"
  | "INTERNAL_ERROR";
export const ApiError = z.object({
  code: ApiErrorCode,
  message: z.string(),
  requestId: z.string(),
  details: z.exactOptional(z.unknown()),
});
export interface ApiError {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: unknown;
}

export const EventEnvelope = z.object({
  id: z.int(),
  type: z.string(),
  occurredAt: IsoDateTime,
  payload: z.unknown(),
});
export interface EventEnvelope {
  id: number;
  type: string;
  occurredAt: IsoDateTime;
  payload: unknown;
}
