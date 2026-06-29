// NovelGraphState —— LangGraph.js 统一工作流状态（PROJECT_BRIEF.md §11.1）
import { Annotation } from '@langchain/langgraph'
import type {
  AdaptationProject,
  AiVideoFeasibilityReport,
  Beat,
  Chapter,
  ChapterMemory,
  Character,
  CharacterState,
  CharacterVisualProfile,
  CreativeCaseStudy,
  DramaTrendReport,
  Episode,
  Evaluation,
  Foreshadowing,
  HighlightAnalysis,
  FreshnessReport,
  QualityGateReport,
  RevisionTask,
  AudienceSimulation,
  NarrativeCurveReport,
  NovelTaskType,
  Outline,
  Project,
  Scene,
  Script,
  Shot,
  StoryEvent,
  VisualSetting,
} from '@sdns/core'

export interface WorkflowResult {
  kind: string
  data: unknown
}

export const NovelGraphState = Annotation.Root({
  // 输入
  projectId: Annotation<string | undefined>(),
  chapterId: Annotation<string | undefined>(),
  /** v0.2：按人物生成视觉档案 / 更新人物状态时用 */
  characterId: Annotation<string | undefined>(),
  /** v0.4：改编项目相关 */
  adaptationProjectId: Annotation<string | undefined>(),
  episodeId: Annotation<string | undefined>(),
  taskType: Annotation<NovelTaskType>(),
  userInstruction: Annotation<string | undefined>(),
  /** v0.x 对话式项目设定：多轮对话历史（role/content） */
  chatHistory: Annotation<Array<{ role: 'user' | 'assistant'; content: string }> | undefined>(),

  // 上下文（loadProjectContext 加载）
  project: Annotation<Project | undefined>(),
  characters: Annotation<Character[] | undefined>(),
  outlines: Annotation<Outline[] | undefined>(),
  chapters: Annotation<Chapter[] | undefined>(),
  currentChapter: Annotation<Chapter | undefined>(),

  // v0.2 记忆上下文
  chapterMemories: Annotation<ChapterMemory[] | undefined>(),
  characterStates: Annotation<CharacterState[] | undefined>(),
  visualProfiles: Annotation<CharacterVisualProfile[] | undefined>(),
  visualSettings: Annotation<VisualSetting[] | undefined>(),
  storyEvents: Annotation<StoryEvent[] | undefined>(),
  foreshadowings: Annotation<Foreshadowing[] | undefined>(),
  /** v0.3 分析上下文 */
  beats: Annotation<Beat[] | undefined>(),
  highlightAnalyses: Annotation<HighlightAnalysis[] | undefined>(),
  feasibilityReports: Annotation<AiVideoFeasibilityReport[] | undefined>(),
  dramaTrendReport: Annotation<DramaTrendReport | undefined>(),
  /** v1.1 创意诊断上下文 */
  creativeCaseStudies: Annotation<CreativeCaseStudy[] | undefined>(),
  freshnessReports: Annotation<FreshnessReport[] | undefined>(),
  qualityGateReports: Annotation<QualityGateReport[] | undefined>(),
  revisionTasks: Annotation<RevisionTask[] | undefined>(),
  audienceSimulations: Annotation<AudienceSimulation[] | undefined>(),
  narrativeCurveReports: Annotation<NarrativeCurveReport[] | undefined>(),
  /** v0.4 改编上下文 */
  adaptationProject: Annotation<AdaptationProject | undefined>(),
  episodes: Annotation<Episode[] | undefined>(),
  /** v0.5 剧本上下文 */
  currentEpisode: Annotation<Episode | undefined>(),
  scripts: Annotation<Script[] | undefined>(),
  currentScript: Annotation<Script | undefined>(),
  scenes: Annotation<Scene[] | undefined>(),
  /** v0.6 镜头上下文 */
  sceneId: Annotation<string | undefined>(),
  shotId: Annotation<string | undefined>(),
  currentScene: Annotation<Scene | undefined>(),
  shots: Annotation<Shot[] | undefined>(),
  currentShot: Annotation<Shot | undefined>(),
  /** v0.8 模板驱动生成：渲染后的模板正文（替代 getPromptTemplate 的输出） */
  templateContent: Annotation<string | undefined>(),
  /** v0.8 模板驱动生成：实际要复用的生成类 taskType（如 generate_project），用于解析/校验/落库 */
  templateScope: Annotation<NovelTaskType | undefined>(),

  // 处理中间态
  contextText: Annotation<string | undefined>(),
  promptText: Annotation<string | undefined>(),
  rawOutput: Annotation<string | undefined>(),
  parsedOutput: Annotation<unknown | undefined>(),
  evaluation: Annotation<Evaluation | undefined>(),
  /** v0.3：趋势分析用的全书评分历史 */
  evaluations: Annotation<Evaluation[] | undefined>(),

  // 错误与重试（§14：解析/校验失败允许自动修复重试一次）
  error: Annotation<string | undefined>(),
  retryable: Annotation<boolean | undefined>(),
  retryCount: Annotation<number | undefined>(),

  // 记账（saveAiRun 用）
  providerName: Annotation<string | undefined>(),
  modelName: Annotation<string | undefined>(),
  tokenUsage: Annotation<number | undefined>(),
  latencyMs: Annotation<number | undefined>(),

  // 产物
  result: Annotation<WorkflowResult | undefined>(),
  aiRunId: Annotation<string | undefined>(),
})

export type NovelGraphStateType = typeof NovelGraphState.State
