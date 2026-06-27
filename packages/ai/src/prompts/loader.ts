// Prompt 注册表 —— 以 ?raw 形式导入 Markdown 模板（PROJECT_BRIEF.md §12）
import type { NovelTaskType } from '@sdns/core'
import {
  AdaptationStrategyResultSchema,
  AiVideoFeasibilityResultSchema,
  BeatsResultSchema,
  ChatProjectResultSchema,
  ChapterMemoryResultSchema,
  CharacterStateResultSchema,
  ConsistencyResultSchema,
  DramaTrendResultSchema,
  EpisodeItemSchema,
  EpisodesResultSchema,
  EvaluationResultSchema,
  First10AnalysisResultSchema,
  ForeshadowingResultSchema,
  GenerateChapterOutlinesResultSchema,
  GenerateCharactersResultSchema,
  GenerateProjectResultSchema,
  HighlightAnalysisResultSchema,
  ScenesResultSchema,
  ScriptResultSchema,
  ScriptReviewResultSchema,
  ShotPromptResultSchema,
  ShotReviewResultSchema,
  ShotsResultSchema,
  StoryEventsResultSchema,
  VisualProfileResultSchema,
  VisualSettingResultSchema,
} from '@sdns/core'
import type { z } from 'zod'

import generateProject from './zh-CN/project/generate-project.md?raw'
import generateCharacter from './zh-CN/character/generate-character.md?raw'
import generateBookOutline from './zh-CN/outline/generate-book-outline.md?raw'
import generateChapterOutline from './zh-CN/outline/generate-chapter-outline.md?raw'
import generateChapter from './zh-CN/chapter/generate-chapter.md?raw'
import continueChapter from './zh-CN/chapter/continue-chapter.md?raw'
import rewriteChapter from './zh-CN/chapter/rewrite-chapter.md?raw'
import polishChapter from './zh-CN/chapter/polish-chapter.md?raw'
import expandChapter from './zh-CN/chapter/expand-chapter.md?raw'
import enhanceConflict from './zh-CN/chapter/enhance-conflict.md?raw'
import enhanceHighlight from './zh-CN/chapter/enhance-highlight.md?raw'
import enhanceAiDramaFeel from './zh-CN/chapter/enhance-ai-drama-feel.md?raw'
import evaluateAiDramaFit from './zh-CN/evaluation/evaluate-ai-drama-fit.md?raw'
// v0.2 长篇一致性与视觉记忆系统
import summarizeChapter from './zh-CN/memory/summarize-chapter.md?raw'
import updateCharacterState from './zh-CN/memory/update-character-state.md?raw'
import extractStoryEvents from './zh-CN/memory/extract-story-events.md?raw'
import extractForeshadowing from './zh-CN/memory/extract-foreshadowing.md?raw'
import buildLongContext from './zh-CN/memory/build-long-context.md?raw'
import generateCharacterVisualProfile from './zh-CN/visual/generate-character-visual-profile.md?raw'
import generateVisualSetting from './zh-CN/visual/generate-visual-setting.md?raw'
import checkConsistency from './zh-CN/consistency/check-consistency.md?raw'
// v0.3 AI 短剧小说强化系统
import analyzeBeats from './zh-CN/beat/analyze-beats.md?raw'
import analyzeHighlights from './zh-CN/analysis/analyze-highlights.md?raw'
import analyzeAiVideoFeasibility from './zh-CN/analysis/analyze-ai-video-feasibility.md?raw'
import analyzeProjectAiDramaTrend from './zh-CN/analysis/analyze-project-ai-drama-trend.md?raw'
import enhanceHook from './zh-CN/chapter/enhance-hook.md?raw'
import enhanceReversal from './zh-CN/chapter/enhance-reversal.md?raw'
import enhanceCliffhanger from './zh-CN/chapter/enhance-cliffhanger.md?raw'
import rewriteAsAiDramaNovel from './zh-CN/rewrite/rewrite-as-ai-drama-novel.md?raw'
import chatProject from './zh-CN/chat/chat-project.md?raw'
// v0.4 改编分集大纲
import createAdaptationStrategy from './zh-CN/adaptation/create-adaptation-strategy.md?raw'
import convertNovelToEpisodes from './zh-CN/adaptation/convert-novel-to-episodes.md?raw'
import rewriteEpisodeOutline from './zh-CN/adaptation/rewrite-episode-outline.md?raw'
import enhanceEpisodeHook from './zh-CN/adaptation/enhance-episode-hook.md?raw'
import enhanceEpisodeVisuals from './zh-CN/adaptation/enhance-episode-visuals.md?raw'
import analyzeFirst10Episodes from './zh-CN/adaptation/analyze-first-10-episodes.md?raw'
// v0.5 AI 短剧剧本生成
import generateAiDramaScript from './zh-CN/script/generate-ai-drama-script.md?raw'
import splitScriptToScenes from './zh-CN/script/split-script-to-scenes.md?raw'
import reviewAiDramaScript from './zh-CN/script/review-ai-drama-script.md?raw'
import rewriteAiDramaScript from './zh-CN/script/rewrite-ai-drama-script.md?raw'
import enhanceDialogueConflict from './zh-CN/script/enhance-dialogue-conflict.md?raw'
import enhanceEpisodeCliffhanger from './zh-CN/script/enhance-episode-cliffhanger.md?raw'
import enhanceScriptVisuality from './zh-CN/script/enhance-script-visuality.md?raw'
// v0.6 分镜与镜头 Prompt 生成
import splitSceneToShots from './zh-CN/shot/split-scene-to-shots.md?raw'
import generateShotPrompt from './zh-CN/shot/generate-shot-prompt.md?raw'
import generateNegativePrompt from './zh-CN/shot/generate-negative-prompt.md?raw'
import reviewShotPrompt from './zh-CN/shot/review-shot-prompt.md?raw'
import rewriteShotPrompt from './zh-CN/shot/rewrite-shot-prompt.md?raw'
import optimizePromptForVideoPlatform from './zh-CN/shot/optimize-prompt-for-video-platform.md?raw'
// v0.8 多 Agent 编剧室与模板系统
// writing_room_* 由 writing-room.graph 内部直接引用 agent prompts；
// template_run 的实际正文来自 graph state 的 templateContent（此处仅为占位，保证 REGISTRY 完整）。
import agentReviewPrompt from './zh-CN/agent/agent-review.md?raw'
import consolidatePrompt from './zh-CN/agent/consolidate-review.md?raw'

