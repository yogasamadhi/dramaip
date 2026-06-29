// Zod 校验 —— 所有结构化 AI 输出必须用 Zod 校验（§14）
import { z } from 'zod'

const score = z.number().min(0).max(100)

/** §11.1 生成项目设定 */
export const GenerateProjectResultSchema = z.object({
  title: z.string().min(1),
  coreHook: z.string(),
  emotionalCore: z.string(),
  coreSellingPoint: z.string(),
  synopsis: z.string(),
  styleGuide: z.string(),
  visualStyleDirection: z.string(),
  targetEpisodeCount: z.number().int().min(1).max(500),
})
export type GenerateProjectResult = z.infer<typeof GenerateProjectResultSchema>

/** §11.2 生成人物卡（JSON 数组，3-6 个） */
export const CharacterItemSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  identity: z.string().optional(),
  personality: z.string().optional(),
  desire: z.string().optional(),
  secret: z.string().optional(),
  weakness: z.string().optional(),
  arc: z.string().optional(),
  relationshipToProtagonist: z.string().optional(),
  conflictTarget: z.string().optional(),
  emotionalFunction: z.string().optional(),
  shortDramaFunction: z.string().optional(),
  visualDescription: z.string().optional(),
  appearancePrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
})
export const GenerateCharactersResultSchema = z
  .array(CharacterItemSchema)
  .min(1)
  .max(20)
export type GenerateCharactersResult = z.infer<typeof GenerateCharactersResultSchema>

/** §11.4 生成章节大纲（JSON 数组） */
export const ChapterOutlineItemSchema = z.object({
  title: z.string().min(1),
  objective: z.string().optional(),
  mainConflict: z.string().optional(),
  sellingPoint: z.string().optional(),
  reversal: z.string().optional(),
  cliffhanger: z.string().optional(),
  shortDramaNote: z.string().optional(),
  keyVisuals: z.string().optional(),
  // 兼容旧字段名（summary/hook 仍可解析）
  summary: z.string().optional(),
  hook: z.string().optional(),
})
export const GenerateChapterOutlinesResultSchema = z
  .array(ChapterOutlineItemSchema)
  .min(1)
  .max(200)
export type GenerateChapterOutlinesResult = z.infer<typeof GenerateChapterOutlinesResultSchema>

/** §11.7 AI 短剧适配度评分（严格 JSON） */
export const EvaluationResultSchema = z.object({
  totalScore: score,
  hookScore: score,
  conflictScore: score,
  reversalScore: score,
  emotionScore: score,
  visualizationScore: score,
  aiVideoFeasibilityScore: score,
  characterConsistencyScore: score,
  shotClarityScore: score,
  cliffhangerScore: score,
  adaptationDifficultyScore: score,
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
})
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>

/** 模型配置（表单校验 / model_configs） */
export const ModelConfigSchema = z.object({
  name: z.string().min(1),
  provider: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string(),
  model: z.string().min(1),
  isDefault: z.boolean(),
})
export type ModelConfigInput = z.infer<typeof ModelConfigSchema>

/** 章节辅助类任务统一返回一段正文文本 */
export const ChapterTextResultSchema = z.object({
  content: z.string().min(1),
})
export type ChapterTextResult = z.infer<typeof ChapterTextResultSchema>

// ---------------------------------------------------------------------------
// v0.2 长篇一致性结构化输出（ROADMAP v0.2）
// ---------------------------------------------------------------------------

const strArr = z.array(z.string())

/** summarize_chapter：章节记忆 */
export const ChapterMemoryResultSchema = z.object({
  summary: z.string().min(1),
  importantEvents: strArr,
  characterChanges: strArr,
  revealedSecrets: strArr,
  newForeshadowing: strArr,
  resolvedForeshadowing: strArr,
  keyVisualElements: strArr,
})
export type ChapterMemoryResult = z.infer<typeof ChapterMemoryResultSchema>

/** update_character_state：人物状态 */
export const CharacterStateResultSchema = z.object({
  currentStatus: z.string().min(1),
  emotionalState: z.string().optional(),
  relationshipChanges: z.string().optional(),
  knownSecrets: strArr,
  hiddenSecrets: strArr,
  visualContinuityNotes: z.string().optional(),
})
export type CharacterStateResult = z.infer<typeof CharacterStateResultSchema>

/** extract_story_events：故事事件数组 */
export const StoryEventItemSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  eventType: z.enum([
    'conflict',
    'reveal',
    'reversal',
    'relationship',
    'foreshadowing',
    'payoff',
    'visual',
    'other',
  ]),
  chapterId: z.string().optional(),
  relatedCharacterIds: strArr,
})
export const StoryEventsResultSchema = z.array(StoryEventItemSchema).min(1).max(200)
export type StoryEventsResult = z.infer<typeof StoryEventsResultSchema>

