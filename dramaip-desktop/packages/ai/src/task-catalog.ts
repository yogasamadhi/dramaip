import { Schema } from "effect";
import { AGENT_TASK_TYPES, type AgentTaskType } from "@sdns/schema";
import { DRAMAIP_MCP_TOOLS, type DramaIpMcpTool } from "@sdns/mcp";

export type AgentTaskCategory =
  | "项目与大纲"
  | "章节写作"
  | "记忆与连续性"
  | "改编与分集"
  | "剧本与场景"
  | "分镜与制作"
  | "创意与质量"
  | "编剧室与模板";

export type AgentTaskWritePolicy =
  "readonly" | "change-preview" | "provider-action-preview";

export interface AgentContextPolicy {
  readonly includeProject: boolean;
  readonly includeChapter: boolean;
  readonly includeStoryBible: boolean;
  readonly includeContinuity: boolean;
  readonly maxCharacters: number;
}

export interface AgentTaskDefinition {
  readonly id: AgentTaskType;
  readonly label: string;
  readonly category: AgentTaskCategory;
  readonly inputSchema: Schema.Top;
  readonly outputSchema: Schema.Top;
  readonly contextPolicy: AgentContextPolicy;
  readonly allowedTools: readonly DramaIpMcpTool[];
  readonly promptVersion: string;
  readonly writePolicy: AgentTaskWritePolicy;
}

const labels: Record<AgentTaskType, string> = {
  chapter_diagnostic: "章节诊断",
  chapter_revision: "章节修订预览",
  generate_project: "生成项目设定",
  generate_characters: "生成人物卡",
  generate_book_outline: "生成全书大纲",
  generate_chapter_outline: "生成章节大纲",
  generate_story_arc_outline: "生成卷或单元规划",
  generate_chapter: "生成章节正文",
  continue_chapter: "续写章节",
  rewrite_chapter: "改写章节",
  polish_chapter: "润色章节",
  expand_chapter: "扩写章节",
  enhance_conflict: "增强冲突",
  enhance_highlight: "增强爽点",
  enhance_ai_drama_feel: "增强 AI 短剧感",
  enhance_author_style: "强化作者风格",
  evaluate_ai_drama_fit: "AI 短剧适配度评分",
  summarize_chapter: "生成章节记忆",
  propose_story_bible_changes: "生成故事圣经变更建议",
  update_character_state: "更新人物状态",
  extract_story_events: "提取故事事件",
  extract_foreshadowing: "提取伏笔",
  generate_character_visual_profile: "生成人物视觉档案",
  generate_visual_setting: "生成视觉设定",
  check_consistency: "一致性检查",
  build_long_context: "生成长篇上下文",
  analyze_beats: "分析戏剧节拍",
  analyze_highlights: "爽点分析",
  analyze_ai_video_feasibility: "AI 视频可行性分析",
  analyze_project_ai_drama_trend: "全书 AI 短剧趋势分析",
  enhance_hook: "强化钩子",
  enhance_reversal: "强化反转",
  enhance_cliffhanger: "强化悬念",
  rewrite_as_ai_drama_novel: "AI 短剧化改写",
  chat_project: "项目对话",
  create_adaptation_strategy: "生成改编策略",
  convert_novel_to_episodes: "生成 AI 短剧分集大纲",
  rewrite_episode_outline: "AI 重写分集",
  enhance_episode_hook: "增强分集钩子",
  enhance_episode_visuals: "增强分集关键画面",
  analyze_first_10_episodes: "前十集分析",
  generate_ai_drama_script: "生成 AI 短剧剧本",
  split_script_to_scenes: "拆分剧本场景",
  review_ai_drama_script: "剧本审稿",
  rewrite_ai_drama_script: "AI 重写剧本",
  enhance_dialogue_conflict: "增强对白冲突",
  enhance_script_dialogue_voice: "强化对白风格",
  enhance_episode_cliffhanger: "增强集尾悬念",
  enhance_script_visuality: "增强剧本画面感",
  split_scene_to_shots: "场景拆分镜头",
  generate_shot_prompt: "生成镜头视频提示词",
  generate_negative_prompt: "生成负面提示词",
  review_shot_prompt: "镜头审查",
  rewrite_shot_prompt: "改写镜头提示词",
  optimize_prompt_for_video_platform: "优化视频平台提示词",
  generate_video_asset_drafts: "生成视频资产方案",
  plan_image_generation: "规划远程图片生成",
  plan_audio_generation: "规划远程音频生成",
  plan_video_generation: "规划远程视频生成",
  plan_remote_render: "规划远程成片渲染",
  analyze_trope_freshness: "套路新鲜度分析",
  generate_anti_trope_variants: "生成反套路方案",
  analyze_narrative_curve: "分析爽点与钩子曲线",
  generate_revision_tasks: "生成修稿任务单",
  run_quality_gate: "运行质量闸门",
  simulate_audience_reaction: "模拟观众反应",
  analyze_video_cost_risk: "视频成本与难度预估",
  analyze_text_quality: "文本质量与原创性风险",
  extract_case_structure: "抽取样本结构",
  generate_inspiration_schemes: "生成灵感方案",
  writing_room_review: "编剧室审稿",
  writing_room_consolidate: "编剧室整合建议",
  template_run: "模板驱动生成",
};

const chapterTasks = new Set<AgentTaskType>([
  "chapter_diagnostic",
  "chapter_revision",
  "generate_chapter",
  "continue_chapter",
  "rewrite_chapter",
  "polish_chapter",
  "expand_chapter",
  "enhance_conflict",
  "enhance_highlight",
  "enhance_ai_drama_feel",
  "enhance_author_style",
  "enhance_hook",
  "enhance_reversal",
  "enhance_cliffhanger",
  "rewrite_as_ai_drama_novel",
]);