export interface TaskDefinition {
  prompt: string
  output: 'json' | 'text'
  schema?: z.ZodType
  writesChapterContent?: boolean
}

export const TASK_DEFINITIONS: Record<NovelTaskType, TaskDefinition> = {
  generate_project: { prompt: generateProject, output: 'json', schema: GenerateProjectResultSchema },
  generate_characters: { prompt: generateCharacter, output: 'json', schema: GenerateCharactersResultSchema },
  generate_book_outline: { prompt: generateBookOutline, output: 'text' },
  generate_chapter_outline: { prompt: generateChapterOutline, output: 'json', schema: GenerateChapterOutlinesResultSchema },
  generate_chapter: { prompt: generateChapter, output: 'text', writesChapterContent: true },
  continue_chapter: { prompt: continueChapter, output: 'text', writesChapterContent: true },
  rewrite_chapter: { prompt: rewriteChapter, output: 'text', writesChapterContent: true },
  polish_chapter: { prompt: polishChapter, output: 'text', writesChapterContent: true },
  expand_chapter: { prompt: expandChapter, output: 'text', writesChapterContent: true },
  enhance_conflict: { prompt: enhanceConflict, output: 'text', writesChapterContent: true },
  enhance_highlight: { prompt: enhanceHighlight, output: 'text', writesChapterContent: true },
  enhance_ai_drama_feel: { prompt: enhanceAiDramaFeel, output: 'text', writesChapterContent: true },
  evaluate_ai_drama_fit: { prompt: evaluateAiDramaFit, output: 'json', schema: EvaluationResultSchema },
  // v0.2
  summarize_chapter: { prompt: summarizeChapter, output: 'json', schema: ChapterMemoryResultSchema },
  update_character_state: { prompt: updateCharacterState, output: 'json', schema: CharacterStateResultSchema },
  extract_story_events: { prompt: extractStoryEvents, output: 'json', schema: StoryEventsResultSchema },
  extract_foreshadowing: { prompt: extractForeshadowing, output: 'json', schema: ForeshadowingResultSchema },
  generate_character_visual_profile: { prompt: generateCharacterVisualProfile, output: 'json', schema: VisualProfileResultSchema },
  generate_visual_setting: { prompt: generateVisualSetting, output: 'json', schema: VisualSettingResultSchema },
  check_consistency: { prompt: checkConsistency, output: 'json', schema: ConsistencyResultSchema },
  build_long_context: { prompt: buildLongContext, output: 'text' },
  // v0.3
  analyze_beats: { prompt: analyzeBeats, output: 'json', schema: BeatsResultSchema },
  analyze_highlights: { prompt: analyzeHighlights, output: 'json', schema: HighlightAnalysisResultSchema },
  analyze_ai_video_feasibility: { prompt: analyzeAiVideoFeasibility, output: 'json', schema: AiVideoFeasibilityResultSchema },
  analyze_project_ai_drama_trend: { prompt: analyzeProjectAiDramaTrend, output: 'json', schema: DramaTrendResultSchema },
  enhance_hook: { prompt: enhanceHook, output: 'text', writesChapterContent: true },
  enhance_reversal: { prompt: enhanceReversal, output: 'text', writesChapterContent: true },
  enhance_cliffhanger: { prompt: enhanceCliffhanger, output: 'text', writesChapterContent: true },
  rewrite_as_ai_drama_novel: { prompt: rewriteAsAiDramaNovel, output: 'text', writesChapterContent: true },
  chat_project: { prompt: chatProject, output: 'json', schema: ChatProjectResultSchema },
  // v0.4
  create_adaptation_strategy: { prompt: createAdaptationStrategy, output: 'json', schema: AdaptationStrategyResultSchema },
  convert_novel_to_episodes: { prompt: convertNovelToEpisodes, output: 'json', schema: EpisodesResultSchema },
  rewrite_episode_outline: { prompt: rewriteEpisodeOutline, output: 'json', schema: EpisodeItemSchema },
  enhance_episode_hook: { prompt: enhanceEpisodeHook, output: 'json', schema: EpisodeItemSchema },
  enhance_episode_visuals: { prompt: enhanceEpisodeVisuals, output: 'json', schema: EpisodeItemSchema },
  analyze_first_10_episodes: { prompt: analyzeFirst10Episodes, output: 'json', schema: First10AnalysisResultSchema },
  // v0.5
  generate_ai_drama_script: { prompt: generateAiDramaScript, output: 'json', schema: ScriptResultSchema },
  split_script_to_scenes: { prompt: splitScriptToScenes, output: 'json', schema: ScenesResultSchema },
  review_ai_drama_script: { prompt: reviewAiDramaScript, output: 'json', schema: ScriptReviewResultSchema },
  rewrite_ai_drama_script: { prompt: rewriteAiDramaScript, output: 'json', schema: ScriptResultSchema },
  enhance_dialogue_conflict: { prompt: enhanceDialogueConflict, output: 'json', schema: ScriptResultSchema },
  enhance_episode_cliffhanger: { prompt: enhanceEpisodeCliffhanger, output: 'json', schema: ScriptResultSchema },
  enhance_script_visuality: { prompt: enhanceScriptVisuality, output: 'json', schema: ScriptResultSchema },
  // v0.6
  split_scene_to_shots: { prompt: splitSceneToShots, output: 'json', schema: ShotsResultSchema },
  generate_shot_prompt: { prompt: generateShotPrompt, output: 'json', schema: ShotPromptResultSchema },
  generate_negative_prompt: { prompt: generateNegativePrompt, output: 'json', schema: ShotPromptResultSchema },
  review_shot_prompt: { prompt: reviewShotPrompt, output: 'json', schema: ShotReviewResultSchema },
  rewrite_shot_prompt: { prompt: rewriteShotPrompt, output: 'json', schema: ShotPromptResultSchema },
  optimize_prompt_for_video_platform: { prompt: optimizePromptForVideoPlatform, output: 'json', schema: ShotPromptResultSchema },
  // v0.8
  writing_room_review: { prompt: agentReviewPrompt, output: 'text' },
  writing_room_consolidate: { prompt: consolidatePrompt, output: 'text' },
  template_run: { prompt: '请按「输入材料」与「本次指令」中的要求生成内容。', output: 'text' },
}