/** extract_foreshadowing：伏笔数组 */
export const ForeshadowingItemSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  status: z.enum(['planned', 'setup', 'paid_off', 'abandoned']).optional(),
  payoffPlan: z.string().optional(),
  setupChapterId: z.string().optional(),
  payoffChapterId: z.string().optional(),
  relatedCharacterIds: strArr,
})
export const ForeshadowingResultSchema = z.array(ForeshadowingItemSchema).min(1).max(200)
export type ForeshadowingResult = z.infer<typeof ForeshadowingResultSchema>

/** generate_character_visual_profile：人物视觉档案 */
export const VisualProfileResultSchema = z.object({
  appearancePrompt: z.string().min(1),
  faceDescription: z.string().optional(),
  hairstyle: z.string().optional(),
  clothingStyle: z.string().optional(),
  bodyType: z.string().optional(),
  ageLook: z.string().optional(),
  temperament: z.string().optional(),
  colorPalette: z.string().optional(),
  negativePrompt: z.string().optional(),
})
export type VisualProfileResult = z.infer<typeof VisualProfileResultSchema>

/** generate_visual_setting：视觉设定 */
export const VisualSettingResultSchema = z.object({
  title: z.string().min(1),
  type: z.enum(['world', 'location', 'style', 'object']),
  visualPrompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  notes: z.string().optional(),
})
export type VisualSettingResult = z.infer<typeof VisualSettingResultSchema>

/** check_consistency：一致性检查（不落库） */
export const ConsistencyResultSchema = z.object({
  issues: strArr,
  suggestions: strArr,
})
export type ConsistencyResultData = z.infer<typeof ConsistencyResultSchema>

// ---------------------------------------------------------------------------
// v0.3 AI 短剧小说强化结构化输出（ROADMAP v0.3）
// ---------------------------------------------------------------------------

/** analyze_beats：戏剧节拍数组 */
export const BeatItemSchema = z.object({
  type: z.enum(['hook', 'conflict', 'reversal', 'reveal', 'emotion', 'payoff', 'cliffhanger', 'visual']),
  title: z.string().min(1),
  description: z.string(),
  dramaValue: score,
  visualValue: score,
  relatedCharacterIds: strArr,
})
export const BeatsResultSchema = z.array(BeatItemSchema).min(1).max(200)
export type BeatsResult = z.infer<typeof BeatsResultSchema>

/** analyze_highlights：爽点分析 */
export const HighlightAnalysisResultSchema = z.object({
  faceSlap: score,
  revenge: score,
  identityReveal: score,
  misunderstandingCleared: score,
  pampering: score,
  counterKill: score,
  counterattack: score,
  angst: score,
  highlightTypes: strArr,
  summary: z.string(),
  suggestions: z.string().optional(),
})
export type HighlightAnalysisResult = z.infer<typeof HighlightAnalysisResultSchema>

/** analyze_ai_video_feasibility：AI 视频可行性 */
export const AiVideoFeasibilityResultSchema = z.object({
  characterCountScore: score,
  actionComplexityScore: score,
  interactionDensityScore: score,
  sceneStabilityScore: score,
  visualClarityScore: score,
  characterConsistencyScore: score,
  generatableScore: score,
  verticalSuitabilityScore: score,
  promptControllabilityScore: score,
  overallScore: score,
  risks: strArr,
  suggestions: strArr,
})
export type AiVideoFeasibilityResult = z.infer<typeof AiVideoFeasibilityResultSchema>

/** analyze_project_ai_drama_trend：全书趋势 */
export const DramaTrendResultSchema = z.object({
  hookTrend: z.array(score),
  conflictTrend: z.array(score),
  reversalTrend: z.array(score),
  emotionTrend: z.array(score),
  cliffhangerTrend: z.array(score),
  visualizationTrend: z.array(score),
  aiVideoFeasibilityTrend: z.array(score),
  characterConsistencyTrend: z.array(score),
  shotClarityTrend: z.array(score),
  overallTrend: z.array(score),
  summary: z.string(),
})
export type DramaTrendResult = z.infer<typeof DramaTrendResultSchema>

/** chat_project：项目对话回复 + 字段更新 */
export const ChatProjectResultSchema = z.object({
  reply: z.string().min(1),
  fieldPatches: z.record(z.string(), z.unknown()),
})
export type ChatProjectResult = z.infer<typeof ChatProjectResultSchema>