const memoryTasks = new Set<AgentTaskType>([
  "summarize_chapter",
  "propose_story_bible_changes",
  "update_character_state",
  "extract_story_events",
  "extract_foreshadowing",
  "generate_character_visual_profile",
  "generate_visual_setting",
  "check_consistency",
  "build_long_context",
]);

const adaptationTasks = new Set<AgentTaskType>([
  "create_adaptation_strategy",
  "convert_novel_to_episodes",
  "rewrite_episode_outline",
  "enhance_episode_hook",
  "enhance_episode_visuals",
  "analyze_first_10_episodes",
]);

const scriptTasks = new Set<AgentTaskType>([
  "generate_ai_drama_script",
  "split_script_to_scenes",
  "review_ai_drama_script",
  "rewrite_ai_drama_script",
  "enhance_dialogue_conflict",
  "enhance_script_dialogue_voice",
  "enhance_episode_cliffhanger",
  "enhance_script_visuality",
]);

const shotTasks = new Set<AgentTaskType>([
  "split_scene_to_shots",
  "generate_shot_prompt",
  "generate_negative_prompt",
  "review_shot_prompt",
  "rewrite_shot_prompt",
  "optimize_prompt_for_video_platform",
  "generate_video_asset_drafts",
]);

const providerActionTasks = new Set<AgentTaskType>([
  "generate_video_asset_drafts",
  "plan_image_generation",
  "plan_audio_generation",
  "plan_video_generation",
  "plan_remote_render",
]);

const writingRoomTasks = new Set<AgentTaskType>([
  "writing_room_review",
  "writing_room_consolidate",
  "template_run",
]);

const changePreviewTasks = new Set<AgentTaskType>([
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
  "propose_story_bible_changes",
  "generate_character_visual_profile",
  "generate_visual_setting",
  "enhance_hook",
  "enhance_reversal",
  "enhance_cliffhanger",
  "rewrite_as_ai_drama_novel",
  "convert_novel_to_episodes",
  "rewrite_episode_outline",
  "enhance_episode_hook",
  "enhance_episode_visuals",
  "generate_ai_drama_script",
  "split_script_to_scenes",
  "rewrite_ai_drama_script",
  "enhance_dialogue_conflict",
  "enhance_script_dialogue_voice",
  "enhance_episode_cliffhanger",
  "enhance_script_visuality",
  "split_scene_to_shots",
  "generate_shot_prompt",
  "generate_negative_prompt",
  "rewrite_shot_prompt",
  "optimize_prompt_for_video_platform",
]);

function categoryFor(task: AgentTaskType): AgentTaskCategory {
  if (chapterTasks.has(task)) return "章节写作";
  if (memoryTasks.has(task)) return "记忆与连续性";
  if (adaptationTasks.has(task)) return "改编与分集";
  if (scriptTasks.has(task)) return "剧本与场景";
  if (shotTasks.has(task)) return "分镜与制作";
  if (providerActionTasks.has(task)) return "分镜与制作";
  if (writingRoomTasks.has(task)) return "编剧室与模板";
  if (
    task === "generate_project" ||
    task === "generate_characters" ||
    task === "generate_book_outline" ||
    task === "generate_chapter_outline" ||
    task === "generate_story_arc_outline"
  )
    return "项目与大纲";
  return "创意与质量";
}

function writePolicyFor(task: AgentTaskType): AgentTaskWritePolicy {
  if (providerActionTasks.has(task)) return "provider-action-preview";
  return changePreviewTasks.has(task) ? "change-preview" : "readonly";
}

const taskInputSchema = Schema.Struct({
  projectId: Schema.String,
  chapterId: Schema.optionalKey(Schema.String),
  target: Schema.optionalKey(Schema.Unknown),
  prompt: Schema.optionalKey(Schema.String),
});
const taskOutputSchema = Schema.Struct({
  summary: Schema.String,
  content: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(Schema.Unknown),
});

function toolsFor(task: AgentTaskType): readonly DramaIpMcpTool[] {
  if (chapterTasks.has(task) || memoryTasks.has(task)) return DRAMAIP_MCP_TOOLS;
  return DRAMAIP_MCP_TOOLS.filter(
    (tool) => tool !== "dramaip_analyze_continuity",
  );
}

export const AGENT_TASK_CATALOG: readonly AgentTaskDefinition[] =
  AGENT_TASK_TYPES.map((task) => ({
    id: task,
    label: labels[task],
    category: categoryFor(task),
    inputSchema: taskInputSchema,
    outputSchema: taskOutputSchema,
    contextPolicy: {
      includeProject: true,
      includeChapter: chapterTasks.has(task) || memoryTasks.has(task),
      includeStoryBible: memoryTasks.has(task) || chapterTasks.has(task),
      includeContinuity: memoryTasks.has(task),
      maxCharacters: 120_000,
    },
    allowedTools: toolsFor(task),
    promptVersion: "v3.1",
    writePolicy: writePolicyFor(task),
  }));

const catalogById = new Map(AGENT_TASK_CATALOG.map((item) => [item.id, item]));

export function getAgentTaskDefinition(
  taskType: AgentTaskType,
): AgentTaskDefinition {
  const definition = catalogById.get(taskType);
  if (!definition) throw new Error(`未知智能任务：${taskType}`);
  return definition;
}

export function isAgentTaskType(value: string): value is AgentTaskType {
  return catalogById.has(value as AgentTaskType);
}
