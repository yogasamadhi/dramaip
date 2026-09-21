export interface AgentTaskDescriptor {
  id: string;
  label: string;
  category: string;
  promptVersion: string;
  writePolicy: "readonly" | "change-preview" | "provider-action-preview";
  allowedTools: readonly string[];
}

export function taskPrompt(taskType: string, userPrompt: string): string {
  if (taskType === "writing_room_review")
    return [
      "你正在执行 DramaIP AI 编剧室的单模型多角色评议。不要展示隐藏思维过程。",
      "请依次、彼此隔离地给出六个角色的可见结论：主编、人物编辑、冲突与喜剧编辑、世界逻辑编辑、受众编辑、视觉制作编辑。",
      "最后由主编整合为：共同意见、分歧矩阵、必须修复、可选尝试、被否决建议。",
      "每条建议必须有稳定编号，明确影响范围、理由、风险与预估制作复杂度；不得自动修改项目，只有用户勾选后才可进入 Preview/Commit。",
      "受众判断是带假设和不确定性的顾问意见，不得声称真实市场预测。",
      `用户要求：${userPrompt}`,
    ].join("\n");
  if (taskType === "simulate_audience_reaction")
    return [
      "请使用至少三种版本化受众画像形成顾问报告。",
      "逐一列出画像、输入假设、可能反应、认知状态与不确定性；不得声称这是真实市场预测。",
      `用户要求：${userPrompt}`,
    ].join("\n");
  if (taskType === "extract_foreshadowing")
    return [
      "请按伏笔生命周期输出：埋设、强化、误导、揭示、回收、废弃。",
      "记录计划章节、实际证据、逾期状态，并检查提前泄露、无依据推理、过晚回收和认知冲突。",
      `用户要求：${userPrompt}`,
    ].join("\n");
  if (taskType === "analyze_text_quality")
    return [
      "请区分结构相似与表达相似，列出需要复核的证据区段和来源链。",
      "不得输出抄袭、侵权或法律安全结论；最终采用权属于用户。",
      `用户要求：${userPrompt}`,
    ].join("\n");
  return userPrompt;
}

const labels = {
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
} as const;

const chapter = new Set([
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
const memory = new Set([
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
const adaptation = new Set([
  "create_adaptation_strategy",
  "convert_novel_to_episodes",
  "rewrite_episode_outline",
  "enhance_episode_hook",
  "enhance_episode_visuals",
  "analyze_first_10_episodes",
]);
const script = new Set([
  "generate_ai_drama_script",
  "split_script_to_scenes",
  "review_ai_drama_script",
  "rewrite_ai_drama_script",
  "enhance_dialogue_conflict",
  "enhance_script_dialogue_voice",
  "enhance_episode_cliffhanger",
  "enhance_script_visuality",
]);
const shot = new Set([
  "split_scene_to_shots",
  "generate_shot_prompt",
  "generate_negative_prompt",
  "review_shot_prompt",
  "rewrite_shot_prompt",
  "optimize_prompt_for_video_platform",
  "generate_video_asset_drafts",
]);
const providerAction = new Set([
  "generate_video_asset_drafts",
  "plan_image_generation",
  "plan_audio_generation",
  "plan_video_generation",
  "plan_remote_render",
]);
const reports = new Set([
  "chapter_diagnostic",
  "analyze_first_10_episodes",
  "review_ai_drama_script",
  "review_shot_prompt",
]);
const changePreview = new Set([
  ...chapter,
  ...adaptation,
  ...script,
  ...shot,
  "generate_project",
  "generate_characters",
  "generate_book_outline",
  "generate_chapter_outline",
  "generate_story_arc_outline",
  "propose_story_bible_changes",
  "generate_character_visual_profile",
  "generate_visual_setting",
]);
const tools = [
  "dramaip_get_project",
  "dramaip_get_chapter",
  "dramaip_list_chapters",
  "dramaip_list_characters",
  "dramaip_search_story_bible",
  "dramaip_analyze_continuity",
  "dramaip_search_project",
  "dramaip_get_adaptation",
  "dramaip_list_episodes",
  "dramaip_get_script",
  "dramaip_list_scenes",
  "dramaip_list_shots",
  "dramaip_list_asset_metadata",
] as const;

function category(id: string): string {
  if (chapter.has(id)) return "章节写作";
  if (memory.has(id)) return "记忆与连续性";
  if (adaptation.has(id)) return "改编与分集";
  if (script.has(id)) return "剧本与场景";
  if (shot.has(id) || providerAction.has(id)) return "分镜与制作";
  if (id.startsWith("writing_room") || id === "template_run")
    return "编剧室与模板";
  if (
    id === "generate_project" ||
    id === "generate_characters" ||
    id.includes("outline")
  )
    return "项目与大纲";
  return "创意与质量";
}

export const AGENT_TASK_CATALOG: readonly AgentTaskDescriptor[] =
  Object.entries(labels).map(([id, label]) => ({
    id,
    label,
    category: category(id),
    promptVersion: "v3.1",
    writePolicy: providerAction.has(id)
      ? "provider-action-preview"
      : changePreview.has(id) && !reports.has(id)
        ? "change-preview"
        : "readonly",
    allowedTools:
      memory.has(id) || chapter.has(id)
        ? tools
        : tools.filter((tool) => tool !== "dramaip_analyze_continuity"),
  }));