// ---------------------------------------------------------------------------
// v0.4 改编分集大纲结构化输出（ROADMAP v0.4）
// ---------------------------------------------------------------------------

/** 单集大纲项（convert 数组项 / rewrite / enhance 单集 共用） */
export const EpisodeItemSchema = z.object({
  episodeNumber: z.number().int().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  hook: z.string().min(1),
  mainConflict: z.string().min(1),
  reversal: z.string().optional(),
  emotionalBeat: z.string().optional(),
  cliffhanger: z.string().min(1),
  aiVideoNote: z.string().optional(),
  keyVisuals: strArr,
  relatedChapterIds: strArr,
  relatedBeatIds: strArr,
})
export type EpisodeItem = z.infer<typeof EpisodeItemSchema>

/** convert_novel_to_episodes：分集大纲数组 */
export const EpisodesResultSchema = z.array(EpisodeItemSchema).min(1).max(200)
export type EpisodesResult = z.infer<typeof EpisodesResultSchema>

/** create_adaptation_strategy：改编策略报告 */
export const AdaptationStrategyResultSchema = z.object({
  suitableEpisodeCount: z.number().int().min(1),
  coreSellingPoint: z.string(),
  mainlineRetention: z.string(),
  subplotCutting: z.string(),
  characterMerge: z.string(),
  openingReconstruct: z.string(),
  firstThreeEpisodesHighlights: z.string(),
  overallPace: z.string(),
  visualStyleAdvice: z.string(),
  aiVideoRisks: z.string(),
})
export type AdaptationStrategyResult = z.infer<typeof AdaptationStrategyResultSchema>

/** analyze_first_10_episodes：前 10 集分析 */
export const First10AnalysisResultSchema = z.object({
  hookStrengthTrend: z.array(score),
  retentionScoreTrend: z.array(score),
  paceScoreTrend: z.array(score),
  reversalDensityTrend: z.array(score),
  visualAppealTrend: z.array(score),
  summary: z.string(),
  suggestions: z.string().optional(),
})
export type First10AnalysisResult = z.infer<typeof First10AnalysisResultSchema>

// ---------------------------------------------------------------------------
// v0.5 AI 短剧剧本结构化输出（ROADMAP v0.5）
// ---------------------------------------------------------------------------

/** generate_ai_drama_script：剧本正文（Markdown 文本）由 TEXT 任务直接返回，
 *  但附带剧本头摘要（钩子/冲突/情绪/反转/悬念/预计时长）用于落库，故整体返回 JSON。 */
export const ScriptResultSchema = z.object({
  content: z.string().min(1),
  hook: z.string().optional(),
  mainConflict: z.string().optional(),
  emotionalBeat: z.string().optional(),
  reversal: z.string().optional(),
  cliffhanger: z.string().optional(),
  estimatedDuration: z.string().optional(),
})
export type ScriptResult = z.infer<typeof ScriptResultSchema>

/** split_script_to_scenes：场景数组 */
export const SceneItemSchema = z.object({
  title: z.string().min(1),
  location: z.string().min(1),
  timeOfDay: z.string().optional(),
  visualDescription: z.string(),
  characters: strArr,
  summary: z.string(),
})
export const ScenesResultSchema = z.array(SceneItemSchema).min(1).max(200)
export type ScenesResult = z.infer<typeof ScenesResultSchema>

/** review_ai_drama_script：剧本审稿（JSON，含评分 + 问题 + 建议） */
export const ScriptReviewResultSchema = z.object({
  hookStrengthScore: score,
  dialogueScore: score,
  conflictScore: score,
  visualClarityScore: score,
  sceneClarityScore: score,
  characterFitScore: score,
  shotReadinessScore: score,
  aiVideoFeasibilityScore: score,
  cliffhangerScore: score,
  overallScore: score,
  issues: strArr,
  suggestions: strArr,
})
export type ScriptReviewResult = z.infer<typeof ScriptReviewResultSchema>

/** rewrite / enhance 类剧本任务：返回新剧本正文（沿用 ScriptResult 结构） */

// ---------------------------------------------------------------------------
// v0.6 分镜与镜头 Prompt 结构化输出（ROADMAP v0.6）
// ---------------------------------------------------------------------------

/** split_scene_to_shots：镜头数组（一个场景拆成多个镜头） */
export const ShotItemSchema = z.object({
  visualDescription: z.string().min(1),
  characterIds: strArr,
  dialogue: z.string().optional(),
  narration: z.string().optional(),
  cameraAngle: z.string().optional(),
  cameraMovement: z.string().optional(),
  emotion: z.string().optional(),
  action: z.string().optional(),
  durationSeconds: z.number().int().min(1).max(600).optional(),
})
export const ShotsResultSchema = z.array(ShotItemSchema).min(1).max(200)
export type ShotsResult = z.infer<typeof ShotsResultSchema>