export function getPromptTemplate(taskType: NovelTaskType): string | undefined {
  return TASK_DEFINITIONS[taskType]?.prompt
}

export function getTaskSchema(taskType: NovelTaskType): z.ZodType | undefined {
  return TASK_DEFINITIONS[taskType]?.schema
}

/** 输出结构化 JSON 的任务（需解析 + Zod 校验） */
export const JSON_TASKS: ReadonlySet<NovelTaskType> = new Set(
  Object.entries(TASK_DEFINITIONS)
    .filter(([, definition]) => definition.output === 'json')
    .map(([taskType]) => taskType as NovelTaskType),
)

export function isJsonTask(taskType: NovelTaskType): boolean {
  return JSON_TASKS.has(taskType)
}

/**
 * v0.8：解析一个任务「真正参与解析/校验/落库」的 taskType。
 * - 普通任务：返回自身。
 * - template_run：返回 templateScope（由 graph state 注入，如 generate_project），
 *   从而复用对应生成类任务的解析、Zod 校验与预览落库闭环；缺省回退为 generate_project。
 */
export function effectiveTaskType(taskType: NovelTaskType, templateScope?: NovelTaskType): NovelTaskType {
  if (taskType === 'template_run') {
    return templateScope ?? 'generate_project'
  }
  return taskType
}

/** 以正文文本为输出的章节类任务 */
export const TEXT_CHAPTER_TASKS: ReadonlySet<NovelTaskType> = new Set(
  Object.entries(TASK_DEFINITIONS)
    .filter(([, definition]) => definition.writesChapterContent)
    .map(([taskType]) => taskType as NovelTaskType),
)

export function isTextChapterTask(taskType: NovelTaskType): boolean {
  return TEXT_CHAPTER_TASKS.has(taskType)
}
