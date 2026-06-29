// Drizzle ORM schema —— 对应 SQLite 七张表（PROJECT_BRIEF.md §8）
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  shortDramaType: text('short_drama_type').notNull(),
  targetAudience: text('target_audience'),
  targetWordCount: integer('target_word_count'),
  targetEpisodeCount: integer('target_episode_count'),
  coreHook: text('core_hook'),
  emotionalCore: text('emotional_core'),
  coreSellingPoint: text('core_selling_point'),
  synopsis: text('synopsis'),
  styleGuide: text('style_guide'),
  visualStyleDirection: text('visual_style_direction'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  identity: text('identity'),
  personality: text('personality'),
  desire: text('desire'),
  secret: text('secret'),
  weakness: text('weakness'),
  arc: text('arc'),
  relationshipToProtagonist: text('relationship_to_protagonist'),
  conflictTarget: text('conflict_target'),
  emotionalFunction: text('emotional_function'),
  shortDramaFunction: text('short_drama_function'),
  visualDescription: text('visual_description'),
  appearancePrompt: text('appearance_prompt'),
  negativePrompt: text('negative_prompt'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const outlines = sqliteTable('outlines', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  type: text('type', { enum: ['book', 'chapter'] }).notNull(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const chapters = sqliteTable('chapters', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  summary: text('summary'),
  outline: text('outline'),
  content: text('content').notNull().default(''),
  mainConflict: text('main_conflict'),
  hook: text('hook'),
  highlight: text('highlight'),
  reversal: text('reversal'),
  cliffhanger: text('cliffhanger'),
  shortDramaNote: text('short_drama_note'),
  aiVideoNote: text('ai_video_note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const evaluations = sqliteTable('evaluations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  chapterId: text('chapter_id'),
  totalScore: real('total_score').notNull(),
  hookScore: real('hook_score').notNull(),
  conflictScore: real('conflict_score').notNull(),
  reversalScore: real('reversal_score').notNull(),
  emotionScore: real('emotion_score').notNull(),
  visualizationScore: real('visualization_score').notNull(),
  aiVideoFeasibilityScore: real('ai_video_feasibility_score').notNull(),
  characterConsistencyScore: real('character_consistency_score').notNull(),
  shotClarityScore: real('shot_clarity_score').notNull(),
  cliffhangerScore: real('cliffhanger_score').notNull(),
  adaptationDifficultyScore: real('adaptation_difficulty_score').notNull(),
  issues: text('issues').notNull().default('[]'),
  suggestions: text('suggestions').notNull().default('[]'),
  rawResult: text('raw_result'),
  createdAt: text('created_at').notNull(),
})

export const aiRuns = sqliteTable('ai_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  chapterId: text('chapter_id'),
  graphName: text('graph_name').notNull(),
  nodeName: text('node_name'),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  input: text('input').notNull().default(''),
  output: text('output').notNull().default(''),
  status: text('status', { enum: ['success', 'failed'] }).notNull(),
  errorMessage: text('error_message'),
  tokenUsage: integer('token_usage'),
  latencyMs: integer('latency_ms'),
  createdAt: text('created_at').notNull(),
})

export const modelConfigs = sqliteTable('model_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull().default(''),
  model: text('model').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v0.2 长篇一致性与视觉记忆系统（ROADMAP v0.2 §1-6）

export const chapterMemories = sqliteTable('chapter_memories', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  summary: text('summary').notNull(),
  importantEvents: text('important_events').notNull().default('[]'),
  characterChanges: text('character_changes').notNull().default('[]'),
  revealedSecrets: text('revealed_secrets').notNull().default('[]'),
  newForeshadowing: text('new_foreshadowing').notNull().default('[]'),
  resolvedForeshadowing: text('resolved_foreshadowing').notNull().default('[]'),
  keyVisualElements: text('key_visual_elements').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const characterStates = sqliteTable('character_states', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  characterId: text('character_id').notNull(),
  chapterId: text('chapter_id'),
  currentStatus: text('current_status').notNull(),
  emotionalState: text('emotional_state'),
  relationshipChanges: text('relationship_changes'),
  knownSecrets: text('known_secrets').notNull().default('[]'),
  hiddenSecrets: text('hidden_secrets').notNull().default('[]'),
  visualContinuityNotes: text('visual_continuity_notes'),
  createdAt: text('created_at').notNull(),
})

export const characterVisualProfiles = sqliteTable('character_visual_profiles', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  characterId: text('character_id').notNull(),
  appearancePrompt: text('appearance_prompt').notNull(),
  faceDescription: text('face_description'),
  hairstyle: text('hairstyle'),
  clothingStyle: text('clothing_style'),
  bodyType: text('body_type'),
  ageLook: text('age_look'),
  temperament: text('temperament'),
  colorPalette: text('color_palette'),
  negativePrompt: text('negative_prompt'),
  referenceImageUrl: text('reference_image_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const visualSettings = sqliteTable('visual_settings', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  type: text('type', { enum: ['world', 'location', 'style', 'object'] }).notNull(),
  visualPrompt: text('visual_prompt').notNull(),
  negativePrompt: text('negative_prompt'),
  referenceImageUrl: text('reference_image_url'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const storyEvents = sqliteTable('story_events', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  chapterId: text('chapter_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  eventType: text('event_type').notNull(),
  relatedCharacterIds: text('related_character_ids').notNull().default('[]'),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

export const foreshadowings = sqliteTable('foreshadowings', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  setupChapterId: text('setup_chapter_id'),
  payoffChapterId: text('payoff_chapter_id'),
  status: text('status', { enum: ['planned', 'setup', 'paid_off', 'abandoned'] }).notNull().default('planned'),
  description: text('description').notNull(),
  payoffPlan: text('payoff_plan'),
  relatedCharacterIds: text('related_character_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v0.3 AI 短剧小说强化系统（ROADMAP v0.3 §2-4）

export const beats = sqliteTable('beats', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  chapterId: text('chapter_id'),
  type: text('type', {
    enum: ['hook', 'conflict', 'reversal', 'reveal', 'emotion', 'payoff', 'cliffhanger', 'visual'],
  }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  dramaValue: real('drama_value').notNull(),
  visualValue: real('visual_value').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  relatedCharacterIds: text('related_character_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
})

export const highlightAnalyses = sqliteTable('highlight_analyses', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  faceSlap: real('face_slap').notNull(),
  revenge: real('revenge').notNull(),
  identityReveal: real('identity_reveal').notNull(),
  misunderstandingCleared: real('misunderstanding_cleared').notNull(),
  pampering: real('pampering').notNull(),
  counterKill: real('counter_kill').notNull(),
  counterattack: real('counterattack').notNull(),
  angst: real('angst').notNull(),
  highlightTypes: text('highlight_types').notNull().default('[]'),
  summary: text('summary').notNull(),
  suggestions: text('suggestions'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const aiVideoFeasibilityReports = sqliteTable('ai_video_feasibility_reports', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  chapterId: text('chapter_id').notNull(),
  characterCountScore: real('character_count_score').notNull(),
  actionComplexityScore: real('action_complexity_score').notNull(),
  interactionDensityScore: real('interaction_density_score').notNull(),
  sceneStabilityScore: real('scene_stability_score').notNull(),
  visualClarityScore: real('visual_clarity_score').notNull(),
  characterConsistencyScore: real('character_consistency_score').notNull(),
  generatableScore: real('generatable_score').notNull(),
  verticalSuitabilityScore: real('vertical_suitability_score').notNull(),
  promptControllabilityScore: real('prompt_controllability_score').notNull(),
  overallScore: real('overall_score').notNull(),
  risks: text('risks').notNull().default('[]'),
  suggestions: text('suggestions').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const dramaTrendReports = sqliteTable('drama_trend_reports', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  hookTrend: text('hook_trend').notNull().default('[]'),
  conflictTrend: text('conflict_trend').notNull().default('[]'),
  reversalTrend: text('reversal_trend').notNull().default('[]'),
  emotionTrend: text('emotion_trend').notNull().default('[]'),
  cliffhangerTrend: text('cliffhanger_trend').notNull().default('[]'),
  visualizationTrend: text('visualization_trend').notNull().default('[]'),
  aiVideoFeasibilityTrend: text('ai_video_feasibility_trend').notNull().default('[]'),
  characterConsistencyTrend: text('character_consistency_trend').notNull().default('[]'),
  shotClarityTrend: text('shot_clarity_trend').notNull().default('[]'),
  overallTrend: text('overall_trend').notNull().default('[]'),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v0.4 小说 / 大纲转 AI 短剧分集大纲（ROADMAP v0.4 §1/§3 + episode_analyses）

export const adaptationProjects = sqliteTable('adaptation_projects', {
  id: text('id').primaryKey(),
  sourceProjectId: text('source_project_id'),
  title: text('title').notNull(),
  targetEpisodeCount: integer('target_episode_count').notNull(),
  episodeDuration: text('episode_duration'),
  adaptationStyle: text('adaptation_style').notNull(),
  visualStyleDirection: text('visual_style_direction'),
  audience: text('audience'),
  /** v1.0 多季连载：第几季 */
  seasonNumber: integer('season_number'),
  /** v1.0 多季连载：本季改编的章节范围，JSON 文本 {from,to} */
  sourceChapterRange: text('source_chapter_range'),
  strategy: text('strategy'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const episodes = sqliteTable('episodes', {
  id: text('id').primaryKey(),
  adaptationProjectId: text('adaptation_project_id').notNull(),
  episodeNumber: integer('episode_number').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  hook: text('hook').notNull(),
  mainConflict: text('main_conflict').notNull(),
  reversal: text('reversal'),
  emotionalBeat: text('emotional_beat'),
  cliffhanger: text('cliffhanger').notNull(),
  aiVideoNote: text('ai_video_note'),
  keyVisuals: text('key_visuals').notNull().default('[]'),
  relatedChapterIds: text('related_chapter_ids').notNull().default('[]'),
  relatedBeatIds: text('related_beat_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const episodeAnalyses = sqliteTable('episode_analyses', {
  id: text('id').primaryKey(),
  adaptationProjectId: text('adaptation_project_id').notNull(),
  hookStrengthTrend: text('hook_strength_trend').notNull().default('[]'),
  retentionScoreTrend: text('retention_score_trend').notNull().default('[]'),
  paceScoreTrend: text('pace_score_trend').notNull().default('[]'),
  reversalDensityTrend: text('reversal_density_trend').notNull().default('[]'),
  visualAppealTrend: text('visual_appeal_trend').notNull().default('[]'),
  summary: text('summary').notNull(),
  suggestions: text('suggestions'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v0.5 AI 短剧剧本生成（ROADMAP v0.5 §1/§2 + script_reviews）

export const scripts = sqliteTable('scripts', {
  id: text('id').primaryKey(),
  adaptationProjectId: text('adaptation_project_id').notNull(),
  episodeId: text('episode_id').notNull(),
  episodeNumber: integer('episode_number').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  hook: text('hook'),
  mainConflict: text('main_conflict'),
  emotionalBeat: text('emotional_beat'),
  reversal: text('reversal'),
  cliffhanger: text('cliffhanger'),
  estimatedDuration: text('estimated_duration'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const scenes = sqliteTable('scenes', {
  id: text('id').primaryKey(),
  scriptId: text('script_id').notNull(),
  episodeId: text('episode_id').notNull(),
  sceneNumber: integer('scene_number').notNull(),
  title: text('title').notNull(),
  location: text('location').notNull(),
  timeOfDay: text('time_of_day'),
  visualDescription: text('visual_description').notNull().default(''),
  characters: text('characters').notNull().default('[]'),
  summary: text('summary').notNull(),
  orderIndex: integer('order_index').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const scriptReviews = sqliteTable('script_reviews', {
  id: text('id').primaryKey(),
  scriptId: text('script_id').notNull(),
  hookStrengthScore: real('hook_strength_score').notNull(),
  dialogueScore: real('dialogue_score').notNull(),
  conflictScore: real('conflict_score').notNull(),
  visualClarityScore: real('visual_clarity_score').notNull(),
  sceneClarityScore: real('scene_clarity_score').notNull(),
  characterFitScore: real('character_fit_score').notNull(),
  shotReadinessScore: real('shot_readiness_score').notNull(),
  aiVideoFeasibilityScore: real('ai_video_feasibility_score').notNull(),
  cliffhangerScore: real('cliffhanger_score').notNull(),
  overallScore: real('overall_score').notNull(),
  issues: text('issues').notNull().default('[]'),
  suggestions: text('suggestions').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v0.6 分镜与镜头 Prompt 生成（ROADMAP v0.6 §1 + shot_reviews + prompt_versions）

export const shots = sqliteTable('shots', {
  id: text('id').primaryKey(),
  sceneId: text('scene_id').notNull(),
  episodeId: text('episode_id').notNull(),
  shotNumber: integer('shot_number').notNull(),
  durationSeconds: integer('duration_seconds'),
  visualDescription: text('visual_description').notNull().default(''),
  characterIds: text('character_ids').notNull().default('[]'),
  dialogue: text('dialogue'),
  narration: text('narration'),
  cameraAngle: text('camera_angle'),
  cameraMovement: text('camera_movement'),
  emotion: text('emotion'),
  action: text('action'),
  videoPrompt: text('video_prompt').notNull().default(''),
  negativePrompt: text('negative_prompt'),
  imagePrompt: text('image_prompt'),
  consistencyNotes: text('consistency_notes'),
  aiVideoDifficulty: text('ai_video_difficulty', { enum: ['low', 'medium', 'high'] }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const shotReviews = sqliteTable('shot_reviews', {
  id: text('id').primaryKey(),
  shotId: text('shot_id').notNull(),
  lengthScore: real('length_score').notNull(),
  characterCountScore: real('character_count_score').notNull(),
  actionComplexityScore: real('action_complexity_score').notNull(),
  visualClarityScore: real('visual_clarity_score').notNull(),
  characterConsistencyScore: real('character_consistency_score').notNull(),
  sceneContinuityScore: real('scene_continuity_score').notNull(),
  promptControllabilityScore: real('prompt_controllability_score').notNull(),
  verticalSuitabilityScore: real('vertical_suitability_score').notNull(),
  overallScore: real('overall_score').notNull(),
  aiVideoDifficulty: text('ai_video_difficulty', { enum: ['low', 'medium', 'high'] }).notNull(),
  issues: text('issues').notNull().default('[]'),
  suggestions: text('suggestions').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const promptVersions = sqliteTable('prompt_versions', {
  id: text('id').primaryKey(),
  shotId: text('shot_id').notNull(),
  version: integer('version').notNull(),
  taskType: text('task_type').notNull(),
  videoPrompt: text('video_prompt').notNull().default(''),
  negativePrompt: text('negative_prompt'),
  imagePrompt: text('image_prompt'),
  note: text('note'),
  createdAt: text('created_at').notNull(),
})

// v0.7 AI 视频平台对接（ROADMAP v0.7 §1-2）

export const videoProviderConfigs = sqliteTable('video_provider_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  baseUrl: text('base_url'),
  apiKey: text('api_key').notNull().default(''),
  model: text('model'),
  defaultParams: text('default_params'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const videoGenerationTasks = sqliteTable('video_generation_tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  episodeId: text('episode_id'),
  sceneId: text('scene_id'),
  shotId: text('shot_id'),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  prompt: text('prompt').notNull().default(''),
  negativePrompt: text('negative_prompt'),
  referenceImageUrls: text('reference_image_urls').notNull().default('[]'),
  status: text('status', { enum: ['pending', 'running', 'success', 'failed'] }).notNull().default('pending'),
  remoteTaskId: text('remote_task_id'),
  errorMessage: text('error_message'),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const videoResults = sqliteTable('video_results', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  shotId: text('shot_id'),
  resultVideoUrl: text('result_video_url').notNull(),
  coverImageUrl: text('cover_image_url'),
  rawMeta: text('raw_meta'),
  isBest: integer('is_best', { mode: 'boolean' }).notNull().default(false),
  note: text('note'),
  createdAt: text('created_at').notNull(),
})

// v0.8 多 Agent 编剧室与模板系统（ROADMAP v0.8）

export const agentProfiles = sqliteTable('agent_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** 角色标识（chief_editor / highlight_optimizer …），内置预设按 role 幂等 */
  role: text('role').notNull(),
  systemPrompt: text('system_prompt').notNull(),
  outputSchema: text('output_schema'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  /** 可驱动的生成类 taskType（generate_project 等），可空=纯片段模板 */
  scope: text('scope'),
  description: text('description'),
  content: text('content').notNull().default(''),
  variables: text('variables').notNull().default('[]'),
  builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const genrePresets = sqliteTable('genre_presets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  commonRelationships: text('common_relationships').notNull().default('[]'),
  commonHighlights: text('common_highlights').notNull().default('[]'),
  commonReversals: text('common_reversals').notNull().default('[]'),
  commonOpenings: text('common_openings').notNull().default('[]'),
  commonCliffhangers: text('common_cliffhangers').notNull().default('[]'),
  visualStyle: text('visual_style').notNull(),
  shotPromptAdvice: text('shot_prompt_advice').notNull(),
  aiVideoRisks: text('ai_video_risks').notNull(),
  builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const templateRuns = sqliteTable('template_runs', {
  id: text('id').primaryKey(),
  templateId: text('template_id').notNull(),
  projectId: text('project_id'),
  scope: text('scope').notNull(),
  renderedContent: text('rendered_content').notNull().default(''),
  variables: text('variables').notNull().default('{}'),
  aiRunId: text('ai_run_id'),
  createdAt: text('created_at').notNull(),
})

// v1.0 模型配置增强：按任务组指定模型（ROADMAP v1.0-3）
// task_group 唯一：每个任务组最多绑定一个模型，缺省回退默认模型。
export const taskModelBindings = sqliteTable('task_model_bindings', {
  id: text('id').primaryKey(),
  /** 任务组标识（见 core 的 TASK_GROUPS，如 writing / analysis / script / shot / video / writing_room） */
  taskGroup: text('task_group').notNull(),
  modelConfigId: text('model_config_id').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// v1.1 创意诊断与反套路迭代系统

export const creativeCaseStudies = sqliteTable('creative_case_studies', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  sourceType: text('source_type'),
  genre: text('genre'),
  summary: text('summary'),
  relationshipPatterns: text('relationship_patterns').notNull().default('[]'),
  openingHooks: text('opening_hooks').notNull().default('[]'),
  highlightBeats: text('highlight_beats').notNull().default('[]'),
  reversalMechanisms: text('reversal_mechanisms').notNull().default('[]'),
  cliffhangers: text('cliffhangers').notNull().default('[]'),
  visualPatterns: text('visual_patterns').notNull().default('[]'),
  riskTags: text('risk_tags').notNull().default('[]'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const freshnessReports = sqliteTable('freshness_reports', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id'),
  targetTitle: text('target_title'),
  originalityScore: real('originality_score').notNull(),
  predictabilityScore: real('predictability_score').notNull(),
  tropeRiskScore: real('trope_risk_score').notNull(),
  characterFreshnessScore: real('character_freshness_score').notNull(),
  conflictFreshnessScore: real('conflict_freshness_score').notNull(),
  reversalFreshnessScore: real('reversal_freshness_score').notNull(),
  emotionalFreshnessScore: real('emotional_freshness_score').notNull(),
  overallScore: real('overall_score').notNull(),
  clicheSignals: text('cliche_signals').notNull().default('[]'),
  audiencePredictionPoints: text('audience_prediction_points').notNull().default('[]'),
  suggestions: text('suggestions').notNull().default('[]'),
  rawResult: text('raw_result'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const antiTropeVariants = sqliteTable('anti_trope_variants', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id'),
  mode: text('mode', { enum: ['conservative', 'balanced', 'wild'] }).notNull(),
  title: text('title').notNull(),
  premise: text('premise').notNull(),
  pressureMechanism: text('pressure_mechanism').notNull(),
  preservedPayoffs: text('preserved_payoffs').notNull().default('[]'),
  keyChanges: text('key_changes').notNull().default('[]'),
  risks: text('risks').notNull().default('[]'),
  sampleRewrite: text('sample_rewrite'),
  createdAt: text('created_at').notNull(),
})

export const revisionTasks = sqliteTable('revision_tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id'),
  sourceReportId: text('source_report_id'),
  title: text('title').notNull(),
  description: text('description').notNull(),
  priority: text('priority', { enum: ['must', 'should', 'could'] }).notNull(),
  status: text('status', { enum: ['open', 'accepted', 'applied', 'dismissed'] }).notNull().default('open'),
  suggestedAction: text('suggested_action').notNull(),
  expectedBenefit: text('expected_benefit').notNull().default('{}'),
  appliedVersionId: text('applied_version_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const contentVersions = sqliteTable('content_versions', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id').notNull(),
  label: text('label').notNull(),
  source: text('source', { enum: ['ai_overwrite', 'adopt_preview', 'revision_task', 'manual_checkpoint'] }).notNull(),
  content: text('content').notNull().default(''),
  meta: text('meta'),
  createdAt: text('created_at').notNull(),
})

export const qualityGateReports = sqliteTable('quality_gate_reports', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  adaptationProjectId: text('adaptation_project_id'),
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id'),
  stage: text('stage', {
    enum: ['novel_to_adaptation', 'episodes_to_scripts', 'scripts_to_shots', 'shots_to_video'],
  }).notNull(),
  score: real('score').notNull(),
  verdict: text('verdict', { enum: ['pass', 'warn', 'block'] }).notNull(),
  blockingIssues: text('blocking_issues').notNull().default('[]'),
  warnings: text('warnings').notNull().default('[]'),
  suggestions: text('suggestions').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const audienceSimulations = sqliteTable('audience_simulations', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id'),
  audienceProfile: text('audience_profile').notNull(),
  retentionScore: real('retention_score').notNull(),
  emotionalEngagementScore: real('emotional_engagement_score').notNull(),
  noveltyScore: real('novelty_score').notNull(),
  likelyDropOffPoints: text('likely_drop_off_points').notNull().default('[]'),
  mostMemorableMoments: text('most_memorable_moments').notNull().default('[]'),
  complaints: text('complaints').notNull().default('[]'),
  shareableClips: text('shareable_clips').notNull().default('[]'),
  summary: text('summary').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const narrativeCurveReports = sqliteTable('narrative_curve_reports', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  adaptationProjectId: text('adaptation_project_id'),
  targetKind: text('target_kind').notNull(),
  targetId: text('target_id'),
  hookCurve: text('hook_curve').notNull().default('[]'),
  conflictCurve: text('conflict_curve').notNull().default('[]'),
  reversalCurve: text('reversal_curve').notNull().default('[]'),
  emotionCurve: text('emotion_curve').notNull().default('[]'),
  cliffhangerCurve: text('cliffhanger_curve').notNull().default('[]'),
  freshnessCurve: text('freshness_curve').notNull().default('[]'),
  summary: text('summary').notNull(),
  weakSpots: text('weak_spots').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const workflowRuns = sqliteTable('workflow_runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id'),
  adaptationProjectId: text('adaptation_project_id'),
  templateKey: text('template_key').notNull(),
  title: text('title').notNull(),
  status: text('status', { enum: ['pending', 'running', 'success', 'failed'] }).notNull().default('pending'),
  currentStep: text('current_step'),
  steps: text('steps').notNull().default('[]'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export type DatabaseSchema = typeof import('./schema')