/** generate_shot_prompt / generate_negative_prompt：返回单镜头的视频/负面/图片 Prompt（可选字段） */
export const ShotPromptResultSchema = z.object({
  videoPrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  imagePrompt: z.string().optional(),
})
export type ShotPromptResult = z.infer<typeof ShotPromptResultSchema>

/** review_shot_prompt：镜头审查（评分 + 问题 + 建议 + 难度） */
export const ShotReviewResultSchema = z.object({
  lengthScore: score,
  characterCountScore: score,
  actionComplexityScore: score,
  visualClarityScore: score,
  characterConsistencyScore: score,
  sceneContinuityScore: score,
  promptControllabilityScore: score,
  verticalSuitabilityScore: score,
  overallScore: score,
  aiVideoDifficulty: z.enum(['low', 'medium', 'high']),
  issues: strArr,
  suggestions: strArr,
})
export type ShotReviewResult = z.infer<typeof ShotReviewResultSchema>

/** rewrite_shot_prompt / optimize_prompt_for_video_platform：返回新 Prompt（沿用 ShotPromptResult） */

// ---------------------------------------------------------------------------
// v1.1 创意诊断与反套路迭代系统
// ---------------------------------------------------------------------------

const antiTropeMode = z.enum(['conservative', 'balanced', 'wild'])
const revisionPriority = z.enum(['must', 'should', 'could'])
const qualityGateStage = z.enum(['novel_to_adaptation', 'episodes_to_scripts', 'scripts_to_shots', 'shots_to_video'])
const qualityGateVerdict = z.enum(['pass', 'warn', 'block'])

export const FreshnessReportResultSchema = z.object({
  originalityScore: score,
  predictabilityScore: score,
  tropeRiskScore: score,
  characterFreshnessScore: score,
  conflictFreshnessScore: score,
  reversalFreshnessScore: score,
  emotionalFreshnessScore: score,
  overallScore: score,
  clicheSignals: strArr,
  audiencePredictionPoints: strArr,
  suggestions: strArr,
})
export type FreshnessReportResult = z.infer<typeof FreshnessReportResultSchema>

export const AntiTropeVariantResultSchema = z.object({
  mode: antiTropeMode,
  title: z.string().min(1),
  premise: z.string().min(1),
  pressureMechanism: z.string().min(1),
  preservedPayoffs: strArr,
  keyChanges: strArr,
  risks: strArr,
  sampleRewrite: z.string().optional(),
})
export const AntiTropeVariantsResultSchema = z.array(AntiTropeVariantResultSchema).min(3).max(3)
export type AntiTropeVariantsResult = z.infer<typeof AntiTropeVariantsResultSchema>

export const NarrativeCurveResultSchema = z.object({
  hookCurve: z.array(score),
  conflictCurve: z.array(score),
  reversalCurve: z.array(score),
  emotionCurve: z.array(score),
  cliffhangerCurve: z.array(score),
  freshnessCurve: z.array(score),
  summary: z.string(),
  weakSpots: strArr,
})
export type NarrativeCurveResult = z.infer<typeof NarrativeCurveResultSchema>

export const RevisionTaskResultSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  priority: revisionPriority,
  suggestedAction: z.string().min(1),
  expectedBenefit: z.object({
    retention: score,
    freshness: score,
    visual: score,
    cost: score,
  }),
})
export const RevisionTasksResultSchema = z.array(RevisionTaskResultSchema).min(1).max(50)
export type RevisionTasksResult = z.infer<typeof RevisionTasksResultSchema>

export const QualityGateResultSchema = z.object({
  stage: qualityGateStage.optional(),
  score: score,
  verdict: qualityGateVerdict,
  blockingIssues: strArr,
  warnings: strArr,
  suggestions: strArr,
})
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>

export const AudienceSimulationResultSchema = z.object({
  audienceProfile: z.string().min(1),
  retentionScore: score,
  emotionalEngagementScore: score,
  noveltyScore: score,
  likelyDropOffPoints: strArr,
  mostMemorableMoments: strArr,
  complaints: strArr,
  shareableClips: strArr,
  summary: z.string(),
})
export type AudienceSimulationResult = z.infer<typeof AudienceSimulationResultSchema>

export const VideoCostRiskResultSchema = z.object({
  score: score,
  verdict: qualityGateVerdict,
  blockingIssues: strArr,
  risks: strArr,
  simplifications: strArr,
  suggestions: strArr,
})
export type VideoCostRiskResult = z.infer<typeof VideoCostRiskResultSchema>

export const CaseStructureResultSchema = z.object({
  title: z.string().min(1),
  sourceType: z.string().optional(),
  genre: z.string().optional(),
  summary: z.string().optional(),
  relationshipPatterns: strArr,
  openingHooks: strArr,
  highlightBeats: strArr,
  reversalMechanisms: strArr,
  cliffhangers: strArr,
  visualPatterns: strArr,
  riskTags: strArr,
  notes: z.string().optional(),
})
export type CaseStructureResult = z.infer<typeof CaseStructureResultSchema>

// ---------------------------------------------------------------------------
// v0.8 多 Agent 编剧室与模板系统（ROADMAP v0.8）
// ---------------------------------------------------------------------------

/** writing_room_review：单个 Agent 的审稿输出（不含 agentId/agentName/role，由 graph 注入） */
export const AgentReviewOutputSchema = z.object({
  score: score,
  issues: strArr,
  suggestions: strArr,
  summary: z.string(),
})
export type AgentReviewOutput = z.infer<typeof AgentReviewOutputSchema>

/** writing_room_consolidate：主编整合结论 */
export const WritingRoomConsolidatedSchema = z.object({
  score: score,
  keyIssues: strArr,
  revisionPlan: z.string(),
})
export type WritingRoomConsolidated = z.infer<typeof WritingRoomConsolidatedSchema>

export const ALL_RESULT_SCHEMAS = {
  generate_project: GenerateProjectResultSchema,
  generate_characters: GenerateCharactersResultSchema,
  generate_chapter_outline: GenerateChapterOutlinesResultSchema,
  evaluate_ai_drama_fit: EvaluationResultSchema,
  summarize_chapter: ChapterMemoryResultSchema,
  update_character_state: CharacterStateResultSchema,
  extract_story_events: StoryEventsResultSchema,
  extract_foreshadowing: ForeshadowingResultSchema,
  generate_character_visual_profile: VisualProfileResultSchema,
  generate_visual_setting: VisualSettingResultSchema,
  check_consistency: ConsistencyResultSchema,
  // v0.3
  analyze_beats: BeatsResultSchema,
  analyze_highlights: HighlightAnalysisResultSchema,
  analyze_ai_video_feasibility: AiVideoFeasibilityResultSchema,
  analyze_project_ai_drama_trend: DramaTrendResultSchema,
  chat_project: ChatProjectResultSchema,
  // v0.4
  create_adaptation_strategy: AdaptationStrategyResultSchema,
  convert_novel_to_episodes: EpisodesResultSchema,
  rewrite_episode_outline: EpisodeItemSchema,
  enhance_episode_hook: EpisodeItemSchema,
  enhance_episode_visuals: EpisodeItemSchema,
  analyze_first_10_episodes: First10AnalysisResultSchema,
  // v0.5
  generate_ai_drama_script: ScriptResultSchema,
  split_script_to_scenes: ScenesResultSchema,
  review_ai_drama_script: ScriptReviewResultSchema,
  rewrite_ai_drama_script: ScriptResultSchema,
  enhance_dialogue_conflict: ScriptResultSchema,
  enhance_episode_cliffhanger: ScriptResultSchema,
  enhance_script_visuality: ScriptResultSchema,
  // v0.6
  split_scene_to_shots: ShotsResultSchema,
  generate_shot_prompt: ShotPromptResultSchema,
  generate_negative_prompt: ShotPromptResultSchema,
  review_shot_prompt: ShotReviewResultSchema,
  rewrite_shot_prompt: ShotPromptResultSchema,
  optimize_prompt_for_video_platform: ShotPromptResultSchema,
  // v1.1
  analyze_trope_freshness: FreshnessReportResultSchema,
  generate_anti_trope_variants: AntiTropeVariantsResultSchema,
  analyze_narrative_curve: NarrativeCurveResultSchema,
  generate_revision_tasks: RevisionTasksResultSchema,
  run_quality_gate: QualityGateResultSchema,
  simulate_audience_reaction: AudienceSimulationResultSchema,
  analyze_video_cost_risk: VideoCostRiskResultSchema,
  extract_case_structure: CaseStructureResultSchema,
  // v0.8（template_run 的实际 schema 由 scope 动态解析；这里登记两类固定 schema 便于查询）
  writing_room_review: AgentReviewOutputSchema,
  writing_room_consolidate: WritingRoomConsolidatedSchema,
} as const
